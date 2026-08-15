import Foundation

enum MissionControlRuntimeAccessRequirement: Equatable {
    case readOnlyOrAuthorized
    case authorizedMutation
}

struct MissionControlRuntimeAccessExpectation: Equatable {
    var repositoryPath: String
    var runtimeMode: String
    var authorizationID: String?
    var requirement: MissionControlRuntimeAccessRequirement
    var requiresSupervisedQueueDispatch = false
}

enum MissionControlRuntimeAccessPolicy {
    static func validate(
        health: RuntimeHealth,
        expectation: MissionControlRuntimeAccessExpectation
    ) throws {
        guard health.workspace?.repoRoot == expectation.repositoryPath else {
            throw MissionControlSupervisorError.wrongRepository
        }
        guard health.runtimeMode == expectation.runtimeMode else {
            throw MissionControlSupervisorError.wrongRuntimeMode(
                expected: expectation.runtimeMode == "observer" ? "observer/read-only" : "primary/read-write"
            )
        }

        switch expectation.runtimeMode {
        case "observer":
            guard health.readOnly == true else {
                throw MissionControlSupervisorError.wrongRuntimeMode(expected: "observer/read-only")
            }
            guard expectation.requirement == .readOnlyOrAuthorized else {
                throw MissionControlSupervisorError.activeAuthorizationRequired
            }
        case "primary":
            guard health.readOnly == false else {
                throw MissionControlSupervisorError.wrongRuntimeMode(expected: "primary/read-write")
            }
            guard let authorizationID = expectation.authorizationID,
                  health.runtimeAuthorization?.id == authorizationID,
                  health.runtimeAuthorization?.scope == "repository-active"
            else {
                throw MissionControlSupervisorError.wrongAuthorization
            }
        default:
            throw MissionControlSupervisorError.wrongRuntimeMode(expected: expectation.runtimeMode)
        }
        if expectation.requiresSupervisedQueueDispatch {
            guard health.queueDispatch?.mode == "supervised",
                  health.queueDispatch?.acceptsSupervisorGrants == true
            else {
                throw MissionControlSupervisorError.unsupervisedQueueDispatch
            }
        }
    }
}

struct MissionControlObservedRepository: Hashable {
    var path: String
    var port: Int
    var processID: Int32?
    var status: String
    var error: String?
    var health: RuntimeHealth?
    var tasks: [ForgeTask]
    var queue: TaskQueueSnapshot?
    var gitStatus: GitStatusSnapshot?
    var refreshedAt: Date?
    var reconnectTelemetry: MissionControlReconnectTelemetry? = nil
}

@MainActor
final class MissionControlRuntimeSupervisor {
    struct Configuration: Sendable {
        var portBase = 17_374
        var monitorInterval: Duration = .seconds(2)
        var reconnectDelaySchedule: [TimeInterval] = [2, 4, 8, 16, 30]
    }

    var onUpdate: (([String: MissionControlObservedRepository]) -> Void)?
    var onFairQueueUpdate: ((MissionControlFairQueueState) -> Void)?

    private struct ManagedRuntime {
        var process: Process
        var port: Int
        var mode: RuntimeMode
        var authorizationID: String?
    }

    private struct PendingRuntime {
        var port: Int
        var mode: RuntimeMode
        var runtimeDirectory: URL
        var authorization: ActiveAuthorization?
    }

    private struct ActiveAuthorization {
        var id: String
        var authorizedAt: String
    }

    private enum RuntimeMode: String {
        case observer
        case active
    }

    private var managed: [String: ManagedRuntime] = [:]
    private var snapshots: [String: MissionControlObservedRepository] = [:]
    private var pendingRuntimes: [String: PendingRuntime] = [:]
    private var restartTargets: [String: PendingRuntime] = [:]
    private var reconnectTelemetry: [String: MissionControlReconnectTelemetry] = [:]
    private var activeAuthorizations: [String: ActiveAuthorization] = [:]
    private var inFlightRouteKeys = Set<String>()
    private var refreshInProgress = false
    private var fairQueueConcurrencyLimit = 1
    private var lastGrantedRepositoryPath: String?
    private var fairQueueGrantCount = 0
    private var fairQueueDispatchInProgress = false
    private var monitorTask: Task<Void, Never>?
    private let configuration: Configuration

