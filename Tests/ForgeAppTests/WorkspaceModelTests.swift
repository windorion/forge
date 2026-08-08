import Foundation
import XCTest
@testable import ForgeApp

@MainActor
final class WorkspaceModelTests: XCTestCase {
    func testSuccessfulHealthRefreshPopulatesConnectedWorkspaceStateWithoutStartingEvents() async throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        let (client, session) = makeClient { request in
            switch request.url?.path {
            case "/api/health":
                return Self.response(request, status: 200, body: Self.healthJSON)
            case "/api/settings/model-provider":
                return Self.response(request, status: 200, body: Self.modelProviderSettingsJSON)
            case "/api/tasks":
                return Self.response(request, status: 200, body: #"{"tasks":[]}"#)
            case "/api/queue":
                return Self.response(request, status: 200, body: Self.queueJSON)
            case "/api/validation-presets":
                return Self.response(request, status: 200, body: Self.validationPresetsJSON)
            case "/api/git/status":
                return Self.response(request, status: 200, body: Self.gitStatusJSON)
            default:
                return Self.response(request, status: 404, body: #"{"error":"unexpected test route"}"#)
            }
        }
        defer { session.invalidateAndCancel() }
        let model = WorkspaceModel(runtime: client, userDefaults: defaults)

        model.refreshRuntimeHealth(connectEventStream: false)

        let connected = await eventually { model.statusMessage == "Runtime connected" }
        XCTAssertTrue(connected)
        XCTAssertEqual(model.runtimeState, .running)
        XCTAssertEqual(model.runtimeHealth?.service, "forge-runtime")
        XCTAssertEqual(model.runtimeHealth?.workspace?.repoRoot, "/tmp/forge-tests")
        XCTAssertEqual(model.modelProviderSettingsEnvelope?.configuration.status, "Ready")
        XCTAssertEqual(model.taskQueueSnapshot?.concurrencyLimit, 2)
        XCTAssertEqual(model.validationPresets.map(\.id), ["swift-tests"])
        XCTAssertEqual(model.gitStatus?.branch, "codex/tests")
        XCTAssertNil(model.runtimeLastError)
        XCTAssertEqual(model.eventStreamState, .disconnected)
        XCTAssertTrue(model.hasSelectedRepository)
    }

    func testFailedHealthRefreshClearsStaleSnapshotsAndRecordsActionableError() async throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        let (client, session) = makeClient { request in
            Self.response(request, status: 503, body: #"{"error":"runtime booting"}"#)
        }
        defer { session.invalidateAndCancel() }
        let model = WorkspaceModel(runtime: client, userDefaults: defaults)
        model.runtimeHealth = try decode(RuntimeHealth.self, from: Self.healthJSON)
        model.modelProviderSettingsEnvelope = try decode(
            ModelProviderSettingsEnvelope.self,
            from: Self.modelProviderSettingsJSON
        )
        model.gitStatus = try decode(GitStatusSnapshot.self, from: Self.gitStatusJSON)

        model.refreshRuntimeHealth(connectEventStream: false)

        let disconnected = await eventually { model.runtimeLastCheckedAt != nil }
        XCTAssertTrue(disconnected)
        XCTAssertEqual(model.runtimeState, .disconnected)
        XCTAssertNil(model.runtimeHealth)
        XCTAssertNil(model.modelProviderSettingsEnvelope)
        XCTAssertNil(model.gitStatus)
        XCTAssertEqual(model.statusMessage, "Runtime disconnected")
        XCTAssertEqual(model.runtimeLastError, "Runtime returned HTTP 503: runtime booting")
        XCTAssertEqual(model.eventStreamState, .disconnected)
    }

    func testCreateTaskUpsertsSelectsAndPersistsTheRuntimeTask() async throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        let recorder = WorkspaceRequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            switch (request.httpMethod, request.url?.path) {
            case ("POST", "/api/tasks"):
                return Self.response(request, status: 201, body: Self.taskJSON)
            case ("GET", "/api/git/status"):
                return Self.response(request, status: 200, body: Self.gitStatusJSON)
            case ("GET", "/api/tasks/task-1/validation-permissions"):
                return Self.response(request, status: 200, body: Self.validationPermissionsJSON)
            case ("GET", "/api/events"):
                return Self.response(request, status: 503, body: #"{"error":"stream closed by test"}"#)
            case ("GET", "/api/health"):
                return Self.response(request, status: 503, body: #"{"error":"stream closed by test"}"#)
            default:
                return Self.response(request, status: 404, body: #"{"error":"unexpected test route"}"#)
            }
        }
        defer { session.invalidateAndCancel() }
        let model = WorkspaceModel(runtime: client, userDefaults: defaults)

        model.createTask(
            title: "Coverage",
            objective: "Test WorkspaceModel",
            connectEventStream: false
        )

        let created = await eventually {
            model.selectedTaskID == "task-1" && recorder.paths.contains("GET /api/git/status")
        }
        XCTAssertTrue(created)
        XCTAssertEqual(model.tasks.map(\.id), ["task-1"])
        XCTAssertEqual(model.selectedTask?.title, "Coverage")
        XCTAssertEqual(defaults.string(forKey: "forge.selectedTaskID"), "task-1")
        XCTAssertTrue(recorder.paths.contains("POST /api/tasks"))
        XCTAssertTrue(recorder.paths.contains("GET /api/git/status"))
        XCTAssertEqual(model.runtimeEndpoint, "https://forge.test/api")
    }

    func testApproveValidationPresetTracksLoadingAndReplacesTheTaskOnSuccess() async throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        let recorder = WorkspaceRequestRecorder()
        let approvedTaskJSON = Self.taskJSON.replacingOccurrences(
            of: #""title":"Coverage""#,
            with: #""title":"Preset Approved""#
        )
        let (client, session) = makeClient { request in
            recorder.record(request)
            switch (request.httpMethod, request.url?.path) {
            case ("POST", "/api/tasks/task-1/approve-validation-preset"):
                return Self.response(request, status: 200, body: approvedTaskJSON)
            case ("GET", "/api/tasks/task-1/validation-permissions"):
                return Self.response(request, status: 200, body: Self.validationPermissionsJSON)
            case ("GET", "/api/events"), ("GET", "/api/health"):
                return Self.response(request, status: 503, body: #"{"error":"stream closed by test"}"#)
            default:
                return Self.response(request, status: 404, body: #"{"error":"unexpected test route"}"#)
            }
        }
        defer { session.invalidateAndCancel() }
        let model = WorkspaceModel(runtime: client, userDefaults: defaults)
        let task = try decode(ForgeTask.self, from: Self.taskJSON)
        model.tasks = [task]
        model.selectedTaskID = task.id

        model.approveValidationPreset(
            for: task,
            presetID: "swift-tests",
            connectEventStream: false
        )

        XCTAssertTrue(model.isApprovingValidationPreset(taskID: task.id, presetID: "swift-tests"))
        let completed = await eventually {
            !model.isApprovingValidationPreset(taskID: task.id, presetID: "swift-tests") &&
                model.selectedTask?.title == "Preset Approved"
        }
        XCTAssertTrue(completed)
        XCTAssertEqual(model.tasks.count, 1)
        XCTAssertTrue(recorder.paths.contains("POST /api/tasks/task-1/approve-validation-preset"))
        XCTAssertTrue(recorder.paths.contains("GET /api/tasks/task-1/validation-permissions"))
    }

    func testRunValidationFailureClearsLoadingAndKeepsTheExistingTask() async throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        let recorder = WorkspaceRequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(request, status: 409, body: #"{"error":"preset approval expired"}"#)
        }
        defer { session.invalidateAndCancel() }
        let model = WorkspaceModel(runtime: client, userDefaults: defaults)
        let task = try decode(ForgeTask.self, from: Self.taskJSON)
        model.tasks = [task]
        model.selectedTaskID = task.id

        model.runValidation(for: task, presetID: "swift-tests")

        XCTAssertTrue(model.isRunningValidation(taskID: task.id, presetID: "swift-tests"))
        let completed = await eventually {
            !model.isRunningValidation(taskID: task.id, presetID: "swift-tests")
        }
        XCTAssertTrue(completed)
        XCTAssertEqual(model.selectedTask, task)
        XCTAssertEqual(
            model.statusMessage,
            "Run validation failed: Runtime returned HTTP 409: preset approval expired"
        )
        XCTAssertEqual(recorder.paths, ["POST /api/tasks/task-1/run-validation"])
    }

    func testSelectedTaskAndRuntimeProcessEligibilityRemainDeterministic() throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        let (client, session) = makeClient { request in
            Self.response(request, status: 500, body: #"{"error":"unused"}"#)
        }
        defer { session.invalidateAndCancel() }
        let model = WorkspaceModel(runtime: client, userDefaults: defaults)
        let task = try decode(ForgeTask.self, from: Self.taskJSON)
        model.tasks = [task]
        model.selectedTaskID = task.id

        XCTAssertEqual(model.selectedTask, task)
        XCTAssertTrue(model.canStartRuntimeProcess)
        for state in [RuntimeProcessState.starting, .running, .external, .stopping] {
            model.runtimeProcessState = state
            XCTAssertFalse(model.canStartRuntimeProcess, "Expected \(state) to block another start.")
        }
        for state in [RuntimeProcessState.notStarted, .stopped, .failed] {
            model.runtimeProcessState = state
            XCTAssertTrue(model.canStartRuntimeProcess, "Expected \(state) to allow a start.")
        }

        model.selectedTaskID = nil
        XCTAssertNil(model.selectedTask)
        XCTAssertNil(defaults.string(forKey: "forge.selectedTaskID"))
    }

    func testSavedRepositoryRestoresRuntimeRecoveryEligibilityByDefault() throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        let repository = try makeTemporaryRepository()
        defaults.set(repository.path, forKey: "forge.selectedRepositoryRoot")
        let (client, session) = makeClient { request in
            Self.response(request, status: 503, body: #"{"error":"unused"}"#)
        }
        defer { session.invalidateAndCancel() }

        let model = WorkspaceModel(runtime: client, userDefaults: defaults)

        XCTAssertTrue(model.hasSelectedRepository)
        XCTAssertEqual(
            model.missionControlCurrentRepositoryPath?.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
            repository.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        )
        XCTAssertTrue(model.shouldStartManagedRuntimeAfterConnectionFailure)

        model.runtimeProcessState = .starting
        XCTAssertFalse(model.shouldStartManagedRuntimeAfterConnectionFailure)
        model.runtimeProcessState = .failed
        XCTAssertTrue(model.shouldStartManagedRuntimeAfterConnectionFailure)
    }

    func testDisabledReopenLastWorkspaceDoesNotRestoreSavedRepository() throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        let repository = try makeTemporaryRepository()
        defaults.set(repository.path, forKey: "forge.selectedRepositoryRoot")
        defaults.set(false, forKey: "forge.reopenLastWorkspace")
        let (client, session) = makeClient { request in
            Self.response(request, status: 503, body: #"{"error":"unused"}"#)
        }
        defer { session.invalidateAndCancel() }

        let model = WorkspaceModel(runtime: client, userDefaults: defaults)

        XCTAssertFalse(model.hasSelectedRepository)
        XCTAssertNil(model.missionControlCurrentRepositoryPath)
        XCTAssertFalse(model.shouldStartManagedRuntimeAfterConnectionFailure)
        XCTAssertEqual(defaults.string(forKey: "forge.selectedRepositoryRoot"), repository.path)
    }

    func testPullRequestRefreshPolicySelectsOldestOpenUnmergedTasksWithinLimit() throws {
        var older = try decode(ForgeTask.self, from: Self.taskJSON)
        older.id = "task-older"
        older.pullRequest = try pullRequest(lastCheckedAt: "2026-07-31T19:00:00Z")
        var newer = older
        newer.id = "task-newer"
        newer.pullRequest?.lastCheckedAt = "2026-07-31T20:00:00Z"
        var closed = older
        closed.id = "task-closed"
        closed.pullRequest?.state = "closed"
        var merged = older
        merged.id = "task-merged"
        merged.pullRequest?.merged = true

        let eligible = PullRequestRefreshPolicy.eligibleTasks(
            [newer, merged, closed, older],
            limit: 1
        )

        XCTAssertEqual(eligible.map(\.id), ["task-older"])
    }

    func testBackgroundPullRequestCycleIsBoundedAndMarksRequestSource() async throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        defaults.set(true, forKey: PullRequestBackgroundRefreshConfiguration.enabledKey)
        defaults.set(30, forKey: PullRequestBackgroundRefreshConfiguration.intervalMinutesKey)
        defaults.set(1, forKey: PullRequestBackgroundRefreshConfiguration.maxPullRequestsPerCycleKey)

        var older = try decode(ForgeTask.self, from: Self.taskJSON)
        older.id = "task-older"
        older.pullRequest = try pullRequest(lastCheckedAt: "2026-07-31T19:00:00Z")
        var newer = older
        newer.id = "task-newer"
        newer.pullRequest?.lastCheckedAt = "2026-07-31T20:00:00Z"
        let tasks = [newer, older]
        let taskEnvelope = String(data: try JSONEncoder().encode(TaskListEnvelopeForTest(tasks: tasks)), encoding: .utf8)!
        let refreshedPR = older.pullRequest!
        let result = GitPullRequestStatusResult(
            generatedAt: "2026-08-08T18:00:00Z",
            pullRequest: refreshedPR,
            summary: "Open and passing.",
            relatedTask: nil,
            source: "Background",
            requestCount: 3,
            changed: false
        )
        let resultJSON = String(data: try JSONEncoder().encode(result), encoding: .utf8)!
        let recorder = WorkspaceRequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            switch (request.httpMethod, request.url?.path) {
            case ("POST", "/api/git/pr-status"):
                return Self.response(request, status: 200, body: resultJSON)
            case ("GET", "/api/tasks"):
                return Self.response(request, status: 200, body: taskEnvelope)
            default:
                return Self.response(request, status: 404, body: #"{"error":"unexpected test route"}"#)
            }
        }
        defer { session.invalidateAndCancel() }
        let model = WorkspaceModel(
            runtime: client,
            userDefaults: defaults,
            githubTokenLoader: { "local-test-token" }
        )
        model.tasks = tasks

        await model.runPullRequestBackgroundRefreshCycle()

        XCTAssertEqual(recorder.paths.filter { $0 == "POST /api/git/pr-status" }.count, 1)
        let request = try XCTUnwrap(recorder.bodies.first)
        let decoded = try JSONDecoder().decode(GitPullRequestStatusRequest.self, from: Data(request.utf8))
        XCTAssertEqual(decoded.taskID, "task-older")
        XCTAssertEqual(decoded.source, "Background")
        XCTAssertEqual(decoded.githubToken, "local-test-token")
        XCTAssertEqual(model.pullRequestBackgroundRefreshState.phase, .waiting)
        XCTAssertEqual(model.pullRequestBackgroundRefreshState.attemptedCount, 1)
        XCTAssertEqual(model.pullRequestBackgroundRefreshState.succeededCount, 1)
        XCTAssertEqual(model.pullRequestBackgroundRefreshState.failedCount, 0)
    }

    func testBackgroundPullRequestCycleWithoutCredentialPerformsNoHTTPRequests() async throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        defaults.set(true, forKey: PullRequestBackgroundRefreshConfiguration.enabledKey)
        defaults.set(30, forKey: PullRequestBackgroundRefreshConfiguration.intervalMinutesKey)
        defaults.set(3, forKey: PullRequestBackgroundRefreshConfiguration.maxPullRequestsPerCycleKey)
        let recorder = WorkspaceRequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(request, status: 500, body: #"{"error":"must not be called"}"#)
        }
        defer { session.invalidateAndCancel() }
        let model = WorkspaceModel(
            runtime: client,
            userDefaults: defaults,
            githubTokenLoader: { nil }
        )
        var task = try decode(ForgeTask.self, from: Self.taskJSON)
        task.pullRequest = try pullRequest(lastCheckedAt: "2026-07-31T19:00:00Z")
        model.tasks = [task]

        await model.runPullRequestBackgroundRefreshCycle()

        XCTAssertTrue(recorder.paths.isEmpty)
        XCTAssertEqual(model.pullRequestBackgroundRefreshState.phase, .blocked)
        XCTAssertEqual(model.pullRequestBackgroundRefreshState.attemptedCount, 0)
        XCTAssertTrue(model.pullRequestBackgroundRefreshState.message.contains("Keychain"))
    }

