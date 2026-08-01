import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import { repositoryInspectionSubsumedBy } from "../inspectionGuard.js";
import {
  AgentRunStepProviderError,
  type ModelProvider,
  type PlanContextRequestResult
} from "../modelProvider.js";
import { detectStuckWork, type StuckFinding, type StuckThresholds } from "../stuckDetection.js";
import type {
  AgentRunLoop,
  AgentRunLoopControlRequest,
  AgentRunStep,
  AgentRunStepDecision,
  AgentState,
  CommandRerunEvidence,
  ContextFile,
  ForgeTask,
  PlanStep,
  RunAgentLoopRequest,
  RunAgentStepRequest,
  RuntimeEvent,
  TaskCommandPermission,
  TaskQueueReorderRequest,
  TaskQueueSettingsRequest,
  TaskQueueSnapshot,
  ValidationRepairBrief
} from "../types.js";
import type { InternalValidationPreset } from "../validation/validationCatalogService.js";

interface RepositorySearchMatch {
  path: string;
  score: number;
  reasons: string[];
  matchedLines: string[];
}

export function createAgentOrchestrationService(options: {
  tasks: Map<string, ForgeTask>;
  modelProvider: () => ModelProvider;
  taskQueueSettingsPath: string;
  taskQueueSmokeDelayMs: number;
  stuckThresholds: StuckThresholds;
  repositoryScanMaxFiles: number;
  repositorySearchMaxFiles: number;
  repositoryContextMaxFiles: number;
  saveTask: (task: ForgeTask) => void;
  saveAndBroadcast: (task: ForgeTask, runtimeEvent: RuntimeEvent) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
  event: (type: string, message: string) => RuntimeEvent;
  setAgent: (task: ForgeTask, role: AgentState["role"], status: AgentState["status"], summary: string) => void;
  upsertPlanStep: (task: ForgeTask, planStep: PlanStep) => void;
  hasRunningValidationRun: (task: ForgeTask) => boolean;
  hasRunningTaskCommandRun: (task: ForgeTask) => boolean;
  loadValidationPresetRegistry: () => Promise<{ presets: InternalValidationPreset[] }>;
  buildTaskCommandPermissions: (task: ForgeTask, presets: InternalValidationPreset[]) => TaskCommandPermission[];
  generateEditProposal: (taskID: string) => Promise<ForgeTask>;
  generateValidationRepairProposal: (taskID: string) => Promise<ForgeTask>;
  runTaskCommand: (taskID: string, input: { commandID: string }) => Promise<ForgeTask>;
  rerunRepairCommand: (taskID: string, input: { commandRerunEvidenceID: string }) => Promise<ForgeTask>;
  latestRunnableCommandRerunEvidence: (task: ForgeTask) => CommandRerunEvidence | undefined;
  listRepositoryFiles: () => Promise<string[]>;
  normalizeProviderSearchTerms: (request: Pick<PlanContextRequestResult, "searchTerms">, task: ForgeTask) => string[];
  normalizeProviderReadPaths: (readPaths: string[], files: string[]) => string[];
  searchRepositoryWithRipgrep: (files: string[], searchTerms: string[], explicitPaths: string[], searchMode: "Text" | "Symbol") => Promise<{ engine: string; matches: RepositorySearchMatch[] }>;
  explicitContextPathsForTask: (task: ForgeTask) => string[];
  buildContextFiles: (task: ForgeTask, files: string[], matches: RepositorySearchMatch[], preferredPaths?: string[]) => Promise<ContextFile[]>;
  mergeContextFiles: (existing: ContextFile[], incoming: ContextFile[]) => ContextFile[];
  runTool: <T>(task: ForgeTask, name: string, inputSummary: string, operation: () => Promise<T>) => Promise<T>;
  formatPathList: (paths: string[]) => string;
}) {
const {
  tasks,
  modelProvider: currentModelProvider,
  taskQueueSettingsPath,
  taskQueueSmokeDelayMs,
  stuckThresholds,
  repositoryScanMaxFiles,
  repositorySearchMaxFiles,
  repositoryContextMaxFiles,
  saveTask,
  saveAndBroadcast,
  emit,
  event,
  setAgent,
  upsertPlanStep,
  hasRunningValidationRun,
  hasRunningTaskCommandRun,
  loadValidationPresetRegistry,
  buildTaskCommandPermissions,
  generateEditProposal,
  generateValidationRepairProposal,
  runTaskCommand,
  rerunRepairCommand,
  latestRunnableCommandRerunEvidence,
  listRepositoryFiles,
  normalizeProviderSearchTerms,
  normalizeProviderReadPaths,
  searchRepositoryWithRipgrep,
  explicitContextPathsForTask,
  buildContextFiles,
  mergeContextFiles,
  runTool,
  formatPathList
} = options;

const activeAgentRunLoops = new Map<string, ActiveAgentRunLoopControl>();
let taskQueueConcurrencyLimit = loadTaskQueueConcurrencyLimit();
let dispatchingTaskQueue = false;

interface ActiveAgentRunLoopControl {
  loopID: string;
  requestedAction?: "Pause" | "Abort";
  requestedAt?: string;
  note?: string;
}

interface RunAgentStepOptions {
  loopID?: string;
}

function loadTaskQueueConcurrencyLimit(): number {
  try {
    const value = JSON.parse(readFileSync(taskQueueSettingsPath, "utf8"))?.concurrencyLimit;
    return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 2;
  } catch {
    return 2;
  }
}

function persistTaskQueueSettings(): void {
  mkdirSync(path.dirname(taskQueueSettingsPath), { recursive: true });
  writeFileSync(taskQueueSettingsPath, JSON.stringify({ concurrencyLimit: taskQueueConcurrencyLimit }, null, 2));
}

function queueEntry(task: ForgeTask) {
  const loop = task.agentRunLoops.find((candidate) => candidate.status === "Running");
  return {
    taskID: task.id,
    title: task.title,
    status: task.status,
    currentPhase: task.currentPhase,
    position: task.queueRequest?.position,
    enqueuedAt: task.queueRequest?.enqueuedAt,
    estimatedMinutes: task.planRevisions.at(-1)?.estimatedMinutes,
    loop
  };
}

function getTaskQueueSnapshot(): TaskQueueSnapshot {
  const all = [...tasks.values()];
  const running = all.filter((task) => activeAgentRunLoops.has(task.id)).map(queueEntry);
  const queued = all.filter((task) => task.queueRequest).sort((a, b) => a.queueRequest!.position - b.queueRequest!.position).map(queueEntry);
  const needsAttention = all.filter((task) => task.status === "Human Review" && !task.queueRequest).map(queueEntry);
  const completed = all.filter((task) => task.status === "Completed").map(queueEntry);
  return {
    generatedAt: new Date().toISOString(),
    concurrencyLimit: taskQueueConcurrencyLimit,
    effectiveRepositoryLimit: 1,
    running,
    queued,
    needsAttention,
    completed,
    summary: `${running.length} running · ${queued.length} queued · ${needsAttention.length} need attention.`,
    operationBoundary: "Concurrency is capped at 1-3 globally; this single-repository runtime serializes agent loops to one active task to prevent overlapping workspace mutations."
  };
}

function updateTaskQueueSettings(input: TaskQueueSettingsRequest): TaskQueueSnapshot {
  if (!Number.isInteger(input.concurrencyLimit) || input.concurrencyLimit < 1 || input.concurrencyLimit > 3) {
    throw new HttpError(400, "Queue concurrencyLimit must be 1, 2, or 3.");
  }
  taskQueueConcurrencyLimit = input.concurrencyLimit;
  persistTaskQueueSettings();
  emit("queue.settings.updated", { concurrencyLimit: taskQueueConcurrencyLimit });
  return getTaskQueueSnapshot();
}

function reorderTaskQueue(input: TaskQueueReorderRequest): TaskQueueSnapshot {
  const queued = [...tasks.values()].filter((task) => task.queueRequest);
  const expected = new Set(queued.map((task) => task.id));
  if (input.orderedTaskIDs.length !== expected.size || new Set(input.orderedTaskIDs).size !== expected.size || input.orderedTaskIDs.some((id) => !expected.has(id))) {
    throw new HttpError(409, "Queue reorder must include every currently queued task exactly once.");
  }
  input.orderedTaskIDs.forEach((id, index) => {
    const task = requireTask(id);
    task.queueRequest!.position = index + 1;
    task.updatedAt = new Date().toISOString();
    saveTask(task);
  });
  emit("queue.reordered", { orderedTaskIDs: input.orderedTaskIDs });
  return getTaskQueueSnapshot();
}

function removeTaskFromQueue(taskID: string): TaskQueueSnapshot {
  const task = requireTask(taskID);
  const request = task.queueRequest;
  if (!request) throw new HttpError(409, "Task is not queued.");
  delete task.queueRequest;
  task.status = request.previousStatus === "Running" ? "Human Review" : request.previousStatus;
  task.currentPhase = request.previousStatus === "Running" ? "Execution Ready" : request.previousPhase;
  task.reviewSummary = "Removed from the queue. The approved plan remains ready for a future agent run.";
  saveAndBroadcast(task, event("agent.run_loop.dequeued", "Agent loop removed from the task queue before execution."));
  normalizeQueuePositions();
  return getTaskQueueSnapshot();
}

function normalizeQueuePositions(): void {
  [...tasks.values()].filter((task) => task.queueRequest).sort((a, b) => a.queueRequest!.position - b.queueRequest!.position).forEach((task, index) => {
    task.queueRequest!.position = index + 1;
    saveTask(task);
  });
}

async function scheduleAgentRunLoop(taskID: string, input: RunAgentLoopRequest = {}): Promise<ForgeTask> {
  const task = requireTask(taskID);
  if (task.queueRequest) return task;
  if (activeAgentRunLoops.size < Math.min(taskQueueConcurrencyLimit, 1)) return runAgentLoop(taskID, input);
  const position = [...tasks.values()].filter((candidate) => candidate.queueRequest).length + 1;
  const now = new Date().toISOString();
  task.queueRequest = {
    id: randomUUID(), enqueuedAt: now, position,
    maxSteps: normalizeAgentRunLoopMaxSteps(input.maxSteps),
    preferredCommandID: input.preferredCommandID,
    resumeLoopID: input.resumeLoopID,
    previousStatus: task.status,
    previousPhase: task.currentPhase
  };
  task.status = "Human Review";
  task.currentPhase = "Agent Loop Queued";
  saveAndBroadcast(task, withCreatedAt(event("agent.run_loop.queued", `Agent loop queued at position ${position}; same-repository execution is serialized.`), now));
  emit("queue.updated", { snapshot: getTaskQueueSnapshot() });
  return task;
}

async function dispatchQueuedAgentRuns(): Promise<void> {
  if (dispatchingTaskQueue || activeAgentRunLoops.size >= Math.min(taskQueueConcurrencyLimit, 1)) return;
  const next = [...tasks.values()].filter((task) => task.queueRequest).sort((a, b) => a.queueRequest!.position - b.queueRequest!.position)[0];
  if (!next?.queueRequest) return;
  dispatchingTaskQueue = true;
  const request = next.queueRequest;
  delete next.queueRequest;
  normalizeQueuePositions();
  saveAndBroadcast(next, event("agent.run_loop.dequeued", "Queue slot opened; starting the next serialized agent loop."));
  try {
    await runAgentLoop(next.id, { preferredCommandID: request.preferredCommandID, maxSteps: request.maxSteps, resumeLoopID: request.resumeLoopID });
  } finally {
    dispatchingTaskQueue = false;
    void dispatchQueuedAgentRuns();
  }
}

async function runAgentLoop(taskID: string, input: RunAgentLoopRequest = {}): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (activeAgentRunLoops.has(taskID)) {
    throw new HttpError(409, "An agent run loop is already active for this task.");
  }

  const resumedFrom = input.resumeLoopID ? requireResumableAgentRunLoop(task, input.resumeLoopID) : undefined;

  if (hasRunningValidationRun(task) || hasRunningTaskCommandRun(task) || task.status === "Testing") {
    const loop = createAgentRunLoop(task, input, "Task is currently busy.");
    return finishAgentRunLoop(task, loop.id, "Paused", "TaskBusy", "Task is currently running another operation.");
  }

  const loopSummary = resumedFrom
    ? `Resuming bounded agent loop from ${resumedFrom.id} at its last safe checkpoint.`
    : "Starting bounded provider-selected agent loop.";
  const loop = createAgentRunLoop(task, input, loopSummary);
  activeAgentRunLoops.set(taskID, { loopID: loop.id });
  try {
    saveAndBroadcast(
      task,
      withCreatedAt(
        event(
          resumedFrom ? "agent.run_loop.resumed" : "agent.run_loop.started",
          resumedFrom
            ? `Agent loop resumed from ${resumedFrom.id} with up to ${loop.maxSteps} step(s).`
            : `Agent loop started with up to ${loop.maxSteps} step(s).`
        ),
        loop.startedAt
      )
    );

    if (taskQueueSmokeDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, taskQueueSmokeDelayMs));
    }

    let current = task;
    for (let index = 0; index < loop.maxSteps; index += 1) {
      const beforeStepControl = requestedAgentRunLoopStop(current, loop.id);
      if (beforeStepControl) {
        return finishAgentRunLoop(
          current,
          loop.id,
          beforeStepControl.status,
          beforeStepControl.reason,
          beforeStepControl.summary
        );
      }

      const beforeStepIDs = new Set(current.agentRunSteps.map((step) => step.id));
      current = await runAgentStep(
        taskID,
        { preferredCommandID: loop.preferredCommandID },
        { loopID: loop.id }
      );
      const updatedLoop = requireAgentRunLoop(current, loop.id);
      const newSteps = current.agentRunSteps.filter((step) => !beforeStepIDs.has(step.id));
      for (const step of newSteps) {
        if (!updatedLoop.stepIDs.includes(step.id)) {
          updatedLoop.stepIDs.push(step.id);
        }
      }
      updatedLoop.stepsRun = updatedLoop.stepIDs.length;
      updatedLoop.summary = summarizeAgentRunLoopProgress(current, updatedLoop);

      const afterStepControl = requestedAgentRunLoopStop(current, loop.id);
      if (afterStepControl) {
        return finishAgentRunLoop(
          current,
          loop.id,
          afterStepControl.status,
          afterStepControl.reason,
          afterStepControl.summary
        );
      }

      const stop = agentRunLoopStopAfterStep(current, newSteps.at(-1));
      if (stop) {
        return finishAgentRunLoop(current, loop.id, stop.status, stop.reason, stop.summary);
      }
    }

    return finishAgentRunLoop(
      current,
      loop.id,
      "Paused",
      "MaxStepsReached",
      `Agent loop paused after reaching the ${loop.maxSteps}-step limit.`
    );
  } catch (error) {
    const failedTask = requireTask(taskID);
    return finishAgentRunLoop(
      failedTask,
      loop.id,
      "Failed",
      "StepFailed",
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    if (activeAgentRunLoops.get(taskID)?.loopID === loop.id) {
      activeAgentRunLoops.delete(taskID);
    }
    void dispatchQueuedAgentRuns();
  }
}

