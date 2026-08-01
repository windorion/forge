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

export function createAgentStepService(options: AgentOrchestrationOptions & { state: AgentRuntimeState; executeRepositoryInspectionStep: (task: ForgeTask, step: AgentRunStep) => Promise<ForgeTask>; }) {
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
const { executeRepositoryInspectionStep } = options;


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
  runAgentStep,
  completeAgentRunStepAfterAction,
  blockAgentRunStep
};
}
