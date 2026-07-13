# Security And Permissions

Document role: record Forge's trust model, approval gates, command risk
levels, and audit requirements.

## Security Principle

Forge should make agent power safe by making actions explicit, reviewable, and
auditable.

## Trust Model

The user owns:

- repository access
- command approval
- file change approval
- git commit and push approval
- external publishing approval

The agent can propose and execute within policy, but it should not silently
cross trust boundaries.

## Action Risk Levels

### Low Risk

Examples:

- read allowed files
- search repository
- inspect git status
- inspect bounded git diffs for repo-relative changed files
- prepare a read-only commit review artifact from git status, optional task
  context, and latest task validation state
- prepare a read-only branch review artifact from current branch status,
  suggested task branch, target branch validation, dirty state, preflight
  readiness, blockers, and risk notes
- prepare a read-only branch publish review artifact from current branch
  status, configured remotes, default-base comparison, commit summaries,
  uncommitted local changes, preflight readiness, blockers, and risk notes
- prepare a read-only PR handoff artifact from branch status, default-base
  detection, commit summaries, changed files, optional task context, and latest
  task validation state plus preflight evidence
- prepare execution proposal context through bounded read-only repo tools after
  plan approval
- read project docs

Can run automatically after workspace access is granted.

Current git review endpoints are low risk and read-only. They run `git status`
and `git diff` without a shell, require repo-relative paths for per-file diffs,
and block `.git` and `.forge` internals. The commit-preview endpoint only
summarizes the working tree, task context, validation state, suggested next
checks, and commit preflight metadata such as git author identity status,
staged/unstaged/untracked counts, line stats, large-change warnings, and hook
risk disclosure. The PR-preview endpoint only summarizes branch/base/upstream
state, draft PR metadata, commits, changed files, validation evidence,
preflight readiness, blockers, and risk notes. The branch-preview endpoint
only summarizes target branch validation, default-base target blocking,
create/switch mode, dirty state, local/remote branch state, preflight
readiness, blockers, and risk notes. The
branch-publish-preview endpoint only summarizes current branch, remote, remote
branch, default-base comparison, commits to publish, local changes, preflight
readiness, blockers, and risk notes. The push-preview endpoint only summarizes
branch/upstream/remote/commit/worktree preflight readiness, blockers, and risk
notes. These endpoints must not stage, unstage, commit, checkout, reset,
clean, push, create pull requests, call external hosting APIs, or otherwise
mutate the repository.

The execution-context pass after plan approval uses the same low-risk
`list_repo_files`, `search_repo_context`, and `read_context_file` tools. It
does not mutate files, run commands, or perform git/network side effects.

### Medium Risk

Examples:

- edit files in workspace
- run test commands
- install project dependencies
- generate local indexes

May run automatically based on settings, but should be logged and visible.

Current v0 edit application is medium risk and requires explicit human apply.
It supports Markdown append operations, new allowlisted Markdown/source/text
files, exact single-match replacements, and multi-hunk exact text patches. A
coordinated proposal is limited to eight unique normalized targets and a
bounded total operation payload; duplicate or over-budget sets are blocked
before mutation. Apply records planned/applied/restored paths, and a later
write failure triggers best-effort reverse-order restoration of completed
writes. Rollback remains a separate explicit medium-risk mutation: Forge
verifies the current file still matches the recorded post-apply hash before
restoring a local snapshot or deleting a created file.

Current v0 post-apply validation defaults to built-in `forge:` checks. It can
also run allowlisted project validation presets, such as runtime `npm run
check` and `npm run build`, after task-level approval. These commands are
logged and visible, run without a shell, use repo-local cwd values, and are not
accepted from arbitrary user input. Workspace validation config can compose
runtime-known command IDs, but it cannot provide raw command strings.
The Review panel now presents these commands as task-specific permission
requests with approval state, blocked reasons, command boundary, and last-run
metadata before the user approves or runs them.

Current task-scoped command execution reuses the same command catalog and
approval records, but runs a single command by ID as part of the live task
session instead of only as post-apply validation. `POST
/tasks/:taskID/run-task-command` accepts no raw shell, blocks concurrent
validation/command runs, runs project commands with `spawn` and `shell:false`,
stores bounded output chunks plus exit status, and streams command output to
the app. Failed task-command output can generate a provider repair brief and a
linked review-only self-fix proposal through the existing human-gated proposal
path. Active task commands can be cancelled through `POST
/tasks/:taskID/cancel-task-command`, but only by referencing a runtime-owned
active `taskCommandRunID`; the API never accepts arbitrary PIDs or shell text.
Cancellation records an audit entry and marks the run `Cancelled` rather than
creating a failure repair brief. The macOS command chooser is populated from
runtime-derived task-command permissions and still sends command IDs only; the
runtime rechecks command catalog membership and preset approval before
execution. After a reviewed command-sourced self-fix is applied,
`POST /tasks/:taskID/rerun-repair-command` can rerun only the original failed
command ID already captured in `commandRerunEvidence`; it does not accept raw
shell text, arbitrary command IDs from the caller, or arbitrary PIDs.

