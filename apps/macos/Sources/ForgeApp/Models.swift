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
    var events: [RuntimeEvent]

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
        events: [
            RuntimeEvent(type: "workspace.ready", message: "Forge workspace shell is ready.", createdAt: "local")
        ]
    )
}

struct AgentState: Codable, Hashable {
    var role: String
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
