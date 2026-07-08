import AppKit
import Foundation

@MainActor
final class WorkspaceModel: ObservableObject {
    static let expectedRuntimeService = "forge-runtime"
    static let expectedRuntimeVersion = "0.1.0"

    @Published var tasks: [ForgeTask] = [.sample]
    @Published var selectedTaskID: ForgeTask.ID? = ForgeTask.sample.id
    @Published var runtimeHealth: RuntimeHealth?
    @Published var runtimeState: RuntimeConnectionState = .unchecked
    @Published var runtimeLastCheckedAt: Date?
    @Published var runtimeLastError: String?
    @Published var runtimeDiagnosticsCopiedAt: Date?
    @Published var modelProviderSettingsEnvelope: ModelProviderSettingsEnvelope?
    @Published var validationPresets: [ValidationPreset] = []
    @Published var workspaceValidationPresetConfig: WorkspaceValidationPresetConfig?
    @Published var gitStatus: GitStatusSnapshot?
    @Published var gitStatusLastError: String?
    @Published var statusMessage = "Runtime not checked"
    @Published var eventStreamStatus = "Event stream disconnected"
    @Published var eventStreamState: RuntimeEventStreamState = .disconnected
    @Published var runtimeProcessState: RuntimeProcessState = .notStarted
    @Published var runtimeProcessMessage = "Runtime process has not been started by the app."
    @Published var runtimeProcessID: Int32?
    @Published var runtimeProcessDirectory: String?
    @Published private var validationPermissionSnapshots: [ForgeTask.ID: [ValidationPresetPermission]] = [:]
    @Published private var sendingMessageTaskIDs = Set<ForgeTask.ID>()
    @Published private var generatingPlanRevisionTaskIDs = Set<ForgeTask.ID>()
    @Published private var approvingTaskIDs = Set<ForgeTask.ID>()
    @Published private var generatingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var generatingValidationRepairProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var validatingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var applyingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var rejectingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var runningValidationTaskIDs = Set<ForgeTask.ID>()
    @Published private var approvingValidationPresetTaskIDs = Set<String>()
    @Published private var refreshingGitStatus = false
    @Published private var loadingGitDiffPaths = Set<String>()
    @Published private var loadingGitCommitPreviewTaskIDs = Set<ForgeTask.ID>()
    @Published private var gitFileDiffs: [String: GitFileDiff] = [:]
    @Published private var gitCommitPreviews: [ForgeTask.ID: GitCommitPreview] = [:]
    @Published private var updatingModelProviderSettings = false

    private let runtime = RuntimeClient()
    private var eventStreamTask: Task<Void, Never>?
    private var runtimeProcess: Process?

    var selectedTask: ForgeTask? {
        tasks.first { $0.id == selectedTaskID }
    }

