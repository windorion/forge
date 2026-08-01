import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";

import { HttpError } from "../runtime/runtimeError.js";
import type { ModelProvider } from "../modelProvider.js";
import type {
  AgentState,
  ApprovalRecord,
  ApproveValidationPresetRequest,
  CancelTaskCommandRequest,
  CommandRerunEvidence,
  EditProposal,
  ForgeTask,
  PlanRevision,
  PlanStep,
  RerunRepairCommandRequest,
  RunTaskCommandRequest,
  RuntimeEvent,
  TaskCommandOutputChunk,
  TaskCommandPermission,
  TaskCommandRun,
  TaskMessage,
  ValidationCommandDefinition,
  ValidationCommandResult,
  ValidationPermissionLastRun,
  ValidationPreset,
  ValidationRepairBrief,
  ValidationRun
} from "../types.js";

type InternalValidationCommand = Omit<ValidationCommandDefinition, "executionMode" | "boundary"> & {
  executable?: string;
  args?: string[];
  executeBuiltIn?: (task: ForgeTask) => Promise<string>;
};

type InternalValidationPreset = Omit<ValidationPreset, "commands"> & {
  commands: InternalValidationCommand[];
};

interface ActiveTaskCommand {
  taskID: string;
  taskCommandRunID: string;
  child: ReturnType<typeof spawn>;
  timeout?: ReturnType<typeof setTimeout>;
  cancelTimeout?: ReturnType<typeof setTimeout>;
  cancelled: boolean;
  cancellationNote?: string;
  cancelledAt?: string;
}

interface TaskCommandExecutionResult {
  outputSummary: string;
  exitCode: number;
  cancelled?: boolean;
}

interface SpawnedTaskCommandResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
}

export function createValidationService(options: {
  tasks: Map<string, ForgeTask>;
  modelProvider: () => ModelProvider;
  runtimeEnvironment: NodeJS.ProcessEnv;
  validationCommandCatalog: Map<string, InternalValidationCommand>;
  loadValidationPresetRegistry: () => Promise<{ presets: InternalValidationPreset[] }>;
  resolvePresetCommandCwd: (inputPath: string | undefined) => string;
  saveTask: (task: ForgeTask) => void;
  saveAndBroadcast: (task: ForgeTask, event: RuntimeEvent) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
  event: (type: string, message: string) => RuntimeEvent;
  setAgent: (task: ForgeTask, role: AgentState["role"], status: AgentState["status"], summary: string) => void;
  upsertPlanStep: (task: ForgeTask, planStep: PlanStep) => void;
  findCommandRerunEvidenceForRequest: (task: ForgeTask, input: RerunRepairCommandRequest) => CommandRerunEvidence | undefined;
  findEditProposalByID: (task: ForgeTask, proposalID: string) => EditProposal | undefined;
  summarizeCommandRerunEvidence: (run: TaskCommandRun) => string;
  resolveEditableWorkspacePath: (inputPath: string) => { absolutePath: string; relativePath: string };
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
const currentModelProvider = options.modelProvider;
const activeTaskCommands = new Map<string, ActiveTaskCommand>();
const validationCommandTimeoutMs = 60_000;
const taskCommandCancellationGraceMs = 3_000;
const taskCommandOutputChunkLimit = 80;
const taskCommandOutputTextLimit = 24_000;
const taskCommandChunkTextLimit = 4_000;

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
      ? await runBuiltInTaskCommand(command, task, commandRun)
      : await runProjectTaskCommand(command, task, commandRun);
    commandRun.exitCode = output.exitCode;
    commandRun.outputSummary = output.outputSummary;
    commandRun.status = output.cancelled ? "Cancelled" : output.exitCode === 0 ? "Passed" : "Failed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    commandRun.status = "Failed";
    commandRun.outputSummary = message;
    appendTaskCommandOutputChunk(task, commandRun, "system", `${message}\n`);
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
    await createValidationRepairBriefForTaskCommandRun(task, commandRun);
  }
  return task;
}

