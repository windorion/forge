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
- It stores compact context summaries on the task rather than building a
  durable full-text or symbol index.
- It records search mode, engine, budgets, inspected/new paths and a normalized
  request fingerprint; repeats and zero-new-context steps are blocked.
- It persists query coverage, matched lines/files, context byte totals, content
  hashes, and a Strong/Partial/Weak/NoNewContext result-quality rating without
  building or uploading a durable remote index.

Still future work:

- persistent file-tree index
- Tree-sitter symbol extraction
- dependency graph hints
- semantic search and embeddings
- incremental re-indexing

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
