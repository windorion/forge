export type TaskStatus =
  | "Created"
  | "Planning"
  | "Plan Review"
  | "Running"
  | "Testing"
  | "Human Review"
  | "Completed"
  | "Failed";

export interface AgentState {
  role: "Manager" | "Planner" | "Coder" | "Tester" | "Reviewer";
  status: "Idle" | "Ready" | "Active" | "Blocked" | "Done";
  summary: string;
}

export interface RuntimeEvent {
  type: string;
  message: string;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  action:
    | "Approve Plan"
    | "Apply Edit Proposal"
    | "Reject Edit Proposal"
    | "Approve Validation Preset";
  decision: "Approved" | "Rejected";
  summary: string;
  decidedAt: string;
  targetID?: string;
  userNote?: string;
}

export interface PlanStep {
  id: string;
  title: string;
  status: "Pending" | "Active" | "Done" | "Blocked";
  summary: string;
}

export interface PlanRevision {
  id: string;
  provider: ModelProviderInfo;
  sourceMessageID?: string;
  intentSummary: string;
  summary: string;
  rationale: string;
  riskLevel: "Low" | "Medium" | "High";
  steps: PlanStep[];
  generatedAt: string;
}

export interface ModelProviderInfo {
  id: string;
  name: string;
  model: string;
  mode: "local" | "remote";
}

export interface IntentBrief {
  summary: string;
  constraints: string[];
  acceptanceCriteria: string[];
  openQuestions: string[];
  nextAction: string;
}

export interface TaskFileReference {
  id: string;
  requestedPath: string;
  path?: string;
  status: "Resolved" | "Missing" | "Blocked";
  summary: string;
  byteSize?: number;
  lineCount?: number;
  lineStart?: number;
  lineEnd?: number;
  detectedAt: string;
}

export interface TaskMessage {
  id: string;
  role: "User" | "Assistant";
  kind: "UserMessage" | "IntentBrief";
  content: string;
  createdAt: string;
  fileReferences: TaskFileReference[];
  provider?: ModelProviderInfo;
  intentBrief?: IntentBrief;
}

export interface ExecutionProposal {
  id: string;
  provider: ModelProviderInfo;
  summary: string;
  proposedActions: string[];
  riskLevel: "Low" | "Medium" | "High";
  generatedAt: string;
}

export interface ProposedFileChange {
  id: string;
  path: string;
  changeType: "Create" | "Modify" | "Delete";
  rationale: string;
  diffPreview: string;
  applyOperation?: ProposedFileOperation;
}

export interface AppendTextOperation {
  kind: "AppendText";
  text: string;
}

export type ProposedFileOperation = AppendTextOperation;

export interface EditProposalDecisionRequest {
  note?: string;
}

export type EditProposalValidationStatus = "Ready" | "Blocked";

export interface FileChangeValidation {
  id: string;
  path: string;
  status: EditProposalValidationStatus;
  summary: string;
  checks: string[];
}

export interface EditProposalValidation {
  status: EditProposalValidationStatus;
  summary: string;
  checkedAt: string;
  fileResults: FileChangeValidation[];
}

export interface EditProposal {
  id: string;
  provider: ModelProviderInfo;
  sourceMessageID?: string;
  revisionOfID?: string;
  revisionNumber: number;
  summary: string;
  fileChanges: ProposedFileChange[];
  riskLevel: "Low" | "Medium" | "High";
  status: "Proposed" | "Rejected" | "Superseded" | "Applied";
  generatedAt: string;
  decidedAt?: string;
  decisionNote?: string;
  validation?: EditProposalValidation;
}

export interface ToolCall {
  id: string;
  name: string;
  status: "Started" | "Completed" | "Failed";
  input: string;
  outputSummary: string;
  startedAt: string;
  endedAt?: string;
}

export interface ValidationCommandResult {
  id: string;
  name: string;
  command: string;
  kind: "BuiltIn" | "ProjectCommand";
  riskLevel: "Low" | "Medium" | "High";
  cwd?: string;
  status: "Running" | "Passed" | "Failed";
  outputSummary: string;
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
}

export interface ValidationRun {
  id: string;
  trigger: "PostApply" | "Manual";
  presetID: string;
  presetName: string;
  presetSource: "BuiltIn" | "Workspace";
  riskLevel: "Low" | "Medium" | "High";
  status: "Running" | "Passed" | "Failed";
  summary: string;
  startedAt: string;
  endedAt?: string;
  commands: ValidationCommandResult[];
}

export interface ValidationCommandDefinition {
  id: string;
  name: string;
  command: string;
  kind: "BuiltIn" | "ProjectCommand";
  riskLevel: "Low" | "Medium" | "High";
  cwd?: string;
  executionMode: "BuiltIn" | "SpawnNoShell";
  boundary: string;
}

export interface ValidationPreset {
  id: string;
  name: string;
  description: string;
  source: "BuiltIn" | "Workspace";
  riskLevel: "Low" | "Medium" | "High";
  requiresApproval: boolean;
  commands: ValidationCommandDefinition[];
}

export type ValidationPresetApprovalState = "NotRequired" | "NeedsApproval" | "Approved";
export type ValidationPresetExecutionState = "Blocked" | "NeedsApproval" | "Ready" | "Running";

export interface ValidationPermissionApproval {
  id: string;
  decidedAt: string;
  summary: string;
}

export interface ValidationPermissionLastRun {
  id: string;
  status: ValidationRun["status"];
  summary: string;
  startedAt: string;
  endedAt?: string;
}

export interface ValidationPresetPermission {
  preset: ValidationPreset;
  approvalState: ValidationPresetApprovalState;
  executionState: ValidationPresetExecutionState;
  canApprove: boolean;
  canRun: boolean;
  blockedReasons: string[];
  approval?: ValidationPermissionApproval;
  lastRun?: ValidationPermissionLastRun;
}

export interface ValidationPermissionEnvelope {
  taskID: string;
  taskStatus: TaskStatus;
  currentPhase: string;
  permissions: ValidationPresetPermission[];
}

export interface ContextFile {
  path: string;
  summary: string;
}

export interface ForgeTask {
  id: string;
  title: string;
  objective: string;
  status: TaskStatus;
  currentPhase: string;
  createdAt: string;
  updatedAt: string;
  agentStates: AgentState[];
  planSteps: PlanStep[];
  events: RuntimeEvent[];
  approvals: ApprovalRecord[];
  toolCalls: ToolCall[];
  validationRuns: ValidationRun[];
  messages: TaskMessage[];
  planRevisions: PlanRevision[];
  editProposalRevisions: EditProposal[];
  contextFiles: ContextFile[];
  executionProposal?: ExecutionProposal;
  editProposal?: EditProposal;
  changedFiles: string[];
  reviewSummary?: string;
}

export interface CreateTaskRequest {
  title?: string;
  objective?: string;
}

export interface ApprovePlanRequest {
  note?: string;
}

export interface ApproveValidationPresetRequest {
  presetID: string;
  note?: string;
}

export interface RunValidationRequest {
  presetID?: string;
}

export interface CreateTaskMessageRequest {
  content?: string;
}
