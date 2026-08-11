#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { applyDatabaseMigrations } from "../dist/databaseMigrationRunner.js";
import { DATABASE_MIGRATIONS } from "../dist/databaseMigrations.js";
import { SqliteTaskStore } from "../dist/taskStore.js";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-database-recovery-${process.pid}-${Date.now()}`);
const databasePath = join(tempRoot, "forge.sqlite");

try {
  await mkdir(tempRoot, { recursive: true });
  const store = new SqliteTaskStore(databasePath);
  store.saveTask({
    id: "database-recovery-task",
    title: "Database recovery fixture",
    objective: "Survive an offline destructive migration restore rehearsal.",
    status: "Completed",
    currentPhase: "Completed",
    createdAt: "2026-08-11T01:00:00.000Z",
    updatedAt: "2026-08-11T01:01:00.000Z",
    agentStates: [], planSteps: [], events: [], approvals: [], toolCalls: [],
    agentRunLoops: [], agentRunSteps: [], taskCommandRuns: [], historyPurges: [],
    commandRerunEvidence: [], validationRuns: [], validationRepairBriefs: [],
    messages: [], planRevisions: [], editProposalRevisions: [], contextFiles: [], changedFiles: []
  });
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec("CREATE TABLE fixture_private_history (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  raw.prepare("INSERT INTO fixture_private_history (id, body) VALUES (1, ?)").run("recover me exactly");
  const migration = applyDatabaseMigrations(raw, databasePath, {
    migrations: [...DATABASE_MIGRATIONS, {
      version: 6,
      name: "fixture_destructive_history_rewrite",
      safety: "Destructive",
      sql: "DROP TABLE fixture_private_history;"
    }]
  });
  assert.equal(schemaVersion(raw), 6);
  assert.equal(tableExists(raw, "fixture_private_history"), false);
  raw.close();
  assert.equal(migration.backups.length, 1);

  const manifestPath = migration.backups[0].manifestPath;
  const refused = await runRestore(manifestPath, "wrong-confirmation");
  assert.equal(refused.code, 64);
  assert.match(refused.stderr, /confirmation must be RestoreForgeDatabaseBackup/);
  const stillMigrated = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(schemaVersion(stillMigrated), 6, "refused CLI restore must leave the migrated database unchanged");
  stillMigrated.close();

  const restored = await runRestore(manifestPath, "RestoreForgeDatabaseBackup");
  assert.equal(restored.code, 0, restored.stderr);
  assert.match(restored.stdout, /restore completed and verified/);
  assert.match(restored.stdout, /Schema version: 5/);
  assert.match(restored.stdout, /Tasks: 1/);
  const receiptLine = restored.stdout.split("\n").find((line) => line.startsWith("- Receipt: "));
  assert(receiptLine, "restore CLI did not print its receipt path");
  const receiptPath = receiptLine.slice("- Receipt: ".length);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.restoredSchemaVersion, 5);
  assert.equal(receipt.restoredTaskCount, 1);
  assert.match(receipt.restoredSha256, /^[a-f0-9]{64}$/);
  assert(receipt.displacedDatabasePath, "restore receipt did not preserve the displaced database");

  const recoveredStore = new SqliteTaskStore(databasePath, { readOnly: true });
  assert.equal(recoveredStore.loadTasks()[0].id, "database-recovery-task");
  recoveredStore.close();
  const recovered = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(schemaVersion(recovered), 5);
  assert.equal(
    recovered.prepare("SELECT body FROM fixture_private_history WHERE id = 1").get().body,
    "recover me exactly"
  );
  recovered.close();
  const displaced = new DatabaseSync(receipt.displacedDatabasePath, { readOnly: true });
  assert.equal(schemaVersion(displaced), 6);
  assert.equal(tableExists(displaced, "fixture_private_history"), false);
  displaced.close();

  console.log("Database destructive-migration recovery fixture passed.");
  console.log("- v5 task store and private fixture data captured before destructive v6");
  console.log("- Wrong CLI confirmation rejected with zero database replacement");
  console.log("- Verified manifest restored schema v5, task payload, and removed data");
  console.log("- Restore receipt and displaced schema-v6 rescue database preserved");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function runRestore(manifestPath, confirmation) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [
      "scripts/database-restore.mjs",
      manifestPath,
      databasePath,
      confirmation
    ], {
      cwd: runtimeRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

function schemaVersion(database) {
  return Number(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version);
}

function tableExists(database, name) {
  return database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}
