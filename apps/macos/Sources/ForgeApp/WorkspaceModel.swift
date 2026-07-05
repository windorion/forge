import Foundation

@MainActor
final class WorkspaceModel: ObservableObject {
    @Published var tasks: [ForgeTask] = [.sample]
    @Published var selectedTaskID: ForgeTask.ID? = ForgeTask.sample.id
    @Published var runtimeHealth: RuntimeHealth?
    @Published var validationPresets: [ValidationPreset] = []
    @Published var workspaceValidationPresetConfig: WorkspaceValidationPresetConfig?
    @Published var statusMessage = "Runtime not checked"
    @Published var eventStreamStatus = "Event stream disconnected"
    @Published private var validationPermissionSnapshots: [ForgeTask.ID: [ValidationPresetPermission]] = [:]
    @Published private var sendingMessageTaskIDs = Set<ForgeTask.ID>()
    @Published private var approvingTaskIDs = Set<ForgeTask.ID>()
    @Published private var generatingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var validatingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var applyingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var rejectingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var runningValidationTaskIDs = Set<ForgeTask.ID>()
    @Published private var approvingValidationPresetTaskIDs = Set<String>()

    private let runtime = RuntimeClient()
    private var eventStreamTask: Task<Void, Never>?

    var selectedTask: ForgeTask? {
        tasks.first { $0.id == selectedTaskID }
    }

    deinit {
        eventStreamTask?.cancel()
    }

    func refreshRuntimeHealth() {
        Task {
            do {
                runtimeHealth = try await runtime.health()
                statusMessage = "Runtime connected"
                try await refreshTasks()
                try await refreshValidationPresets()
                await refreshValidationPermissionSnapshotIfPossible(for: selectedTaskID)
                startEventStream()
            } catch {
                runtimeHealth = nil
                statusMessage = error.localizedDescription
                eventStreamStatus = "Event stream disconnected"
            }
        }
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

    func generateEditProposal(for task: ForgeTask) {
        generatingEditProposalTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.generateEditProposal(taskID: task.id)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Edit proposal ready for review."
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

    func refreshValidationPermissions(for taskID: ForgeTask.ID?) {
        Task {
            await refreshValidationPermissionSnapshotIfPossible(for: taskID)
        }
    }

    private func startEventStream() {
        eventStreamTask?.cancel()
        eventStreamStatus = "Event stream connecting"

        eventStreamTask = Task { [runtime] in
            do {
                for try await event in runtime.events() {
                    await handleRuntimeEvent(event)
                }
            } catch {
                await MainActor.run {
                    eventStreamStatus = "Event stream stopped: \(error.localizedDescription)"
                }
            }
        }
    }

    private func handleRuntimeEvent(_ event: RuntimeStreamEvent) async {
        eventStreamStatus = "Last event: \(event.type)"

        do {
            try await refreshTasks()
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

    private func validationPresetActionKey(taskID: ForgeTask.ID, presetID: ValidationPreset.ID) -> String {
        "\(taskID)-\(presetID)"
    }
}
