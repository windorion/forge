# Database Design

Document role: record the local persistence model, conceptual schema, and data
retention rules for Forge.

## Database Principle

SQLite is the default local database. It should store the durable memory of the
workspace and make agent work resumable and auditable.

## Current Implementation

The first runtime persistence slice stores task snapshots in local SQLite at
`.forge/forge.sqlite` by default. The current `tasks` table records basic task
index fields and a full JSON payload so the app can recover task state,
events, tool calls, validation runs, context files, approval history,
task conversation messages, plan revisions, execution proposals, edit
proposals, edit proposal revisions, edit proposal validations, edit proposal
decisions, Agent Run Steps/Loops, repository-inspection budgets/outcomes, and
review state after a runtime restart. Agent Run Loop snapshots retain linked
step IDs, preferred command intent, cooperative control state/timestamps/note,
resume lineage, and stop reason. A queued task snapshot additionally retains
its request ID, enqueue timestamp, normalized position, bounded step count,
optional known command preference, optional resume-loop lineage, and the prior
task status/phase needed for safe removal. Queue concurrency settings are
small repository-local configuration in `.forge/task-queue.json`, not a new
database authority; `FORGE_TASK_QUEUE_SETTINGS_PATH` can isolate that file in
tests. Edit proposal snapshots retain changeset
transaction phase, per-file hashes/snapshots, verification timestamps,
recovery phase, summary, and errors.

Task snapshots also retain an optional task-level cancellation record with a
stable ID, `Requested`/`Completed` status, request/completion timestamps, user
note, queue/Agent Loop/task-command/validation dispositions, and summary. A
persisted request is completed after startup recovery has made every
interrupted item terminal. `Cancelled` is a durable task terminal state;
retained plan, edit, command, validation, and event evidence is not deleted.

Audit exports do not create a second persistence authority. The runtime builds
versioned Markdown or JSON on demand from the current task snapshot, selects
auditable metadata, omits proposal diff bodies/provider configuration, and
redacts known credential patterns before returning the file envelope. The
envelope now includes SHA-256 for the exported content and the exact source
task snapshot plus its `updatedAt`, forming a revision-bound export receipt.

Task upsert also applies Secret Redaction policy v1 to persistence-facing
evidence fields before JSON serialization. Command chunks/summaries are already
sanitized before entering live task state; the store adds defense in depth for
events, approvals, tool/run/repair summaries, cancellation notes, and PR
refresh summaries. It intentionally does not rewrite task objectives/messages
or executable reviewed proposal bodies: the former remain private task content
covered by retention/export policy, and mutating the latter would invalidate
human review and restart correctness.

Schema v5 adds `task_history_purges`, an append-only metadata table for
explicit command-output purges. The receipt records task, scope, export time,
source hash, purge time, affected-record count, removed-byte count, and the
same bounded receipt JSON retained on the task snapshot. Task replacement and
receipt insertion share one SQLite transaction.

Schema v6 adds `workspace_history_purges`, the append-only receipt authority for
policy `forge-workspace-retention` v1. A receipt binds exact scopes, policy
version, export timestamp, source/content SHA-256, per-scope task/index record
counts, estimated logical bytes removed, unfinished records preserved, and the
full bounded receipt JSON. Terminal-task replacements, selected repository-index
table clears, and receipt insertion share one `BEGIN IMMEDIATE` transaction.

This is intentionally smaller than the full conceptual schema below. Future
migrations should split runs, messages, tool calls, commands, file changes,
and approvals into dedicated auditable tables.

Mission Control observer runtimes open an existing task database with SQLite's
read-only option. If a registered repository has no Forge database, the
observer uses a temporary in-memory empty schema and does not create `.forge`.
Observer GET requests reload committed task payloads so another authorized
runtime's changes become visible, while all save operations fail closed.

## Core Entities

### Workspaces

Records selected repositories.

Fields:

- id
- name
- path
- git root
- created at
- last opened at
- index status

### Tasks

Records user work items.

Fields:

- id
- workspace id
- title
- objective
- status
- current phase
- created at
- updated at
- completed at

