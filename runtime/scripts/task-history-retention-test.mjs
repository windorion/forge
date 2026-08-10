#!/usr/bin/env node
import assert from "node:assert/strict";

import { buildTaskAuditExport } from "../dist/tasks/taskAuditExport.js";
import {
  buildTaskHistoryRetentionPreview,
  purgeTaskHistory
} from "../dist/tasks/taskHistoryRetention.js";

const task = {
  id: "retention-task",
  title: "Retention boundary",
  objective: "Prove export-before-purge without automatic deletion.",
  status: "Completed",
  currentPhase: "Completed",
  createdAt: "2026-08-10T18:00:00.000Z",
  updatedAt: "2026-08-10T18:05:00.000Z",
  agentStates: [],
  planSteps: [],
  events: [],
  approvals: [],
  toolCalls: [],
  agentRunLoops: [],
  agentRunSteps: [],
  taskCommandRuns: [{
    id: "command-1",
    commandID: "runtime-test",
    name: "Runtime tests",
    command: "npm test",
    kind: "ProjectCommand",
    riskLevel: "Medium",
    status: "Passed",
    outputSummary: "secret command summary",
    outputChunks: [
      { id: "chunk-1", stream: "stdout", text: "first secret output\n", createdAt: "2026-08-10T18:01:00.000Z" },
      { id: "chunk-2", stream: "stderr", text: "second secret output\n", createdAt: "2026-08-10T18:01:01.000Z" }
    ],
    exitCode: 0,
    startedAt: "2026-08-10T18:01:00.000Z",
    endedAt: "2026-08-10T18:01:02.000Z"
  }],
  commandRerunEvidence: [],
  validationRuns: [{
    id: "validation-1",
    trigger: "PostApply",
    presetID: "runtime-typescript",
    presetName: "Runtime TypeScript",
    presetSource: "BuiltIn",
    riskLevel: "Medium",
    status: "Passed",
    summary: "Validation passed.",
    startedAt: "2026-08-10T18:02:00.000Z",
    endedAt: "2026-08-10T18:02:02.000Z",
    commands: [{
      id: "validation-command-1",
      name: "Type check",
      command: "npm run check",
      kind: "ProjectCommand",
      riskLevel: "Medium",
      status: "Passed",
      outputSummary: "secret validation output",
      exitCode: 0,
      startedAt: "2026-08-10T18:02:00.000Z",
      endedAt: "2026-08-10T18:02:02.000Z"
    }]
  }],
  validationRepairBriefs: [],
  messages: [],
  planRevisions: [],
  editProposalRevisions: [],
  contextFiles: [],
  changedFiles: []
};

const preview = buildTaskHistoryRetentionPreview(task);
assert.deepEqual(preview.policy, {
  taskHistory: "KeepByDefault",
  automaticPurge: false,
  supportedScopes: ["CommandOutput"],
  exportRequired: true
});
assert.equal(preview.eligible, true);
assert.equal(preview.commandRunsWithOutput, 1);
assert.equal(preview.commandOutputChunks, 2);
assert.equal(preview.validationCommandsWithOutput, 1);
assert(preview.removableBytes > 0);

const activePreview = buildTaskHistoryRetentionPreview({ ...task, status: "Running" });
assert.equal(activePreview.eligible, false);
assert.match(activePreview.blocker, /Completed, Failed, or Cancelled/);

const audit = buildTaskAuditExport(task, "json", "2026-08-10T18:10:00.000Z");
assert.match(audit.contentSha256, /^[a-f0-9]{64}$/);
assert.match(audit.sourceSha256, /^[a-f0-9]{64}$/);
assert.equal(audit.sourceTaskUpdatedAt, task.updatedAt);

const validRequest = {
  confirmation: "PurgeTaskHistory",
  expectedUpdatedAt: task.updatedAt,
  scope: "CommandOutput",
  exportReceipt: {
    generatedAt: audit.generatedAt,
    sourceTaskUpdatedAt: audit.sourceTaskUpdatedAt,
    sourceSha256: audit.sourceSha256
  }
};
assert.throws(
  () => purgeTaskHistory(task, { ...validRequest, confirmation: "yes" }),
  /confirmation=PurgeTaskHistory/
);
assert.throws(
  () => purgeTaskHistory(task, { ...validRequest, expectedUpdatedAt: "stale" }),
  /Task changed after retention review/
);
assert.throws(
  () => purgeTaskHistory(task, {
    ...validRequest,
    exportReceipt: { ...validRequest.exportReceipt, sourceSha256: "0".repeat(64) }
  }),
  /receipt hash does not match/
);

const result = purgeTaskHistory(task, validRequest, "2026-08-10T18:11:00.000Z");
assert.equal(result.task.taskCommandRuns[0].outputChunks.length, 0);
assert.match(result.task.taskCommandRuns[0].outputSummary, /purged after verified audit export/);
assert.match(result.task.validationRuns[0].commands[0].outputSummary, /purged after verified audit export/);
assert.equal(result.task.taskCommandRuns[0].status, "Passed");
assert.equal(result.task.validationRuns[0].commands[0].exitCode, 0);
assert.equal(result.task.historyPurges.length, 1);
assert.equal(result.receipt.recordsAffected, 2);
assert.equal(result.receipt.bytesRemoved, preview.removableBytes);
assert.equal(result.task.events.at(-1).type, "task.history.purged");
assert.equal(result.task.updatedAt, "2026-08-10T18:11:00.000Z");
assert.equal(task.taskCommandRuns[0].outputChunks.length, 2, "purge must not mutate the caller's task snapshot");

const afterPreview = buildTaskHistoryRetentionPreview(result.task);
assert.equal(afterPreview.eligible, false);
assert.equal(afterPreview.priorPurges, 1);
const afterAudit = buildTaskAuditExport(result.task, "json", "2026-08-10T18:12:00.000Z");
assert(!afterAudit.content.includes("secret command summary"));
assert(!afterAudit.content.includes("secret validation output"));
assert.equal(JSON.parse(afterAudit.content).historyPurges.length, 1);

console.log("Task history retention test passed: keep-by-default + verified export-before-purge.");
