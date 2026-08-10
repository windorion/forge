# TODO

Document role: maintain the active backlog, priority order, and next concrete
engineering tasks for Forge.

Last updated: 2026-08-10

## Rule

Keep this file practical. A future agent should be able to open it and know
what to do next without rereading the whole project history.

## P0: Close The Two Remaining Handoff Boundaries

`docs/design_handoff_coverage.md` is authoritative: 41 of 43 named states are
Verified, including all five primary V0 screens and compact states `1c`–`1e`.

- [x] Render-verify the five primary screens, compact states, settings,
  decisions, recovery, queue/history/audit, quick-entry, native integrations,
  onboarding, updates, sharing, cost, templates, and first-success surfaces.
- Live-verify `6a` GitHub after the founder creates an OAuth App Client ID with
  Device Flow enabled. Configuration, polling, browser opening, user
  validation, Keychain persistence, connected/disconnect UI, and focused tests
  are already implemented.
- Revisit missing `35a` Widget only with P6 signing infrastructure. The
  timeboxed ad-hoc experiment is documented and does not block Alpha work.
- Preserve screenshot/rendered evidence when future product changes alter a
  Verified surface; do not reopen verification from code inspection alone.

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

- [x] Add a repeatable isolated-repository Alpha reliability campaign with
  TypeScript bugfix, Python two-hunk refactor, Markdown append, and ambiguous
  replacement negative-control cases. The runner exercises index, intake,
  clarification, plan/approval, proposal validation, per-file review, apply,
  Git evidence, external oracle, and JSON/Markdown audit stages. The passing
  baseline is in `docs/reliability/` and reports 3 applied + 1 guarded, 0
  unexpected failures, and 100% scored-stage pass rate.
- [x] Fix the two runtime defects found by the failing campaign baselines:
  bounded referenced follow-ups now preserve established intent instead of
  reopening a generic clarification, and exact replacement parsing supports
  escaped quotes inside code strings. Both have provider-level regressions.
- [x] Add a separate mock-OpenAI provider protocol campaign covering
  model-guided repository context, strict-schema multi-file Unified Diff,
  explicit project-command approval/execution, an unapproved-command negative
  control, command failure diagnosis, reviewed repair apply, linked rerun,
  Git/content oracles, and redacted audit export. The durable baseline reports
  3 passed + 1 guarded, 0 unexpected failures, 37 provider requests, and 100%
  scored-stage pass rate without external API cost.
- [x] Fix the provider-context defect found by the command-repair case: first
  command-sourced repair proposals now receive the complete dedicated repair
  brief even when there is no previous proposal or ordinary validation
  feedback. A fetch-mocked OpenAI regression asserts the brief ID and full
  follow-up prompt are present.
- **Next long task — live-model public-repository corpus:**
  - Pin repository URL, license, exact commit, task prompt, expected behavior,
    allowed commands, and external oracle for each case. Start with docs,
    TypeScript, Python, and Swift bugfix/refactor tasks rather than benchmarks
    that reward repository memorization.
  - Add enforced per-case and campaign request, token, estimated-cost, wall
    time, command, changed-file, and mutation ceilings. Budget exhaustion must
    become a scored safe stop, never an unbounded retry.
  - Record provider/model/version, request lineage, context/tool evidence,
    proposal/repair attempts, review decisions, Git diff, validation, audit
    redaction, outcome, and failure class in a separate versioned report.
  - Keep live-model reports separate from deterministic fixture/protocol
    baselines; never refresh a durable quality baseline implicitly.
  - Initial exit criterion: at least eight pinned tasks across four language or
    task families, every run budget-accounted, no unauthorized side effect,
    deterministic external oracles, and a reviewed failure taxonomy that
    selects the next runtime change.

- [x] Safe query-variation handling beyond the exact-fingerprint repeat guard:
  a subset-aware, order-insensitive, case-folded redundancy guard now blocks
  near-duplicate repository inspections before search/read tools
  (runtime/src/inspectionGuard.ts; `smoke:inspection-guard`).
- [x] Bounded read-only context loop stop conditions hardened and unified:
  the plan-context loop now uses the same subset-aware redundancy guard as
  InspectRepository (runtime/src/inspectionGuard.ts), so reordered/narrowed
  re-queries stop the loop before spending read-only tools. Verified by the
  full smoke:core flow. Tool execution stays runtime-owned; the provider only
  advises terms/paths and never runs tools directly.