    func testBackgroundPullRequestCycleStopsAndBlocksOnAuthenticationFailure() async throws {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        defaults.set(true, forKey: PullRequestBackgroundRefreshConfiguration.enabledKey)
        defaults.set(15, forKey: PullRequestBackgroundRefreshConfiguration.intervalMinutesKey)
        defaults.set(3, forKey: PullRequestBackgroundRefreshConfiguration.maxPullRequestsPerCycleKey)
        var first = try decode(ForgeTask.self, from: Self.taskJSON)
        first.id = "task-first"
        first.pullRequest = try pullRequest(lastCheckedAt: "2026-07-31T18:00:00Z")
        var second = first
        second.id = "task-second"
        second.pullRequest?.lastCheckedAt = "2026-07-31T19:00:00Z"
        let recorder = WorkspaceRequestRecorder()
        let taskEnvelope = String(
            data: try JSONEncoder().encode(TaskListEnvelopeForTest(tasks: [first, second])),
            encoding: .utf8
        )!
        let (client, session) = makeClient { request in
            recorder.record(request)
            if request.httpMethod == "GET" {
                return Self.response(request, status: 200, body: taskEnvelope)
            }
            return Self.response(request, status: 401, body: #"{"error":"bad credential"}"#)
        }
        defer { session.invalidateAndCancel() }
        let model = WorkspaceModel(
            runtime: client,
            userDefaults: defaults,
            githubTokenLoader: { "expired-token" }
        )
        model.tasks = [second, first]

        await model.runPullRequestBackgroundRefreshCycle()

        XCTAssertEqual(recorder.paths.filter { $0 == "POST /api/git/pr-status" }.count, 1)
        XCTAssertEqual(model.pullRequestBackgroundRefreshState.phase, .blocked)
        XCTAssertEqual(model.pullRequestBackgroundRefreshState.attemptedCount, 1)
        XCTAssertEqual(model.pullRequestBackgroundRefreshState.failedCount, 1)
        XCTAssertTrue(model.pullRequestBackgroundRefreshState.message.contains("rejected"))
    }

    func testMissionControlFairQueueLimitPersistsAndNormalizes() {
        let defaults = makeUserDefaults()
        defer { clear(defaults) }
        let model = WorkspaceModel(userDefaults: defaults, githubTokenLoader: { nil })

        model.setMissionControlFairQueueConcurrencyLimit(2)

        XCTAssertEqual(model.missionControlFairQueueState.concurrencyLimit, 2)
        let restored = WorkspaceModel(userDefaults: defaults, githubTokenLoader: { nil })
        XCTAssertEqual(restored.missionControlFairQueueState.concurrencyLimit, 2)

        restored.setMissionControlFairQueueConcurrencyLimit(99)
        XCTAssertEqual(restored.missionControlFairQueueState.concurrencyLimit, 2)
    }

    private func makeClient(
        handler: @escaping WorkspaceMockURLProtocol.Handler
    ) -> (RuntimeClient, URLSession) {
        WorkspaceMockURLProtocol.install(handler)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [WorkspaceMockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        return (
            RuntimeClient(baseURL: URL(string: "https://forge.test/api")!, session: session),
            session
        )
    }

    private func makeUserDefaults() -> UserDefaults {
        let name = "WorkspaceModelTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.set(name, forKey: "WorkspaceModelTests.suiteName")
        return defaults
    }

    private func makeTemporaryRepository() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ForgeWorkspaceModelTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("# Test repository\n".utf8)
            .write(to: root.appendingPathComponent("README.md"), options: .atomic)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: root)
        }
        return root.standardizedFileURL
    }

    private func clear(_ defaults: UserDefaults) {
        guard let name = defaults.string(forKey: "WorkspaceModelTests.suiteName") else {
            return
        }
        defaults.removePersistentDomain(forName: name)
    }

    private func eventually(
        attempts: Int = 200,
        condition: @MainActor () -> Bool
    ) async -> Bool {
        for _ in 0..<attempts {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condition()
    }

    private func decode<T: Decodable>(_ type: T.Type, from json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    private func pullRequest(lastCheckedAt: String) throws -> TaskPullRequest {
        var pullRequest = try decode(TaskPullRequest.self, from: Self.pullRequestJSON)
        pullRequest.lastCheckedAt = lastCheckedAt
        return pullRequest
    }

    nonisolated private static func response(
        _ request: URLRequest,
        status: Int,
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

    nonisolated private static let healthJSON = """
    {
      "ok":true,"service":"forge-runtime","version":"0.1.0","uptimeSeconds":12.5,
      "runtimeMode":"active","readOnly":false,
      "workspace":{"runtimeDir":"/tmp/runtime","repoRoot":"/tmp/forge-tests","repoRootSource":"test"},
      "persistence":{"databasePath":"/tmp/forge.sqlite","taskCount":0},
      "index":{"fileCount":12,"lastIndexedAt":"2026-07-31T20:00:00Z","inSync":true}
    }
    """

    nonisolated private static let modelProviderSettingsJSON = """
    {
      "configuration":{
        "provider":{"id":"local","name":"Local Deterministic","model":"local-v0","mode":"local"},
        "configuredProviderID":"local","status":"Ready","summary":"Ready for local work.",
        "issues":[],"settings":[],"sendsRemoteContext":false,"remoteContextSummary":null
      },
      "editableSettings":{
        "providerID":"local","modelName":"local-v0","openAIBaseURL":null,
        "openAITimeoutMs":null,"openAIMaxOutputTokens":null,"hasOpenAIAPIKey":false,
        "settingsPath":"/tmp/model-provider-settings.json"
      }
    }
    """

    nonisolated private static let queueJSON = """
    {
      "generatedAt":"2026-07-31T20:00:00Z","concurrencyLimit":2,"effectiveRepositoryLimit":1,
      "running":[],"queued":[],"needsAttention":[],"completed":[],
      "summary":"Queue empty.","operationBoundary":"One active loop per repository."
    }
    """

    nonisolated private static let validationPresetsJSON = """
    {
      "presets":[{
        "id":"swift-tests","name":"Swift tests","description":"Run Swift tests.",
        "source":"built-in","riskLevel":"Medium","requiresApproval":true,"commands":[]
      }],
      "workspaceConfig":{"path":"/tmp/.forge/validation-presets.json","exists":false,"issues":[]}
    }
    """

    nonisolated private static let gitStatusJSON = """
    {
      "isRepository":true,"root":"/tmp/forge-tests","branch":"codex/tests","upstream":null,
      "repositoryWebURL":"https://github.com/acme/forge","head":"abc123","ahead":0,"behind":0,
      "isDirty":false,"summary":"Working tree clean.","generatedAt":"2026-07-31T20:00:00Z",
      "changedFiles":[],"error":null
    }
    """

    nonisolated private static let validationPermissionsJSON = """
    {
      "taskID":"task-1","taskStatus":"Human Review","currentPhase":"Plan Review",
      "permissions":[],"taskCommands":[]
    }
    """

    nonisolated private static let taskJSON = """
    {
      "id":"task-1","title":"Coverage","objective":"Test WorkspaceModel",
      "status":"Human Review","currentPhase":"Plan Review",
      "createdAt":"2026-07-31T20:00:00Z","updatedAt":"2026-07-31T20:01:00Z",
      "agentStates":[],"planSteps":[],"events":[],"approvals":[],"toolCalls":[],
      "agentRunLoops":[],"agentRunSteps":[],"taskCommandRuns":[],"commandRerunEvidence":[],
      "validationRuns":[],"validationRepairBriefs":[],"messages":[],"planRevisions":[],
      "editProposalRevisions":[],"contextFiles":[],"changedFiles":[],
      "queueRequest":null,"pullRequest":null
    }
    """

    nonisolated private static let pullRequestJSON = """
    {
      "number":42,"url":"https://github.com/acme/forge/pull/42","state":"open",
      "merged":false,"draft":false,"owner":"acme","repo":"forge",
      "baseBranch":"main","headBranch":"codex/tests","headOwner":"contributor",
      "baseRemote":"upstream","headRemote":"origin","forkDetected":true,
      "openedAt":"2026-07-31T18:00:00Z","lastCheckedAt":"2026-07-31T19:00:00Z"
    }
    """
}

private struct TaskListEnvelopeForTest: Encodable {
    var tasks: [ForgeTask]
}

private final class WorkspaceRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []
    private var bodyValues: [String] = []

    var paths: [String] {
        lock.withLock { values }
    }

    var bodies: [String] {
        lock.withLock { bodyValues }
    }

    func record(_ request: URLRequest) {
        let capturedBody = request.httpBody ?? readBody(from: request.httpBodyStream)
        lock.withLock {
            values.append("\(request.httpMethod ?? "GET") \(request.url?.path ?? "")")
            if let body = capturedBody, let value = String(data: body, encoding: .utf8) {
                bodyValues.append(value)
            }
        }
    }

    private func readBody(from stream: InputStream?) -> Data? {
        guard let stream else { return nil }
        stream.open()
        defer { stream.close() }
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4_096)
        defer { buffer.deallocate() }
        var data = Data()
        while true {
            let count = stream.read(buffer, maxLength: 4_096)
            if count < 0 { return nil }
            if count == 0 { return data }
            data.append(buffer, count: count)
        }
    }
}

private final class WorkspaceMockURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) throws -> (URLResponse, Data)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: Handler?

    static func install(_ handler: @escaping Handler) {
        lock.withLock { self.handler = handler }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.lock.withLock({ Self.handler }) else {
            client?.urlProtocol(self, didFailWithError: RuntimeClientError.invalidResponse)
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