### Runs

Records each execution attempt for a task.

Fields:

- id
- task id
- status
- started at
- ended at
- model provider
- model name
- summary

### Messages

Stores user and assistant-visible task conversation.

Fields:

- id
- task id
- role
- kind
- content
- provider
- intent brief
- file references
- created at

### Message File References

Stores repo-local files mentioned in task messages.

Fields:

- id
- message id
- requested path
- resolved path
- status
- summary
- byte size
- line count
- line start
- line end
- detected at

### Plan Revisions

Stores reviewable plans generated from task conversation updates.

Fields:

- id
- task id
- provider
- source message id
- intent summary
- summary
- rationale
- risk level
- revised plan steps
- expected file areas
- validation plan
- risk notes
- estimated minutes
- estimated cost USD
- generated at

### Edit Proposal Revisions

Stores current and previous edit proposals generated before file mutation.

Fields:

- id
- task id
- provider
- source message id
- revision number
- previous proposal id
- summary
- proposed file changes
- diff previews
- validation result
- latest changeset transaction and recovery evidence
- status
- decided at
- decision note
- generated at

### Tool Calls

Stores tool execution history.

Fields:

- id
- run id
- tool name
- input summary
- output summary
- status
- started at
- ended at
- risk level

### Commands

Stores terminal commands.

Fields:

- id
- run id
- command
- cwd
- exit code
- stdout path or text
- stderr path or text
- started at
- ended at

### Validation Runs

Stores post-apply validation attempts.

Fields:

- id
- task id
- trigger
- preset id
- preset name
- preset source
- risk level
- status
- summary
- started at
- ended at

### Validation Command Results

Stores command-level validation outcomes.

Fields:

- id
- validation run id
- name
- command
- kind
- cwd
- risk level
- status
- exit code
- output summary
- started at
- ended at

### File Changes

Stores file-level edit metadata.

Fields:

- id
- run id
- path
- change type
- diff summary
- applied
- created at

### Approvals

Stores human approval decisions.

Fields:

- id
- task id
- action type
- target id
- requested summary
- decision
- decided at
- user note

### Memory Items

Stores durable project memory.

Fields:

- id
- workspace id
- type
- title
- content
- source
- created at
- updated at

### Index Records

Stores local index metadata.

Fields:

- id
- workspace id
- path
- language
- hash
- indexed at
- symbol count

## Vector Storage

If sqlite-vec is used, embeddings should link to:

- files
- symbols
- memory items
- task summaries

Do not embed secrets or ignored files.

## Retention Rules

- Policy `forge-workspace-retention` v1 keeps task and workspace history
  indefinitely by default. There is no timer, age threshold, background
  cleanup, or startup purge; `automaticPurge` is explicitly false.
- Each task-command run is already bounded to at most 80 output chunks and
  24,000 retained characters; each chunk is at most 4,000 characters.
- `GET /tasks/:taskID/history-retention-preview` reports the current local
  policy and exactly how many command/validation records, chunks, and bytes
  can be removed.
- `POST /tasks/:taskID/purge-history` supports only `CommandOutput` and only
  for Completed, Failed, or Cancelled tasks. It requires the exact
  `PurgeTaskHistory` confirmation, current task `updatedAt`, and a SHA-256
  receipt from a current audit export. Stale or fabricated receipts fail
  before mutation.
- Command-output purge removes task-command chunks and command/validation
  output summaries. It preserves task state, commands, statuses, exit codes,
  timestamps, approvals, events, proposal evidence, and a durable purge
  receipt. The macOS Audit surface unlocks the action only after the user has
  actually saved the current export in that app session.
- Workspace scope is exact and ordered: `TaskEvents`, `ToolCalls`,
  `TaskMessages`, and `RepositoryIndexes`. `GET
  /workspace/history-retention-preview` reports retained/removable records,
  estimated removable bytes, records protected because their tasks are not
  terminal, and prior receipt count per selected scope.
