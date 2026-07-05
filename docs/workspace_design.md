# Workspace Design

Document role: record the product surface, information architecture, screen
responsibilities, and interaction rules for the Forge workspace.

## Design Principle

The workspace should make agent work legible.

The user should never wonder:

- what is happening
- why it is happening
- what changed
- whether it is safe
- what to do next

## Main Workspace Regions

### Task Header

Responsibilities:

- task title
- task status
- repository
- branch
- current phase
- primary action

Examples of primary actions:

- approve plan
- pause run
- review diff
- apply changes
- commit

### Planner Panel

Responsibilities:

- plan steps
- active step
- completed steps
- blocked steps
- rationale
- current plan revision
- plan revision history
- user approval points

The planner is not a decorative checklist. It is the user's map of what the
agent intends to do.

### Agent Status Panel

Responsibilities:

- active agent
- queued agents
- current tool call
- elapsed time
- status
- recent events

Minimum agents to display:

- Manager
- Planner
- Coder
- Tester
- Reviewer

### Terminal Panel

Responsibilities:

- command output
- command status
- exit code
- test results
- rerun controls

Terminal output should be readable, searchable, and linked to the task run.

### Diff Panel

Responsibilities:

- changed files
- inline diff
- change summary
- proposal revision history
- accept/reject controls
- file-level notes

The diff panel is one of the highest-trust surfaces in the product.

### Chat Panel

Responsibilities:

- task-scoped conversation
- clarifying questions
- user instructions
- explanations
- follow-up requests
- structured intent brief
- plan revision request

Chat is a supporting surface. It should not dominate the product.

### Memory Panel

Responsibilities:

- relevant project rules
- previous decisions
- task context
- linked documents
- repository notes

Memory should be inspectable and editable over time.

## Navigation Model

Primary navigation should be task-centered:

- Inbox or active tasks
- Current workspace
- History
- Repositories
- Memory
- Settings

Secondary navigation can expose:

- files
- commits
- runs
- logs
- docs

## Task States

Core states:

- Created
- Planning
- Waiting for approval
- Running
- Testing
- Waiting for review
- Completed
- Failed
- Archived

Each state should have a clear primary action.

## Interaction Rules

- Always show current task state.
- Always show changed files before approval.
- Always require a fresh approval when task conversation changes the active
  plan.
- Always preserve rejected edit proposals when a revised proposal replaces
  them.
- Always show command logs for commands run by agents.
- Never hide failures behind generic status.
- Use native macOS controls where appropriate.
- Make keyboard workflows first-class.
- Avoid UI that implies the app is an IDE clone.

## MVP Workspace

The first useful workspace can include:

- left task list
- center planner and run stream
- right diff/review panel
- bottom terminal output
- compact chat input

The exact layout can change, but the hierarchy should not: task and review are
more important than chat.