    var runtimeEndpoint: String {
        runtime.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    var canStartRuntimeProcess: Bool {
        switch runtimeProcessState {
        case .starting, .running, .stopping:
            return false
        case .notStarted, .stopped, .failed:
            return true
        }
    }

    var canStopRuntimeProcess: Bool {
        runtimeProcess?.isRunning == true &&
            (runtimeProcessState == .running || runtimeProcessState == .starting)
    }

    deinit {
        eventStreamTask?.cancel()
        if runtimeProcess?.isRunning == true {
            runtimeProcess?.terminate()
        }
    }

    func startRuntimeProcess() {
        guard canStartRuntimeProcess else {
            statusMessage = "Runtime process is already managed by the app."
            return
        }

        guard let runtimeDirectory = resolveRuntimeDirectory() else {
            runtimeProcessState = .failed
            runtimeProcessMessage = "Could not find the repository runtime directory."
            statusMessage = runtimeProcessMessage
            return
        }

        runtimeProcessState = .starting
        runtimeProcessMessage = "Building runtime before launch..."
        runtimeProcessDirectory = runtimeDirectory.path(percentEncoded: false)
        statusMessage = "Starting Forge runtime..."

        Task {
            do {
                try await Self.buildRuntime(at: runtimeDirectory)
                try launchRuntimeNodeProcess(at: runtimeDirectory)
                refreshRuntimeHealthAfterDelay()
            } catch {
                runtimeProcessState = .failed
                runtimeProcessMessage = "Start failed: \(error.localizedDescription)"
                runtimeProcessID = nil
                runtimeProcess = nil
                statusMessage = runtimeProcessMessage
            }
        }
    }

    func stopRuntimeProcess() {
        guard let process = runtimeProcess, process.isRunning else {
            runtimeProcessState = .stopped
            runtimeProcessID = nil
            runtimeProcessMessage = "No app-managed runtime process is running."
            statusMessage = runtimeProcessMessage
            eventStreamTask?.cancel()
            eventStreamState = .disconnected
            eventStreamStatus = "Event stream disconnected"
            return
        }

        runtimeProcessState = .stopping
        runtimeProcessMessage = "Stopping app-managed runtime process \(process.processIdentifier)..."
        statusMessage = "Stopping Forge runtime..."
        eventStreamTask?.cancel()
        eventStreamState = .disconnected
        eventStreamStatus = "Event stream disconnected"
        process.terminate()
    }

    func refreshRuntimeHealth() {
        runtimeState = .checking
        runtimeLastError = nil
        statusMessage = "Checking runtime..."

        Task {
            do {
                let health = try await runtime.health()
                runtimeHealth = health
                runtimeLastCheckedAt = Date()
                runtimeState = classifyRuntimeState(health)
                try await refreshModelProviderSettingsSnapshot()
                statusMessage = statusMessage(for: runtimeState)
                try await refreshTasks()
                try await refreshValidationPresets()
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: selectedTaskID)
                startEventStream()
            } catch {
                runtimeHealth = nil
                modelProviderSettingsEnvelope = nil
                gitStatus = nil
                runtimeState = .disconnected
                runtimeLastCheckedAt = Date()
                runtimeLastError = error.localizedDescription
                statusMessage = "Runtime disconnected"
                eventStreamState = .disconnected
                eventStreamStatus = "Event stream disconnected"
                eventStreamTask?.cancel()
            }
        }
    }

    func refreshModelProviderSettings() {
        Task {
            do {
                try await refreshModelProviderSettingsSnapshot()
                if let health = try? await runtime.health() {
                    runtimeHealth = health
                    runtimeState = classifyRuntimeState(health)
                    runtimeLastCheckedAt = Date()
                    runtimeLastError = nil
                }
                statusMessage = "Model provider settings refreshed."
            } catch {
                statusMessage = "Refresh model provider settings failed: \(error.localizedDescription)"
            }
        }
    }

    func updateModelProviderSettings(
        providerID: String,
        modelName: String?,
        openAIBaseURL: String?,
        openAITimeoutMs: Int?,
        openAIMaxOutputTokens: Int?,
        openAIAPIKey: String? = nil,
        clearOpenAIAPIKey: Bool? = nil
    ) {
        updatingModelProviderSettings = true

        Task {
            do {
                let update = UpdateModelProviderSettingsRequest(
                    providerID: providerID,
                    modelName: modelName,
                    openAIBaseURL: openAIBaseURL,
                    openAITimeoutMs: openAITimeoutMs,
                    openAIMaxOutputTokens: openAIMaxOutputTokens,
                    openAIAPIKey: openAIAPIKey,
                    clearOpenAIAPIKey: clearOpenAIAPIKey
                )
                modelProviderSettingsEnvelope = try await runtime.updateModelProviderSettings(update)
                if let health = try? await runtime.health() {
                    runtimeHealth = health
                    runtimeState = classifyRuntimeState(health)
                    runtimeLastCheckedAt = Date()
                    runtimeLastError = nil
                }
                statusMessage = "Model provider settings saved."
            } catch {
                statusMessage = "Save model provider settings failed: \(error.localizedDescription)"
            }

            updatingModelProviderSettings = false
        }
    }

    func isUpdatingModelProviderSettings() -> Bool {
        updatingModelProviderSettings
    }

    func createDemoTask() {
        createTask(
            title: "Create first Forge task",
            objective: "Prove that the macOS app can create a task through the local runtime."
        )
    }