function createAgentRunLoop(task: ForgeTask, input: RunAgentLoopRequest, summary: string): AgentRunLoop {
  const resumedFrom = input.resumeLoopID ? requireAgentRunLoop(task, input.resumeLoopID) : undefined;
  const maxSteps = normalizeAgentRunLoopMaxSteps(input.maxSteps ?? resumedFrom?.maxSteps);
  const loop: AgentRunLoop = {
    id: randomUUID(),
    provider: currentModelProvider().info,
    status: "Running",
    maxSteps,
    stepsRun: 0,
    stepIDs: [],
    preferredCommandID: input.preferredCommandID ?? resumedFrom?.preferredCommandID,
    resumedFromLoopID: resumedFrom?.id,
    summary,
    startedAt: new Date().toISOString()
  };
  if (resumedFrom) {
    resumedFrom.resumedByLoopID = loop.id;
  }
  task.agentRunLoops.push(loop);
  task.status = "Running";
  task.currentPhase = "Agent Loop";
  task.reviewSummary = summary;
  setAgent(task, "Manager", "Active", "Coordinating a bounded provider-selected run loop.");
  setAgent(task, "Coder", "Active", "Running safe agent steps until a review gate or stop condition.");
  setAgent(task, "Reviewer", "Idle", "Waiting for the agent loop stop condition.");
  upsertPlanStep(task, {
    id: "run-agent-loop",
    title: "Run agent loop",
    status: "Active",
    summary
  });
  return loop;
}

