#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  createVerifiedMigrationBackup,
  DATABASE_RESTORE_CONFIRMATION,
  restoreVerifiedDatabaseBackup,
  verifyDatabaseBackup
} from "../dist/databaseBackup.js";
import { applyDatabaseMigrations, validateMigrationRegistry } from "../dist/databaseMigrationRunner.js";
import { DATABASE_MIGRATIONS } from "../dist/databaseMigrations.js";
import { databaseWriterLeasePath } from "../dist/databaseWriterLease.js";
import { SqliteTaskStore } from "../dist/taskStore.js";

const tempRoot = join(tmpdir(), `forge-database-backup-${process.pid}-${Date.now()}`);
let assertions = 0;

try {
  await mkdir(tempRoot, { recursive: true });
  const databasePath = join(tempRoot, "forge.sqlite");
  seedForgeDatabase(databasePath, "migration-proof-task");
  addLegacyNote(databasePath, "retain this pre-migration value");

  const destructiveV7 = {
    version: 7,
    name: "fixture_drop_legacy_notes",
    safety: "Destructive",
    sql: "DROP TABLE legacy_notes;"
  };
  const registry = [...DATABASE_MIGRATIONS, destructiveV7];
  const database = new DatabaseSync(databasePath);
  const migration = applyDatabaseMigrations(database, databasePath, { migrations: registry });
  database.close();

  ok(migration.appliedVersions.join(",") === "7", "only pending destructive v7 is applied");
  ok(migration.backups.length === 1, "destructive migration creates exactly one verified backup");
  const backup = migration.backups[0];
  const verified = verifyDatabaseBackup(backup.manifestPath);
  ok(verified.manifest.sourceSchemaVersion === 6, "backup records the immediately prior schema");
  ok(verified.manifest.targetSchemaVersion === 7, "backup records the destructive target schema");
  ok(verified.manifest.sourceTaskCount === 1, "backup records the source task count");
  ok(verified.manifest.integrityCheck === "ok", "backup records SQLite integrity evidence");
  ok((await stat(verified.manifest.backupPath)).mode % 0o1000 === 0o600, "backup file is owner-readable only");
  ok((await stat(backup.manifestPath)).mode % 0o1000 === 0o600, "backup manifest is owner-readable only");

  const migrated = new DatabaseSync(databasePath, { readOnly: true });
  ok(schemaVersion(migrated) === 7, "fixture reaches destructive schema v7");
  ok(!tableExists(migrated, "legacy_notes"), "destructive fixture removes its legacy table");
  migrated.close();

  assert.throws(
    () => restoreVerifiedDatabaseBackup({
      manifestPath: backup.manifestPath,
      targetDatabasePath: databasePath,
      confirmation: "yes"
    }),
    /confirmation=RestoreForgeDatabaseBackup/
  );
  assertions += 1;
  assert.throws(
    () => restoreVerifiedDatabaseBackup({
      manifestPath: backup.manifestPath,
      targetDatabasePath: join(tempRoot, "wrong.sqlite"),
      confirmation: DATABASE_RESTORE_CONFIRMATION
    }),
    /target does not match/
  );
  assertions += 1;

  await writeFile(databaseWriterLeasePath(databasePath), JSON.stringify({
    version: 1,
    id: "active-fixture",
    pid: process.pid,
    acquiredAt: "2026-08-11T00:20:00.000Z",
    databasePath
  }), "utf8");
  assert.throws(
    () => restoreVerifiedDatabaseBackup({
      manifestPath: backup.manifestPath,
      targetDatabasePath: databasePath,
      confirmation: DATABASE_RESTORE_CONFIRMATION
    }),
    /runtime to be stopped.*active writer PID/
  );
  assertions += 1;
  await rm(databaseWriterLeasePath(databasePath));

  await writeFile(databaseWriterLeasePath(databasePath), "not-json", "utf8");
  assert.throws(
    () => restoreVerifiedDatabaseBackup({
      manifestPath: backup.manifestPath,
      targetDatabasePath: databasePath,
      confirmation: DATABASE_RESTORE_CONFIRMATION
    }),
    /unreadable writer lease/
  );
  assertions += 1;
  await rm(databaseWriterLeasePath(databasePath));

  await writeFile(`${databasePath}-wal`, "simulated uncheckpointed WAL", "utf8");
  assert.throws(
    () => restoreVerifiedDatabaseBackup({
      manifestPath: backup.manifestPath,
      targetDatabasePath: databasePath,
      confirmation: DATABASE_RESTORE_CONFIRMATION
    }),
    /checkpointed database.*non-empty forge.sqlite-wal/
  );
  assertions += 1;
  await rm(`${databasePath}-wal`);

  const corruptBackupPath = join(tempRoot, "corrupt.sqlite");
  await copyFile(verified.manifest.backupPath, corruptBackupPath);
  await writeFile(corruptBackupPath, "corruption", { flag: "a" });
  const corruptManifestPath = join(tempRoot, "corrupt.manifest.json");
  const corruptBytes = (await stat(corruptBackupPath)).size;
  await writeFile(corruptManifestPath, JSON.stringify({
    ...verified.manifest,
    id: "corrupt-fixture",
    backupPath: corruptBackupPath,
    backupBytes: corruptBytes
  }), "utf8");
  assert.throws(() => verifyDatabaseBackup(corruptManifestPath), /SHA-256 mismatch/);
  assertions += 1;

  const receipt = restoreVerifiedDatabaseBackup({
    manifestPath: backup.manifestPath,
    targetDatabasePath: databasePath,
    confirmation: DATABASE_RESTORE_CONFIRMATION,
    restoredAt: "2026-08-11T00:30:00.000Z"
  });
  ok(receipt.restoredSchemaVersion === 6, "restore receipt records schema v6");
  ok(receipt.restoredTaskCount === 1, "restore receipt records one recovered task");
  ok(receipt.restoredSha256 === verified.manifest.backupSha256, "restored database matches backup SHA-256");
  ok(Boolean(receipt.displacedDatabasePath), "restore preserves the displaced v7 database");
  ok((await readFile(receipt.receiptPath, "utf8")).includes(receipt.id), "restore writes an auditable receipt");

  const restored = new DatabaseSync(databasePath, { readOnly: true });
  ok(schemaVersion(restored) === 6, "offline restore returns the target to schema v6");
  ok(restored.prepare("SELECT body FROM legacy_notes WHERE id = 1").get().body === "retain this pre-migration value", "offline restore recovers destructively removed data");
  restored.close();
  const restoredStore = new SqliteTaskStore(databasePath, { readOnly: true });
  ok(restoredStore.loadTasks()[0].id === "migration-proof-task", "restored Forge task opens through the production store");
  restoredStore.close();

  const displaced = new DatabaseSync(receipt.displacedDatabasePath, { readOnly: true });
  ok(schemaVersion(displaced) === 7, "pre-restore rescue copy preserves the displaced schema v7 database");
  ok(!tableExists(displaced, "legacy_notes"), "pre-restore rescue copy preserves the displaced destructive result");
  displaced.close();

  const blockedPath = join(tempRoot, "blocked.sqlite");
  seedForgeDatabase(blockedPath, "blocked-task");
  addLegacyNote(blockedPath, "must remain when backup fails");
  const blocked = new DatabaseSync(blockedPath);
  assert.throws(
    () => applyDatabaseMigrations(blocked, blockedPath, {
      migrations: registry,
      createBackup: () => { throw new Error("simulated backup storage failure"); }
    }),
    /backup.*failed; migration was not started/
  );
  assertions += 1;
  ok(schemaVersion(blocked) === 6, "backup failure leaves schema version unchanged");
  ok(tableExists(blocked, "legacy_notes"), "backup failure executes no destructive SQL");
  blocked.close();

  const rollbackPath = join(tempRoot, "rollback.sqlite");
  seedForgeDatabase(rollbackPath, "rollback-task");
  addLegacyNote(rollbackPath, "transaction rollback must retain this");
  const rollback = new DatabaseSync(rollbackPath);
  const failingRegistry = [...DATABASE_MIGRATIONS, {
    version: 7,
    name: "fixture_failed_destructive_migration",
    safety: "Destructive",
    sql: "DROP TABLE legacy_notes; INSERT INTO definitely_missing(value) VALUES ('fail');"
  }];
  assert.throws(
    () => applyDatabaseMigrations(rollback, rollbackPath, { migrations: failingRegistry }),
    /migration 7.*failed; verified backup:/
  );
  assertions += 1;
  ok(schemaVersion(rollback) === 6, "failed destructive transaction keeps schema version v6");
  ok(tableExists(rollback, "legacy_notes"), "failed destructive transaction rolls back removed data");
  rollback.close();
  const rollbackArtifacts = await readFileNames(join(tempRoot, "database-backups"));
  ok(rollbackArtifacts.some((name) => name.includes("fixture_failed_destructive_migration") && name.endsWith(".manifest.json")), "failed destructive migration preserves its verified backup manifest");

  assert.throws(
    () => validateMigrationRegistry([...DATABASE_MIGRATIONS, { ...destructiveV7, version: 8 }]),
    /contiguous.*expected 7, found 8/
  );
  assertions += 1;
  assert.throws(
    () => validateMigrationRegistry([...DATABASE_MIGRATIONS, { ...destructiveV7, safety: "Unknown" }]),
    /safety classification/
  );
  assertions += 1;

  const pathMismatchDatabase = new DatabaseSync(databasePath, { readOnly: true });
  assert.throws(
    () => createVerifiedMigrationBackup(pathMismatchDatabase, join(tempRoot, "wrong-source.sqlite"), {
      targetSchemaVersion: 7,
      targetMigrationName: "wrong_source_fixture"
    }),
    /path does not match the requested backup source/
  );
  assertions += 1;
  pathMismatchDatabase.close();
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log(`Database backup/restore test passed: ${assertions} assertions.`);

function seedForgeDatabase(databasePath, taskID) {
  const store = new SqliteTaskStore(databasePath);
  store.saveTask({
    id: taskID,
    title: "Database migration proof",
    objective: "Prove destructive migration backup and offline recovery.",
    status: "Completed",
    currentPhase: "Completed",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:01:00.000Z",
    agentStates: [], planSteps: [], events: [], approvals: [], toolCalls: [],
    agentRunLoops: [], agentRunSteps: [], taskCommandRuns: [], historyPurges: [],
    commandRerunEvidence: [], validationRuns: [], validationRepairBriefs: [],
    messages: [], planRevisions: [], editProposalRevisions: [], contextFiles: [], changedFiles: []
  });
  store.close();
}

function addLegacyNote(databasePath, body) {
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE legacy_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  database.prepare("INSERT INTO legacy_notes (id, body) VALUES (1, ?)").run(body);
  database.close();
}

function schemaVersion(database) {
  return Number(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version);
}

function tableExists(database, name) {
  return database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

async function readFileNames(directory) {
  const { readdir } = await import("node:fs/promises");
  return readdir(directory);
}

function ok(condition, message) {
  assert(condition, message);
  assertions += 1;
}
