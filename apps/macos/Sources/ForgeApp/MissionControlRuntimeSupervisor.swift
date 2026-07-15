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
    }

    private var managed: [String: ManagedRuntime] = [:]
    private var snapshots: [String: MissionControlObservedRepository] = [:]
    private var monitorTask: Task<Void, Never>?

    deinit {
        monitorTask?.cancel()
        for runtime in managed.values where runtime.process.isRunning {
            runtime.process.terminate()
        }
    }

    func synchronize(repositoryPaths: [String], currentPath: String?, runtimeDirectory: URL?) {
        let observedPaths = Array(repositoryPaths.filter { $0 != currentPath }.prefix(2))
        let desired = Dictionary(uniqueKeysWithValues: observedPaths.enumerated().map { index, path in
            (path, 17_374 + index)
        })

        let stalePaths = managed.compactMap { path, runtime in desired[path] == runtime.port ? nil : path }
        for path in stalePaths {
            managed[path]?.process.terminate()
            managed.removeValue(forKey: path)
            snapshots.removeValue(forKey: path)
        }

        guard let runtimeDirectory else {
            for path in observedPaths {
                snapshots[path] = MissionControlObservedRepository(
                    path: path,
                    port: desired[path] ?? 0,
                    status: "UNAVAILABLE",
                    error: "Runtime installation could not be resolved.",
                    tasks: []
                )
            }
            publish()
            return
        }

        for path in observedPaths where managed[path] == nil {
            startObserver(path: path, port: desired[path]!, runtimeDirectory: runtimeDirectory)
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

    func stopAll() {
        monitorTask?.cancel()
        monitorTask = nil
        for runtime in managed.values where runtime.process.isRunning {
            runtime.process.terminate()
        }
        managed.removeAll()
        snapshots.removeAll()
        publish()
    }

    private func startObserver(path: String, port: Int, runtimeDirectory: URL) {
        let server = runtimeDirectory.appendingPathComponent("dist/server.js")
        guard FileManager.default.fileExists(atPath: server.path) else {
            snapshots[path] = MissionControlObservedRepository(
                path: path,
                port: port,
                status: "UNAVAILABLE",
                error: "Observer runtime is not built at \(server.path).",
                tasks: []
            )
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
        process.currentDirectoryURL = runtimeDirectory
        var environment = ProcessInfo.processInfo.environment
        environment["FORGE_RUNTIME_MODE"] = "observer"
        environment["FORGE_RUNTIME_PORT"] = String(port)
        environment["FORGE_REPO_ROOT"] = path
        environment["FORGE_MODEL_PROVIDER"] = "local"
        environment.removeValue(forKey: "OPENAI_API_KEY")
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
            status: "STARTING",
            tasks: []
        )
        do {
            try process.run()
            managed[path] = ManagedRuntime(process: process, port: port)
            snapshots[path]?.processID = process.processIdentifier
            snapshots[path]?.status = "CONNECTING"
        } catch {
            snapshots[path]?.status = "FAILED"
            snapshots[path]?.error = error.localizedDescription
        }
    }

    private func refreshAll() async {
        for (path, runtime) in managed {
            guard runtime.process.isRunning,
                  let baseURL = URL(string: "http://127.0.0.1:\(runtime.port)") else { continue }
            let client = RuntimeClient(baseURL: baseURL)
            do {
                async let health = client.health()
                async let tasks = client.listTasks()
                async let queue = client.taskQueue()
                async let gitStatus = client.gitStatus()
                let values = try await (health, tasks, queue, gitStatus)
                guard values.0.runtimeMode == "observer", values.0.readOnly == true else {
                    throw MissionControlSupervisorError.notReadOnly
                }
                guard values.0.workspace?.repoRoot == path else {
                    throw MissionControlSupervisorError.wrongRepository
                }
                snapshots[path] = MissionControlObservedRepository(
                    path: path,
                    port: runtime.port,
                    processID: runtime.process.processIdentifier,
                    status: "LIVE OBSERVER",
                    error: nil,
                    health: values.0,
                    tasks: values.1,
                    queue: values.2,
                    gitStatus: values.3,
                    refreshedAt: Date()
                )
            } catch {
                snapshots[path]?.status = runtime.process.isRunning ? "CONNECTING" : "STOPPED"
                snapshots[path]?.error = error.localizedDescription
            }
        }
        publish()
    }

    private func handleTermination(path: String, processID: Int32, status: Int32) {
        guard managed[path]?.process.processIdentifier == processID else { return }
        managed.removeValue(forKey: path)
        snapshots[path]?.processID = nil
        snapshots[path]?.status = status == 0 || status == 143 ? "STOPPED" : "FAILED"
        snapshots[path]?.error = status == 0 || status == 143 ? nil : "Observer runtime exited with status \(status)."
        publish()
    }

    private func publish() {
        onUpdate?(snapshots)
    }
}

private enum MissionControlSupervisorError: LocalizedError {
    case notReadOnly
    case wrongRepository

    var errorDescription: String? {
        switch self {
        case .notReadOnly:
            return "Mission Control refused a runtime that did not report observer/read-only mode."
        case .wrongRepository:
            return "Mission Control refused an observer attached to a different repository."
        }
    }
}
