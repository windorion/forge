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

Runtime process resolution now separates two paths:

- runtime installation directory: where `dist/server.js` and runtime package
  files live
- repository root: the workspace Forge should inspect, provided by
  `FORGE_REPO_ROOT` when the runtime is packaged separately from a checkout

When `FORGE_REPO_ROOT` is omitted, development mode still treats the runtime
directory's parent as the repository root.

## Core Modules

`runtime/src/server.ts` is now a one-line packaged bootstrap. The 476-line
`runtime/createForgeRuntime.ts` composes explicit core and validation domain
assemblies plus repository/task/agent services. HTTP adaptation is grouped by
system, task, agent, edit, validation, Git, and settings; Git workflow, agent
orchestration, edit operations, validation/process execution, TaskState/event
publication, and provider settings are separate typed modules. The completed
behavior-preserving migration and readability follow-up are recorded in
`docs/runtime_server_refactor.md`. The result retains the HTTP, persistence,
approval, audit, observer-mode, and packaging contracts described here.

For the current code-level object graph, dependency wiring, UML component
model, startup/request pipeline, and task/Agent/edit/validation/Git sequence
diagrams, see `docs/runtime_server_architecture.md`.

### Performance Budget Runner

`runtime/scripts/performance-campaign.mjs` measures the assembled production
runtime through its loopback HTTP boundary rather than benchmarking replacement
implementations. A fresh synthetic Git repository and SQLite store cover cold
startup, retained-task listing, cold/unchanged indexing, Git status/diff, and a
prepared deterministic local Agent Run Step. The runner also samples the child
process's idle resident memory and CPU after startup work decays.

`runtime/src/performanceBudget.ts` is the pure reporting/policy boundary. It
calculates deterministic min/mean/p50/p95/max summaries, evaluates hard and
advisory ceilings, compares same-profile reports using both percentage and
absolute noise thresholds, and renders versioned JSON/Markdown evidence. The
authoritative smoke/standard/large profiles live in
`runtime/performance-budgets.json`; profile and environment metadata travel
with every report. No remote provider, external network, UI automation, or
Forge-worktree mutation is part of the campaign. The hosted smoke gate uploads
evidence instead of silently refreshing a baseline. Detailed operation and
limitations are in `docs/performance_budgets.md`.

### Task Queue

Stores pending, running, completed, and failed tasks. The current scheduler
also stores an optional ordered `queueRequest` inside each durable task
snapshot. `GET /queue` derives running, queued, needs-attention, and completed
lanes from real task/loop state. `POST /queue/settings` persists a global
ceiling from 1-3, `POST /queue/reorder` requires every queued task exactly
once, and `POST /tasks/:taskID/remove-from-queue` returns an approved task to
an execution-ready human-review state.

This runtime instance owns one repository, so its effective repository limit
is always one even when the future global ceiling is two or three. Approved
Agent Loops are serialized rather than allowed to overlap workspace mutation.
In normal `automatic` mode, when an active loop reaches a terminal checkpoint,
the next ordered request is removed from the queue and started. Persisted
requests dispatch on startup; an interrupted active loop is recovered
separately under the existing `RuntimeRestarted` checkpoint rule. Direct
one-step execution is rejected while another task's loop owns the repository
slot. Queueing changes scheduling only: it does not approve commands, apply
edits, or grant provider permissions.

Mission Control active background children instead set
`FORGE_QUEUE_DISPATCH_MODE=supervised`. Every approved Agent Loop is persisted
as queued even when the repository is idle; startup, loop-finally, and settings
callbacks cannot dispatch it. Health and `GET /queue` report the mode.
`POST /queue/dispatch-next` is the only grant path. It requires the exact
runtime authorization ID, chooses only the repository-local queue head, returns
`202` with accepted/task/queue evidence, and still respects the one-repository
active-loop limit. A stale ID returns 403; the route on an automatic runtime
returns 409. The grant changes scheduling only and does not approve a plan,
command, proposal, file mutation, or Git action.

### Observer Runtime Mode

Mission Control may launch up to two additional runtimes with
`FORGE_RUNTIME_MODE=observer` and unique loopback ports. Observer mode is a
separate read-only capability boundary:

- existing SQLite task stores open with the SQLite read-only flag; a repository
  without a task store receives an in-memory empty schema; an observer refuses
  an older schema and asks the primary runtime to complete the ordered
  migration first
- startup Agent Loop and edit-transaction recovery do not run
- persisted queue requests do not dispatch
- every non-GET HTTP request is rejected with `403 observer_read_only`
- `GET /tasks`, `GET /tasks/:taskID`, and `GET /queue` reload committed task
  payloads before returning
- health reports `runtimeMode: observer` and `readOnly: true`

The macOS supervisor validates mode, read-only status, and exact repository
root before accepting an observer. It polls health, tasks, queue, and Git every
two seconds and owns only the child processes it launched. Observers cannot be
promoted implicitly into mutation runtimes.

An explicit Mission Control confirmation may replace one observer with an
active runtime for the current app session. The supervisor generates a unique
authorization ID and timestamp, passes them only to that child, forces the
local deterministic provider with a runtime lock that ignores persisted remote
provider selection and rejects provider-setting changes, and expects health to return `primary`,
`readOnly: false`, the scoped authorization evidence, and the exact repository
root. The child must also report `queueDispatch.mode: supervised` and grant
acceptance; a mismatch terminates the process. Active startup intentionally
restores interrupted-state recovery but not autonomous queue dispatch for that
repository. Revocation terminates
the active child and starts a fresh read-only observer on the same unique port;
the authorization is not persisted across app launches.

The native supervisor is also the repository-scoped task router. Read-only
task-card navigation performs a fresh health check, then fetches the exact task
through `GET /tasks/:taskID` without changing the primary workspace. Task
creation, conversation, plan regeneration/approval, proposal-file review,
Apply, validation-catalog approval/run, task-command run/cancel, reviewed
repair rerun, and Git actions require an accepted active runtime. The routed
review loader fetches the validation permission envelope and Git status,
commit, branch, publish, push, and PR previews from that exact loopback child;
file diffs remain bounded read-only evidence. Local commit, branch creation or
switch, first publish, and current-branch push requests are constructed only
from the reviewed task ID, expected HEAD/branch/upstream/paths, and exact
runtime confirmation strings. Missing evidence fails before an HTTP request.
Immediately before each mutation, the supervisor rechecks exact repo root,
primary/read-write mode, `repository-active` scope, and the current memory-only
authorization ID. All mutations for one repository share one in-flight key;
runtime revocation is blocked until that scoped request completes. Any identity
or authorization mismatch terminates the child and clears its active
authorization. PR publication is intentionally not routed through Mission
Control because the focused workflow owns per-request Keychain/GitHub consent.

The native supervisor aggregates only authorized background queue snapshots.
Its persisted limit is 1-2 simultaneous background repositories; each runtime
still serializes its own writes to one Agent Loop. With capacity, the scheduler
selects the oldest eligible queue initially, then walks eligible repositories
round-robin from the last successful grant. Offline, observer, automatic-mode,
busy, and empty repositories are skipped. The cursor and authorization are
session state; queued requests remain durable in their owning SQLite store, so
a runtime restart fails closed to waiting rather than dispatching outside
supervision.

Supervisor connectivity is bounded rather than a fixed two-second hammer. A
failed health/data refresh records repository-scoped telemetry and defers the
next poll with a `2, 4, 8, 16, 30` second capped exponential schedule. A
successful validated refresh resets only the consecutive-failure/backoff state
and increments the recovery count while retaining cumulative failure and
restart lineage. If a supervisor-owned child exits unexpectedly, Mission
Control keeps the same in-memory desired mode and session authorization, waits
for the same bounded deadline, and relaunches it; startup still cannot dispatch
supervised queue work without a fresh grant. Repository, runtime-mode,
read-only, authorization, or queue-dispatch identity mismatches remain hard
failures: the child is terminated, authorization and automatic restart intent
are cleared, and no reconnect policy can turn invalid evidence into access.
The app exposes consecutive/total failures, restart attempts, successful
recoveries, last connection, and next retry in its existing diagnostics and
compact repository footer. These counters are session-only operational state,
not durable user/task data.

