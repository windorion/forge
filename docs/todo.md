# TODO

Document role: maintain the active backlog, priority order, and next concrete
engineering tasks for Forge.

Last updated: 2026-07-13

## Rule

Keep this file practical. A future agent should be able to open it and know
what to do next without rereading the whole project history.

## P0: Coding-Agent Demo V0

Goal: make Forge feel like a real coding-agent application, not a workflow
dashboard.

- Polish the first-pass `1a`/`1b`/`14a` macOS shell toward the exact handoff:
  tighter spacing, better selected states, stronger task queue density, and
  more faithful live-run copy.
- Polish the first usable `10a` full-screen diff review: exact split-diff
  behavior, keyboard shortcuts, file-level approval persistence, and stronger
  tests-covering-this-file evidence.
- Broaden source-file patch proposals beyond exact text hunks: add cross-file
  patch orchestration, rollback revalidation/recovery, and provider-driven
  source repair flows while keeping strict path validation and pre-apply
  checks.
- Keep the current trust gates: plan approval before mutation, human review
  before apply, explicit command approval, and explicit git actions.

## P1: Real Agent Behavior

- Split the combined `GatherRepositoryContext` action into finer-grained
  search/read choices and add timeout/restart recovery beyond the new manual
  loop controls.
- Extend the bounded read-only planning/execution context loops into a
  runtime-owned tool-call loop with strict allowed tools and stop conditions.
- Add stricter model output normalization, retry rules, and failure recovery
  for malformed tool calls or patch artifacts.
- Add request-change revision loops that operate from full diff review, not
  only the current review stack.
- Make timeout and runtime-restart recovery visible in the live session.

## P2: Review, Diff, And Git

- Polish the native diff review for larger multi-file navigation, binary/large
  file states, and packaged app workflows.
- Connect accepted diffs to commit preparation, local commit, branch publish,
  push, and PR handoff surfaces without letting git dominate the primary demo.
- Add approved PR creation/publication after the read-only PR handoff
  preflight.
- Add GitHub integration for PR metadata, draft PR creation, and remote
  branch/fork awareness.
- Add hosted-remote fixtures for push/branch-publish auth failures,
  disconnected networks, hosting-provider branch protection, and fork remotes.

## P3: Repository Understanding

- Add a durable repository index.
- Add ripgrep-backed text search as an explicit runtime tool.
- Add Tree-sitter or equivalent symbol parsing for common languages.
- Store index metadata in SQLite.
- Add ignore/secret filtering before indexing.
- Add semantic search only after symbol/text search is useful.

## P4: Runtime And Permissions

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

- Added persisted Agent Run Loop pause, abort, and resume controls. Pause and
  abort requests are cooperative between safe steps, carry an exact loop ID,
  persist request/stop/resume timestamps and notes, emit SSE control events,
  and keep completed evidence. Resume is limited to the same user-paused loop
  with remaining steps and cannot bypass proposal review or busy-task gates.
  The macOS action rail exposes state-specific controls and Log cards show
  pending control requests/resume counts. Core smoke covers concurrent pause,
  same-loop resume, and active-loop abort.
- Added bounded multi-round repository context inside Agent Run Loop. The
  request now accepts a separate `maxContextSteps` budget from zero to three;
  each loop persists completed context rounds and aggregate inspected paths,
  exposes the remaining budget to the provider, and pauses with explicit
  `ContextBudgetReached` or `NoProgress` reasons. Context steps record newly
  discovered paths and outcomes, the macOS Log shows the budget/evidence, and
  core smoke covers two distinct context rounds, a no-progress round, and an
  over-budget attempt.
- Added provider-selected repository context gathering inside the normal Agent
  Run Step/Loop. `GatherRepositoryContext` accepts bounded search terms and
  repo-relative read paths, while the runtime filters unsafe paths, runs the
  existing logged list/search/read tools, stores inspected paths on the step,
  blocks repeated requests, and lets the loop continue into proposal
  generation. The macOS Log tab shows inspected context paths and
  `npm run smoke:core` covers standalone and continuous-loop paths.
