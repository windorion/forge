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
    var agentRunLoops: [AgentRunLoop]
    var agentRunSteps: [AgentRunStep]
    var taskCommandRuns: [TaskCommandRun]
    var commandRerunEvidence: [CommandRerunEvidence]
    var validationRuns: [ValidationRun]
    var validationRepairBriefs: [ValidationRepairBrief]
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
        agentRunLoops: [],
        agentRunSteps: [],
        taskCommandRuns: [],
        commandRerunEvidence: [],
        validationRuns: [],
        validationRepairBriefs: [],
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

struct AgentRunStep: Identifiable, Codable, Hashable {
    var id: String
    var provider: ModelProviderInfo
    var loopID: String?
    var action: String
    var status: String
    var summary: String
    var rationale: String
    var commandID: String?
    var commandName: String?
    var commandRerunEvidenceID: String?
    var searchTerms: [String]?
    var readPaths: [String]?
    var contextFilePaths: [String]?
    var inspectionRequestFingerprint: String?
    var inspectionBudgetSummary: String?
    var inspectionSearchMode: String?
    var inspectionSearchEngine: String?
    var inspectionQuality: String?
    var inspectionQualitySummary: String?
    var inspectionMatchCount: Int?
    var inspectionMatchedFileCount: Int?
    var inspectionNewContextFileCount: Int?
    var inspectionContextByteCount: Int?
    var inspectionQueryCoverage: Double?
    var providerAttemptCount: Int?
    var providerOutputRecovered: Bool?
    var providerAttemptErrors: [String]?
    var targetID: String?
    var resultSummary: String?
    var error: String?
    var createdAt: String
    var completedAt: String?
}

