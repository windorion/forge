# Forge

> A macOS-native, agent-first, local-first software engineering workspace.

Forge is not another AI IDE, ChatGPT wrapper, or VS Code clone. Forge is a
task-centered workspace where AI agents plan, implement, test, and review
software work while the developer stays in control.

Former codename: Atlas.

## Project Memory

This README is the project's primary source of truth.

Every important product decision, architecture decision, workflow rule,
technical constraint, roadmap change, and naming decision should be added here
or updated here. When implementation details grow too large, this README should
link to a dedicated document under `docs/`, but the key decision and its status
must still be summarized here.

AI assistants working on this repository must read this README before changing
code, documentation, architecture, prompts, or product direction.

### Session Logging Rule

At the end of every working conversation, the assistant must append a session
entry to the `Session Log` section of this README.

Each session entry must include:

- timestamp with timezone
- short conversation summary
- what was done
- what was not done
- what should be done next

This turns the README into a living project memory instead of a static
document.

## Product Definition

Forge creates a new category:

> Software Engineering Workspace

The product is centered around software engineering tasks, not source code
files. The editor is one tool inside the workspace. The real product is the
agent runtime.

The developer defines intent, reviews decisions, and approves important
changes. AI agents perform implementation work.

## Core Philosophy

### Task First

Everything starts from a software engineering task.

Task lifecycle:

```text
Created
Planning
Implementation
Testing
Review
Completed
```

The UI should be organized around tasks, progress, diffs, terminal output,
agent state, and review. Chat is useful, but it is not the center of the
product.

### Agent First

The agent runtime is the product. The editor is secondary.

Forge should help agents:

- understand a repository
- build context
- plan work
- edit files
- run commands
- inspect errors
- update tests
- produce diffs
- explain changes
- ask for human approval

### Workspace First

Forge is a workspace rather than a chat app.

Core workspace surfaces:

- Tasks
- Planner
- Agent status
- Terminal
- Git
- Diff
- Memory
- Logs
- Notifications
- History
- Chat

### Human Review

Humans approve important changes.

Approval is required before:

- applying large patches
- committing changes
- pushing branches
- running dangerous shell commands
- deleting files
- changing permissions
- publishing releases

### Local First

Forge should keep sensitive development context local whenever possible.

Local-first building blocks:

- SQLite
- sqlite-vec or another local vector store
- Tree-sitter
- symbol index
- local embeddings when practical
- dependency graph
- context cache
- session history
- task memory

### macOS Native

Forge is built for macOS first. It should feel like a real Mac app, not a web
app wrapped in desktop chrome.

Prefer native macOS APIs for system integration, permissions, notifications,
menus, windows, shortcuts, background work, and file access.

## Non-Goals

Forge must not become:

- another VS Code clone
- another Cursor clone
- a generic chat app
- an editor-first product
- a cloud-only coding agent
- a product that silently changes code without review

The first version should not try to become a complete IDE. IDE-like features
can grow later if they support the agent workspace.

## Product Positioning

Forge is closer to:

```text
Claude Code
+ Raycast
+ GitHub Desktop
+ Linear
+ macOS native system integration
```

Forge should be IDE-agnostic. It can work with Cursor, VS Code, Xcode,
JetBrains IDEs, terminals, GitHub, and local repositories. The IDE is a tool;
Forge is the agent workspace.

## Target User

Forge is for developers who want AI to complete real software tasks while they
remain responsible for architecture, review, and shipping decisions.

The user acts like a tech lead:

- define intent
- set constraints
- approve plans
- review diffs
- decide what ships

The agents act like an implementation team:

- research code
- plan execution
- modify files
- run tests
- fix failures
- summarize tradeoffs
- prepare reviewable output

## Product Experience

The main workspace should make task progress visible.

Expected workspace areas:

- task title and objective
- current phase
- planner checklist
- active agents
- terminal stream
- changed files
- git diff
- review controls
- chat and clarification thread
- memory and relevant context

The user should always understand:

- what the agent is doing
- why it is doing it
- what files changed
- what commands ran
- what still needs review

## Multi-Agent Model

Minimum agents:

- Manager
- Planner
- Coder
- Tester
- Reviewer

Future agents:

- Documentation
- Security
- Database
- DevOps
- Release

The first implementation can use one runtime loop with role prompts. The
product architecture should still preserve the concept of specialized agents.

## Runtime Architecture

