# Local-First Architecture

Document role: record the privacy, indexing, local memory, and context strategy
that make Forge trustworthy for real repositories.

## Local-First Thesis

Forge should keep development context local whenever possible. Local-first is
not only a privacy feature. It also improves speed, reliability, and durable
project memory.

## Local Data

Data that should be local by default:

- workspace list
- repository metadata
- task history
- run history
- tool calls
- command logs
- file references
- approvals
- project memory
- code index
- embeddings when practical
- context cache

Task and workspace history follow `forge-workspace-retention` v1: keep
indefinitely by default, never auto-purge, and require a saved deterministic
export before explicit deletion. Task-level command-output purge remains
available for terminal tasks. Workspace preview/export covers task events,
tool calls, task messages, and repository indexes; exports remain local, apply
Secret Redaction v1, bind policy/scopes and source/content SHA-256, preserve all
unfinished-task evidence, and represent rebuildable trigram postings with an
exact digest. Workspace purge mutates terminal-task arrays only, optionally
clears selected index tables, preserves unfinished tasks, and commits an
append-only schema-v6 receipt atomically. Observers can preview/export but not
purge. Commercial privacy periods, hosted deletion, semantic memory, and backup
artifact cleanup remain separate product decisions rather than inferred
promises.

Migration recovery remains local as well. Destructive migrations create an
owner-only SQLite snapshot and JSON manifest beside the local database; no
backup data is uploaded. Offline restore validates the local SHA-256, schema,
task count, writer lease, WAL state, and exact target before replacement, keeps
the displaced database, and writes a local receipt. These artifacts may include
the complete private task history and inherit the same non-sharing boundary.

## Repository Indexing

Indexer should collect:

- file tree
- language distribution
- git root
- package manager
- test commands
- symbols
- imports
- references
- dependency hints

Current implementation:

- Agent Loop v0 has bounded runtime-owned read-only repository inspection.
- It skips private/generated directories such as `.git`, `.forge`,
  `node_modules`, `.build`, `.swiftpm`, and `dist`.
- It scans a limited set of source, config, script, and documentation file
  types, then scores matches from task-derived search terms.
- A durable file-tree index now persists in SQLite (repo_index table): each
  indexed file records language, byte size, line count, and a content hash,
  with incremental re-indexing (unchanged files skipped by hash, deleted files
  removed) and a repo_index_meta row. GET /index and POST /index/rebuild
  expose status/rebuild; the app builds it on connect and shows the real file
  count in the 1a footer. It stores compact per-task context summaries in
  addition to this durable index.
- Lightweight symbol extraction now persists in SQLite (repo_symbols table,
  schema v3): a dependency-free per-language-family regex extractor
  (runtime/src/symbolExtract.ts) records top-level declarations
  (function/class/struct/enum/interface/type/...) with their line, extracted on
  (re)index and backfilled for files that predate it. GET /index/symbols?q=
  gives exact-match-first name lookup. This is deliberately not a full parser —
  it trades some precision for zero native dependencies, keeping the runtime
  pure Node.
- The agent's `Symbol` inspection mode is index-backed: it looks up declaration
  sites in repo_symbols (restricted to the safe bounded file set) and merges the
  live scan on top, so it returns exact `kind name` locations and works even
  when ripgrep is unavailable (runtime/src/symbolSearch.ts).
- A durable text (trigram) index now persists in SQLite (repo_trigrams table,
  schema v4): distinct case-folded within-line 3-grams per file
  (runtime/src/textIndex.ts) form an inverted index. The agent's `Text`
  inspection mode is index-backed — when the index covers the current scan set
  and every term is at least a trigram long, the index narrows the scan to
  candidate files (runtime/src/textSearch.ts) that the live scan then verifies,
  so there are no false positives and the coverage gate avoids false negatives.
  It works with or without ripgrep, and degrades to the full scan when the index
  is not applicable. On the Forge repo this narrows ~130 files to ~14 candidates
  for a typical identifier.
- It records search mode, engine, budgets, inspected/new paths and a normalized
  request fingerprint; repeats and zero-new-context steps are blocked.
- It persists query coverage, matched lines/files, context byte totals, content
  hashes, and a Strong/Partial/Weak/NoNewContext result-quality rating without
  building or uploading a durable remote index.

Still future work:

- richer symbol parsing (Tree-sitter or language servers) if the regex
  extractor's precision proves insufficient
- reference/imports graph and dependency hints
- content-freshness gating for the trigram narrowing (today it gates on
  file-set coverage; mid-session edits to an already-indexed file are a small
  residual staleness risk until the next re-index)
- semantic search and embeddings

Potential tools:

- ripgrep
- Tree-sitter
- language servers
- git
- package manager metadata

## Context Builder

The context builder should answer:

- which files matter?
- which symbols matter?
- what changed recently?
- what did the user ask?
- what project rules apply?
- what previous decisions matter?

Context should be ranked, not dumped.

## Embeddings

Embeddings can support semantic code search and memory recall.

Preferred direction:

- local vector store
- local embeddings if quality and speed are acceptable
- cloud embeddings only with clear user consent and provider settings

Candidate storage:

- sqlite-vec
- LanceDB
- other local vector databases

## Privacy Rules

- Do not upload whole repositories by default.
- Do not send private files to remote tools without purpose.
- Make provider behavior visible.
- Allow users to inspect what context is sent.
- Keep task history local.

## Offline Behavior

Forge should still be useful when offline for:

- browsing tasks
- reviewing history
- inspecting diffs
- searching local indexes
- reading memory

Agent execution that requires cloud LLMs can be unavailable, but the workspace
should not become empty.
