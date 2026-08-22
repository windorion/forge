import { createHash, randomUUID } from "node:crypto";

import { HttpError } from "../http/httpError.js";
import { redactSensitiveValue } from "../security/secretRedaction.js";
import type { RepositoryIndexRetentionSnapshot } from "../taskStore.js";
import type {
  ForgeTask,
  PurgeWorkspaceHistoryRequest,
  WorkspaceHistoryPurgeReceipt,
  WorkspaceHistoryScope
} from "../types.js";

export const WORKSPACE_RETENTION_POLICY = Object.freeze({
  id: "forge-workspace-retention",
  version: 1,
  history: "KeepByDefault" as const,
  defaultDuration: "IndefiniteUntilExplicitPurge" as const,
  automaticPurge: false as const,
  exportRequired: true as const,
  terminalTaskDataOnly: true as const,
  repositoryIndexes: "RebuildableDerivedData" as const
});

export const WORKSPACE_HISTORY_SCOPES: readonly WorkspaceHistoryScope[] = [
  "TaskEvents",
  "ToolCalls",
  "TaskMessages",
  "RepositoryIndexes"
];

const TERMINAL_STATUSES = new Set<ForgeTask["status"]>(["Completed", "Failed", "Cancelled"]);

export interface WorkspaceRetentionSource {
  tasks: ForgeTask[];
  repositoryIndex: RepositoryIndexRetentionSnapshot;
  priorPurges: number;
}

export interface WorkspaceHistoryScopePreview {
  scope: WorkspaceHistoryScope;
  retainedRecords: number;
  removableRecords: number;
  preservedNonterminalRecords: number;
  removableBytes: number;
  exportMode: "FullEvidence" | "ManifestWithRebuildableTrigramDigest";
}

export interface WorkspaceHistoryRetentionPreview {
  policy: typeof WORKSPACE_RETENTION_POLICY & { supportedScopes: readonly WorkspaceHistoryScope[] };
  scopes: WorkspaceHistoryScope[];
  eligible: boolean;
  blocker?: string;
  taskCount: number;
  terminalTaskCount: number;
  nonterminalTaskCount: number;
  removableRecords: number;
  preservedNonterminalRecords: number;
  removableBytes: number;
  scopePreviews: WorkspaceHistoryScopePreview[];
  priorPurges: number;
}

export interface WorkspaceHistoryExportEnvelope {
  filename: string;
  contentType: "application/json";
  content: string;
  generatedAt: string;
  policyID: string;
  policyVersion: number;
  scopes: WorkspaceHistoryScope[];
  sourceSha256: string;
  contentSha256: string;
  redactionSummary: string;
  recoveryBoundary: string;
}

export interface WorkspaceHistoryPurgeResult {
  receipt: WorkspaceHistoryPurgeReceipt;
  changedTasks: ForgeTask[];
  changedTaskIDs: string[];
  repositoryIndexesCleared: boolean;
}

export function normalizeWorkspaceHistoryScopes(input: unknown): WorkspaceHistoryScope[] {
  const values = input === undefined || input === null || input === ""
    ? [...WORKSPACE_HISTORY_SCOPES]
    : typeof input === "string"
      ? input.split(",").map((value) => value.trim()).filter(Boolean)
      : Array.isArray(input)
        ? input
        : [];
  if (values.length === 0) {
    throw new HttpError(400, "Workspace history scopes must contain at least one supported scope.");
  }
  const requested = new Set<WorkspaceHistoryScope>();
  for (const value of values) {
    if (typeof value !== "string" || !WORKSPACE_HISTORY_SCOPES.includes(value as WorkspaceHistoryScope)) {
      throw new HttpError(400, `Unsupported workspace history scope: ${String(value)}.`);
    }
    requested.add(value as WorkspaceHistoryScope);
  }
  return WORKSPACE_HISTORY_SCOPES.filter((scope) => requested.has(scope));
}

export function buildWorkspaceHistoryRetentionPreview(
  source: WorkspaceRetentionSource,
  inputScopes?: unknown
): WorkspaceHistoryRetentionPreview {
  const scopes = normalizeWorkspaceHistoryScopes(inputScopes);
  const scopePreviews = scopes.map((scope) => scopePreview(source, scope));
  const removableRecords = scopePreviews.reduce((total, item) => total + item.removableRecords, 0);
  const preservedNonterminalRecords = scopePreviews.reduce(
    (total, item) => total + item.preservedNonterminalRecords,
    0
  );
  const terminalTaskCount = source.tasks.filter((task) => TERMINAL_STATUSES.has(task.status)).length;
  return {
    policy: { ...WORKSPACE_RETENTION_POLICY, supportedScopes: WORKSPACE_HISTORY_SCOPES },
    scopes,
    eligible: removableRecords > 0,
    blocker: removableRecords === 0
      ? "No retained records in the selected scopes are currently eligible for explicit purge."
      : undefined,
    taskCount: source.tasks.length,
    terminalTaskCount,
    nonterminalTaskCount: source.tasks.length - terminalTaskCount,
    removableRecords,
    preservedNonterminalRecords,
    removableBytes: scopePreviews.reduce((total, item) => total + item.removableBytes, 0),
    scopePreviews,
    priorPurges: source.priorPurges
  };
}

