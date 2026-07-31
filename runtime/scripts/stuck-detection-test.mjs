#!/usr/bin/env node
// Pure unit test for stuck-work detection.
import { detectStuckWork, thresholdsFromEnv, defaultStuckThresholds } from "../dist/stuckDetection.js";

let count = 0;
function assert(condition, message) {
  count += 1;
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const now = "2026-07-26T12:00:00.000Z";
const minutesAgo = (n) => new Date(Date.parse(now) - n * 60_000).toISOString();
const empty = { agentRunSteps: [], agentRunLoops: [], taskCommandRuns: [], validationRuns: [], toolCalls: [] };

// 1. Nothing running → nothing stuck.
assert(detectStuckWork(empty, now).length === 0, "empty input → no findings");

// 2. A Running step past the threshold is stuck; a fresh one is not.
const steps = {
  ...empty,
  agentRunSteps: [
    { id: "old", status: "Running", createdAt: minutesAgo(20), loopID: "loop1" },
    { id: "fresh", status: "Running", createdAt: minutesAgo(2), loopID: "loop1" },
    { id: "done", status: "Completed", createdAt: minutesAgo(90) }
  ]
};
const stepFindings = detectStuckWork(steps, now);
assert(stepFindings.length === 1, `expected 1 stuck step, got ${stepFindings.length}`);
assert(stepFindings[0].id === "old" && stepFindings[0].kind === "AgentRunStep", "wrong step flagged");
assert(stepFindings[0].stalledMinutes === 20, `expected 20 stalled minutes, got ${stepFindings[0].stalledMinutes}`);
assert(stepFindings[0].reason.includes("20 minute"), "reason should carry the elapsed evidence");

// 3. Terminal steps are never flagged regardless of age.
assert(!stepFindings.some((f) => f.id === "done"), "completed step must not be flagged");

// 4. A Running loop is stuck only when one of ITS steps is stuck.
const withLoops = {
  ...steps,
  agentRunLoops: [
    { id: "loop1", status: "Running", startedAt: minutesAgo(25), stepIDs: ["old", "fresh"] },
    { id: "loop2", status: "Running", startedAt: minutesAgo(300), stepIDs: ["fresh"] },
    { id: "loop3", status: "Paused", startedAt: minutesAgo(300), stepIDs: ["old"] }
  ]
};
const loopFindings = detectStuckWork(withLoops, now).filter((f) => f.kind === "AgentRunLoop");
assert(loopFindings.length === 1, `expected 1 stuck loop, got ${loopFindings.length}`);
assert(loopFindings[0].id === "loop1", `expected loop1, got ${loopFindings[0].id}`);
// loop2 is old but its only step is fresh — a long-lived loop is not itself stuck.
assert(!loopFindings.some((f) => f.id === "loop2"), "old loop with only fresh steps must not be flagged");
// loop3 is Paused, so not a candidate at all.
assert(!loopFindings.some((f) => f.id === "loop3"), "paused loop must not be flagged");

// A bad loop timestamp must not hide its stuck child step or produce NaN evidence.
const invalidLoopClock = detectStuckWork({
  ...steps,
  agentRunLoops: [{ id: "loop-bad-clock", status: "Running", startedAt: "invalid", stepIDs: ["old"] }]
}, now).find((f) => f.id === "loop-bad-clock");
assert(invalidLoopClock?.stalledMinutes === 0, "invalid loop timestamp should fail safe to zero elapsed minutes");

// 5. Command / validation runs use their own threshold.
const runs = {
  ...empty,
  taskCommandRuns: [
    { id: "cmd-old", status: "Running", startedAt: minutesAgo(25) },
    { id: "cmd-new", status: "Running", startedAt: minutesAgo(18) },
    { id: "cmd-done", status: "Passed", startedAt: minutesAgo(200) }
  ],
  validationRuns: [
    { id: "val-old", status: "Running", startedAt: minutesAgo(30) },
    { id: "val-done", status: "Failed", startedAt: minutesAgo(200) }
  ]
};
const runFindings = detectStuckWork(runs, now);
assert(runFindings.some((f) => f.id === "cmd-old" && f.kind === "TaskCommandRun"), "old command run not flagged");
assert(!runFindings.some((f) => f.id === "cmd-new"), "command run under threshold must not be flagged");
assert(runFindings.some((f) => f.id === "val-old" && f.kind === "ValidationRun"), "old validation run not flagged");

// 6. Tool calls use the "Started" status and their own threshold.
const tools = { ...empty, toolCalls: [
  { id: "tool-old", status: "Started", startedAt: minutesAgo(15) },
  { id: "tool-new", status: "Started", startedAt: minutesAgo(5) },
  { id: "tool-done", status: "Completed", startedAt: minutesAgo(600) }
] };
const toolFindings = detectStuckWork(tools, now);
assert(toolFindings.length === 1 && toolFindings[0].id === "tool-old", `expected only tool-old, got ${JSON.stringify(toolFindings.map(f=>f.id))}`);

// 7. Missing / unparseable / future timestamps are never flagged (fail safe).
const weird = { ...empty, agentRunSteps: [
  { id: "no-ts", status: "Running", createdAt: undefined },
  { id: "garbage", status: "Running", createdAt: "not-a-date" },
  { id: "future", status: "Running", createdAt: new Date(Date.parse(now) + 60 * 60_000).toISOString() }
] };
assert(detectStuckWork(weird, now).length === 0, "unusable timestamps must never be flagged");

// 8. An invalid `now` yields no findings rather than throwing.
assert(detectStuckWork(steps, "nonsense").length === 0, "invalid now → no findings");

// 9. Custom thresholds are honored.
const strict = detectStuckWork(steps, now, { stepMs: 60_000, commandRunMs: 60_000, toolCallMs: 60_000 });
assert(strict.filter((f) => f.kind === "AgentRunStep").length === 2, "a 1-minute threshold should flag both running steps");

// 10. Env thresholds parse minutes, ignore junk, and fall back.
const fromEnv = thresholdsFromEnv({ FORGE_STUCK_STEP_MINUTES: "3", FORGE_STUCK_COMMAND_MINUTES: "bad", FORGE_STUCK_TOOL_MINUTES: "-1" });
assert(fromEnv.stepMs === 3 * 60_000, `expected 3 min, got ${fromEnv.stepMs}`);
assert(fromEnv.commandRunMs === defaultStuckThresholds.commandRunMs, "junk env should fall back");
assert(fromEnv.toolCallMs === defaultStuckThresholds.toolCallMs, "negative env should fall back");
assert(thresholdsFromEnv({}).stepMs === defaultStuckThresholds.stepMs, "empty env → defaults");

console.log(`Stuck detection test passed: ${count} assertions.`);