function requestAgentRunLoopControl(
  taskID: string,
  input: AgentRunLoopControlRequest,
  action: "Pause" | "Abort"
): ForgeTask {
  const task = requireTask(taskID);
  const control = activeAgentRunLoops.get(taskID);
  if (!control) {
    throw new HttpError(409, "No active agent run loop is available for control.");
  }

  if (input.loopID && input.loopID !== control.loopID) {
    throw new HttpError(409, `Active agent loop does not match requested loop ${input.loopID}.`);
  }

  const loop = requireAgentRunLoop(task, control.loopID);
  if (loop.status !== "Running") {
    throw new HttpError(409, `Agent loop is not running: ${loop.id}`);
  }

  if (control.requestedAction === "Abort" || control.requestedAction === action) {
    return task;
  }

  const now = new Date().toISOString();
  const note = input.note?.trim() || undefined;
  control.requestedAction = action;
  control.requestedAt = now;
  control.note = note;
  loop.controlState = action === "Pause" ? "PauseRequested" : "AbortRequested";
  loop.controlRequestedAt = now;
  loop.controlNote = note;
  task.currentPhase = action === "Pause" ? "Agent Loop Pause Requested" : "Agent Loop Abort Requested";
  task.reviewSummary = `${action} requested. Forge will stop after the current safe agent step.`;
  task.approvals.push({
    id: randomUUID(),
    action: `${action} Agent Loop`,
    decision: "Approved",
    summary: `${action} requested for active agent loop ${loop.id}.`,
    targetID: loop.id,
    decidedAt: now,
    userNote: note
  });
  setAgent(task, "Manager", "Active", `${action} requested; waiting for the current safe step checkpoint.`);

  saveAndBroadcast(
    task,
    withCreatedAt(
      event(
        action === "Pause" ? "agent.run_loop.pause.requested" : "agent.run_loop.abort.requested",
        task.reviewSummary
      ),
      now
    )
  );
  return task;
}

async function resumeAgentRunLoop(taskID: string, input: RunAgentLoopRequest): Promise<ForgeTask> {
  const task = requireTask(taskID);
  if (activeAgentRunLoops.has(taskID)) {
    throw new HttpError(409, "Cannot resume while an agent run loop is already active.");
  }

  const source = input.resumeLoopID
    ? requireResumableAgentRunLoop(task, input.resumeLoopID)
    : [...task.agentRunLoops].reverse().find((loop) => isResumableAgentRunLoop(loop));
  if (!source) {
    throw new HttpError(409, "No paused, aborted, or failed agent loop is available to resume.");
  }

  return scheduleAgentRunLoop(taskID, {
    preferredCommandID: input.preferredCommandID ?? source.preferredCommandID,
    maxSteps: input.maxSteps ?? source.maxSteps,
    resumeLoopID: source.id
  });
}

function isResumableAgentRunLoop(loop: AgentRunLoop): boolean {
  return loop.status === "Paused" || loop.status === "Aborted" || loop.status === "Failed";
}

