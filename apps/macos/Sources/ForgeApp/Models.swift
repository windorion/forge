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
    var approvals: [ApprovalRecord]
    var toolCalls: [ToolCall]
    var validationRuns: [ValidationRun]
    var messages: [TaskMessage]
    var planRevisions: [PlanRevision]
    var editProposalRevisions: [EditProposal]
    var contextFiles: [ContextFile]
    var executionProposal: ExecutionProposal?
    var editProposal: EditProposal?
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
        approvals: [],
        toolCalls: [],
        validationRuns: [],
        messages: [
            TaskMessage(
                id: "local-message",
                role: "Assistant",
                kind: "IntentBrief",
                content: "Connect the runtime to start a real task conversation.",
                createdAt: "local",
                fileReferences: [],
                provider: nil,
                intentBrief: nil
            )
        ],
        planRevisions: [],
        editProposalRevisions: [],
        contextFiles: [],
        executionProposal: nil,
        editProposal: nil,
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

struct PlanRevision: Identifiable, Codable, Hashable {
    var id: String
    var provider: ModelProviderInfo
    var sourceMessageID: String?
    var intentSummary: String
    var summary: String
    var rationale: String
    var riskLevel: String
    var steps: [PlanStep]
    var generatedAt: String
}

struct RuntimeEvent: Identifiable, Codable, Hashable {
    var id: String { "\(createdAt)-\(type)-\(message)" }
    var type: String
    var message: String
    var createdAt: String
}

struct ApprovalRecord: Identifiable, Codable, Hashable {
    var id: String
    var action: String
    var decision: String
    var summary: String
    var decidedAt: String
    var targetID: String?
    var userNote: String?
}

struct ToolCall: Identifiable, Codable, Hashable {
    var id: String
    var name: String
    var status: String
    var input: String
    var outputSummary: String
    var startedAt: String
    var endedAt: String?
}

struct ValidationCommandResult: Identifiable, Codable, Hashable {
    var id: String
    var name: String
    var command: String
    var kind: String
    var riskLevel: String
    var cwd: String?
    var status: String
    var outputSummary: String
    var exitCode: Int?
    var startedAt: String
    var endedAt: String?
}

struct ValidationRun: Identifiable, Codable, Hashable {
    var id: String
    var trigger: String
    var presetID: String
    var presetName: String
    var presetSource: String
    var riskLevel: String
    var status: String
    var summary: String
    var startedAt: String
    var endedAt: String?
    var commands: [ValidationCommandResult]
}

struct ValidationCommandDefinition: Identifiable, Codable, Hashable {
    var id: String
    var name: String
    var command: String
    var kind: String
    var riskLevel: String
    var cwd: String?
    var executionMode: String
    var boundary: String
}

struct ValidationPreset: Identifiable, Codable, Hashable {
    var id: String
    var name: String
    var description: String
    var source: String
    var riskLevel: String
    var requiresApproval: Bool
    var commands: [ValidationCommandDefinition]
}

struct WorkspaceValidationPresetConfig: Codable, Hashable {
    var path: String
    var exists: Bool
    var issues: [String]
}

struct ValidationPresetPermission: Identifiable, Codable, Hashable {
    var id: String { preset.id }
    var preset: ValidationPreset
    var approvalState: String
    var executionState: String
    var canApprove: Bool
    var canRun: Bool
    var blockedReasons: [String]
    var approval: ValidationPermissionApproval?
    var lastRun: ValidationPermissionLastRun?
}

struct ValidationPermissionApproval: Identifiable, Codable, Hashable {
    var id: String
    var decidedAt: String
    var summary: String
}

struct ValidationPermissionLastRun: Identifiable, Codable, Hashable {
    var id: String
    var status: String
    var summary: String
    var startedAt: String
    var endedAt: String?
}

struct ValidationPermissionEnvelope: Codable, Hashable {
    var taskID: String
    var taskStatus: String
    var currentPhase: String
    var permissions: [ValidationPresetPermission]
}

struct ContextFile: Identifiable, Codable, Hashable {
    var id: String { path }
    var path: String
    var summary: String
}

struct ModelProviderInfo: Codable, Hashable {
    var id: String
    var name: String
    var model: String
    var mode: String
}

struct ModelProviderConfigItem: Identifiable, Codable, Hashable {
    var id: String
    var label: String
    var value: String
    var isSecret: Bool
}

struct ModelProviderConfiguration: Codable, Hashable {
    var provider: ModelProviderInfo
    var configuredProviderID: String
    var status: String
    var summary: String
    var issues: [String]
    var settings: [ModelProviderConfigItem]
    var sendsRemoteContext: Bool
    var remoteContextSummary: String?
}

struct IntentBrief: Codable, Hashable {
    var summary: String
    var constraints: [String]
    var acceptanceCriteria: [String]
    var openQuestions: [String]
    var nextAction: String
}

struct TaskMessage: Identifiable, Codable, Hashable {
    var id: String
    var role: String
    var kind: String
    var content: String
    var createdAt: String
    var fileReferences: [TaskFileReference]
    var provider: ModelProviderInfo?
    var intentBrief: IntentBrief?
}

struct TaskFileReference: Identifiable, Codable, Hashable {
    var id: String
    var requestedPath: String
    var path: String?
    var status: String
    var summary: String
    var byteSize: Int?
    var lineCount: Int?
    var lineStart: Int?
    var lineEnd: Int?
    var detectedAt: String
}

struct ExecutionProposal: Identifiable, Codable, Hashable {
    var id: String
    var provider: ModelProviderInfo
    var summary: String
    var proposedActions: [String]
    var riskLevel: String
    var generatedAt: String
}

struct ProposedFileChange: Identifiable, Codable, Hashable {
    var id: String
    var path: String
    var changeType: String
    var rationale: String
    var diffPreview: String
    var applyOperation: ProposedFileOperation?
}

struct ProposedFileOperation: Codable, Hashable {
    var kind: String
    var text: String?
}

struct EditProposal: Identifiable, Codable, Hashable {
    var id: String
    var provider: ModelProviderInfo
    var sourceMessageID: String?
    var revisionOfID: String?
    var revisionNumber: Int
    var summary: String
    var fileChanges: [ProposedFileChange]
    var riskLevel: String
    var status: String
    var generatedAt: String
    var decidedAt: String?
    var decisionNote: String?
    var validation: EditProposalValidation?
}

struct EditProposalValidation: Codable, Hashable {
    var status: String
    var summary: String
    var checkedAt: String
    var fileResults: [FileChangeValidation]
}

struct FileChangeValidation: Identifiable, Codable, Hashable {
    var id: String
    var path: String
    var status: String
    var summary: String
    var checks: [String]
}

struct RuntimeHealth: Codable, Hashable {
    var ok: Bool
    var service: String
    var version: String
    var uptimeSeconds: Double
    var modelProvider: ModelProviderInfo?
    var modelProviderConfiguration: ModelProviderConfiguration?
}

struct CreateTaskRequest: Encodable {
    var title: String
    var objective: String
}

struct ApprovePlanRequest: Encodable {
    var note: String?
}

struct EditProposalDecisionRequest: Encodable {
    var note: String?
}

struct ApproveValidationPresetRequest: Encodable {
    var presetID: String
    var note: String?
}

struct RunValidationRequest: Encodable {
    var presetID: String?
}

struct CreateTaskMessageRequest: Encodable {
    var content: String
}

struct RuntimeStreamEvent: Hashable {
    var type: String
    var data: String
}
