import Foundation

@MainActor
final class WorkspaceModel: ObservableObject {
    @Published var tasks: [ForgeTask] = [.sample]
    @Published var selectedTaskID: ForgeTask.ID? = ForgeTask.sample.id
    @Published var runtimeHealth: RuntimeHealth?
    @Published var statusMessage = "Runtime not checked"

    private let runtime = RuntimeClient()

    var selectedTask: ForgeTask? {
        tasks.first { $0.id == selectedTaskID }
    }

    func refreshRuntimeHealth() {
        Task {
            do {
                runtimeHealth = try await runtime.health()
                statusMessage = "Runtime connected"
                try await refreshTasks()
            } catch {
                runtimeHealth = nil
                statusMessage = error.localizedDescription
            }
        }
    }

    func createDemoTask() {
        Task {
            do {
                let task = try await runtime.createTask(
                    title: "Create first Forge task",
                    objective: "Prove that the macOS app can create a task through the local runtime."
                )
                upsert(task)
                selectedTaskID = task.id
                statusMessage = "Task created through runtime"
            } catch {
                statusMessage = "Create task failed: \(error.localizedDescription)"
            }
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