export function buildWorkspaceHistoryExport(
  source: WorkspaceRetentionSource,
  inputScopes?: unknown,
  generatedAt = new Date().toISOString()
): WorkspaceHistoryExportEnvelope {
  if (!isValidTimestamp(generatedAt)) {
    throw new HttpError(400, "Workspace history export generatedAt must be a valid timestamp.");
  }
  const scopes = normalizeWorkspaceHistoryScopes(inputScopes);
  const sourceRecord = workspaceSourceRecord(source, scopes);
  const sourceSha256 = sha256(JSON.stringify(sourceRecord));
  const exportRecord = redactSensitiveValue({
    schemaVersion: 1,
    generatedAt,
    policy: { ...WORKSPACE_RETENTION_POLICY, supportedScopes: WORKSPACE_HISTORY_SCOPES },
    scopes,
    sourceSha256,
    retentionSummary: buildWorkspaceHistoryRetentionPreview(source, scopes),
    taskHistory: sourceRecord.tasks,
    repositoryIndexes: scopes.includes("RepositoryIndexes")
      ? {
          exportMode: "ManifestWithRebuildableTrigramDigest",
          rebuildRequiredAfterPurge: true,
          ...source.repositoryIndex
        }
      : undefined
  });
  const content = `${JSON.stringify(exportRecord, null, 2)}\n`;
  return {
    filename: `forge-workspace-history-${generatedAt.replace(/[:.]/g, "-")}.json`,
    contentType: "application/json",
    content,
    generatedAt,
    policyID: WORKSPACE_RETENTION_POLICY.id,
    policyVersion: WORKSPACE_RETENTION_POLICY.version,
    scopes,
    sourceSha256,
    contentSha256: sha256(content),
    redactionSummary: "Known credentials are replaced under forge-secret-redaction v1; arbitrary private content may remain and must be reviewed before sharing.",
    recoveryBoundary: "Task events, tool calls, and messages are exported as evidence. Repository file/symbol metadata is included, while trigram postings are represented by an exact digest because they are rebuildable derived data. This is not an automated restore bundle."
  };
}

