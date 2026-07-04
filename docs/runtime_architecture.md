# Runtime Architecture

Document role: record the local runtime architecture, module boundaries,
tooling model, and communication between the macOS app and agent runtime.

## Architecture Summary

Forge should use a native macOS app for product experience and a local runtime
for agent execution.

```text
SwiftUI macOS App
Local IPC / HTTP / WebSocket
TypeScript Agent Runtime
Repository Tools
LLM Providers
Local Database
```

## App Responsibilities

The SwiftUI app owns:

- windows
- navigation
- task workspace UI
- diff review UI
- permission prompts
- native macOS integrations
- settings
- notification handling

## Runtime Responsibilities

The local runtime owns:

- task orchestration
- agent loop
- tool registry
- repository scanning
- context building
- file edits
- command execution
- git operations
- LLM calls
- streaming events
- persistence

## Communication

MVP can use:

- HTTP for request-response operations
- WebSocket for streaming task events and terminal output

Later versions can consider:

- Unix domain sockets
- XPC helpers
- privileged helper tools if truly required

## Core Modules

### Task Queue

Stores pending, running, completed, and failed tasks.

### Agent Orchestrator

Coordinates planning, execution, testing, review, and user approval states.

### Context Builder

Builds compact task context from:

- user prompt
- repository metadata
- file search
- symbol search
- recent task memory
- project docs
- git diff

### Tool Registry

Defines tools with schemas, permissions, risk levels, and execution handlers.

Required tools:

- read file
- search files
- search text
- propose edit
- edit file
- run command
- git status
- git diff
- run tests
- request approval

### Model Providers

Defines the boundary between agent orchestration and LLM/local model backends.

The provider layer should:

- expose provider id, display name, model name, and local/remote mode
- accept structured task context
- return structured proposals or model outputs
- avoid direct file, command, git, or network side effects
- make missing credentials or unsupported providers explicit

### Edit Proposal Generator

Creates proposed file changes and diff previews without mutating the working
tree. This sits before real edit/apply tools and gives the user a reviewable
artifact while preserving the human approval boundary.

### Edit Proposal Validator

Checks proposed file changes against the current workspace before apply. The
v0 validator confirms supported operation type, safe Markdown path, existing
target file, operation size, and whether the append text is already present at
the file end.

### Edit Proposal Applier

Applies an explicitly approved proposal through restricted file operations.
The v0 implementation only supports append-text edits to existing Markdown
files in `README.md` or `docs/`, revalidates before writing, and records
rejected proposals without touching files.

### Permission Manager

Decides whether an action can run automatically or requires user approval.

### Sandbox Manager

Controls command execution boundaries and records command logs.

### Event Stream

Sends structured events to the app:

- task created
- plan updated
- tool started
- tool finished
- command output
- file changed
- approval requested
- run failed
- review ready

### Memory

Stores durable project and task knowledge.

## Runtime Loop

```text
receive task
build context
plan
request approval if needed
execute tools
apply edits
run validation
review output
request human review
complete or continue
```

## Runtime Quality Bar

- every tool call should be logged
- every command should have output and exit status
- every file edit should be traceable
- every approval should be recorded
- failures should preserve enough context to resume
- the user should be able to stop a run