- Added bounded Agent Run Loop v0. `POST /tasks/:taskID/run-agent-loop`
  repeatedly runs provider-selected safe steps up to a runtime-enforced limit,
  links each step to an `AgentRunLoop`, and stops at review gates, passed
  commands, verified self-fix reruns, blocked/failed steps, busy-task guards,
  no-progress guards, or max-step protection. The macOS action rail now has
  `Run Agent Loop`, the Log tab shows loop status/stop reason/step counts, and
  `npm run smoke:core` covers proposal generation plus command failure ->
  repair brief -> self-fix proposal inside one loop.
- Added provider-selected Agent Run Step v0. `POST
  /tasks/:taskID/run-agent-step` asks the active model provider for one safe
  next action, then the runtime enforces existing gates while it generates an
  edit proposal, runs an approved task command, generates a validation repair
  proposal, reruns reviewed self-fix evidence, or pauses for human review. The
  macOS action rail now has `Run Agent Step`, the Log tab shows recent
  decisions/rationale/results, and `npm run smoke:core` covers a mock OpenAI
  step that generates a proposal followed by a step that runs
  `runtime-npm-check`.
- Added first-class rerun evidence after reviewed task-command self-fixes.
  Applying a command-sourced repair proposal records the failed command,
  repair brief, and applied proposal; `POST /tasks/:taskID/rerun-repair-command`
  reruns the original command through the existing approved command path and
  stores the passing/failing rerun as evidence. The macOS Tests tab now shows
  the self-fix rerun chain and the action rail exposes `Rerun Self-Fix`.
  `npm run smoke:core` covers failed command -> repair proposal -> apply ->
  rerun -> `Repair Verified`.
- Added an approved-command chooser for live task command runs. The runtime
  now includes project task command permissions in the validation permission
  envelope, deduplicated by command id and ranked by runnable/approved state.
  The macOS action rail uses that runtime-derived list to select and run
  approved commands instead of hardcoding `runtime-npm-check`, while still
  sending only command IDs to `run-task-command`. Smoke coverage now asserts
  chooser readiness before and after preset approval plus last-run metadata.
- Added cancellation for active spawned task command runs. The runtime exposes
  `POST /tasks/:taskID/cancel-task-command`, only cancels runtime-owned active
  command runs by run id, sends SIGTERM with a short SIGKILL grace path,
  records a `Cancel Task Command` audit entry, emits cancellation SSE events,
  stores cancellation system output chunks, returns cancelled runs to human
  review without repair briefs, and exposes a Cancel Command action in the
  macOS session action rail. `npm run smoke:core` now covers the running to
  cancelled lifecycle through a smoke-only long command fixture.
- Connected failed task-command output to the existing repair path. Failed
  `run-task-command` runs now generate provider repair briefs linked by
  `taskCommandRunID`; the macOS Tests/Review surfaces display command-sourced
  briefs; and `generate-validation-repair-proposal` can create a linked,
  review-only self-fix proposal from a failed live command without applying
  files automatically.
- Added approved task-scoped command execution for runtime-known command IDs:
  `POST /tasks/:taskID/run-task-command` accepts only command IDs, reuses
  validation-preset approvals, blocks concurrent command/validation runs, runs
  project commands without a shell, streams output chunks over SSE, stores
  bounded task command output with status/exit code/timeout result, and exposes
  a first macOS Tests tab/action-rail path for `runtime-npm-check`.
- Added the first source-code edit path: exact `ReplaceText` proposals can now
  validate and apply to existing allowlisted source/text files, not only
  Markdown.
- Added applied-file rollback metadata with before/after SHA-256 hashes, byte
  lengths, operation kind, timestamp, and rollback strategy.
- Extended `npm run smoke:core` with a temporary TypeScript source replacement
  fixture and assertions for applied-file rollback metadata.
- Added an explicit rollback endpoint and macOS action for applied edit
  proposals, with current-file hash checks and local restore snapshots.
- Extended `npm run smoke:core` to apply and roll back a source replacement.
- Added `PatchText`, a multi-hunk exact source/text patch operation with
  ordered validation, shared apply checks, rollback snapshots, local/OpenAI
  provider support, Swift decoding, and Review UI summary text.
- Extended `npm run smoke:core` to apply and roll back a two-hunk TypeScript
  source patch.
- Added a first-pass macOS coding-agent session shell in `WorkspaceView.swift`:
  neo-brutalist visual tokens, `1a`-style empty task composer, task queue,
  live agent stream, plan progress strip, Log/Diff/Tests tabs, compact plan
  gate, and action rail. Verified with `swift build`.
