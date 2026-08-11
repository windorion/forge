import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertNoActiveDatabaseWriter, canonicalDatabasePath } from "./databaseWriterLease.js";

export const DATABASE_BACKUP_MANIFEST_VERSION = 1;
export const DATABASE_RESTORE_CONFIRMATION = "RestoreForgeDatabaseBackup";

export interface DatabaseMigrationBackupRequest {
  targetSchemaVersion: number;
  targetMigrationName: string;
  createdAt?: string;
  backupDirectory?: string;
}

export interface DatabaseBackupManifest {
  manifestVersion: 1;
  id: string;
  reason: "BeforeDestructiveMigration";
  createdAt: string;
  sourceDatabasePath: string;
  sourceSchemaVersion: number;
  sourceTaskCount: number;
  targetSchemaVersion: number;
  targetMigrationName: string;
  backupPath: string;
  backupBytes: number;
  backupSha256: string;
  integrityCheck: "ok";
}

export interface VerifiedDatabaseBackup {
  manifestPath: string;
  manifest: DatabaseBackupManifest;
}

export interface DatabaseRestoreRequest {
  manifestPath: string;
  targetDatabasePath: string;
  confirmation: string;
  restoredAt?: string;
}

export interface DatabaseRestoreReceipt {
  receiptVersion: 1;
  id: string;
  restoredAt: string;
  manifestID: string;
  manifestPath: string;
  targetDatabasePath: string;
  restoredSchemaVersion: number;
  restoredTaskCount: number;
  restoredBytes: number;
  restoredSha256: string;
  displacedDatabasePath?: string;
  displacedDatabaseBytes?: number;
  displacedDatabaseSha256?: string;
  receiptPath: string;
}