Core runtime modules:

- Task Queue
- Planner
- Executor
- Context Builder
- Tool Registry
- Permission Manager
- Sandbox
- Memory
- Streaming
- Retry Engine
- Observability

High-level flow:

```text
User task
Agent orchestrator
Context builder
LLM reasoning
Tool calls
File edits / commands / git operations
Validation
Human review
Completion
```

Required tools:

- read file
- search files
- search text
- edit file
- run command
- inspect git status
- inspect git diff
- run tests
- manage task state
- request permission

## Technical Stack

Recommended architecture:

```text
SwiftUI macOS app
Local agent runtime
SQLite
Tree-sitter
Git
Terminal runner
MCP
LLM providers
```

### App Layer

Use Swift, SwiftUI, AppKit bridges, and Swift Concurrency for the native macOS
application.

The app layer owns:

- windows
- navigation
- task workspace UI
- diff review UI
- permissions
- settings
- notifications
- native integrations

### Runtime Layer

Use Node.js and TypeScript for the local agent runtime unless a stronger reason
appears.

The runtime owns:

- repository indexing
- context building
- tool execution
- LLM calls
- streaming events
- task state
- memory
- git operations
- command execution

### Storage

Use SQLite as the default local database.

Store:

- workspaces
- tasks
- runs
- messages
- tool calls
- file references
- diff metadata
- approvals
- memory
- index metadata

Use sqlite-vec or a comparable local vector store for code and memory search
when needed.

## macOS Native Features

Important native features:

- menu bar agent
- Spotlight-style launcher
- global shortcut
- Notification Center
- Dock progress
- Finder integration
- Quick Look previews
- Services integration
- Apple Shortcuts
- background agents
- multi-window support

These should support real workflows, not just decoration.

Example launcher actions:

- fix current bug
- explain selected code
- generate tests
- review current diff
- commit current changes
- open last task
- inspect failed build

## Distribution Strategy

Forge should not be distributed through the Mac App Store in the early product
strategy.

Distribution:

```text
Official website
DMG download
Drag to Applications
Launch
Automatic updates
```

Reasons:

- shell execution
- git access
- Docker support
- workspace access
- local indexing
- background services
- optional Accessibility APIs
- faster release cadence

Expected release infrastructure:

- Apple Developer ID signing
- Apple notarization
- Sparkle updates

## Security And Permissions

Forge must be explicit about sensitive actions.

Permission boundaries:

- never run destructive commands without approval
- never push code without approval
- never upload private repository content without user intent
- never hide file changes from the user
- show command output and failures clearly
- make approvals auditable

The product should treat developer trust as a core feature.

## Documentation Plan

This README stays as the compact project constitution and memory index.

Detailed documents live under `docs/`:

- `docs/README.md`: documentation map and update rules.
- `docs/product_vision.md`: product vision, mission, category, and core
  principles.
- `docs/product_positioning.md`: market position, messaging, competitors, and
  differentiation.
- `docs/user_personas.md`: target users, pains, motivations, objections, and
  success criteria.
- `docs/user_flows.md`: end-to-end workflows from onboarding to review and
  shipping.
- `docs/workspace_design.md`: workspace surfaces, layout responsibilities,
  states, and interaction rules.
- `docs/macos_native.md`: macOS features, permissions, distribution, and native
  integrations.
- `docs/multi_agent.md`: agent roles, handoffs, orchestration, and task state.
- `docs/runtime_architecture.md`: local runtime modules, app-runtime
  communication, tools, and event streams.
- `docs/local_first.md`: local indexing, privacy, memory, context, and offline
  behavior.
- `docs/database.md`: SQLite responsibilities, conceptual schema, vector
  storage, and retention rules.
- `docs/git_workflow.md`: branch, diff, commit, push, and pull request
  workflows.
- `docs/mcp.md`: MCP tool discovery, permissions, integration, and product UI.
- `docs/security_permissions.md`: trust model, approval gates, risk levels, and
  audit logs.
- `docs/business_model.md`: distribution, customer segments, pricing
  hypotheses, and go-to-market.
- `docs/roadmap.md`: phases, milestones, proof points, and what not to build
  too early.
- `docs/founder_notes.md`: distilled founder decisions and collaboration
  pattern.
- `docs/development.md`: how to run the current app/runtime skeleton and what
  is not wired yet.

Agent-specific repository instructions live in `AGENTS.md`.

