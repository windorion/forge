# Project Status

Document role: record the current product state, objective completion estimate,
major gaps, and what "finished" means at each product horizon.

Last updated: 2026-07-13

## One-Line Status

Forge is a strong trust/runtime foundation with a first-pass coding-agent
session shell and a usable full-screen diff review surface in the macOS app.
It can create tasks, inspect bounded repo context, hold review gates, generate
safe edit proposals, apply restricted Markdown edits, exact source/text
replacements, and multi-hunk source/text patches, validate work, expose
guarded git actions, run approved task-scoped commands with streamed output,
record rerun evidence after reviewed self-fixes, let a model provider choose
safe next agent steps inside a bounded multi-step loop, and persist task state
locally. The loop can now select multiple bounded read-only repository context
passes during the normal run, with a separate context-step budget and
no-progress stops, before proposing edits. The user can now request a
cooperative pause or abort between safe steps and resume the same persisted
user-paused loop. The next milestone is finer-grained search/read choices and
broader patch recovery.

## Current Implementation

Implemented:

- Native SwiftUI macOS app shell.
- First-pass macOS coding-agent session UI based on `design_handoff_forge`:
  task queue, `1a`-style new-task empty state, live agent stream, plan
  progress strip, Log/Diff/Tests tabs, compact `1b`-style plan gate, and action
  rail. Existing review/git surfaces remain available inside the new shell.
- First usable `10a`-style full-screen diff review surface with a changed-file
  tree, main diff pane, why-this-change reasoning, validation/test evidence,
  and apply/request-change actions backed by the existing proposal review
  gates.
- Local TypeScript runtime.
- Task creation and task conversation.
- Server-Sent Events from runtime to app.
- SQLite task persistence.
- Deterministic Agent Loop v0 with Manager, Planner, Coder, Tester, Reviewer
  states.
- Bounded repository file listing, search, and context reading.
- Repo-local file mentions in task messages.
- Structured intent briefs.
- Conversation-driven plan revisions.
- OpenAI-backed plan revisions can first run a bounded model-guided
  read/search context loop; the runtime validates and executes each requested
  round through logged read-only repo tools.
- Explicit human plan approval.
- Execution proposals generated after an additional bounded read-only
  execution-context pass. The proposal stores tool evidence and context files
  so the app can show what repository evidence informed the next action.
- Provider-selected Agent Run Step v0. `POST /tasks/:taskID/run-agent-step`
  asks the active model provider for exactly one safe next action. The action
  can now be `GatherRepositoryContext`, which carries bounded search terms and
  repo-relative read paths through runtime-validated list/search/read tools,
  filters unsafe paths, records the inspected paths on the step, and rejects
  repeated requests. A Loop can run multiple distinct context steps, but the
  runtime enforces a separate zero-to-three-step context budget and pauses on
  budget exhaustion or no new inspected files. The runtime also enforces
  policy before generating an edit proposal, running one approved task
  command, generating a validation repair proposal, rerunning reviewed
  self-fix evidence, or waiting for human review. Each step records provider
  metadata, action, summary, rationale, command/evidence IDs, linked proposal
  or command targets, status, result, timestamps, and SSE events.
  The macOS action rail exposes `Run Agent Step`, and the Log tab shows the
  recent decision trail.
- Bounded Agent Run Loop v0. `POST /tasks/:taskID/run-agent-loop` repeatedly
  runs provider-selected safe steps up to a runtime-enforced step limit, links
  each `AgentRunStep` back to the loop, enforces a separate context-step
  budget, aggregates inspected paths, and stops at edit-proposal review gates,
  passed commands, verified self-fix reruns, budget exhaustion, blocked/failed
  steps, busy-task guards, no-progress guards, or max-step protection. The
  macOS action rail exposes `Run Agent Loop`, and the Log tab shows recent
  loop status, step/context counts, inspected paths, stop reason, and summaries.
  `POST /tasks/:taskID/pause-agent-loop`, `POST
  /tasks/:taskID/abort-agent-loop`, and `POST
  /tasks/:taskID/resume-agent-loop` persist control timestamps, notes, resume count, and
  explicit `UserPaused`/`UserAborted` stop reasons. Active requests finish the
  current step before stopping; resume continues the same loop and remaining
  budgets. The macOS action rail shows state-specific Pause, Abort, and Resume
  controls.
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
- Restricted `CreateFile` apply for new Markdown files under `docs/`.
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
  bounded output chunks plus exit code in task state, and exposes macOS Tests
  tab/action-rail surfaces for selectable approved commands.
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
- Read-only commit preparation preview from the runtime, surfaced in the macOS
  Review UI with suggested commit message, included files, validation
  suggestions, preflight metadata, blockers, risk notes, and a non-mutating
  operation boundary. The preflight includes git author identity, staged/
  unstaged/untracked counts, line stats, large-change warnings, validation
  state, hook-risk disclosure, and the commit path limit.
- Branch preparation preview and explicit local branch create/switch actions
  from the macOS Review UI. The runtime validates the target branch name,
  detects whether it will create or switch, exposes structured preflight
  metadata for target/current/worktree/existing/action readiness, requires
  expected HEAD and current branch values from the reviewed preview, blocks
  default-base branch targets, blocks unmerged files, blocks switching existing
  branches with dirty working trees, and records a linked task event when
  possible.
