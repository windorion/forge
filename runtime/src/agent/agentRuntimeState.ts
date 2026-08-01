export interface ActiveAgentRunLoopControl {
  loopID: string;
  requestedAction?: "Pause" | "Abort";
  requestedAt?: string;
  note?: string;
}

export interface AgentRuntimeState {
  activeAgentRunLoops: Map<string, ActiveAgentRunLoopControl>;
}

export function createAgentRuntimeState(): AgentRuntimeState {
  return { activeAgentRunLoops: new Map() };
}
