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

### Task Queue

Stores pending, running, completed, and failed tasks.

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
steps. Generating a revision clears any prepared execution proposal, updates
the visible planner, returns the task to `Human Review`, and requires a fresh
plan approval targeted at that revision before execution can continue.

Plan revision generation is blocked while an edit proposal is proposed or
applied, because the user must resolve the current change review before
changing the plan beneath it.

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
Unified Diff modifications, plus create-file edits for new `docs/*.md` files.
It revalidates the full proposal before writing, records a cross-file
transaction, verifies every resulting SHA-256, and compensates already-written
files if a later write fails. Recovery state remains persisted and auditable.

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

The PR handoff slice is still read-only. `GET /git/pr-preview` derives a
review artifact from branch state, default-base detection, optional task
context, commit summaries, changed files, latest validation state, blockers,
structured preflight metadata, and risk notes. It can suggest a branch name,
PR title, draft body, and test plan, while the preflight summarizes base ref
resolution, head/upstream readiness, multi-remote or fork-like review risk,
validation evidence, and publish readiness. It does not call GitHub, publish a
PR, change branches, push, or mutate repository state.

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
state, execution state, blocked reasons, command execution mode, and last run
metadata so the app can show permission requests without guessing runtime
policy locally. Approval can be granted before an edit proposal is applied;
running a validation preset still requires the normal applied-proposal gate.

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

### Agent Run Step

Agent Run Step v0 is the first provider-driven normal run path. The endpoint
`POST /tasks/:taskID/run-agent-step` asks the active `ModelProvider` for one
safe next action from a bounded enum:

- `GenerateEditProposal`
- `RunTaskCommand`
- `GenerateValidationRepairProposal`
- `RerunRepairCommand`
- `WaitForHumanReview`
- `RequestPlanApproval`

The provider receives compact task state, task-command permission snapshots,
and runnable command-rerun evidence. It returns only an action, summary,
rationale, optional command ID, and optional rerun evidence ID. The runtime
then rechecks the existing gates before doing anything: proposed edit review,
plan approval, validation/command concurrency, command approval, command
catalog membership, repair brief readiness, and rerun evidence readiness.

Each executed decision is appended to `agentRunSteps` with provider metadata,
action, status, summary, rationale, command/evidence IDs, linked proposal or
command target, result, error, and timestamps. The runtime emits
`agent.run_step.started`, `agent.run_step.completed`,
`agent.run_step.blocked`, or `agent.run_step.failed`, so the macOS Log tab can
show a chronological decision trail.

This runner intentionally performs one step per request so the same boundary
can be reused by manual actions, smoke tests, and the bounded loop.

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
and therefore inherits the same command catalog, approval, repair brief,
rerun-evidence, validation, and review gates. The next architecture step is to
add pause/abort/resume controls and richer read/search/patch tool choices
inside the same runtime-owned safety model.

### Permission Manager

Decides whether an action can run automatically or requires user approval.
For validation presets, it derives `Blocked`, `NeedsApproval`, `Ready`, or
`Running` from task state, preset risk, approval records, active validation
runs, and the applied-proposal gate for validation execution. Task command
execution uses the same approval records but has its own run state.

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
