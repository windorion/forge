# TODO

Document role: maintain the active backlog, priority order, and next concrete
engineering tasks for Forge.

Last updated: 2026-07-15

## Rule

Keep this file practical. A future agent should be able to open it and know
what to do next without rereading the whole project history.

## P0: Complete And Verify The Design Handoff

Do not start another feature track until the handoff implementation is
complete. Use `docs/design_handoff_coverage.md` as the screen-by-screen source
of truth and the delivered HTML/CSS as the exact visual/content specification.

- Finish exact line-by-line verification of `1a`, `1b`, `10a`, `14a`, and
  `32a`.
- Render-verify the implemented compact task states `1c`, `1d`, and `1e`.
- Finish GitHub OAuth/device flow and runtime shortcut remapping; Account/Usage,
  General, Guardrails, Model, and API Key settings structures are implemented.
- Finish background task creation/detail/review routing for authorized Mission
  Control runtimes, then continue through quick entry and native integrations,
  onboarding, updates, sharing, cost, and templates until all 43 named HTML
  screens/states are verified.
- Render-verify the implemented `⌘K` Command Palette and extend the new native
  Forge menu from its core commands to the complete `21a` handoff command set.
- Render-verify the implemented full Plan Approval expansion, including its
  real six-step and one-step runtime modes and selected-step revision request.
- Render-verify the implemented History, Audit, Failure/Rollback, and Crash
  Recovery surfaces. Offline, No Repository, and Merge Conflict are
  implemented. First Success now has its real one-time Completed-task receipt;
  connect its final merged-PR wording/link after hosted PR publication exists.
- Render-verify the full Agent Question state; the context-backed answer flow
  now records a decision and resumes the paused loop instead of stopping at a
  static choice card. The multi-task Answer Queue now uses the same boundary;
  render-verify it and continue with conflict/no-repository recovery states.
- Bundle JetBrains Mono under the SIL OFL license and use the exact handoff
  typography in packaged builds.
- Keep screenshots or equivalent visual comparison evidence for each screen;
  do not mark a screen verified from code inspection alone.

## Coding-Agent Demo V0: Functional Complete

All acceptance criteria in `docs/v0_scope.md` are implemented and covered by
the core runtime smoke. Preserve these completed boundaries:

- clarification before planning when questions remain
- evidence-rich plan and one-action Approve & Run
- plan approval before mutation, human review
  before apply, explicit command approval, and explicit git actions.

- `35a` widgets: hand-assembled extension experiment failed as
  pre-declared (see docs/verification/35a); revisit only with P6 signing
  infrastructure. Do not block other screens on this.

## P1: Real Agent Behavior

- Add safe query-variation handling beyond the current exact-fingerprint repeat
  guard.
- Extend the bounded read-only planning/execution context loops into a
  runtime-owned tool-call loop with strict allowed tools and stop conditions.
- Extend bounded output recovery beyond Agent Run Step decisions to malformed
  planning tool requests and patch artifacts without retrying side effects.

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

- Removed every SwiftUI Sheet from the macOS product hierarchy. Mission
  Control, Queue, History, Batch Questions, Full Plan, Full Diff, and Audit Log
  now open through one root-owned opaque exclusive surface coordinator. The
  prior workspace becomes opacity-zero, non-interactive, and accessibility
  hidden until Close/Escape. This removes the visible old-workspace/new-screen
  overlap while preserving the handoff's intentional dimmed Command Palette.

- Added explicit, session-scoped active-runtime authorization to `4a` Mission
  Control. Each background repository still starts read-only; its visible
  `AUTHORIZE ACTIVE` action confirms exact path, port, queue recovery/dispatch,
  local-provider, and session consequences before replacing the observer with
  a read-write process. Health echoes a generated scoped authorization ID, and
  the supervisor validates that ID, mode, read-write state, and exact repo root
  or terminates the process fail-closed. Active access can be revoked back to
  observer mode after running work is paused. Pause All now covers primary and
  every authorized runtime. The observer smoke exercises the complete
  observer → active → observer cycle and proves writes are accepted only in the
  explicitly active interval.

