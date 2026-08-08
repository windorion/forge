import Foundation

/// GitHub OAuth Device Flow for the native app.
///
/// A Forge-owned OAuth App Client ID is public configuration, not a secret.
/// The access token is validated against `/user` before it is persisted in
/// the macOS Keychain.
@MainActor
final class GitHubAuth: ObservableObject {
    static let shared = GitHubAuth()

    static let clientIDDefaultsKey = "forge.githubClientID"
    static let loginDefaultsKey = "forge.githubLogin"

    enum Phase: Equatable {
        case idle
        case missingClientID
        case requestingCode
        case waiting(userCode: String, verificationURL: String, expiresAt: Date)
        case connected(login: String)
        case failed(String)
    }

    @Published private(set) var phase: Phase
    @Published private(set) var clientID: String?
    @Published private(set) var storedLogin: String?

    private let session: URLSession
    private let defaults: UserDefaults
    private let saveToken: (String) throws -> Void
    private let deleteToken: () throws -> Void
    private let readToken: () throws -> String?
    private let sleep: @Sendable (TimeInterval) async throws -> Void
    private let now: @Sendable () -> Date
    private var flowTask: Task<Void, Never>?

    init(
        session: URLSession = .shared,
        defaults: UserDefaults = .standard,
        saveToken: @escaping (String) throws -> Void = {
            try KeychainStore.save(account: KeychainStore.githubTokenAccount, secret: $0)
        },
        deleteToken: @escaping () throws -> Void = {
            try KeychainStore.delete(account: KeychainStore.githubTokenAccount)
        },
        readToken: @escaping () throws -> String? = {
            try KeychainStore.read(account: KeychainStore.githubTokenAccount)
        },
        sleep: @escaping @Sendable (TimeInterval) async throws -> Void = {
            try await Task.sleep(for: .seconds($0))
        },
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.session = session
        self.defaults = defaults
        self.saveToken = saveToken
        self.deleteToken = deleteToken
        self.readToken = readToken
        self.sleep = sleep
        self.now = now

        let configuredClientID = Self.resolveClientID(defaults: defaults)
        let login = defaults.string(forKey: Self.loginDefaultsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let hasToken = ((try? readToken()) ?? nil)?.isEmpty == false
        let restoredLogin = login?.isEmpty == false ? login : nil
        clientID = configuredClientID
        storedLogin = restoredLogin
        if let login = restoredLogin, hasToken {
            phase = .connected(login: login)
        } else {
            phase = .idle
        }
    }

    var hasStoredToken: Bool {
        ((try? readToken()) ?? nil)?.isEmpty == false
    }

    /// Saves public OAuth configuration locally. Passing an empty value clears it.
    @discardableResult
    func configure(clientID rawValue: String) -> Bool {
        flowTask?.cancel()
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            defaults.removeObject(forKey: Self.clientIDDefaultsKey)
            clientID = Self.bundledOrEnvironmentClientID
        } else {
            defaults.set(value, forKey: Self.clientIDDefaultsKey)
            clientID = value
        }
        phase = restoredPhase
        return clientID != nil
    }

    func start() {
        flowTask?.cancel()
        guard let clientID else {
            phase = .missingClientID
            return
        }

        phase = .requestingCode
        flowTask = Task { [weak self] in
            guard let self else { return }
            do {
                let response = try await requestDeviceCode(clientID: clientID)
                try Task.checkCancellation()
                let expiresAt = now().addingTimeInterval(TimeInterval(response.expiresIn))
                phase = .waiting(
                    userCode: response.userCode,
                    verificationURL: response.verificationURI,
                    expiresAt: expiresAt
                )
                await poll(
                    clientID: clientID,
                    deviceCode: response.deviceCode,
                    interval: TimeInterval(response.interval ?? 5),
                    expiresAt: expiresAt
                )
            } catch is CancellationError {
                return
            } catch {
                phase = .failed(error.localizedDescription)
            }
        }
    }

    func reset() {
        flowTask?.cancel()
        flowTask = nil
        phase = restoredPhase
    }

    func disconnect() {
        flowTask?.cancel()
        do {
            try deleteToken()
            defaults.removeObject(forKey: Self.loginDefaultsKey)
            storedLogin = nil
            phase = .idle
        } catch {
            phase = .failed("Could not remove the GitHub token: \(error.localizedDescription)")
        }
    }

    private var restoredPhase: Phase {
        if let storedLogin, hasStoredToken {
            return .connected(login: storedLogin)
        }
        return .idle
    }

