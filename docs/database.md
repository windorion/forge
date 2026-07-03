# Database Design

Document role: record the local persistence model, conceptual schema, and data
retention rules for Forge.

## Database Principle

SQLite is the default local database. It should store the durable memory of the
workspace and make agent work resumable and auditable.

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
- content
- created at

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