async function cancelTaskCommand(taskID: string, input: CancelTaskCommandRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const requestedRunID = input.taskCommandRunID?.trim();
  const commandRun = requestedRunID
    ? task.taskCommandRuns.find((run) => run.id === requestedRunID)
    : [...task.taskCommandRuns].reverse().find((run) => run.status === "Running");
  if (!commandRun) {
    throw new HttpError(404, requestedRunID ? `Task command run not found: ${requestedRunID}` : "No task command run found.");
  }

  if (commandRun.status !== "Running") {
    throw new HttpError(409, `Task command is not running: ${commandRun.status}.`);
  }

  const active = activeTaskCommands.get(commandRun.id);
  if (!active || active.taskID !== task.id) {
    throw new HttpError(409, "Task command is not cancellable by this runtime process.");
  }

  if (active.cancelled) {
    return task;
  }

  const now = new Date().toISOString();
  const note = input.note?.trim();
  active.cancelled = true;
  active.cancelledAt = now;
  active.cancellationNote = note || undefined;

  commandRun.outputSummary = "Cancellation requested. Waiting for process to exit.";
  task.status = "Testing";
  task.currentPhase = "Command Cancelling";
  task.reviewSummary = `Stopping task command: ${commandRun.name}.`;
  setAgent(task, "Tester", "Active", `Stopping ${commandRun.command}.`);
  setAgent(task, "Reviewer", "Idle", "Waiting for command to stop.");
  upsertPlanStep(task, {
    id: `run-task-command-${commandRun.commandID}`,
    title: "Run task command",
    status: "Active",
    summary: "Cancellation requested; waiting for the process to exit."
  });

  appendTaskCommandOutputChunk(task, commandRun, "system", "Cancellation requested by user. Sending SIGTERM.\n");
  active.cancelTimeout = setTimeout(() => {
    appendTaskCommandOutputChunk(
      task,
      commandRun,
      "system",
      `Command did not stop after ${taskCommandCancellationGraceMs / 1000}s. Sending SIGKILL.\n`
    );
    active.child.kill("SIGKILL");
  }, taskCommandCancellationGraceMs);
  const signalSent = active.child.kill("SIGTERM");
  if (!signalSent) {
    appendTaskCommandOutputChunk(task, commandRun, "system", "Process was already exiting when cancellation was requested.\n");
  }

  task.approvals.push({
    id: randomUUID(),
    action: "Cancel Task Command",
    decision: "Approved",
    summary: `Cancel requested for task command: ${commandRun.name}.`,
    decidedAt: now,
    targetID: commandRun.id,
    userNote: note || undefined
  });

  const requested = event("task.command.cancel.requested", `Task command cancellation requested: ${commandRun.name}.`);
  requested.createdAt = now;
  saveAndBroadcast(task, requested);
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

async function runBuiltInTaskCommand(
  command: InternalValidationCommand,
  task: ForgeTask,
  commandRun: TaskCommandRun
): Promise<TaskCommandExecutionResult> {
  const outputSummary = await runBuiltInValidationCommand(command, task);
  appendTaskCommandOutputChunk(task, commandRun, "system", `${outputSummary.outputSummary}\n`);
  return {
    outputSummary: outputSummary.outputSummary,
    exitCode: outputSummary.exitCode ?? 0
  };
}

async function runProjectTaskCommand(
  command: InternalValidationCommand,
  task: ForgeTask,
  commandRun: TaskCommandRun
): Promise<TaskCommandExecutionResult> {
  if (!command.executable || !command.args) {
    throw new Error(`Project task command is missing executable metadata: ${command.command}`);
  }

  const cwd = resolvePresetCommandCwd(command.cwd);
  const result = await runSpawnedTaskCommand(command, cwd, task, commandRun);
  return {
    outputSummary: result.cancelled
      ? `${command.command} cancelled by user.`
      : summarizeCommandOutput(command.command, result.exitCode, result.output),
    exitCode: result.exitCode,
    cancelled: result.cancelled
  };
}

function runSpawnedTaskCommand(
  command: InternalValidationCommand,
  cwd: string,
  task: ForgeTask,
  commandRun: TaskCommandRun
): Promise<SpawnedTaskCommandResult> {
  const executable = command.executable;
  const args = command.args;
  if (!executable || !args) {
    return Promise.reject(new Error(`Task command is missing executable metadata: ${command.command}`));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      env: { ...runtimeEnvironment, CI: "1" }
    });
    const active: ActiveTaskCommand = {
      taskID: task.id,
      taskCommandRunID: commandRun.id,
      child,
      cancelled: false
    };
    activeTaskCommands.set(commandRun.id, active);

    let output = "";
    let timedOut = false;
    let timeoutMessage = "";
    let settled = false;
    const appendOutput = (stream: TaskCommandOutputChunk["stream"], chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      if (output.length > 12_000) {
        output = output.slice(output.length - 12_000);
      }
      appendTaskCommandOutputChunk(task, commandRun, stream, text);
    };

    const timeout = setTimeout(() => {
      timeoutMessage = `Command timed out after ${validationCommandTimeoutMs / 1000}s.\n`;
      timedOut = true;
      child.kill("SIGTERM");
      appendTaskCommandOutputChunk(task, commandRun, "system", timeoutMessage);
    }, validationCommandTimeoutMs);
    active.timeout = timeout;

    const clearActiveCommand = () => {
      clearTimeout(timeout);
      if (active.cancelTimeout) {
        clearTimeout(active.cancelTimeout);
      }
      activeTaskCommands.delete(commandRun.id);
    };

    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.on("error", (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearActiveCommand();
      reject(error);
    });
    child.on("close", (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearActiveCommand();
      const cancelled = active.cancelled;
      resolve({
        exitCode: cancelled ? 130 : timedOut ? 124 : code ?? 1,
        output: cancelled ? output : timedOut ? `${output}${timeoutMessage}` : output,
        timedOut,
        cancelled
      });
    });
  });
}