    init(configuration: Configuration = Configuration()) {
        self.configuration = configuration
    }

    deinit {
        monitorTask?.cancel()
        for runtime in managed.values where runtime.process.isRunning {
            runtime.process.terminate()
        }
    }

    func synchronize(repositoryPaths: [String], currentPath: String?, runtimeDirectory: URL?) {
        let observedPaths = Array(repositoryPaths.filter { $0 != currentPath }.prefix(2))
        activeAuthorizations = activeAuthorizations.filter { observedPaths.contains($0.key) }
        let desired = Dictionary(uniqueKeysWithValues: observedPaths.enumerated().map { index, path in
            (path, (
                port: configuration.portBase + index,
                mode: activeAuthorizations[path] == nil ? RuntimeMode.observer : .active,
                authorization: activeAuthorizations[path]
            ))
        })

        let stalePaths = managed.keys.filter { desired[$0] == nil }
        for path in stalePaths {
            managed[path]?.process.terminate()
            managed.removeValue(forKey: path)
            pendingRuntimes.removeValue(forKey: path)
            restartTargets.removeValue(forKey: path)
            reconnectTelemetry.removeValue(forKey: path)
            snapshots.removeValue(forKey: path)
        }

        guard let runtimeDirectory else {
            for path in observedPaths {
                restartTargets.removeValue(forKey: path)
                snapshots[path] = MissionControlObservedRepository(
                    path: path,
                    port: desired[path]?.port ?? 0,
                    status: "UNAVAILABLE",
                    error: "Runtime installation could not be resolved.",
                    tasks: []
                )
            }
            publish()
            return
        }

        for path in observedPaths {
            guard let target = desired[path] else { continue }
            let pendingTarget = PendingRuntime(
                port: target.port,
                mode: target.mode,
                runtimeDirectory: runtimeDirectory,
                authorization: target.authorization
            )
            restartTargets[path] = pendingTarget
            if let running = managed[path],
               running.port == target.port,
               running.mode == target.mode,
               running.authorizationID == target.authorization?.id {
                continue
            }
            transition(
                path: path,
                to: pendingTarget,
                resetBackoff: false
            )
        }

        if observedPaths.isEmpty {
            monitorTask?.cancel()
            monitorTask = nil
        } else if monitorTask == nil {
            monitorTask = Task { [weak self] in
                while !Task.isCancelled {
                    self?.restartDueRuntimes()
                    await self?.refreshAll()
                    try? await Task.sleep(for: self?.configuration.monitorInterval ?? .seconds(2))
                }
            }
        }
        publish()
    }

    func setActiveAuthorization(path: String, isActive: Bool, runtimeDirectory: URL?) {
        guard !inFlightRouteKeys.contains("mutation:\(path)") else {
            snapshots[path]?.error = "Wait for the current scoped action to finish before changing runtime access."
            publish()
            return
        }
        if isActive {
            if activeAuthorizations[path] == nil {
                activeAuthorizations[path] = ActiveAuthorization(
                    id: UUID().uuidString.lowercased(),
                    authorizedAt: ISO8601DateFormatter().string(from: Date())
                )
            }
        } else {
            activeAuthorizations.removeValue(forKey: path)
        }
        guard let runtimeDirectory else {
            restartTargets.removeValue(forKey: path)
            if isActive {
                activeAuthorizations.removeValue(forKey: path)
                snapshots[path]?.status = "UNAVAILABLE"
                snapshots[path]?.error = "Runtime installation could not be resolved. Active access was not granted."
            } else if let runtime = managed.removeValue(forKey: path) {
                pendingRuntimes.removeValue(forKey: path)
                snapshots[path]?.processID = nil
                snapshots[path]?.status = "STOPPED"
                snapshots[path]?.error = "Active runtime stopped, but the read-only runtime installation could not be resolved."
                if runtime.process.isRunning {
                    runtime.process.terminate()
                }
            }
            publish()
            return
        }
        guard let port = managed[path]?.port ?? pendingRuntimes[path]?.port ?? snapshots[path]?.port else {
            restartTargets.removeValue(forKey: path)
            if isActive {
                activeAuthorizations.removeValue(forKey: path)
            }
            snapshots[path]?.status = "UNAVAILABLE"
            snapshots[path]?.error = "Repository is not registered with the Mission Control supervisor."
            publish()
            return
        }
        transition(path: path, to: PendingRuntime(
            port: port,
            mode: isActive ? .active : .observer,
            runtimeDirectory: runtimeDirectory,
            authorization: activeAuthorizations[path]
        ))
    }

