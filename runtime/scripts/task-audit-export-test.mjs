#!/usr/bin/env node
import assert from "node:assert/strict";

import { buildTaskAuditExport, redactAuditText } from "../dist/tasks/taskAuditExport.js";

const secret = "ghp_1234567890abcdefghijklmnop";
const task = {
  id: "task/audit:test",
  title: "Cancellation audit",
  objective: `Preserve evidence without ${secret}`,
  status: "Cancelled",
  currentPhase: "Task Cancelled",
  createdAt: "2026-08-08T10:00:00.000Z",
  updatedAt: "2026-08-08T10:01:00.000Z",
  reviewSummary: "Task cancelled safely.",
  changedFiles: ["README.md"],
  cancellation: {
    id: "cancel-1",
    status: "Completed",
    requestedAt: "2026-08-08T10:00:30.000Z",
    completedAt: "2026-08-08T10:01:00.000Z",
    queueDisposition: "NotQueued",
    agentLoopDisposition: "AbortRequested",
    taskCommandDisposition: "CancelRequested",
    validationDisposition: "NotRunning",
    summary: "Agent Loop and command stopped."
  },
  planRevisions: [],
  approvals: [
    {
      id: "validation-approval-1", action: "Approve Validation Preset", decision: "Approved",
      summary: "Approve checks", decidedAt: "2026-08-08T10:00:20.000Z", targetID: "runtime-typescript",
      scope: "Task", expiresAt: "2026-08-08T11:00:20.000Z"
    },
    {
      id: "validation-revocation-1", action: "Revoke Validation Preset Approval", decision: "Revoked",
      summary: "Revoke checks", decidedAt: "2026-08-08T10:00:25.000Z", targetID: "runtime-typescript",
      scope: "Task", revokedApprovalID: "validation-approval-1"
    },
    {
      id: "approval-1", action: "Cancel Task", decision: "Approved",
      summary: "Cancel task", decidedAt: "2026-08-08T10:00:30.000Z"
    }
  ],
  events: [
    { type: "task.cancel.requested", message: "Cancellation requested.", createdAt: "2026-08-08T10:00:30.000Z" },
    { type: "task.cancelled", message: "Cancellation completed.", createdAt: "2026-08-08T10:01:00.000Z" }
  ],
  agentRunLoops: [{
    id: "loop-1", provider: { id: "local", name: "Local", model: "test", mode: "local" },
    status: "Aborted", maxSteps: 1, stepsRun: 0, stepIDs: [], stopReason: "UserAborted",
    summary: "Stopped safely.", startedAt: "2026-08-08T10:00:10.000Z", completedAt: "2026-08-08T10:01:00.000Z"
  }],
  agentRunSteps: [],
  toolCalls: [{
    id: "tool-1", name: "read_context_file", status: "Completed", input: `Bearer ${secret}`,
    outputSummary: `password=${secret}`, startedAt: "2026-08-08T10:00:11.000Z", endedAt: "2026-08-08T10:00:12.000Z"
  }],
  taskCommandRuns: [{
    id: "run-1", commandID: "test", name: "Test", command: "npm test", kind: "ProjectCommand",
    riskLevel: "Medium", status: "Cancelled", outputSummary: `access_token=${secret}`,
    outputChunks: [{ id: "chunk-1", stream: "stderr", text: `sk-1234567890abcdef`, createdAt: "2026-08-08T10:00:20.000Z" }],
    exitCode: 130, startedAt: "2026-08-08T10:00:15.000Z", endedAt: "2026-08-08T10:00:31.000Z"
  }],
  validationRuns: [],
  editProposalRevisions: [],
  contextFiles: []
};

const json = buildTaskAuditExport(task, "json", "2026-08-08T11:00:00.000Z");
assert.equal(json.filename, "forge-task-task-audit-test-audit.json");
assert.equal(json.contentType, "application/json");
assert.match(json.contentSha256, /^[a-f0-9]{64}$/);
assert.match(json.sourceSha256, /^[a-f0-9]{64}$/);
assert.equal(json.sourceTaskUpdatedAt, task.updatedAt);
assert(!json.content.includes(secret), "JSON export leaked a known token pattern.");
const parsed = JSON.parse(json.content);
assert.equal(parsed.schemaVersion, 1);
assert.deepEqual(parsed.redactionPolicy, {
  id: "forge-secret-redaction",
  version: 1,
  replacement: "[REDACTED]"
});
assert.equal(parsed.task.status, "Cancelled");
assert.equal(parsed.task.cancellation.agentLoopDisposition, "AbortRequested");
assert.equal(parsed.approvals[0].expiresAt, "2026-08-08T11:00:20.000Z");
assert.equal(parsed.approvals[1].revokedApprovalID, "validation-approval-1");
assert.equal(parsed.taskCommandRuns[0].status, "Cancelled");
assert(parsed.toolCalls[0].input.includes("[REDACTED]"));

const markdown = buildTaskAuditExport(task, "markdown", "2026-08-08T11:00:00.000Z");
assert.equal(markdown.filename, "forge-task-task-audit-test-audit.md");
assert.match(markdown.contentSha256, /^[a-f0-9]{64}$/);
assert.equal(markdown.sourceSha256, json.sourceSha256);
assert(markdown.content.includes("## Cancellation"));
assert(markdown.content.includes("## Human Approvals"));
assert(markdown.content.includes("2026-08-08T11:00:20.000Z"));
assert(markdown.content.includes("validation-approval-1"));
assert(markdown.content.includes("## Event Timeline"));
assert(markdown.content.includes("UserAborted"));
assert(!markdown.content.includes(secret), "Markdown export leaked a known token pattern.");

assert.equal(redactAuditText("Authorization: Bearer abc.def-123"), "Authorization: Bearer [REDACTED]");
assert.equal(redactAuditText("api_key=super-secret-value"), "api_key=[REDACTED]");

console.log("Task audit export test passed: JSON + Markdown + credential redaction.");