- [x] Bounded output recovery extended beyond Agent Run Step decisions to
  intent briefs, plan-context requests, plan revisions, and edit proposals
  (patch artifacts) — side-effect-free re-request on malformed output
  (runtime/src/providerRecovery.ts; `smoke:provider-recovery`).

## P2: Review, Diff, And Git

- Polish the native diff review for larger multi-file navigation, binary/large
  file states, and packaged app workflows.
- Connect accepted diffs to commit preparation, local commit, branch publish,
  push, and PR handoff surfaces without letting git dominate the primary demo.
- [x] Add approved PR creation/publication after the read-only PR handoff
  preflight. POST /git/pr-publish opens a real GitHub pull request:
  optimistic-concurrency guard reusing the pr-preview (HEAD/branch/base must
  match, blockers must be clear, explicit `PublishPullRequest` confirmation),
  pushes the head branch, then POSTs to {FORGE_GITHUB_API_BASE}/repos/:owner/
  :repo/pulls. owner/repo parsed from the remote (runtime/src/githubRemote.ts).
  The GitHub token is supplied per-request (app holds it in the Keychain) and is
  never persisted or logged. Records a `Publish Pull Request` approval +
  `git.pull_request.published` event on the task. smoke:github-remote (pure
  parser) + smoke:pr-publish (e2e: local bare repo via pushurl + mock GitHub API,
  covering 400/409 guards, real push, payload/auth, task lineage).
- [x] Add GitHub integration for PR metadata and remote branch/fork awareness.
  The opened PR is persisted on the task (`pullRequest`: number/url/state/merged/
  draft/owner/repo/branches, SQLite-backed so it survives restart).
  POST /git/pr-status refreshes the real state from GitHub (open / closed /
  merged) with a per-request token — POST, not GET, so the token never enters a
  URL — and records a `git.pull_request.state_changed` event when it moves.
  Fork heads are supported via an optional `headOwner` (sent as `owner:branch`),
  and the publish UI has a DRAFT toggle. This unblocked `1d`'s true merged-PR
  wording: the completion header now shows the real PR number and live state
  (docs/verification/1d-merged-pr).
- [x] macOS wiring for PR publish: a PERSONAL ACCESS TOKEN block in Settings →
  GITHUB stores a PAT via KeychainStore (generic read/save/delete on the shared
  `githubAccessToken` account); `RuntimeClient.publishPullRequest` calls
  /git/pr-publish with the token read from the Keychain at call time (never held
  in view state); the completion surface renders a PR handoff panel with the
  reviewed preview, a publish action gated on token presence and preview
  blockers, and the real PR number/URL/state once opened (`1d`/`24a`). Evidence:
  docs/verification/github-pat-settings/. The OAuth device flow (`6a`/`15a`)
  is implemented and configurable in both Sign In and Settings. Its remaining
  external verification blocker is a founder-registered Client ID with Device
  Flow enabled; no client secret is stored in Forge.
- Decide the account product boundary before implementing Email sign-in:
  either provision a hosted Windorion account backend with email verification
  and sync APIs, or remove Email sign-in and keep Forge local-only. The current
  UI no longer presents a fake successful flow: it explains the missing service
  and offers Continue Locally.
- [x] Surface PR review/check/mergeability status alongside open/closed/merged
  state. `POST /git/pr-status` now reads the PR, latest decisive review per
  reviewer, requested reviewers/teams, and head-SHA check runs using the
  per-request Keychain token; the task persists normalized approvals/change
  requests, passing/pending/failing counts, mergeability, summaries, and audit
  events. The completion surface renders this evidence, and the local mock
  GitHub fixture covers pending, blocked/failing, approved/passing, and merged
  transitions.
- [x] Detect common fork topology automatically and add conservative optional
  background PR status refresh. The runtime derives `origin=contributor fork`
  plus `upstream=base repository` entirely from local GitHub remote metadata,
  pushes the head remote, targets the base repository, qualifies
  `owner:branch`, and rejects a conflicting manual owner. No discovery API is
  used. The macOS scheduler is default-off, offers only 15/30/60-minute
  intervals and 1/3/5-open-PR cycle caps, refreshes oldest evidence first,
  reads the Keychain token once per cycle, prevents overlap, stops the cycle on
  auth failure, and cancels when Forge exits. Runtime task state keeps the
  latest 20 manual/background attempts with success/failure, request count,
  change flag, and summary; a runtime in-flight gate rejects overlapping reads;
  the completion panel and Git settings expose live
  state. `smoke:pr-publish` covers automatic fork/base detection, stale owner
  rejection, qualified PR payload, and refresh audit against only a loopback
  mock GitHub API; Swift policy/model/client tests cover caps, ordering, source,
  and zero HTTP calls without a credential.
