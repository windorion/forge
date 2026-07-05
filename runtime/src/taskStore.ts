import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ForgeTask } from "./types.js";

const SCHEMA_VERSION = 1;

export class SqliteTaskStore {
  readonly dbPath: string;

  private readonly db: DatabaseSync;
  private readonly selectTasks: StatementSync;
  private readonly upsertTask: StatementSync;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new DatabaseSync(dbPath);
    this.applySchema();
    this.selectTasks = this.db.prepare("SELECT payload_json FROM tasks ORDER BY updated_at DESC");
    this.upsertTask = this.db.prepare(`
      INSERT INTO tasks (
        id,
        title,
        objective,
        status,
        current_phase,
        created_at,
        updated_at,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        objective = excluded.objective,
        status = excluded.status,
        current_phase = excluded.current_phase,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `);
  }

  loadTasks(): ForgeTask[] {
    return this.selectTasks.all().map((row) => parseTaskPayload(row.payload_json));
  }

  saveTask(task: ForgeTask): void {
    this.upsertTask.run(
      task.id,
      task.title,
      task.objective,
      task.status,
      task.currentPhase,
      task.createdAt,
      task.updatedAt,
      JSON.stringify(task)
    );
  }

  close(): void {
    this.db.close();
  }

  private applySchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        current_phase TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);

      INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
      VALUES (${SCHEMA_VERSION}, 'create_task_store', datetime('now'));
    `);
  }
}

function parseTaskPayload(payload: unknown): ForgeTask {
  if (typeof payload !== "string") {
    throw new Error("Invalid task payload in SQLite store.");
  }

  const parsed = JSON.parse(payload) as ForgeTask;
  return {
    ...parsed,
    approvals: parsed.approvals ?? [],
    validationRuns: (parsed.validationRuns ?? []).map((run) => ({
      ...run,
      presetID: run.presetID ?? "forge-post-apply",
      presetName: run.presetName ?? "Forge Post-Apply Checks",
      presetSource: run.presetSource ?? "BuiltIn",
      riskLevel: run.riskLevel ?? "Low",
      commands: run.commands ?? []
    })),
    messages: (parsed.messages ?? []).map((message) => ({
      ...message,
      fileReferences: message.fileReferences ?? []
    })),
    planRevisions: parsed.planRevisions ?? [],
    editProposalRevisions: (parsed.editProposalRevisions ?? []).map((proposal, index) => ({
      ...proposal,
      revisionNumber: proposal.revisionNumber ?? index + 1
    })),
    executionProposal: parsed.executionProposal,
    editProposal: parsed.editProposal
      ? {
          ...parsed.editProposal,
          revisionNumber: parsed.editProposal.revisionNumber ?? 1
        }
      : undefined
  };
}