- Added supervised multi-repository observer runtimes to `4a` Mission Control.
  Up to two non-primary repositories now receive app-owned Node processes on
  deterministic unique loopback ports. `FORGE_RUNTIME_MODE=observer` opens an
  existing task database read-only (or an in-memory empty store), skips Agent
  Loop/edit-transaction startup recovery, skips queue dispatch, rejects every
  non-GET request with 403, and reloads committed tasks for live polling. The
  macOS supervisor verifies mode, read-only status, and repository identity,
  polls health/tasks/queue/git every two seconds, exposes PID/port/live/offline
  evidence, and terminates only its own processes. `npm run smoke:observer`
  proves GET access, POST rejection, and byte-identical SQLite before/after.

- Added the honest `4a` Mission Control foundation. A new 1240px three-column
  surface uses live task/queue/git evidence for the active repository and
  persists compact snapshots for up to two recently connected repositories.
  The app exposes `⌘⇧M`, `⌘1–3` focus, `⌘⇧N` New Task, cooperative Pause All,
  repository-slot selection, real status/progress cards, and cached timestamps.
  Observer supervision, live aggregation, and explicit session activation are
  now implemented. Full task creation/detail/review routing into a background
  active runtime and strict rendered comparison remain.

- Implemented `26a` Task Queue as real runtime scheduling rather than a static
  task list. Approved Agent Loops now persist ordered queue requests whenever
  the single-repository execution slot is occupied; a stored 1-3 global
  ceiling, same-repository serialization, automatic next-task dispatch, queue
  reorder/removal, and restart recovery are runtime-enforced. The 1240px macOS
  Queue surface uses real running/queued/needs-you data and exposes priority,
  pause, removal, estimates, and the safety boundary. `npm run smoke:queue`
  verifies serialization, reorder, removal, setting persistence, restart
  dispatch, and queue drain. Pointer-drag and exact screenshot comparison
  remain polish for `26a`.

- Implemented `24a` First Success as a one-time state for the first real
  persisted Completed task. The 980px celebration uses the handoff's diagonal
  field, hard-edged confetti, square check, receipt, and next actions; receipt
  values come from real task/run/proposal/validation/review/plan evidence.
  Queue Next returns to the composer. View on GitHub is enabled only when the
  runtime can safely normalize a configured `github.com` remote to HTTPS.
  Copy says Shipped/Completed rather than inventing a merged PR; hosted PR
  publication remains the boundary for exact merged wording and PR URL.

- Implemented the real `18a` Merge Conflict flow. Actual Git unmerged entries
  now open the 1240px conflict workspace with a 250px file list,
  operation-aware Ours/Theirs labels, Base/Ours/Theirs/working text, editable
  resolution draft, and explicit take/draft actions. The runtime bounds text,
  rejects binary/unsafe paths and residual conflict markers, protects against
  stale HEAD/conflict fingerprints, writes manual results atomically while
  preserving mode, stages only the selected file, records task/SSE evidence,
  and never auto-continues merge/rebase. A temporary-repository smoke fixture
  covers confirmation, stale review, ours/manual resolution, staging, and the
  preserved MERGE_HEAD boundary.

- Reconciled the macOS main workspace with the latest `design_handoff_forge`
  `14a`/`32a` surfaces. Removed the old Planner, Review, decision rail,
  duplicate Log, toolbar demo controls, and full Git workbench hierarchy;
  replaced the native rounded task list with the square handoff queue; made
  Log/Diff/Tests mutually exclusive in one live-work column; combined tabs and
  cooperative loop controls into one footer; retained local commit V0 through
  a compact handoff inside full-screen Diff review. Verified with direct Swift
  type-check, SwiftPM build, TypeScript check, and runtime build.
- Added reviewed source/text `CreateFile` and `DeleteFile`. Create never
  overwrites; delete requires an existing bounded text target and retains a
  pre-delete snapshot. Apply/rollback verify file presence or absence as a
  first-class transaction state. Standard Unified Diff no-newline markers now
  validate and control the resulting EOF newline state. Core smoke covers a
  cross-file source create+delete transaction with rollback and a no-newline
  to newline patch with exact rollback.