- `GET /workspace/history-export` returns deterministic JSON under Secret
  Redaction v1 plus policy/scopes, generated time, source/content SHA-256, all
  selected evidence for both terminal and unfinished tasks, full indexed-file
  and symbol metadata, and an exact digest/count for rebuildable trigram
  postings. It is portable audit evidence, not an automatic restore bundle.
- `POST /workspace/purge-history` requires `PurgeWorkspaceHistory`, active
  policy version, exact selected scopes, and a matching saved-export receipt.
  It recomputes source and content hashes at the original export timestamp;
  stale, forged, differently scoped, or differently versioned receipts fail
  before mutation.
- Workspace purge removes selected task arrays only from Completed, Failed, or
  Cancelled tasks. It never rewrites an unfinished task's events, tool calls,
  messages, objective, or other evidence. Repository index files, symbols,
  trigrams, and metadata are rebuildable derived data and may be cleared when
  explicitly selected; the index then reports rebuild required.
- Primary runtime commits all changed task snapshots, selected index clears,
  and one append-only schema-v6 receipt atomically. Observer runtimes may
  preview and export committed state but reject purge as a mutation.
- Respect `.gitignore` and future Forge ignore rules.
- Do not retain sensitive command output forever without controls.
- Secret Redaction v1 reduces credential exposure before retention, but does
  not make arbitrary private repository/task prose safe to share. The save
  panel and export metadata require user review before distribution.

Still undecided: commercial privacy language, hosted-account deletion SLAs,
semantic-memory retention once that product exists, and explicit cleanup for
migration backups/rescue artifacts. Policy v1 deliberately makes no cloud or
commercial promise.

## Migration Rules

- Database migrations are ordered in `runtime/src/databaseMigrations.ts` and
  recorded individually in `schema_migrations` only after their transaction
  commits.
- Every migration must declare `safety: Additive` or `safety: Destructive`.
  The registry must be contiguous from version 1; missing safety, gaps,
  mismatched recorded names, and newer unsupported versions fail closed.
- Writable primary runtimes migrate missing supported versions in order.
  Prior schema v4 and v5 states are rehearsed in `task-store-test.mjs`: v5 and
  v6 receipt tables are recreated while existing task payloads survive.
- Read-only observers never migrate. They reject an older database with an
  actionable instruction to start the primary runtime first, then open the
  migrated database normally.
- A database with a newer schema or a mismatched recorded migration name fails
  closed rather than guessing.
- Writable stores hold one owner-only writer lease beside the database.
  Concurrent read-only observers remain supported, but a second writer fails
  before opening SQLite. Clean shutdown releases the lease; startup preserves
  a stale lease as evidence before replacing it.
- Before any migration classified `Destructive`, the runner uses parameterized
  SQLite `VACUUM INTO` to create a transactionally consistent snapshot under
  `database-backups/`. It verifies source and backup integrity, schema version,
  task count, byte count, SHA-256, and the actual `PRAGMA database_list` source
  path, then writes an owner-only versioned JSON manifest. Backup failure means
  the destructive transaction is never begun.
- Each migration still runs in its own `BEGIN IMMEDIATE` transaction. A failed
  destructive transaction rolls back its SQL and leaves the verified backup
  manifest available for diagnosis.
- Offline recovery uses `npm run database:restore -- <manifest> <database>
  RestoreForgeDatabaseBackup`. Restore rejects the wrong target, confirmation,
  missing/corrupt manifest or backup, live writer lease, and non-empty WAL. It
  prepares and verifies a same-directory copy before atomically replacing the
  target, preserves the displaced database as a rescue artifact, verifies the
  final database again, and writes a restore receipt.
- Schemas v5 and v6 remain additive; the destructive v7 used by tests is an isolated
  fixture, not a shipped product migration. `database-backup-test.mjs` covers
  the failure matrix, and `smoke:database-recovery` exercises the actual CLI.
- Migrations must remain reversible when practical even though verified backup
  is mandatory for every destructive classification.
- Migration backups, stale writer-lease evidence, displaced databases, and
  restore receipts are outside workspace policy v1 and are not automatically
  deleted. They can contain complete private task history and require a
  separate explicit artifact-cleanup policy.