export function createVerifiedMigrationBackup(
  database: DatabaseSync,
  databasePath: string,
  request: DatabaseMigrationBackupRequest
): VerifiedDatabaseBackup {
  if (databasePath === ":memory:") {
    throw new Error("Destructive migrations require an on-disk absolute database path.");
  }
  const sourcePath = canonicalDatabasePath(databasePath);
  if (!path.isAbsolute(sourcePath)) {
    throw new Error("Destructive migrations require an on-disk absolute database path.");
  }
  const source = inspectOpenDatabase(database);
  if (!source.databasePath || canonicalDatabasePath(source.databasePath) !== sourcePath) {
    throw new Error(
      `Open SQLite database path does not match the requested backup source: ${source.databasePath || "in-memory"} / ${sourcePath}.`
    );
  }
  const createdAt = normalizedTimestamp(request.createdAt ?? new Date().toISOString(), "backup createdAt");
  const backupDirectory = path.resolve(
    request.backupDirectory ?? path.join(path.dirname(sourcePath), "database-backups")
  );
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });

  const id = randomUUID();
  const timestamp = compactTimestamp(createdAt);
  const migrationName = safeFilenamePart(request.targetMigrationName);
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(sourcePath)}.schema-v${source.schemaVersion}-before-v${request.targetSchemaVersion}-${migrationName}-${timestamp}-${id}.sqlite`
  );
  const manifestPath = `${backupPath}.manifest.json`;
  if (existsSync(backupPath) || existsSync(manifestPath)) {
    throw new Error("Refusing to overwrite an existing migration backup artifact.");
  }

  database.prepare("VACUUM INTO ?").run(backupPath);
  chmodSync(backupPath, 0o600);
  const backup = inspectDatabaseFile(backupPath);
  if (backup.integrityCheck !== "ok") {
    throw new Error(`Migration backup integrity check failed: ${backup.integrityCheck}`);
  }
  if (backup.schemaVersion !== source.schemaVersion || backup.taskCount !== source.taskCount) {
    throw new Error(
      `Migration backup verification mismatch: schema ${backup.schemaVersion}/${source.schemaVersion}, tasks ${backup.taskCount}/${source.taskCount}.`
    );
  }

  const manifest: DatabaseBackupManifest = {
    manifestVersion: DATABASE_BACKUP_MANIFEST_VERSION,
    id,
    reason: "BeforeDestructiveMigration",
    createdAt,
    sourceDatabasePath: sourcePath,
    sourceSchemaVersion: source.schemaVersion,
    sourceTaskCount: source.taskCount,
    targetSchemaVersion: request.targetSchemaVersion,
    targetMigrationName: request.targetMigrationName,
    backupPath,
    backupBytes: statSync(backupPath).size,
    backupSha256: sha256File(backupPath),
    integrityCheck: "ok"
  };
  writeJsonAtomically(manifestPath, manifest);
  return verifyDatabaseBackup(manifestPath);
}

export function verifyDatabaseBackup(manifestPath: string): VerifiedDatabaseBackup {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifest = parseManifest(readFileSync(resolvedManifestPath, "utf8"));
  if (!path.isAbsolute(manifest.sourceDatabasePath) || !path.isAbsolute(manifest.backupPath)) {
    throw new Error("Database backup manifest paths must be absolute.");
  }
  if (!existsSync(manifest.backupPath)) {
    throw new Error(`Database backup file is missing: ${manifest.backupPath}`);
  }
  const bytes = statSync(manifest.backupPath).size;
  if (bytes !== manifest.backupBytes) {
    throw new Error(`Database backup byte count mismatch: expected ${manifest.backupBytes}, found ${bytes}.`);
  }
  const sha256 = sha256File(manifest.backupPath);
  if (sha256 !== manifest.backupSha256) {
    throw new Error("Database backup SHA-256 mismatch.");
  }
  const backup = inspectDatabaseFile(manifest.backupPath);
  if (backup.integrityCheck !== "ok") {
    throw new Error(`Database backup integrity check failed: ${backup.integrityCheck}`);
  }
  if (backup.schemaVersion !== manifest.sourceSchemaVersion) {
    throw new Error(
      `Database backup schema mismatch: expected ${manifest.sourceSchemaVersion}, found ${backup.schemaVersion}.`
    );
  }
  if (backup.taskCount !== manifest.sourceTaskCount) {
    throw new Error(
      `Database backup task count mismatch: expected ${manifest.sourceTaskCount}, found ${backup.taskCount}.`
    );
  }
  return { manifestPath: resolvedManifestPath, manifest };
}

export function restoreVerifiedDatabaseBackup(request: DatabaseRestoreRequest): DatabaseRestoreReceipt {
  if (request.confirmation !== DATABASE_RESTORE_CONFIRMATION) {
    throw new Error(`Database restore requires confirmation=${DATABASE_RESTORE_CONFIRMATION}.`);
  }
  const verified = verifyDatabaseBackup(request.manifestPath);
  const targetPath = canonicalDatabasePath(request.targetDatabasePath);
  if (targetPath !== canonicalDatabasePath(verified.manifest.sourceDatabasePath)) {
    throw new Error("Database restore target does not match the manifest source database path.");
  }
  assertNoActiveDatabaseWriter(targetPath);
  const walPath = `${targetPath}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) {
    throw new Error(
      `Database restore requires a checkpointed database; non-empty ${path.basename(walPath)} remains.`
    );
  }

  const restoredAt = normalizedTimestamp(request.restoredAt ?? new Date().toISOString(), "restore restoredAt");
  const id = randomUUID();
  const parent = path.dirname(targetPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const preparedPath = path.join(parent, `.${path.basename(targetPath)}.restore-${id}.tmp`);
  copyFileSync(verified.manifest.backupPath, preparedPath, constants.COPYFILE_EXCL);
  chmodSync(preparedPath, 0o600);
  const prepared = inspectDatabaseFile(preparedPath);
  const preparedSha256 = sha256File(preparedPath);
  if (
    prepared.integrityCheck !== "ok"
    || prepared.schemaVersion !== verified.manifest.sourceSchemaVersion
    || prepared.taskCount !== verified.manifest.sourceTaskCount
    || preparedSha256 !== verified.manifest.backupSha256
  ) {
    unlinkSync(preparedPath);
    throw new Error("Prepared database restore copy failed verification.");
  }

  let displacedDatabasePath: string | undefined;
  let displacedDatabaseBytes: number | undefined;
  let displacedDatabaseSha256: string | undefined;
  if (existsSync(targetPath)) {
    displacedDatabasePath = `${targetPath}.pre-restore-${compactTimestamp(restoredAt)}-${id}`;
    displacedDatabaseBytes = statSync(targetPath).size;
    displacedDatabaseSha256 = sha256File(targetPath);
    renameSync(targetPath, displacedDatabasePath);
  }
  try {
    renameSync(preparedPath, targetPath);
    const restored = inspectDatabaseFile(targetPath);
    const restoredSha256 = sha256File(targetPath);
    if (
      restored.integrityCheck !== "ok"
      || restored.schemaVersion !== verified.manifest.sourceSchemaVersion
      || restored.taskCount !== verified.manifest.sourceTaskCount
      || restoredSha256 !== verified.manifest.backupSha256
    ) {
      throw new Error("Restored database failed final verification.");
    }
    const receiptPath = path.join(
      path.dirname(verified.manifestPath),
      `${path.basename(targetPath)}.restore-${compactTimestamp(restoredAt)}-${id}.receipt.json`
    );
    const receipt: DatabaseRestoreReceipt = {
      receiptVersion: 1,
      id,
      restoredAt,
      manifestID: verified.manifest.id,
      manifestPath: verified.manifestPath,
      targetDatabasePath: targetPath,
      restoredSchemaVersion: restored.schemaVersion,
      restoredTaskCount: restored.taskCount,
      restoredBytes: statSync(targetPath).size,
      restoredSha256,
      displacedDatabasePath,
      displacedDatabaseBytes,
      displacedDatabaseSha256,
      receiptPath
    };
    writeJsonAtomically(receiptPath, receipt);
    return receipt;
  } catch (error) {
    const failedPath = `${targetPath}.failed-restore-${id}`;
    if (existsSync(targetPath)) renameSync(targetPath, failedPath);
    if (displacedDatabasePath && existsSync(displacedDatabasePath)) {
      renameSync(displacedDatabasePath, targetPath);
    }
    throw error;
  }
}