function recoverInterruptedAgentRunLoopsOnStartup(): void {
  const recoveredAt = new Date().toISOString();
  for (const task of tasks.values()) {
    const interruptedLoops = task.agentRunLoops.filter((loop) => loop.status === "Running");
    if (interruptedLoops.length === 0) {
      continue;
    }

    for (const loop of interruptedLoops) {
      loop.status = "Paused";
      loop.stopReason = "RuntimeRestarted";
      loop.completedAt = recoveredAt;
      loop.summary = `Runtime restarted while agent loop ${loop.id} was running. Forge recovered it as a resumable safe checkpoint.`;
      delete loop.controlState;
      delete loop.controlRequestedAt;

      for (const stepID of loop.stepIDs) {
        const step = task.agentRunSteps.find((candidate) => candidate.id === stepID);
        if (step?.status === "Running") {
          step.status = "Failed";
          step.completedAt = recoveredAt;
          step.error = "Runtime restarted before this agent step reached a terminal state.";
          step.resultSummary = step.error;
        }
      }
    }

    for (const run of task.taskCommandRuns) {
      if (run.status === "Running") {
        run.status = "Failed";
        run.endedAt = recoveredAt;
        run.outputSummary = "Runtime restarted before the task command reached a terminal state.";
        run.outputChunks.push({
          id: randomUUID(),
          stream: "system",
          text: `${run.outputSummary}\n`,
          createdAt: recoveredAt
        });
      }
    }
    for (const run of task.validationRuns) {
      if (run.status === "Running") {
        run.status = "Failed";
        run.endedAt = recoveredAt;
        run.summary = "Runtime restarted before validation reached a terminal state.";
        for (const command of run.commands) {
          if (command.status === "Running") {
            command.status = "Failed";
            command.endedAt = recoveredAt;
            command.outputSummary = run.summary;
          }
        }
      }
    }
    for (const evidence of task.commandRerunEvidence) {
      if (evidence.status === "Running") {
        evidence.status = "Failed";
        evidence.updatedAt = recoveredAt;
        evidence.summary = "Runtime restarted before repaired-command verification completed.";
      }
    }
    for (const toolCall of task.toolCalls) {
      if (toolCall.status === "Started") {
        toolCall.status = "Failed";
        toolCall.endedAt = recoveredAt;
        toolCall.outputSummary = "Runtime restarted before the tool call reached a terminal state.";
      }
    }

    const latestLoop = interruptedLoops.at(-1) as AgentRunLoop;
    task.status = "Human Review";
    task.currentPhase = "Agent Loop Interrupted";
    task.reviewSummary = latestLoop.summary;
    setAgent(task, "Manager", "Ready", "Recovered interrupted agent loop at startup.");
    setAgent(task, "Coder", "Idle", "No in-flight process was resumed after runtime restart.");
    setAgent(task, "Reviewer", "Active", "Review the interrupted checkpoint before resuming.");
    upsertPlanStep(task, {
      id: "run-agent-loop",
      title: "Run agent loop",
      status: "Blocked",
      summary: latestLoop.summary
    });
    const recoveredEvent = event("agent.run_loop.interrupted", latestLoop.summary);
    recoveredEvent.createdAt = recoveredAt;
    task.events.push(recoveredEvent);
    task.updatedAt = recoveredAt;
    tasks.set(task.id, task);
    saveTask(task);
  }
}

/**
 * Live watchdog for wedged agent work. Per-command timeouts cover a command
 * that runs too long, and startup recovery covers a crash — but a running
 * runtime whose step never settles (a stalled provider socket, a tool that
 * never returns) had nothing watching it. This finalizes such work at a safe,
 * resumable checkpoint: it only rewrites task state, never files, and always
 * lands in Human Review rather than continuing autonomously.
 */
function recoverStuckAgentWork(nowISO: string = new Date().toISOString()): {
  generatedAt: string;
  recovered: { taskID: string; findings: StuckFinding[] }[];
} {
  const recovered: { taskID: string; findings: StuckFinding[] }[] = [];

  for (const task of tasks.values()) {
    const findings = detectStuckWork(task, nowISO, stuckThresholds);
    if (findings.length === 0) {
      continue;
    }

    const byKind = (kind: StuckFinding["kind"]) => new Map(
      findings.filter((finding) => finding.kind === kind).map((finding) => [finding.id, finding])
    );
    const stuckSteps = byKind("AgentRunStep");
    const stuckLoops = byKind("AgentRunLoop");
    const stuckCommandRuns = byKind("TaskCommandRun");
    const stuckValidationRuns = byKind("ValidationRun");
    const stuckToolCalls = byKind("ToolCall");

    for (const step of task.agentRunSteps) {
      const finding = stuckSteps.get(step.id);
      if (finding && step.status === "Running") {
        step.status = "Failed";
        step.completedAt = nowISO;
        step.error = finding.reason;
        step.resultSummary = finding.reason;
      }
    }
    for (const loop of task.agentRunLoops) {
      const finding = stuckLoops.get(loop.id);
      if (finding && loop.status === "Running") {
        loop.status = "Paused";
        loop.stopReason = "StepTimedOut";
        loop.completedAt = nowISO;
        loop.summary = `Agent loop ${loop.id} was paused because a step exceeded its deadline. Forge left it as a resumable safe checkpoint.`;
        delete loop.controlState;
        delete loop.controlRequestedAt;
      }
    }
    for (const run of task.taskCommandRuns) {
      const finding = stuckCommandRuns.get(run.id);
      if (finding && run.status === "Running") {
        run.status = "Failed";
        run.endedAt = nowISO;
        run.outputSummary = finding.reason;
        run.outputChunks.push({
          id: randomUUID(),
          stream: "system",
          text: `${finding.reason}\n`,
          createdAt: nowISO
        });
      }
    }
    for (const run of task.validationRuns) {
      const finding = stuckValidationRuns.get(run.id);
      if (finding && run.status === "Running") {
        run.status = "Failed";
        run.endedAt = nowISO;
        run.summary = finding.reason;
        for (const command of run.commands) {
          if (command.status === "Running") {
            command.status = "Failed";
            command.endedAt = nowISO;
            command.outputSummary = finding.reason;
          }
        }
      }
    }
    for (const toolCall of task.toolCalls) {
      const finding = stuckToolCalls.get(toolCall.id);
      if (finding && toolCall.status === "Started") {
        toolCall.status = "Failed";
        toolCall.endedAt = nowISO;
        toolCall.outputSummary = finding.reason;
      }
    }

    const summary = `Forge recovered ${findings.length} stalled item(s) on this task: ${findings
      .map((finding) => `${finding.kind} stalled ${finding.stalledMinutes}m`)
      .join(", ")}.`;
    task.status = "Human Review";
    task.currentPhase = "Stalled Work Recovered";
    task.reviewSummary = summary;
    setAgent(task, "Manager", "Ready", "Recovered stalled agent work at a safe checkpoint.");
    setAgent(task, "Coder", "Idle", "No in-flight process was resumed after the stall.");
    setAgent(task, "Reviewer", "Active", "Review the recovered checkpoint before resuming.");
    const recoveredEvent = event("agent.stalled_work.recovered", summary);
    recoveredEvent.createdAt = nowISO;
    task.events.push(recoveredEvent);
    task.updatedAt = nowISO;
    tasks.set(task.id, task);
    saveTask(task);
    recovered.push({ taskID: task.id, findings });
  }

  return { generatedAt: nowISO, recovered };
}

