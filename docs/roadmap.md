# Roadmap

Document role: record sequencing, milestones, proof points, and what should
not be built too early.

## Roadmap Principle

Forge should prove one narrow workflow deeply before becoming broad.

## Phase 0: Documentation And Direction

Goal: make product memory durable.

Deliverables:

- root README constitution
- docs structure
- founder notes
- agent rules
- architecture direction

Proof point:

- a future AI or engineer can understand what Forge is without reading the
  original chat history.

## Phase 1: Native App Shell

Goal: create the first macOS workspace shell.

Deliverables:

- SwiftUI app
- main window
- task workspace layout
- settings shell
- repository picker

Proof point:

- user can open a repo and see a task-centered workspace.

## Phase 2: Local Runtime

Goal: run a local agent runtime process and stream events to the app.

Deliverables:

- TypeScript runtime
- app-runtime communication
- task API
- event stream
- local persistence

Proof point:

- user can create a task and see structured runtime events.

## Phase 3: Repository Context

Goal: understand a local repository.

Deliverables:

- repo scanner
- file search
- ripgrep integration
- Tree-sitter prototype
- context builder v1

Proof point:

- Forge can find relevant files for a task.

## Phase 4: Agent Execution

Goal: complete a small coding task with reviewable output.

Deliverables:

- LLM provider integration
- tool registry
- read/search/edit tools
- command runner
- validation loop

Proof point:

- Forge can modify files and produce a diff for review.

## Phase 5: Review And Git

Goal: make changes safe to accept.

Deliverables:

- diff viewer
- approval flow
- test logs
- git status
- commit preparation

Proof point:

- user can review and approve a commit-ready change.

## Phase 6: Memory And Local Index

Goal: make Forge remember project context.

Deliverables:

- SQLite schema
- task history
- project memory
- local index metadata
- semantic search prototype

Proof point:

- Forge can reuse prior project decisions in a new task.

## Phase 7: Multi-Agent UX

Goal: expose specialized roles without overcomplicating runtime.

Deliverables:

- Manager, Planner, Coder, Tester, Reviewer states
- role-specific prompts
- handoff summaries
- agent status UI

Proof point:

- user can understand which role is doing what.

## Phase 8: macOS Native Layer

Goal: prove the Mac-native wedge.

Deliverables:

- menu bar item
- global shortcut
- notifications
- Dock progress
- open in IDE

Proof point:

- user can start or resume agent work outside the main app window.

## Phase 9: Integrations

Goal: connect Forge to external workflows safely.

Deliverables:

- MCP discovery
- GitHub integration
- issue or PR handoff
- tool permissions

Proof point:

- Forge can prepare a PR or issue update with explicit approval.

## Phase 10: Release

Goal: distribute a trustworthy Mac app.

Deliverables:

- signing
- notarization
- DMG
- Sparkle updates
- website download flow

Proof point:

- a user can install, update, and run Forge outside the developer machine.

## Do Not Build Too Early

- full IDE replacement
- debugger
- marketplace
- enterprise admin console
- complex team collaboration
- every MCP integration
- visual theming system

These can come later after the task-to-review loop works.