struct AgentRunLoop: Identifiable, Codable, Hashable {
    var id: String
    var provider: ModelProviderInfo
    var status: String
    var maxSteps: Int
    var stepsRun: Int
    var stepIDs: [String]
    var preferredCommandID: String?
    var resumedFromLoopID: String?
    var resumedByLoopID: String?
    var controlState: String?
    var controlRequestedAt: String?
    var controlNote: String?
    var stopReason: String?
    var summary: String
    var startedAt: String
    var completedAt: String?
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

struct TaskCommandOutputChunk: Identifiable, Codable, Hashable {
    var id: String
    var stream: String
    var text: String
    var createdAt: String
}

struct TaskCommandRun: Identifiable, Codable, Hashable {
    var id: String
    var commandID: String
    var name: String
    var command: String
    var kind: String
    var riskLevel: String
    var cwd: String?
    var presetID: String?
    var presetName: String?
    var status: String
    var outputSummary: String
    var outputChunks: [TaskCommandOutputChunk]
    var exitCode: Int?
    var startedAt: String
    var endedAt: String?
}

struct CommandRerunEvidence: Identifiable, Codable, Hashable {
    var id: String
    var sourceTaskCommandRunID: String
    var validationRepairBriefID: String
    var repairProposalID: String
    var repairAppliedAt: String?
    var rerunTaskCommandRunID: String?
    var commandID: String
    var commandName: String
    var status: String
    var summary: String
    var createdAt: String
    var updatedAt: String
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

struct ValidationRepairBrief: Identifiable, Codable, Hashable {
    var id: String
    var provider: ModelProviderInfo
    var validationRunID: String?
    var taskCommandRunID: String?
    var source: String?
    var sourceSummary: String?
    var summary: String
    var likelyCause: String
    var recommendedActions: [String]
    var followUpPrompt: String
    var riskLevel: String
    var generatedAt: String
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

struct TaskCommandPermissionLastRun: Identifiable, Codable, Hashable {
    var id: String
    var status: String
    var summary: String
    var startedAt: String
    var endedAt: String?
}

struct TaskCommandPermission: Identifiable, Codable, Hashable {
    var id: String { command.id }
    var command: ValidationCommandDefinition
    var presetID: String
    var presetName: String
    var presetSource: String
    var presetRiskLevel: String
    var approvalState: String
    var executionState: String
    var canRun: Bool
    var blockedReasons: [String]
    var approval: ValidationPermissionApproval?
    var lastRun: TaskCommandPermissionLastRun?
}

struct ValidationPermissionEnvelope: Codable, Hashable {
    var taskID: String
    var taskStatus: String
    var currentPhase: String
    var permissions: [ValidationPresetPermission]
    var taskCommands: [TaskCommandPermission]
}

struct GitFileChange: Identifiable, Codable, Hashable {
    var id: String { path }
    var path: String
    var status: String
    var indexStatus: String
    var worktreeStatus: String
    var staged: Bool
    var unstaged: Bool
    var untracked: Bool
    var oldPath: String?
    var additions: Int?
    var deletions: Int?
}

struct GitStatusSnapshot: Codable, Hashable {
    var isRepository: Bool
    var root: String?
    var branch: String?
    var upstream: String?
    var head: String?
    var ahead: Int?
    var behind: Int?
    var isDirty: Bool
    var summary: String
    var generatedAt: String
    var changedFiles: [GitFileChange]
    var error: String?
}

struct GitFileDiff: Codable, Hashable {
    var path: String
    var oldPath: String?
    var status: String?
    var generatedAt: String
    var diff: String
    var truncated: Bool
    var displayMode: String?
    var unavailableReason: String?
    var byteCount: Int?
    var lineCount: Int?
    var appPreviewLineLimit: Int?
    var summary: String
}

struct GitCommitRelatedTask: Codable, Hashable {
    var id: String
    var title: String
    var status: String
    var currentPhase: String
    var summary: String
}

struct GitCommitPreview: Codable, Hashable {
    var generatedAt: String
    var readiness: String
    var summary: String
    var expectedHead: String?
    var suggestedTitle: String
    var suggestedBody: [String]
    var includedFiles: [GitFileChange]
    var relatedTask: GitCommitRelatedTask?
    var validationSummary: String
    var validationCommands: [String]
    var preflight: GitCommitPreflight?
    var riskNotes: [String]
    var blockers: [String]
    var operationBoundary: String
}

struct GitCommitPreflight: Codable, Hashable {
    var identityStatus: String
    var identitySummary: String
    var stagedFileCount: Int
    var unstagedFileCount: Int
    var untrackedFileCount: Int
    var totalAdditions: Int
    var totalDeletions: Int
    var filesWithoutStats: Int
    var largeChangeSet: Bool
    var largeChangeSummary: String?
    var validationState: String
    var hookRiskSummary: String
    var pathLimit: Int
}

struct GitCreateCommitRequest: Codable, Hashable {
    var taskID: String?
    var expectedHead: String
    var title: String
    var body: [String]
    var paths: [String]
    var confirmation: String
}

struct GitCreateCommitResult: Codable, Hashable {
    var generatedAt: String
    var commitHash: String
    var shortHash: String
    var branch: String?
    var summary: String
    var messageTitle: String
    var messageBody: [String]
    var committedFiles: [GitFileChange]
    var relatedTask: GitCommitRelatedTask?
    var operationBoundary: String
}

struct GitCommitToPush: Identifiable, Codable, Hashable {
    var id: String { hash }
    var hash: String
    var shortHash: String
    var title: String
    var authorDate: String?
}

struct GitPushPreview: Codable, Hashable {
    var generatedAt: String
    var readiness: String
    var summary: String
    var preflight: GitPushPreflight?
    var expectedHead: String?
    var branch: String?
    var upstream: String?
    var remote: String?
    var remoteBranch: String?
    var ahead: Int?
    var behind: Int?
    var isDirty: Bool
    var commitsToPush: [GitCommitToPush]
    var changedFiles: [GitFileChange]
    var relatedTask: GitCommitRelatedTask?
    var riskNotes: [String]
    var blockers: [String]
    var operationBoundary: String
}

struct GitPushPreflight: Codable, Hashable {
    var branchStatus: String
    var branchSummary: String
    var upstreamStatus: String
    var upstreamSummary: String
    var remoteStatus: String
    var remoteSummary: String
    var commitStatus: String
    var commitSummary: String
    var worktreeStatus: String
    var worktreeSummary: String
    var actionReadiness: String
    var actionReadinessSummary: String
    var failureRiskSummary: String
}

struct GitPushRequest: Codable, Hashable {
    var taskID: String?
    var expectedHead: String
    var expectedBranch: String
    var expectedUpstream: String
    var confirmation: String
}

struct GitPushResult: Codable, Hashable {
    var generatedAt: String
    var branch: String
    var upstream: String
    var remote: String
    var remoteBranch: String
    var pushedCommits: [GitCommitToPush]
    var summary: String
    var outputSummary: String
    var relatedTask: GitCommitRelatedTask?
    var operationBoundary: String
}

struct GitBranchPreview: Codable, Hashable {
    var generatedAt: String
    var readiness: String
    var summary: String
    var preflight: GitBranchPreflight?
    var expectedHead: String?
    var currentBranch: String?
    var baseBranch: String
    var targetBranch: String
    var mode: String
    var branchExists: Bool
    var isDirty: Bool
    var changedFiles: [GitFileChange]
    var relatedTask: GitCommitRelatedTask?
    var riskNotes: [String]
    var blockers: [String]
    var operationBoundary: String
}

struct GitBranchPreflight: Codable, Hashable {
    var targetStatus: String
    var targetSummary: String
    var currentBranchStatus: String
    var currentBranchSummary: String
    var worktreeStatus: String
    var worktreeSummary: String
    var existingBranchStatus: String
    var existingBranchSummary: String
    var actionReadiness: String
    var actionReadinessSummary: String
}

struct GitBranchRequest: Codable, Hashable {
    var taskID: String?
    var expectedHead: String
    var expectedCurrentBranch: String
    var targetBranch: String
    var mode: String
    var confirmation: String
}

struct GitBranchResult: Codable, Hashable {
    var generatedAt: String
    var previousBranch: String?
    var branch: String
    var mode: String
    var summary: String
    var outputSummary: String
    var relatedTask: GitCommitRelatedTask?
    var operationBoundary: String
}

struct GitBranchPublishPreview: Codable, Hashable {
    var generatedAt: String
    var readiness: String
    var summary: String
    var preflight: GitBranchPublishPreflight?
    var expectedHead: String?
    var branch: String?
    var baseBranch: String
    var remote: String?
    var remoteBranch: String?
    var upstream: String?
    var isDirty: Bool
    var commitsToPublish: [GitCommitToPush]
    var changedFiles: [GitFileChange]
    var relatedTask: GitCommitRelatedTask?
    var riskNotes: [String]
    var blockers: [String]
    var operationBoundary: String
}

struct GitBranchPublishPreflight: Codable, Hashable {
    var branchStatus: String
    var branchSummary: String
    var remoteStatus: String
    var remoteSummary: String
    var baseStatus: String
    var baseSummary: String
    var commitStatus: String
    var commitSummary: String
    var worktreeStatus: String
    var worktreeSummary: String
    var actionReadiness: String
    var actionReadinessSummary: String
    var failureRiskSummary: String
}

struct GitBranchPublishRequest: Codable, Hashable {
    var taskID: String?
    var expectedHead: String
    var expectedBranch: String
    var remote: String
    var remoteBranch: String
    var confirmation: String
}

struct GitBranchPublishResult: Codable, Hashable {
    var generatedAt: String
    var branch: String
    var remote: String
    var remoteBranch: String
    var upstream: String
    var pushedCommits: [GitCommitToPush]
    var summary: String
    var outputSummary: String
    var relatedTask: GitCommitRelatedTask?
    var operationBoundary: String
}

struct GitPullRequestPreview: Codable, Hashable {
    var generatedAt: String
    var readiness: String
    var summary: String
    var preflight: GitPullRequestPreflight?
    var baseBranch: String
    var headBranch: String?
    var upstream: String?
    var remote: String?
    var remoteBranch: String?
    var suggestedBranchName: String
    var title: String
    var body: [String]
    var testPlan: [String]
    var commits: [GitCommitToPush]
    var changedFiles: [GitFileChange]
    var relatedTask: GitCommitRelatedTask?
    var riskNotes: [String]
    var blockers: [String]
    var operationBoundary: String
}

struct GitPullRequestPreflight: Codable, Hashable {
    var baseRefStatus: String
    var baseRefSummary: String
    var headBranchStatus: String
    var headBranchSummary: String
    var upstreamStatus: String
    var upstreamSummary: String
    var remoteStatus: String
    var remoteSummary: String
    var validationState: String
    var validationSummary: String
    var testEvidence: [String]
    var publishReadinessSummary: String
}

struct ContextFile: Identifiable, Codable, Hashable {
    var id: String { path }
    var path: String
    var summary: String
    var byteLength: Int?
    var contentSha256: String?
    var matchedLineCount: Int?
    var matchReasons: [String]?
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

struct ModelProviderEditableSettings: Codable, Hashable {
    var providerID: String
    var modelName: String?
    var openAIBaseURL: String?
    var openAITimeoutMs: Int?
    var openAIMaxOutputTokens: Int?
    var hasOpenAIAPIKey: Bool
    var settingsPath: String
}

struct ModelProviderSettingsEnvelope: Codable, Hashable {
    var configuration: ModelProviderConfiguration
    var editableSettings: ModelProviderEditableSettings
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
    var contextFiles: [ContextFile]?
    var toolEvidence: [String]?
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
    var findText: String?
    var replaceWith: String?
    var hunks: [PatchTextHunk]?
    var patch: String?
    var content: String?
}

struct PatchTextHunk: Codable, Hashable {
    var findText: String
    var replaceWith: String
}

struct EditProposal: Identifiable, Codable, Hashable {
    var id: String
    var provider: ModelProviderInfo
    var sourceMessageID: String?
    var revisionOfID: String?
    var validationRepairBriefID: String?
    var revisionNumber: Int
    var summary: String
    var fileChanges: [ProposedFileChange]
    var riskLevel: String
    var status: String
    var generatedAt: String
    var decidedAt: String?
    var decisionNote: String?
    var requiresFileReview: Bool?
    var fileDecisions: [EditProposalFileDecision]?
    var rolledBackAt: String?
    var rollbackNote: String?
    var validation: EditProposalValidation?
    var appliedFileChanges: [AppliedFileChange]?
    var applyTransaction: EditProposalFileTransaction?
    var rollbackTransaction: EditProposalFileTransaction?
}

struct EditProposalFileDecision: Codable, Hashable {
    var fileChangeID: String
    var path: String
    var decision: String
    var note: String?
    var decidedAt: String
}

struct EditProposalFileTransaction: Identifiable, Codable, Hashable {
    var id: String
    var kind: String
    var status: String
    var paths: [String]
    var summary: String
    var startedAt: String
    var completedAt: String?
    var verifiedAt: String?
    var recoverySummary: String?
}

struct AppliedFileChange: Identifiable, Codable, Hashable {
    var id: String { proposalFileChangeID ?? "\(path)-\(appliedAt)" }
    var path: String
    var operationKind: String
    var rollbackKind: String
    var rollbackSummary: String
    var appliedAt: String
    var proposalFileChangeID: String?
    var beforeSha256: String?
    var afterSha256: String?
    var beforeByteLength: Int?
    var afterByteLength: Int?
    var rollbackSnapshotPath: String?
    var applyVerifiedAt: String?
    var rolledBackAt: String?
    var rollbackVerifiedAt: String?
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
    var workspace: RuntimeWorkspaceInfo?
    var persistence: RuntimePersistenceInfo?
}

struct RuntimeWorkspaceInfo: Codable, Hashable {
    var runtimeDir: String
    var repoRoot: String
    var repoRootSource: String
}

struct RuntimePersistenceInfo: Codable, Hashable {
    var databasePath: String
    var taskCount: Int
}

enum RuntimeConnectionState: String, Hashable {
    case unchecked = "Unchecked"
    case checking = "Checking"
    case running = "Running"
    case needsProviderConfiguration = "Needs Provider Configuration"
    case wrongVersion = "Wrong Version"
    case disconnected = "Disconnected"
}

enum RuntimeEventStreamState: String, Hashable {
    case disconnected = "Disconnected"
    case connecting = "Connecting"
    case connected = "Connected"
}

enum RuntimeProcessState: String, Hashable {
    case notStarted = "Not Started"
    case starting = "Starting"
    case running = "Running"
    case external = "External"
    case stopping = "Stopping"
    case stopped = "Stopped"
    case failed = "Failed"
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

struct EditProposalFileReviewRequest: Encodable {
    var fileChangeID: String
    var decision: String
    var note: String?
}

struct ApproveValidationPresetRequest: Encodable {
    var presetID: String
    var note: String?
}

struct RunValidationRequest: Encodable {
    var presetID: String?
}

struct RunTaskCommandRequest: Encodable {
    var commandID: String
}

struct RunAgentStepRequest: Encodable {
    var preferredCommandID: String?
}

struct RunAgentLoopRequest: Encodable {
    var preferredCommandID: String?
    var maxSteps: Int?
    var resumeLoopID: String?
}

struct AgentRunLoopControlRequest: Encodable {
    var loopID: String?
    var note: String?
}

struct CancelTaskCommandRequest: Encodable {
    var taskCommandRunID: String?
    var note: String?
}

struct RerunRepairCommandRequest: Encodable {
    var commandRerunEvidenceID: String?
}

struct CreateTaskMessageRequest: Encodable {
    var content: String
}

struct UpdateModelProviderSettingsRequest: Encodable {
    var providerID: String?
    var modelName: String?
    var openAIBaseURL: String?
    var openAITimeoutMs: Int?
    var openAIMaxOutputTokens: Int?
    var openAIAPIKey: String?
    var clearOpenAIAPIKey: Bool?

