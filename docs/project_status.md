# Project Status

Document role: record the current product state, objective completion estimate,
major gaps, and what "finished" means at each product horizon.

Last updated: 2026-08-08

## One-Line Status

Forge is a strong trust/runtime foundation with a handoff-driven coding-agent
session shell and a usable full-screen diff review surface in the macOS app.
The documented Coding-Agent Demo V0 functional criteria are complete, but the
full delivered design handoff is approximately 95-97% complete: 41 of 43 named screens/states are Verified with rendered-comparison evidence in docs/verification/.
It can create tasks, inspect bounded repo context, hold review gates, generate
safe edit proposals, apply restricted Markdown edits, exact source/text
replacements, multi-hunk patches, and context-anchored unified diffs across
reviewed source files, validate work, expose guarded git actions, run approved
task-scoped commands with streamed output,
record rerun evidence after reviewed self-fixes, let a model provider choose
safe next agent steps inside a bounded multi-step loop, and persist task state
locally. A composed task-level control can now dequeue work, abort the loop,
terminate runtime-owned command/validation children, recover across restart,
and retain a redacted Markdown/JSON audit package in an immutable Cancelled
task. The loop also has cooperative controls and a provider-selected,
runtime-executed read-only repository inspection step. Malformed provider outputs (agent steps, intent briefs, plan-context requests,
plan revisions, and edit proposals) now get one bounded, side-effect-free
correction attempt; near-duplicate repository inspections are blocked by a
unified subset-aware guard across both the InspectRepository step and the
plan-context loop. The next milestone is broader autonomous tool/patch breadth
and repeated success on representative real repositories.

## Current Implementation

Implemented:

- Native SwiftUI macOS app shell.
- State-driven macOS coding-agent session UI based on
  `design_handoff_forge` `1a`/`1b`/`14a`/`32a`: a dedicated new-task screen,
  sidebar-free clarification/plan state, square-edged running-task queue, and
  one live-work column that switches between Log/Diff/Tests. Legacy
  Planner, Review, decision-rail, duplicate-log, toolbar-demo, and Git
  workbench view hierarchies have been removed rather than hidden.
- First usable `10a`-style full-screen diff review surface with a changed-file
  tree, main diff pane, why-this-change reasoning, validation/test evidence,
  and apply/request-change actions backed by the existing proposal review
  gates.
- Full-screen diff review now parses standard unified hunk ranges into exact
  old/new line numbers and aligned change blocks for real split rendering. It
  prefers the pending proposal diff before Apply, falls back to the working
  tree afterward, and supports `J`/`K` hunk navigation, `⌘←`/`⌘→` file
  navigation, and `⌘↵` per-file approval.
- Full-page handoff destinations no longer use SwiftUI Sheets. Mission Control,
  Queue, History, Batch Questions, Full Plan, Full Diff, and Audit Log now share
  one root-owned opaque surface coordinator. Opening one hides the prior
  workspace from rendering, hit testing, and the accessibility tree; each
  surface has an explicit Close/Escape route. The dimmed `5a` Command Palette
  remains the only intentional product overlay.
- Real `18a` merge-conflict recovery surface backed by Git index stages. The
  runtime reads Base/Ours/Theirs and working text with size/binary guards,
  fingerprints the reviewed conflict, requires exact confirmation, supports
  ours/theirs/deletion/manual resolutions, stages only the selected path, and
  deliberately leaves merge/rebase continuation to the user. The macOS app
  shows the handoff-aligned conflict sidebar, paired sources, editable draft,
  explicit actions, failure/result evidence, and operation boundary.
- One-time `24a` First Success state for the first persisted Completed task.
  The handoff celebration, hard-edge confetti, receipt, and next-step actions
  use real elapsed/agent time, proposal diff lines, passed checks, requested
  review changes, plan cost, current branch, and a safely normalized GitHub
  remote. Without a published PR Forge says Shipped/Completed; once the guarded
  publication flow records a real PR it can show the actual number and state.
