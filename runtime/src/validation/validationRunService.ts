import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { HttpError } from "../runtime/runtimeError.js";
import type { ForgeTask, ValidationRun } from "../types.js";
import { resolveValidationPresetApproval } from "./approvalLifecycle.js";
import type { InternalValidationPreset, ValidationServiceOptions } from "./validationServiceTypes.js";
import type { createProcessRunner } from "./processRunner.js";
import type { createRepairEvidenceService } from "./repairEvidenceService.js";

export function createValidationRunService(options: ValidationServiceOptions & {
  processRunner: ReturnType<typeof createProcessRunner>;
  repairEvidence: ReturnType<typeof createRepairEvidenceService>;
}) {
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
const { processRunner, repairEvidence } = options;

async function runValidation(
  taskID: string,
  trigger: ValidationRun["trigger"],
  presetID = "forge-post-apply"
): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status !== "Applied") {
    throw new HttpError(409, "Validation requires an applied edit proposal.");
  }

  if (hasRunningValidationRun(task)) {
    throw new HttpError(409, "Another validation run is already active.");
  }

  const preset = await findValidationPreset(presetID);
  const initialApproval = resolveValidationPresetApproval(task, preset.id);
  if (preset.requiresApproval && initialApproval.state !== "Approved") {
    throw new HttpError(
      409,
      initialApproval.reason ?? `Validation preset requires approval before it can run: ${preset.name}`
    );
  }

  const startedAt = new Date().toISOString();
  const validationRun: ValidationRun = {
    id: randomUUID(),
    trigger,
    presetID: preset.id,
    presetName: preset.name,
    presetSource: preset.source,
    riskLevel: preset.riskLevel,
    status: "Running",
    summary: `${preset.name} is running.`,
    startedAt,
    commands: []
  };

  task.validationRuns.push(validationRun);
  task.status = "Testing";
  task.currentPhase = "Validation";
  task.reviewSummary = "Running controlled post-apply validation.";
  setAgent(task, "Tester", "Active", "Running controlled validation commands.");
  setAgent(task, "Reviewer", "Idle", "Waiting for validation results.");
  upsertPlanStep(task, {
    id: "run-validation",
    title: "Run validation",
    status: "Active",
    summary: `Running validation preset: ${preset.name}.`
  });

  const started = event("validation.started", `Validation started: ${preset.name}.`);
  started.createdAt = startedAt;
  saveAndBroadcast(task, started);

  let approvalBecameInactive = false;
  let approvalFailureReason: string | undefined;
  for (const command of preset.commands) {
    if (preset.requiresApproval) {
      const currentApproval = resolveValidationPresetApproval(task, preset.id);
      if (currentApproval.state !== "Approved") {
        approvalBecameInactive = true;
        approvalFailureReason = currentApproval.reason ?? "Validation approval is no longer active.";
        break;
      }
    }
    const result = await processRunner.runValidationCommand(command, task, validationRun.id);
    validationRun.commands.push(result);
    task.updatedAt = result.endedAt ?? new Date().toISOString();
    saveTask(task);
    emit("validation.command.completed", {
      taskID: task.id,
      validationRunID: validationRun.id,
      command: result,
      task
    });
    if (result.status === "Cancelled" || processRunner.validationCancellationWasRequested(validationRun.id)) {
      break;
    }
  }

  const failedCommands = validationRun.commands.filter((command) => command.status === "Failed");
  const cancelled = approvalBecameInactive || validationRun.commands.some((command) => command.status === "Cancelled") ||
    processRunner.validationCancellationWasRequested(validationRun.id);
  const endedAt = new Date().toISOString();
  validationRun.endedAt = endedAt;
  validationRun.status = cancelled ? "Cancelled" : failedCommands.length === 0 ? "Passed" : "Failed";
  validationRun.summary = cancelled
    ? approvalBecameInactive
      ? `Validation stopped after ${validationRun.commands.length} command(s); remaining commands were not started because ${approvalFailureReason}`
      : `Validation cancelled after ${validationRun.commands.length} command(s); remaining commands were not started.`
    : failedCommands.length === 0
      ? `Validation passed with ${validationRun.commands.length} command(s).`
      : `Validation failed: ${failedCommands.length} of ${validationRun.commands.length} command(s) failed.`;

  task.status = validationRun.status === "Passed" ? "Completed" : validationRun.status === "Cancelled" ? "Human Review" : "Failed";
  task.currentPhase = validationRun.status === "Passed"
    ? "Validation Passed"
    : validationRun.status === "Cancelled"
      ? "Validation Cancelled"
      : "Validation Failed";
  task.reviewSummary = validationRun.summary;
  setAgent(
    task,
    "Tester",
    validationRun.status === "Passed" ? "Done" : validationRun.status === "Cancelled" ? "Idle" : "Blocked",
    validationRun.summary
  );
  setAgent(
    task,
    "Reviewer",
    validationRun.status === "Passed" ? "Active" : validationRun.status === "Cancelled" ? "Active" : "Blocked",
    validationRun.status === "Passed"
      ? "Validation passed; ready to review final changed files."
      : validationRun.status === "Cancelled"
        ? "Validation stopped at the task cancellation boundary."
      : "Validation failed; review failed commands before continuing."
  );
  upsertPlanStep(task, {
    id: "run-validation",
    title: "Run validation",
    status: validationRun.status === "Passed" ? "Done" : "Blocked",
    summary: validationRun.summary
  });

  const finished = event(
    validationRun.status === "Passed"
      ? "validation.passed"
      : validationRun.status === "Cancelled"
        ? "validation.cancelled"
        : "validation.failed",
    validationRun.summary
  );
  finished.createdAt = endedAt;
  processRunner.clearValidationCancellationRequest(validationRun.id);
  saveAndBroadcast(task, finished);
  if (validationRun.status === "Failed") {
    await repairEvidence.createValidationRepairBriefForRun(task, validationRun);
  }
  return task;
}