    func createTask(title: String, objective: String) {
        Task {
            do {
                let task = try await runtime.createTask(title: title, objective: objective)
                upsert(task)
                selectedTaskID = task.id
                statusMessage = "Task created. Agent Loop v0 started."
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: task.id)
                startEventStream()
            } catch {
                statusMessage = "Create task failed: \(error.localizedDescription)"
            }
        }
    }

    func approvePlan(for task: ForgeTask) {
        approvingTaskIDs.insert(task.id)

        Task {
            do {
                let approvedTask = try await runtime.approvePlan(taskID: task.id)
                upsert(approvedTask)
                selectedTaskID = approvedTask.id
                statusMessage = "Plan approved. Controlled execution opened."
                await refreshValidationPermissionSnapshotIfPossible(for: approvedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Approve plan failed: \(error.localizedDescription)"
            }

            approvingTaskIDs.remove(task.id)
        }
    }

    func isApprovingPlan(taskID: ForgeTask.ID) -> Bool {
        approvingTaskIDs.contains(taskID)
    }

    func sendTaskMessage(for task: ForgeTask, content: String) {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        sendingMessageTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.sendTaskMessage(taskID: task.id, content: trimmed)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Intent brief updated."
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Send message failed: \(error.localizedDescription)"
            }

            sendingMessageTaskIDs.remove(task.id)
        }
    }

    func isSendingTaskMessage(taskID: ForgeTask.ID) -> Bool {
        sendingMessageTaskIDs.contains(taskID)
    }

    func generatePlanRevision(for task: ForgeTask) {
        generatingPlanRevisionTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.generatePlanRevision(taskID: task.id)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Plan revision ready for review."
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Generate plan revision failed: \(error.localizedDescription)"
            }

            generatingPlanRevisionTaskIDs.remove(task.id)
        }
    }

    func isGeneratingPlanRevision(taskID: ForgeTask.ID) -> Bool {
        generatingPlanRevisionTaskIDs.contains(taskID)
    }

    func generateEditProposal(for task: ForgeTask) {
        generatingEditProposalTaskIDs.insert(task.id)

        Task {
            do {
                let isRevision = task.editProposal?.status == "Rejected"
                let updatedTask: ForgeTask
                if isRevision {
                    updatedTask = try await runtime.reviseEditProposal(taskID: task.id)
                } else {
                    updatedTask = try await runtime.generateEditProposal(taskID: task.id)
                }
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = isRevision
                    ? "Revised edit proposal ready for review."
                    : "Edit proposal ready for review."
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Generate edit proposal failed: \(error.localizedDescription)"
            }

            generatingEditProposalTaskIDs.remove(task.id)
        }
    }

    func isGeneratingEditProposal(taskID: ForgeTask.ID) -> Bool {
        generatingEditProposalTaskIDs.contains(taskID)
    }

    func generateValidationRepairProposal(for task: ForgeTask) {
        generatingValidationRepairProposalTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.generateValidationRepairProposal(taskID: task.id)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Validation repair proposal ready for review."
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Generate validation repair proposal failed: \(error.localizedDescription)"
            }

            generatingValidationRepairProposalTaskIDs.remove(task.id)
        }
    }

    func isGeneratingValidationRepairProposal(taskID: ForgeTask.ID) -> Bool {
        generatingValidationRepairProposalTaskIDs.contains(taskID)
    }

    func validateEditProposal(for task: ForgeTask) {
        validatingEditProposalTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.validateEditProposal(taskID: task.id)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Edit proposal validation refreshed."
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Validate edit proposal failed: \(error.localizedDescription)"
            }

            validatingEditProposalTaskIDs.remove(task.id)
        }
    }

    func isValidatingEditProposal(taskID: ForgeTask.ID) -> Bool {
        validatingEditProposalTaskIDs.contains(taskID)
    }

    func applyEditProposal(for task: ForgeTask) {
        applyingEditProposalTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.applyEditProposal(taskID: task.id)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Edit proposal applied. Review the changed files."
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Apply edit proposal failed: \(error.localizedDescription)"
            }

            applyingEditProposalTaskIDs.remove(task.id)
        }
    }

    func isApplyingEditProposal(taskID: ForgeTask.ID) -> Bool {
        applyingEditProposalTaskIDs.contains(taskID)
    }

    func rejectEditProposal(for task: ForgeTask) {
        rejectingEditProposalTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.rejectEditProposal(taskID: task.id)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Edit proposal rejected. No files were changed."
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Reject edit proposal failed: \(error.localizedDescription)"
            }

            rejectingEditProposalTaskIDs.remove(task.id)
        }
    }

    func isRejectingEditProposal(taskID: ForgeTask.ID) -> Bool {
        rejectingEditProposalTaskIDs.contains(taskID)
    }

    func approveValidationPreset(for task: ForgeTask, presetID: ValidationPreset.ID) {
        let key = validationPresetActionKey(taskID: task.id, presetID: presetID)
        approvingValidationPresetTaskIDs.insert(key)

        Task {
            do {
                let updatedTask = try await runtime.approveValidationPreset(taskID: task.id, presetID: presetID)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Validation preset approved."
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Approve validation preset failed: \(error.localizedDescription)"
            }

            approvingValidationPresetTaskIDs.remove(key)
        }
    }

    func isApprovingValidationPreset(taskID: ForgeTask.ID, presetID: ValidationPreset.ID) -> Bool {
        approvingValidationPresetTaskIDs.contains(validationPresetActionKey(taskID: taskID, presetID: presetID))
    }

    func runValidation(for task: ForgeTask, presetID: ValidationPreset.ID? = nil) {
        let key = validationPresetActionKey(taskID: task.id, presetID: presetID ?? "forge-post-apply")
        runningValidationTaskIDs.insert(key)

        Task {
            do {
                let updatedTask = try await runtime.runValidation(taskID: task.id, presetID: presetID)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Validation run completed."
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Run validation failed: \(error.localizedDescription)"
            }

            runningValidationTaskIDs.remove(key)
        }
    }

    func isRunningValidation(taskID: ForgeTask.ID, presetID: ValidationPreset.ID? = nil) -> Bool {
        runningValidationTaskIDs.contains(validationPresetActionKey(taskID: taskID, presetID: presetID ?? "forge-post-apply"))
    }

    func validationPermissions(for taskID: ForgeTask.ID) -> [ValidationPresetPermission] {
        validationPermissionSnapshots[taskID] ?? []
    }

    func refreshGitStatus() {
        refreshingGitStatus = true

        Task {
            await refreshGitStatusSnapshot()
            refreshingGitStatus = false
        }
    }

    func isRefreshingGitStatus() -> Bool {
        refreshingGitStatus
    }

    func refreshGitDiff(path: String) {
        loadingGitDiffPaths.insert(path)

        Task {
            do {
                gitFileDiffs[path] = try await runtime.gitFileDiff(path: path)
                gitStatusLastError = nil
            } catch {
                gitStatusLastError = "Load git diff failed: \(error.localizedDescription)"
            }

            loadingGitDiffPaths.remove(path)
        }
    }

    func gitDiff(for path: String) -> GitFileDiff? {
        gitFileDiffs[path]
    }

    func isLoadingGitDiff(path: String) -> Bool {
        loadingGitDiffPaths.contains(path)
    }

    func prepareGitCommitReview(for task: ForgeTask) {
        loadingGitCommitPreviewTaskIDs.insert(task.id)

        Task {
            do {
                let taskID = task.id == ForgeTask.sample.id ? nil : task.id
                gitCommitPreviews[task.id] = try await runtime.gitCommitPreview(taskID: taskID)
                gitStatusLastError = nil
            } catch {
                gitStatusLastError = "Prepare commit review failed: \(error.localizedDescription)"
            }

            loadingGitCommitPreviewTaskIDs.remove(task.id)
        }
    }

    func gitCommitPreview(for taskID: ForgeTask.ID) -> GitCommitPreview? {
        gitCommitPreviews[taskID]
    }

    func isPreparingGitCommitReview(taskID: ForgeTask.ID) -> Bool {
        loadingGitCommitPreviewTaskIDs.contains(taskID)
    }

    func revealGitFile(path: String) {
        guard let root = gitStatus?.root else {
            statusMessage = "Git root is not available."
            return
        }

        let targetURL = URL(fileURLWithPath: root).appendingPathComponent(path)
        let revealURL = FileManager.default.fileExists(atPath: targetURL.path)
            ? targetURL
            : targetURL.deletingLastPathComponent()
        NSWorkspace.shared.activateFileViewerSelecting([revealURL])
        statusMessage = "Revealed \(path) in Finder."
    }

    func openGitFile(path: String) {
        guard let root = gitStatus?.root else {
            statusMessage = "Git root is not available."
            return
        }

        let targetURL = URL(fileURLWithPath: root).appendingPathComponent(path)
        guard FileManager.default.fileExists(atPath: targetURL.path) else {
            revealGitFile(path: path)
            return
        }

        NSWorkspace.shared.open(targetURL)
        statusMessage = "Opened \(path)."
    }

    func refreshValidationPermissions(for taskID: ForgeTask.ID?) {
        Task {
            await refreshValidationPermissionSnapshotIfPossible(for: taskID)
        }
    }

    func copyRuntimeDiagnostics() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(runtimeDiagnosticsText(), forType: .string)
        runtimeDiagnosticsCopiedAt = Date()
        statusMessage = "Runtime diagnostics copied."
    }

    func openRuntimeStatusPage() {
        NSWorkspace.shared.open(runtime.baseURL)
        statusMessage = "Runtime status page opened."
    }

    private func launchRuntimeNodeProcess(at runtimeDirectory: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [
            "node",
            "--disable-warning=ExperimentalWarning",
            "dist/server.js"
        ]
        process.currentDirectoryURL = runtimeDirectory

        var environment = ProcessInfo.processInfo.environment
        environment["FORGE_RUNTIME_PORT"] = "17373"
        process.environment = environment

        if let nullDevice = FileHandle(forWritingAtPath: "/dev/null") {
            process.standardOutput = nullDevice
            process.standardError = nullDevice
        }

        process.terminationHandler = { [weak self] process in
            let pid = process.processIdentifier
            let status = process.terminationStatus
            Task { @MainActor [weak self] in
                self?.handleRuntimeProcessTermination(pid: pid, status: status)
            }
        }

        try process.run()
        runtimeProcess = process
        runtimeProcessID = process.processIdentifier
        runtimeProcessState = .running
        runtimeProcessMessage = "Runtime process \(process.processIdentifier) is running from \(runtimeDirectory.path)."
        statusMessage = "Runtime process started."
    }

    private func handleRuntimeProcessTermination(pid: Int32, status: Int32) {
        guard runtimeProcessID == pid else {
            return
        }

        runtimeProcess = nil
        runtimeProcessID = nil

        if runtimeProcessState == .stopping {
            runtimeProcessState = .stopped
            runtimeProcessMessage = "Runtime process \(pid) stopped."
            statusMessage = runtimeProcessMessage
            runtimeHealth = nil
            runtimeState = .disconnected
            runtimeLastCheckedAt = Date()
            runtimeLastError = "App-managed runtime process stopped."
        } else if status == 0 {
            runtimeProcessState = .stopped
            runtimeProcessMessage = "Runtime process \(pid) exited normally."
            statusMessage = runtimeProcessMessage
            refreshRuntimeHealthAfterDelay()
        } else {
            runtimeProcessState = .failed
            runtimeProcessMessage = "Runtime process \(pid) exited with status \(status)."
            statusMessage = runtimeProcessMessage
            refreshRuntimeHealthAfterDelay()
        }
    }

    private func refreshRuntimeHealthAfterDelay() {
        Task {
            try? await Task.sleep(nanoseconds: 800_000_000)
            refreshRuntimeHealth()
        }
    }

    private func resolveRuntimeDirectory() -> URL? {
        let currentDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let bundleParent = Bundle.main.bundleURL.deletingLastPathComponent()
        let bundledRepositoryRoot = bundleParent.deletingLastPathComponent()

        let candidateRoots = [
            currentDirectory,
            bundledRepositoryRoot,
            bundleParent
        ]

        for root in candidateRoots {
            let runtimeDirectory = root.appendingPathComponent("runtime", isDirectory: true)
            let packageFile = runtimeDirectory.appendingPathComponent("package.json")
            if FileManager.default.fileExists(atPath: packageFile.path) {
                return runtimeDirectory
            }
        }

        return nil
    }

    private nonisolated static func buildRuntime(at runtimeDirectory: URL) async throws {
        try await Task.detached(priority: .userInitiated) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["npm", "run", "build"]
            process.currentDirectoryURL = runtimeDirectory

            if let nullDevice = FileHandle(forWritingAtPath: "/dev/null") {
                process.standardOutput = nullDevice
                process.standardError = nullDevice
            }

            try process.run()
            process.waitUntilExit()

            guard process.terminationStatus == 0 else {
                throw RuntimeProcessError.buildFailed(process.terminationStatus)
            }
        }.value
    }

    func runtimeDiagnosticsText() -> String {
        let health = runtimeHealth
        let providerConfiguration = modelProviderSettingsEnvelope?.configuration ?? health?.modelProviderConfiguration
        let provider = providerConfiguration?.provider ?? health?.modelProvider
        let lastChecked = runtimeLastCheckedAt.map(Self.diagnosticsDateFormatter.string(from:)) ?? "Never"
        let copiedAt = runtimeDiagnosticsCopiedAt.map(Self.diagnosticsDateFormatter.string(from:)) ?? "Never"

        var lines = [
            "Forge Runtime Diagnostics",
            "Generated: \(Self.diagnosticsDateFormatter.string(from: Date()))",
            "Endpoint: \(runtimeEndpoint)",
            "Expected service: \(Self.expectedRuntimeService)",
            "Expected version: \(Self.expectedRuntimeVersion)",
            "Runtime state: \(runtimeState.rawValue)",
            "Runtime process state: \(runtimeProcessState.rawValue)",
            "Runtime process message: \(runtimeProcessMessage)",
            "Runtime process id: \(runtimeProcessID.map(String.init) ?? "None")",
            "Runtime process directory: \(runtimeProcessDirectory ?? "Unknown")",
            "Git status: \(gitStatus?.summary ?? "Unavailable")",
            "Git status error: \(gitStatusLastError ?? "None")",
            "Status message: \(statusMessage)",
            "Last checked: \(lastChecked)",
            "Last error: \(runtimeLastError ?? "None")",
            "Event stream: \(eventStreamState.rawValue)",
            "Event stream detail: \(eventStreamStatus)",
            "Diagnostics copied: \(copiedAt)"
        ]

        if let health {
            lines.append(contentsOf: [
                "Health ok: \(health.ok)",
                "Service: \(health.service)",
                "Version: \(health.version)",
                "Uptime seconds: \(Int(health.uptimeSeconds.rounded()))"
            ])

            if let persistence = health.persistence {
                lines.append("Database path: \(persistence.databasePath)")
                lines.append("Task count: \(persistence.taskCount)")
            }
        }

        if let provider {
            lines.append(contentsOf: [
                "Provider: \(provider.name)",
                "Provider id: \(provider.id)",
                "Provider model: \(provider.model)",
                "Provider mode: \(provider.mode)"
            ])
        }

        if let providerConfiguration {
            lines.append("Provider status: \(providerConfiguration.status)")
            lines.append("Provider summary: \(providerConfiguration.summary)")
            if providerConfiguration.issues.isEmpty {
                lines.append("Provider issues: None")
            } else {
                lines.append("Provider issues:")
                lines.append(contentsOf: providerConfiguration.issues.map { "- \($0)" })
            }
            lines.append("Sends remote context: \(providerConfiguration.sendsRemoteContext)")
            if let remoteContextSummary = providerConfiguration.remoteContextSummary {
                lines.append("Remote context boundary: \(remoteContextSummary)")
            }
        }

        if let workspaceValidationPresetConfig {
            lines.append("Validation preset config: \(workspaceValidationPresetConfig.path)")
            lines.append("Validation preset config exists: \(workspaceValidationPresetConfig.exists)")
            if !workspaceValidationPresetConfig.issues.isEmpty {
                lines.append("Validation preset config issues:")
                lines.append(contentsOf: workspaceValidationPresetConfig.issues.map { "- \($0)" })
            }
        }

        lines.append("Loaded tasks in app: \(tasks.count)")
        return lines.joined(separator: "\n")
    }

    private func startEventStream() {
        eventStreamTask?.cancel()
        eventStreamState = .connecting
        eventStreamStatus = "Event stream connecting"

        eventStreamTask = Task { [runtime] in
            do {
                for try await event in runtime.events() {
                    await handleRuntimeEvent(event)
                }

                await MainActor.run {
                    if !Task.isCancelled {
                        eventStreamState = .disconnected
                        eventStreamStatus = "Event stream disconnected"
                    }
                }
            } catch {
                await MainActor.run {
                    eventStreamState = .disconnected
                    eventStreamStatus = "Event stream stopped: \(error.localizedDescription)"
                }
            }
        }
    }

    private func handleRuntimeEvent(_ event: RuntimeStreamEvent) async {
        eventStreamState = .connected
        eventStreamStatus = "Last event: \(event.type)"

        do {
            try await refreshTasks()
            await refreshGitStatusSnapshot()
            await refreshValidationPermissionSnapshotIfPossible(for: selectedTaskID)
        } catch {
            statusMessage = "Refresh after event failed: \(error.localizedDescription)"
        }
    }

    private func refreshTasks() async throws {
        let remoteTasks = try await runtime.listTasks()
        if remoteTasks.isEmpty {
            return
        }

        tasks = remoteTasks
        selectedTaskID = selectedTaskID ?? remoteTasks.first?.id
    }

    private func refreshValidationPresets() async throws {
        let envelope = try await runtime.listValidationPresets()
        validationPresets = envelope.presets
        workspaceValidationPresetConfig = envelope.workspaceConfig
    }

    private func refreshModelProviderSettingsSnapshot() async throws {
        modelProviderSettingsEnvelope = try await runtime.modelProviderSettings()
    }

    private func refreshGitStatusSnapshot() async {
        do {
            gitStatus = try await runtime.gitStatus()
            gitStatusLastError = gitStatus?.error
            gitCommitPreviews.removeAll()
        } catch {
            gitStatus = nil
            gitStatusLastError = error.localizedDescription
        }
    }

    private func refreshValidationPermissionSnapshotIfPossible(for taskID: ForgeTask.ID?) async {
        guard let taskID else {
            return
        }

        guard tasks.contains(where: { $0.id == taskID && $0.id != ForgeTask.sample.id }) else {
            return
        }

        do {
            let envelope = try await runtime.validationPermissions(taskID: taskID)
            validationPermissionSnapshots[taskID] = envelope.permissions
        } catch {
            statusMessage = "Refresh validation permissions failed: \(error.localizedDescription)"
        }
    }

    private func upsert(_ task: ForgeTask) {
        if let index = tasks.firstIndex(where: { $0.id == task.id }) {
            tasks[index] = task
        } else {
            tasks.insert(task, at: 0)
        }
    }

    private func classifyRuntimeState(_ health: RuntimeHealth) -> RuntimeConnectionState {
        guard health.ok else {
            return .disconnected
        }

        guard health.service == Self.expectedRuntimeService,
              health.version == Self.expectedRuntimeVersion else {
            return .wrongVersion
        }

        let providerStatus = health.modelProviderConfiguration?.status
            ?? modelProviderSettingsEnvelope?.configuration.status
        if providerStatus == "NeedsConfiguration" || providerStatus == "Unsupported" {
            return .needsProviderConfiguration
        }

        return .running
    }

    private func statusMessage(for state: RuntimeConnectionState) -> String {
        switch state {
        case .unchecked:
            return "Runtime not checked"
        case .checking:
            return "Checking runtime..."
        case .running:
            return "Runtime connected"
        case .needsProviderConfiguration:
            return "Runtime connected. Provider needs configuration."
        case .wrongVersion:
            return "Runtime connected, but version or service is unexpected."
        case .disconnected:
            return "Runtime disconnected"
        }
    }

    private func validationPresetActionKey(taskID: ForgeTask.ID, presetID: ValidationPreset.ID) -> String {
        "\(taskID)-\(presetID)"
    }

    private static let diagnosticsDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

private enum RuntimeProcessError: LocalizedError {
    case buildFailed(Int32)

    var errorDescription: String? {
        switch self {
        case .buildFailed(let status):
            return "Runtime build failed with exit status \(status)."
        }
    }
}
