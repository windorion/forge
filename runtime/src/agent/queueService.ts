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
  SupervisedQueueDispatchResult,
  ValidationRepairBrief
} from "../types.js";
import type { InternalValidationPreset } from "../validation/validationCatalogService.js";

interface RepositorySearchMatch {
  path: string;
  score: number;
  reasons: string[];
  matchedLines: string[];
}


import type { AgentOrchestrationOptions, RunAgentStepOptions } from "./agentOrchestrationTypes.js";
import type { AgentRuntimeState } from "./agentRuntimeState.js";

export function createQueueService(options: AgentOrchestrationOptions & { state: AgentRuntimeState; runAgentLoop: (taskID: string, input?: RunAgentLoopRequest) => Promise<ForgeTask>; normalizeAgentRunLoopMaxSteps: (value: unknown) => number; withCreatedAt: (runtimeEvent: RuntimeEvent, createdAt: string) => RuntimeEvent; }) {
const {
  tasks,
  modelProvider: currentModelProvider,
  taskQueueSettingsPath,
  taskQueueSmokeDelayMs,
  supervisedQueueDispatch,
  runtimeAuthorizationID,
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
const { activeAgentRunLoops } = options.state;
const { runAgentLoop, normalizeAgentRunLoopMaxSteps, withCreatedAt } = options;
let taskQueueConcurrencyLimit = loadTaskQueueConcurrencyLimit();
let dispatchingTaskQueue = false;


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
    operationBoundary: supervisedQueueDispatch
      ? "This repository remains serialized and queued work starts only after an authorized Mission Control supervisor grant."
      : "Concurrency is capped at 1-3 globally; this single-repository runtime serializes agent loops to one active task to prevent overlapping workspace mutations.",
    dispatchMode: supervisedQueueDispatch ? "supervised" : "automatic"
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
  if (!supervisedQueueDispatch && activeAgentRunLoops.size < Math.min(taskQueueConcurrencyLimit, 1)) {
    return runAgentLoop(taskID, input);
  }
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


async function dispatchQueuedAgentRuns(supervisorGrant = false): Promise<void> {
  if (supervisedQueueDispatch && !supervisorGrant) return;
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

function dispatchNextSupervisedAgentRun(authorizationID: string): SupervisedQueueDispatchResult {
  if (!supervisedQueueDispatch) {
    throw new HttpError(409, "This runtime uses automatic queue dispatch.");
  }
  if (!runtimeAuthorizationID || authorizationID !== runtimeAuthorizationID) {
    throw new HttpError(403, "The supervisor authorization does not match this runtime session.");
  }
  if (dispatchingTaskQueue || activeAgentRunLoops.size >= Math.min(taskQueueConcurrencyLimit, 1)) {
    return { accepted: false, reason: "repository_busy", queue: getTaskQueueSnapshot() };
  }
  const next = [...tasks.values()]
    .filter((task) => task.queueRequest)
    .sort((a, b) => a.queueRequest!.position - b.queueRequest!.position)[0];
  if (!next) {
    return { accepted: false, reason: "queue_empty", queue: getTaskQueueSnapshot() };
  }
  const taskID = next.id;
  void dispatchQueuedAgentRuns(true);
  return { accepted: true, taskID, reason: "dispatched", queue: getTaskQueueSnapshot() };
}


function requireTask(taskID: string): ForgeTask {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  return task;
}

return {
  getTaskQueueSnapshot,
  updateTaskQueueSettings,
  reorderTaskQueue,
  removeTaskFromQueue,
  scheduleAgentRunLoop,
  dispatchQueuedAgentRuns,
  dispatchNextSupervisedAgentRun
};
}
