import { randomUUID } from "node:crypto";

import { HttpError } from "../runtime/runtimeError.js";
import type {
  AgentRunLoopControlRequest,
  CancelTaskCommandRequest,
  CancelTaskRequest,
  ForgeTask,
  RuntimeEvent,
  TaskCancellation
} from "../types.js";

interface TaskCancellationServiceOptions {
  tasks: Map<string, ForgeTask>;
  saveAndBroadcast: (task: ForgeTask, runtimeEvent: RuntimeEvent) => void;
  event: (type: string, message: string) => RuntimeEvent;
  setAgent: (
    task: ForgeTask,
    role: ForgeTask["agentStates"][number]["role"],
    status: ForgeTask["agentStates"][number]["status"],
    summary: string
  ) => void;
  upsertPlanStep: (task: ForgeTask, step: ForgeTask["planSteps"][number]) => void;
  removeTaskFromQueue: (taskID: string) => unknown;
  requestAgentRunLoopControl: (
    taskID: string,
    input: AgentRunLoopControlRequest,
    action: "Pause" | "Abort"
  ) => ForgeTask;
  cancelTaskCommand: (taskID: string, input: CancelTaskCommandRequest) => Promise<ForgeTask>;
  requestValidationCancellation: (taskID: string, note?: string) => boolean;
}

const cancellationPollIntervalMs = 25;

