// Pure detection of agent work that has been in a non-terminal state for too
// long. The runtime has per-command timeouts, and it recovers loops that were
// Running when the process restarted — but a live runtime whose step wedges
// (a stalled provider socket, a tool that never settles) has nothing watching
// it. This module decides *what* is stuck; the caller decides what to do about
// it. Pure and unit-testable: no clock, no I/O.

export interface StuckThresholds {
  /** An agent step Running longer than this is considered stuck. */
  stepMs: number;
  /** A task command / validation run Running longer than this is stuck. */
  commandRunMs: number;
  /** A tool call Started longer than this is stuck. */
  toolCallMs: number;
}

export const defaultStuckThresholds: StuckThresholds = {
  stepMs: 15 * 60_000,
  commandRunMs: 20 * 60_000,
  toolCallMs: 10 * 60_000
};

export interface StuckCandidateInput {
  agentRunSteps: { id: string; status: string; createdAt: string; loopID?: string }[];
  agentRunLoops: { id: string; status: string; startedAt: string; stepIDs: string[] }[];
  taskCommandRuns: { id: string; status: string; startedAt?: string }[];
  validationRuns: { id: string; status: string; startedAt?: string }[];
  toolCalls: { id: string; status: string; startedAt?: string }[];
}

export interface StuckFinding {
  kind: "AgentRunStep" | "AgentRunLoop" | "TaskCommandRun" | "ValidationRun" | "ToolCall";
  id: string;
  /** Whole minutes the item has been non-terminal, for human-readable evidence. */
  stalledMinutes: number;
  reason: string;
}

/** Milliseconds between `since` and `now`, or null when `since` is unusable. */
function elapsedMs(since: string | undefined, now: number): number | null {
  if (!since) {
    return null;
  }
  const started = Date.parse(since);
  if (Number.isNaN(started)) {
    return null;
  }
  const elapsed = now - started;
  // A timestamp in the future (clock skew) is never treated as stuck.
  return elapsed < 0 ? null : elapsed;
}

function minutes(ms: number): number {
  return Math.floor(ms / 60_000);
}

/**
 * Find non-terminal work that has exceeded its threshold. `nowISO` is passed in
 * so callers (and tests) control the clock. Items with missing or unparseable
 * timestamps are never reported — failing to detect is safer than falsely
 * killing live work.
 */
export function detectStuckWork(
  input: StuckCandidateInput,
  nowISO: string,
  thresholds: StuckThresholds = defaultStuckThresholds
): StuckFinding[] {
  const now = Date.parse(nowISO);
  if (Number.isNaN(now)) {
    return [];
  }
  const findings: StuckFinding[] = [];

  for (const step of input.agentRunSteps) {
    if (step.status !== "Running") {
      continue;
    }
    const elapsed = elapsedMs(step.createdAt, now);
    if (elapsed !== null && elapsed > thresholds.stepMs) {
      findings.push({
        kind: "AgentRunStep",
        id: step.id,
        stalledMinutes: minutes(elapsed),
        reason: `Agent step has been running for ${minutes(elapsed)} minute(s) without reaching a terminal state.`
      });
    }
  }

  // A loop is stuck when it is Running and one of its own steps is stuck. The
  // loop's own age is not enough: a paused-then-resumed loop can legitimately
  // span a long wall-clock window.
  const stuckStepIDs = new Set(findings.filter((f) => f.kind === "AgentRunStep").map((f) => f.id));
  for (const loop of input.agentRunLoops) {
    if (loop.status !== "Running") {
      continue;
    }
    if (!loop.stepIDs.some((stepID) => stuckStepIDs.has(stepID))) {
      continue;
    }
    const elapsed = elapsedMs(loop.startedAt, now) ?? 0;
    findings.push({
      kind: "AgentRunLoop",
      id: loop.id,
      stalledMinutes: minutes(elapsed),
      reason: "Agent loop is running a step that exceeded its deadline."
    });
  }

  const runKinds: [StuckFinding["kind"], { id: string; status: string; startedAt?: string }[], number, string][] = [
    ["TaskCommandRun", input.taskCommandRuns, thresholds.commandRunMs, "Task command run"],
    ["ValidationRun", input.validationRuns, thresholds.commandRunMs, "Validation run"]
  ];
  for (const [kind, runs, threshold, label] of runKinds) {
    for (const run of runs) {
      if (run.status !== "Running") {
        continue;
      }
      const elapsed = elapsedMs(run.startedAt, now);
      if (elapsed !== null && elapsed > threshold) {
        findings.push({
          kind,
          id: run.id,
          stalledMinutes: minutes(elapsed),
          reason: `${label} has been running for ${minutes(elapsed)} minute(s) without reaching a terminal state.`
        });
      }
    }
  }

  for (const toolCall of input.toolCalls) {
    if (toolCall.status !== "Started") {
      continue;
    }
    const elapsed = elapsedMs(toolCall.startedAt, now);
    if (elapsed !== null && elapsed > thresholds.toolCallMs) {
      findings.push({
        kind: "ToolCall",
        id: toolCall.id,
        stalledMinutes: minutes(elapsed),
        reason: `Tool call has been started for ${minutes(elapsed)} minute(s) without reaching a terminal state.`
      });
    }
  }

  return findings;
}

/** Read thresholds from env, falling back to the defaults. Minutes in, ms out. */
export function thresholdsFromEnv(env: Record<string, string | undefined>): StuckThresholds {
  const readMinutes = (key: string, fallbackMs: number): number => {
    const raw = env[key];
    if (!raw) {
      return fallbackMs;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed * 60_000 : fallbackMs;
  };
  return {
    stepMs: readMinutes("FORGE_STUCK_STEP_MINUTES", defaultStuckThresholds.stepMs),
    commandRunMs: readMinutes("FORGE_STUCK_COMMAND_MINUTES", defaultStuckThresholds.commandRunMs),
    toolCallMs: readMinutes("FORGE_STUCK_TOOL_MINUTES", defaultStuckThresholds.toolCallMs)
  };
}
