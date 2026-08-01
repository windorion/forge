import { randomUUID } from "node:crypto";
import { HttpError } from "../runtime/runtimeError.js";
import type { ApprovalRecord, ApproveValidationPresetRequest, ForgeTask, RerunRepairCommandRequest, RunTaskCommandRequest, TaskCommandRun } from "../types.js";
import type { InternalValidationCommand, InternalValidationPreset, ValidationServiceOptions } from "./validationServiceTypes.js";
import type { createProcessRunner } from "./processRunner.js";
import type { createRepairEvidenceService } from "./repairEvidenceService.js";

export function createTaskCommandService(options: ValidationServiceOptions & {
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

async function approveValidationPreset(taskID: string, input: ApproveValidationPresetRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const preset = await findValidationPreset(input.presetID);
  if (!preset.requiresApproval) {
    throw new HttpError(409, `Validation preset does not require approval: ${preset.id}`);
  }

  if (hasValidationPresetApproval(task, preset.id)) {
    throw new HttpError(409, `Validation preset already approved: ${preset.id}`);
  }

  const now = new Date().toISOString();
  task.approvals.push({
    id: randomUUID(),
    action: "Approve Validation Preset",
    decision: "Approved",
    summary: `Approved validation preset "${preset.name}".`,
    targetID: preset.id,
    decidedAt: now,
    userNote: input.note?.trim() || undefined
  });
  task.reviewSummary = `Validation preset approved: ${preset.name}.`;
  setAgent(task, "Tester", "Ready", `Validation preset approved: ${preset.name}.`);
  upsertPlanStep(task, {
    id: `approve-validation-preset-${preset.id}`,
    title: "Approve validation preset",
    status: "Done",
    summary: `${preset.name} can now run for this task.`
  });

  const approved = event("validation.preset.approved", `Validation preset approved: ${preset.name}.`);
  approved.createdAt = now;
  saveAndBroadcast(task, approved);
  return task;
}

async function rerunRepairCommand(taskID: string, input: RerunRepairCommandRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const evidence = findCommandRerunEvidenceForRequest(task, input);
  if (!evidence) {
    throw new HttpError(409, "No applied task-command repair is ready to rerun.");
  }

  if (evidence.status === "Running") {
    throw new HttpError(409, "Repair command rerun is already active.");
  }

  if (evidence.status === "Passed") {
    throw new HttpError(409, "Repair command rerun has already passed.");
  }

  if (!evidence.repairAppliedAt) {
    throw new HttpError(409, "Repair command rerun requires an applied repair proposal.");
  }

  const sourceRun = task.taskCommandRuns.find((run) => run.id === evidence.sourceTaskCommandRunID);
  if (!sourceRun || sourceRun.status !== "Failed") {
    throw new HttpError(409, "Repair command rerun requires a failed source command run.");
  }

  const repairProposal = findEditProposalByID(task, evidence.repairProposalID);
  if (!repairProposal || repairProposal.status !== "Applied") {
    throw new HttpError(409, "Repair command rerun requires an applied repair proposal.");
  }

  if (hasRunningTaskCommandRun(task)) {
    throw new HttpError(409, "Another task command is already active.");
  }

  if (hasRunningValidationRun(task)) {
    throw new HttpError(409, "A validation run is already active.");
  }

  const startedAt = new Date().toISOString();
  evidence.status = "Running";
  evidence.summary = `Rerunning ${evidence.commandName} to verify the applied self-fix.`;
  evidence.updatedAt = startedAt;
  task.status = "Testing";
  task.currentPhase = "Repair Rerun";
  task.reviewSummary = evidence.summary;
  setAgent(task, "Tester", "Active", `Rerunning ${sourceRun.command}.`);
  setAgent(task, "Reviewer", "Idle", "Waiting for self-fix rerun evidence.");
  upsertPlanStep(task, {
    id: `rerun-repair-command-${sourceRun.commandID}`,
    title: "Rerun repaired command",
    status: "Active",
    summary: evidence.summary
  });

  const existingRunIDs = new Set(task.taskCommandRuns.map((run) => run.id));
  const started = event("task.command.rerun_evidence.started", evidence.summary);
  started.createdAt = startedAt;
  saveAndBroadcast(task, started);

  try {
    const updatedTask = await runTaskCommand(task.id, { commandID: evidence.commandID });
    const updatedEvidence = updatedTask.commandRerunEvidence.find((candidate) => candidate.id === evidence.id);
    if (!updatedEvidence) {
      throw new Error("Repair command rerun evidence disappeared during command execution.");
    }

    const rerun = [...updatedTask.taskCommandRuns].reverse().find((run) => !existingRunIDs.has(run.id));
    if (!rerun) {
      throw new Error("Repair command rerun completed without recording a command run.");
    }

    const endedAt = rerun.endedAt ?? new Date().toISOString();
    updatedEvidence.rerunTaskCommandRunID = rerun.id;
    updatedEvidence.status = rerun.status;
    updatedEvidence.updatedAt = endedAt;
    updatedEvidence.summary = summarizeCommandRerunEvidence(rerun);

    const passed = rerun.status === "Passed";
    const cancelled = rerun.status === "Cancelled";
    updatedTask.status = passed ? "Human Review" : cancelled ? "Human Review" : "Failed";
    updatedTask.currentPhase = passed ? "Repair Verified" : cancelled ? "Repair Rerun Cancelled" : "Repair Rerun Failed";
    updatedTask.reviewSummary = updatedEvidence.summary;
    setAgent(
      updatedTask,
      "Tester",
      passed ? "Done" : "Blocked",
      passed ? `${rerun.name} passed after the repair.` : updatedEvidence.summary
    );
    setAgent(
      updatedTask,
      "Reviewer",
      "Active",
      passed
        ? "Self-fix rerun evidence is ready for review."
        : "Review the rerun output and new repair brief before continuing."
    );
    upsertPlanStep(updatedTask, {
      id: `rerun-repair-command-${rerun.commandID}`,
      title: "Rerun repaired command",
      status: passed ? "Done" : "Blocked",
      summary: updatedEvidence.summary
    });

    const finished = event(
      passed
        ? "task.command.rerun_evidence.passed"
        : cancelled
          ? "task.command.rerun_evidence.cancelled"
          : "task.command.rerun_evidence.failed",
      updatedEvidence.summary
    );
    finished.createdAt = endedAt;
    saveAndBroadcast(updatedTask, finished);
    return updatedTask;
  } catch (error) {
    const failedTask = tasks.get(taskID) ?? task;
    const failedEvidence = failedTask.commandRerunEvidence.find((candidate) => candidate.id === evidence.id) ?? evidence;
    const message = error instanceof Error ? error.message : String(error);
    const failedAt = new Date().toISOString();
    failedEvidence.status = "Failed";
    failedEvidence.summary = `Repair command rerun failed before evidence could be recorded: ${message}`;
    failedEvidence.updatedAt = failedAt;
    failedTask.status = "Failed";
    failedTask.currentPhase = "Repair Rerun Failed";
    failedTask.reviewSummary = failedEvidence.summary;
    setAgent(failedTask, "Tester", "Blocked", failedEvidence.summary);
    setAgent(failedTask, "Reviewer", "Active", "Review the failed rerun attempt before continuing.");
    upsertPlanStep(failedTask, {
      id: `rerun-repair-command-${evidence.commandID}`,
      title: "Rerun repaired command",
      status: "Blocked",
      summary: failedEvidence.summary
    });

    const failed = event("task.command.rerun_evidence.failed", failedEvidence.summary);
    failed.createdAt = failedAt;
    saveAndBroadcast(failedTask, failed);
    throw error;
  }
}

async function runTaskCommand(taskID: string, input: RunTaskCommandRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const commandID = input.commandID?.trim();
  if (!commandID) {
    throw new HttpError(400, "Task command requires a commandID.");
  }

  const command = validationCommandCatalog.get(commandID);
  if (!command) {
    throw new HttpError(404, `Task command not found: ${commandID}`);
  }

  if (hasRunningTaskCommandRun(task)) {
    throw new HttpError(409, "Another task command is already active.");
  }

  if (hasRunningValidationRun(task)) {
    throw new HttpError(409, "A validation run is already active.");
  }

  const preset = await findTaskCommandExecutionPreset(task, command);
  if (command.kind === "ProjectCommand") {
    resolvePresetCommandCwd(command.cwd);
  }

  const startedAt = new Date().toISOString();
  const commandRun: TaskCommandRun = {
    id: randomUUID(),
    commandID: command.id,
    name: command.name,
    command: command.command,
    kind: command.kind,
    riskLevel: command.riskLevel,
    cwd: command.cwd,
    presetID: preset.id,
    presetName: preset.name,
    status: "Running",
    outputSummary: "Running",
    outputChunks: [],
    startedAt
  };

  task.taskCommandRuns.push(commandRun);
  task.status = "Testing";
  task.currentPhase = "Command Running";
  task.reviewSummary = `Running task command: ${command.name}.`;
  setAgent(task, "Tester", "Active", `Running ${command.command}.`);
  setAgent(task, "Reviewer", "Idle", "Waiting for command output.");
  upsertPlanStep(task, {
    id: `run-task-command-${command.id}`,
    title: "Run task command",
    status: "Active",
    summary: `Running ${command.name} through approved preset ${preset.name}.`
  });

  const started = event("task.command.started", `Task command started: ${command.name}.`);
  started.createdAt = startedAt;
  saveAndBroadcast(task, started);

  try {
    const output = command.kind === "BuiltIn"
      ? await processRunner.runBuiltInTaskCommand(command, task, commandRun)
      : await processRunner.runProjectTaskCommand(command, task, commandRun);
    commandRun.exitCode = output.exitCode;
    commandRun.outputSummary = output.outputSummary;
    commandRun.status = output.cancelled ? "Cancelled" : output.exitCode === 0 ? "Passed" : "Failed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    commandRun.status = "Failed";
    commandRun.outputSummary = message;
    processRunner.appendTaskCommandOutputChunk(task, commandRun, "system", `${message}\n`);
  }

  const endedAt = new Date().toISOString();
  commandRun.endedAt = endedAt;
  const passed = commandRun.status === "Passed";
  const cancelled = commandRun.status === "Cancelled";
  task.status = passed || cancelled ? "Human Review" : "Failed";
  task.currentPhase = passed ? "Command Passed" : cancelled ? "Command Cancelled" : "Command Failed";
  task.reviewSummary = commandRun.outputSummary;
  setAgent(
    task,
    "Tester",
    passed ? "Done" : "Blocked",
    passed ? `${command.name} passed.` : cancelled ? `${command.name} was cancelled.` : `${command.name} failed.`
  );
  setAgent(
    task,
    "Reviewer",
    "Active",
    passed
      ? "Command output is ready for review."
      : cancelled
        ? "Command was cancelled; review output before rerunning."
        : "Review failed command output before continuing."
  );
  upsertPlanStep(task, {
    id: `run-task-command-${command.id}`,
    title: "Run task command",
    status: passed ? "Done" : "Blocked",
    summary: commandRun.outputSummary
  });

  const finished = event(
    passed ? "task.command.passed" : cancelled ? "task.command.cancelled" : "task.command.failed",
    passed
      ? `Task command passed: ${command.name}.`
      : cancelled
        ? `Task command cancelled: ${command.name}.`
        : `Task command failed: ${command.name}.`
  );
  finished.createdAt = endedAt;
  saveAndBroadcast(task, finished);
  emit("task.command.completed", {
    taskID: task.id,
    taskCommandRunID: commandRun.id,
    commandRun,
    task
  });
  if (!passed && !cancelled) {
    await repairEvidence.createValidationRepairBriefForTaskCommandRun(task, commandRun);
  }
  return task;
}

async function findTaskCommandExecutionPreset(
  task: ForgeTask,
  command: InternalValidationCommand
): Promise<InternalValidationPreset> {
  const registry = await loadValidationPresetRegistry();
  const matchingPresets = registry.presets.filter((preset) =>
    preset.commands.some((candidate) => candidate.id === command.id)
  );

  const noApprovalPreset = matchingPresets.find((preset) => !preset.requiresApproval);
  if (noApprovalPreset) {
    return noApprovalPreset;
  }

  const approvedPreset = matchingPresets.find((preset) => hasValidationPresetApproval(task, preset.id));
  if (approvedPreset) {
    return approvedPreset;
  }

  if (matchingPresets.length === 0) {
    throw new HttpError(409, `Task command is not exposed through a validation preset: ${command.id}`);
  }

  const presetNames = matchingPresets.map((preset) => preset.name).join(", ");
  throw new HttpError(409, `Task command requires approval through one of these presets before execution: ${presetNames}`);
}

async function findValidationPreset(presetID: string): Promise<InternalValidationPreset> {
  const registry = await loadValidationPresetRegistry();
  const preset = registry.presets.find((candidate) => candidate.id === presetID);
  if (!preset) {
    throw new HttpError(404, `Validation preset not found: ${presetID}`);
  }

  return preset;
}

function hasValidationPresetApproval(task: ForgeTask, presetID: string): boolean {
  return findValidationPresetApproval(task, presetID) !== undefined;
}

function findValidationPresetApproval(task: ForgeTask, presetID: string): ApprovalRecord | undefined {
  return task.approvals.find(
    (approval) =>
      approval.action === "Approve Validation Preset" &&
      approval.decision === "Approved" &&
      approval.targetID === presetID
  );
}

function hasRunningValidationRun(task: ForgeTask): boolean {
  return task.validationRuns.some((run) => run.status === "Running");
}

function hasRunningTaskCommandRun(task: ForgeTask): boolean {
  return task.taskCommandRuns.some((run) => run.status === "Running");
}

return { approveValidationPreset, rerunRepairCommand, runTaskCommand };
}
