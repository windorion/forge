export interface DatabaseMigration {
  version: number;
  name: string;
  safety: "Additive" | "Destructive";
  sql: string;
}

export const DATABASE_SCHEMA_VERSION = 5;

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: "create_task_store",
    safety: "Additive",
    sql: `
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
    `
  },
  {
    version: 2,
    name: "create_repo_index",
    safety: "Additive",
    sql: `
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
    `
  },
  {
    version: 3,
    name: "create_repo_symbols",
    safety: "Additive",
    sql: `
      CREATE TABLE IF NOT EXISTS repo_symbols (
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        line INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_repo_symbols_name ON repo_symbols(name);
      CREATE INDEX IF NOT EXISTS idx_repo_symbols_path ON repo_symbols(path);
    `
  },
  {
    version: 4,
    name: "create_repo_trigrams",
    safety: "Additive",
    sql: `
      CREATE TABLE IF NOT EXISTS repo_trigrams (
        path TEXT NOT NULL,
        trigram TEXT NOT NULL,
        PRIMARY KEY (path, trigram)
      );

      CREATE INDEX IF NOT EXISTS idx_repo_trigrams_trigram ON repo_trigrams(trigram);
    `
  },
  {
    version: 5,
    name: "create_task_history_purge_receipts",
    safety: "Additive",
    sql: `
      CREATE TABLE IF NOT EXISTS task_history_purges (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        exported_at TEXT NOT NULL,
        export_source_sha256 TEXT NOT NULL,
        purged_at TEXT NOT NULL,
        records_affected INTEGER NOT NULL,
        bytes_removed INTEGER NOT NULL,
        details_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_history_purges_task_id
      ON task_history_purges(task_id, purged_at DESC);
    `
  }
];
