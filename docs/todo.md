# TODO

Document role: maintain the active backlog, priority order, and next concrete
engineering tasks for Forge.

Last updated: 2026-07-08

## Rule

Keep this file practical. A future agent should be able to open it and know
what to do next without rereading the whole project history.

## P0: Finish V0

- Broaden automated regression coverage from the runtime core to app-facing
  runtime state, diagnostics, and provider settings paths.
- Improve the macOS edit proposal panel with clearer diff preview and operation
  metadata.
- Add app-level runtime state: running, disconnected, wrong port, wrong
  version, and startup guidance.
- Add a simple app action to open or copy runtime diagnostics.
- Run a provider settings smoke test with an intentionally supplied OpenAI API
  key, without committing secrets.
- Add a short V0 demo script in `docs/development.md`.

## P1: Real Agent Behavior

- Wire the OpenAI provider into the normal task flow beyond deterministic
  fallback demos.
- Add a tool-call planning loop where the model can request bounded read/search
  actions through the runtime rather than only receiving prebuilt context.
- Add stricter model output normalization and failure recovery.
- Add a richer patch proposal format:
  file create, file replace section, multi-change proposal, and preview-only
  unsupported operation states.
- Keep all patch application behind runtime validation and human approval.
- Add retry/revision prompts that incorporate validation failures and user
  request-changes notes.

## P2: Review, Diff, And Git

- Add a native side-by-side diff view.
- Show working tree git status in the app.
- Show changed files after apply with open/reveal actions.
- Add commit preparation as a review artifact, not an automatic action.
- Add branch awareness.
- Add PR handoff planning, likely through GitHub integration later.

## P3: Repository Understanding

- Add a durable repository index.
- Add ripgrep-backed text search as an explicit runtime tool.
- Add Tree-sitter or equivalent symbol parsing for common languages.
- Store index metadata in SQLite.
- Add ignore/secret filtering before indexing.
- Add semantic search only after symbol/text search is useful.

## P4: Runtime And Permissions

- Let the app manage the runtime lifecycle.
- Add command runner permissions for task-scoped commands beyond allowlisted
  validation presets.
- Add terminal output streaming into the task.
- Add task cancellation.
- Add timeout and stuck-task recovery.
- Add clearer audit log exports.

## P5: Native macOS Product

- Add repository/workspace picker.
- Add menu bar entry.
- Add global shortcut for creating or resuming a task.
- Add notifications for review gates and completed validation.
- Add Dock progress or badge state for running tasks.
- Add Finder and "open in IDE" integrations.

## P6: Commercial Readiness

- Decide first pricing and packaging.
- Decide open-core boundaries.
- Prepare Developer ID signing and notarization.
- Build DMG distribution.
- Add update mechanism.
- Add onboarding and first-run provider setup.
- Add error reporting and support diagnostics.

## Done Recently

- Core runtime smoke regression script covering task creation, file-reference
  messages, plan revision, plan approval, edit proposal generation, validation,
  apply, post-apply validation, append/replace operations, and SQLite restart
  recovery.
- Model provider settings management in macOS Settings.
- OpenAI provider configuration visibility and Keychain-backed API key sync.
- Safe edit proposal exact replace operation.
- Post-apply validation presets.
- Runtime-derived command permission state.
- Conversation-driven plan revisions and proposal revisions.

## Not Now

- Full IDE replacement.
- Marketplace.
- Enterprise admin.
- Team collaboration.
- Debugger.
- Broad plugin ecosystem.
- Visual theme system.