## Implementation Roadmap

### Phase 0: Foundation

- create project constitution
- define product principles
- define architecture boundaries
- create docs structure
- create agent development rules

### Phase 1: Workspace UI

- native macOS shell
- task-centered layout
- planner panel
- agent status panel
- terminal stream panel
- diff review panel

### Phase 2: Local Runtime

- local runtime process
- app-runtime communication
- task execution loop
- tool registry
- streaming events

### Phase 3: Repository Context

- workspace selection
- repository scanner
- file search
- symbol search
- Tree-sitter indexing
- context builder

### Phase 4: Editing And Review

- patch generation
- diff viewer
- approval flow
- apply or reject changes
- run tests

### Phase 5: Git Workflow

- git status
- branch awareness
- diff summary
- commit preparation
- pull request handoff

### Phase 6: Multi-Agent

- planner role
- coder role
- tester role
- reviewer role
- manager orchestration
- task state machine

### Phase 7: macOS Integration

- menu bar item
- global shortcut
- notifications
- Dock progress
- Finder and Services integration

### Phase 8: MCP And Plugins

- MCP server discovery
- tool permissions
- plugin registry
- external workflow integrations

### Phase 9: Release

- signing
- notarization
- DMG packaging
- Sparkle updates
- website download flow

## AI Development Rules

1. Read this README before making changes.
2. Do not redesign the product category without updating the project memory.
3. Do not turn Forge into an editor-first IDE.
4. Do not make chat the main interface.
5. Preserve human review.
6. Prefer native macOS APIs.
7. Prefer local computation and local storage.
8. Keep the runtime modular.
9. Explain architectural decisions in docs or code comments where needed.
10. Write production-quality, maintainable code.
11. Update this README when a decision changes.
12. Append a timestamped session log entry before ending each working
    conversation.

## Session Log

### 2026-07-04 03:34:39 CST +0800

Conversation summary:

- User asked to add a permanent rule that every conversation should end with a
  timestamped record of the discussion and work status.

Done:

- Added the `Session Logging Rule` to the project memory section.
- Added session logging to the AI development rules.
- Created this first timestamped session log entry.

Not done:

- Did not create separate `docs/` files yet.
- Did not initialize a git repository.
- Did not create `AGENTS.md` yet.

Next:

- Create `AGENTS.md` so future AI agents know to read and maintain this README.
- Create the initial `docs/` structure when the product documentation starts
  expanding beyond this README.
- Continue appending session log entries at the end of each working
  conversation.

### 2026-07-04 03:39:48 CST +0800

Conversation summary:

- User asked for a full product plan covering every major aspect of Forge and
  for multiple detailed documents with different record responsibilities.

Done:

- Created the initial `docs/` documentation system.
- Added detailed planning documents for vision, positioning, users, flows,
  workspace design, macOS native strategy, multi-agent architecture, runtime,
  local-first architecture, database design, git workflow, MCP integration,
  security, business model, roadmap, and founder notes.
- Added `AGENTS.md` so future AI coding agents know how to work in this
  repository.
- Updated this README's documentation index to point to the new files.

Not done:

- Did not initialize a git repository.
- Did not scaffold the macOS app or runtime code.
- Did not create visual mockups or a clickable prototype.
- Did not import the full raw shared conversation into
  `docs/founder_conversation.md`.

Next:

- Review and refine each planning document as product direction becomes more
  specific.
- Add `docs/founder_conversation.md` if the full original conversation should
  be preserved verbatim.
- Decide the first narrow MVP workflow to implement.
- Initialize the actual SwiftUI app and local TypeScript runtime when ready.

### 2026-07-04 03:44:20 CST +0800

Conversation summary:

- User asked whether the documentation is ready enough to start building and
  what is still missing.

Done:

- Assessed that the documentation is sufficient for beginning implementation.
- Identified that the remaining gaps are mostly concrete MVP and engineering
  setup decisions, not more broad product planning.

Not done:

- Did not scaffold the app or runtime.
- Did not initialize git.
- Did not choose final implementation details for the first vertical slice.

Next:

- Choose the first MVP workflow.
- Lock the initial technical setup: SwiftUI project shape, TypeScript runtime
  package manager, app-runtime communication, database choice, and first LLM
  provider.
- Start building the Phase 1/2 foundation once those choices are accepted.

### 2026-07-04 03:51:58 CST +0800