function requireResumableAgentRunLoop(task: ForgeTask, loopID: string): AgentRunLoop {
  const loop = requireAgentRunLoop(task, loopID);
  if (!isResumableAgentRunLoop(loop)) {
    throw new HttpError(409, `Agent loop is not resumable from status ${loop.status}: ${loop.id}`);
  }
  return loop;
}

function requestedAgentRunLoopStop(
  task: ForgeTask,
  loopID: string
): { status: AgentRunLoop["status"]; reason: AgentRunLoop["stopReason"]; summary: string } | undefined {
  const control = activeAgentRunLoops.get(task.id);
  if (!control || control.loopID !== loopID || !control.requestedAction) {
    return undefined;
  }

  if (control.requestedAction === "Abort") {
    return {
      status: "Aborted",
      reason: "UserAborted",
      summary: control.note
        ? `Agent loop aborted at a safe checkpoint: ${control.note}`
        : "Agent loop aborted at the next safe checkpoint."
    };
  }

  return {
    status: "Paused",
    reason: "UserPaused",
    summary: control.note
      ? `Agent loop paused at a safe checkpoint: ${control.note}`
      : "Agent loop paused at the next safe checkpoint."
  };
}

function normalizeAgentRunLoopMaxSteps(value: unknown): number {
  if (value === undefined || value === null) {
    return 4;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpError(400, "maxSteps must be an integer.");
  }

  if (value < 1 || value > 8) {
    throw new HttpError(400, "maxSteps must be between 1 and 8.");
  }

  return value;
}

function agentRunLoopStopAfterStep(
  task: ForgeTask,
  step: AgentRunStep | undefined
): { status: AgentRunLoop["status"]; reason: AgentRunLoop["stopReason"]; summary: string } | undefined {
  if (!step) {
    return { status: "Paused", reason: "NoProgress", summary: "Agent loop paused because no step was recorded." };
  }

  if (step.status === "Failed") {
    return { status: "Failed", reason: "StepFailed", summary: step.resultSummary ?? step.error ?? "Agent step failed." };
  }

  if (step.status === "Blocked") {
    return { status: "Paused", reason: "StepBlocked", summary: step.resultSummary ?? "Agent loop paused at a review gate." };
  }

  if (task.editProposal?.status === "Proposed") {
    return {
      status: "Paused",
      reason: "HumanReviewRequired",
      summary: "Agent loop paused with an edit proposal ready for human review."
    };
  }

  if (step.action === "RunTaskCommand" && task.currentPhase === "Command Passed") {
    return { status: "Completed", reason: "CommandPassed", summary: "Agent loop stopped after the approved command passed." };
  }

  if (step.action === "RunTaskCommand" && task.currentPhase === "Command Cancelled") {
    return { status: "Paused", reason: "HumanReviewRequired", summary: "Agent loop paused after the command was cancelled." };
  }

  if (step.action === "RunTaskCommand" && task.currentPhase === "Command Failed" && !latestRepairBriefForTask(task)) {
    return { status: "Failed", reason: "StepFailed", summary: "Agent loop stopped after a command failed without repair guidance." };
  }

  if (step.action === "RerunRepairCommand") {
    if (task.currentPhase === "Repair Verified") {
      return { status: "Completed", reason: "RepairVerified", summary: "Agent loop stopped after the reviewed self-fix was verified." };
    }

    return { status: "Paused", reason: "HumanReviewRequired", summary: "Agent loop paused after rerunning self-fix evidence." };
  }

  return undefined;
}

function latestRepairBriefForTask(task: ForgeTask): ValidationRepairBrief | undefined {
  return task.validationRepairBriefs.at(-1);
}

function summarizeAgentRunLoopProgress(task: ForgeTask, loop: AgentRunLoop): string {
  const latestStep = loop.stepIDs.at(-1)
    ? task.agentRunSteps.find((step) => step.id === loop.stepIDs.at(-1))
    : undefined;
  if (!latestStep) {
    return `Agent loop has run ${loop.stepsRun} step(s).`;
  }

  return `Agent loop ran ${loop.stepsRun} step(s); latest action ${latestStep.action} is ${latestStep.status}.`;
}

function finishAgentRunLoop(
  task: ForgeTask,
  loopID: string,
  status: AgentRunLoop["status"],
  stopReason: AgentRunLoop["stopReason"],
  summary: string
): ForgeTask {
  const loop = requireAgentRunLoop(task, loopID);
  const completedAt = new Date().toISOString();
  loop.status = status;
  loop.stopReason = stopReason;
  loop.summary = summary;
  loop.completedAt = completedAt;
  task.reviewSummary = summary;
  if (status === "Failed") {
    task.status = "Failed";
    task.currentPhase = "Agent Loop Failed";
    setAgent(task, "Manager", "Blocked", summary);
    setAgent(task, "Coder", "Blocked", "Agent loop failed before reaching a safe stop.");
    setAgent(task, "Reviewer", "Active", "Review the failed agent loop before continuing.");
  } else if (status === "Completed") {
    task.status = "Human Review";
    task.currentPhase = stopReason === "RepairVerified"
      ? "Repair Verified"
      : stopReason === "CommandPassed"
        ? "Command Passed"
        : "Agent Loop Complete";
    setAgent(task, "Manager", "Done", "Agent loop reached a safe completion condition.");
    setAgent(task, "Coder", "Done", summary);
    setAgent(task, "Reviewer", "Active", "Review the completed loop output.");
  } else if (status === "Aborted") {
    task.status = "Human Review";
    task.currentPhase = "Agent Loop Aborted";
    setAgent(task, "Manager", "Idle", "Agent loop was aborted at a safe checkpoint.");
    setAgent(task, "Coder", "Idle", summary);
    setAgent(task, "Reviewer", "Active", "Review completed steps before resuming or starting another loop.");
  } else {
    task.status = "Human Review";
    if (stopReason !== "HumanReviewRequired" && stopReason !== "StepBlocked") {
      task.currentPhase = "Agent Loop Paused";
    }
    setAgent(task, "Manager", "Ready", "Agent loop paused at a safe stop condition.");
    setAgent(task, "Coder", "Idle", summary);
    setAgent(task, "Reviewer", "Active", "Review the agent loop stop condition before continuing.");
  }
  upsertPlanStep(task, {
    id: "run-agent-loop",
    title: "Run agent loop",
    status: status === "Completed" ? "Done" : status === "Failed" || status === "Aborted" ? "Blocked" : "Active",
    summary
  });

  const type = status === "Completed"
    ? "agent.run_loop.completed"
    : status === "Failed"
      ? "agent.run_loop.failed"
      : status === "Aborted"
        ? "agent.run_loop.aborted"
        : "agent.run_loop.paused";
  saveAndBroadcast(task, withCreatedAt(event(type, summary), completedAt));
  return task;
}

