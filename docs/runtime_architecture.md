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

### Edit Proposal Validator

Checks proposed file changes against the current workspace before apply. The
v0 validator confirms supported operation type, safe Markdown path, existing
target file for modify operations, non-existing docs target for create
operations, operation size, whether append text is already present at the file
end, and whether exact replace text appears exactly once.

### Edit Proposal Applier

Applies an explicitly approved proposal through restricted file operations.
The v0 implementation supports append-text edits and exact replace-text edits
to existing Markdown files in `README.md` or `docs/`, plus create-file edits
for new `docs/*.md` files. It revalidates before writing and records rejected
or superseded proposals without touching files.

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
create a PR.

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
policy locally.

Tasks enter `Testing` after apply and only move to `Completed` after
validation passes. Failed validation moves the task to `Failed` with command
results preserved for review.

Current validation repair slice: when a validation run fails, the runtime asks
the model provider for a repair brief using compact failed command summaries.
The brief records likely cause, recommended actions, and a follow-up prompt in
task state. It does not rerun commands or mutate files; it turns failure output
into a reviewable next step.

After a repair brief exists, the runtime can generate a follow-up validation
repair proposal. It archives the previously applied proposal, links the new
proposal to the repair brief, validates the proposal, and returns to human
review. This still does not apply files automatically.

### Permission Manager

Decides whether an action can run automatically or requires user approval.
For validation presets, it derives `Blocked`, `NeedsApproval`, `Ready`, or
`Running` from task state, preset risk, approval records, and active validation
runs.

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
