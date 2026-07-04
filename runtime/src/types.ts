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
  action: "Approve Plan" | "Apply Edit Proposal" | "Reject Edit Proposal";
  decision: "Approved" | "Rejected";
  summary: string;
  decidedAt: string;
  userNote?: string;
}

export interface PlanStep {
  id: string;
  title: string;
  status: "Pending" | "Active" | "Done" | "Blocked";
  summary: string;
}

export interface ModelProviderInfo {
  id: string;
  name: string;
  model: string;
  mode: "local" | "remote";
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
  status: "Running" | "Passed" | "Failed";
  outputSummary: string;
  startedAt: string;
  endedAt?: string;
}

export interface ValidationRun {
  id: string;
  trigger: "PostApply" | "Manual";
  status: "Running" | "Passed" | "Failed";
  summary: string;
  startedAt: string;
  endedAt?: string;
  commands: ValidationCommandResult[];
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