- Real `26a` multi-task queue and scheduler. Approved Agent Loops occupy one
  repository execution slot or persist an ordered queue request in the task
  snapshot. The opaque 1240px Queue surface exposes running, queued, and needs-you
  lanes; persisted 1-3 global ceiling controls; reordering, removal, pause,
  estimates, and the explicit same-repository serialization boundary. Startup
  automatically dispatches the first persisted request. A dedicated smoke
  fixture verifies ordering, removal, settings persistence, restart recovery,
  and complete queue drain.
- Composed task-level cancellation and portable audit export. A single
  idempotent request now removes queued work, aborts an active Agent Loop at a
  safe checkpoint, terminates runtime-owned task-command/validation children,
  survives restart, and completes only when every in-flight record is
  terminal. `Cancelled` tasks retain review evidence but reject later
  mutations. The macOS task header confirms the consequences, and Audit Log
  writes recursively redacted Markdown or JSON through a native save panel.
  The focused smoke covers idle, queue, loop, command, validation,
  immutability, idempotency, restart, and export paths.
- Repeatable Alpha repository reliability campaign. Four isolated committed
  Git repositories exercise TypeScript exact replacement, Python ordered
  multi-hunk patching, Markdown append, and an ambiguous-replacement negative
  control through index, intake/clarification, plan approval, proposal
  validation, per-file review, apply, Git status, independent content oracle,
  and JSON/Markdown audit export. The current durable baseline records three
  applied cases, one correctly guarded case, zero unexpected failures, and a
  100% scored-stage pass rate. The first failing runs also drove fixes for
  follow-up messages reopening resolved clarification and escaped quotes in
  exact replacement instructions. This is deterministic repository-shaped
  evidence; curated external-repository/provider testing remains an Alpha gap.
- Separate mock-OpenAI provider reliability campaign. Four isolated committed
  repositories exercise the production Responses adapter through model-guided
  context, strict-schema two-file Unified Diff generation, explicit project
  command approval/execution, an unapproved-command safety control, command
  failure diagnosis, reviewed repair apply, linked rerun, Git/content oracles,
  and redacted audit export. The current baseline records 3 passed, 1 guarded,
  0 unexpected failures, 37 provider requests, and 100% scored-stage pass rate
  without external API cost. Failing iterations fixed omission of the complete
  repair-brief object from first command-sourced repair proposal prompts.
- Functional `4a` Mission Control routing slice. The handoff-aligned 1240px
  surface supervises the primary repository plus up to two unique-port
  background runtimes. They default to read-only observer mode. Explicit
  per-repository confirmation can authorize an active runtime for the current
  app session; activation replaces the observer, forces the local provider,
  may recover interrupted state, returns a scoped
  authorization ID in health. The supervisor accepts active data only after
  mode, read-write state, authorization ID, and exact repo root all match, and
  terminates a mismatched process. Pause All covers primary and authorized
  background loops. Its repository-targeted composer now creates tasks in an
  accepted active runtime, background cards open fresh detail without changing
  the primary workspace, and the routed task surface exposes conversation,
  plan approval/run, proposal diff, per-file review, Apply, validation, and
  activity evidence. Every background mutation performs a fresh identity and
  authorization check and shares a per-repository in-flight gate. Observer
  detail remains read-only. Authorized background children now use supervised
  queue dispatch: startup and loop completion cannot start queued work without
  a fresh app grant carrying the current authorization ID. Mission Control
  persists a 1-2 background slot limit, selects the oldest first, then rotates
  grants round-robin. Its fixture proves six alternating grants across two
  repositories, stale-ID rejection, restart hold, and no starvation. A
  configurable six-hour soak command and deterministic DEBUG native-surface
  driver cover observer/active/queued/review states; a completed multi-hour
  run and action-level XCUITest remain.
  A bounded 20-second local extension completed 79 restart cycles without
  unexpected dispatch, identity drift, task loss, or queue resurrection.
- Local TypeScript runtime.
- Completed seven-phase runtime decomposition: the former 12,496-line
  `runtime/src/server.ts` is now a one-line packaged bootstrap over typed
  configuration, TaskState/event, HTTP route, repository, Git, edit,
  validation, task, queue, Agent Loop, recovery, and provider-settings
  services. A second readability pass split Git workflow, agent orchestration,
  edit operations, validation/process execution, route groups, and composition
  into narrower modules; `createForgeRuntime.ts` is now 476 lines. The
  59-route executable contract, all 20 smoke scripts, and all 44 Swift tests
  pass.
