import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface DatabaseWriterLease {
  version: 1;
  id: string;
  pid: number;
  acquiredAt: string;
  databasePath: string;
  leasePath: string;
}

export function databaseWriterLeasePath(databasePath: string): string {
  return `${canonicalDatabasePath(databasePath)}.forge-writer-lock`;
}

export function canonicalDatabasePath(databasePath: string): string {
  const resolved = path.resolve(databasePath);
  return path.join(realpathSync(path.dirname(resolved)), path.basename(resolved));
}

export function acquireDatabaseWriterLease(databasePath: string): DatabaseWriterLease {
  const resolvedDatabasePath = canonicalDatabasePath(databasePath);
  const leasePath = databaseWriterLeasePath(resolvedDatabasePath);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const lease: DatabaseWriterLease = {
      version: 1,
      id: randomUUID(),
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      databasePath: resolvedDatabasePath,
      leasePath
    };
    try {
      writeFileSync(leasePath, `${JSON.stringify(lease, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      return lease;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      const existing = readDatabaseWriterLease(databasePath);
      if (existing && processIsAlive(existing.pid)) {
        throw new Error(
          `Forge database already has an active writer lease from PID ${existing.pid} acquired at ${existing.acquiredAt}.`
        );
      }
      const stalePath = `${leasePath}.stale-${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID()}`;
      renameSync(leasePath, stalePath);
    }
  }
  throw new Error("Forge could not acquire the database writer lease after preserving a stale lease.");
}

export function releaseDatabaseWriterLease(lease: DatabaseWriterLease | undefined): void {
  if (!lease || !existsSync(lease.leasePath)) return;
  const current = readDatabaseWriterLease(lease.databasePath);
  if (current?.id !== lease.id) return;
  unlinkSync(lease.leasePath);
}

export function assertNoActiveDatabaseWriter(databasePath: string): void {
  const leasePath = databaseWriterLeasePath(databasePath);
  const lease = readDatabaseWriterLease(databasePath);
  if (existsSync(leasePath) && !lease) {
    throw new Error(`Database restore refused an unreadable writer lease: ${leasePath}.`);
  }
  if (lease && processIsAlive(lease.pid)) {
    throw new Error(
      `Database restore requires the Forge runtime to be stopped; active writer PID ${lease.pid} holds ${lease.leasePath}.`
    );
  }
}

export function readDatabaseWriterLease(databasePath: string): DatabaseWriterLease | undefined {
  const leasePath = databaseWriterLeasePath(databasePath);
  if (!existsSync(leasePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(leasePath, "utf8")) as Partial<DatabaseWriterLease>;
    if (
      parsed.version !== 1
      || typeof parsed.id !== "string"
      || !Number.isInteger(parsed.pid)
      || typeof parsed.acquiredAt !== "string"
      || typeof parsed.databasePath !== "string"
      || canonicalDatabasePath(parsed.databasePath) !== canonicalDatabasePath(databasePath)
    ) {
      return undefined;
    }
    return { ...parsed, leasePath } as DatabaseWriterLease;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}
