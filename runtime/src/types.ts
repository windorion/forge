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

export interface ForgeTask {
  id: string;
  title: string;
  objective: string;
  status: TaskStatus;
  currentPhase: string;
  createdAt: string;
  updatedAt: string;
  agentStates: AgentState[];
  events: RuntimeEvent[];
}

export interface CreateTaskRequest {
  title?: string;
  objective?: string;
}