- Task creation and task conversation.
- Server-Sent Events from runtime to app.
- SQLite task persistence.
- Deterministic Agent Loop v0 with Manager, Planner, Coder, Tester, Reviewer
  states.
- Bounded repository file listing, search, and context reading.
- Repo-local file mentions in task messages.
- Structured intent briefs.
- Conversation-driven plan revisions.
- Unclear task intake now stops in `Clarification` before planning. Active
  questions are visible in the conversation and plan gate, unresolved
  questions block plan approval at the runtime boundary, and a resolving reply
  automatically produces the reviewable plan.
- Every new plan revision includes runtime-derived expected file areas,
  validation plan, risk notes, and bounded time/cost estimates. The embedded
  chat plan and plan rail expose `Approve & Run`; the combined endpoint records
  approval, prepares read-only execution context, and enters the bounded Agent
  Run Loop in one user action.
- OpenAI-backed plan revisions can first run a bounded model-guided
  read/search context loop; the runtime validates and executes each requested
  round through logged read-only repo tools.
- Explicit human plan approval.
- Execution proposals generated after an additional bounded read-only
  execution-context pass. The proposal stores tool evidence and context files
  so the app can show what repository evidence informed the next action.
- Provider-selected Agent Run Step v0. `POST /tasks/:taskID/run-agent-step`
  asks the active model provider for exactly one safe next action, then the
  runtime enforces policy before generating an edit proposal, running one
  approved task command, generating a validation repair proposal, rerunning
  reviewed self-fix evidence, or waiting for human review. Each step records
  provider metadata, action, summary, rationale, command/evidence IDs, linked
  proposal or command targets, status, result, timestamps, and SSE events.
  The macOS live stream shows the recent decision/tool/event trail.
- `InspectRepository` Agent Run Step action. The provider supplies only bounded
  search terms and candidate repo-relative reads; the runtime normalizes them,
  rejects unsafe paths, executes logged `list_repo_files`,
  `search_repo_context`, and `read_context_file`, stores context/tool evidence,
  and lets the bounded loop continue to its next provider decision. Each
  normalized request stores a short SHA-256 fingerprint and visible scan,
  search, context, term, and read budgets. A later identical request is blocked
  before duplicate search/read calls, and a near-duplicate request whose
  case-folded terms and read paths add nothing beyond an earlier inspection
  (same search mode) is also blocked as redundant — order-insensitive and
  subset-aware, so reordered or narrowed re-queries no longer spend tools
  (P1 query-variation guard; pure logic covered by `smoke:inspection-guard`).
  A completed inspection also stores a
  Strong/Partial/Weak/NoNewContext rating, a concise quality explanation,
  query-term coverage, match/file/new-context counts, total context bytes, and
  per-file byte length, SHA-256, matched-line count, and match reasons.
- Bounded output recovery for generation calls. OpenAI structured-output
  decode, required-field, and action-enum failures receive one corrective
  retry, now covering intent briefs, plan-context requests, plan revisions,
  and edit proposals in addition to Agent Run Step decisions
  (runtime/src/providerRecovery.ts; `smoke:provider-recovery`). These calls
  produce review artifacts and never mutate the workspace, so re-requesting is
  side-effect-free; non-format errors (network/timeout) still propagate
  immediately. For Agent Run Step decisions, a successful retry stores its
  attempt count and first error; exhaustion stores
  a failed `WaitForHumanReview` step with both bounded errors and stops the loop
  before any tool, command, or file side effect.
- Bounded Agent Run Loop v0. `POST /tasks/:taskID/run-agent-loop` repeatedly
  runs provider-selected safe steps up to a runtime-enforced step limit, links
  each `AgentRunStep` back to the loop, and stops at edit-proposal review
  gates, passed commands, verified self-fix reruns, blocked/failed steps,
  busy-task guards, no-progress guards, or max-step protection. The macOS
  live footer starts/resumes the loop and exposes its current control state.
- Cooperative loop control. Pause and abort requests are persisted and audited
  while active, then take effect after the current safe step. Resume creates a
  linked new loop instead of rewriting the paused/aborted/failed checkpoint.
  The macOS live footer shows control state and resume availability.
