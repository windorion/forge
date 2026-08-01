import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { HttpError } from "../runtime/runtimeError.js";
import type { CancelTaskCommandRequest, ForgeTask, TaskCommandOutputChunk, TaskCommandRun, ValidationCommandResult } from "../types.js";
import type { InternalValidationCommand, ValidationServiceOptions } from "./validationServiceTypes.js";

interface ActiveTaskCommand {
  taskID: string; taskCommandRunID: string; child: ReturnType<typeof spawn>;
  timeout?: ReturnType<typeof setTimeout>; cancelTimeout?: ReturnType<typeof setTimeout>;
  cancelled: boolean; cancellationNote?: string; cancelledAt?: string;
}
interface TaskCommandExecutionResult { outputSummary: string; exitCode: number; cancelled?: boolean; }
interface SpawnedTaskCommandResult { exitCode: number; output: string; timedOut: boolean; cancelled: boolean; }

export function createProcessRunner(options: ValidationServiceOptions) {
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
const activeTaskCommands = new Map<string, ActiveTaskCommand>();
const validationCommandTimeoutMs = 60_000;
const taskCommandCancellationGraceMs = 3_000;
const taskCommandOutputChunkLimit = 80;
const taskCommandOutputTextLimit = 24_000;
const taskCommandChunkTextLimit = 4_000;

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

return { cancelTaskCommand, runBuiltInTaskCommand, runProjectTaskCommand, appendTaskCommandOutputChunk, runValidationCommand };
}
