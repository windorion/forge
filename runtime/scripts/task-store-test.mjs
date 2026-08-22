#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databaseWriterLeasePath } from "../dist/databaseWriterLease.js";
import { SqliteTaskStore } from "../dist/taskStore.js";

let count = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  count += 1;
};

const tempRoot = await mkdtemp(join(tmpdir(), "forge-task-store-"));
const dbPath = join(tempRoot, "nested", "forge.sqlite");

try {
  const store = new SqliteTaskStore(dbPath);
  ok(store.loadTasks().length === 0, "new store is empty");
  ok(store.getIndexMeta().lastIndexedAt === null, "new index metadata is empty");
  ok(store.schemaStatus().currentVersion === 6 && store.schemaStatus().migrations.length === 6, "new store applies all versioned migrations");

  const legacyTask = {
    id: "legacy",
    title: "Legacy task",
    objective: "Exercise compatibility defaults",
    status: "Human Review",
    currentPhase: "Plan Review",
    createdAt: "2026-07-31T10:00:00Z",
    updatedAt: "2026-07-31T10:00:00Z",
    taskCommandRuns: [{ id: "command-1" }],
    validationRuns: [{ id: "validation-1" }],
    validationRepairBriefs: [{ id: "brief-1", taskCommandRunID: "command-1" }],
    messages: [{ id: "message-1" }],
    editProposalRevisions: [{ id: "proposal-1" }],
    editProposal: { id: "proposal-current" }
  };
  store.saveTask(legacyTask);
  assert.throws(() => new SqliteTaskStore(dbPath), /active writer lease/);
  count += 1;
  const concurrentObserver = new SqliteTaskStore(dbPath, { readOnly: true });
  ok(concurrentObserver.loadTasks()[0].id === "legacy", "read-only observer may coexist with the sole writer");
  concurrentObserver.close();
  const restoredLegacy = store.loadTasks()[0];
  ok(restoredLegacy.approvals.length === 0 && restoredLegacy.agentRunSteps.length === 0, "missing task arrays receive compatibility defaults");
  ok(restoredLegacy.taskCommandRuns[0].outputChunks.length === 0, "legacy command output chunks default empty");
  ok(restoredLegacy.validationRuns[0].presetID === "forge-post-apply" && restoredLegacy.validationRuns[0].commands.length === 0, "legacy validation metadata defaults");
  ok(restoredLegacy.validationRepairBriefs[0].source === "TaskCommandRun", "legacy repair source inferred");
  ok(restoredLegacy.messages[0].fileReferences.length === 0, "legacy message references default empty");
  ok(restoredLegacy.editProposalRevisions[0].revisionNumber === 1 && restoredLegacy.editProposal.revisionNumber === 1, "legacy proposal revisions default to one");

  store.saveTask({
    ...legacyTask,
    id: "newer",
    title: "Newer task",
    updatedAt: "2026-07-31T11:00:00Z",
    taskCommandRuns: [],
    validationRuns: [],
    validationRepairBriefs: [],
    messages: [],
    editProposalRevisions: [],
    editProposal: undefined
  });
  ok(store.loadTasks().map((task) => task.id).join(",") === "newer,legacy", "tasks load newest first");

  const purgeReceipt = {
    id: "purge-1",
    scope: "CommandOutput",
    exportedAt: "2026-07-31T11:30:00Z",
    exportSourceSha256: "a".repeat(64),
    purgedAt: "2026-07-31T11:31:00Z",
    recordsAffected: 2,
    bytesRemoved: 512,
    summary: "Purged two command output records after export."
  };
  store.saveTaskWithHistoryPurge({
    ...legacyTask,
    updatedAt: purgeReceipt.purgedAt,
    historyPurges: [purgeReceipt]
  }, purgeReceipt);
  ok(store.loadTaskHistoryPurgeReceipts("legacy")[0].bytesRemoved === 512, "task update and purge receipt persist atomically");

  store.replaceSymbolsForFile("src/a.ts", [
    { kind: "class", name: "Widget", line: 4 },
    { kind: "function", name: "WidgetFactory", line: 9 },
    { kind: "const", name: "Percent%Name", line: 12 }
  ]);
  store.replaceSymbolsForFile("src/b.ts", [{ kind: "class", name: "widget", line: 2 }]);
  ok(store.hasSymbolsForFile("src/a.ts") && store.countSymbols() === 4, "symbol rows stored and counted");
  const exactFirst = store.searchSymbols("Widget");
  ok(exactFirst[0].name.toLowerCase() === "widget" && exactFirst.some((symbol) => symbol.name === "WidgetFactory"), "symbol search ranks exact names first");
  ok(store.searchSymbols("%").length === 1, "symbol LIKE wildcards are escaped");
  ok(store.searchSymbols("   ").length === 0, "blank symbol query is rejected");
  store.removeSymbolsForFile("src/a.ts");
  ok(!store.hasSymbolsForFile("src/a.ts") && store.countSymbols() === 1, "symbol removal is file-scoped");

  store.replaceTrigramsForFile("src/a.ts", ["abc", "bcd", "abc"]);
  store.replaceTrigramsForFile("src/b.ts", ["abc", "xyz"]);
  ok(store.countTrigramFiles() === 2, "trigram file count ignores duplicate postings");
  ok(store.hasTrigramsForFile("src/a.ts") && !store.hasTrigramsForFile("src/missing.ts"), "trigram presence is file-scoped");
  ok(store.filesContainingAllTrigrams(["abc", "bcd", "abc"]).join(",") === "src/a.ts", "trigram lookup intersects unique terms");
  ok(store.filesContainingAllTrigrams([]).length === 0, "empty trigram lookup is empty");
  assert.throws(() => store.replaceTrigramsForFile("src/bad.ts", [{}]), /bound|type/i);
  count += 1;
  ok(store.countTrigramFiles() === 2, "failed trigram transaction rolls back cleanly");

  const indexedAt = "2026-07-31T12:00:00Z";
  store.upsertIndexedFile({ path: "src/a.ts", language: "TypeScript", byteSize: 10, lineCount: 1, contentHash: "a", indexedAt });
  store.upsertIndexedFile({ path: "src/b.ts", language: "TypeScript", byteSize: 20, lineCount: 2, contentHash: "b", indexedAt });
  store.upsertIndexedFile({ path: "src/a.ts", language: "TypeScript", byteSize: 11, lineCount: 2, contentHash: "a2", indexedAt });
  ok(store.loadIndexedFiles().find((file) => file.path === "src/a.ts")?.byteSize === 11, "indexed file upsert refreshes metadata");
  ok(store.indexedFilePaths().length === 2, "indexed paths listed independently of metadata");
  ok(store.removeIndexedFilesNotIn(new Set(["src/a.ts"])) === 1, "deleted indexed files are removed");
  ok(store.countTrigramFiles() === 1 && !store.hasSymbolsForFile("src/b.ts"), "index deletion cascades symbol and trigram rows");

  store.setIndexMeta({ lastIndexedAt: indexedAt, gitRoot: "/tmp/repo" });
  ok(store.getIndexMeta().lastIndexedAt === indexedAt && store.getIndexMeta().gitRoot === "/tmp/repo", "index metadata round-trips");
  const retentionSnapshot = store.loadRepositoryIndexRetentionSnapshot();
  ok(retentionSnapshot.files.length === 1 && retentionSnapshot.symbols.length === 0, "retention snapshot exposes bounded file and symbol metadata");
  ok(retentionSnapshot.trigrams.rowCount === 2 && retentionSnapshot.sourceSha256.length === 64, "retention snapshot binds exact trigram/index state");
  store.close();
  ok(!existsSync(databaseWriterLeasePath(dbPath)), "clean writer close releases the database lease");

  const staleLeasePath = join(tempRoot, "nested", "stale.sqlite");
  await writeFile(databaseWriterLeasePath(staleLeasePath), JSON.stringify({
    version: 1,
    id: "stale-writer",
    pid: 999_999_999,
    acquiredAt: "2026-08-10T00:00:00.000Z",
    databasePath: staleLeasePath
  }), "utf8");
  const staleRecovered = new SqliteTaskStore(staleLeasePath);
  staleRecovered.close();
  const staleArtifacts = await readdir(join(tempRoot, "nested"));
  ok(staleArtifacts.some((name) => name.startsWith("stale.sqlite.forge-writer-lock.stale-")), "startup preserves and replaces a stale writer lease");

  const readOnly = new SqliteTaskStore(dbPath, { readOnly: true });
  ok(readOnly.loadTasks().length === 2 && readOnly.countTrigramFiles() === 1, "read-only store loads persisted task and index state");
  assert.throws(() => readOnly.saveTask(legacyTask), /read-only in observer runtime mode/);
  assert.throws(() => readOnly.replaceSymbolsForFile("x.ts", []), /Repository index is read-only/);
  assert.throws(() => readOnly.replaceTrigramsForFile("x.ts", []), /Repository index is read-only/);
  assert.throws(() => readOnly.saveWorkspaceHistoryPurge([], {}, true), /read-only in observer runtime mode/);
  count += 4;
  readOnly.close();

  const missingReadOnly = new SqliteTaskStore(join(tempRoot, "missing", "forge.sqlite"), { readOnly: true });
  ok(missingReadOnly.loadTasks().length === 0, "missing observer database uses an empty in-memory store");
  assert.throws(() => missingReadOnly.setIndexMeta({ lastIndexedAt: indexedAt, gitRoot: null }), /Repository index is read-only/);
  count += 1;
  missingReadOnly.close();

  const priorSchemaPath = join(tempRoot, "prior-schema", "forge.sqlite");
  const priorStore = new SqliteTaskStore(priorSchemaPath);
  priorStore.saveTask({ ...legacyTask, id: "prior-v5", title: "Prior schema task" });
  priorStore.close();
  const priorRaw = new DatabaseSync(priorSchemaPath);
  priorRaw.exec(`
    DROP TABLE workspace_history_purges;
    DELETE FROM schema_migrations WHERE version = 6;
  `);
  priorRaw.close();
  assert.throws(
    () => new SqliteTaskStore(priorSchemaPath, { readOnly: true }),
    /requires migration 6.*primary runtime first/
  );
  count += 1;
  const migratedPrior = new SqliteTaskStore(priorSchemaPath);
  ok(migratedPrior.schemaStatus().currentVersion === 6, "writable runtime migrates the immediately prior schema to v6");
  ok(migratedPrior.loadTasks()[0].id === "prior-v5", "prior-schema task payload survives migration");
  ok(migratedPrior.loadWorkspaceHistoryPurgeReceipts().length === 0, "new workspace receipt table is readable after prior-schema recovery");
  migratedPrior.upsertIndexedFile({ path: "src/private.ts", language: "TypeScript", byteSize: 12, lineCount: 1, contentHash: "c", indexedAt });
  migratedPrior.replaceSymbolsForFile("src/private.ts", [{ kind: "function", name: "privateFixture", line: 1 }]);
  migratedPrior.replaceTrigramsForFile("src/private.ts", ["pri", "riv"]);
  migratedPrior.setIndexMeta({ lastIndexedAt: indexedAt, gitRoot: "/tmp/prior" });
  const workspaceReceipt = {
    id: "workspace-purge-1",
    policyID: "forge-workspace-retention",
    policyVersion: 1,
    scopes: ["TaskEvents", "RepositoryIndexes"],
    exportedAt: "2026-08-22T12:00:00.000Z",
    exportSourceSha256: "b".repeat(64),
    exportContentSha256: "c".repeat(64),
    purgedAt: "2026-08-22T12:01:00.000Z",
    taskRecordsAffected: 1,
    indexRecordsAffected: 4,
    recordsAffectedByScope: { TaskEvents: 1, ToolCalls: 0, TaskMessages: 0, RepositoryIndexes: 4 },
    bytesRemoved: 128,
    preservedNonterminalRecords: 0,
    summary: "Purged workspace fixture evidence."
  };
  const priorTask = migratedPrior.loadTasks()[0];
  migratedPrior.saveWorkspaceHistoryPurge([{ ...priorTask, events: [], updatedAt: workspaceReceipt.purgedAt }], workspaceReceipt, true);
  ok(migratedPrior.loadWorkspaceHistoryPurgeReceipts()[0].bytesRemoved === 128, "workspace purge receipt persists atomically");
  ok(migratedPrior.loadTasks()[0].events.length === 0, "workspace task-history mutation persists with its receipt");
  ok(migratedPrior.loadRepositoryIndexRetentionSnapshot().retainedRecords === 0, "workspace purge clears all rebuildable index tables atomically");
  migratedPrior.close();

  const raw = new DatabaseSync(dbPath);
  raw.prepare("UPDATE tasks SET payload_json = ? WHERE id = ?").run(new Uint8Array([1, 2, 3]), "legacy");
  raw.close();
  const corrupt = new SqliteTaskStore(dbPath, { readOnly: true });
  assert.throws(() => corrupt.loadTasks(), /Invalid task payload/);
  count += 1;
  corrupt.close();
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log(`Task store test passed: ${count} assertions.`);