The Swift supervisor process boundary is now covered by a bundled headless Node
fixture. SwiftPM starts it through the same `Process`, environment, loopback,
health, task, queue, and Git paths used by production supervision. The fixture
first drops and restores its listener without changing PID, then the test sends
`SIGKILL` to the observed supervisor-owned PID. Assertions cover cached state
during both retry windows, same-session authorization, supervised queue mode,
new-PID relaunch, retry/restart/recovery telemetry, and an event log containing
no POST or queue-dispatch request. Production defaults remain the fixed 17374+
ports, two-second monitor interval, and 2/4/8/16/30-second retry schedule; only
the test configuration accelerates time and selects a random loopback port.

### Agent Orchestrator

Coordinates planning, execution, testing, review, and user approval states.

### Context Builder

Builds compact task context from:

- user prompt
- task conversation
- repository metadata
- file search
- symbol search
- recent task memory
- project docs
- git diff

Current v0 implementation: the runtime performs a bounded read-only repository
context pass during Agent Loop v0. It lists safe repo-local source, config,
script, and documentation files; derives search terms from the task objective,
recent messages, and explicit file references; scores path/content matches;
then reads selected context files with repo-local safety checks. This is not a
full index yet.

Current OpenAI provider slice: before generating a plan revision, the provider
can run a bounded model-guided context loop. Each round returns either
`SearchAndRead` with bounded search terms and repo-relative read paths or
`ReadyForPlan` to stop. The runtime owns validation and execution, runs only
logged read-only repo tools, stops on repeated requests or the round limit,
and feeds compact summaries back into the plan revision. This is the first
bounded tool loop, still limited to read-only pre-plan context.

Current execution-preparation slice: after a user approves the plan, the
runtime performs another bounded read-only context pass before calling the
provider for an execution proposal. It records normal tool events, merges
inspected context files into the task, and attaches `contextFiles` plus
`toolEvidence` to the execution proposal. This makes the Coder step more
agent-like without allowing autonomous writes, commands, git, or network
side effects.

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

Current read-only context tools:

- `list_repo_files`
- `search_repo_context`
- `read_context_file`

The same tools are currently used in both planning context and execution
proposal context. They remain read-only and repo-local.

### Model Providers

Defines the boundary between agent orchestration and LLM/local model backends.

The provider layer should:

- expose provider id, display name, model name, and local/remote mode
- accept structured task context
- return structured proposals or model outputs
- avoid direct file, command, git, or network side effects
- make missing credentials or unsupported providers explicit

### Task Conversation And Intent Intake

Stores task-scoped user and assistant messages. Creating a task records the
initial objective as a user message, then asks the model provider for a
structured intent brief. Follow-up task messages use the same provider boundary
to update the brief with summary, constraints, acceptance criteria, open
questions, and next action.

When the latest brief has open questions, the runtime sets the task to
`Human Review / Clarification`, blocks the legacy planner loop, and rejects
plan approval. A follow-up answer that clears the questions automatically
generates the plan revision; ordinary later conversation updates still wait
for an explicit regenerate action.

Task messages can also carry repo-local file references parsed from paths in
the message body, including `README.md`, `docs/example.md`, or
`@runtime/src/server.ts:120`. The runtime owns parsing and safety checks. It
resolves existing safe files, stores compact summaries on the message, and
records missing or blocked references without reading outside the repository.
The conversation supports task understanding; it should not replace the task,
review, diff, or validation surfaces.

### Plan Revision Generator

Turns the latest task conversation and structured intent brief into a
reviewable plan revision. A revision records provider metadata, source message,
intent summary, rationale, risk level, generated timestamp, and revised plan
steps. The runtime enriches every revision with expected file areas,
validation plan, explicit risk notes, and bounded estimated minutes/cost; local
provider cost is recorded as zero. Generating a revision clears any prepared execution proposal, updates
the visible planner, returns the task to `Human Review`, and requires a fresh
plan approval targeted at that revision before execution can continue.

Plan revision generation is blocked while an edit proposal is proposed or
applied, because the user must resolve the current change review before
changing the plan beneath it.

`POST /tasks/:taskID/approve-plan-and-run` is the V0 product path. It reuses
the same clarification and current-plan approval checks as `approve-plan`,
prepares the read-only execution proposal, then immediately enters
`run-agent-loop` with runtime-owned limits. It does not weaken file, command,
apply, commit, push, or PR gates.