function inspectOpenDatabase(database: DatabaseSync): {
  integrityCheck: string;
  schemaVersion: number;
  taskCount: number;
  databasePath: string;
} {
  const integrityRows = database.prepare("PRAGMA integrity_check").all();
  const integrityCheck = integrityRows.map((row) => String(row.integrity_check)).join(",");
  const migrationTable = database.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
  ).get();
  const taskTable = database.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'tasks'"
  ).get();
  const schemaVersion = migrationTable
    ? Number(database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get()?.version ?? 0)
    : 0;
  const taskCount = taskTable
    ? Number(database.prepare("SELECT COUNT(*) AS count FROM tasks").get()?.count ?? 0)
    : 0;
  const mainDatabase = database.prepare("PRAGMA database_list").all()
    .find((row) => String(row.name) === "main");
  return {
    integrityCheck,
    schemaVersion,
    taskCount,
    databasePath: String(mainDatabase?.file ?? "")
  };
}

function inspectDatabaseFile(databasePath: string): {
  integrityCheck: string;
  schemaVersion: number;
  taskCount: number;
  databasePath: string;
} {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return inspectOpenDatabase(database);
  } finally {
    database.close();
  }
}

function parseManifest(raw: string): DatabaseBackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Database backup manifest is not valid JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("Database backup manifest must be an object.");
  const manifest = value as Partial<DatabaseBackupManifest>;
  if (
    manifest.manifestVersion !== DATABASE_BACKUP_MANIFEST_VERSION
    || typeof manifest.id !== "string"
    || manifest.reason !== "BeforeDestructiveMigration"
    || typeof manifest.createdAt !== "string"
    || typeof manifest.sourceDatabasePath !== "string"
    || !Number.isInteger(manifest.sourceSchemaVersion)
    || !Number.isInteger(manifest.sourceTaskCount)
    || !Number.isInteger(manifest.targetSchemaVersion)
    || typeof manifest.targetMigrationName !== "string"
    || typeof manifest.backupPath !== "string"
    || !Number.isInteger(manifest.backupBytes)
    || typeof manifest.backupSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(manifest.backupSha256)
    || manifest.integrityCheck !== "ok"
  ) {
    throw new Error("Database backup manifest failed schema validation.");
  }
  normalizedTimestamp(manifest.createdAt, "backup manifest createdAt");
  return manifest as DatabaseBackupManifest;
}

function writeJsonAtomically(targetPath: string, value: unknown): void {
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  renameSync(tempPath, targetPath);
}

function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function compactTimestamp(value: string): string {
  return value.replace(/[-:.]/g, "").replace("Z", "Z");
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "migration";
}

function normalizedTimestamp(value: string, label: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO-8601 timestamp.`);
  return new Date(timestamp).toISOString();
}