- Add hosted-remote fixtures for push/branch-publish auth failures,
  disconnected networks, and hosting-provider branch protection. Local fork
  topology is now covered; a hosted-provider fork failure case remains.

## P3: Repository Understanding

- [x] Durable repository index (SQLite repo_index table + repo_index_meta;
  runtime/src/repositoryIndex.ts; GET /index, POST /index/rebuild;
  incremental re-index; smoke:repo-index, smoke:repo-index-pure).
- [x] Lightweight symbol parsing for common languages (runtime/src/symbolExtract.ts;
  regex per language family — TS/JS/Swift/Python/Go/Rust/Java/C#/Kotlin/Ruby —
  no native Tree-sitter dependency). Symbols persisted in the repo_symbols table
  (SQLite schema v3), extracted on (re)index and backfilled for files that
  predate symbol support, refreshed/removed with their file. GET /index/symbols?q=
  exposes exact-match-first name lookup; smoke:symbol-extract, smoke:symbol-search.
- [x] Symbol inspection is index-backed: the agent's `Symbol` InspectRepository
  mode consults repo_symbols first (exact `kind name` declaration sites from a
  fast SQLite lookup, restricted to the safe bounded file set) and merges the
  live scan on top, so it works even when ripgrep is unavailable (engine
  `symbol-index+ripgrep-word` / `symbol-index`; runtime/src/symbolSearch.ts).
  smoke:core proves the end-to-end path against a populated index.
- [x] Durable text (trigram) index (repo_trigrams table, SQLite schema v4;
  runtime/src/textIndex.ts extracts distinct case-folded within-line 3-grams,
  runtime/src/textSearch.ts resolves candidates). The agent's `Text`
  InspectRepository mode is now index-backed: when the index covers the scan set
  (a superset check on paths) and every term is >=3 chars, the trigram inverted
  index narrows the scan to candidate files (verified by the live scan, so no
  false positives), working with or without ripgrep (engine
  `trigram-index+ripgrep-fixed` / `trigram-index+substring`). Falls back to the
  full scan when the index does not cover the set or a term is too short.
  Real-repo check: 130 files -> 14 candidates for "KeychainStore".
  smoke:text-search (pure) + smoke:core (end-to-end against a populated index).
- [x] Index metadata stored in SQLite (repo_index_meta: last_indexed_at, git_root).
- [x] Ignore/secret filtering before indexing (reuses the runtime skip rules:
  ignored dirs/names, size cap; broadened language allowlist for the index).
- Add semantic search only after symbol/text search is useful.

## P4: Runtime And Permissions

- [x] Execute the seven-phase, behavior-preserving `runtime/src/server.ts`
  decomposition in `docs/runtime_server_refactor.md`. The packaged entry is now
  a one-line bootstrap; the current 59-route contracts, direct unit/coverage
  gates, and all 20 smoke scripts pass without weakening approval or observer
  boundaries.
- [x] Complete the post-refactor readability pass: split Git workflow into five
  domain services, agent orchestration into queue/loop/step/inspection/recovery,
  edit operations into four handlers, validation into four services, HTTP into
  seven route groups, and composition into explicit domain assemblies.
- [x] Add task cancellation. `POST /tasks/:taskID/cancel` now persists one
  idempotent `Requested -> Completed` cancellation record, removes queued work,
  requests an active Agent Loop abort at its safe checkpoint, sends SIGTERM/
  bounded SIGKILL to runtime-owned task-command or validation children, skips
  remaining validation commands, and lands in an immutable `Cancelled` task
  state while retaining plans/diffs/output. Startup recovery finalizes a
  persisted request only after all interrupted work is terminal. The macOS
  task header exposes the composed action behind a consequence-confirming
  alert. `smoke:task-cancel` covers idle, queued, loop, command, validation,
  immutability, idempotency, and restart recovery paths.
