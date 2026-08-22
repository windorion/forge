#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  WORKSPACE_HISTORY_SCOPES,
  WORKSPACE_RETENTION_POLICY,
  buildWorkspaceHistoryExport,
  buildWorkspaceHistoryRetentionPreview,
  normalizeWorkspaceHistoryScopes,
  purgeWorkspaceHistory
} from "../dist/tasks/workspaceHistoryRetention.js";

const generatedAt = "2026-08-22T12:00:00.000Z";
const purgedAt = "2026-08-22T12:01:00.000Z";
const token = ["ghp", "workspacehistoryfixture1234567890"].join("_");

const terminalTask = task("terminal", "Completed", {
  events: [event("task.completed", `access_token=${token}`), event("validation.passed", "Passed")],
  toolCalls: [toolCall("read_file"), toolCall("search")],
  messages: [message("User", "Keep this private"), message("Assistant", "Done")]
});
const activeTask = task("active", "Human Review", {
  events: [event("task.review", "Waiting")],
  toolCalls: [toolCall("read_file")],
  messages: [message("User", "Do not purge an unfinished task")]
});
const repositoryIndex = {
  meta: { lastIndexedAt: generatedAt, gitRoot: "/private/repo" },
  files: [{
    path: "src/index.ts", language: "TypeScript", byteSize: 120, lineCount: 8,
    contentHash: "a".repeat(32), indexedAt: generatedAt
  }],
  symbols: [{ path: "src/index.ts", kind: "function", name: "main", line: 1 }],
  trigrams: { rowCount: 3, fileCount: 1, sourceSha256: "b".repeat(64) },
  retainedRecords: 6,
  retainedBytes: 320,
  sourceSha256: "c".repeat(64)
};
const source = { tasks: [activeTask, terminalTask], repositoryIndex, priorPurges: 2 };

assert.deepEqual(normalizeWorkspaceHistoryScopes(undefined), WORKSPACE_HISTORY_SCOPES);
assert.deepEqual(
  normalizeWorkspaceHistoryScopes(["RepositoryIndexes", "TaskEvents", "TaskEvents"]),
  ["TaskEvents", "RepositoryIndexes"]
);
assert.throws(() => normalizeWorkspaceHistoryScopes(["Unknown"]), /Unsupported workspace history scope/);
assert.equal(WORKSPACE_RETENTION_POLICY.version, 1);
assert.equal(WORKSPACE_RETENTION_POLICY.automaticPurge, false);

const preview = buildWorkspaceHistoryRetentionPreview(source);
assert.equal(preview.policy.defaultDuration, "IndefiniteUntilExplicitPurge");
assert.equal(preview.terminalTaskCount, 1);
assert.equal(preview.nonterminalTaskCount, 1);
assert.equal(preview.removableRecords, 12);
assert.equal(preview.preservedNonterminalRecords, 3);
assert.equal(preview.priorPurges, 2);
assert.equal(preview.eligible, true);
assert.equal(
  preview.scopePreviews.find((item) => item.scope === "RepositoryIndexes")?.exportMode,
  "ManifestWithRebuildableTrigramDigest"
);

const exportEnvelope = buildWorkspaceHistoryExport(source, undefined, generatedAt);
assert.equal(exportEnvelope.policyID, "forge-workspace-retention");
assert.equal(exportEnvelope.policyVersion, 1);
assert.equal(exportEnvelope.scopes.length, 4);
assert.equal(exportEnvelope.sourceSha256.length, 64);
assert.equal(exportEnvelope.contentSha256.length, 64);
assert(!exportEnvelope.content.includes(token), "Workspace export leaked a known credential fixture.");
assert(exportEnvelope.content.includes("[REDACTED]"));
assert(exportEnvelope.content.includes("Do not purge an unfinished task"));
assert(exportEnvelope.content.includes("ManifestWithRebuildableTrigramDigest"));
assert.equal(
  buildWorkspaceHistoryExport(source, undefined, generatedAt).contentSha256,
  exportEnvelope.contentSha256,
  "Workspace export must be deterministic for one source revision and timestamp."
);

