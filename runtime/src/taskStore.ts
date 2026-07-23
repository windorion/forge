import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ForgeTask } from "./types.js";
import type { IndexedFile } from "./repositoryIndex.js";
import type { ExtractedSymbol } from "./symbolExtract.js";

const SCHEMA_VERSION = 3;

export type StoredSymbol = ExtractedSymbol & { path: string };

export class SqliteTaskStore {
  readonly dbPath: string;

  private readonly db: DatabaseSync;
  private readonly selectTasks: StatementSync;
  private readonly upsertTask?: StatementSync;
  private readonly readOnly: boolean;

  constructor(dbPath: string, options: { readOnly?: boolean } = {}) {
    this.dbPath = dbPath;
    this.readOnly = options.readOnly === true;
    const existingReadOnlyDatabase = this.readOnly && existsSync(dbPath);
    if (!this.readOnly) {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.db = existingReadOnlyDatabase
      ? new DatabaseSync(dbPath, { readOnly: true })
      : this.readOnly
        ? new DatabaseSync(":memory:")
        : new DatabaseSync(dbPath);
    if (!existingReadOnlyDatabase) {
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
    }
  }

  loadTasks(): ForgeTask[] {
    return this.selectTasks.all().map((row) => parseTaskPayload(row.payload_json));
  }

  saveTask(task: ForgeTask): void {
    if (!this.upsertTask) {
      throw new Error("Task store is read-only in observer runtime mode.");
    }
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

      CREATE TABLE IF NOT EXISTS repo_index (
        path TEXT PRIMARY KEY,
        language TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        line_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_repo_index_language ON repo_index(language);

      CREATE TABLE IF NOT EXISTS repo_index_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_indexed_at TEXT,
        git_root TEXT
      );

      CREATE TABLE IF NOT EXISTS repo_symbols (
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        line INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_repo_symbols_name ON repo_symbols(name);
      CREATE INDEX IF NOT EXISTS idx_repo_symbols_path ON repo_symbols(path);

      INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
      VALUES (1, 'create_task_store', datetime('now'));
      INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
      VALUES (2, 'create_repo_index', datetime('now'));
      INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
      VALUES (3, 'create_repo_symbols', datetime('now'));
    `);
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