- [x] Add timeout and stuck-task recovery. Per-command timeouts and startup
  recovery already covered "the command ran too long" and "the process died";
  the gap was a runtime that stays up while its own work wedges (a stalled
  provider socket, a tool that never settles). A live watchdog now sweeps for
  non-terminal work past its deadline (runtime/src/stuckDetection.ts, pure and
  clock-injected) and finalizes it at a safe, resumable checkpoint: steps fail
  closed with elapsed evidence, loops pause with a new `StepTimedOut` stop
  reason, command/validation runs and tool calls are closed with a system
  output chunk, and the task lands in Human Review with an
  `agent.stalled_work.recovered` event. It only rewrites task state, never
  files. Thresholds are env-tunable (`FORGE_STUCK_STEP_MINUTES`,
  `FORGE_STUCK_COMMAND_MINUTES`, `FORGE_STUCK_TOOL_MINUTES`; sweep interval via
  `FORGE_STUCK_SWEEP_INTERVAL_MS`), and `POST /maintenance/recover-stuck` runs
  the same sweep on demand. Items with missing/unparseable/future timestamps are
  never swept — failing to detect beats killing live work.
  smoke:stuck-detection (pure) + smoke:stuck-recovery (e2e against real
  in-flight work, no restart involved).
- [x] Add clearer audit log exports. The read-only
  `GET /tasks/:taskID/audit-export?format=markdown|json` endpoint emits a
  versioned, portable record of task state, cancellation, approvals, timeline,
  Agent Loops/steps, tools, bounded command output, validation, file-change
  metadata, and edit transactions. Known Bearer/GitHub/OpenAI/common secret
  patterns are recursively redacted. The macOS Audit surface now uses a native
  save panel for real `.md`/`.json` files instead of copying event lines while
  claiming to export.

## P5: Native macOS Product

- [x] Finish background task creation/detail/review routing for authorized
  Mission Control runtimes and cross-runtime click-through from repository
  cards. The routed surface covers new task, fresh task detail, conversation,
  plan approval/run, proposal diff, per-file review, Apply, validation, and
  activity without replacing the primary workspace; every mutation revalidates
  identity/session authorization and shares a per-repository concurrency gate.
- [x] Add cross-runtime queue fairness and restart-safe supervised dispatch.
  Authorized background runtimes always enqueue, never startup-dispatch, and
  accept `POST /queue/dispatch-next` only with the current memory-only
  authorization ID. The shared scheduler persists a 1-2 slot preference,
  chooses the oldest eligible queue first, then rotates round-robin. Pure Swift
  tests cover eligibility/limits/starvation; a two-runtime fixture proves six
  alternating grants, stale-ID rejection, and injected restart hold. A
  configurable six-hour soak command and DEBUG native capture driver cover
  observer/active/queued/review states.
- [x] Route approved background command/validation-catalog/git review actions
  through the same repository authorization and in-flight gates. Commands now
  cover preset approval/run, known-command run/cancel, and reviewed repair
  rerun. Git covers status/diff and reviewed local commit/branch/non-force
  publish/push while PR publication stays in its focused Keychain workflow.
  Swift request-factory/client tests, a two-runtime HTTP fixture, and a DEBUG
  Commands -> Git -> Commands native capture sequence prove the slice.
- [x] Build the true Mission Control XCUITest harness. A generated explicit
  Xcode project hosts the existing SwiftUI sources and three `XCUIApplication`
  methods cover observer authorization/revocation, 1/2 slot changes, review-card
  navigation, preset approval, active-command cancellation, and Git branch/
  commit confirmation cancellation. The project and test bundle compile via
  `script/test_mission_control_ui.sh`. An authenticated run executed all three
  methods and passed the slot/card-navigation method. The two remaining methods
  exposed sheet scoping and stale-element assertions; their fixes compile in
  build-only mode, but a complete passing archive is still outstanding.
- [x] Make supervision soak runs independently auditable. The same two-runtime
  fairness oracle now writes schema-versioned JSON/Markdown with requested and
  actual duration, exact timestamps, environment/power notes, grant/restart/
  queue totals, failure stacks/runtime output tails, and preserved failure
  fixtures. A bounded five-minute diagnostic passed with six alternating
  grants, 1,086 soak restart cycles, no startup auto-dispatch, stale-ID
  rejection, no starvation, and empty final queues; it is not the six-hour
  acceptance run. The sandbox-negative run also proved failure artifact
  preservation.
- [x] Add bounded Mission Control disconnect/reconnect behavior and lightweight
  session telemetry. Health/data failures now defer polling on a capped
  2/4/8/16/30-second schedule; unexpected supervisor-owned child exits retain
  the in-memory desired mode/session authorization and relaunch only after that
  deadline. Successful validated refreshes record recovery; identity, mode,
  authorization, and supervised-dispatch mismatches still terminate and clear
  restart authority. Repository footers and diagnostics expose bounded
  consecutive/total failure, restart, recovery, last-connect, and next-retry
  evidence. Six pure policy/diagnostic tests cover the state contract.
