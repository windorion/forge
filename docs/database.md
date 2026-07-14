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
resume lineage, and stop reason. Edit proposal snapshots retain changeset
transaction phase, per-file hashes/snapshots, verification timestamps,
recovery phase, summary, and errors.

This is intentionally smaller than the full conceptual schema below. Future
migrations should split runs, messages, tool calls, commands, file changes,
and approvals into dedicated auditable tables.

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

- Keep task history by default.
- Allow users to delete workspace memory.
- Allow users to purge command logs.
- Respect `.gitignore` and future Forge ignore rules.
- Do not retain sensitive command output forever without controls.

## Migration Rules

- Database migrations must be versioned.
- Migrations must be reversible when practical.
- Backups should be considered before destructive migrations.