    func setFairQueueConcurrencyLimit(_ limit: Int) {
        fairQueueConcurrencyLimit = min(max(limit, 1), 2)
        publish()
        Task { [weak self] in
            await self?.reconcileFairQueue()
        }
    }

    func pauseAllActiveLoops() async -> (requested: Int, failed: Int) {
        let activeRuntimes = managed.filter { $0.value.mode == .active }
        var requested = 0
        var failed = 0
        for path in activeRuntimes.keys {
            let runningLoops = (snapshots[path]?.tasks ?? []).compactMap { task -> (ForgeTask.ID, AgentRunLoop.ID)? in
                guard let loop = task.agentRunLoops.last(where: { $0.status == "Running" }) else { return nil }
                return (task.id, loop.id)
            }
            do {
                let pathResult = try await withRouteRequest(key: "mutation:\(path)") {
                    let client = try await validatedClient(path: path, requireActive: true)
                    var pathFailures = 0
                    for (taskID, loopID) in runningLoops {
                        do {
                            _ = try await client.pauseAgentLoop(
                                taskID: taskID,
                                loopID: loopID,
                                note: "Pause All from Mission Control"
                            )
                        } catch {
                            pathFailures += 1
                            snapshots[path]?.error = "Pause failed: \(error.localizedDescription)"
                        }
                    }
                    return pathFailures
                }
                requested += runningLoops.count
                failed += pathResult
            } catch {
                requested += runningLoops.count
                failed += runningLoops.count
                snapshots[path]?.error = "Pause blocked: \(error.localizedDescription)"
            }
        }
        await refreshAll()
        return (requested, failed)
    }

    func task(path: String, taskID: ForgeTask.ID) async throws -> ForgeTask {
        let key = "detail:\(path):\(taskID)"
        return try await withRouteRequest(key: key) {
            let client = try await validatedClient(path: path, requireActive: false)
            let task = try await client.task(taskID: taskID)
            upsert(task, for: path)
            publish()
            return task
        }
    }

    func routedEvidence(path: String, taskID: ForgeTask.ID) async throws -> MissionControlRoutedEvidence {
        try await withRouteRequest(key: "evidence:\(path):\(taskID)") {
            let client = try await validatedClient(path: path, requireActive: false)
            async let validation = client.validationPermissions(taskID: taskID)
            async let status = client.gitStatus()
            async let commit = client.gitCommitPreview(taskID: taskID)
            async let branch = client.gitBranchPreview(taskID: taskID)
            async let branchPublish = client.gitBranchPublishPreview(taskID: taskID)
            async let push = client.gitPushPreview(taskID: taskID)
            async let pullRequest = client.gitPullRequestPreview(taskID: taskID)
            return try await MissionControlRoutedEvidence(
                validation: validation,
                git: MissionControlGitReviewEvidence(
                    status: status,
                    commit: commit,
                    branch: branch,
                    branchPublish: branchPublish,
                    push: push,
                    pullRequest: pullRequest
                )
            )
        }
    }

    func gitFileDiff(path: String, taskID: ForgeTask.ID, filePath: String) async throws -> GitFileDiff {
        try await withRouteRequest(key: "git-diff:\(path):\(taskID):\(filePath)") {
            let client = try await validatedClient(path: path, requireActive: false)
            return try await client.gitFileDiff(path: filePath)
        }
    }

