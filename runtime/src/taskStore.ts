import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ForgeTask, TaskHistoryPurgeReceipt } from "./types.js";
import type { IndexedFile } from "./repositoryIndex.js";
import type { ExtractedSymbol } from "./symbolExtract.js";
import { DATABASE_MIGRATIONS, DATABASE_SCHEMA_VERSION } from "./databaseMigrations.js";
import { applyDatabaseMigrations, validateDatabaseSchema } from "./databaseMigrationRunner.js";
import { redactTaskPersistenceSurfaces } from "./security/secretRedaction.js";
import {
  acquireDatabaseWriterLease,
  releaseDatabaseWriterLease,
  type DatabaseWriterLease
} from "./databaseWriterLease.js";

export type StoredSymbol = ExtractedSymbol & { path: string };

export class SqliteTaskStore {
  readonly dbPath: string;

  private readonly db!: DatabaseSync;
  private readonly selectTasks: StatementSync;
  private readonly upsertTask?: StatementSync;
  private readonly insertHistoryPurge?: StatementSync;
  private readonly readOnly: boolean;
  private readonly writerLease?: DatabaseWriterLease;

  constructor(dbPath: string, options: { readOnly?: boolean } = {}) {
    this.dbPath = dbPath;
    this.readOnly = options.readOnly === true;
    const existingReadOnlyDatabase = this.readOnly && existsSync(dbPath);
    if (!this.readOnly) {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.writerLease = this.readOnly ? undefined : acquireDatabaseWriterLease(dbPath);
    try {
      this.db = existingReadOnlyDatabase
        ? new DatabaseSync(dbPath, { readOnly: true })
        : this.readOnly
          ? new DatabaseSync(":memory:")
          : new DatabaseSync(dbPath);
      if (existingReadOnlyDatabase) {
        this.validateSchema();
      } else {
        this.applySchema();
      }
      this.selectTasks = this.db.prepare("SELECT payload_json FROM tasks ORDER BY updated_at DESC");
      if (!this.readOnly) {
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
        this.insertHistoryPurge = this.db.prepare(`
        INSERT INTO task_history_purges (
          id, task_id, scope, exported_at, export_source_sha256,
          purged_at, records_affected, bytes_removed, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
      }
    } catch (error) {
      this.db?.close();
      releaseDatabaseWriterLease(this.writerLease);
      throw error;
    }
  }

  loadTasks(): ForgeTask[] {
    return this.selectTasks.all().map((row) => parseTaskPayload(row.payload_json));
  }

  saveTask(task: ForgeTask): void {
    if (!this.upsertTask) {
      throw new Error("Task store is read-only in observer runtime mode.");
    }
    this.runTaskUpsert(task);
  }

  saveTaskWithHistoryPurge(task: ForgeTask, receipt: TaskHistoryPurgeReceipt): void {
    if (!this.upsertTask || !this.insertHistoryPurge) {
      throw new Error("Task store is read-only in observer runtime mode.");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.runTaskUpsert(task);
      this.insertHistoryPurge.run(
        receipt.id,
        task.id,
        receipt.scope,
        receipt.exportedAt,
        receipt.exportSourceSha256,
        receipt.purgedAt,
        receipt.recordsAffected,
        receipt.bytesRemoved,
        JSON.stringify(receipt)
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  loadTaskHistoryPurgeReceipts(taskID: string): TaskHistoryPurgeReceipt[] {
    return this.db
      .prepare("SELECT details_json FROM task_history_purges WHERE task_id = ? ORDER BY purged_at")
      .all(taskID)
      .map((row) => JSON.parse(String(row.details_json)) as TaskHistoryPurgeReceipt);
  }

  schemaStatus(): { currentVersion: number; expectedVersion: number; migrations: Array<{ version: number; name: string; appliedAt: string }> } {
    const migrations = this.db
      .prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => ({
        version: Number(row.version),
        name: String(row.name),
        appliedAt: String(row.applied_at)
      }));
    return {
      currentVersion: migrations.at(-1)?.version ?? 0,
      expectedVersion: DATABASE_SCHEMA_VERSION,
      migrations
    };
  }

  private runTaskUpsert(task: ForgeTask): void {
    const persistedTask = redactTaskPersistenceSurfaces(task);
    this.upsertTask!.run(
      persistedTask.id,
      persistedTask.title,
      persistedTask.objective,
      persistedTask.status,
      persistedTask.currentPhase,
      persistedTask.createdAt,
      persistedTask.updatedAt,
      JSON.stringify(persistedTask)
    );
  }

  close(): void {
    try {
      this.db.close();
    } finally {
      releaseDatabaseWriterLease(this.writerLease);
    }
  }

  private applySchema(): void {
    applyDatabaseMigrations(this.db, this.dbPath);
    this.validateSchema();
  }

  private validateSchema(): void {
    validateDatabaseSchema(this.db, DATABASE_MIGRATIONS, { readOnly: this.readOnly });
  }

  /** Replace all symbol rows for one file (called when the file is (re)indexed). */
  replaceSymbolsForFile(filePath: string, symbols: ExtractedSymbol[]): void {
    this.requireWritable();
    this.db.prepare("DELETE FROM repo_symbols WHERE path = ?").run(filePath);
    const insert = this.db.prepare("INSERT INTO repo_symbols (path, kind, name, line) VALUES (?, ?, ?, ?)");
    for (const symbol of symbols) {
      insert.run(filePath, symbol.kind, symbol.name, symbol.line);
    }
  }

  removeSymbolsForFile(filePath: string): void {
    this.requireWritable();
    this.db.prepare("DELETE FROM repo_symbols WHERE path = ?").run(filePath);
  }

  hasSymbolsForFile(filePath: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM repo_symbols WHERE path = ? LIMIT 1").get(filePath);
    return row !== undefined;
  }

  countSymbols(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM repo_symbols").get();
    return row ? Number(row.n) : 0;
  }

  /** Case-insensitive prefix (or substring) symbol lookup by name. */
  searchSymbols(query: string, limit = 50): StoredSymbol[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const like = `%${trimmed.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.db
      .prepare(`
        SELECT path, kind, name, line FROM repo_symbols
        WHERE name LIKE ? ESCAPE '\\'
        ORDER BY (LOWER(name) = LOWER(?)) DESC, LENGTH(name), name
        LIMIT ?
      `)
      .all(like, trimmed, limit);
    return rows.map((row) => ({
      path: String(row.path),
      kind: String(row.kind),
      name: String(row.name),
      line: Number(row.line)
    }));
  }

  /** Replace all trigram rows for one file (called when the file is (re)indexed). */
  replaceTrigramsForFile(filePath: string, trigrams: string[]): void {
    this.requireWritable();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM repo_trigrams WHERE path = ?").run(filePath);
      const insert = this.db.prepare("INSERT OR IGNORE INTO repo_trigrams (path, trigram) VALUES (?, ?)");
      for (const trigram of trigrams) {
        insert.run(filePath, trigram);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  hasTrigramsForFile(filePath: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM repo_trigrams WHERE path = ? LIMIT 1").get(filePath);
    return row !== undefined;
  }

  countTrigramFiles(): number {
    const row = this.db.prepare("SELECT COUNT(DISTINCT path) AS n FROM repo_trigrams").get();
    return row ? Number(row.n) : 0;
  }

  /**
   * Files whose trigram set contains every one of the provided trigrams. This
   * is the inverted-index candidate lookup for text search; the result is a
   * superset of files actually containing the source term.
   */
  filesContainingAllTrigrams(trigrams: string[]): string[] {
    const unique = [...new Set(trigrams)];
    if (unique.length === 0) {
      return [];
    }
    const placeholders = unique.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`
        SELECT path FROM repo_trigrams
        WHERE trigram IN (${placeholders})
        GROUP BY path
        HAVING COUNT(*) = ?
      `)
      .all(...unique, unique.length);
    return rows.map((row) => String(row.path));
  }

  /** Just the indexed file paths — a cheap in-sync check for text-search narrowing. */
  indexedFilePaths(): string[] {
    return this.db.prepare("SELECT path FROM repo_index").all().map((row) => String(row.path));
  }

  loadIndexedFiles(): IndexedFile[] {
    const rows = this.db
      .prepare("SELECT path, language, byte_size, line_count, content_hash, indexed_at FROM repo_index")
      .all();
    return rows.map((row) => ({
      path: String(row.path),
      language: String(row.language),
      byteSize: Number(row.byte_size),
      lineCount: Number(row.line_count),
      contentHash: String(row.content_hash),
      indexedAt: String(row.indexed_at)
    }));
  }

  upsertIndexedFile(file: IndexedFile): void {
    this.requireWritable();
    this.db
      .prepare(`
        INSERT INTO repo_index (path, language, byte_size, line_count, content_hash, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          language = excluded.language,
          byte_size = excluded.byte_size,
          line_count = excluded.line_count,
          content_hash = excluded.content_hash,
          indexed_at = excluded.indexed_at
      `)
      .run(file.path, file.language, file.byteSize, file.lineCount, file.contentHash, file.indexedAt);
  }

  /** Remove indexed rows whose path is not in the provided set (deleted files). */
  removeIndexedFilesNotIn(paths: Set<string>): number {
    this.requireWritable();
    let removed = 0;
    for (const row of this.db.prepare("SELECT path FROM repo_index").all()) {
      const filePath = String(row.path);
      if (!paths.has(filePath)) {
        this.db.prepare("DELETE FROM repo_index WHERE path = ?").run(filePath);
        this.db.prepare("DELETE FROM repo_symbols WHERE path = ?").run(filePath);
        this.db.prepare("DELETE FROM repo_trigrams WHERE path = ?").run(filePath);
        removed += 1;
      }
    }
    return removed;
  }

  getIndexMeta(): { lastIndexedAt: string | null; gitRoot: string | null } {
    const row = this.db.prepare("SELECT last_indexed_at, git_root FROM repo_index_meta WHERE id = 1").get();
    if (!row) {
      return { lastIndexedAt: null, gitRoot: null };
    }
    return {
      lastIndexedAt: row.last_indexed_at ? String(row.last_indexed_at) : null,
      gitRoot: row.git_root ? String(row.git_root) : null
    };
  }

  setIndexMeta(meta: { lastIndexedAt: string; gitRoot: string | null }): void {
    this.requireWritable();
    this.db
      .prepare(`
        INSERT INTO repo_index_meta (id, last_indexed_at, git_root)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          last_indexed_at = excluded.last_indexed_at,
          git_root = excluded.git_root
      `)
      .run(meta.lastIndexedAt, meta.gitRoot);
  }

  private requireWritable(): void {
    if (this.readOnly) {
      throw new Error("Repository index is read-only in observer runtime mode.");
    }
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
    agentRunLoops: parsed.agentRunLoops ?? [],
    agentRunSteps: parsed.agentRunSteps ?? [],
    taskCommandRuns: (parsed.taskCommandRuns ?? []).map((run) => ({
      ...run,
      outputChunks: run.outputChunks ?? []
    })),
    historyPurges: parsed.historyPurges ?? [],
    commandRerunEvidence: parsed.commandRerunEvidence ?? [],
    validationRuns: (parsed.validationRuns ?? []).map((run) => ({
      ...run,
      presetID: run.presetID ?? "forge-post-apply",
      presetName: run.presetName ?? "Forge Post-Apply Checks",
      presetSource: run.presetSource ?? "BuiltIn",
      riskLevel: run.riskLevel ?? "Low",
      commands: run.commands ?? []
    })),
    validationRepairBriefs: (parsed.validationRepairBriefs ?? []).map((brief) => ({
      ...brief,
      source: brief.source ?? (brief.taskCommandRunID ? "TaskCommandRun" : "ValidationRun"),
      sourceSummary: brief.sourceSummary ?? (brief.taskCommandRunID ? "Task command failure" : "Validation failure")
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