- Replaced the placeholder split view with a parsed, aligned two-column diff
  renderer using standard unified hunk ranges and exact old/new line numbers.
  Full-screen review now prefers the pending proposal diff before Apply,
  falls back to working-tree diff afterward, shows reviewed/to-go counts, and
  supports `J`/`K` hunk, `⌘←`/`⌘→` file, `⌘↵` approval, and Escape close
  shortcuts. File decisions now live in the handoff-aligned diff verdict bar.
- Added crash-safe edit transaction recovery. Apply now persists a versioned
  per-file write-ahead journal before every mutation. Startup restores
  interrupted Apply transactions to the verified before state, verifies fully
  completed Rollbacks, and compensates mixed Rollbacks back to Applied.
  Unknown states fail closed without overwriting. Core smoke injects
  interrupted Apply/Rollback state through SQLite across real restarts and
  verifies continued operation.
- Added durable per-file edit proposal decisions and full-diff review actions.
  Every new proposal requires each file to be approved before Apply. File-level
  change requests are persisted, reject/archive the source proposal, and
  immediately generate a linked revision with reviewer feedback in provider
  context. macOS `Looks Good`/`Request Change` now call the runtime. Smoke
  covers the 409 approval gate, existing apply flows, and revision lineage.
- Added startup recovery for Agent Loops persisted as `Running`. Startup marks
  the loop `Paused / RuntimeRestarted`, finalizes linked running steps and
  in-memory-only tool/command/validation evidence, persists an interruption
  event, and allows a new loop to resume with append-only lineage. Smoke edits
  the SQLite fixture, restarts the runtime, and verifies recovery plus Resume.
- Added explicit runtime-owned `Text` and `Symbol` inspection modes. Text uses
  bounded fixed-string ripgrep search; Symbol uses whole-identifier matching.
  Both use JSON output, no shell, safe file lists, output/time budgets, and a
  recorded fallback engine when ripgrep is unavailable. Smoke verifies the
  symbol engine and repeat guard.
- Added cross-step `InspectRepository` request fingerprints and visible budget
  evidence. Normalized search terms/read paths produce a stable short SHA-256
  fingerprint; a later identical inspection is blocked before duplicate search
  or read tools. The macOS Log shows the fingerprint and scan/search/context
  budgets, and smoke verifies only the first request searches and reads.
- Added bounded malformed-output recovery for OpenAI Agent Run Step decisions.
  JSON/schema/required-field/action-enum failures get one corrective retry;
  recovered decisions store attempt evidence, while retry exhaustion creates a
  failed auditable step and executes no new tools, commands, or mutations. The
  macOS Log shows recovered/failed attempt counts, and smoke covers both paths.
- Added provider-selected `InspectRepository` inside Agent Run Step/Loop. The
  provider supplies bounded search terms and optional repo-relative paths;
  the runtime filters unsafe paths, executes only logged read-only list/search/
  read tools, stores step-level search/read evidence, and continues the loop.
  The macOS Log tab shows searches and inspected paths. Smoke coverage verifies
  `InspectRepository -> GenerateEditProposal` and rejects `../unsafe.txt`.
- Added cooperative Agent Run Loop pause/abort/resume controls. Pause and abort
  requests are audited and take effect after the current safe step; resume
  creates a linked new loop from paused/aborted/failed checkpoints. The macOS
  action rail and Log tab expose control state, stop reason, and resume
  lineage. `npm run smoke:core` controls a loop concurrently with a real
  five-second approved command and verifies `UserPaused`, resume links, and
  `UserAborted` lifecycles.
- Added restricted `UnifiedDiff` source modifications for normal model-backed
  edits beyond exact text hunks. The runtime validates single-file headers,
  allowlisted paths, hunk bounds/counts/order, and exact context/deletion lines
  against the current file before applying additions, replacements, or
  deletions.
- Added durable cross-file apply/rollback transactions with duplicate-target
  rejection, per-file apply/rollback SHA-256 verification, unique rollback
  snapshots, partial-apply compensation, and partial-rollback recovery. The
  macOS full diff review shows transaction/recovery evidence, and
  `npm run smoke:core` covers a two-file apply/rollback plus a real second-file
  permission failure that automatically restores the first file.
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
