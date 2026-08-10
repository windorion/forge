import { randomUUID } from "node:crypto";

import { HttpError } from "../http/httpError.js";
import type { ForgeTask, PurgeTaskHistoryRequest, TaskHistoryPurgeReceipt } from "../types.js";
import { taskAuditSourceSha256 } from "./taskAuditExport.js";

const TERMINAL_STATUSES = new Set<ForgeTask["status"]>(["Completed", "Failed", "Cancelled"]);
const PURGED_OUTPUT_SUMMARY = "[Command output purged after verified audit export.]";

export interface TaskHistoryRetentionPreview {
  policy: {
    taskHistory: "KeepByDefault";
    automaticPurge: false;
    supportedScopes: ["CommandOutput"];
    exportRequired: true;
  };
  eligible: boolean;
  blocker?: string;
  taskID: string;
  taskStatus: ForgeTask["status"];
  taskUpdatedAt: string;
  commandRunsWithOutput: number;
  commandOutputChunks: number;
  validationCommandsWithOutput: number;
  removableBytes: number;
  priorPurges: number;
}

export interface TaskHistoryPurgeResult {
  task: ForgeTask;
  receipt: TaskHistoryPurgeReceipt;
}

export function buildTaskHistoryRetentionPreview(task: ForgeTask): TaskHistoryRetentionPreview {
  const counts = commandOutputCounts(task);
  const terminal = TERMINAL_STATUSES.has(task.status);
  const hasOutput = counts.commandRunsWithOutput + counts.validationCommandsWithOutput > 0;
  return {
    policy: {
      taskHistory: "KeepByDefault",
      automaticPurge: false,
      supportedScopes: ["CommandOutput"],
      exportRequired: true
    },
    eligible: terminal && hasOutput,
    blocker: !terminal
      ? "Only Completed, Failed, or Cancelled tasks can purge retained command output."
      : !hasOutput
        ? "No retained command output is available to purge."
        : undefined,
    taskID: task.id,
    taskStatus: task.status,
    taskUpdatedAt: task.updatedAt,
    ...counts,
    priorPurges: task.historyPurges?.length ?? 0
  };
}

export function purgeTaskHistory(
  task: ForgeTask,
  input: PurgeTaskHistoryRequest,
  purgedAt = new Date().toISOString()
): TaskHistoryPurgeResult {
  const preview = buildTaskHistoryRetentionPreview(task);
  if (!preview.eligible) {
    throw new HttpError(409, preview.blocker ?? "Task history is not eligible for purge.");
  }
  if (input.confirmation !== "PurgeTaskHistory") {
    throw new HttpError(400, "History purge requires confirmation=PurgeTaskHistory.");
  }
  if (input.scope !== "CommandOutput") {
    throw new HttpError(400, "History purge currently supports scope=CommandOutput only.");
  }
  if (!input.expectedUpdatedAt || input.expectedUpdatedAt !== task.updatedAt) {
    throw new HttpError(409, "Task changed after retention review. Refresh and export the current audit record before purging.");
  }

  const exportReceipt = input.exportReceipt;
  if (!exportReceipt?.generatedAt || !isValidTimestamp(exportReceipt.generatedAt)) {
    throw new HttpError(400, "History purge requires a valid audit export generatedAt receipt.");
  }
  if (exportReceipt.sourceTaskUpdatedAt !== task.updatedAt) {
    throw new HttpError(409, "Audit export receipt does not match the current task revision.");
  }
  if (!exportReceipt.sourceSha256 || exportReceipt.sourceSha256 !== taskAuditSourceSha256(task)) {
    throw new HttpError(409, "Audit export receipt hash does not match the current retained task history.");
  }

  const next = structuredClone(task);
  let recordsAffected = 0;
  for (const run of next.taskCommandRuns) {
    const hasOutput = run.outputChunks.some((chunk) => chunk.text.length > 0)
      || (run.outputSummary.length > 0 && run.outputSummary !== PURGED_OUTPUT_SUMMARY);
    if (!hasOutput) continue;
    run.outputChunks = [];
    run.outputSummary = PURGED_OUTPUT_SUMMARY;
    recordsAffected += 1;
  }
  for (const validation of next.validationRuns) {
    for (const command of validation.commands) {
      if (!command.outputSummary || command.outputSummary === PURGED_OUTPUT_SUMMARY) continue;
      command.outputSummary = PURGED_OUTPUT_SUMMARY;
      recordsAffected += 1;
    }
  }

  const receipt: TaskHistoryPurgeReceipt = {
    id: randomUUID(),
    scope: "CommandOutput",
    exportedAt: exportReceipt.generatedAt,
    exportSourceSha256: exportReceipt.sourceSha256,
    purgedAt,
    recordsAffected,
    bytesRemoved: preview.removableBytes,
    summary: `Purged command output bodies from ${recordsAffected} retained record(s) after a matching audit export.`
  };
  next.historyPurges = [...(next.historyPurges ?? []), receipt];
  next.events.push({
    type: "task.history.purged",
    message: receipt.summary,
    createdAt: purgedAt
  });
  next.updatedAt = purgedAt;
  return { task: next, receipt };
}

function commandOutputCounts(task: ForgeTask): Omit<TaskHistoryRetentionPreview,
  "policy" | "eligible" | "blocker" | "taskID" | "taskStatus" | "taskUpdatedAt" | "priorPurges"
> {
  let commandRunsWithOutput = 0;
  let commandOutputChunks = 0;
  let validationCommandsWithOutput = 0;
  let removableBytes = 0;
  for (const run of task.taskCommandRuns) {
    const chunks = run.outputChunks.filter((chunk) => chunk.text.length > 0);
    const hasSummary = run.outputSummary.length > 0 && run.outputSummary !== PURGED_OUTPUT_SUMMARY;
    if (chunks.length > 0 || hasSummary) commandRunsWithOutput += 1;
    commandOutputChunks += chunks.length;
    removableBytes += chunks.reduce((total, chunk) => total + Buffer.byteLength(chunk.text), 0);
    if (hasSummary) removableBytes += Buffer.byteLength(run.outputSummary);
  }
  for (const validation of task.validationRuns) {
    for (const command of validation.commands) {
      if (!command.outputSummary || command.outputSummary === PURGED_OUTPUT_SUMMARY) continue;
      validationCommandsWithOutput += 1;
      removableBytes += Buffer.byteLength(command.outputSummary);
    }
  }
  return {
    commandRunsWithOutput,
    commandOutputChunks,
    validationCommandsWithOutput,
    removableBytes
  };
}

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