async function validateChangedFiles(task: ForgeTask): Promise<string> {
  if (task.changedFiles.length === 0) {
    throw new Error("No changed files were recorded for validation.");
  }

  const validatedFiles: string[] = [];
  for (const changedFile of task.changedFiles) {
    const { absolutePath, relativePath } = resolveEditableWorkspacePath(changedFile);
    const appliedChange = task.editProposal?.appliedFileChanges?.find((change) => change.path === relativePath);
    if (appliedChange?.rollbackKind === "RestoreDeletedFile") {
      try {
        await stat(absolutePath);
        throw new Error(`Deleted file unexpectedly exists after apply: ${relativePath}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Deleted file unexpectedly")) throw error;
        if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      }
      validatedFiles.push(`${relativePath} (deleted)`);
      continue;
    }

    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error(`Changed file is no longer an editable text file: ${relativePath}`);
    }
    validatedFiles.push(relativePath);
  }

  return `Validated ${validatedFiles.length} changed file(s): ${validatedFiles.join(", ")}.`;
}

async function validateAppliedProposalRecorded(task: ForgeTask): Promise<string> {
  if (task.editProposal?.status !== "Applied") {
    throw new Error("Edit proposal is not marked Applied.");
  }

  const applyApproval = task.approvals.find((approval) => approval.action === "Apply Edit Proposal");
  if (!applyApproval) {
    throw new Error("No Apply Edit Proposal approval record exists.");
  }

  return `Applied proposal ${task.editProposal.id} is recorded with approval ${applyApproval.id}.`;
}

async function validateReadyProposalValidation(task: ForgeTask): Promise<string> {
  if (task.editProposal?.validation?.status !== "Ready") {
    throw new Error("Applied proposal does not retain a Ready validation result.");
  }

  return `Ready validation retained from ${task.editProposal.validation.checkedAt}.`;
}

async function findValidationPreset(presetID: string): Promise<InternalValidationPreset> {
  const registry = await loadValidationPresetRegistry();
  const preset = registry.presets.find((candidate) => candidate.id === presetID);
  if (!preset) {
    throw new HttpError(404, `Validation preset not found: ${presetID}`);
  }

  return preset;
}

function hasRunningValidationRun(task: ForgeTask): boolean {
  return task.validationRuns.some((run) => run.status === "Running");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

return { runValidation, validateChangedFiles, validateAppliedProposalRecorded, validateReadyProposalValidation };
}