### Edit Proposal Generator

Creates proposed file changes and diff previews without mutating the working
tree. This sits before real edit/apply tools and gives the user a reviewable
artifact while preserving the human approval boundary.

When an edit proposal is rejected, the generator can revise it from the latest
task conversation. The runtime archives the rejected proposal, records the new
proposal revision metadata, validates the new artifact, and returns the task to
human review. The revision path must not write files.

Current provider-backed repair slice: after generating an edit proposal, the
runtime validates it immediately. If validation is blocked, the runtime can ask
the provider for a bounded number of repair attempts with the failed per-file
checks included as structured feedback. Each blocked intermediate proposal is
archived as `Superseded`; the current review artifact is only the final
proposal. This is still proposal-only and does not mutate files.

Execution proposals are now generated after the execution-context pass. The
provider still only proposes actions; runtime validation and human review own
all later file changes.

### Edit Proposal Validator

Checks proposed file changes against the current workspace before apply. The
validator confirms supported operation type, safe paths, unique proposal
targets, existing modification targets, non-existing docs create targets, and
bounded operation sizes. Unified Diff validation requires one matching file
section, ordered ranges, exact hunk counts, and current-file context/deletion
lines at every declared location.

### Edit Proposal Applier

Applies an explicitly approved proposal through restricted file operations.
The v0 implementation supports append-text edits to existing Markdown files in
`README.md` or `docs/`, exact replace-text edits to existing Markdown or
allowlisted source/text files, multi-hunk exact patch-text edits to one
existing Markdown or allowlisted source/text file, strict context-anchored
Unified Diff modifications with EOF marker handling, plus reviewed create and
delete operations for allowlisted source/text files.
It revalidates the full proposal before writing, records a cross-file
transaction, verifies every resulting SHA-256, and compensates already-written
files if a later write fails. Each file's before/after hashes and rollback
snapshot are persisted in a versioned write-ahead journal before mutation.
Startup reconciles persisted `Running` transactions only from those hashes:
Apply returns to Before, a completed Rollback is finalized, and a mixed
Rollback returns to Applied. Unknown content fails closed. Recovery state
remains persisted and auditable.

### Edit Proposal Rollback

Rolls back an explicitly applied proposal through another guarded mutation
endpoint. The runtime stores restore snapshots in `.forge/rollback-snapshots/`
during apply, verifies current file hashes before rollback, restores previous
contents or deletes files created by the proposal, and verifies every result
before marking the proposal `RolledBack`. If a later rollback file fails, the
runtime attempts to reapply and verify already-restored files so the workspace
returns to the prior applied state.

### Git Review Surface

Exposes read-only git state for review. The runtime provides
`GET /git/status` for branch, head, dirty state, staged/unstaged/untracked
files, and available line stats. It provides `GET /git/diff` for a bounded
per-file diff from a repo-relative path. These operations run `git` without a
shell, block `.git` and `.forge` internals, and never commit, checkout, reset,
stage, or mutate files.

The macOS Review panel consumes these endpoints as the first native
working-tree surface. It prioritizes files related to the selected task, shows
open/reveal actions, and renders a compact side-by-side diff preview.

The runtime also provides `GET /git/commit-preview` as a non-mutating review
artifact. It summarizes the current working tree, optional selected task, and
latest task validation state into a suggested commit message, included files,
validation commands to consider, risk notes, and blockers. This endpoint must
remain read-only; actual stage, commit, push, or PR publication are separate
high-risk actions that require explicit approval.

Branch review is the first branch-management slice. `GET /git/branch-preview`
suggests or validates a target branch, detects whether Forge would create a
new local branch or switch to an existing local branch, and returns current
branch, expected HEAD, base branch, dirty state, structured preflight
metadata, blockers, and risk notes. The preflight summarizes target branch
validity, current/default branch state, dirty-worktree handling,
existing-local or remote-collision state, and action readiness.
`POST /git/branch` is a high-risk action. It requires explicit confirmation
plus expected HEAD and current branch from the preview, validates the target
branch name, blocks default-base branch targets, blocks unmerged files, blocks
switching existing branches while the working tree is dirty, and then runs
local `git switch --create <branch>` or `git switch <branch>`. It does not set
upstream tracking, push, reset, delete branches, or publish a PR.