`POST /tasks/:taskID/run-agent-step` does not grant new permissions. The model
provider can choose only one enum action. A provider-selected
`GatherRepositoryContext` may supply bounded search terms and repo-relative
read paths, but the runtime filters those paths through the existing safe
repository file list, executes only logged read-only list/search/read tools,
stores inspected paths and newly discovered paths for audit, and blocks
repeated requests. Inside `run-agent-loop`, the runtime also owns a separate
zero-to-three-step context budget, rejects over-budget model choices before
running repository tools, and pauses when a context request finds no new
files. The runtime reuses the existing proposal, command, validation repair,
and rerun-evidence gates before any side effect. A provider-selected
`RunTaskCommand` is accepted only for a runtime-known command whose
task-command permission snapshot is already runnable. A provider-selected
`RerunRepairCommand` is accepted only for stored ready/failed rerun evidence.
Waiting for human review and requesting plan approval are explicit blocked
states, not silent no-ops.

`POST /tasks/:taskID/run-agent-loop` does not add a broader autonomy tier. It
repeats the same `run-agent-step` boundary under a runtime-enforced step limit
plus a smaller repository-context limit and stops at review gates, passed
commands, verified self-fix reruns, context-budget exhaustion, blocked/failed
steps, busy-task guards, no-progress guards, or max-step protection. It cannot
apply a proposed patch, invent raw shell commands, commit, push, or publish
anything.

Agent Loop controls do not broaden permissions. Pause and abort require an
exact task-local loop ID and only set runtime-owned cooperative stop intent;
they do not kill arbitrary processes or roll back completed work. Resume is
accepted only for a loop stopped with `UserPaused`, with remaining steps, no
busy validation/command, and no proposed edit waiting for review. It reuses
the stored provider, preferred command ID, step/context budgets, and every
existing action gate. Cancelling a command remains a separate exact-run-ID
operation.

### High Risk

Examples:

- delete files
- run destructive shell commands
- change permissions
- commit
- push
- deploy
- upload private code
- modify external services

Requires explicit approval.

Current local commit implementation is high risk and requires explicit user
confirmation from the macOS Review panel. The runtime then rechecks the
expected HEAD from the commit preview, validates selected repo-relative paths,
rejects unmerged files, rejects staged files outside the reviewed selection,
preflights git author identity, stages only the selected files, and creates
one local commit. It does not push, merge, reset, delete branches, or publish
anything externally.
If git author identity is missing, the preview is blocked before the user can
start the commit. Local git commit hooks may still reject the final commit;
Forge surfaces the command output and still does not push or publish.

Current branch create/switch implementation is high risk and requires explicit
user confirmation from the macOS Review panel. The runtime rechecks expected
HEAD and current branch from the branch preview, validates the target branch
name, blocks default-base branch targets, blocks unmerged files, blocks
switching to existing branches when the working tree is dirty, and then runs
either local branch creation or local branch switching. It does not set
upstream tracking, push, merge, reset, delete branches, or publish anything
externally.

Current branch publish implementation is high risk and requires explicit user
confirmation from the macOS Review panel. The runtime rechecks expected HEAD,
current branch, remote, and remote branch from the branch publish preview,
blocks detached/default-base/already-upstream/no-commit/unmerged states,
blocks remote branch collisions, and uses a non-force
`git push --set-upstream <remote> HEAD:<branch>` to publish the current branch
and set upstream. If the git push fails, Forge classifies common auth,
non-fast-forward, protected-branch, network, remote-rejected, and unknown
failures before surfacing bounded output. It does not force push, merge,
reset, delete branches, or create a PR.

Current push implementation is also high risk and requires explicit user
confirmation from the macOS Review panel. The runtime rechecks expected HEAD,
branch, and upstream from the push preview, blocks detached/no-upstream/
behind/no-ahead/unmerged states, and uses a non-force push to the configured
upstream branch. If the git push fails, Forge classifies common auth,
non-fast-forward, protected-branch, network, remote-rejected, and unknown
failures before surfacing bounded output. It does not force push, merge,
reset, delete branches, or create a PR.

## Approval Dialogs

Approval requests should show:

- action
- reason
- target
- risk
- exact command or file list when applicable
- consequence of approving

Avoid vague prompts like "continue?"

## Audit Log

Forge should record:

- who approved
- when approval happened
- what was approved
- command output
- validation command results
- file changes
- git operations
- external tool calls

## Sensitive Data

Forge must avoid exposing:

- API keys
- credentials
- tokens
- private customer data
- local secrets
- SSH keys
- environment files

The context builder should respect ignore rules and future secret detection.

Remote model provider rule:

- `FORGE_MODEL_PROVIDER=local` remains the default.
- `FORGE_MODEL_PROVIDER=openai` is explicit consent to send compact task
  context to OpenAI or the configured compatible base URL.
- The OpenAI provider slice sends task state, recent task messages, file
  reference summaries, context file summaries, plan steps, changed-file names,
  and proposal metadata. It should not upload whole repositories.
- Runtime health may report whether a secret is configured, but it must not
  return secret values.
- Runtime model-provider settings persist only non-secret values in
  `.forge/model-provider-settings.json`.
- The macOS app stores OpenAI API keys in macOS Keychain and syncs them into
  runtime memory through `POST /settings/model-provider`; the runtime does not
  persist API keys to disk.
- Clearing the OpenAI key from Settings deletes the Keychain item and asks the
  runtime to clear its in-memory copy.
- Remote model output is guidance only. The runtime must continue to validate
  proposals and require approval before file, command, git, or external side
  effects.

## Emergency Controls

The user should be able to:

- stop a running task
- revoke workspace access
- disable tools
- purge memory
- clear command logs
- remove integrations

## Product Promise

Forge should feel powerful, but never sneaky.
