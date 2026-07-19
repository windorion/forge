import Foundation

/// Real GitHub OAuth device flow (`15a` state 2 / `6a` / `25a` step 1).
/// The app never touches a password: it shows a one-time code, the user
/// enters it at github.com/login/device, and polling picks up the grant.
/// Requires a registered OAuth App Client ID (founder action) supplied via
/// the `forge.githubClientID` default; the machinery is live either way.
@MainActor
final class GitHubAuth: ObservableObject {
    static let shared = GitHubAuth()

    enum Phase: Equatable {
        case idle
        case missingClientID
        case requestingCode
        case waiting(userCode: String, verificationURL: String, expiresAt: Date)
        case connected(login: String)
        case failed(String)
    }

    @Published private(set) var phase: Phase = .idle

    static var clientID: String? {
        let value = UserDefaults.standard.string(forKey: "forge.githubClientID")?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (value?.isEmpty == false) ? value : nil
    }

    var storedLogin: String? {
        UserDefaults.standard.string(forKey: "forge.githubLogin")
    }

    func start() {
        guard let clientID = Self.clientID else {
            phase = .missingClientID
            return
        }
        phase = .requestingCode
        Task {
            do {
                var request = URLRequest(url: URL(string: "https://github.com/login/device/code")!)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: [
                    "client_id": clientID,
                    "scope": "repo"
                ])
                let (data, _) = try await URLSession.shared.data(for: request)
                struct CodeResponse: Decodable {
                    let device_code: String
                    let user_code: String
                    let verification_uri: String
                    let expires_in: Int
                    let interval: Int?
                }
                let response = try JSONDecoder().decode(CodeResponse.self, from: data)
                phase = .waiting(
                    userCode: response.user_code,
                    verificationURL: response.verification_uri,
                    expiresAt: Date().addingTimeInterval(TimeInterval(response.expires_in))
                )
                await poll(clientID: clientID, deviceCode: response.device_code,
                           interval: TimeInterval(response.interval ?? 5))
            } catch {
                phase = .failed("device-code request failed: \(error.localizedDescription)")
            }
        }
    }

    private func poll(clientID: String, deviceCode: String, interval: TimeInterval) async {
        while case .waiting = phase {
            try? await Task.sleep(for: .seconds(interval))
            do {
                var request = URLRequest(url: URL(string: "https://github.com/login/oauth/access_token")!)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: [
                    "client_id": clientID,
                    "device_code": deviceCode,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
                ])
                let (data, _) = try await URLSession.shared.data(for: request)
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                if let token = json?["access_token"] as? String {
                    try KeychainStore.save(account: "githubAccessToken", secret: token)
                    let login = try await fetchLogin(token: token)
                    UserDefaults.standard.set(login, forKey: "forge.githubLogin")
                    phase = .connected(login: login)
                    return
                }
                if let error = json?["error"] as? String, error != "authorization_pending", error != "slow_down" {
                    phase = .failed(error)
                    return
                }
            } catch {
                phase = .failed(error.localizedDescription)
                return
            }
        }
    }

    private func fetchLogin(token: String) async throws -> String {
        var request = URLRequest(url: URL(string: "https://api.github.com/user")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        struct User: Decodable { let login: String }
        return try JSONDecoder().decode(User.self, from: data).login
    }

    func reset() {
        phase = .idle
    }
}