export function purgeWorkspaceHistory(
  source: WorkspaceRetentionSource,
  input: PurgeWorkspaceHistoryRequest,
  purgedAt = new Date().toISOString()
): WorkspaceHistoryPurgeResult {
  if (input.confirmation !== "PurgeWorkspaceHistory") {
    throw new HttpError(400, "Workspace history purge requires confirmation=PurgeWorkspaceHistory.");
  }
  if (input.policyVersion !== WORKSPACE_RETENTION_POLICY.version) {
    throw new HttpError(409, `Workspace retention policy changed. Refresh policy v${WORKSPACE_RETENTION_POLICY.version} and export again.`);
  }
  const scopes = normalizeWorkspaceHistoryScopes(input.scopes);
  const preview = buildWorkspaceHistoryRetentionPreview(source, scopes);
  if (!preview.eligible) {
    throw new HttpError(409, preview.blocker ?? "Workspace history is not eligible for purge.");
  }
  const exportReceipt = input.exportReceipt;
  if (!exportReceipt?.generatedAt || !isValidTimestamp(exportReceipt.generatedAt)) {
    throw new HttpError(400, "Workspace history purge requires a valid export generatedAt receipt.");
  }
  if (exportReceipt.policyID !== WORKSPACE_RETENTION_POLICY.id
    || exportReceipt.policyVersion !== WORKSPACE_RETENTION_POLICY.version) {
    throw new HttpError(409, "Workspace export receipt policy does not match the active retention policy.");
  }
  const receiptScopes = normalizeWorkspaceHistoryScopes(exportReceipt.scopes);
  if (receiptScopes.join(",") !== scopes.join(",")) {
    throw new HttpError(409, "Workspace export receipt scopes do not match the requested purge scopes.");
  }
  const currentExport = buildWorkspaceHistoryExport(source, scopes, exportReceipt.generatedAt);
  if (!exportReceipt.sourceSha256 || exportReceipt.sourceSha256 !== currentExport.sourceSha256) {
    throw new HttpError(409, "Workspace history changed after export. Save a current export before purging.");
  }
  if (!exportReceipt.contentSha256 || exportReceipt.contentSha256 !== currentExport.contentSha256) {
    throw new HttpError(409, "Workspace export content receipt does not match the current deterministic export.");
  }

  const changedTasks: ForgeTask[] = [];
  const recordsAffectedByScope = Object.fromEntries(
    WORKSPACE_HISTORY_SCOPES.map((scope) => [scope, 0])
  ) as Record<WorkspaceHistoryScope, number>;
  for (const task of source.tasks) {
    if (!TERMINAL_STATUSES.has(task.status)) continue;
    const next = structuredClone(task);
    let changed = false;
    if (scopes.includes("TaskEvents") && next.events.length > 0) {
      recordsAffectedByScope.TaskEvents += next.events.length;
      next.events = [];
      changed = true;
    }
    if (scopes.includes("ToolCalls") && next.toolCalls.length > 0) {
      recordsAffectedByScope.ToolCalls += next.toolCalls.length;
      next.toolCalls = [];
      changed = true;
    }
    if (scopes.includes("TaskMessages") && next.messages.length > 0) {
      recordsAffectedByScope.TaskMessages += next.messages.length;
      next.messages = [];
      changed = true;
    }
    if (changed) {
      next.updatedAt = purgedAt;
      changedTasks.push(next);
    }
  }
  if (scopes.includes("RepositoryIndexes")) {
    recordsAffectedByScope.RepositoryIndexes = source.repositoryIndex.retainedRecords;
  }
  const taskRecordsAffected = recordsAffectedByScope.TaskEvents
    + recordsAffectedByScope.ToolCalls
    + recordsAffectedByScope.TaskMessages;
  const indexRecordsAffected = recordsAffectedByScope.RepositoryIndexes;
  const receipt: WorkspaceHistoryPurgeReceipt = {
    id: randomUUID(),
    policyID: WORKSPACE_RETENTION_POLICY.id,
    policyVersion: WORKSPACE_RETENTION_POLICY.version,
    scopes,
    exportedAt: exportReceipt.generatedAt,
    exportSourceSha256: currentExport.sourceSha256,
    exportContentSha256: currentExport.contentSha256,
    purgedAt,
    taskRecordsAffected,
    indexRecordsAffected,
    recordsAffectedByScope,
    bytesRemoved: preview.removableBytes,
    preservedNonterminalRecords: preview.preservedNonterminalRecords,
    summary: `Purged ${taskRecordsAffected} terminal-task history record(s) and ${indexRecordsAffected} rebuildable index record(s) after a matching workspace export.`
  };
  return {
    receipt,
    changedTasks,
    changedTaskIDs: changedTasks.map((task) => task.id),
    repositoryIndexesCleared: scopes.includes("RepositoryIndexes") && indexRecordsAffected > 0
  };
}

function scopePreview(source: WorkspaceRetentionSource, scope: WorkspaceHistoryScope): WorkspaceHistoryScopePreview {
  if (scope === "RepositoryIndexes") {
    return {
      scope,
      retainedRecords: source.repositoryIndex.retainedRecords,
      removableRecords: source.repositoryIndex.retainedRecords,
      preservedNonterminalRecords: 0,
      removableBytes: source.repositoryIndex.retainedBytes,
      exportMode: "ManifestWithRebuildableTrigramDigest"
    };
  }
  let retainedRecords = 0;
  let removableRecords = 0;
  let preservedNonterminalRecords = 0;
  let removableBytes = 0;
  for (const task of source.tasks) {
    const records = taskRecordsForScope(task, scope);
    retainedRecords += records.length;
    if (TERMINAL_STATUSES.has(task.status)) {
      removableRecords += records.length;
      removableBytes += records.reduce<number>(
        (total, item) => total + Buffer.byteLength(JSON.stringify(item)),
        0
      );
    } else {
      preservedNonterminalRecords += records.length;
    }
  }
  return {
    scope,
    retainedRecords,
    removableRecords,
    preservedNonterminalRecords,
    removableBytes,
    exportMode: "FullEvidence"
  };
}

function workspaceSourceRecord(source: WorkspaceRetentionSource, scopes: WorkspaceHistoryScope[]) {
  const tasks = [...source.tasks]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      terminal: TERMINAL_STATUSES.has(task.status),
      events: scopes.includes("TaskEvents") ? task.events : undefined,
      toolCalls: scopes.includes("ToolCalls") ? task.toolCalls : undefined,
      messages: scopes.includes("TaskMessages") ? task.messages : undefined
    }));
  return {
    policyID: WORKSPACE_RETENTION_POLICY.id,
    policyVersion: WORKSPACE_RETENTION_POLICY.version,
    scopes,
    tasks,
    repositoryIndexSourceSha256: scopes.includes("RepositoryIndexes")
      ? source.repositoryIndex.sourceSha256
      : undefined
  };
}

function taskRecordsForScope(task: ForgeTask, scope: Exclude<WorkspaceHistoryScope, "RepositoryIndexes">): unknown[] {
  if (scope === "TaskEvents") return task.events;
  if (scope === "ToolCalls") return task.toolCalls;
  return task.messages;
}

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