Branch publish is the remote tracking slice after local branch creation.
`GET /git/branch-publish-preview` summarizes the current branch, configured
remote, remote branch, default-base comparison, commits to publish, dirty
working-tree state, structured preflight metadata, blockers, and risk notes.
The preflight summarizes branch, remote, base, commit-range, worktree, action
readiness, and classified remote failure risk. `POST /git/branch-publish` is
a high-risk action. It requires explicit confirmation plus expected HEAD,
branch, remote, and remote branch from the preview. The runtime blocks
detached/default-base/already-upstream/no-commit/unmerged states, blocks
remote branch collisions, and runs a non-force
`git push --set-upstream <remote> HEAD:<branch>`. If git rejects the push, the
runtime classifies common auth, non-fast-forward, protected-branch, network,
remote-rejected, and unknown failures before surfacing output. It does not
create a PR. Remote branch collision detection checks local remote-tracking
refs and `git ls-remote --heads`, so stale local refs do not hide an already
published remote branch.

The local commit action is `POST /git/commit`. It can create one local
commit only after the app sends explicit confirmation from the reviewed commit
card. The runtime rechecks expected HEAD, validates selected paths against the
current status, rejects unmerged files and staged files outside the reviewed
selection, preflights git author identity, stages selected paths, creates the
commit, and records a linked task event when possible. It does not push.

The upstream push action is `POST /git/push`. It is paired with
`GET /git/push-preview`, which shows branch/upstream state, ahead/behind
counts, commits to push, dirty working-tree state, structured preflight
metadata, blockers, and risk notes. The preflight summarizes branch, upstream,
remote, commit-range, worktree, action readiness, and classified remote
failure risk. The push action requires explicit confirmation plus expected
HEAD, branch, and upstream from the preview. The runtime blocks detached/
no-upstream/behind/no-ahead/unmerged states and uses a non-force push to the
configured upstream. If git rejects the push, the runtime classifies common
auth, non-fast-forward, protected-branch, network, remote-rejected, and
unknown failures before surfacing output. It does not create a PR.

`npm run smoke:git-remote` exercises the push and branch publish paths against
temporary local bare remotes through the real runtime HTTP API. It covers stale
remote/non-fast-forward push rejection, branch-publish remote branch collision,
and pre-receive remote policy rejection.

The PR preview remains read-only. `GET /git/pr-preview` derives a review
artifact from branch state, default-base detection, optional task context,
commit summaries, changed files, latest validation state, blockers, structured
preflight metadata, and risk notes. It also resolves base/head remote topology
from local git metadata. In the common contributor layout, `origin` is the fork
head and GitHub `upstream` is the base; owner/repository parsing does not call a
discovery API. The explicitly confirmed `POST /git/pr-publish` re-derives that
topology, rejects stale HEAD/branch/base or a conflicting supplied owner,
pushes the head remote without force, creates the PR in the base repository,
and persists task lineage.

`POST /git/pr-status` is the runtime's one-shot, read-only metadata executor.
It accepts a per-request token and Manual/Background source, reads PR, review,
check-run, and mergeability evidence, and persists at most 20 credential-free
attempt records including timestamps, request count, changed flag, status, and
summary. Timing and quota policy intentionally stay outside the runtime in the
macOS app, where Keychain can be read once per bounded cycle. The runtime does
not retain the token, schedule network work, merge, close, approve, comment,
rerun checks, or mutate branches during refresh.

### Validation Runner

Runs controlled post-apply validation and records command-level results. The
v0 runner has a preset registry:

- `forge-post-apply`: low-risk built-in `forge:` audit checks.
- `runtime-typescript`: medium-risk project commands for `runtime`
  (`npm run check` and `npm run build`).
- `macos-swiftpm`: medium-risk project command for the native app
  (`swift build` from the repository root).

Workspace presets can be loaded from `.forge/validation-presets.json`. They
compose runtime-known command IDs and cannot introduce raw shell commands.

Medium-risk presets require task-level approval before execution. Project
commands are allowlisted by the runtime, run without a shell, use repo-local
cwd values, and preserve exit code plus output summary.