function appendTaskCommandOutputChunk(
  task: ForgeTask,
  commandRun: TaskCommandRun,
  stream: TaskCommandOutputChunk["stream"],
  text: string
): void {
  if (!text) {
    return;
  }

  const createdAt = new Date().toISOString();
  const chunk: TaskCommandOutputChunk = {
    id: randomUUID(),
    stream,
    text: text.length > taskCommandChunkTextLimit ? text.slice(text.length - taskCommandChunkTextLimit) : text,
    createdAt
  };

  commandRun.outputChunks.push(chunk);
  trimTaskCommandOutputChunks(commandRun);
  task.updatedAt = createdAt;
  tasks.set(task.id, task);
  saveTask(task);
  emit("task.command.output", {
    taskID: task.id,
    taskCommandRunID: commandRun.id,
    chunk,
    task
  });
  emit("task.updated", { taskID: task.id, task });
}

function trimTaskCommandOutputChunks(commandRun: TaskCommandRun): void {
  while (commandRun.outputChunks.length > taskCommandOutputChunkLimit) {
    commandRun.outputChunks.shift();
  }

  let totalLength = commandRun.outputChunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  while (totalLength > taskCommandOutputTextLimit && commandRun.outputChunks.length > 1) {
    const removed = commandRun.outputChunks.shift();
    totalLength -= removed?.text.length ?? 0;
  }

  if (totalLength > taskCommandOutputTextLimit) {
    const onlyChunk = commandRun.outputChunks[0];
    if (onlyChunk) {
      onlyChunk.text = onlyChunk.text.slice(onlyChunk.text.length - taskCommandOutputTextLimit);
    }
  }
}

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
  if (preset.requiresApproval && !hasValidationPresetApproval(task, preset.id)) {
    throw new HttpError(409, `Validation preset requires approval before it can run: ${preset.name}`);
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

  for (const command of preset.commands) {
    const result = await runValidationCommand(command, task);
    validationRun.commands.push(result);
    task.updatedAt = result.endedAt ?? new Date().toISOString();
    saveTask(task);
    emit("validation.command.completed", {
      taskID: task.id,
      validationRunID: validationRun.id,
      command: result,
      task
    });
  }

  const failedCommands = validationRun.commands.filter((command) => command.status === "Failed");
  const endedAt = new Date().toISOString();
  validationRun.endedAt = endedAt;
  validationRun.status = failedCommands.length === 0 ? "Passed" : "Failed";
  validationRun.summary =
    failedCommands.length === 0
      ? `Validation passed with ${validationRun.commands.length} command(s).`
      : `Validation failed: ${failedCommands.length} of ${validationRun.commands.length} command(s) failed.`;

  task.status = validationRun.status === "Passed" ? "Completed" : "Failed";
  task.currentPhase = validationRun.status === "Passed" ? "Validation Passed" : "Validation Failed";
  task.reviewSummary = validationRun.summary;
  setAgent(
    task,
    "Tester",
    validationRun.status === "Passed" ? "Done" : "Blocked",
    validationRun.summary
  );
  setAgent(
    task,
    "Reviewer",
    validationRun.status === "Passed" ? "Active" : "Blocked",
    validationRun.status === "Passed"
      ? "Validation passed; ready to review final changed files."
      : "Validation failed; review failed commands before continuing."
  );
  upsertPlanStep(task, {
    id: "run-validation",
    title: "Run validation",
    status: validationRun.status === "Passed" ? "Done" : "Blocked",
    summary: validationRun.summary
  });

  const finished = event(
    validationRun.status === "Passed" ? "validation.passed" : "validation.failed",
    validationRun.summary
  );
  finished.createdAt = endedAt;
  saveAndBroadcast(task, finished);
  if (validationRun.status === "Failed") {
    await createValidationRepairBriefForRun(task, validationRun);
  }
  return task;
}

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