- Safe edit proposal review flow with multi-file OpenAI proposal artifacts,
  including blocked preview-only unsupported operations.
- `AppendText` and exact `ReplaceText` restricted edit operations for
  `README.md` and `docs/*.md`.
- Exact `ReplaceText` restricted edit operations for existing allowlisted
  source/text files, with strict path, size, binary, and single-occurrence
  validation.
- Multi-hunk `PatchText` restricted edit operations for existing allowlisted
  source/text files. Each hunk must have exact find/replace text, the find
  text must appear exactly once in the original file, and hunks are simulated
  in order before apply.
- Restricted `UnifiedDiff` operations for normal modifications to existing
  allowlisted source/text files. The runtime requires one file per diff,
  matching `---`/`+++` paths, bounded ordered hunks, exact declared line
  counts, and current-file context/deletion matches before apply.
- Cross-file apply/rollback transactions with duplicate-path rejection,
  per-file write-ahead journaling, apply and rollback hash verification,
  durable transaction status, automatic compensation after partial apply,
  and recovery back to the applied state after partial rollback. Startup also
  reconciles transactions interrupted by process death from recorded
  before/after hashes; unknown states fail closed as `RecoveryFailed`.
- Restricted `CreateFile` apply for new allowlisted source/text files and
  `DeleteFile` apply for existing bounded text files. Both are per-file
  reviewed, journaled before mutation, hash/absence verified, and rollbackable.
- Unified Diff accepts standard `No newline at end of file` markers, validates
  their old-side state, applies the requested new EOF state, and restores exact
  prior bytes on rollback.
- Edit proposal validation before apply and immediate revalidation during
  apply.
- Applied edit proposals now record per-file rollback metadata: operation kind,
  before/after SHA-256 hashes, byte lengths, applied timestamp, and rollback
  strategy.
- Explicit edit proposal rollback endpoint and macOS action. The runtime stores
  restore snapshots under `.forge/rollback-snapshots/`, verifies current file
  hashes before rollback, restores prior contents or deletes created files, and
  marks the proposal `RolledBack`.
- Bounded validation-feedback repair loop for blocked edit proposals.
- Request-changes revision loop for rejected edit proposals.
- Post-apply validation runs.
- Approved task-scoped command runs for runtime-known command IDs. The runtime
  accepts only allowlisted command IDs, reuses validation-preset approvals,
  blocks concurrent validation/command execution, runs project commands with
  `spawn` and `shell:false`, streams stdout/stderr chunks over SSE, records
  bounded output chunks plus exit code in task state, and exposes recorded
  runs and repair evidence in the macOS Tests tab.
- The validation permission envelope now includes a task-command chooser model.
  The macOS action rail shows runtime-known project commands, their approval/
  readiness state, command boundary, and last-run status, then runs the
  selected command by ID only after the runtime says it is ready.
- Failed task-command output now feeds the existing repair path. The runtime
  generates provider repair briefs linked to `taskCommandRunID`, the macOS UI
  shows those briefs next to failed command output, and
  `generate-validation-repair-proposal` can create a linked review-only
  self-fix proposal even when the failure came from a live task command rather
  than a post-apply validation run.
- Reviewed task-command self-fixes now produce rerun evidence after apply.
  `POST /tasks/:taskID/rerun-repair-command` reruns the original failed command
  through the same approved command path, links the new command run back to the
  failed source run, repair brief, and applied proposal, and marks the task
  `Repair Verified` when the command passes. The macOS Tests tab shows the
  evidence chain and the action rail exposes `Rerun Self-Fix`.
- Active spawned task commands can now be cancelled with `POST
  /tasks/:taskID/cancel-task-command`. Cancellation only targets runtime-owned
  active task command runs, sends SIGTERM followed by a short SIGKILL grace
  path, records a `Cancel Task Command` approval/audit entry, streams a system
  output chunk, emits cancellation SSE events, and surfaces a Cancel Command
  action in the macOS session action rail. Cancelled commands return to human
  review without creating failure repair briefs.
- Validation failure repair briefs for failed validation command output.
- Follow-up repair edit proposals generated from validation repair briefs.
- macOS Review UI display and action flow for validation repair briefs and
  follow-up repair proposals.