    private func requestDeviceCode(clientID: String) async throws -> DeviceCodeResponse {
        var request = URLRequest(url: URL(string: "https://github.com/login/device/code")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.httpBody = formBody(["client_id": clientID, "scope": "repo"])

        let data = try await responseData(for: request)
        if let apiError = try? JSONDecoder().decode(GitHubErrorResponse.self, from: data),
           let code = apiError.error {
            throw GitHubAuthError.github(code: code, description: apiError.errorDescription)
        }
        do {
            return try JSONDecoder().decode(DeviceCodeResponse.self, from: data)
        } catch {
            throw GitHubAuthError.invalidResponse("GitHub did not return a device code.")
        }
    }

    private func poll(
        clientID: String,
        deviceCode: String,
        interval: TimeInterval,
        expiresAt: Date
    ) async {
        var pollingInterval = max(interval, 1)

        while case .waiting = phase {
            guard now() < expiresAt else {
                phase = .failed("The GitHub code expired. Request a new code and try again.")
                return
            }

            do {
                try await sleep(pollingInterval)
                try Task.checkCancellation()
                guard case .waiting = phase else { return }

                var request = URLRequest(url: URL(string: "https://github.com/login/oauth/access_token")!)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
                request.httpBody = formBody([
                    "client_id": clientID,
                    "device_code": deviceCode,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
                ])

                let data = try await responseData(for: request)
                let response = try JSONDecoder().decode(TokenResponse.self, from: data)
                if let token = response.accessToken, !token.isEmpty {
                    let login = try await fetchLogin(token: token)
                    try saveToken(token)
                    defaults.set(login, forKey: Self.loginDefaultsKey)
                    storedLogin = login
                    phase = .connected(login: login)
                    flowTask = nil
                    return
                }

                switch response.error {
                case "authorization_pending":
                    continue
                case "slow_down":
                    pollingInterval += 5
                case "expired_token":
                    phase = .failed("The GitHub code expired. Request a new code and try again.")
                    return
                case "access_denied":
                    phase = .failed("GitHub authorization was cancelled.")
                    return
                case let code?:
                    throw GitHubAuthError.github(code: code, description: response.errorDescription)
                case nil:
                    throw GitHubAuthError.invalidResponse("GitHub did not return an access token.")
                }
            } catch is CancellationError {
                return
            } catch {
                phase = .failed(error.localizedDescription)
                return
            }
        }
    }

    private func fetchLogin(token: String) async throws -> String {
        var request = URLRequest(url: URL(string: "https://api.github.com/user")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        let data = try await responseData(for: request)
        do {
            return try JSONDecoder().decode(GitHubUser.self, from: data).login
        } catch {
            throw GitHubAuthError.invalidResponse("GitHub authorized the app but did not return an account login.")
        }
    }

    private func responseData(for request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GitHubAuthError.invalidResponse("GitHub returned a non-HTTP response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let decoded = try? JSONDecoder().decode(GitHubErrorResponse.self, from: data)
            throw GitHubAuthError.httpStatus(http.statusCode, decoded?.message ?? decoded?.errorDescription)
        }
        return data
    }

    private func formBody(_ values: [String: String]) -> Data? {
        var components = URLComponents()
        components.queryItems = values.sorted(by: { $0.key < $1.key }).map(URLQueryItem.init)
        return components.percentEncodedQuery?.data(using: .utf8)
    }

    private var userAgent: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "development"
        return "Forge/\(version)"
    }

    private static func resolveClientID(defaults: UserDefaults) -> String? {
        let saved = defaults.string(forKey: clientIDDefaultsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return saved?.isEmpty == false ? saved : bundledOrEnvironmentClientID
    }

    private static var bundledOrEnvironmentClientID: String? {
        let environment = ProcessInfo.processInfo.environment["FORGE_GITHUB_CLIENT_ID"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if environment?.isEmpty == false { return environment }

        let bundled = (Bundle.main.object(forInfoDictionaryKey: "ForgeGitHubClientID") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return bundled?.isEmpty == false ? bundled : nil
    }
}

private struct DeviceCodeResponse: Decodable {
    let deviceCode: String
    let userCode: String
    let verificationURI: String
    let expiresIn: Int
    let interval: Int?

    enum CodingKeys: String, CodingKey {
        case deviceCode = "device_code"
        case userCode = "user_code"
        case verificationURI = "verification_uri"
        case expiresIn = "expires_in"
        case interval
    }
}

private struct TokenResponse: Decodable {
    let accessToken: String?
    let error: String?
    let errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case error
        case errorDescription = "error_description"
    }
}

private struct GitHubErrorResponse: Decodable {
    let error: String?
    let errorDescription: String?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case error
        case errorDescription = "error_description"
        case message
    }
}

private struct GitHubUser: Decodable {
    let login: String
}

private enum GitHubAuthError: LocalizedError {
    case invalidResponse(String)
    case httpStatus(Int, String?)
    case github(code: String, description: String?)

    var errorDescription: String? {
        switch self {
        case let .invalidResponse(message):
            return message
        case let .httpStatus(status, message):
            return message?.isEmpty == false ? "GitHub returned HTTP \(status): \(message!)" : "GitHub returned HTTP \(status)."
        case let .github(code, description):
            return description?.isEmpty == false ? "GitHub authorization failed (\(code)): \(description!)" : "GitHub authorization failed: \(code)."
        }
    }
}
