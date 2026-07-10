# TODO

Document role: maintain the active backlog, priority order, and next concrete
engineering tasks for Forge.

Last updated: 2026-07-09

## Rule

Keep this file practical. A future agent should be able to open it and know
what to do next without rereading the whole project history.

## P0: Finish V0

- Polish the macOS git/diff review panel for larger multi-file navigation and
  packaged app workflows.
- Harden local commit review for failed git identity/signing/hooks, mixed
  staged/unstaged states, large change sets, and validation readiness.
- Harden push review for remote auth failures, non-fast-forward rejections,
  branch protection, and disconnected networks.
- Harden branch publish/upstream setup for remote auth failures, protected
  branch names, stale remote refs, fork remotes, and isolated success-path
  tests.
- Harden PR handoff preview for non-main default branches, fork remotes, and
  richer validation/test-plan evidence.
- Harden branch review for protected default branches, dirty-worktree edge
  cases, and isolated success-path tests.
- Harden app-managed runtime start/stop for packaged app locations, stale
  process handling, and user-facing launch failures.
- Optionally run a live-provider smoke with a user-supplied OpenAI API key,
  without committing secrets.

## P1: Real Agent Behavior

- Wire the OpenAI provider into the normal task flow beyond deterministic
  fallback demos.
- Extend the bounded OpenAI model-guided context loop into broader
  tool-call-driven planning and execution loops beyond read-only context.
- Add stricter model output normalization and failure recovery.
- Extend the richer proposal artifact into a real patch apply engine: section
  replace, structured multi-change rollback/recovery, and stronger workspace
  revalidation.
- Keep all patch application behind runtime validation and human approval.
- Connect follow-up repair proposals to commit preparation and rollback
  surfaces.

## P2: Review, Diff, And Git

- Improve the first-pass native side-by-side diff view with file filtering and
  better large-diff navigation.
- Add approved PR creation/publication after the read-only PR handoff preview.
- Add GitHub integration for PR metadata, draft PR creation, and remote
  branch/fork awareness.

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

- Broadened `npm run smoke:core` from runtime task flows into app-facing
  runtime contracts: status page links, health diagnostics, persistence
  metadata, model-provider settings GET/POST, OpenAI missing-key/ready/clear
  states, and verification that API keys are never persisted to the settings
  file.
- Added a short local V0 demo script to `docs/development.md`.
- Hardened git diff review for binary and oversized files. Runtime diff
  responses now include display mode, unavailable reason, byte/line counts, and
  app preview limits; the macOS Review panel shows explicit messages instead
  of forcing binary/large files through the side-by-side renderer.
- Added a bounded OpenAI model-guided context loop before plan revisions: the
  provider can ask for up to three read/search rounds, while the runtime
  validates and executes only logged read-only repo tools with stop conditions.
- Added richer OpenAI edit proposal artifacts: multi-file proposals can include
  safe append/replace/create operations plus preview-only unsupported
  operations, while apply remains v0-restricted.
- Added restricted `CreateFile` apply for new `docs/*.md` files and Review UI
  treatment for blocked `PreviewOnly` proposal operations.
- Added a bounded validation-feedback repair loop for edit proposals: blocked
  proposals are archived as `Superseded`, the provider receives failed checks,
  and repair stops after a fixed attempt limit.
- Added validation failure repair briefs: failed command output is summarized
  by the provider into likely cause, recommended actions, and a follow-up
  repair prompt without mutating files.
- Added follow-up repair edit proposals generated from validation repair
  briefs. The previous applied proposal is archived and the new repair proposal
  remains review-only until explicit apply.
- Surfaced validation repair briefs and follow-up repair proposal generation in
  the macOS Review UI.
- Added first-pass app-managed runtime start/stop controls in the toolbar,
  sidebar runtime badge, and Settings window.
- Added read-only runtime git status and bounded per-file diff endpoints, plus
  a macOS Review working-tree panel with side-by-side diff preview and
  open/reveal actions.
- Added read-only commit preparation previews with suggested commit message,
  included files, validation suggestions, blockers, risk notes, and a macOS
  Review commit card. The preview does not stage, commit, push, or mutate the
  repository.
- Added explicit local commit creation from the Commit Review card. The runtime
  rechecks HEAD, validates selected paths, rejects unmerged files and staged
  files outside the reviewed selection, preflights git identity, stages the
  selected paths, creates one local commit, records a task event when linked,
  and does not push.
- Added push preparation preview and explicit current-branch push action from
  the Review panel. The runtime rechecks expected HEAD, branch, and upstream,
  blocks detached/no-upstream/behind/no-ahead/unmerged states, pushes without
  force, records a task event when linked, and does not create a PR.
- Added read-only PR handoff preview in the Review panel. The runtime resolves
  the base branch when possible, compares current branch work against that
  base, suggests branch name, PR title/body, test plan, commits, changed
  files, blockers, and risk notes, and does not create or publish a PR.
- Added branch preparation preview and explicit local branch create/switch
  actions from the Review panel. The runtime validates target branch names,
  rechecks expected HEAD and current branch, creates new local branches,
  switches to clean existing local branches, blocks unmerged files and dirty
  switches, records task events when linked, and does not push or publish a PR.
- Added branch publish preview and explicit first-push/upstream setup from the
  Review panel. The runtime validates configured remotes, lists commits against
  the default base branch, blocks default-base/detached/already-upstream/
  no-commit/unmerged/remote-collision states, rechecks expected HEAD, branch,
  remote, and remote branch, pushes with `--set-upstream` without force, and
  records task events when linked.
- Extended `npm run smoke:core` with a mock OpenAI Responses server that
  verifies the model-guided context loop, append/create apply,
  blocked-to-repaired proposal flow, failed validation repair briefs,
  follow-up repair proposals, and bounded blocked preview-only paths.
- App-level runtime state and diagnostics for unchecked/checking/running,
  disconnected, wrong version, provider configuration issues, event stream
  state, startup guidance, and copy/open diagnostics actions.
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
