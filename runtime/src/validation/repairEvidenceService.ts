import type { ForgeTask, PlanRevision, TaskCommandPermission, TaskCommandRun, TaskMessage, ValidationPermissionLastRun, ValidationRepairBrief, ValidationRun } from "../types.js";
import { findValidationPresetApproval, hasValidationPresetApproval } from "./approvalLifecycle.js";
import type { ValidationServiceOptions } from "./validationServiceTypes.js";

export function createRepairEvidenceService(options: ValidationServiceOptions) {
const {
  tasks,
  runtimeEnvironment,
  validationCommandCatalog,
  loadValidationPresetRegistry,
  resolvePresetCommandCwd,
  saveTask,
  saveAndBroadcast,
  emit,
  event,
  setAgent,
  upsertPlanStep,
  findCommandRerunEvidenceForRequest,
  findEditProposalByID,
  summarizeCommandRerunEvidence,
  resolveEditableWorkspacePath
} = options;
const currentModelProvider = options.modelProvider;

async function createValidationRepairBriefForRun(
  task: ForgeTask,
  validationRun: ValidationRun
): Promise<void> {
  const startedAt = new Date().toISOString();
  upsertPlanStep(task, {
    id: "analyze-validation-failure",
    title: "Analyze validation failure",
    status: "Active",
    summary: `Asking ${currentModelProvider().info.name} for a repair brief from failed validation output.`
  });

  const started = event(
    "validation.repair_brief.started",
    `Generating repair brief for failed validation run: ${validationRun.presetName}.`
  );
  started.createdAt = startedAt;
  saveAndBroadcast(task, started);

  try {
    const brief = await currentModelProvider().createValidationRepairBrief({ task, validationRun });
    task.validationRepairBriefs.push(brief);
    task.reviewSummary = `${validationRun.summary} Repair brief: ${brief.summary}`;
    setAgent(task, "Planner", "Done", "Prepared a repair brief from validation failure output.");
    setAgent(task, "Coder", "Ready", "Ready to turn the repair brief into a revised proposal after human review.");
    setAgent(task, "Reviewer", "Active", "Review the validation failure and repair brief before continuing.");
    upsertPlanStep(task, {
      id: "analyze-validation-failure",
      title: "Analyze validation failure",
      status: "Done",
      summary: brief.summary
    });
    upsertPlanStep(task, {
      id: "plan-validation-repair",
      title: "Plan validation repair",
      status: "Active",
      summary: brief.followUpPrompt
    });

    const ready = event("validation.repair_brief.ready", brief.summary);
    ready.createdAt = brief.generatedAt;
    saveAndBroadcast(task, ready);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    upsertPlanStep(task, {
      id: "analyze-validation-failure",
      title: "Analyze validation failure",
      status: "Blocked",
      summary: message
    });

    const failed = event("validation.repair_brief.failed", message);
    failed.createdAt = new Date().toISOString();
    saveAndBroadcast(task, failed);
  }
}

async function createValidationRepairBriefForTaskCommandRun(
  task: ForgeTask,
  taskCommandRun: TaskCommandRun
): Promise<void> {
  const startedAt = new Date().toISOString();
  upsertPlanStep(task, {
    id: "analyze-task-command-failure",
    title: "Analyze command failure",
    status: "Active",
    summary: `Asking ${currentModelProvider().info.name} for a repair brief from failed command output.`
  });

  const started = event(
    "task.command.repair_brief.started",
    `Generating repair brief for failed task command: ${taskCommandRun.name}.`
  );
  started.createdAt = startedAt;
  saveAndBroadcast(task, started);

  try {
    const brief = await currentModelProvider().createValidationRepairBrief({ task, taskCommandRun });
    task.validationRepairBriefs.push(brief);
    task.reviewSummary = `${taskCommandRun.name} failed. Repair brief: ${brief.summary}`;
    setAgent(task, "Planner", "Done", "Prepared a repair brief from task command output.");
    setAgent(task, "Coder", "Ready", "Ready to turn the command failure brief into a reviewed proposal.");
    setAgent(task, "Reviewer", "Active", "Review the failed command and repair brief before continuing.");
    upsertPlanStep(task, {
      id: "analyze-task-command-failure",
      title: "Analyze command failure",
      status: "Done",
      summary: brief.summary
    });
    upsertPlanStep(task, {
      id: "plan-validation-repair",
      title: "Plan command repair",
      status: "Active",
      summary: brief.followUpPrompt
    });

    const ready = event("task.command.repair_brief.ready", brief.summary);
    ready.createdAt = brief.generatedAt;
    saveAndBroadcast(task, ready);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    upsertPlanStep(task, {
      id: "analyze-task-command-failure",
      title: "Analyze command failure",
      status: "Blocked",
      summary: message
    });

    const failed = event("task.command.repair_brief.failed", message);
    failed.createdAt = new Date().toISOString();
    saveAndBroadcast(task, failed);
  }
}

function latestTaskMessage(task: ForgeTask, role?: TaskMessage["role"]): TaskMessage | undefined {
  return [...task.messages].reverse().find((message) => !role || message.role === role);
}

function latestPlanRevision(task: ForgeTask): PlanRevision | undefined {
  return task.planRevisions.at(-1);
}

function hasPlanApproval(task: ForgeTask, planRevisionID: string | undefined): boolean {
  return task.approvals.some(
    (approval) =>
      approval.action === "Approve Plan" &&
      approval.decision === "Approved" &&
      approval.targetID === planRevisionID
  );
}

function hasRunningValidationRun(task: ForgeTask): boolean {
  return task.validationRuns.some((run) => run.status === "Running");
}

function hasRunningTaskCommandRun(task: ForgeTask): boolean {
  return task.taskCommandRuns.some((run) => run.status === "Running");
}

function findLastValidationRun(task: ForgeTask, presetID: string): ValidationPermissionLastRun | undefined {
  const run = [...task.validationRuns].reverse().find((candidate) => candidate.presetID === presetID);
  if (!run) {
    return undefined;
  }

  return {
    id: run.id,
    status: run.status,
    summary: run.summary,
    startedAt: run.startedAt,
    endedAt: run.endedAt
  };
}

function findLastTaskCommandRun(task: ForgeTask, commandID: string): TaskCommandPermission["lastRun"] {
  const run = [...task.taskCommandRuns].reverse().find((candidate) => candidate.commandID === commandID);
  if (!run) {
    return undefined;
  }

  return {
    id: run.id,
    status: run.status,
    summary: run.outputSummary,
    startedAt: run.startedAt,
    endedAt: run.endedAt
  };
}

function latestFailedValidationRun(task: ForgeTask): ValidationRun | undefined {
  return [...task.validationRuns].reverse().find((run) => run.status === "Failed");
}

function latestFailedTaskCommandRun(task: ForgeTask): TaskCommandRun | undefined {
  return [...task.taskCommandRuns].reverse().find((run) => run.status === "Failed");
}

function latestValidationRepairBriefForRun(
  task: ForgeTask,
  validationRunID: string
): ValidationRepairBrief | undefined {
  return [...task.validationRepairBriefs].reverse().find((brief) => brief.validationRunID === validationRunID);
}

function latestValidationRepairBriefForTaskCommandRun(
  task: ForgeTask,
  taskCommandRunID: string
): ValidationRepairBrief | undefined {
  return [...task.validationRepairBriefs].reverse().find((brief) => brief.taskCommandRunID === taskCommandRunID);
}

function latestRepairProposalSource(
  task: ForgeTask
): { kind: "ValidationRun"; brief: ValidationRepairBrief; validationRun: ValidationRun } |
  { kind: "TaskCommandRun"; brief: ValidationRepairBrief; taskCommandRun: TaskCommandRun } |
  undefined {
  const failedValidationRun = latestFailedValidationRun(task);
  const validationBrief = failedValidationRun
    ? latestValidationRepairBriefForRun(task, failedValidationRun.id)
    : undefined;
  const failedTaskCommandRun = latestFailedTaskCommandRun(task);
  const taskCommandBrief = failedTaskCommandRun
    ? latestValidationRepairBriefForTaskCommandRun(task, failedTaskCommandRun.id)
    : undefined;

  if (failedTaskCommandRun && taskCommandBrief) {
    if (!failedValidationRun || compareTaskCommandAndValidationFailureTime(failedTaskCommandRun, failedValidationRun) >= 0) {
      return {
        kind: "TaskCommandRun",
        brief: taskCommandBrief,
        taskCommandRun: failedTaskCommandRun
      };
    }
  }

  if (failedValidationRun && validationBrief) {
    return {
      kind: "ValidationRun",
      brief: validationBrief,
      validationRun: failedValidationRun
    };
  }

  if (failedTaskCommandRun && taskCommandBrief) {
    return {
      kind: "TaskCommandRun",
      brief: taskCommandBrief,
      taskCommandRun: failedTaskCommandRun
    };
  }

  return undefined;
}

function compareTaskCommandAndValidationFailureTime(
  taskCommandRun: TaskCommandRun,
  validationRun: ValidationRun
): number {
  const commandTime = taskCommandRun.endedAt ?? taskCommandRun.startedAt;
  const validationTime = validationRun.endedAt ?? validationRun.startedAt;
  return commandTime.localeCompare(validationTime);
}

return { createValidationRepairBriefForRun, createValidationRepairBriefForTaskCommandRun, latestTaskMessage, latestPlanRevision, hasPlanApproval, hasValidationPresetApproval, findValidationPresetApproval, hasRunningValidationRun, hasRunningTaskCommandRun, findLastValidationRun, findLastTaskCommandRun, latestFailedValidationRun, latestFailedTaskCommandRun, latestValidationRepairBriefForRun, latestValidationRepairBriefForTaskCommandRun, latestRepairProposalSource };
}
