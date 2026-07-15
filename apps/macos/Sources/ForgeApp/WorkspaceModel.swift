import AppKit
import Foundation

@MainActor
final class WorkspaceModel: ObservableObject {
    static let expectedRuntimeService = "forge-runtime"
    static let expectedRuntimeVersion = "0.1.0"
    nonisolated private static let runtimeProcessOutputLimit = 12_000
    nonisolated private static let repositoryPreferenceKey = "forge.selectedRepositoryRoot"
    nonisolated private static let missionControlRepositoriesKey = "forge.missionControlRepositories"

    @Published var tasks: [ForgeTask] = []
    @Published var selectedTaskID: ForgeTask.ID?
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
    @Published var gitConflictSnapshot: GitConflictSnapshot?
    @Published var gitConflictLastError: String?
    @Published var gitConflictLastResult: GitConflictResolutionResult?
    @Published var taskQueueSnapshot: TaskQueueSnapshot?
    @Published var taskQueueLastError: String?
    @Published var statusMessage = "Runtime not checked"
    @Published var eventStreamStatus = "Event stream disconnected"
    @Published var eventStreamState: RuntimeEventStreamState = .disconnected
    @Published var runtimeProcessState: RuntimeProcessState = .notStarted
    @Published var runtimeProcessMessage = "Runtime process has not been started by the app."
    @Published var runtimeProcessID: Int32?
    @Published var runtimeProcessDirectory: String?
    @Published var runtimeRepositoryRoot: String?
    @Published var runtimeProcessCandidateDirectories: [String] = []
    @Published var runtimeProcessLastOutput: String?
    @Published var runtimeProcessLaunchCommand: String?
    @Published var repositorySelectionMessage: String?
    @Published var missionControlRepositories: [MissionControlRepositorySnapshot] = []
    @Published private var validationPermissionSnapshots: [ForgeTask.ID: [ValidationPresetPermission]] = [:]
    @Published private var taskCommandPermissionSnapshots: [ForgeTask.ID: [TaskCommandPermission]] = [:]
    @Published private var sendingMessageTaskIDs = Set<ForgeTask.ID>()
    @Published private var generatingPlanRevisionTaskIDs = Set<ForgeTask.ID>()
    @Published private var approvingTaskIDs = Set<ForgeTask.ID>()
    @Published private var generatingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var generatingValidationRepairProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var validatingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var applyingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var rollingBackEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var rejectingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var reviewingEditProposalFileKeys = Set<String>()
    @Published private var runningAgentLoopTaskIDs = Set<ForgeTask.ID>()
    @Published private var updatingTaskQueue = false
    @Published private var pausingAgentLoopIDs = Set<AgentRunLoop.ID>()
    @Published private var abortingAgentLoopIDs = Set<AgentRunLoop.ID>()
    @Published private var resumingAgentLoopIDs = Set<AgentRunLoop.ID>()
    @Published private var runningAgentStepTaskIDs = Set<ForgeTask.ID>()
    @Published private var runningValidationTaskIDs = Set<ForgeTask.ID>()
    @Published private var runningTaskCommandTaskIDs = Set<ForgeTask.ID>()
    @Published private var rerunningRepairCommandEvidenceIDs = Set<CommandRerunEvidence.ID>()
    @Published private var cancellingTaskCommandRunIDs = Set<TaskCommandRun.ID>()
    @Published private var approvingValidationPresetTaskIDs = Set<String>()
    @Published private var refreshingGitStatus = false
    @Published private var loadingGitDiffPaths = Set<String>()
    @Published private var resolvingGitConflictPaths = Set<String>()
    @Published private var loadingGitBranchPreviewTaskIDs = Set<ForgeTask.ID>()
    @Published private var changingGitBranchTaskIDs = Set<ForgeTask.ID>()
    @Published private var loadingGitBranchPublishPreviewTaskIDs = Set<ForgeTask.ID>()
    @Published private var publishingGitBranchTaskIDs = Set<ForgeTask.ID>()
    @Published private var loadingGitCommitPreviewTaskIDs = Set<ForgeTask.ID>()
    @Published private var creatingGitCommitTaskIDs = Set<ForgeTask.ID>()
    @Published private var loadingGitPushPreviewTaskIDs = Set<ForgeTask.ID>()
    @Published private var pushingGitBranchTaskIDs = Set<ForgeTask.ID>()
    @Published private var loadingGitPullRequestPreviewTaskIDs = Set<ForgeTask.ID>()
    @Published private var gitFileDiffs: [String: GitFileDiff] = [:]
    @Published private var gitBranchPreviews: [ForgeTask.ID: GitBranchPreview] = [:]
    @Published private var gitBranchResults: [ForgeTask.ID: GitBranchResult] = [:]
    @Published private var gitBranchPublishPreviews: [ForgeTask.ID: GitBranchPublishPreview] = [:]
    @Published private var gitBranchPublishResults: [ForgeTask.ID: GitBranchPublishResult] = [:]
    @Published private var gitCommitPreviews: [ForgeTask.ID: GitCommitPreview] = [:]
    @Published private var gitCommitResults: [ForgeTask.ID: GitCreateCommitResult] = [:]
    @Published private var gitPushPreviews: [ForgeTask.ID: GitPushPreview] = [:]
    @Published private var gitPushResults: [ForgeTask.ID: GitPushResult] = [:]
    @Published private var gitPullRequestPreviews: [ForgeTask.ID: GitPullRequestPreview] = [:]
    @Published private var updatingModelProviderSettings = false