- Added a first usable `10a` full-screen diff review surface with changed-file
  tree, main diff pane, why-this-change reasoning, validation evidence, and
  apply/request-change actions wired to the existing review gates. Verified
  with `swift build`.
- Reset the roadmap and product direction around `design_handoff_forge`.
  Foundation V0 is now treated as mostly-built trust/runtime infrastructure;
  the next V0 is the coding-agent demo with live coding, source patches,
  streamed tests, self-fix, and full diff review.
- Added a bounded read-only execution-context pass after plan approval and
  before execution proposal generation. The runtime records tool events,
  merges inspected context files, and attaches context evidence to the
  execution proposal for the macOS Review UI.
- Hardened packaged runtime path resolution. The runtime now honors
  `FORGE_REPO_ROOT`, health reports runtime/repo paths, the macOS app resolves
  bundled runtime resources separately from repository roots, and
  `script/build_and_run.sh` copies a prebuilt runtime into the app bundle.
- Added `npm run smoke:git-remote`, a repeatable local bare-remote fixture
  suite covering stale remote/non-fast-forward push rejection,
  branch-publish remote branch collision, and remote policy rejection through
  real runtime HTTP endpoints.
- Hardened remote branch collision detection with `git ls-remote --heads` and
  fixed git push failure classification so pre-receive/protected-branch
  rejections are not mislabeled as non-fast-forward failures.
- Broadened `npm run smoke:core` from runtime task flows into app-facing
  runtime contracts: status page links, health diagnostics, persistence
  metadata, model-provider settings GET/POST, OpenAI missing-key/ready/clear
  states, and verification that API keys are never persisted to the settings
  file.
- Added a local foundation walkthrough to `docs/development.md`.
- Hardened git diff review for binary and oversized files. Runtime diff
  responses now include display mode, unavailable reason, byte/line counts, and
  app preview limits; the macOS Review panel shows explicit messages instead
  of forcing binary/large files through the side-by-side renderer.
- Hardened app-managed runtime lifecycle diagnostics. The macOS app now
  distinguishes external runtimes from app-managed processes, captures bounded
  build/launch output, lists checked runtime directory candidates, exposes
  launch commands in Settings and copied diagnostics, and reports slow stop
  attempts.
- Hardened local commit review preflight. Commit previews now expose git
  author identity status, staged/unstaged/untracked counts, line stats,
  files-without-stats counts, large-change warnings, validation state,
  hook-risk disclosure, and commit path limits before the user approves a
  local commit.
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
- Hardened PR handoff preview with structured preflight metadata. The runtime
  now summarizes base ref resolution, head/upstream readiness, multi-remote or
  fork-like review risk, validation state, test evidence, and publish
  readiness; the macOS Review panel renders the preflight card and smoke tests
  assert the API contract.
- Added branch preparation preview and explicit local branch create/switch
  actions from the Review panel. The runtime validates target branch names,
  rechecks expected HEAD and current branch, creates new local branches,
  switches to clean existing local branches, blocks unmerged files and dirty
  switches, records task events when linked, and does not push or publish a PR.
- Hardened branch review with structured preflight metadata and smoke coverage.
  Branch previews now summarize target branch validity, current branch/default
  branch status, dirty-worktree handling, existing local/remote branch state,
  and action readiness; default-base branch targets are blocked, the macOS
  Review panel renders the preflight card, and `npm run smoke:core` exercises a
  real temporary branch create/switch/cleanup success path plus stale-HEAD
  blocking.
- Added branch publish preview and explicit first-push/upstream setup from the
  Review panel. The runtime validates configured remotes, lists commits against
  the default base branch, blocks default-base/detached/already-upstream/
  no-commit/unmerged/remote-collision states, rechecks expected HEAD, branch,
  remote, and remote branch, pushes with `--set-upstream` without force, and
  records task events when linked.
- Hardened push and branch publish review with structured preflight metadata
  and classified git transport failure messages. Push previews now summarize
  branch/upstream/remote/commit/worktree/action readiness; branch publish
  previews summarize branch/remote/base/commit/worktree/action readiness; the
  macOS Review panel renders both preflight cards; runtime push failures are
  classified into common auth, non-fast-forward, protected-branch, network,
  remote-rejected, or unknown summaries; and `npm run smoke:core` asserts both
  API contracts.
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