function requireAgentRunLoop(task: ForgeTask, loopID: string): AgentRunLoop {
  const loop = task.agentRunLoops.find((candidate) => candidate.id === loopID);
  if (!loop) {
    throw new Error(`Agent run loop not found: ${loopID}`);
  }

  return loop;
}

function withCreatedAt(runtimeEvent: RuntimeEvent, createdAt: string): RuntimeEvent {
  runtimeEvent.createdAt = createdAt;
  return runtimeEvent;
}

async function runAgentStep(
  taskID: string,
  input: RunAgentStepRequest = {},
  options: RunAgentStepOptions = {}
): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (!options.loopID && activeAgentRunLoops.size > 0) {
    throw new HttpError(409, "Another agent loop is active in this repository. Queue this task instead of starting an overlapping step.");
  }

  if (hasRunningValidationRun(task)) {
    throw new HttpError(409, "A validation run is already active.");
  }

  if (hasRunningTaskCommandRun(task)) {
    throw new HttpError(409, "A task command is already active.");
  }

  if (task.status === "Testing") {
    throw new HttpError(409, "The task is already in testing.");
  }

  const registry = await loadValidationPresetRegistry();
  const taskCommands = buildTaskCommandPermissions(task, registry.presets);
  const runnableRerunEvidence = [...task.commandRerunEvidence]
    .reverse()
    .filter((evidence) => evidence.status === "Ready" || evidence.status === "Failed");
  let decision: AgentRunStepDecision;
  try {
    decision = await currentModelProvider().createAgentRunStep({
      task,
      taskCommands,
      commandRerunEvidence: runnableRerunEvidence
    });
  } catch (error) {
    return failAgentRunStepProviderDecision(task, error, options);
  }
  if (input.preferredCommandID?.trim() && decision.action === "RunTaskCommand") {
    decision.commandID = input.preferredCommandID.trim();
  }

  const step = createAgentRunStep(task, decision, taskCommands, runnableRerunEvidence, options);
  task.status = "Running";
  task.currentPhase = "Agent Step";
  task.reviewSummary = step.summary;
  setAgent(task, "Manager", "Active", "Coordinating the next provider-selected agent step.");
  setAgent(task, "Coder", "Active", step.summary);
  setAgent(task, "Reviewer", "Idle", "Waiting for the agent step result.");
  upsertPlanStep(task, {
    id: "run-agent-step",
    title: "Run agent step",
    status: "Active",
    summary: `${step.action}: ${step.rationale}`
  });

  const started = event("agent.run_step.started", `${step.action}: ${step.summary}`);
  started.createdAt = step.createdAt;
  saveAndBroadcast(task, started);

  return executeAgentRunStep(task.id, step.id, taskCommands);
}

function createAgentRunStep(
  task: ForgeTask,
  decision: AgentRunStepDecision,
  taskCommands: TaskCommandPermission[],
  commandRerunEvidence: CommandRerunEvidence[],
  options: RunAgentStepOptions = {}
): AgentRunStep {
  const commandPermission = decision.commandID
    ? taskCommands.find((permission) => permission.command.id === decision.commandID)
    : undefined;
  const evidence = decision.commandRerunEvidenceID
    ? commandRerunEvidence.find((candidate) => candidate.id === decision.commandRerunEvidenceID)
    : undefined;
  const step: AgentRunStep = {
    id: randomUUID(),
    provider: currentModelProvider().info,
    loopID: options.loopID,
    action: decision.action,
    status: "Running",
    summary: decision.summary,
    rationale: decision.rationale,
    commandID: decision.commandID,
    commandName: commandPermission?.command.name ?? evidence?.commandName,
    commandRerunEvidenceID: decision.commandRerunEvidenceID,
    searchTerms: decision.searchTerms,
    readPaths: decision.readPaths,
    inspectionSearchMode: decision.searchMode,
    providerAttemptCount: decision.providerAttemptCount,
    providerOutputRecovered: decision.providerOutputRecovered,
    providerAttemptErrors: decision.providerAttemptErrors,
    createdAt: new Date().toISOString()
  };
  task.agentRunSteps.push(step);
  return step;
}

function failAgentRunStepProviderDecision(
  task: ForgeTask,
  error: unknown,
  options: RunAgentStepOptions
): ForgeTask {
  const completedAt = new Date().toISOString();
  const attemptCount = error instanceof AgentRunStepProviderError ? error.attemptCount : 1;
  const attemptErrors = error instanceof AgentRunStepProviderError
    ? error.attemptErrors
    : [error instanceof Error ? error.message : String(error)];
  const message = error instanceof AgentRunStepProviderError
    ? error.message
    : `Model provider failed before selecting an agent step: ${attemptErrors[0]}`;
  const step: AgentRunStep = {
    id: randomUUID(),
    provider: currentModelProvider().info,
    loopID: options.loopID,
    action: "WaitForHumanReview",
    status: "Failed",
    summary: "Provider could not select a valid next action.",
    rationale: "Forge failed closed before executing tools, commands, or file changes.",
    providerAttemptCount: attemptCount,
    providerOutputRecovered: false,
    providerAttemptErrors: attemptErrors.map((item) => item.replace(/\s+/g, " ").trim().slice(0, 240)),
    error: message,
    createdAt: completedAt,
    completedAt
  };
  task.agentRunSteps.push(step);
  task.status = "Human Review";
  task.currentPhase = "Agent Step Failed";
  task.reviewSummary = message;
  setAgent(task, "Manager", "Blocked", "Model provider decision failed before a safe next action was selected.");
  setAgent(task, "Coder", "Blocked", step.summary);
  setAgent(task, "Reviewer", "Active", "Review the provider failure before resuming the agent loop.");
  upsertPlanStep(task, {
    id: "run-agent-step",
    title: "Run agent step",
    status: "Blocked",
    summary: message
  });

  const failed = event("agent.run_step.failed", message);
  failed.createdAt = completedAt;
  saveAndBroadcast(task, failed);
  return task;
}

