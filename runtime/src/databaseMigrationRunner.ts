import type { DatabaseSync } from "node:sqlite";

import {
  createVerifiedMigrationBackup,
  type VerifiedDatabaseBackup
} from "./databaseBackup.js";
import {
  DATABASE_MIGRATIONS,
  DATABASE_SCHEMA_VERSION,
  type DatabaseMigration
} from "./databaseMigrations.js";

export interface DatabaseMigrationResult {
  currentVersion: number;
  expectedVersion: number;
  appliedVersions: number[];
  backups: VerifiedDatabaseBackup[];
}

export interface DatabaseMigrationOptions {
  migrations?: readonly DatabaseMigration[];
  createBackup?: typeof createVerifiedMigrationBackup;
}

export function applyDatabaseMigrations(
  database: DatabaseSync,
  databasePath: string,
  options: DatabaseMigrationOptions = {}
): DatabaseMigrationResult {
  const migrations = options.migrations ?? DATABASE_MIGRATIONS;
  validateMigrationRegistry(migrations);
  const expectedVersion = migrations.at(-1)?.version ?? 0;
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = readAppliedMigrations(database);
  validateAppliedMigrations(applied, migrations, expectedVersion);

  const backups: VerifiedDatabaseBackup[] = [];
  const appliedVersions: number[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    if (migration.safety === "Destructive") {
      try {
        backups.push((options.createBackup ?? createVerifiedMigrationBackup)(database, databasePath, {
          targetSchemaVersion: migration.version,
          targetMigrationName: migration.name
        }));
      } catch (error) {
        throw new Error(
          `Forge database backup before destructive migration ${migration.version} (${migration.name}) failed; migration was not started: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.prepare(`
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (?, ?, datetime('now'))
      `).run(migration.version, migration.name);
      database.exec("COMMIT");
      appliedVersions.push(migration.version);
    } catch (error) {
      database.exec("ROLLBACK");
      const backupEvidence = backups.at(-1)?.manifestPath;
      throw new Error(
        `Forge database migration ${migration.version} (${migration.name}) failed${backupEvidence ? `; verified backup: ${backupEvidence}` : ""}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  validateDatabaseSchema(database, migrations);
  return { currentVersion: expectedVersion, expectedVersion, appliedVersions, backups };
}

export function validateDatabaseSchema(
  database: DatabaseSync,
  migrations: readonly DatabaseMigration[] = DATABASE_MIGRATIONS,
  options: { readOnly?: boolean } = {}
): void {
  validateMigrationRegistry(migrations);
  let applied: Map<number, string>;
  try {
    applied = readAppliedMigrations(database);
  } catch {
    throw new Error("Forge database is missing versioned migration metadata.");
  }
  const expectedVersion = migrations.at(-1)?.version ?? DATABASE_SCHEMA_VERSION;
  validateAppliedMigrations(applied, migrations, expectedVersion, options.readOnly === true);
  for (const migration of migrations) {
    if (applied.get(migration.version) !== migration.name) {
      const mode = options.readOnly
        ? " Read-only observers cannot migrate it; start the primary runtime first."
        : "";
      throw new Error(`Forge database requires migration ${migration.version} (${migration.name}).${mode}`);
    }
  }
}

export function validateMigrationRegistry(migrations: readonly DatabaseMigration[]): void {
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index];
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Forge database migration registry must be contiguous from version 1; expected ${expectedVersion}, found ${migration.version}.`
      );
    }
    if (!migration.name.trim()) throw new Error(`Forge database migration ${migration.version} has no name.`);
    if (migration.safety !== "Additive" && migration.safety !== "Destructive") {
      throw new Error(`Forge database migration ${migration.version} has no valid safety classification.`);
    }
  }
}

function readAppliedMigrations(database: DatabaseSync): Map<number, string> {
  return new Map(
    database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all()
      .map((row) => [Number(row.version), String(row.name)] as const)
  );
}

function validateAppliedMigrations(
  applied: Map<number, string>,
  migrations: readonly DatabaseMigration[],
  expectedVersion: number,
  readOnly = false
): void {
  const newestApplied = Math.max(0, ...applied.keys());
  if (newestApplied > expectedVersion) {
    throw new Error(
      `Forge database schema ${newestApplied} is newer than this runtime supports (${expectedVersion}).`
    );
  }
  for (const migration of migrations) {
    const appliedName = applied.get(migration.version);
    if (appliedName && appliedName !== migration.name) {
      throw new Error(
        `Forge database migration ${migration.version} is recorded as ${appliedName}, expected ${migration.name}.`
      );
    }
    if (!appliedName && migration.version <= newestApplied) {
      throw new Error(`Forge database migration history has a gap at version ${migration.version}.`);
    }
    if (!appliedName && readOnly) break;
  }
}