- Read-only git status and bounded per-file diff inspection from the runtime,
  surfaced in the macOS Review UI with changed-file open/reveal actions.
  Diff responses now include display-mode metadata, unavailable reasons,
  byte/line counts, and app preview limits so binary and oversized files are
  presented as explicit messages rather than broken side-by-side diffs.
- Read-only commit preparation preview from the runtime, surfaced as a compact
  local-commit handoff in full-screen Diff review with suggested message, files,
  validation
  suggestions, preflight metadata, blockers, risk notes, and a non-mutating
  operation boundary. The preflight includes git author identity, staged/
  unstaged/untracked counts, line stats, large-change warnings, validation
  state, hook-risk disclosure, and the commit path limit.
- Branch preparation preview and explicit local branch create/switch runtime
  actions. The runtime validates the target branch name,
  detects whether it will create or switch, exposes structured preflight
  metadata for target/current/worktree/existing/action readiness, requires
  expected HEAD and current branch values from the reviewed preview, blocks
  default-base branch targets, blocks unmerged files, blocks switching existing
  branches with dirty working trees, and records a linked task event when
  possible.
- Branch publish preview and explicit first-push/upstream setup runtime actions.
  The runtime chooses or validates a configured remote, compares
  current branch work against the default base branch, lists commits to
  publish, exposes structured preflight metadata for branch/remote/base/
  commit/worktree/action readiness, blocks default-base/detached/
  already-upstream/no-commit/unmerged states, blocks remote branch collisions,
  rechecks expected HEAD, branch, remote, and remote branch values, then runs a
  non-force `git push --set-upstream <remote> HEAD:<branch>` when approved.
  Failed git pushes are classified into common auth, non-fast-forward,
  protected-branch, network, remote-rejected, or unknown failure summaries
  before being shown in the app.
- Explicit local git commit action from the compact full-screen Diff handoff.
  The runtime
  requires a fresh expected-HEAD value, explicit confirmation, selected paths
  from the current working tree, no unmerged files, and no staged files outside
  the reviewed selection before it stages those paths and creates one local
  commit. It does not push.
- Push preparation preview and explicit current-branch push runtime action.
  The runtime requires expected HEAD, branch, and upstream
  values to match the reviewed preview, blocks detached/no-upstream/behind/no
  ahead/unmerged states, exposes structured preflight metadata for branch/
  upstream/remote/commit/worktree/action readiness, pushes with no force,
  classifies failed git push output into common failure categories, and records
  a linked task event when possible.
- Local repeatable git remote fixtures now run the real runtime HTTP API
  against temporary bare remotes for stale remote/non-fast-forward push
  rejection, branch-publish remote branch collision, and remote policy
  rejection. Remote branch collision checks now use both local tracking refs
  and `git ls-remote --heads`.
- Reviewed PR handoff plus explicit publication and status evidence. The
  runtime resolves base/head/upstream state, validates the reviewed HEAD and
  branch again, pushes without force, opens a GitHub PR only after explicit
  confirmation, and persists its task lineage. Local remote metadata now
  detects the common `origin=contributor fork` / `upstream=base` topology,
  pushes the fork remote, targets the base repository, derives the qualified
  head owner, and rejects a conflicting caller owner without a discovery API.
  Each manual or opt-in background refresh reads the PR, latest decisive
  review per reviewer, requested reviewers or teams, head-SHA check runs, and
  GitHub mergeability. The default-off macOS scheduler limits intervals to
  15/30/60 minutes and each cycle to 1/3/5 oldest open PRs, reloads the
  Keychain token per cycle, stops on auth failure, and exposes shared state.
  Success/failure, source, read count, and change status are kept as the latest
  20 durable refresh attempts and included in task/audit data.