The runtime also exposes task-specific validation permission snapshots through
`GET /tasks/:taskID/validation-permissions`. The snapshot includes approval
state (including expired/revoked), execution state, blocked reasons, command
execution mode, last-run metadata, bounded approval evidence, and the runtime's
scope/duration policy so the app can show permission requests without guessing
runtime policy locally. Approval can be granted before an edit proposal is applied;
running a validation preset still requires the normal applied-proposal gate.

Validation command approval is resolved by one shared lifecycle module. New
grants are persisted as task-scoped records with a fixed duration (one-hour
default, 24-hour maximum). Revocation appends a linked record rather than
mutating history. Legacy/unbounded, expired, revoked, repository-scoped, and
session-scoped records do not authorize this path. The command runner checks
immediately before spawn; the validation runner also checks between child
commands. Runtime restart recomputes validity from persisted evidence and the
current clock. Revoking while a child is active blocks later starts but leaves
termination to the explicit cancellation service.

Tasks enter `Testing` after apply and only move to `Completed` after
validation passes. Failed validation moves the task to `Failed` with command
results preserved for review.

Current repair slice: when a validation run or task-scoped command run fails,
the runtime asks the model provider for a repair brief using compact failed
command summaries. The brief records likely cause, recommended actions, a
follow-up prompt, and its source (`validationRunID` or `taskCommandRunID`) in
task state. It does not rerun commands or mutate files; it turns failure
output into a reviewable next step.

After a repair brief exists, the runtime can generate a follow-up repair
proposal through the same `generate-validation-repair-proposal` endpoint. For
post-apply validation failures it archives the previously applied proposal,
links the new proposal to the repair brief, validates the proposal, and
preserves changed-file evidence. For task-command failures it can create a
linked review-only repair proposal even when no proposal has been applied yet.
This still does not apply files automatically.

### Task Command Runner

Runs one approved, runtime-known command as part of the live task session
without requiring an applied edit proposal. The current endpoint is
`POST /tasks/:taskID/run-task-command` with a `commandID` only; the app, user,
workspace config, and model provider cannot supply arbitrary shell strings.

The runner reuses validation preset approvals. Low-risk commands can run when
their preset does not require approval. Medium-risk project commands, such as
`runtime-npm-check`, require task-level approval through a preset that includes
that command. Project commands still run with `spawn`, `shell:false`, and a
runtime-owned repo-local cwd.

Each task command run records status, exit code, start/end timestamps, the
approving preset, a compact output summary, and bounded stdout/stderr/system
chunks in task state. The runtime emits `task.command.started`,
`task.command.output`, and `task.command.completed` SSE events so the macOS
Tests tab can show command output as a live coding-agent surface.

The validation permission envelope also exposes a task-command chooser model
for the live session UI. It lists runtime-known project commands by command
ID, deduplicates commands that appear in multiple presets, prefers runnable or
approved presets, includes approval/readiness state and last-run metadata, and
still leaves execution enforcement inside `run-task-command`.

Failed task-command output is now connected to the repair-brief/self-fix
proposal loop. When a command-sourced repair proposal is applied,
`commandRerunEvidence` records the failed source run, repair brief, applied
proposal, and target command ID. `POST /tasks/:taskID/rerun-repair-command`
then reruns that original command through `run-task-command`, attaches the new
command run to the evidence, and marks the task `Repair Verified` only when
the rerun passes. Failed or cancelled reruns remain reviewable and keep their
output linked to the evidence chain.

Active spawned task commands can be stopped through
`POST /tasks/:taskID/cancel-task-command` with a `taskCommandRunID`. The
runtime never accepts arbitrary PIDs; it cancels only the active child process
it started for that run, records a `Cancel Task Command` audit entry, appends a
system output chunk, emits `task.command.cancel.requested` and
`task.command.cancelled`, and marks the run `Cancelled` instead of `Failed`.
Cancelled commands return to human review and do not generate repair briefs.

### Task Cancellation, Audit Export, And Retention

