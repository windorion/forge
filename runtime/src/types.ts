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
  action: "Approve Plan";
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

export interface ToolCall {
  id: string;
  name: string;
  status: "Started" | "Completed" | "Failed";
  input: string;
  outputSummary: string;
  startedAt: string;
  endedAt?: string;
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
  contextFiles: ContextFile[];
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