- Built-in and allowlisted project validation presets.
- Runtime-derived command permission state in the app.
- Runtime model-provider abstraction.
- Local deterministic provider.
- Optional OpenAI Responses provider with Structured Outputs.
- Editable model-provider settings in macOS Settings.
- OpenAI API key handling through macOS Keychain and runtime memory.
- Core runtime smoke regression command covering create task, file-reference
  messages, plan revision, plan approval, edit proposal generation,
  validation, apply, built-in post-apply validation, append/replace operations,
  exact source-file replace, multi-hunk and two-file Unified Diff source
  patches, applied-file/rollback hash verification, automatic partial-apply
  recovery, explicit source patch rollback, restricted docs create-file
  apply, SQLite restart recovery, runtime health diagnostics, model-provider
  settings GET/POST, fake-key handling without secret persistence, a mock
  OpenAI model-guided context loop, provider-selected agent run step and
  bounded agent run loop with concurrent pause/resume/abort checkpoints,
  blocked-to-repaired proposal handling, and bounded blocked preview-only
  proposal handling, plus failed project validation repair brief generation
  and follow-up repair proposal generation.
- Dependency-free runtime unit/coverage entrypoints cover the pure parser,
  search/index, recovery, and stuck-detection modules plus focused model
  provider configuration and SQLite task-store boundaries. The native app now
  has its first SwiftPM `ForgeAppTests` target covering runtime JSON contracts,
  provider-settings encoding, pull-request state labels, appcast parsing, and
  actionable runtime errors. An injected `URLSession` also gives
  `RuntimeClient` direct mock-transport coverage for representative GET/POST,
  query encoding, HTTP and transport failures, secret placement, and SSE frame
  parsing, plus review, validation, and agent-loop control parameters. Direct
  `RuntimeClient.swift` has direct contract coverage. Eight mock-runtime
  `WorkspaceModel` tests cover connected/disconnected refreshes, task creation
  and selection persistence, runtime-process eligibility, saved-repository
  recovery eligibility, the `Reopen last workspace` boundary,
  validation-preset approval success/loading state, and validation failure
  cleanup. GitHub Actions runs the Swift suite with coverage on macOS for pull
  requests and pushes to `main`. SwiftUI rendering, most model actions, and
  native integrations remain the largest direct-test gaps.
- A local foundation walkthrough in `docs/development.md`.
- App-visible runtime state and diagnostics for unchecked/checking/running,
  disconnected, wrong version, provider configuration issues, SSE stream state,
  expected endpoint, database/task count, and copy/open diagnostics actions.
- App-managed runtime recovery from startup, the Offline workspace, and
  Settings, with compact runtime health in the task-queue footer. On launch the
  app first accepts a reachable external runtime; otherwise it automatically
  starts the bundled/local Node runtime for a restored repository. It can stop
  only the process it started.
- Runtime lifecycle diagnostics now distinguish external runtimes from
  app-managed processes, capture bounded build/launch output, list runtime
  directory candidates, expose launch commands in Settings/diagnostics, and
  report slow stop attempts.
- Runtime launch now separates the runtime installation directory from the
  repository root through `FORGE_REPO_ROOT`; the macOS app can launch a
  prebuilt bundled runtime resource while passing the resolved repository root
  explicitly, and health/settings diagnostics show both paths.

## Completion Estimate

These percentages are product-readiness estimates, not calendar estimates.
Milestones are cumulative: alpha includes V0, beta includes V0 and alpha, and
v1 includes all earlier milestones plus v1-only requirements. The estimates
use different denominators and must not be added together.

| Horizon | Estimate | Meaning |
| --- | ---: | --- |
| Trust/runtime foundation | 90-94% | Local runtime, task state, review gates, restricted edits, validation, composed cancellation, redacted audit export, guarded git/PR actions, bounded refresh audit, fail-closed supervised queue grants, diagnostics, and separate local/provider protocol reliability baselines are real. |
| Coding-agent demo V0 behavior | 100% | All documented functional acceptance criteria are implemented and smoke-covered. |
| Primary V0 handoff UI | 100% | All five primary screens are `Verified` with rendered-comparison evidence in `docs/verification/`. |
| Full 43-screen handoff UI | 95-97% | 41 of 43 screens Verified with rendered-comparison evidence (docs/verification/). Remaining: 6a Partial (OAuth configuration, Device Flow, standards-compliant polling, Keychain persistence, and connected UI are implemented and unit-tested; a live grant still needs the founder GitHub OAuth Client ID with Device Flow enabled); 35a a documented platform-blocked widget-signing descope (P6). |
| Useful developer alpha | 70-78% | Forge repeats the reviewed lifecycle across deterministic local-provider and mock-OpenAI adapter corpora, including Unified Diff, approved commands, repair/rerun, fork-aware PR supervision, routed background review, and fair restart-safe dispatch; it still needs broader autonomous tool use and repeated live-model success on pinned public repositories. |
| Commercial beta | 20-25% | Needs signed installable packaging, production proof of the implemented onboarding and GitHub/provider setup, trust/operations polish, and repeated success on real repos. |
| Polished v1 product | 24-30% | The real queue, local indexes, session-authorized runtimes, background task/detail/review routing, and fair supervised grants exist; full soak/UI-action proof, signed distribution, semantic memory, hosted collaboration, WidgetKit, and commercial polish remain. |

