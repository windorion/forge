import Foundation

struct ForgeTask: Identifiable, Codable, Hashable {
    var id: String
    var title: String
    var objective: String
    var status: String
    var currentPhase: String
    var createdAt: String
    var updatedAt: String
    var agentStates: [AgentState]
    var planSteps: [PlanStep]
    var events: [RuntimeEvent]
    var changedFiles: [String]
    var reviewSummary: String?

    static let sample = ForgeTask(
        id: "local-demo",
        title: "Review Forge architecture docs",
        objective: "Use the project docs as the first local task and make the workspace shape visible.",
        status: "Planning",
        currentPhase: "Plan Review",
        createdAt: "local",
        updatedAt: "local",
        agentStates: [
            AgentState(role: "Manager", status: "Active", summary: "Holding task context"),
            AgentState(role: "Planner", status: "Ready", summary: "Waiting for runtime connection"),
            AgentState(role: "Coder", status: "Idle", summary: "No code changes requested"),
            AgentState(role: "Tester", status: "Idle", summary: "No validation command selected"),
            AgentState(role: "Reviewer", status: "Idle", summary: "No diff to review")
        ],
        planSteps: [
            PlanStep(id: "understand-objective", title: "Understand task objective", status: "Done", summary: "Local workspace shell is ready."),
            PlanStep(id: "build-context", title: "Build repository context", status: "Pending", summary: "Runtime connection required."),
            PlanStep(id: "draft-plan", title: "Draft implementation plan", status: "Pending", summary: "Waiting for runtime."),
            PlanStep(id: "request-review", title: "Request human review", status: "Pending", summary: "No plan ready yet.")
        ],
        events: [
            RuntimeEvent(type: "workspace.ready", message: "Forge workspace shell is ready.", createdAt: "local")
        ],
        changedFiles: [],
        reviewSummary: "No runtime review yet."
    )
}

struct AgentState: Codable, Hashable {
    var role: String
    var status: String
    var summary: String
}

struct PlanStep: Identifiable, Codable, Hashable {
    var id: String
    var title: String
    var status: String
    var summary: String
}

struct RuntimeEvent: Identifiable, Codable, Hashable {
    var id: String { "\(createdAt)-\(type)-\(message)" }
    var type: String
    var message: String
    var createdAt: String
}

struct RuntimeHealth: Codable, Hashable {
    var ok: Bool
    var service: String
    var version: String
    var uptimeSeconds: Double
}

struct CreateTaskRequest: Encodable {
    var title: String
    var objective: String
}

struct RuntimeStreamEvent: Hashable {
    var type: String
    var data: String
}