- [x] Add process-level disconnect/reconnect fault injection. A bundled minimal
  Node fixture runs through the real Swift supervisor `Process` and loopback
  paths on a random test port. It drops/restores transport on the same PID,
  then receives `SIGKILL`; the test observes cached Git/queue visibility during
  retry, exact session authorization and supervised mode after recovery, a new
  PID after relaunch, restart/recovery telemetry, and zero POST/queue-dispatch
  requests. Five repeated narrow runs and the full 55-test coverage suite pass.
- **Next API-free long task — archive full evidence and close exposed gaps:**
  - Run and archive the configured six-hour Mission Control soak under stable
    AC power with exact
    command, environment, machine sleep/power conditions, start/end times,
    grant/restart/queue totals, and failure artifacts.
  - Archive a passing run of the existing three-method XCUITest suite only in a
    user-approved unattended desktop window. Do not run focus-stealing UI
    automation while the user is working. Keep the deterministic DEBUG driver
    and compile-only CI gate distinct from action-level XCUITest evidence.
- Add Finder and broader "open in IDE" integrations beyond the current
  file/repository reveal actions.
- Run final human-input verification for remappable shortcuts, native Dock/menu
  chrome, notifications, and the global quick-capture hotkey.
- Keep the implemented repository picker, menu bar entry, global shortcut,
  notifications, Dock state, Spotlight, CLI, templates, and onboarding covered
  while packaging work changes process boundaries.

## P6: Commercial Readiness

- Decide first pricing and packaging.
- Decide open-core boundaries.
- Prepare Developer ID signing and notarization.
- Build DMG distribution.
- Finish signed appcast install/relaunch on top of the implemented update UI.
- Package the implemented onboarding and first-run provider setup in the signed
  distribution path.
- Add error reporting and support diagnostics.

## Done Recently

- Routed the remaining safe background command and Git workflow through
  Mission Control. Fresh repository/mode/session checks now guard validation
  preset approval/run, known-command run/cancel, reviewed repair rerun, Git
  status/diff/previews, local commit/branch, and non-force publish/push. A
  two-repository fixture proves exact ownership and cross-repository rejection;
  native DEBUG action automation and rendered evidence cover Commands -> Git
  -> Commands without switching the primary workspace.

- Added fail-closed Mission Control fair queue supervision. Active background
  children advertise `queueDispatch.mode=supervised`, hold persisted queue
  entries across startup, and require an authorization-bound supervisor grant.
  The native shared model owns a visible/persisted 1-2 background limit,
  initial oldest-first choice, round-robin continuation, grant count, and next
  repository evidence. `smoke:mission-control-fairness` exercises two isolated
  repos, six tasks, alternating grants, stale authorization, and restart
  injection. `soak:mission-control` extends the same local fixture to six
  hours; `script/verify_mission_control_surfaces.sh` drives four deterministic
  native states in a running DEBUG app.

- Removed every SwiftUI Sheet from the macOS product hierarchy. Mission
  Control, Queue, History, Batch Questions, Full Plan, Full Diff, and Audit Log
  now open through one root-owned opaque exclusive surface coordinator. The
  prior workspace becomes opacity-zero, non-interactive, and accessibility
  hidden until Close/Escape. This removes the visible old-workspace/new-screen
  overlap while preserving the handoff's intentional dimmed Command Palette.

- Added explicit, session-scoped active-runtime authorization to `4a` Mission
  Control. Each background repository still starts read-only; its visible
  `AUTHORIZE ACTIVE` action confirms exact path, port, recovery/supervised queue,
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
  Observer supervision, live aggregation, explicit session activation, and
  rendered comparison are now implemented. Full task creation/detail/review
  routing into a background active runtime remains.

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
  Copy says Shipped/Completed rather than inventing a merged PR; the guarded
  publication flow supplies the exact PR number/state/URL when available.

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
  bounded fixed-string ripgrep search; Symbol is now index-backed — it consults
  the durable repo_symbols index for exact declaration sites (restricted to the
  safe bounded file set) and merges the live whole-identifier scan on top, so it
  still works when ripgrep is unavailable. Both use JSON output, no shell, safe
  file lists, output/time budgets, and a recorded fallback engine. Smoke verifies
  the index-backed symbol engine (smoke:core against a populated index) and the
  repeat guard.
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