Conversation summary:

- User approved starting implementation and asked to create a public GitHub
  repository named `forge` under `windorion`.
- User also asked whether making the project open source can still support a
  subscription business model.

Done:

- Added `.gitignore` to keep local system files and future build artifacts out
  of git.
- Added an open-source/open-core strategy section to
  `docs/business_model.md`.
- Initialized the local git repository.
- Confirmed GitHub CLI is installed.
- Confirmed the current GitHub CLI token is invalid and remote creation/push is
  blocked until re-authentication.

Not done:

- Did not create the remote `windorion/forge` repository because `gh auth
  status` reports an invalid token for the current GitHub account.
- Did not push to GitHub yet.
- Did not choose a final open-source license.

Next:

- Re-authenticate GitHub CLI with `gh auth login -h github.com`.
- Create the public `windorion/forge` repository.
- Push the local `main` branch to GitHub.
- Decide the license strategy after the first working vertical slice, or sooner
  if public contributions begin.

### 2026-07-04 03:54:55 CST +0800

Conversation summary:

- User confirmed GitHub login was complete and asked to configure the remote
  repository and push the project.

Done:

- Verified GitHub CLI authentication outside the sandbox.
- Confirmed `windorion/forge` did not already exist.
- Created the public GitHub repository `windorion/forge`.
- Added `origin` as `https://github.com/windorion/forge.git`.
- Pushed local `main` to GitHub.

Not done:

- Did not add a license yet.
- Did not scaffold the SwiftUI app or TypeScript runtime yet.

Next:

- Decide whether to add a temporary "all rights reserved" notice, Apache 2.0,
  AGPL, or another license.
- Start the Phase 1/2 implementation: SwiftUI app shell plus local TypeScript
  runtime skeleton.

### 2026-07-04 04:04:01 CST +0800

Conversation summary:

- User said the basic preparation was done and asked about the next step for
  writing code.

Done:

- Started Phase 1/2 implementation.
- Added a SwiftPM-based SwiftUI macOS app shell named `ForgeApp`.
- Added a task-centered workspace UI with task list, planner, agent status,
  runtime events, review panel, and runtime controls.
- Added a local TypeScript runtime skeleton under `runtime/`.
- Implemented runtime endpoints: `GET /health`, `GET /tasks`, `POST /tasks`,
  and `GET /events` for Server-Sent Events.
- Added `docs/development.md` and runtime run instructions.
- Verified `swift build` succeeds.
- Verified `npm run check` and `npm run build` succeed for the runtime.
- Verified runtime `/health` and `POST /tasks` responses locally.

Not done:

- Did not wire the SwiftUI app to consume the SSE event stream yet.
- Did not add SQLite persistence.
- Did not add repository scanning, LLM calls, or file editing tools.
- Did not add a license yet.

Next:

- Wire runtime event streaming into the SwiftUI app.
- Add SQLite-backed task persistence to replace in-memory runtime tasks.
- Add repository picker and workspace records.
- Decide and add the initial license strategy.

## Decision Log

### 2026-07-04

- Product name for this repository: Forge.
- Atlas is preserved as the former codename.
- Product category: macOS-native, agent-first, local-first software engineering
  workspace.
- The core product is the agent runtime, not the editor.
- The workspace is task-centered, not chat-centered or file-centered.
- Human review is mandatory for important changes.
- Early distribution should use website download, DMG installation, Developer
  ID signing, notarization, and Sparkle updates rather than the Mac App Store.
- This README is the canonical project memory and should be updated as the
  project evolves.
- The repository now uses a multi-document planning system under `docs/`, with
  each document owning a distinct product or architecture area.
- `AGENTS.md` is the operating guide for future AI coding agents.
- Forge can be public and possibly open source, but the commercial model should
  be open-core or service-led rather than relying on goodwill. License remains
  undecided.
- Public GitHub repository created at `https://github.com/windorion/forge`.
- First implementation slice started with a SwiftUI app shell and local
  TypeScript runtime skeleton.

## Open Questions

- Which LLM providers should be supported in the first release?
- Should the first runtime be pure TypeScript or TypeScript plus a Swift helper?
- Which local vector store should be used first?
- How much editor functionality belongs in v1?
- What is the first narrow workflow that proves the product?

## Final Goal

Forge should become the operating system for software engineering on macOS.

Developers define intent. AI agents perform implementation. Humans review and
approve.