async function executeAgentRunStep(
  taskID: string,
  stepID: string,
  taskCommands: TaskCommandPermission[]
): Promise<ForgeTask> {
  const task = requireTask(taskID);
  const step = requireAgentRunStep(task, stepID);

  try {
    switch (step.action) {
    case "InspectRepository":
      return await executeRepositoryInspectionStep(task, step);
    case "GenerateEditProposal":
      return completeAgentRunStepAfterAction(
        await generateEditProposal(taskID),
        stepID,
        "Agent generated an edit proposal for human review.",
        (updatedTask) => updatedTask.editProposal?.id
      );
    case "GenerateValidationRepairProposal":
      return completeAgentRunStepAfterAction(
        await generateValidationRepairProposal(taskID),
        stepID,
        "Agent generated a self-fix proposal from the latest repair brief.",
        (updatedTask) => updatedTask.editProposal?.id
      );
    case "RunTaskCommand": {
      const commandID = step.commandID?.trim();
      const permission = commandID ? taskCommands.find((candidate) => candidate.command.id === commandID) : undefined;
      if (!commandID || !permission?.canRun) {
        return blockAgentRunStep(task, step, "Selected task command is not currently approved and runnable.");
      }

      const updatedTask = await runTaskCommand(taskID, { commandID });
      const commandRun = [...updatedTask.taskCommandRuns].reverse().find((run) => run.commandID === commandID);
      return completeAgentRunStepAfterAction(
        updatedTask,
        stepID,
        commandRun
          ? `Agent ran ${commandRun.name}: ${commandRun.status}. ${commandRun.outputSummary}`
          : `Agent ran ${permission.command.name}.`,
        () => commandRun?.id
      );
    }
    case "RerunRepairCommand": {
      const evidenceID = step.commandRerunEvidenceID?.trim();
      const evidence = evidenceID
        ? task.commandRerunEvidence.find((candidate) => candidate.id === evidenceID)
        : latestRunnableCommandRerunEvidence(task);
      if (!evidence || (evidence.status !== "Ready" && evidence.status !== "Failed")) {
        return blockAgentRunStep(task, step, "Selected self-fix rerun evidence is not currently runnable.");
      }

      const updatedTask = await rerunRepairCommand(taskID, { commandRerunEvidenceID: evidence.id });
      const updatedEvidence = updatedTask.commandRerunEvidence.find((candidate) => candidate.id === evidence.id);
      return completeAgentRunStepAfterAction(
        updatedTask,
        stepID,
        updatedEvidence?.summary ?? "Agent reran the repaired command.",
        () => updatedEvidence?.rerunTaskCommandRunID ?? updatedEvidence?.id
      );
    }
    case "RequestPlanApproval":
      return blockAgentRunStep(task, step, "Plan approval is required before the agent can continue.");
    case "WaitForHumanReview":
      return blockAgentRunStep(task, step, step.summary || "Waiting for human review.");
    }
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
      return blockAgentRunStep(task, step, error.message);
    }

    return failAgentRunStep(task, step, error instanceof Error ? error.message : String(error));
  }
}

async function executeRepositoryInspectionStep(task: ForgeTask, step: AgentRunStep): Promise<ForgeTask> {
  const existingPaths = new Set(task.contextFiles.map((file) => file.path));
  const projectFiles = await runTool(
    task,
    "list_repo_files",
    "Agent step bounded repo scan excluding private and generated directories",
    listRepositoryFiles
  );
  const searchTerms = normalizeProviderSearchTerms({ searchTerms: step.searchTerms ?? [] }, task);
  const requestedReadPaths = normalizeProviderReadPaths(step.readPaths ?? [], projectFiles);
  const searchMode = step.inspectionSearchMode === "Symbol" ? "Symbol" : "Text";
  const requestFingerprint = repositoryInspectionRequestFingerprint(searchMode, searchTerms, requestedReadPaths);
  const budgetSummary = `scan<=${repositoryScanMaxFiles} search<=${repositorySearchMaxFiles} context<=${repositoryContextMaxFiles} terms=${searchTerms.length} reads=${requestedReadPaths.length}`;
  step.searchTerms = searchTerms;
  step.readPaths = requestedReadPaths;
  step.inspectionRequestFingerprint = requestFingerprint;
  step.inspectionBudgetSummary = budgetSummary;
  step.inspectionSearchMode = searchMode;
  const repeatedStep = task.agentRunSteps.find((candidate) =>
    candidate.id !== step.id &&
    candidate.action === "InspectRepository" &&
    candidate.inspectionRequestFingerprint === requestFingerprint
  );
  if (repeatedStep) {
    return blockAgentRunStep(
      task,
      step,
      `Repeated repository inspection request ${requestFingerprint} was blocked before search/read tools; first recorded by step ${repeatedStep.id}.`
    );
  }

  const priorInspections = task.agentRunSteps
    .filter((candidate) => candidate.id !== step.id && candidate.action === "InspectRepository")
    .map((candidate) => ({
      id: candidate.id,
      searchMode: candidate.inspectionSearchMode === "Symbol" ? "Symbol" as const : "Text" as const,
      searchTerms: candidate.searchTerms ?? [],
      readPaths: candidate.readPaths ?? []
    }));
  const subsumedBy = repositoryInspectionSubsumedBy(
    { searchMode, searchTerms, readPaths: requestedReadPaths },
    priorInspections
  );
  if (subsumedBy) {
    return blockAgentRunStep(
      task,
      step,
      `Repository inspection adds no new terms or paths beyond step ${subsumedBy}; blocked before search/read tools to avoid redundant work.`
    );
  }

  const searchResult = await runTool(
    task,
    searchMode === "Symbol" ? "search_repository_symbols" : "search_repository_text",
    `${searchMode}: ${searchTerms.join(", ")}`,
    () => searchRepositoryWithRipgrep(
      projectFiles,
      searchTerms,
      [...explicitContextPathsForTask(task), ...requestedReadPaths],
      searchMode
    )
  );
  step.inspectionSearchEngine = searchResult.engine;
  const matches = searchResult.matches;
  const inspectedFiles = await buildContextFiles(task, projectFiles, matches, requestedReadPaths);
  const newFiles = inspectedFiles.filter((file) => !existingPaths.has(file.path));
  step.contextFilePaths = inspectedFiles.map((file) => file.path);
  const matchCount = matches.reduce((total, match) => total + match.matchedLines.length, 0);
  const matchedFileCount = matches.filter((match) =>
    match.matchedLines.length > 0 || match.reasons.some((reason) =>
      reason.includes("match") || reason.includes("referenced")
    )
  ).length;
  const coveredTermCount = repositoryInspectionCoveredTerms(searchTerms, matches).length;
  const queryCoverage = searchTerms.length === 0 ? 1 : coveredTermCount / searchTerms.length;
  const contextByteCount = inspectedFiles.reduce((total, file) => total + (file.byteLength ?? 0), 0);
  const quality = newFiles.length === 0
    ? "NoNewContext"
    : queryCoverage >= 0.75 && matchedFileCount >= 2
      ? "Strong"
      : queryCoverage >= 0.4 || requestedReadPaths.length > 0
        ? "Partial"
        : "Weak";
  const qualitySummary = `${quality} inspection: ${matchCount} matched line(s) across ${matchedFileCount} file(s), ${coveredTermCount}/${searchTerms.length} query term(s) covered, ${newFiles.length} new context file(s), ${contextByteCount} byte(s) read.`;
  step.inspectionQuality = quality;
  step.inspectionQualitySummary = qualitySummary;
  step.inspectionMatchCount = matchCount;
  step.inspectionMatchedFileCount = matchedFileCount;
  step.inspectionNewContextFileCount = newFiles.length;
  step.inspectionContextByteCount = contextByteCount;
  step.inspectionQueryCoverage = queryCoverage;

  if (newFiles.length === 0) {
    return blockAgentRunStep(
      task,
      step,
      `Repository inspection found no new safe context for ${searchTerms.join(", ") || "the task"}. ${qualitySummary}`
    );
  }

  task.contextFiles = mergeContextFiles(task.contextFiles, inspectedFiles);
  const resultSummary = `Inspected ${inspectedFiles.length} file(s) and added ${newFiles.length} new context file(s): ${formatPathList(newFiles.map((file) => file.path))}. ${qualitySummary}`;
  if (!step.loopID) {
    task.status = "Human Review";
    task.currentPhase = "Repository Context Ready";
    task.reviewSummary = resultSummary;
    setAgent(task, "Manager", "Ready", "Repository inspection completed at a safe read-only checkpoint.");
    setAgent(task, "Coder", "Ready", resultSummary);
    setAgent(task, "Reviewer", "Active", "Review inspected context before the next agent step.");
  } else {
    setAgent(task, "Coder", "Active", resultSummary);
  }

  const updatedTask = completeAgentRunStepAfterAction(
    task,
    step.id,
    resultSummary,
    () => newFiles.at(-1)?.path
  );
  const inspected = event("agent.repository_inspection.completed", resultSummary);
  inspected.createdAt = step.completedAt ?? new Date().toISOString();
  saveAndBroadcast(updatedTask, inspected);
  return updatedTask;
}