## Component Gap Matrix

These are directional subsystem estimates, not schedule promises. Each row has
its own denominator, so the rows must not be averaged into a product score.
The gap column is simply the remaining range to reach that subsystem's stated
finish line.

| Component | Readiness | Gap | Strongest evidence today | Largest remaining gap |
| --- | ---: | ---: | --- | --- |
| Product direction and task-first UX | 90-95% | 5-10% | Durable product principles, complete V0 flow, 41 rendered-verified handoff states. | Resolve the account/team boundary and validate the narrow daily-use task with external users. |
| Runtime, task state, recovery | 91-95% | 5-9% | 59-route contract, SQLite persistence, task detail, supervised/automatic queue modes, cancellation, watchdog recovery, transaction journals. | Normalize long-term run/tool history, retention, migration, full-duration soak, and production telemetry. |
| Security, permissions, and audit | 87-93% | 7-13% | Explicit plan/edit/command/git/PR gates, observer runtimes, redacted portable audit export, bounded PR refresh attempts. | Approval expiry/revocation, audit retention/purge, broader secret detection, and signed-build threat review. |
| Handoff UI fidelity | 95-97% | 3-5% | Five primary screens and 41 of 43 total states are Verified. | Live `6a` OAuth evidence and signed `35a` WidgetKit packaging. |
| Native macOS behavior and integrations | 78-86% | 14-22% | SwiftUI app, menus, shortcuts, notifications, Spotlight, CLI, onboarding, settings, managed runtimes, fair-queue state, and four-state DEBUG capture automation. | Final human-input checks, action-level XCUITest, deeper Finder/IDE handoff, WidgetKit, and signed-package proof. |
| Agent and live-model coding quality | 58-68% | 32-42% | Bounded plan/context/step loop, strict structured-output recovery, mock-OpenAI protocol campaign. | Pinned public-repository live-model evidence, broader tool choice, patch recovery, and measured quality/cost. |
| Edit, command, validation, and repair | 80-88% | 12-20% | Reviewed multi-file create/modify/delete, Unified Diff, rollback, approved commands, repair/rerun. | Broader source transformations, command catalogs, revocable approval memory, and post-rollback validation. |
| Repository understanding | 68-78% | 22-32% | Durable file metadata, lightweight symbols, trigram text index, bounded live verification. | Semantic/hybrid retrieval, dependency relationships, higher-fidelity parsing, ranking evaluation, and large-repo budgets. |
| Git and GitHub workflow | 86-91% | 9-14% | Status/diff, guarded commit/branch/push, fork-aware PR publication, reviews/checks/mergeability evidence, bounded background refresh. | Live OAuth proof, hosted auth/network/branch-protection fixtures, richer provider portability, and merge/update policy decisions. |
| Multi-task and multi-repository supervision | 84-89% | 11-16% | Persisted queues, observers, session authorization, routed task/review, serialized mutations, fair 1-2-slot grants, restart injection, and configurable soak. | Richer routed command/git actions, action-level UI automation, full multi-hour evidence, disconnect backoff, and telemetry. |
| Reliability, evaluation, and test evidence | 78-86% | 14-22% | 20 runtime unit files, 20 smoke scripts, 44 Swift tests, fork/mock-GitHub E2E, two passing campaigns, fair two-runtime restart fixture, and DEBUG state captures. | Live-model corpus, wider real repositories, hosted-network cases, action-level UI/performance evidence, and a completed multi-hour soak. |
| Distribution, updates, and operations | 25-35% | 65-75% | App-managed/bundled-runtime path, update UI/appcast client, diagnostics surfaces. | Developer ID, hardened runtime, notarization, DMG, signed appcast install/relaunch, crash reporting, release rehearsal. |
| Account, sync, and collaboration services | 10-20% | 80-90% | Honest local-only continuation and GitHub/provider credentials in Keychain. | Decide whether accounts exist; if yes, build verified email identity, sync, sharing, tenancy, and deletion/privacy APIs. |
| Pricing, packaging, and go-to-market | 20-30% | 70-80% | Product category, personas, positioning, and business-model hypotheses are documented. | Choose solo/team wedge, open-core boundary, packaging, price, entitlement/billing, support, and launch evidence. |