- Branch publish preview and explicit first-push/upstream setup from the macOS
  Review UI. The runtime chooses or validates a configured remote, compares
  current branch work against the default base branch, lists commits to
  publish, exposes structured preflight metadata for branch/remote/base/
  commit/worktree/action readiness, blocks default-base/detached/
  already-upstream/no-commit/unmerged states, blocks remote branch collisions,
  rechecks expected HEAD, branch, remote, and remote branch values, then runs a
  non-force `git push --set-upstream <remote> HEAD:<branch>` when approved.
  Failed git pushes are classified into common auth, non-fast-forward,
  protected-branch, network, remote-rejected, or unknown failure summaries
  before being shown in the app.
- Explicit local git commit action from the macOS Review UI. The runtime
  requires a fresh expected-HEAD value, explicit confirmation, selected paths
  from the current working tree, no unmerged files, and no staged files outside
  the reviewed selection before it stages those paths and creates one local
  commit. It does not push.
- Push preparation preview and explicit current-branch push action from the
  macOS Review UI. The runtime requires expected HEAD, branch, and upstream
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
- Read-only PR handoff preview from the macOS Review UI. The runtime resolves
  a default base branch when possible, compares current branch work against
  that base, suggests a branch name, PR title, draft body, test plan, commits,
  changed files, structured preflight metadata, blockers, and risk notes, and
  explicitly does not create or publish a PR. The preflight summarizes base ref
  resolution, head/upstream readiness, fork-like or multi-remote risk,
  validation state, test evidence, and publication readiness.
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
  exact source-file replace, multi-hunk source patch, applied-file rollback
  metadata, explicit source replace/patch rollback, restricted docs create-file
  apply, SQLite restart recovery, runtime health diagnostics, model-provider
  settings GET/POST, fake-key handling without secret persistence, a mock
  OpenAI model-guided context loop, provider-selected agent run step and
  bounded agent run loop,
  blocked-to-repaired proposal handling, and bounded blocked preview-only
  proposal handling, plus failed project validation repair brief generation
  and follow-up repair proposal generation.
- A local foundation walkthrough in `docs/development.md`.
- App-visible runtime state and diagnostics for unchecked/checking/running,
  disconnected, wrong version, provider configuration issues, SSE stream state,
  expected endpoint, database/task count, and copy/open diagnostics actions.
- First-pass app-managed runtime start/stop from the macOS toolbar, sidebar
  runtime badge, and Settings window. The app builds the runtime and launches
  the local Node process directly, then can stop only the process it started.
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

| Horizon | Estimate | Meaning |
| --- | ---: | --- |
| Trust/runtime foundation | 80-85% | Local runtime, task state, review gates, restricted edits, validation, guarded git actions, diagnostics, and smoke coverage are real. |
| Coding-agent demo V0 | 82-86% | Has a first-pass session UI shell, full-screen diff review surface, exact source replace, multi-hunk source patches, streamed/cancellable selectable task commands, failed-command self-fix rerun evidence, and a bounded provider-selected loop with multi-round context budgets plus pause/abort/resume controls, but still needs broader patch orchestration, finer-grained tools, and UI polish before it feels like Codex or Claude Code. |
| Useful developer alpha | 35-45% | A developer cannot yet rely on Forge like Codex or Claude Code for normal coding tasks. It needs real patching, command execution, recovery, and a stronger model-backed run loop. |
| Commercial beta | 20-25% | Needs installable packaging, onboarding, GitHub/provider setup, trust polish, and repeated success on real repos. |
| Polished v1 product | 15-20% | Forge feels like a complete native Mac product with runtime management, indexing, packaging, updates, onboarding, billing, and integrations. |

## Distance To "Finished"

Forge is past the "blank prototype" stage and has a credible architecture
skeleton. The product direction has now shifted from proving safety surfaces to
making the first demo feel like an agent coding app.

The hardest remaining work is not the app shell. The hardest remaining work is:

- a richer model-backed coding loop with read/search tool choices and broader
  patch/recovery behavior
- a polished UI that fully matches the handoff, especially exact split-diff,
  durable file-level review state, and decision prompts
- a useful source-code patch engine beyond exact text-based hunks
- reliable repository understanding beyond bounded file scans
- git workflow from dirty tree to approved published PR
- robust command execution and failure recovery
- native macOS distribution, signing, notarization, and updates
- trust polish: permissions, audit trail, secret handling, and clear user
  control

## V0 Finish Line

The old V0 foundation is mostly built. The new V0 finish line is the
Coding-Agent Demo defined in `docs/v0_scope.md`: a user should type a coding
task, approve a plan, watch a live agent run, see code/test activity, review a
real source diff, and approve the final patch.

Remaining V0 gaps:

- polish the first-pass `1a`/`1b`/`14a` shell toward the exact handoff
- polish the first usable `10a` full-screen diff review toward exact handoff
  behavior and durable per-file decisions
- broaden source-file patch proposals beyond exact text hunks and harden
  rollback revalidation/recovery
- split the combined agent-selected repository context action into
  finer-grained search/read choices and broaden patch/recovery behavior
- implement full diff review with per-file reasoning and request-change loop
- keep git/preflight work as supporting infrastructure rather than the main
  demo

## Alpha Finish Line

Alpha is done when Forge can complete small real documentation or code tasks
with a model provider while preserving human review.

Alpha requires:

- richer provider-backed read/search/patch/run/repair in normal flows
- a richer patch format and rollback/recovery
- full diff review matching the design handoff
- streamed terminal/test output in the task
- git status, changed-file inspection, commit preparation, local commit,
  branch publish, guarded push, and PR handoff/publication
- task recovery after runtime restart and common failures
- a clean onboarding path for choosing a repo and provider

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
