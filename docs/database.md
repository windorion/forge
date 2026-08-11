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

Schema v5 adds `task_history_purges`, an append-only metadata table for
explicit command-output purges. The receipt records task, scope, export time,
source hash, purge time, affected-record count, removed-byte count, and the
same bounded receipt JSON retained on the task snapshot. Task replacement and
receipt insertion share one SQLite transaction.

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

- Keep task history by default. There is no timer, age threshold, background
  cleanup, or startup purge while product retention policy is undecided.
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
- Allow users to delete workspace memory.
- Respect `.gitignore` and future Forge ignore rules.
- Do not retain sensitive command output forever without controls.

Still undecided: default retention duration, workspace-wide purge, event/tool
history compaction, export/purge of repository memory, and commercial privacy
policy. The current implementation deliberately does not infer those choices.

## Migration Rules

- Database migrations are ordered in `runtime/src/databaseMigrations.ts` and
  recorded individually in `schema_migrations` only after their transaction
  commits.
- Every migration must declare `safety: Additive` or `safety: Destructive`.
  The registry must be contiguous from version 1; missing safety, gaps,
  mismatched recorded names, and newer unsupported versions fail closed.
- Writable primary runtimes migrate missing supported versions in order.
  Immediately prior schema v4 is rehearsed in `task-store-test.mjs`: the v5
  receipt table is recreated while the existing task payload survives.
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
- Schema v5 remains additive; the destructive v6 used by tests is an isolated
  fixture, not a shipped product migration. `database-backup-test.mjs` covers
  the failure matrix, and `smoke:database-recovery` exercises the actual CLI.
- Migrations must remain reversible when practical even though verified backup
  is mandatory for every destructive classification.
- Migration backups, stale writer-lease evidence, displaced databases, and
  restore receipts are not automatically deleted while workspace retention is
  undecided. They can contain complete private task history and require an
  explicit future retention/cleanup policy.
