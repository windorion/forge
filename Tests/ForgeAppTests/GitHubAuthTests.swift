import Foundation
import XCTest
@testable import ForgeApp

@MainActor
final class GitHubAuthTests: XCTestCase {
    func testMissingClientIDCanBeConfiguredWithoutASecret() throws {
        let defaults = try makeDefaults()
        let auth = GitHubAuth(
            defaults: defaults,
            saveToken: { _ in },
            deleteToken: {},
            readToken: { nil }
        )

        auth.start()
        XCTAssertEqual(auth.phase, .missingClientID)

        XCTAssertTrue(auth.configure(clientID: "  OAuth-client-id  "))
        XCTAssertEqual(auth.clientID, "OAuth-client-id")
        XCTAssertEqual(defaults.string(forKey: GitHubAuth.clientIDDefaultsKey), "OAuth-client-id")
        XCTAssertEqual(auth.phase, .idle)
    }

    func testDeviceFlowHonorsSlowDownValidatesUserAndPersistsConnection() async throws {
        let defaults = try makeDefaults()
        defaults.set("client-123", forKey: GitHubAuth.clientIDDefaultsKey)
        let recorder = GitHubRequestRecorder()
        let delays = GitHubDelayRecorder()
        let tokenStore = GitHubTokenRecorder()
        let (session, protocolType) = makeSession { request in
            let requestNumber = recorder.record(request)
            switch request.url?.path {
            case "/login/device/code":
                return Self.response(request, body: #"{"device_code":"device-1","user_code":"ABCD-EFGH","verification_uri":"https://github.com/login/device","expires_in":900,"interval":1}"#)
            case "/login/oauth/access_token":
                let tokenPollCount = recorder.requests.filter { $0.url?.path == "/login/oauth/access_token" }.count
                if tokenPollCount == 1 {
                    return Self.response(request, body: #"{"error":"slow_down","error_description":"wait longer"}"#)
                }
                return Self.response(request, body: #"{"access_token":"oauth-token","scope":"repo","token_type":"bearer"}"#)
            case "/user":
                return Self.response(request, body: #"{"login":"windorion"}"#)
            default:
                throw TestGitHubError.unexpectedRequest(requestNumber)
            }
        }
        defer {
            protocolType.clear()
            session.invalidateAndCancel()
        }

        let auth = GitHubAuth(
            session: session,
            defaults: defaults,
            saveToken: { tokenStore.save($0) },
            deleteToken: { tokenStore.clear() },
            readToken: { tokenStore.token },
            sleep: { interval in delays.record(interval) }
        )

        auth.start()
        try await waitUntil { auth.phase == .connected(login: "windorion") }

        XCTAssertEqual(delays.values, [1, 6])
        XCTAssertEqual(tokenStore.token, "oauth-token")
        XCTAssertEqual(defaults.string(forKey: GitHubAuth.loginDefaultsKey), "windorion")
        XCTAssertEqual(auth.storedLogin, "windorion")

        let paths = recorder.requests.compactMap(\.url?.path)
        XCTAssertEqual(paths, ["/login/device/code", "/login/oauth/access_token", "/login/oauth/access_token", "/user"])
        let deviceBody = String(data: try XCTUnwrap(recorder.requests.first?.httpBody), encoding: .utf8)
        XCTAssertTrue(deviceBody?.contains("client_id=client-123") == true)
        XCTAssertTrue(deviceBody?.contains("scope=repo") == true)
        XCTAssertEqual(recorder.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer oauth-token")
    }

    func testDeviceCodeHTTPFailureIsReportedToTheUI() async throws {
        let defaults = try makeDefaults()
        defaults.set("bad-client", forKey: GitHubAuth.clientIDDefaultsKey)
        let (session, protocolType) = makeSession { request in
            Self.response(
                request,
                status: 422,
                body: #"{"error":"incorrect_client_credentials","error_description":"Client ID is invalid"}"#
            )
        }
        defer {
            protocolType.clear()
            session.invalidateAndCancel()
        }

        let auth = GitHubAuth(
            session: session,
            defaults: defaults,
            saveToken: { _ in },
            deleteToken: {},
            readToken: { nil },
            sleep: { _ in }
        )

        auth.start()
        try await waitUntil {
            if case .failed = auth.phase { return true }
            return false
        }

        guard case let .failed(message) = auth.phase else {
            return XCTFail("Expected a failed phase.")
        }
        XCTAssertTrue(message.contains("HTTP 422"))
        XCTAssertTrue(message.contains("Client ID is invalid"))
    }

    private func makeDefaults() throws -> UserDefaults {
        let name = "GitHubAuthTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    private func makeSession(
        handler: @escaping GitHubMockURLProtocol.Handler
    ) -> (URLSession, GitHubMockURLProtocol.Type) {
        GitHubMockURLProtocol.install(handler)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GitHubMockURLProtocol.self]
        return (URLSession(configuration: configuration), GitHubMockURLProtocol.self)
    }

    private func waitUntil(
        timeout: TimeInterval = 2,
        condition: @escaping @MainActor () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() >= deadline { throw TestGitHubError.timeout }
            try await Task.sleep(for: .milliseconds(10))
        }
    }

    nonisolated private static func response(
        _ request: URLRequest,
        status: Int = 200,
        body: String
    ) -> (URLResponse, Data) {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (response, Data(body.utf8))
    }
}

private enum TestGitHubError: Error {
    case timeout
    case unexpectedRequest(Int)
}

private final class GitHubRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var captured: [URLRequest] = []

    var requests: [URLRequest] { lock.withLock { captured } }

    @discardableResult
    func record(_ request: URLRequest) -> Int {
        lock.withLock {
            var copy = request
            copy.httpBody = request.httpBody ?? Self.readBody(from: request.httpBodyStream)
            captured.append(copy)
            return captured.count
        }
    }

    private static func readBody(from stream: InputStream?) -> Data? {
        guard let stream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4_096)
        defer { buffer.deallocate() }
        while true {
            let count = stream.read(buffer, maxLength: 4_096)
            if count <= 0 { return count == 0 ? data : nil }
            data.append(buffer, count: count)
        }
    }
}

private final class GitHubDelayRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var captured: [TimeInterval] = []
    var values: [TimeInterval] { lock.withLock { captured } }
    func record(_ value: TimeInterval) { lock.withLock { captured.append(value) } }
}

private final class GitHubTokenRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?
    var token: String? { lock.withLock { value } }
    func save(_ token: String) { lock.withLock { value = token } }
    func clear() { lock.withLock { value = nil } }
}

private final class GitHubMockURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) throws -> (URLResponse, Data)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: Handler?

    static func install(_ handler: @escaping Handler) {
        lock.withLock { self.handler = handler }
    }

    static func clear() {
        lock.withLock { handler = nil }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.lock.withLock({ Self.handler }) else {
            client?.urlProtocol(self, didFailWithError: TestGitHubError.unexpectedRequest(0))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