    func createTask(path: String, title: String, objective: String) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.createTask(title: title, objective: objective)
        }
    }

    func sendTaskMessage(path: String, taskID: ForgeTask.ID, content: String) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.sendTaskMessage(taskID: taskID, content: content)
        }
    }

    func generatePlanRevision(path: String, taskID: ForgeTask.ID) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.generatePlanRevision(taskID: taskID)
        }
    }

    func approvePlanAndRun(path: String, taskID: ForgeTask.ID, maxSteps: Int = 6) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.approvePlanAndRun(taskID: taskID, note: "Approved from Mission Control", maxSteps: maxSteps)
        }
    }

    func reviewEditProposalFile(
        path: String,
        taskID: ForgeTask.ID,
        fileChangeID: String,
        decision: String,
        note: String? = nil
    ) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.reviewEditProposalFile(
                taskID: taskID,
                fileChangeID: fileChangeID,
                decision: decision,
                note: note
            )
        }
    }

    func applyEditProposal(path: String, taskID: ForgeTask.ID) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.applyEditProposal(taskID: taskID, note: "Applied from Mission Control review")
        }
    }

    func runValidation(path: String, taskID: ForgeTask.ID) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.runValidation(taskID: taskID)
        }
    }

    func runValidation(
        path: String,
        taskID: ForgeTask.ID,
        presetID: ValidationPreset.ID
    ) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.runValidation(taskID: taskID, presetID: presetID)
        }
    }

    func approveValidationPreset(
        path: String,
        taskID: ForgeTask.ID,
        presetID: ValidationPreset.ID
    ) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.approveValidationPreset(
                taskID: taskID,
                presetID: presetID,
                note: "Approved from Mission Control command review"
            )
        }
    }

    func revokeValidationPresetApproval(
        path: String,
        taskID: ForgeTask.ID,
        presetID: ValidationPreset.ID
    ) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.revokeValidationPresetApproval(
                taskID: taskID,
                presetID: presetID,
                note: "Revoked from Mission Control command review"
            )
        }
    }

    func runTaskCommand(
        path: String,
        taskID: ForgeTask.ID,
        commandID: String
    ) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.runTaskCommand(taskID: taskID, commandID: commandID)
        }
    }

    func cancelTaskCommand(
        path: String,
        taskID: ForgeTask.ID,
        taskCommandRunID: TaskCommandRun.ID
    ) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.cancelTaskCommand(
                taskID: taskID,
                taskCommandRunID: taskCommandRunID,
                note: "Cancelled from Mission Control command review"
            )
        }
    }

    func rerunRepairCommand(
        path: String,
        taskID: ForgeTask.ID,
        evidenceID: CommandRerunEvidence.ID
    ) async throws -> ForgeTask {
        try await mutate(path: path) { client in
            try await client.rerunRepairCommand(
                taskID: taskID,
                commandRerunEvidenceID: evidenceID
            )
        }
    }

    func createGitCommit(
        path: String,
        request: GitCreateCommitRequest
    ) async throws -> GitCreateCommitResult {
        try await mutateRepository(path: path) { client in
            try await client.createGitCommit(request)
        }
    }

    func createOrSwitchGitBranch(
        path: String,
        request: GitBranchRequest
    ) async throws -> GitBranchResult {
        try await mutateRepository(path: path) { client in
            try await client.createOrSwitchGitBranch(request)
        }
    }

    func publishGitBranch(
        path: String,
        request: GitBranchPublishRequest
    ) async throws -> GitBranchPublishResult {
        try await mutateRepository(path: path) { client in
            try await client.publishGitBranch(request)
        }
    }

    func pushGitBranch(
        path: String,
        request: GitPushRequest
    ) async throws -> GitPushResult {
        try await mutateRepository(path: path) { client in
            try await client.pushGitBranch(request)
        }
    }

    func stopAll() {
        monitorTask?.cancel()
        monitorTask = nil
        for runtime in managed.values where runtime.process.isRunning {
            runtime.process.terminate()
        }
        managed.removeAll()
        pendingRuntimes.removeAll()
        restartTargets.removeAll()
        reconnectTelemetry.removeAll()
        activeAuthorizations.removeAll()
        inFlightRouteKeys.removeAll()
        snapshots.removeAll()
        publish()
    }

    private func transition(
        path: String,
        to target: PendingRuntime,
        resetBackoff: Bool = true
    ) {
        restartTargets[path] = target
        if resetBackoff {
            reconnectTelemetry[path] = MissionControlReconnectPolicy.clearingBackoff(
                reconnectTelemetry[path]
            )
        } else if !MissionControlReconnectPolicy.isRetryDue(reconnectTelemetry[path], at: Date()),
                  managed[path] == nil {
            snapshots[path]?.reconnectTelemetry = reconnectTelemetry[path]
            publish()
            return
        }
        if let runtime = managed[path], runtime.process.isRunning {
            pendingRuntimes[path] = target
            snapshots[path]?.status = target.mode == .active ? "AUTHORIZING" : "RETURNING READ-ONLY"
            snapshots[path]?.error = nil
            runtime.process.terminate()
            return
        }
        managed.removeValue(forKey: path)
        pendingRuntimes.removeValue(forKey: path)
        startRuntime(
            path: path,
            target: target,
            isReconnectAttempt: (reconnectTelemetry[path]?.consecutiveFailures ?? 0) > 0
        )
    }

    private func startRuntime(
        path: String,
        target: PendingRuntime,
        isReconnectAttempt: Bool = false
    ) {
        let port = target.port
        let runtimeDirectory = target.runtimeDirectory
        let server = runtimeDirectory.appendingPathComponent("dist/server.js")
        guard FileManager.default.fileExists(atPath: server.path) else {
            let telemetry = recordReconnectFailure(
                path: path,
                summary: "Mission Control runtime is not built at \(server.path)."
            )
            snapshots[path] = MissionControlObservedRepository(
                path: path,
                port: port,
                status: "UNAVAILABLE",
                error: "Mission Control runtime is not built at \(server.path).",
                tasks: [],
                reconnectTelemetry: telemetry
            )
            return
        }

        if isReconnectAttempt {
            let telemetry = MissionControlReconnectPolicy.recordingRestartAttempt(
                reconnectTelemetry[path]
            )
            reconnectTelemetry[path] = telemetry
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
        process.currentDirectoryURL = runtimeDirectory
        var environment = ProcessInfo.processInfo.environment
        environment["FORGE_RUNTIME_MODE"] = target.mode == .observer ? "observer" : "primary"
        environment["FORGE_RUNTIME_PORT"] = String(port)
        environment["FORGE_REPO_ROOT"] = path
        environment["FORGE_MODEL_PROVIDER"] = "local"
        environment["FORGE_MODEL_PROVIDER_LOCK"] = "local"
        if target.mode == .active {
            environment["FORGE_QUEUE_DISPATCH_MODE"] = "supervised"
        } else {
            environment.removeValue(forKey: "FORGE_QUEUE_DISPATCH_MODE")
        }
        environment.removeValue(forKey: "OPENAI_API_KEY")
        environment.removeValue(forKey: "FORGE_MODEL_NAME")
        environment.removeValue(forKey: "FORGE_OPENAI_BASE_URL")
        if let authorization = target.authorization, target.mode == .active {
            environment["FORGE_RUNTIME_AUTHORIZATION_ID"] = authorization.id
            environment["FORGE_RUNTIME_AUTHORIZED_AT"] = authorization.authorizedAt
        } else {
            environment.removeValue(forKey: "FORGE_RUNTIME_AUTHORIZATION_ID")
            environment.removeValue(forKey: "FORGE_RUNTIME_AUTHORIZED_AT")
        }
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] terminated in
            Task { @MainActor [weak self] in
                self?.handleTermination(path: path, processID: terminated.processIdentifier, status: terminated.terminationStatus)
            }
        }

        snapshots[path] = MissionControlObservedRepository(
            path: path,
            port: port,
            status: isReconnectAttempt
                ? "RECONNECTING"
                : (target.mode == .observer ? "STARTING" : "AUTHORIZING"),
            tasks: [],
            reconnectTelemetry: reconnectTelemetry[path]
        )
        do {
            try process.run()
            managed[path] = ManagedRuntime(
                process: process,
                port: port,
                mode: target.mode,
                authorizationID: target.authorization?.id
            )
            snapshots[path]?.processID = process.processIdentifier
            snapshots[path]?.status = target.mode == .observer ? "CONNECTING" : "ACTIVATING"
        } catch {
            let telemetry = recordReconnectFailure(path: path, summary: error.localizedDescription)
            snapshots[path]?.status = "RETRY WAIT"
            snapshots[path]?.error = error.localizedDescription
            snapshots[path]?.reconnectTelemetry = telemetry
        }
    }

    private func restartDueRuntimes(at now: Date = Date()) {
        for path in restartTargets.keys.sorted() {
            guard managed[path] == nil,
                  pendingRuntimes[path] == nil,
                  let target = restartTargets[path],
                  (reconnectTelemetry[path]?.consecutiveFailures ?? 0) > 0,
                  MissionControlReconnectPolicy.isRetryDue(reconnectTelemetry[path], at: now)
            else { continue }
            startRuntime(path: path, target: target, isReconnectAttempt: true)
        }
    }

    @discardableResult
    private func recordReconnectFailure(
        path: String,
        summary: String,
        at now: Date = Date()
    ) -> MissionControlReconnectTelemetry {
        let telemetry = MissionControlReconnectPolicy.recordingFailure(
            reconnectTelemetry[path],
            at: now,
            summary: summary,
            delaySchedule: configuration.reconnectDelaySchedule
        )
        reconnectTelemetry[path] = telemetry
        snapshots[path]?.reconnectTelemetry = telemetry
        return telemetry
    }

    @discardableResult
    private func recordReconnectSuccess(
        path: String,
        at now: Date = Date()
    ) -> MissionControlReconnectTelemetry {
        let telemetry = MissionControlReconnectPolicy.recordingSuccess(
            reconnectTelemetry[path],
            at: now
        )
        reconnectTelemetry[path] = telemetry
        snapshots[path]?.reconnectTelemetry = telemetry
        return telemetry
    }

    private func refreshAll() async {
        guard !refreshInProgress else { return }
        refreshInProgress = true
        defer { refreshInProgress = false }
        let runtimes = managed
        for (path, runtime) in runtimes {
            guard runtime.process.isRunning,
                  let baseURL = URL(string: "http://127.0.0.1:\(runtime.port)") else { continue }
            guard MissionControlReconnectPolicy.isRetryDue(reconnectTelemetry[path], at: Date()) else {
                snapshots[path]?.status = "RETRY WAIT"
                snapshots[path]?.reconnectTelemetry = reconnectTelemetry[path]
                continue
            }
            let client = RuntimeClient(baseURL: baseURL)
            do {
                async let health = client.health()
                async let tasks = client.listTasks()
                async let queue = client.taskQueue()
                async let gitStatus = client.gitStatus()
                let values = try await (health, tasks, queue, gitStatus)
                try MissionControlRuntimeAccessPolicy.validate(
                    health: values.0,
                    expectation: accessExpectation(path: path, runtime: runtime, requireActive: false)
                )
                let telemetry = recordReconnectSuccess(path: path)
                let mergedTasks = mergeTasks(values.1, preservingNewerFrom: snapshots[path]?.tasks ?? [])
                snapshots[path] = MissionControlObservedRepository(
                    path: path,
                    port: runtime.port,
                    processID: runtime.process.processIdentifier,
                    status: runtime.mode == .observer ? "LIVE OBSERVER" : "ACTIVE RUNTIME",
                    error: nil,
                    health: values.0,
                    tasks: mergedTasks,
                    queue: values.2,
                    gitStatus: values.3,
                    refreshedAt: Date(),
                    reconnectTelemetry: telemetry
                )
            } catch {
                if let supervisorError = error as? MissionControlSupervisorError {
                    invalidateRuntime(path: path, runtime: runtime, error: supervisorError)
                } else {
                    let telemetry = recordReconnectFailure(path: path, summary: error.localizedDescription)
                    snapshots[path]?.status = runtime.process.isRunning ? "RETRY WAIT" : "STOPPED"
                    snapshots[path]?.error = error.localizedDescription
                    snapshots[path]?.reconnectTelemetry = telemetry
                }
            }
        }
        await reconcileFairQueue()
        publish()
    }

    private func reconcileFairQueue() async {
        guard !fairQueueDispatchInProgress else { return }
        fairQueueDispatchInProgress = true
        publish()
        defer {
            fairQueueDispatchInProgress = false
            publish()
        }

        for _ in 0..<2 {
            let repositories = fairQueueRepositories()
            guard let path = MissionControlFairQueueScheduler.nextRepository(
                from: repositories,
                concurrencyLimit: fairQueueConcurrencyLimit,
                lastGrantedPath: lastGrantedRepositoryPath
            ),
                  let runtime = managed[path],
                  runtime.mode == .active,
                  let authorizationID = runtime.authorizationID
            else { return }

            do {
                let client = try await validatedClient(path: path, requireActive: true)
                let result = try await client.dispatchNextQueuedAgentRun(authorizationID: authorizationID)
                snapshots[path]?.queue = result.queue
                guard result.accepted else { return }
                lastGrantedRepositoryPath = path
                fairQueueGrantCount += 1
            } catch {
                snapshots[path]?.error = "Fair queue grant failed: \(error.localizedDescription)"
                if let supervisorError = error as? MissionControlSupervisorError {
                    invalidateRuntime(path: path, runtime: runtime, error: supervisorError)
                }
                return
            }
        }
    }

    private func fairQueueRepositories() -> [MissionControlFairQueueRepository] {
        managed.map { path, runtime in
            let snapshot = snapshots[path]
            return MissionControlFairQueueRepository(
                path: path,
                isAuthorized: runtime.mode == .active && activeAuthorizations[path]?.id == runtime.authorizationID,
                isLive: runtime.process.isRunning && snapshot?.status == "ACTIVE RUNTIME",
                dispatchMode: snapshot?.queue?.dispatchMode ?? snapshot?.health?.queueDispatch?.mode,
                runningCount: snapshot?.queue?.running.count ?? 0,
                queuedCount: snapshot?.queue?.queued.count ?? 0,
                oldestEnqueuedAt: snapshot?.queue?.queued.compactMap(\.enqueuedAt).sorted().first
            )
        }
    }

    private func fairQueueState() -> MissionControlFairQueueState {
        MissionControlFairQueueScheduler.state(
            repositories: fairQueueRepositories(),
            concurrencyLimit: fairQueueConcurrencyLimit,
            lastGrantedPath: lastGrantedRepositoryPath,
            grantCount: fairQueueGrantCount,
            isDispatching: fairQueueDispatchInProgress
        )
    }

    private func mutate(
        path: String,
        operation: (RuntimeClient) async throws -> ForgeTask
    ) async throws -> ForgeTask {
        try await withRouteRequest(key: "mutation:\(path)") {
            let client = try await validatedClient(path: path, requireActive: true)
            let task = try await operation(client)
            upsert(task, for: path)
            publish()
            return task
        }
    }

    private func mutateRepository<Result>(
        path: String,
        operation: @MainActor (RuntimeClient) async throws -> Result
    ) async throws -> Result {
        try await withRouteRequest(key: "mutation:\(path)") {
            let client = try await validatedClient(path: path, requireActive: true)
            let result = try await operation(client)
            publish()
            return result
        }
    }

    private func withRouteRequest<T>(
        key: String,
        operation: @MainActor () async throws -> T
    ) async throws -> T {
        guard inFlightRouteKeys.insert(key).inserted else {
            throw MissionControlSupervisorError.requestAlreadyInFlight
        }
        defer { inFlightRouteKeys.remove(key) }
        return try await operation()
    }

    private func validatedClient(path: String, requireActive: Bool) async throws -> RuntimeClient {
        guard let runtime = managed[path], runtime.process.isRunning,
              let baseURL = URL(string: "http://127.0.0.1:\(runtime.port)")
        else {
            throw MissionControlSupervisorError.runtimeUnavailable
        }
        if requireActive && runtime.mode != .active {
            throw MissionControlSupervisorError.activeAuthorizationRequired
        }
        if runtime.mode == .active {
            guard let expected = activeAuthorizations[path], expected.id == runtime.authorizationID else {
                let error = MissionControlSupervisorError.wrongAuthorization
                invalidateRuntime(path: path, runtime: runtime, error: error)
                throw error
            }
        }

        let client = RuntimeClient(baseURL: baseURL)
        let health: RuntimeHealth
        do {
            health = try await client.health()
        } catch {
            let telemetry = recordReconnectFailure(path: path, summary: error.localizedDescription)
            snapshots[path]?.status = "RETRY WAIT"
            snapshots[path]?.error = error.localizedDescription
            snapshots[path]?.reconnectTelemetry = telemetry
            publish()
            throw error
        }
        do {
            try MissionControlRuntimeAccessPolicy.validate(
                health: health,
                expectation: accessExpectation(path: path, runtime: runtime, requireActive: requireActive)
            )
        } catch let error as MissionControlSupervisorError {
            invalidateRuntime(path: path, runtime: runtime, error: error)
            throw error
        }
        _ = recordReconnectSuccess(path: path)
        return client
    }

    private func accessExpectation(
        path: String,
        runtime: ManagedRuntime,
        requireActive: Bool
    ) -> MissionControlRuntimeAccessExpectation {
        MissionControlRuntimeAccessExpectation(
            repositoryPath: path,
            runtimeMode: runtime.mode == .observer ? "observer" : "primary",
            authorizationID: runtime.authorizationID,
            requirement: requireActive ? .authorizedMutation : .readOnlyOrAuthorized,
            requiresSupervisedQueueDispatch: runtime.mode == .active
        )
    }

    private func invalidateRuntime(path: String, runtime: ManagedRuntime, error: MissionControlSupervisorError) {
        managed.removeValue(forKey: path)
        pendingRuntimes.removeValue(forKey: path)
        restartTargets.removeValue(forKey: path)
        activeAuthorizations.removeValue(forKey: path)
        snapshots[path]?.processID = nil
        snapshots[path]?.status = "FAILED"
        snapshots[path]?.error = error.localizedDescription
        if runtime.process.isRunning {
            runtime.process.terminate()
        }
        publish()
    }

    private func upsert(_ task: ForgeTask, for path: String) {
        guard var snapshot = snapshots[path] else { return }
        if let index = snapshot.tasks.firstIndex(where: { $0.id == task.id }) {
            snapshot.tasks[index] = task
        } else {
            snapshot.tasks.append(task)
        }
        snapshot.refreshedAt = Date()
        snapshots[path] = snapshot
    }

    private func mergeTasks(_ incoming: [ForgeTask], preservingNewerFrom current: [ForgeTask]) -> [ForgeTask] {
        var merged = Dictionary(uniqueKeysWithValues: incoming.map { ($0.id, $0) })
        for task in current {
            guard let candidate = merged[task.id] else {
                merged[task.id] = task
                continue
            }
            if task.updatedAt > candidate.updatedAt {
                merged[task.id] = task
            }
        }
        return Array(merged.values)
    }

    private func handleTermination(path: String, processID: Int32, status: Int32) {
        guard managed[path]?.process.processIdentifier == processID else { return }
        managed.removeValue(forKey: path)
        if let pending = pendingRuntimes.removeValue(forKey: path) {
            reconnectTelemetry[path] = MissionControlReconnectPolicy.clearingBackoff(
                reconnectTelemetry[path]
            )
            startRuntime(path: path, target: pending)
            publish()
            return
        }
        let summary = "Mission Control runtime exited with status \(status)."
        let telemetry = recordReconnectFailure(path: path, summary: summary)
        snapshots[path]?.processID = nil
        snapshots[path]?.status = "RETRY WAIT"
        snapshots[path]?.error = summary
        snapshots[path]?.reconnectTelemetry = telemetry
        publish()
    }

    private func publish() {
        onUpdate?(snapshots)
        onFairQueueUpdate?(fairQueueState())
    }
}

enum MissionControlSupervisorError: LocalizedError {
    case wrongRuntimeMode(expected: String)
    case wrongAuthorization
    case unsupervisedQueueDispatch
    case wrongRepository
    case activeAuthorizationRequired
    case runtimeUnavailable
    case requestAlreadyInFlight

    var errorDescription: String? {
        switch self {
        case .wrongRuntimeMode(let expected):
            return "Mission Control refused a runtime that did not report \(expected) mode."
        case .wrongAuthorization:
            return "Mission Control refused an active runtime without the current session authorization."
        case .unsupervisedQueueDispatch:
            return "Mission Control refused an active runtime that can dispatch queued work without supervisor grants."
        case .wrongRepository:
            return "Mission Control refused a runtime attached to a different repository."
        case .activeAuthorizationRequired:
            return "This repository is read-only. Authorize its active runtime before taking this action."
        case .runtimeUnavailable:
            return "The repository runtime is unavailable or still connecting."
        case .requestAlreadyInFlight:
            return "The same repository action is already in progress."
        }
    }
}
