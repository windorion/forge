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


import type { AgentOrchestrationOptions, RunAgentStepOptions } from "./agentOrchestrationTypes.js";
import type { AgentRuntimeState } from "./agentRuntimeState.js";

export function createAgentLoopService(options: AgentOrchestrationOptions & { state: AgentRuntimeState; runAgentStep: (taskID: string, input?: RunAgentStepRequest, options?: RunAgentStepOptions) => Promise<ForgeTask>; dispatchQueuedAgentRuns: () => Promise<void>; scheduleAgentRunLoop: (taskID: string, input?: RunAgentLoopRequest) => Promise<ForgeTask>; }) {
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
const { activeAgentRunLoops } = options.state;
const { runAgentStep, dispatchQueuedAgentRuns, scheduleAgentRunLoop } = options;


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


function requireTask(taskID: string): ForgeTask {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  return task;
}

return {
  runAgentLoop,
  requestAgentRunLoopControl,
  resumeAgentRunLoop,
  normalizeAgentRunLoopMaxSteps,
  withCreatedAt
};
}