`POST /tasks/:taskID/cancel` is the composed task-level emergency control. It
persists one idempotent cancellation record before stopping work, then removes
a queued Agent Loop request, requests an active loop abort at its next safe
checkpoint, cancels a runtime-owned task-command child, and/or cancels the
active validation child while preventing later validation commands from
starting. Spawned children receive SIGTERM and a bounded SIGKILL fallback; the
API never accepts a PID or raw command. A task reaches the durable `Cancelled`
terminal status only when its loops, steps, commands, validation runs, and
tool calls are all terminal. Plans, proposals, diffs, command output, and
review evidence remain available, while every later task-scoped POST is
rejected; continuing requires a new task rather than silently resurrecting a
cancelled one.

Cancellation survives process failure. Startup first converts persisted
running work into the existing fail-closed restart checkpoints, then completes
any persisted `Requested` cancellation whose in-flight evidence is terminal.
The dedicated `smoke:task-cancel` fixture covers idle/idempotent cancellation,
queue removal, Agent Loop abort, task-command and validation process
termination, cancelled-task immutability, and restart completion.

`GET /tasks/:taskID/audit-export?format=markdown|json` is a read-only endpoint
available to primary and observer runtimes. It produces a versioned export of
task/cancellation state, approvals, events, Agent Loop and tool evidence,
bounded command output, validation results, context-file metadata, file-change
metadata, and edit transaction evidence. It intentionally omits proposal diff
content and provider configuration, then recursively redacts known Bearer,
GitHub/OpenAI token, API-key, password, and secret assignment patterns. The
macOS Audit surface writes either format through a native save panel. Export
envelopes include content/source SHA-256 and source `updatedAt` receipts.

Retention remains keep-by-default with no automatic purge. `GET
/tasks/:taskID/history-retention-preview` reports the bounded command-output
surface and is observer-readable. The primary-only `POST
/tasks/:taskID/purge-history` accepts one terminal task, the exact current
revision, `CommandOutput` scope, explicit confirmation, and a matching audit
export receipt. It clears only task-command chunks and command/validation
output summaries, retains execution metadata and an event, and atomically
saves the task with an append-only schema-v5 purge receipt. `smoke:task-retention`
proves forged receipt rejection, the retained boundary, atomic persistence,
and restart recovery.

SQLite schema changes now run from an ordered migration registry, one
transaction per missing version. Schema v5 is additive. Unit coverage
rehearses v4 → v5 with an existing task, rejects migration from a read-only
observer, and verifies the recovered task plus new receipt table.

Each migration also declares `Additive` or `Destructive`. Writable task stores
hold an owner-only single-writer lease while still allowing observer reads. A
destructive migration calls the backup service before `BEGIN IMMEDIATE`; SQLite
`VACUUM INTO` produces a consistent snapshot and the service verifies integrity,
schema, task count, bytes, and SHA-256 before writing its manifest. Failure to
create or verify that artifact stops before migration SQL. Failed migration SQL
rolls back while retaining the backup.

Restore is deliberately offline rather than an HTTP action. The CLI requires
the exact manifest target and `RestoreForgeDatabaseBackup`, refuses active
writer leases and non-empty WAL, verifies a prepared same-directory copy,
atomically displaces the current database, verifies the restored file, and
writes a receipt. The displaced database remains available as rescue evidence.
The destructive v6 used by unit/smoke coverage is fixture-only; production
schema remains v5.

### Agent Run Step

Agent Run Step v0 is the first provider-driven normal run path. The endpoint
`POST /tasks/:taskID/run-agent-step` asks the active `ModelProvider` for one
safe next action from a bounded enum:

- `InspectRepository`
- `GenerateEditProposal`
- `RunTaskCommand`
- `GenerateValidationRepairProposal`
- `RerunRepairCommand`
- `WaitForHumanReview`
- `RequestPlanApproval`

The provider receives compact task state, task-command permission snapshots,
and runnable command-rerun evidence. It returns an action, summary, rationale,
optional command/rerun evidence ID, and—for `InspectRepository` only—bounded
search terms plus optional repo-relative read paths. The runtime owns and logs
the actual `list_repo_files`, `search_repo_context`, and `read_context_file`
calls. It rejects unsafe or excluded paths, keeps existing read budgets, and
blocks an inspection step that adds no new safe context. Inspection cannot run
commands or mutate files. Normalized search terms/read paths produce a short
SHA-256 request fingerprint and a persisted budget summary. A matching earlier
inspection blocks the new step before duplicate search/read tools. Successful
inspection records classify result quality as Strong, Partial, Weak, or
NoNewContext and persist query coverage, match/file/new-context counts, total
context bytes, plus each context file's byte length, SHA-256, matched-line
count, and match reasons. For every
other action, the runtime rechecks the
existing proposed-edit, plan, concurrency, command approval/catalog, repair
brief, and rerun-evidence gates before doing anything.