    enum CodingKeys: String, CodingKey {
        case providerID
        case modelName
        case openAIBaseURL
        case openAITimeoutMs
        case openAIMaxOutputTokens
        case openAIAPIKey
        case clearOpenAIAPIKey
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        try container.encodeIfPresent(providerID, forKey: .providerID)
        try encodeClearingField(modelName, forKey: .modelName, in: &container)
        try encodeClearingField(openAIBaseURL, forKey: .openAIBaseURL, in: &container)
        try encodeClearingField(openAITimeoutMs, forKey: .openAITimeoutMs, in: &container)
        try encodeClearingField(openAIMaxOutputTokens, forKey: .openAIMaxOutputTokens, in: &container)
        try container.encodeIfPresent(openAIAPIKey, forKey: .openAIAPIKey)
        try container.encodeIfPresent(clearOpenAIAPIKey, forKey: .clearOpenAIAPIKey)
    }

    private func encodeClearingField<T: Encodable>(
        _ value: T?,
        forKey key: CodingKeys,
        in container: inout KeyedEncodingContainer<CodingKeys>
    ) throws {
        if let value {
            try container.encode(value, forKey: key)
        } else {
            try container.encodeNil(forKey: key)
        }
    }
}

struct RuntimeStreamEvent: Hashable {
    var type: String
    var data: String
}
