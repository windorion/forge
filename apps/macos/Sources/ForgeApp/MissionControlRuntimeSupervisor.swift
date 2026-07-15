import Foundation

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
}

@MainActor
final class MissionControlRuntimeSupervisor {
    var onUpdate: (([String: MissionControlObservedRepository]) -> Void)?

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
    private var activeAuthorizations: [String: ActiveAuthorization] = [:]
    private var monitorTask: Task<Void, Never>?

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
                port: 17_374 + index,
                mode: activeAuthorizations[path] == nil ? RuntimeMode.observer : .active,
                authorization: activeAuthorizations[path]
            ))
        })

        let stalePaths = managed.keys.filter { desired[$0] == nil }
        for path in stalePaths {
            managed[path]?.process.terminate()
            managed.removeValue(forKey: path)
            pendingRuntimes.removeValue(forKey: path)
            snapshots.removeValue(forKey: path)
        }

        guard let runtimeDirectory else {
            for path in observedPaths {
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
            if let running = managed[path],
               running.port == target.port,
               running.mode == target.mode,
               running.authorizationID == target.authorization?.id {
                continue
            }
            transition(path: path, to: PendingRuntime(
                port: target.port,
                mode: target.mode,
                runtimeDirectory: runtimeDirectory,
                authorization: target.authorization
            ))
        }

        if observedPaths.isEmpty {
            monitorTask?.cancel()
            monitorTask = nil
        } else if monitorTask == nil {
            monitorTask = Task { [weak self] in
                while !Task.isCancelled {
                    await self?.refreshAll()
                    try? await Task.sleep(for: .seconds(2))
                }
            }
        }
        publish()
    }

    func setActiveAuthorization(path: String, isActive: Bool, runtimeDirectory: URL?) {
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

    func pauseAllActiveLoops() async -> (requested: Int, failed: Int) {
        let activeRuntimes = managed.filter { $0.value.mode == .active }
        var requested = 0
        var failed = 0
        for (path, runtime) in activeRuntimes {
            guard let baseURL = URL(string: "http://127.0.0.1:\(runtime.port)") else { continue }
            let client = RuntimeClient(baseURL: baseURL)
            let runningLoops = (snapshots[path]?.tasks ?? []).compactMap { task -> (ForgeTask.ID, AgentRunLoop.ID)? in
                guard let loop = task.agentRunLoops.last(where: { $0.status == "Running" }) else { return nil }
                return (task.id, loop.id)
            }
            for (taskID, loopID) in runningLoops {
                requested += 1
                do {
                    _ = try await client.pauseAgentLoop(taskID: taskID, loopID: loopID, note: "Pause All from Mission Control")
                } catch {
                    failed += 1
                    snapshots[path]?.error = "Pause failed: \(error.localizedDescription)"
                }
            }
        }
        await refreshAll()
        return (requested, failed)
    }

    func stopAll() {
        monitorTask?.cancel()
        monitorTask = nil
        for runtime in managed.values where runtime.process.isRunning {
            runtime.process.terminate()
        }
        managed.removeAll()
        pendingRuntimes.removeAll()
        activeAuthorizations.removeAll()
        snapshots.removeAll()
        publish()
    }

    private func transition(path: String, to target: PendingRuntime) {
        if let runtime = managed[path], runtime.process.isRunning {
            pendingRuntimes[path] = target
            snapshots[path]?.status = target.mode == .active ? "AUTHORIZING" : "RETURNING READ-ONLY"
            snapshots[path]?.error = nil
            runtime.process.terminate()
            return
        }
        managed.removeValue(forKey: path)
        pendingRuntimes.removeValue(forKey: path)
        startRuntime(path: path, target: target)
    }

    private func startRuntime(path: String, target: PendingRuntime) {
        let port = target.port
        let runtimeDirectory = target.runtimeDirectory
        let server = runtimeDirectory.appendingPathComponent("dist/server.js")
        guard FileManager.default.fileExists(atPath: server.path) else {
            snapshots[path] = MissionControlObservedRepository(
                path: path,
                port: port,
                status: "UNAVAILABLE",
                error: "Mission Control runtime is not built at \(server.path).",
                tasks: []
            )
            return
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
            status: target.mode == .observer ? "STARTING" : "AUTHORIZING",
            tasks: []
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
            snapshots[path]?.status = "FAILED"
            snapshots[path]?.error = error.localizedDescription
        }
    }

    private func refreshAll() async {
        let runtimes = managed
        for (path, runtime) in runtimes {
            guard runtime.process.isRunning,
                  let baseURL = URL(string: "http://127.0.0.1:\(runtime.port)") else { continue }
            let client = RuntimeClient(baseURL: baseURL)
            do {
                async let health = client.health()
                async let tasks = client.listTasks()
                async let queue = client.taskQueue()
                async let gitStatus = client.gitStatus()
                let values = try await (health, tasks, queue, gitStatus)
                if runtime.mode == .observer {
                    guard values.0.runtimeMode == "observer", values.0.readOnly == true else {
                        throw MissionControlSupervisorError.wrongRuntimeMode(expected: "observer/read-only")
                    }
                } else {
                    guard values.0.runtimeMode == "primary", values.0.readOnly == false else {
                        throw MissionControlSupervisorError.wrongRuntimeMode(expected: "primary/read-write")
                    }
                    guard let expectedAuthorizationID = runtime.authorizationID,
                          values.0.runtimeAuthorization?.id == expectedAuthorizationID,
                          values.0.runtimeAuthorization?.scope == "repository-active"
                    else {
                        throw MissionControlSupervisorError.wrongAuthorization
                    }
                }
                guard values.0.workspace?.repoRoot == path else {
                    throw MissionControlSupervisorError.wrongRepository
                }
                snapshots[path] = MissionControlObservedRepository(
                    path: path,
                    port: runtime.port,
                    processID: runtime.process.processIdentifier,
                    status: runtime.mode == .observer ? "LIVE OBSERVER" : "ACTIVE RUNTIME",
                    error: nil,
                    health: values.0,
                    tasks: values.1,
                    queue: values.2,
                    gitStatus: values.3,
                    refreshedAt: Date()
                )
            } catch {
                if error is MissionControlSupervisorError {
                    managed.removeValue(forKey: path)
                    pendingRuntimes.removeValue(forKey: path)
                    snapshots[path]?.processID = nil
                    snapshots[path]?.status = "FAILED"
                    snapshots[path]?.error = error.localizedDescription
                    if runtime.process.isRunning {
                        runtime.process.terminate()
                    }
                } else {
                    snapshots[path]?.status = runtime.process.isRunning
                        ? (runtime.mode == .observer ? "CONNECTING" : "ACTIVATING")
                        : "STOPPED"
                    snapshots[path]?.error = error.localizedDescription
                }
            }
        }
        publish()
    }

    private func handleTermination(path: String, processID: Int32, status: Int32) {
        guard managed[path]?.process.processIdentifier == processID else { return }
        managed.removeValue(forKey: path)
        if let pending = pendingRuntimes.removeValue(forKey: path) {
            startRuntime(path: path, target: pending)
            publish()
            return
        }
        snapshots[path]?.processID = nil
        snapshots[path]?.status = status == 0 || status == 143 ? "STOPPED" : "FAILED"
        snapshots[path]?.error = status == 0 || status == 143 ? nil : "Mission Control runtime exited with status \(status)."
        publish()
    }

    private func publish() {
        onUpdate?(snapshots)
    }
}

private enum MissionControlSupervisorError: LocalizedError {
    case wrongRuntimeMode(expected: String)
    case wrongAuthorization
    case wrongRepository

    var errorDescription: String? {
        switch self {
        case .wrongRuntimeMode(let expected):
            return "Mission Control refused a runtime that did not report \(expected) mode."
        case .wrongAuthorization:
            return "Mission Control refused an active runtime without the current session authorization."
        case .wrongRepository:
            return "Mission Control refused a runtime attached to a different repository."
        }
    }
}