Each executed decision is appended to `agentRunSteps` with provider metadata,
action, status, summary, rationale, command/evidence IDs, inspection search and
file evidence, linked proposal or command target, result, error, and
timestamps. The runtime emits
`agent.run_step.started`, `agent.run_step.completed`,
`agent.run_step.blocked`, or `agent.run_step.failed`, so the macOS Log tab can
show a chronological decision trail.

For OpenAI Agent Run Step decisions, structured-output decode, required-field,
and action-enum failures get one corrective request using the same strict
schema. A recovered decision persists its attempt count and bounded first
error. If both responses are malformed, the runtime creates a failed
`WaitForHumanReview` step, emits `agent.run_step.failed`, and stops the loop
with `StepFailed` before any step tool, command, or mutation runs. Transport,
HTTP, and timeout failures remain single-attempt failures rather than risking
duplicate requests across uncertain boundaries.

This runner intentionally performs one step per request so the same boundary
can be reused by manual actions, smoke tests, and the bounded loop.

Edit proposal review is runtime-owned at file granularity. New proposals set
`requiresFileReview`; Apply rejects until every proposed file has a persisted
`Approved` decision. `ChangesRequested` stores path/note/time, rejects and
archives that proposal, then creates a new proposal with `revisionOfID` and the
prior file decisions in provider context. This revision path performs no
workspace mutation.

### Agent Run Loop

Agent Run Loop v0 wraps Agent Run Step with a runtime-enforced `maxSteps`
limit. The endpoint `POST /tasks/:taskID/run-agent-loop` accepts an optional
`preferredCommandID` and optional `maxSteps` between 1 and 8. The loop creates
an `AgentRunLoop` record, invokes provider-selected steps, links each step ID
back to the loop, and stops at explicit safe conditions:

- human review required for a proposed edit
- approved command passed
- reviewed self-fix rerun passed
- step blocked or failed
- task already busy with validation or a command
- no progress recorded
- max-step limit reached

The loop does not introduce new tool permissions. It reuses `run-agent-step`
and therefore inherits the same read budgets, command catalog, approval,
repair brief, rerun-evidence, validation, and review gates. The next
architecture step is to extend safe format recovery to planning requests and
patch artifacts.

Active loops also have cooperative control endpoints:

- `pause-agent-loop` records `PauseRequested` and stops after the current safe
  step with `UserPaused`.
- `abort-agent-loop` records `AbortRequested` and stops after the current safe
  step with `UserAborted`; it does not kill an in-flight command or model call.
- `resume-agent-loop` accepts a paused, aborted, or failed loop checkpoint and
  creates a new bounded loop with preserved forward/backward lineage.

Control requests, notes, timestamps, approvals, and SSE lifecycle events are
persisted. History is append-only: resume never rewrites the source loop.

At startup, any loop still persisted as `Running` cannot have a matching live
runtime coroutine. Forge converts it to `Paused / RuntimeRestarted`, finalizes
linked running steps and other in-memory-only transient records as failed
evidence, clears stale control requests, records
`agent.run_loop.interrupted`, and returns the task to human review. Resume then
creates a new linked loop; it never silently continues an unknown in-flight
command or tool call.

### Permission Manager

Decides whether an action can run automatically or requires user approval.
For validation presets, it derives `Blocked`, `NeedsApproval`, `Ready`, or
`Running` from task state, preset risk, approval records, active validation
runs, and the applied-proposal gate for validation execution. Task command
execution uses the same approval records but has its own run state.
The approval dimension separately reports `NotRequired`, `NeedsApproval`,
`Approved`, `Expired`, or `Revoked`; an execution state can remain `Running`
while its permission has been revoked for all future starts.

### Sandbox Manager

Controls command execution boundaries and records command logs.

### Event Stream

Sends structured events to the app:

- task created
- plan updated
- plan revision started
- plan revision ready
- conversation file references detected
- edit proposal revision started
- edit proposal revision ready
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