const request = {
  confirmation: "PurgeWorkspaceHistory",
  policyVersion: 1,
  scopes: [...WORKSPACE_HISTORY_SCOPES],
  exportReceipt: {
    generatedAt,
    policyID: exportEnvelope.policyID,
    policyVersion: exportEnvelope.policyVersion,
    scopes: exportEnvelope.scopes,
    sourceSha256: exportEnvelope.sourceSha256,
    contentSha256: exportEnvelope.contentSha256
  }
};
assert.throws(
  () => purgeWorkspaceHistory(source, { ...request, confirmation: "yes" }, purgedAt),
  /confirmation=PurgeWorkspaceHistory/
);
assert.throws(
  () => purgeWorkspaceHistory(source, { ...request, policyVersion: 2 }, purgedAt),
  /policy changed/
);
assert.throws(
  () => purgeWorkspaceHistory(source, {
    ...request,
    scopes: ["TaskEvents"],
    exportReceipt: { ...request.exportReceipt, scopes: ["ToolCalls"] }
  }, purgedAt),
  /scopes do not match/
);
assert.throws(
  () => purgeWorkspaceHistory(source, {
    ...request,
    exportReceipt: { ...request.exportReceipt, sourceSha256: "d".repeat(64) }
  }, purgedAt),
  /changed after export/
);
assert.throws(
  () => purgeWorkspaceHistory(source, {
    ...request,
    exportReceipt: { ...request.exportReceipt, contentSha256: "e".repeat(64) }
  }, purgedAt),
  /content receipt/
);

const result = purgeWorkspaceHistory(source, request, purgedAt);
assert.deepEqual(result.changedTaskIDs, ["terminal"]);
assert.equal(result.changedTasks[0].events.length, 0);
assert.equal(result.changedTasks[0].toolCalls.length, 0);
assert.equal(result.changedTasks[0].messages.length, 0);
assert.equal(result.changedTasks[0].objective, terminalTask.objective);
assert.equal(result.changedTasks[0].updatedAt, purgedAt);
assert.equal(activeTask.events.length, 1);
assert.equal(activeTask.toolCalls.length, 1);
assert.equal(activeTask.messages.length, 1);
assert.equal(result.repositoryIndexesCleared, true);
assert.equal(result.receipt.taskRecordsAffected, 6);
assert.equal(result.receipt.indexRecordsAffected, 6);
assert.equal(result.receipt.preservedNonterminalRecords, 3);
assert.equal(result.receipt.recordsAffectedByScope.TaskEvents, 2);
assert.equal(result.receipt.recordsAffectedByScope.ToolCalls, 2);
assert.equal(result.receipt.recordsAffectedByScope.TaskMessages, 2);
assert.equal(result.receipt.recordsAffectedByScope.RepositoryIndexes, 6);

const activeOnly = {
  tasks: [activeTask],
  repositoryIndex: { ...repositoryIndex, retainedRecords: 0, retainedBytes: 0, files: [], symbols: [], trigrams: { rowCount: 0, fileCount: 0, sourceSha256: "0".repeat(64) } },
  priorPurges: 0
};
const ineligible = buildWorkspaceHistoryRetentionPreview(activeOnly, ["TaskEvents"]);
assert.equal(ineligible.eligible, false);
assert.match(ineligible.blocker, /No retained records/);

console.log("Workspace history retention test passed: policy, scoping, deterministic export, stale guards, terminal preservation, and purge receipt.");

function task(id, status, overrides) {
  return {
    id,
    title: `${id} task`,
    objective: `${id} objective remains`,
    status,
    currentPhase: "Review",
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T11:00:00.000Z",
    agentStates: [], planSteps: [], events: [], approvals: [], toolCalls: [], agentRunLoops: [],
    agentRunSteps: [], taskCommandRuns: [], commandRerunEvidence: [], validationRuns: [],
    validationRepairBriefs: [], messages: [], planRevisions: [], editProposalRevisions: [],
    contextFiles: [], changedFiles: [], ...overrides
  };
}

function event(type, messageText) {
  return { type, message: messageText, createdAt: "2026-08-22T11:00:00.000Z" };
}

function toolCall(name) {
  return {
    id: `${name}-${Math.random()}`,
    name,
    input: `${name} input`,
    outputSummary: `${name} output`,
    status: "Completed",
    riskLevel: "Low",
    startedAt: "2026-08-22T10:10:00.000Z",
    endedAt: "2026-08-22T10:10:01.000Z"
  };
}

function message(role, content) {
  return {
    id: `${role}-${content}`,
    role,
    kind: role === "User" ? "UserMessage" : "IntentBrief",
    content,
    createdAt: "2026-08-22T10:05:00.000Z",
    fileReferences: []
  };
}