The highest-leverage next engineering milestone is the live-model
public-repository corpus. It attacks the largest Alpha uncertainty (32-42%)
and produces failure evidence that can rationally reorder agent, retrieval,
edit, command, and reliability work instead of expanding those systems by
intuition.

The completed API-free Mission Control fairness milestone closes autonomous
background dispatch, starvation, and restart-hold gaps with a fail-closed
supervisor-grant protocol, visible 1-2 slot state, deterministic policy tests,
two-runtime restart injection, a configurable soak, and native DEBUG state
captures. The next API-free long milestone is routed background command/git
review plus action-level native automation and a completed multi-hour soak. It
attacks the remaining 11-16% supervision gap without provider credentials.

## Distance To "Finished"

Forge is past the "blank prototype" stage and has a credible architecture
skeleton. The product direction has now shifted from proving safety surfaces to
making the first demo feel like an agent coding app.

The hardest remaining work is not the app shell. The hardest remaining work is:

- a richer model-backed coding loop with read/search tool choices and broader
  patch/recovery behavior
- close the two remaining handoff boundaries: live `6a` GitHub authorization
  with a founder Client ID and signed `35a` WidgetKit packaging in P6
- repeated live-model patch/command/recovery success on pinned public repos
- semantic or hybrid retrieval beyond the durable file/symbol/trigram indexes
- broader project-command catalogs and revocable approval memory
- native macOS distribution, signing, notarization, and updates
- trust polish: permissions, audit trail, secret handling, and clear user
  control

## V0 Finish Line

The V0 functional finish line is complete. The Coding-Agent Demo defined in
`docs/v0_scope.md` proves that a user can type a coding task, approve a plan,
watch a live agent run, see code/test activity, review a real source diff, and
approve the final patch.

Design completion is tracked separately. The five primary V0 screens have
passed strict rendered verification; full handoff status is 41 of 43. The two
remaining entries are externally gated (`6a` live OAuth grant and `35a` signed
WidgetKit packaging), so they no longer block safe Alpha reliability work.

## Alpha Finish Line

Alpha is done when Forge can complete small real documentation or code tasks
with a model provider while preserving human review.

Current Alpha evidence already includes provider-backed read/search, reviewed
source patches, approved command execution, repair/rerun, full diff review,
streamed output, guarded Git/PR publication, restart recovery, and onboarding.

Alpha still requires:

- repeated live-model success on a pinned public-repository task corpus
- broader provider tool/patch choices without weakening review boundaries
- a completed multi-hour active/observer soak and action-level native UI proof
- founder completion of live GitHub OAuth verification

## Commercial Beta Finish Line

Commercial beta is done when a user can install Forge outside the development
machine and safely use it on real repositories.

Commercial beta requires:

- signed and notarized app distribution
- Sparkle or equivalent updates
- app-managed runtime process
- robust provider configuration and diagnostics
- workspace/repository selection
- approved PR workflow
- privacy and permission messaging
- crash/error reporting strategy
- pricing and packaging decision

## Product Risk

Primary risks:

- Forge has started moving away from the workflow dashboard shape, but the
  current shell can still feel like a simulator until real patch/test activity
  is first-class.
- Forge may feel like a simulator until the real model/tool/patch/test loop is
  strong.
- The app can lose to Codex/Claude Code if it does not make live coding and
  terminal/test output first-class.
- Local-first privacy is valuable, but remote model configuration must be clear
  enough that users trust what leaves the machine.
- The first commercial scope must stay narrow; becoming a full IDE too early
  would slow the product down.