export function createTaskCancellationService(options: TaskCancellationServiceOptions) {
  const monitors = new Map<string, Promise<void>>();

  async function cancelTask(taskID: string, input: CancelTaskRequest): Promise<ForgeTask> {
    const task = requireTask(taskID);
    if (task.cancellation?.status === "Completed") return task;
    if (task.cancellation?.status === "Requested") {
      finalizeTaskCancellationIfReady(task);
      monitorTaskCancellation(task.id);
      return task;
    }
    if (task.status === "Completed" || task.status === "Failed" || task.status === "Cancelled") {
      throw new HttpError(409, `Task is already terminal and cannot be cancelled: ${task.status}.`);
    }

    const requestedAt = new Date().toISOString();
    const note = input.note?.trim() || undefined;
    const cancellation: TaskCancellation = {
      id: randomUUID(),
      status: "Requested",
      requestedAt,
      note,
      queueDisposition: task.queueRequest ? "Removed" : "NotQueued",
      agentLoopDisposition: task.agentRunLoops.some((loop) => loop.status === "Running")
        ? "AbortRequested"
        : "NotRunning",
      taskCommandDisposition: task.taskCommandRuns.some((run) => run.status === "Running")
        ? "CancelRequested"
        : "NotRunning",
      validationDisposition: task.validationRuns.some((run) => run.status === "Running")
        ? "CancelRequested"
        : "NotRunning",
      summary: "Task cancellation requested. Forge is stopping active work at safe runtime-owned boundaries."
    };
    task.cancellation = cancellation;
    task.approvals.push({
      id: randomUUID(),
      action: "Cancel Task",
      decision: "Approved",
      summary: "Cancel the task and stop queued or active runtime work.",
      decidedAt: requestedAt,
      targetID: cancellation.id,
      userNote: note
    });

    if (task.queueRequest) {
      options.removeTaskFromQueue(task.id);
    }

    if (cancellation.agentLoopDisposition === "AbortRequested") {
      try {
        options.requestAgentRunLoopControl(task.id, { note: note ?? "Task cancellation requested." }, "Abort");
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
      }
    }

    if (cancellation.taskCommandDisposition === "CancelRequested") {
      await options.cancelTaskCommand(task.id, { note: note ?? "Task cancellation requested." });
    }

    if (cancellation.validationDisposition === "CancelRequested") {
      options.requestValidationCancellation(task.id, note ?? "Task cancellation requested.");
    }

    task.status = inFlightWork(task) ? task.status : "Cancelled";
    task.currentPhase = inFlightWork(task) ? "Task Cancellation Requested" : "Task Cancelled";
    task.reviewSummary = cancellation.summary;
    options.setAgent(task, "Manager", inFlightWork(task) ? "Active" : "Idle", cancellation.summary);
    options.upsertPlanStep(task, {
      id: "cancel-task",
      title: "Cancel task",
      status: inFlightWork(task) ? "Active" : "Done",
      summary: cancellation.summary
    });
    const requested = options.event("task.cancel.requested", cancellation.summary);
    requested.createdAt = requestedAt;
    options.saveAndBroadcast(task, requested);

    finalizeTaskCancellationIfReady(task);
    monitorTaskCancellation(task.id);
    return task;
  }

  function recoverRequestedTaskCancellationsOnStartup(): void {
    for (const task of options.tasks.values()) {
      if (task.cancellation?.status !== "Requested") continue;
      finalizeTaskCancellationIfReady(task);
      monitorTaskCancellation(task.id);
    }
  }

  function finalizeTaskCancellationIfReady(task: ForgeTask): boolean {
    const cancellation = task.cancellation;
    if (!cancellation || cancellation.status !== "Requested" || inFlightWork(task)) return false;

    const completedAt = new Date().toISOString();
    cancellation.status = "Completed";
    cancellation.completedAt = completedAt;
    cancellation.summary = cancellationSummary(cancellation);
    delete task.queueRequest;
    task.status = "Cancelled";
    task.currentPhase = "Task Cancelled";
    task.reviewSummary = cancellation.summary;
    for (const role of ["Manager", "Planner", "Coder", "Tester"] as const) {
      options.setAgent(task, role, "Idle", "Task cancelled; no runtime work remains active.");
    }
    options.setAgent(task, "Reviewer", "Active", "Review the retained plan, diffs, command output, and cancellation evidence.");
    options.upsertPlanStep(task, {
      id: "cancel-task",
      title: "Cancel task",
      status: "Done",
      summary: cancellation.summary
    });
    const completed = options.event("task.cancelled", cancellation.summary);
    completed.createdAt = completedAt;
    options.saveAndBroadcast(task, completed);
    return true;
  }

  function monitorTaskCancellation(taskID: string): void {
    if (monitors.has(taskID)) return;
    const monitor = (async () => {
      while (true) {
        const task = options.tasks.get(taskID);
        if (!task || task.cancellation?.status !== "Requested") return;
        if (finalizeTaskCancellationIfReady(task)) return;
        await new Promise<void>((resolve) => setTimeout(resolve, cancellationPollIntervalMs));
      }
    })().finally(() => monitors.delete(taskID));
    monitors.set(taskID, monitor);
  }

  function requireTask(taskID: string): ForgeTask {
    const task = options.tasks.get(taskID);
    if (!task) throw new HttpError(404, `Task not found: ${taskID}`);
    return task;
  }

  return { cancelTask, recoverRequestedTaskCancellationsOnStartup };
}

function inFlightWork(task: ForgeTask): boolean {
  return task.agentRunLoops.some((loop) => loop.status === "Running") ||
    task.agentRunSteps.some((step) => step.status === "Running") ||
    task.taskCommandRuns.some((run) => run.status === "Running") ||
    task.validationRuns.some((run) => run.status === "Running") ||
    task.toolCalls.some((toolCall) => toolCall.status === "Started");
}

function cancellationSummary(cancellation: TaskCancellation): string {
  const stopped: string[] = [];
  if (cancellation.queueDisposition === "Removed") stopped.push("removed the queued run");
  if (cancellation.agentLoopDisposition === "AbortRequested") stopped.push("aborted the Agent Loop at a safe checkpoint");
  if (cancellation.taskCommandDisposition === "CancelRequested") stopped.push("terminated the active task command");
  if (cancellation.validationDisposition === "CancelRequested") stopped.push("cancelled validation before remaining commands");
  return stopped.length > 0
    ? `Task cancelled: Forge ${stopped.join(", ")}. Review artifacts were retained.`
    : "Task cancelled before runtime work was active. Review artifacts were retained.";
}
