import Foundation

@MainActor
final class WorkspaceModel: ObservableObject {
    @Published var tasks: [ForgeTask] = [.sample]
    @Published var selectedTaskID: ForgeTask.ID? = ForgeTask.sample.id
    @Published var runtimeHealth: RuntimeHealth?
    @Published var statusMessage = "Runtime not checked"
    @Published var eventStreamStatus = "Event stream disconnected"

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