function repositoryInspectionRequestFingerprint(searchMode: "Text" | "Symbol", searchTerms: string[], readPaths: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ searchMode, searchTerms, readPaths }))
    .digest("hex")
    .slice(0, 16);
}

function repositoryInspectionCoveredTerms(searchTerms: string[], matches: RepositorySearchMatch[]): string[] {
  return searchTerms.filter((term) => {
    const normalized = term.toLowerCase();
    return matches.some((match) =>
      match.path.toLowerCase().includes(normalized) ||
      match.reasons.some((reason) => reason.toLowerCase().includes(normalized)) ||
      match.matchedLines.some((line) => line.toLowerCase().includes(normalized))
    );
  });
}

function completeAgentRunStepAfterAction(
  task: ForgeTask,
  stepID: string,
  resultSummary: string,
  targetID: (task: ForgeTask) => string | undefined
): ForgeTask {
  const step = requireAgentRunStep(task, stepID);
  const completedAt = new Date().toISOString();
  step.status = "Completed";
  step.completedAt = completedAt;
  step.resultSummary = resultSummary;
  step.targetID = targetID(task);
  upsertPlanStep(task, {
    id: "run-agent-step",
    title: "Run agent step",
    status: "Done",
    summary: resultSummary
  });

  const completed = event("agent.run_step.completed", resultSummary);
  completed.createdAt = completedAt;
  saveAndBroadcast(task, completed);
  return task;
}

function blockAgentRunStep(task: ForgeTask, step: AgentRunStep, resultSummary: string): ForgeTask {
  const completedAt = new Date().toISOString();
  step.status = "Blocked";
  step.completedAt = completedAt;
  step.resultSummary = resultSummary;
  task.status = "Human Review";
  task.currentPhase = step.action === "RequestPlanApproval" ? "Plan Review" : "Agent Waiting";
  task.reviewSummary = resultSummary;
  setAgent(task, "Manager", "Ready", "Agent step paused at a review gate.");
  setAgent(task, "Coder", "Idle", "No safe autonomous action was executed.");
  setAgent(task, "Reviewer", "Active", resultSummary);
  upsertPlanStep(task, {
    id: "run-agent-step",
    title: "Run agent step",
    status: "Blocked",
    summary: resultSummary
  });

  const blocked = event("agent.run_step.blocked", resultSummary);
  blocked.createdAt = completedAt;
  saveAndBroadcast(task, blocked);
  return task;
}

function failAgentRunStep(task: ForgeTask, step: AgentRunStep, message: string): ForgeTask {
  const failedAt = new Date().toISOString();
  step.status = "Failed";
  step.completedAt = failedAt;
  step.error = message;
  step.resultSummary = message;
  task.status = "Failed";
  task.currentPhase = "Agent Step Failed";
  task.reviewSummary = message;
  setAgent(task, "Manager", "Blocked", "Provider-selected agent step failed.");
  setAgent(task, "Coder", "Blocked", message);
  setAgent(task, "Reviewer", "Active", "Review the failed agent step before continuing.");
  upsertPlanStep(task, {
    id: "run-agent-step",
    title: "Run agent step",
    status: "Blocked",
    summary: message
  });

  const failed = event("agent.run_step.failed", message);
  failed.createdAt = failedAt;
  saveAndBroadcast(task, failed);
  return task;
}

function requireTask(taskID: string): ForgeTask {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  return task;
}

function requireAgentRunStep(task: ForgeTask, stepID: string): AgentRunStep {
  const step = task.agentRunSteps.find((candidate) => candidate.id === stepID);
  if (!step) {
    throw new Error(`Agent run step not found: ${stepID}`);
  }

  return step;
}

return {
  getTaskQueueSnapshot,
  updateTaskQueueSettings,
  reorderTaskQueue,
  removeTaskFromQueue,
  scheduleAgentRunLoop,
  dispatchQueuedAgentRuns,
  requestAgentRunLoopControl,
  resumeAgentRunLoop,
  recoverInterruptedAgentRunLoopsOnStartup,
  recoverStuckAgentWork,
  runAgentStep
};
}
