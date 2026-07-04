import Foundation

@MainActor
final class WorkspaceModel: ObservableObject {
    @Published var tasks: [ForgeTask] = [.sample]
    @Published var selectedTaskID: ForgeTask.ID? = ForgeTask.sample.id
    @Published var runtimeHealth: RuntimeHealth?
    @Published var statusMessage = "Runtime not checked"
    @Published var eventStreamStatus = "Event stream disconnected"
    @Published private var approvingTaskIDs = Set<ForgeTask.ID>()
    @Published private var generatingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var validatingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var applyingEditProposalTaskIDs = Set<ForgeTask.ID>()
    @Published private var rejectingEditProposalTaskIDs = Set<ForgeTask.ID>()

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

    func generateEditProposal(for task: ForgeTask) {
        generatingEditProposalTaskIDs.insert(task.id)

        Task {
            do {
                let updatedTask = try await runtime.generateEditProposal(taskID: task.id)
                upsert(updatedTask)
                selectedTaskID = updatedTask.id
                statusMessage = "Edit proposal ready for review."
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

    private func upsert(_ task: ForgeTask) {
        if let index = tasks.firstIndex(where: { $0.id == task.id }) {
            tasks[index] = task
        } else {
            tasks.insert(task, at: 0)
        }
    }
}