async function runValidationCommand(
  command: InternalValidationCommand,
  task: ForgeTask
): Promise<ValidationCommandResult> {
  const startedAt = new Date().toISOString();
  const result: ValidationCommandResult = {
    id: randomUUID(),
    name: command.name,
    command: command.command,
    kind: command.kind,
    riskLevel: command.riskLevel,
    cwd: command.cwd,
    status: "Running",
    outputSummary: "Running",
    startedAt
  };

  try {
    const output = command.kind === "BuiltIn"
      ? await runBuiltInValidationCommand(command, task)
      : await runProjectValidationCommand(command);
    result.outputSummary = output.outputSummary;
    result.exitCode = output.exitCode;
    result.status = output.exitCode === 0 ? "Passed" : "Failed";
  } catch (error) {
    result.status = "Failed";
    result.outputSummary = error instanceof Error ? error.message : String(error);
  }

  result.endedAt = new Date().toISOString();
  return result;
}

async function runBuiltInValidationCommand(
  command: InternalValidationCommand,
  task: ForgeTask
): Promise<{ outputSummary: string; exitCode?: number }> {
  if (!command.executeBuiltIn) {
    throw new Error(`Built-in validation command is missing an implementation: ${command.command}`);
  }

  return {
    outputSummary: await command.executeBuiltIn(task),
    exitCode: 0
  };
}

async function runProjectValidationCommand(
  command: InternalValidationCommand
): Promise<{ outputSummary: string; exitCode?: number }> {
  if (!command.executable || !command.args) {
    throw new Error(`Project validation command is missing executable metadata: ${command.command}`);
  }

  const cwd = resolvePresetCommandCwd(command.cwd);
  const { exitCode, output } = await runSpawnedCommand(command.executable, command.args, cwd);
  const summary = summarizeCommandOutput(command.command, exitCode, output);

  return { outputSummary: summary, exitCode };
}

function runSpawnedCommand(
  executable: string,
  args: string[],
  cwd: string
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      env: { ...runtimeEnvironment, CI: "1" }
    });

    let output = "";
    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 12_000) {
        output = output.slice(output.length - 12_000);
      }
    };

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${validationCommandTimeoutMs / 1000}s.`));
    }, validationCommandTimeoutMs);

    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

function summarizeCommandOutput(command: string, exitCode: number, output: string): string {
  const trimmed = output.replace(/\s+$/g, "").trim();
  const tail = trimmed.length > 1_800 ? trimmed.slice(trimmed.length - 1_800) : trimmed;
  return [`${command} exited with code ${exitCode}.`, tail].filter(Boolean).join("\n");
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

return {
  approveValidationPreset,
  rerunRepairCommand,
  runTaskCommand,
  cancelTaskCommand,
  runValidation,
  validateChangedFiles,
  validateAppliedProposalRecorded,
  validateReadyProposalValidation,
  latestTaskMessage,
  latestPlanRevision,
  hasPlanApproval,
  hasValidationPresetApproval,
  findValidationPresetApproval,
  hasRunningValidationRun,
  hasRunningTaskCommandRun,
  findLastValidationRun,
  findLastTaskCommandRun,
  latestFailedValidationRun,
  latestFailedTaskCommandRun,
  latestValidationRepairBriefForRun,
  latestValidationRepairBriefForTaskCommandRun,
  latestRepairProposalSource
};
}