    private let runtime = RuntimeClient()
    private var eventStreamTask: Task<Void, Never>?
    private var runtimeProcess: Process?
    private var preferredRepositoryRoot: URL?
    private var pendingMissionControlTaskID: ForgeTask.ID?

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.missionControlRepositoriesKey),
           let decoded = try? JSONDecoder().decode([MissionControlRepositorySnapshot].self, from: data) {
            missionControlRepositories = Array(decoded.prefix(3))
        }
        if let path = UserDefaults.standard.string(forKey: Self.repositoryPreferenceKey), !path.isEmpty {
            preferredRepositoryRoot = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
            registerMissionControlRepository(path: preferredRepositoryRoot!.path(percentEncoded: false))
        }
    }

    var selectedTask: ForgeTask? {
        tasks.first { $0.id == selectedTaskID }
    }

    var runtimeEndpoint: String {
        runtime.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    var hasSelectedRepository: Bool {
        runtimeHealth?.workspace != nil ||
            preferredRepositoryRoot.map(repositoryRootIsUsable) == true
    }

    var missionControlCurrentRepositoryPath: String? {
        runtimeHealth?.workspace?.repoRoot ?? runtimeRepositoryRoot ?? preferredRepositoryRoot?.path(percentEncoded: false)
    }

    func openRepositoryOnGitHub() {
        guard let value = gitStatus?.repositoryWebURL,
              let url = URL(string: value),
              url.scheme == "https",
              url.host == "github.com"
        else {
            statusMessage = "No GitHub repository URL is available for this workspace."
            return
        }
        NSWorkspace.shared.open(url)
    }

    func connectRepository() {
        let panel = NSOpenPanel()
        panel.title = "Connect a Repository"
        panel.message = "Choose a local Git repository. Forge keeps repository access on this Mac."
        panel.prompt = "Connect Repository"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.treatsFilePackagesAsDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        selectRepository(url)
    }

    func useDemoRepository() {
        repositorySelectionMessage = "Preparing the local demo repository…"
        Task {
            do {
                let url = try await Self.createDemoRepository()
                selectRepository(url)
            } catch {
                repositorySelectionMessage = "Demo repository failed: \(error.localizedDescription)"
                statusMessage = repositorySelectionMessage ?? "Demo repository failed."
            }
        }
    }

    var canStartRuntimeProcess: Bool {
        switch runtimeProcessState {
        case .starting, .running, .external, .stopping:
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

        runtimeProcessCandidateDirectories = describeRuntimeLaunchCandidates()
        runtimeProcessLastOutput = nil
        runtimeProcessLaunchCommand = nil

        guard let launchResolution = resolveRuntimeLaunch() else {
            runtimeProcessState = .failed
            runtimeProcessMessage = "Could not resolve both a runtime directory and repository root. Checked \(runtimeProcessCandidateDirectories.count) candidate(s)."
            statusMessage = runtimeProcessMessage
            return
        }

        runtimeProcessState = .starting
        runtimeProcessMessage = "Building runtime before launch..."
        runtimeProcessDirectory = launchResolution.runtimeDirectory.path(percentEncoded: false)
        runtimeRepositoryRoot = launchResolution.repositoryRoot.path(percentEncoded: false)
        statusMessage = "Starting Forge runtime..."

        Task {
            do {
                if let health = try? await runtime.health(), health.ok {
                    markRuntimeAsExternal(health)
                    statusMessage = "Runtime already reachable; using external process."
                    return
                }

                if launchResolution.buildBeforeLaunch {
                    runtimeProcessLaunchCommand = "npm run build"
                    let buildOutput = try await Self.buildRuntime(at: launchResolution.runtimeDirectory)
                    runtimeProcessLastOutput = buildOutput
                } else {
                    runtimeProcessLastOutput = "Using prebuilt bundled runtime; npm build skipped."
                }
                try launchRuntimeNodeProcess(launchResolution)
                refreshRuntimeHealthAfterDelay()
            } catch {
                runtimeProcessState = .failed
                runtimeProcessMessage = runtimeStartFailureMessage(error)
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
        confirmRuntimeProcessStopped(pid: process.processIdentifier)
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
                markRuntimeAsExternalIfNeeded(health)
                try await refreshModelProviderSettingsSnapshot()
                statusMessage = statusMessage(for: runtimeState)
                try await refreshTasks()
                await refreshTaskQueueSnapshot()
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
                markExternalRuntimeDisconnectedIfNeeded(error)
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
                    markRuntimeAsExternalIfNeeded(health)
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
                    markRuntimeAsExternalIfNeeded(health)
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

    func approvePlan(for task: ForgeTask, maxSteps: Int = 6) {
        approvingTaskIDs.insert(task.id)
        runningAgentLoopTaskIDs.insert(task.id)
        statusMessage = "Approving plan and starting the bounded agent run."
        startEventStream()

        Task {
            do {
                let runningTask = try await runtime.approvePlanAndRun(taskID: task.id, maxSteps: maxSteps)
                upsert(runningTask)
                selectedTaskID = runningTask.id
                statusMessage = maxSteps == 1
                    ? (runningTask.queueRequest == nil ? "Approved plan entered a single-step reviewed agent run." : "Approved plan queued for a single-step reviewed run.")
                    : (runningTask.queueRequest == nil ? "Approved plan entered the bounded agent run." : "Approved plan queued behind the active repository task.")
                await refreshTaskQueueSnapshot()
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: runningTask.id)
                startEventStream()
            } catch {
                statusMessage = "Approve & run failed: \(error.localizedDescription)"
            }

            approvingTaskIDs.remove(task.id)
            runningAgentLoopTaskIDs.remove(task.id)
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

    func answerAgentQuestion(for task: ForgeTask, content: String) {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        sendingMessageTaskIDs.insert(task.id)
        if let loop = task.agentRunLoops.last {
            resumingAgentLoopIDs.insert(loop.id)
            runningAgentLoopTaskIDs.insert(task.id)
        }

        Task {
            do {
                let answeredTask = try await runtime.sendTaskMessage(taskID: task.id, content: trimmed)
                let pausedLoop = answeredTask.agentRunLoops.last(where: { ["Paused", "Failed"].contains($0.status) }) ??
                    task.agentRunLoops.last(where: { ["Paused", "Failed"].contains($0.status) })

                if let pausedLoop {
                    let resumedTask = try await runtime.resumeAgentLoop(
                        taskID: answeredTask.id,
                        loopID: pausedLoop.id,
                        preferredCommandID: nil,
                        maxSteps: pausedLoop.maxSteps
                    )
                    upsert(resumedTask)
                    selectedTaskID = resumedTask.id
                    statusMessage = "Decision recorded and agent loop resumed."
                } else {
                    upsert(answeredTask)
                    selectedTaskID = answeredTask.id
                    statusMessage = "Decision recorded. No paused loop required resuming."
                }

                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: task.id)
                startEventStream()
            } catch {
                statusMessage = "Answer & resume failed: \(error.localizedDescription)"
            }

            sendingMessageTaskIDs.remove(task.id)
            if let loop = task.agentRunLoops.last {
                resumingAgentLoopIDs.remove(loop.id)
            }
            runningAgentLoopTaskIDs.remove(task.id)
        }
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

    func rollbackEditProposal(for task: ForgeTask) {
        rollingBackEditProposalTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.rollbackEditProposal(taskID: task.id)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Edit proposal rolled back. Review the working tree."
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Rollback edit proposal failed: \(error.localizedDescription)"
            }

            rollingBackEditProposalTaskIDs.remove(task.id)
        }
    }

    func isRollingBackEditProposal(taskID: ForgeTask.ID) -> Bool {
        rollingBackEditProposalTaskIDs.contains(taskID)
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

    func reviewEditProposalFile(
        for task: ForgeTask,
        change: ProposedFileChange,
        decision: String,
        note: String? = nil
    ) {
        let key = "\(task.id):\(change.id)"
        reviewingEditProposalFileKeys.insert(key)
        Task {
            do {
                let updatedTask = try await runtime.reviewEditProposalFile(
                    taskID: task.id,
                    fileChangeID: change.id,
                    decision: decision,
                    note: note
                )
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = decision == "Approved"
                    ? "Approved \(change.path)."
                    : "Requested changes and generated a linked proposal revision."
                startEventStream()
            } catch {
                statusMessage = "File review failed: \(error.localizedDescription)"
            }
            reviewingEditProposalFileKeys.remove(key)
        }
    }

    func isReviewingEditProposalFile(taskID: ForgeTask.ID, fileChangeID: String) -> Bool {
        reviewingEditProposalFileKeys.contains("\(taskID):\(fileChangeID)")
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

    func runTaskCommand(for task: ForgeTask, commandID: String) {
        runningTaskCommandTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.runTaskCommand(taskID: task.id, commandID: commandID)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Task command completed."
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Run task command failed: \(error.localizedDescription)"
            }

            runningTaskCommandTaskIDs.remove(task.id)
        }
    }

    func isRunningTaskCommand(taskID: ForgeTask.ID) -> Bool {
        runningTaskCommandTaskIDs.contains(taskID)
    }

    func runAgentStep(for task: ForgeTask, preferredCommandID: String? = nil) {
        runningAgentStepTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.runAgentStep(
                    taskID: task.id,
                    preferredCommandID: preferredCommandID
                )
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Agent step completed."
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Run agent step failed: \(error.localizedDescription)"
            }

            runningAgentStepTaskIDs.remove(task.id)
        }
    }

    func isRunningAgentStep(taskID: ForgeTask.ID) -> Bool {
        runningAgentStepTaskIDs.contains(taskID)
    }

    func runAgentLoop(for task: ForgeTask, preferredCommandID: String? = nil, maxSteps: Int? = nil) {
        runningAgentLoopTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.runAgentLoop(
                    taskID: task.id,
                    preferredCommandID: preferredCommandID,
                    maxSteps: maxSteps
                )
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Agent loop completed."
                if updatedTask.queueRequest != nil {
                    statusMessage = "Agent loop queued behind the active repository task."
                }
                await refreshTaskQueueSnapshot()
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Run agent loop failed: \(error.localizedDescription)"
            }

            runningAgentLoopTaskIDs.remove(task.id)
        }
    }

    func isRunningAgentLoop(taskID: ForgeTask.ID) -> Bool {
        runningAgentLoopTaskIDs.contains(taskID)
    }

    func refreshTaskQueue() {
        Task { await refreshTaskQueueSnapshot() }
    }

    func refreshMissionControl() {
        Task {
            do {
                try await refreshTasks()
                await refreshTaskQueueSnapshot()
                await refreshGitStatusSnapshot()
                captureMissionControlSnapshot()
            } catch {
                statusMessage = "Refresh Mission Control failed: \(error.localizedDescription)"
                captureMissionControlSnapshot()
            }
        }
    }

    func pauseAllMissionControlLoops() {
        let running = tasks.compactMap { task -> (ForgeTask, AgentRunLoop)? in
            guard let loop = task.agentRunLoops.last(where: { $0.status == "Running" }) else { return nil }
            return (task, loop)
        }
        for (task, loop) in running {
            pauseAgentLoop(for: task, loop: loop)
        }
        statusMessage = running.isEmpty ? "No active Agent Loops to pause." : "Pause requested for \(running.count) active Agent Loop(s)."
    }

    func activateMissionControlRepository(_ path: String) {
        guard path != missionControlCurrentRepositoryPath else {
            statusMessage = "\(missionControlRepositoryName(path: path)) is already focused."
            return
        }
        pendingMissionControlTaskID = nil
        selectRepository(URL(fileURLWithPath: path, isDirectory: true))
    }

    func activateMissionControlRepositoryForTask(path: String, taskID: ForgeTask.ID) {
        if path == missionControlCurrentRepositoryPath {
            selectedTaskID = taskID
            return
        }
        pendingMissionControlTaskID = taskID
        selectRepository(URL(fileURLWithPath: path, isDirectory: true))
    }

    func updateTaskQueueConcurrency(_ limit: Int) {
        updatingTaskQueue = true
        Task {
            do {
                taskQueueSnapshot = try await runtime.updateTaskQueueConcurrency(limit)
                taskQueueLastError = nil
            } catch {
                taskQueueLastError = "Update queue concurrency failed: \(error.localizedDescription)"
            }
            updatingTaskQueue = false
        }
    }

    func moveQueuedTask(taskID: ForgeTask.ID, offset: Int) {
        guard let snapshot = taskQueueSnapshot,
              let index = snapshot.queued.firstIndex(where: { $0.taskID == taskID }) else { return }
        let target = index + offset
        guard snapshot.queued.indices.contains(target) else { return }
        var ids = snapshot.queued.map(\.taskID)
        ids.swapAt(index, target)
        updatingTaskQueue = true
        Task {
            do {
                taskQueueSnapshot = try await runtime.reorderTaskQueue(ids)
                taskQueueLastError = nil
            } catch {
                taskQueueLastError = "Reorder queue failed: \(error.localizedDescription)"
            }
            updatingTaskQueue = false
        }
    }

    func removeQueuedTask(taskID: ForgeTask.ID) {
        updatingTaskQueue = true
        Task {
            do {
                taskQueueSnapshot = try await runtime.removeTaskFromQueue(taskID: taskID)
                try await refreshTasks()
                taskQueueLastError = nil
            } catch {
                taskQueueLastError = "Remove queued task failed: \(error.localizedDescription)"
            }
            updatingTaskQueue = false
        }
    }

    func isUpdatingTaskQueue() -> Bool { updatingTaskQueue }

    func pauseAgentLoop(for task: ForgeTask, loop: AgentRunLoop) {
        pausingAgentLoopIDs.insert(loop.id)
        Task {
            do {
                let updatedTask = try await runtime.pauseAgentLoop(taskID: task.id, loopID: loop.id)
                upsert(updatedTask)
                statusMessage = "Agent loop pause requested."
            } catch {
                statusMessage = "Pause agent loop failed: \(error.localizedDescription)"
            }
            pausingAgentLoopIDs.remove(loop.id)
        }
    }

    func abortAgentLoop(for task: ForgeTask, loop: AgentRunLoop) {
        abortingAgentLoopIDs.insert(loop.id)
        Task {
            do {
                let updatedTask = try await runtime.abortAgentLoop(taskID: task.id, loopID: loop.id)
                upsert(updatedTask)
                statusMessage = "Agent loop abort requested."
            } catch {
                statusMessage = "Abort agent loop failed: \(error.localizedDescription)"
            }
            abortingAgentLoopIDs.remove(loop.id)
        }
    }

    func resumeAgentLoop(for task: ForgeTask, loop: AgentRunLoop, preferredCommandID: String? = nil) {
        resumingAgentLoopIDs.insert(loop.id)
        runningAgentLoopTaskIDs.insert(task.id)
        Task {
            do {
                let updatedTask = try await runtime.resumeAgentLoop(
                    taskID: task.id,
                    loopID: loop.id,
                    preferredCommandID: preferredCommandID,
                    maxSteps: loop.maxSteps
                )
                upsert(updatedTask)
                statusMessage = "Agent loop resume completed."
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Resume agent loop failed: \(error.localizedDescription)"
            }
            resumingAgentLoopIDs.remove(loop.id)
            runningAgentLoopTaskIDs.remove(task.id)
        }
    }

    func isPausingAgentLoop(loopID: AgentRunLoop.ID?) -> Bool {
        loopID.map(pausingAgentLoopIDs.contains) ?? false
    }

    func isAbortingAgentLoop(loopID: AgentRunLoop.ID?) -> Bool {
        loopID.map(abortingAgentLoopIDs.contains) ?? false
    }

    func isResumingAgentLoop(loopID: AgentRunLoop.ID?) -> Bool {
        loopID.map(resumingAgentLoopIDs.contains) ?? false
    }

    func rerunRepairCommand(for task: ForgeTask, evidence: CommandRerunEvidence) {
        rerunningRepairCommandEvidenceIDs.insert(evidence.id)

        Task {
            do {
                let updatedTask = try await runtime.rerunRepairCommand(
                    taskID: task.id,
                    commandRerunEvidenceID: evidence.id
                )
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Self-fix command rerun completed."
                await refreshGitStatusSnapshot()
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Rerun self-fix command failed: \(error.localizedDescription)"
            }

            rerunningRepairCommandEvidenceIDs.remove(evidence.id)
        }
    }

    func isRerunningRepairCommand(evidenceID: CommandRerunEvidence.ID?) -> Bool {
        guard let evidenceID else {
            return false
        }

        return rerunningRepairCommandEvidenceIDs.contains(evidenceID)
    }

    func cancelTaskCommand(for task: ForgeTask, run: TaskCommandRun? = nil) {
        let runningRun = run ?? task.taskCommandRuns.reversed().first { $0.status == "Running" }
        guard let runningRun else {
            statusMessage = "No running task command to cancel."
            return
        }

        cancellingTaskCommandRunIDs.insert(runningRun.id)

        Task {
            do {
                let updatedTask = try await runtime.cancelTaskCommand(
                    taskID: task.id,
                    taskCommandRunID: runningRun.id,
                    note: "Cancelled from Forge macOS app."
                )
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Task command cancellation requested."
                await refreshValidationPermissionSnapshotIfPossible(for: updatedTask.id)
                startEventStream()
            } catch {
                statusMessage = "Cancel task command failed: \(error.localizedDescription)"
            }

            cancellingTaskCommandRunIDs.remove(runningRun.id)
        }
    }

    func isCancellingTaskCommand(runID: TaskCommandRun.ID?) -> Bool {
        guard let runID else {
            return false
        }

        return cancellingTaskCommandRunIDs.contains(runID)
    }

    func validationPermissions(for taskID: ForgeTask.ID) -> [ValidationPresetPermission] {
        validationPermissionSnapshots[taskID] ?? []
    }

    func taskCommandPermissions(for taskID: ForgeTask.ID) -> [TaskCommandPermission] {
        taskCommandPermissionSnapshots[taskID] ?? []
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

    func refreshGitConflicts() {
        Task {
            await refreshGitConflictSnapshot()
        }
    }

    func resolveGitConflict(file: GitConflictFile, strategy: String, content: String?) {
        resolvingGitConflictPaths.insert(file.path)
        gitConflictLastError = nil

        Task {
            do {
                let taskID = selectedTaskID == ForgeTask.sample.id ? nil : selectedTaskID
                gitConflictLastResult = try await runtime.resolveGitConflict(
                    GitConflictResolutionRequest(
                        path: file.path,
                        strategy: strategy,
                        content: content,
                        expectedHead: gitConflictSnapshot?.head,
                        expectedConflictHash: file.conflictHash,
                        confirmation: "RESOLVE_GIT_CONFLICT",
                        taskID: taskID
                    )
                )
                await refreshGitStatusSnapshot()
                statusMessage = gitConflictLastResult?.summary ?? "Git conflict resolved and staged."
            } catch {
                gitConflictLastError = "Resolve git conflict failed: \(error.localizedDescription)"
            }

            resolvingGitConflictPaths.remove(file.path)
        }
    }

    func isResolvingGitConflict(path: String) -> Bool {
        resolvingGitConflictPaths.contains(path)
    }

    func prepareGitBranchReview(for task: ForgeTask, targetBranch: String? = nil) {
        loadingGitBranchPreviewTaskIDs.insert(task.id)

        Task {
            do {
                let taskID = task.id == ForgeTask.sample.id ? nil : task.id
                gitBranchPreviews[task.id] = try await runtime.gitBranchPreview(taskID: taskID, targetBranch: targetBranch)
                gitStatusLastError = nil
            } catch {
                gitStatusLastError = "Prepare branch review failed: \(error.localizedDescription)"
            }

            loadingGitBranchPreviewTaskIDs.remove(task.id)
        }
    }

    func gitBranchPreview(for taskID: ForgeTask.ID) -> GitBranchPreview? {
        gitBranchPreviews[taskID]
    }

    func isPreparingGitBranchReview(taskID: ForgeTask.ID) -> Bool {
        loadingGitBranchPreviewTaskIDs.contains(taskID)
    }

    func createOrSwitchGitBranch(for task: ForgeTask, preview: GitBranchPreview) {
        guard let expectedHead = preview.expectedHead,
              let expectedCurrentBranch = preview.currentBranch
        else {
            statusMessage = "Branch review is missing branch or expected git head."
            return
        }

        changingGitBranchTaskIDs.insert(task.id)

        Task {
            do {
                let taskID = task.id == ForgeTask.sample.id ? nil : task.id
                let request = GitBranchRequest(
                    taskID: taskID,
                    expectedHead: expectedHead,
                    expectedCurrentBranch: expectedCurrentBranch,
                    targetBranch: preview.targetBranch,
                    mode: preview.mode,
                    confirmation: preview.mode
                )
                let result = try await runtime.createOrSwitchGitBranch(request)
                gitBranchResults[task.id] = result
                gitBranchPreviews.removeValue(forKey: task.id)
                gitBranchPublishPreviews.removeValue(forKey: task.id)
                gitCommitPreviews.removeValue(forKey: task.id)
                gitPushPreviews.removeValue(forKey: task.id)
                gitPullRequestPreviews.removeValue(forKey: task.id)
                statusMessage = result.summary
                try await refreshTasks()
                await refreshGitStatusSnapshot()
                startEventStream()
            } catch {
                statusMessage = "Branch action failed: \(error.localizedDescription)"
            }

            changingGitBranchTaskIDs.remove(task.id)
        }
    }

    func gitBranchResult(for taskID: ForgeTask.ID) -> GitBranchResult? {
        gitBranchResults[taskID]
    }

    func isChangingGitBranch(taskID: ForgeTask.ID) -> Bool {
        changingGitBranchTaskIDs.contains(taskID)
    }

    func prepareGitBranchPublishReview(
        for task: ForgeTask,
        remote: String? = nil,
        remoteBranch: String? = nil
    ) {
        loadingGitBranchPublishPreviewTaskIDs.insert(task.id)

        Task {
            do {
                let taskID = task.id == ForgeTask.sample.id ? nil : task.id
                gitBranchPublishPreviews[task.id] = try await runtime.gitBranchPublishPreview(
                    taskID: taskID,
                    remote: remote,
                    remoteBranch: remoteBranch
                )
                gitStatusLastError = nil
            } catch {
                gitStatusLastError = "Prepare branch publish review failed: \(error.localizedDescription)"
            }

            loadingGitBranchPublishPreviewTaskIDs.remove(task.id)
        }
    }

    func gitBranchPublishPreview(for taskID: ForgeTask.ID) -> GitBranchPublishPreview? {
        gitBranchPublishPreviews[taskID]
    }

    func isPreparingGitBranchPublishReview(taskID: ForgeTask.ID) -> Bool {
        loadingGitBranchPublishPreviewTaskIDs.contains(taskID)
    }

    func publishGitBranch(for task: ForgeTask, preview: GitBranchPublishPreview) {
        guard let expectedHead = preview.expectedHead,
              let expectedBranch = preview.branch,
              let remote = preview.remote,
              let remoteBranch = preview.remoteBranch
        else {
            statusMessage = "Branch publish review is missing branch, remote, or expected git head."
            return
        }

        publishingGitBranchTaskIDs.insert(task.id)

        Task {
            do {
                let taskID = task.id == ForgeTask.sample.id ? nil : task.id
                let request = GitBranchPublishRequest(
                    taskID: taskID,
                    expectedHead: expectedHead,
                    expectedBranch: expectedBranch,
                    remote: remote,
                    remoteBranch: remoteBranch,
                    confirmation: "PublishCurrentBranch"
                )
                let result = try await runtime.publishGitBranch(request)
                gitBranchPublishResults[task.id] = result
                gitBranchPublishPreviews.removeValue(forKey: task.id)
                gitPushPreviews.removeValue(forKey: task.id)
                gitPullRequestPreviews.removeValue(forKey: task.id)
                statusMessage = result.summary
                try await refreshTasks()
                await refreshGitStatusSnapshot()
                startEventStream()
            } catch {
                statusMessage = "Branch publish failed: \(error.localizedDescription)"
            }

            publishingGitBranchTaskIDs.remove(task.id)
        }
    }

    func gitBranchPublishResult(for taskID: ForgeTask.ID) -> GitBranchPublishResult? {
        gitBranchPublishResults[taskID]
    }

    func isPublishingGitBranch(taskID: ForgeTask.ID) -> Bool {
        publishingGitBranchTaskIDs.contains(taskID)
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

    func createGitCommit(for task: ForgeTask, preview: GitCommitPreview) {
        guard let expectedHead = preview.expectedHead else {
            statusMessage = "Commit review is missing the expected git head."
            return
        }

        let paths = preview.includedFiles.map(\.path)
        guard !paths.isEmpty else {
            statusMessage = "Commit review has no files to commit."
            return
        }

        creatingGitCommitTaskIDs.insert(task.id)

        Task {
            do {
                let taskID = task.id == ForgeTask.sample.id ? nil : task.id
                let request = GitCreateCommitRequest(
                    taskID: taskID,
                    expectedHead: expectedHead,
                    title: preview.suggestedTitle,
                    body: preview.suggestedBody,
                    paths: paths,
                    confirmation: "CreateLocalCommit"
                )
                let result = try await runtime.createGitCommit(request)
                gitCommitResults[task.id] = result
                gitCommitPreviews.removeValue(forKey: task.id)
                statusMessage = result.summary
                try await refreshTasks()
                await refreshGitStatusSnapshot()
                startEventStream()
            } catch {
                statusMessage = "Create commit failed: \(error.localizedDescription)"
            }

            creatingGitCommitTaskIDs.remove(task.id)
        }
    }

    func gitCommitResult(for taskID: ForgeTask.ID) -> GitCreateCommitResult? {
        gitCommitResults[taskID]
    }

    func isCreatingGitCommit(taskID: ForgeTask.ID) -> Bool {
        creatingGitCommitTaskIDs.contains(taskID)
    }

    func prepareGitPushReview(for task: ForgeTask) {
        loadingGitPushPreviewTaskIDs.insert(task.id)

        Task {
            do {
                let taskID = task.id == ForgeTask.sample.id ? nil : task.id
                gitPushPreviews[task.id] = try await runtime.gitPushPreview(taskID: taskID)
                gitStatusLastError = nil
            } catch {
                gitStatusLastError = "Prepare push review failed: \(error.localizedDescription)"
            }

            loadingGitPushPreviewTaskIDs.remove(task.id)
        }
    }

    func gitPushPreview(for taskID: ForgeTask.ID) -> GitPushPreview? {
        gitPushPreviews[taskID]
    }

    func isPreparingGitPushReview(taskID: ForgeTask.ID) -> Bool {
        loadingGitPushPreviewTaskIDs.contains(taskID)
    }

    func pushGitBranch(for task: ForgeTask, preview: GitPushPreview) {
        guard let expectedHead = preview.expectedHead,
              let expectedBranch = preview.branch,
              let expectedUpstream = preview.upstream
        else {
            statusMessage = "Push review is missing branch, upstream, or expected git head."
            return
        }

        pushingGitBranchTaskIDs.insert(task.id)

        Task {
            do {
                let taskID = task.id == ForgeTask.sample.id ? nil : task.id
                let request = GitPushRequest(
                    taskID: taskID,
                    expectedHead: expectedHead,
                    expectedBranch: expectedBranch,
                    expectedUpstream: expectedUpstream,
                    confirmation: "PushCurrentBranch"
                )
                let result = try await runtime.pushGitBranch(request)
                gitPushResults[task.id] = result
                gitPushPreviews.removeValue(forKey: task.id)
                statusMessage = result.summary
                try await refreshTasks()
                await refreshGitStatusSnapshot()
                startEventStream()
            } catch {
                statusMessage = "Push failed: \(error.localizedDescription)"
            }

            pushingGitBranchTaskIDs.remove(task.id)
        }
    }

    func gitPushResult(for taskID: ForgeTask.ID) -> GitPushResult? {
        gitPushResults[taskID]
    }

    func isPushingGitBranch(taskID: ForgeTask.ID) -> Bool {
        pushingGitBranchTaskIDs.contains(taskID)
    }

    func prepareGitPullRequestReview(for task: ForgeTask) {
        loadingGitPullRequestPreviewTaskIDs.insert(task.id)

        Task {
            do {
                let taskID = task.id == ForgeTask.sample.id ? nil : task.id
                gitPullRequestPreviews[task.id] = try await runtime.gitPullRequestPreview(taskID: taskID)
                gitStatusLastError = nil
            } catch {
                gitStatusLastError = "Prepare PR review failed: \(error.localizedDescription)"
            }

            loadingGitPullRequestPreviewTaskIDs.remove(task.id)
        }
    }

    func gitPullRequestPreview(for taskID: ForgeTask.ID) -> GitPullRequestPreview? {
        gitPullRequestPreviews[taskID]
    }

    func isPreparingGitPullRequestReview(taskID: ForgeTask.ID) -> Bool {
        loadingGitPullRequestPreviewTaskIDs.contains(taskID)
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

    private func markRuntimeAsExternalIfNeeded(_ health: RuntimeHealth) {
        guard health.ok, runtimeProcess?.isRunning != true else {
            return
        }

        markRuntimeAsExternal(health)
    }

    private func markRuntimeAsExternal(_ health: RuntimeHealth) {
        runtimeProcess = nil
        runtimeProcessID = nil
        runtimeProcessState = .external
        runtimeProcessDirectory = nil
        runtimeRepositoryRoot = nil
        runtimeProcessMessage = "Runtime is reachable at \(runtimeEndpoint) but was not started by this app."
        runtimeProcessLaunchCommand = nil
        runtimeLastError = nil
        runtimeHealth = health
        runtimeState = classifyRuntimeState(health)
        runtimeLastCheckedAt = Date()
    }

    private func markExternalRuntimeDisconnectedIfNeeded(_ error: Error) {
        guard runtimeProcessState == .external, runtimeProcess?.isRunning != true else {
            return
        }

        runtimeProcessState = .notStarted
        runtimeProcessMessage = "External runtime is no longer reachable: \(error.localizedDescription)"
        runtimeProcessID = nil
        runtimeProcessDirectory = nil
    }

    private func runtimeStartFailureMessage(_ error: Error) -> String {
        var message = "Start failed: \(error.localizedDescription)"
        if let output = runtimeProcessLastOutput, !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            message += " Latest output is available in Runtime Settings diagnostics."
        }
        return message
    }

    private func launchRuntimeNodeProcess(_ launchResolution: RuntimeLaunchResolution) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [
            "node",
            "--disable-warning=ExperimentalWarning",
            "dist/server.js"
        ]
        process.currentDirectoryURL = launchResolution.runtimeDirectory

        var environment = ProcessInfo.processInfo.environment
        environment["FORGE_RUNTIME_PORT"] = "17373"
        environment["FORGE_REPO_ROOT"] = launchResolution.repositoryRoot.path(percentEncoded: false)
        process.environment = environment

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        captureRuntimeOutput(from: outputPipe, label: "stdout")
        captureRuntimeOutput(from: errorPipe, label: "stderr")

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
        runtimeProcessLaunchCommand = "FORGE_REPO_ROOT=\"\(launchResolution.repositoryRoot.path(percentEncoded: false))\" node --disable-warning=ExperimentalWarning dist/server.js"
        runtimeProcessMessage = "Runtime process \(process.processIdentifier) is running from \(launchResolution.runtimeDirectory.path) against \(launchResolution.repositoryRoot.path)."
        statusMessage = "Runtime process started."
    }

    private func captureRuntimeOutput(from pipe: Pipe, label: String) {
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }

            let text = String(decoding: data, as: UTF8.self)
            Task { @MainActor [weak self] in
                self?.appendRuntimeProcessOutput(text, label: label)
            }
        }
    }

    private func appendRuntimeProcessOutput(_ text: String, label: String) {
        let stamped = "[\(label)] \(text)"
        let combined = "\(runtimeProcessLastOutput ?? "")\(stamped)"
        if combined.count > Self.runtimeProcessOutputLimit {
            runtimeProcessLastOutput = String(combined.suffix(Self.runtimeProcessOutputLimit))
        } else {
            runtimeProcessLastOutput = combined
        }
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

    private func confirmRuntimeProcessStopped(pid: Int32) {
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard runtimeProcessState == .stopping,
                  runtimeProcessID == pid,
                  runtimeProcess?.isRunning == true
            else {
                return
            }

            runtimeProcessMessage = "Runtime process \(pid) is still stopping after 2.5s. Check diagnostics if it does not exit."
            statusMessage = runtimeProcessMessage
            runtimeProcess?.terminate()
        }
    }

    private func selectRepository(_ url: URL) {
        let standardized = url.standardizedFileURL
        guard repositoryRootIsUsable(standardized) else {
            repositorySelectionMessage = "Choose a folder containing .git or README.md."
            statusMessage = repositorySelectionMessage ?? "Repository selection failed."
            return
        }

        preferredRepositoryRoot = standardized
        let path = standardized.path(percentEncoded: false)
        registerMissionControlRepository(path: path)
        UserDefaults.standard.set(path, forKey: Self.repositoryPreferenceKey)
        runtimeRepositoryRoot = path
        repositorySelectionMessage = "Connected \(standardized.lastPathComponent). Starting the local runtime…"
        statusMessage = repositorySelectionMessage ?? "Repository connected."

        if canStartRuntimeProcess {
            startRuntimeProcess()
        } else if runtimeProcess?.isRunning == true {
            repositorySelectionMessage = "\(standardized.lastPathComponent) is saved. Restart the managed runtime to switch workspaces."
            statusMessage = repositorySelectionMessage ?? "Repository saved."
        } else {
            refreshRuntimeHealth()
        }
    }

    private nonisolated static func createDemoRepository() async throws -> URL {
        try await Task.detached(priority: .userInitiated) {
            let fileManager = FileManager.default
            let applicationSupport = try fileManager.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            let root = applicationSupport
                .appendingPathComponent("Forge", isDirectory: true)
                .appendingPathComponent("DemoTodo", isDirectory: true)
            let source = root.appendingPathComponent("src", isDirectory: true)
            try fileManager.createDirectory(at: source, withIntermediateDirectories: true)

            let files: [(String, String)] = [
                (
                    "README.md",
                    "# Forge Demo Todo\n\nA local sandbox repository for trying Forge. Nothing leaves this Mac.\n"
                ),
                (
                    "package.json",
                    "{\n  \"name\": \"forge-demo-todo\",\n  \"private\": true,\n  \"scripts\": { \"test\": \"node --test\" }\n}\n"
                ),
                (
                    "src/todos.js",
                    "export function addTodo(items, title) {\n  return [...items, { id: items.length + 1, title, done: false }];\n}\n"
                )
            ]
            for (relativePath, content) in files {
                let target = root.appendingPathComponent(relativePath)
                if !fileManager.fileExists(atPath: target.path) {
                    try Data(content.utf8).write(to: target, options: .atomic)
                }
            }

            let gitDirectory = root.appendingPathComponent(".git", isDirectory: true)
            if !fileManager.fileExists(atPath: gitDirectory.path) {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                process.arguments = ["git", "init", "--quiet", root.path(percentEncoded: false)]
                let errorPipe = Pipe()
                process.standardError = errorPipe
                try process.run()
                process.waitUntilExit()
                guard process.terminationStatus == 0 else {
                    let data = errorPipe.fileHandleForReading.readDataToEndOfFile()
                    let output = String(decoding: data, as: UTF8.self)
                    throw NSError(
                        domain: "ForgeDemoRepository",
                        code: Int(process.terminationStatus),
                        userInfo: [NSLocalizedDescriptionKey: output.isEmpty ? "git init failed" : output]
                    )
                }
            }

            return root
        }.value
    }

    private func resolveRuntimeLaunch() -> RuntimeLaunchResolution? {
        for runtimeDirectory in runtimeDirectoryCandidateURLs() {
            guard runtimeDirectoryIsUsable(runtimeDirectory),
                  let repositoryRoot = resolveRepositoryRoot(for: runtimeDirectory)
            else {
                continue
            }

            return RuntimeLaunchResolution(
                runtimeDirectory: runtimeDirectory,
                repositoryRoot: repositoryRoot,
                buildBeforeLaunch: runtimeDirectoryRequiresBuild(runtimeDirectory)
            )
        }

        return nil
    }

    private func runtimeDirectoryCandidateURLs() -> [URL] {
        let currentDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let bundleResources = Bundle.main.resourceURL
        let bundleParent = Bundle.main.bundleURL.deletingLastPathComponent()
        let bundledRepositoryRoot = bundleParent.deletingLastPathComponent()

        let explicitRuntime = ProcessInfo.processInfo.environment["FORGE_RUNTIME_DIR"]
            .flatMap { value in
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : URL(fileURLWithPath: trimmed, isDirectory: true)
            }

        return uniqueStandardizedURLs([
            explicitRuntime,
            bundleResources?.appendingPathComponent("runtime", isDirectory: true),
            currentDirectory.appendingPathComponent("runtime", isDirectory: true),
            bundledRepositoryRoot.appendingPathComponent("runtime", isDirectory: true),
            bundleParent.appendingPathComponent("runtime", isDirectory: true)
        ].compactMap { $0 })
    }

    private func repositoryRootCandidateURLs(for runtimeDirectory: URL) -> [URL] {
        let currentDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let bundleParent = Bundle.main.bundleURL.deletingLastPathComponent()
        let bundledRepositoryRoot = bundleParent.deletingLastPathComponent()
        let runtimeParent = runtimeDirectory.deletingLastPathComponent()

        let explicitRepository = ProcessInfo.processInfo.environment["FORGE_REPO_ROOT"]
            .flatMap { value in
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : URL(fileURLWithPath: trimmed, isDirectory: true)
            }

        return uniqueStandardizedURLs([
            preferredRepositoryRoot,
            explicitRepository,
            currentDirectory,
            currentDirectory.deletingLastPathComponent(),
            runtimeParent,
            runtimeParent.deletingLastPathComponent(),
            bundledRepositoryRoot,
            bundleParent
        ].compactMap { $0 })
    }

    private func resolveRepositoryRoot(for runtimeDirectory: URL) -> URL? {
        repositoryRootCandidateURLs(for: runtimeDirectory).first(where: repositoryRootIsUsable)
    }

    private func runtimeDirectoryIsUsable(_ runtimeDirectory: URL) -> Bool {
        let packageFile = runtimeDirectory.appendingPathComponent("package.json")
        let distServer = runtimeDirectory.appendingPathComponent("dist/server.js")
        let sourceServer = runtimeDirectory.appendingPathComponent("src/server.ts")
        return FileManager.default.fileExists(atPath: packageFile.path) &&
            (FileManager.default.fileExists(atPath: distServer.path) || FileManager.default.fileExists(atPath: sourceServer.path))
    }

    private func runtimeDirectoryRequiresBuild(_ runtimeDirectory: URL) -> Bool {
        let sourceServer = runtimeDirectory.appendingPathComponent("src/server.ts")
        let packageLock = runtimeDirectory.appendingPathComponent("package-lock.json")
        let bundledRuntime = Bundle.main.resourceURL?.appendingPathComponent("runtime", isDirectory: true).standardizedFileURL
        let isBundledRuntime = bundledRuntime.map { $0.path(percentEncoded: false) == runtimeDirectory.standardizedFileURL.path(percentEncoded: false) } ?? false
        return !isBundledRuntime &&
            FileManager.default.fileExists(atPath: sourceServer.path) &&
            FileManager.default.fileExists(atPath: packageLock.path)
    }

    private func repositoryRootIsUsable(_ root: URL) -> Bool {
        let gitDirectory = root.appendingPathComponent(".git")
        let readme = root.appendingPathComponent("README.md")
        return FileManager.default.fileExists(atPath: gitDirectory.path) ||
            FileManager.default.fileExists(atPath: readme.path)
    }

    private func uniqueStandardizedURLs(_ urls: [URL]) -> [URL] {
        var seen = Set<String>()
        var unique: [URL] = []
        for url in urls.map(\.standardizedFileURL) {
            let path = url.path(percentEncoded: false)
            if seen.insert(path).inserted {
                unique.append(url)
            }
        }
        return unique
    }

    private func describeRuntimeLaunchCandidates() -> [String] {
        runtimeDirectoryCandidateURLs().flatMap { runtimeDirectory in
            let packageFile = runtimeDirectory.appendingPathComponent("package.json")
            let distServer = runtimeDirectory.appendingPathComponent("dist/server.js")
            let sourceServer = runtimeDirectory.appendingPathComponent("src/server.ts")
            let runtimeStatus = [
                FileManager.default.fileExists(atPath: packageFile.path) ? "found package.json" : "missing package.json",
                FileManager.default.fileExists(atPath: distServer.path) ? "found dist/server.js" : "missing dist/server.js",
                FileManager.default.fileExists(atPath: sourceServer.path) ? "found src/server.ts" : "missing src/server.ts"
            ].joined(separator: ", ")
            let repoCandidates = repositoryRootCandidateURLs(for: runtimeDirectory)
                .map { repositoryRoot in
                    let repoStatus = repositoryRootIsUsable(repositoryRoot) ? "usable repo root" : "not a repo root"
                    return "  repo: \(repositoryRoot.path) (\(repoStatus))"
                }
            return ["runtime: \(runtimeDirectory.path) (\(runtimeStatus))"] + repoCandidates
        }
    }

    private nonisolated static func buildRuntime(at runtimeDirectory: URL) async throws -> String {
        try await Task.detached(priority: .userInitiated) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["npm", "run", "build"]
            process.currentDirectoryURL = runtimeDirectory

            let outputPipe = Pipe()
            let errorPipe = Pipe()
            process.standardOutput = outputPipe
            process.standardError = errorPipe

            let stdoutTask = Task.detached {
                outputPipe.fileHandleForReading.readDataToEndOfFile()
            }
            let stderrTask = Task.detached {
                errorPipe.fileHandleForReading.readDataToEndOfFile()
            }

            try process.run()
            process.waitUntilExit()

            let output = boundedProcessOutput(
                stdout: await stdoutTask.value,
                stderr: await stderrTask.value
            )

            guard process.terminationStatus == 0 else {
                throw RuntimeProcessError.buildFailed(process.terminationStatus, output)
            }

            return output.isEmpty ? "npm run build completed without output." : output
        }.value
    }

    private nonisolated static func boundedProcessOutput(stdout: Data, stderr: Data) -> String {
        let output = [
            String(data: stdout, encoding: .utf8).map { "[stdout]\n\($0)" },
            String(data: stderr, encoding: .utf8).map { "[stderr]\n\($0)" }
        ]
        .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .joined(separator: "\n\n")

        if output.count > runtimeProcessOutputLimit {
            return String(output.suffix(runtimeProcessOutputLimit))
        }

        return output
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
            "Runtime repository root: \(runtimeRepositoryRoot ?? runtimeHealth?.workspace?.repoRoot ?? "Unknown")",
            "Runtime launch command: \(runtimeProcessLaunchCommand ?? "None")",
            "Git status: \(gitStatus?.summary ?? "Unavailable")",
            "Git status error: \(gitStatusLastError ?? "None")",
            "Status message: \(statusMessage)",
            "Last checked: \(lastChecked)",
            "Last error: \(runtimeLastError ?? "None")",
            "Event stream: \(eventStreamState.rawValue)",
            "Event stream detail: \(eventStreamStatus)",
            "Diagnostics copied: \(copiedAt)"
        ]

        if runtimeProcessCandidateDirectories.isEmpty {
            lines.append("Runtime directory candidates: Not inspected")
        } else {
            lines.append("Runtime directory candidates:")
            lines.append(contentsOf: runtimeProcessCandidateDirectories.map { "- \($0)" })
        }

        if let runtimeProcessLastOutput,
           !runtimeProcessLastOutput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            lines.append("Runtime process output:")
            lines.append(runtimeProcessLastOutput)
        } else {
            lines.append("Runtime process output: None")
        }

        if let health {
            lines.append(contentsOf: [
                "Health ok: \(health.ok)",
                "Service: \(health.service)",
                "Version: \(health.version)",
                "Uptime seconds: \(Int(health.uptimeSeconds.rounded()))"
            ])

            if let workspace = health.workspace {
                lines.append("Runtime directory: \(workspace.runtimeDir)")
                lines.append("Repository root: \(workspace.repoRoot)")
                lines.append("Repository root source: \(workspace.repoRootSource)")
            }

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
            await refreshTaskQueueSnapshot()
            await refreshGitStatusSnapshot()
            await refreshValidationPermissionSnapshotIfPossible(for: selectedTaskID)
        } catch {
            statusMessage = "Refresh after event failed: \(error.localizedDescription)"
        }
    }

    private func refreshTasks() async throws {
        let remoteTasks = try await runtime.listTasks()
        tasks = remoteTasks
        if let pendingMissionControlTaskID,
           remoteTasks.contains(where: { $0.id == pendingMissionControlTaskID }) {
            selectedTaskID = pendingMissionControlTaskID
            self.pendingMissionControlTaskID = nil
        }
        if let selectedTaskID,
           !remoteTasks.contains(where: { $0.id == selectedTaskID }) {
            self.selectedTaskID = nil
        }
    }

    private func refreshTaskQueueSnapshot() async {
        do {
            taskQueueSnapshot = try await runtime.taskQueue()
            taskQueueLastError = nil
        } catch {
            taskQueueLastError = "Load task queue failed: \(error.localizedDescription)"
        }
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
            if gitStatus?.changedFiles.contains(where: { $0.status == "Unmerged" }) == true {
                await refreshGitConflictSnapshot()
            } else {
                gitConflictSnapshot = nil
                gitConflictLastError = nil
            }
            gitBranchPreviews.removeAll()
            gitBranchPublishPreviews.removeAll()
            gitCommitPreviews.removeAll()
            gitPushPreviews.removeAll()
            gitPullRequestPreviews.removeAll()
        } catch {
            gitStatus = nil
            gitConflictSnapshot = nil
            gitStatusLastError = error.localizedDescription
        }
        captureMissionControlSnapshot()
    }

    private func registerMissionControlRepository(path: String) {
        guard !path.isEmpty else { return }
        if missionControlRepositories.contains(where: { $0.path == path }) {
            return
        }
        if missionControlRepositories.count >= 3 {
            let current = missionControlCurrentRepositoryPath
            if let removable = missionControlRepositories.indices.reversed().first(where: { missionControlRepositories[$0].path != current }) {
                missionControlRepositories.remove(at: removable)
            } else {
                missionControlRepositories.removeLast()
            }
        }
        missionControlRepositories.append(MissionControlRepositorySnapshot(
            path: path,
            name: missionControlRepositoryName(path: path),
            state: "IDLE",
            footer: "not opened in this session",
            capturedAt: Date(),
            tasks: []
        ))
        persistMissionControlRepositories()
    }

    private func captureMissionControlSnapshot() {
        guard let path = missionControlCurrentRepositoryPath else { return }
        registerMissionControlRepository(path: path)
        let runningIDs = Set(taskQueueSnapshot?.running.map(\.taskID) ?? [])
        let queuedIDs = Set(taskQueueSnapshot?.queued.map(\.taskID) ?? [])
        let unsortedCards = tasks.map {
            missionControlTaskSnapshot($0, runningIDs: runningIDs, queuedIDs: queuedIDs)
        }
        let cards = unsortedCards.sorted { lhs, rhs in
            lhs.rank == rhs.rank ? lhs.taskID < rhs.taskID : lhs.rank < rhs.rank
        }
        let state: String
        if cards.contains(where: { $0.tag.contains("WAIT") }) { state = "NEEDS YOU" }
        else if cards.contains(where: { $0.tag == "RUNNING" }) { state = "RUNNING" }
        else if cards.contains(where: { $0.tag == "COMPLETE" }) { state = "READY" }
        else if cards.contains(where: { $0.tag == "QUEUED" }) { state = "QUEUED" }
        else { state = "IDLE" }
        let branch = gitStatus?.branch ?? "no branch"
        let changed = gitStatus?.changedFiles.count ?? 0
        let snapshot = MissionControlRepositorySnapshot(
            path: path,
            name: missionControlRepositoryName(path: path),
            state: state,
            footer: "\(branch) · \(changed) changed · \(tasks.count) tasks",
            capturedAt: Date(),
            tasks: cards
        )
        if let index = missionControlRepositories.firstIndex(where: { $0.path == path }) {
            missionControlRepositories[index] = snapshot
        } else {
            missionControlRepositories.append(snapshot)
        }
        persistMissionControlRepositories()
    }

    private func missionControlTaskSnapshot(
        _ task: ForgeTask,
        runningIDs: Set<String>,
        queuedIDs: Set<String>
    ) -> MissionControlTaskSnapshot {
        let loop = task.agentRunLoops.last
        let tag: String
        let rank: Int
        if runningIDs.contains(task.id) || loop?.status == "Running" {
            tag = "RUNNING"; rank = 0
        } else if task.status == "Human Review" {
            tag = "⏸ WAITING"; rank = 1
        } else if queuedIDs.contains(task.id) || task.queueRequest != nil {
            tag = "QUEUED"; rank = 2
        } else if task.status == "Completed" {
            tag = "COMPLETE"; rank = 3
        } else if task.status == "Failed" {
            tag = "FAILED"; rank = 4
        } else {
            tag = task.status.uppercased(); rank = 5
        }
        let progress: Double?
        if let loop, loop.maxSteps > 0, tag == "RUNNING" || tag.contains("WAIT") {
            progress = min(max(Double(loop.stepsRun) / Double(loop.maxSteps), 0), 1)
        } else {
            progress = nil
        }
        let step = loop.map { "step \($0.stepsRun)/\($0.maxSteps)" }
        let metaParts = [step, Optional(task.currentPhase)].compactMap { $0 }
        return MissionControlTaskSnapshot(
            taskID: task.id,
            title: task.title,
            tag: tag,
            phase: task.currentPhase,
            meta: metaParts.joined(separator: " · "),
            progress: progress,
            rank: rank
        )
    }

    private func persistMissionControlRepositories() {
        guard let data = try? JSONEncoder().encode(Array(missionControlRepositories.prefix(3))) else { return }
        UserDefaults.standard.set(data, forKey: Self.missionControlRepositoriesKey)
    }

    private func missionControlRepositoryName(path: String) -> String {
        let url = URL(fileURLWithPath: path, isDirectory: true)
        let parts = url.pathComponents.filter { $0 != "/" }.suffix(2)
        return parts.joined(separator: "/")
    }

    private func refreshGitConflictSnapshot() async {
        do {
            gitConflictSnapshot = try await runtime.gitConflicts()
            gitConflictLastError = nil
        } catch {
            gitConflictSnapshot = nil
            gitConflictLastError = "Load git conflicts failed: \(error.localizedDescription)"
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
            taskCommandPermissionSnapshots[taskID] = envelope.taskCommands
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
    case buildFailed(Int32, String)

    var errorDescription: String? {
        switch self {
        case .buildFailed(let status, let output):
            let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                return "Runtime build failed with exit status \(status)."
            }

            return "Runtime build failed with exit status \(status). \(trimmed)"
        }
    }
}

private struct RuntimeLaunchResolution {
    var runtimeDirectory: URL
    var repositoryRoot: URL
    var buildBeforeLaunch: Bool
}
