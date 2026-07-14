# macOS Native Design

Document role: record how Forge should use macOS as a product advantage,
including native features, permissions, distribution, and system integration.

## Native Product Thesis

Forge should not feel like a browser window in a desktop wrapper. The Mac
itself should become part of the agent workspace.

## Core Native Features

### Menu Bar Agent

Purpose:

- show background agent status
- start quick tasks
- open active task
- show completion or failure

Example states:

- idle
- indexing
- running task
- waiting for approval
- tests failed
- review ready

### Global Shortcut

Purpose:

- open a command palette from anywhere
- submit a quick task
- ask about selected code
- review current diff

The shortcut should feel closer to Raycast or Spotlight than to a chat window.

### Notification Center

Purpose:

- notify task completion
- request review
- report failed tests
- show long-running command status

Notifications should be actionable:

- open diff
- view logs
- continue task
- dismiss

### Dock Progress

Purpose:

- make long-running work visible without opening the app
- show indexing, testing, or task progress

### Local Runtime Lifecycle

Purpose:

- start the local agent runtime without requiring a separate terminal session
- stop the app-managed runtime process when the user is done
- show whether the runtime is external, app-managed, starting, running,
  stopping, stopped, or failed
- include process state, PID, and runtime directory in diagnostics

Current implementation:

- the toolbar, sidebar runtime badge, and Settings window can start/stop an
  app-managed runtime process
- the app can build a development checkout runtime or launch a prebuilt
  bundled runtime resource with `node dist/server.js`
- the app resolves the runtime installation directory separately from the
  repository root and passes the repo root through `FORGE_REPO_ROOT`
- stop only terminates the process that the app started, avoiding broad process
  killing
- the app distinguishes an externally reachable runtime from an app-managed
  runtime process and does not offer to stop external processes
- Settings and copied diagnostics include runtime launch candidates, launch
  command, bounded build/launch output, process state, PID, runtime directory,
  and repository root
- slow stop attempts are surfaced with a user-facing message

Future hardening:

- add a real workspace/repository picker for installed apps that no longer sit
  next to a checkout
- add distribution-specific signing/notarization checks after packaging
  decisions

### Finder Integration

Purpose:

- right-click a folder or file and send it to Forge
- explain folder
- review code
- generate tests
- start a task from a repository

### Live Agent Controls

Current implementation:

- the task action rail exposes state-specific Pause, Abort, and Resume buttons
- controls are owned by the shared workspace model rather than view-local
  network state
- pending cooperative stop requests remain visible until the current safe
  step finishes
- resume creates a new bounded loop linked to the prior paused, aborted, or
  failed checkpoint, preserving append-only history

### Coordinated Apply Evidence

Current implementation:

- the existing Review surface shows the latest proposal apply attempt without
  creating another window or view-local runtime state
- transaction phase, per-file verification, and automatic compensation make
  partial-write recovery visible alongside the proposal
- an incomplete recovery error remains visible for explicit human follow-up

### Quick Look

Purpose:

- preview diffs
- inspect generated summaries
- review files quickly

### Services

Purpose:

- send selected text or files from other apps to Forge
- ask the agent about selected code, logs, or docs

### Apple Shortcuts

Purpose:

- automate developer workflows
- start tasks from system automations
- integrate with personal workflows

## Permissions

Forge may need:

- file access to selected repositories
- permission to run local commands
- optional Accessibility permission for active app context
- notification permission
- login item or background item permission

Permissions must be explained clearly. The user should understand why each one
is needed.

## Distribution

Early strategy:

```text
Official website
DMG download
Drag to Applications
Launch
Automatic updates
```

Do not prioritize Mac App Store distribution early because Forge needs local
developer-tool capabilities that may conflict with sandbox restrictions.

Expected infrastructure:

- Developer ID signing
- notarization
- Sparkle updates
- crash reporting policy
- privacy policy

## Native Quality Bar

Forge should respect:

- keyboard navigation
- system appearance
- window behavior
- notifications
- menu conventions
- privacy prompts
- accessibility

Native does not mean decorative. Every native feature should make the agent
workflow faster, safer, or easier to understand.
