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
- inspect bounded Base/Ours/Theirs/working text for current unmerged files
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
- refresh an already-published PR's state, review decision, check runs, and
  mergeability using a per-request token without mutating GitHub
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

Conflict inspection is also low risk and read-only. It accepts only current
safe repo-relative unmerged paths, reads Git index stages without a shell, and
bounds or rejects oversized, binary, irregular, internal, or unavailable
content.

The execution-context pass after plan approval uses the same low-risk
`list_repo_files`, `search_repo_context`, and `read_context_file` tools. It
does not mutate files, run commands, or perform git/network side effects.
`approve-plan-and-run` composes that existing approval with the bounded Agent
Run Loop; it first rejects unresolved clarification or a missing/currently
unapproved plan, and it does not grant any new read, command, edit, Apply, git,
or network permission.

Agent Run Step/Loop may also select `InspectRepository`, but the provider only
supplies bounded search terms and optional repo-relative candidate paths. The
runtime rejects absolute, escaping, ignored, internal, generated, or otherwise
unsafe paths and remains the sole executor of the logged read-only tools.
Inspection adds no command, network, edit, or git permissions, and a request
that produces no new safe context is blocked as no progress. A short SHA-256
fingerprint of normalized terms/paths also blocks an identical later request
before duplicate search/read calls; its active budgets remain visible on the
step audit record.

Malformed Agent Run Step structured output may be requested once more only to
repair its format. The corrective request uses the same bounded schema and
does not execute the proposed action. Attempt metadata and bounded validation
errors are persisted. Exhaustion becomes a failed safe-wait step, so malformed
model output cannot grant a tool, command, file, git, or network capability.

### Medium Risk

Examples:

- edit files in workspace
- run test commands
- install project dependencies
- generate local indexes

May run automatically based on settings, but should be logged and visible.

Current v0 edit application is medium risk and requires explicit human apply.
New proposals also require a persisted approval decision for every proposed
file; whole-proposal Apply cannot bypass pending or requested-change files.
It supports Markdown append/create operations plus exact single-match
replacements and multi-hunk exact text patches for allowlisted source/text
files, strict single-file Unified Diffs whose headers, ranges/counts, context,
and EOF markers match the current allowlisted target, new source/text files
that cannot overwrite, and explicit per-file reviewed deletion of an existing
bounded text file. Delete snapshots are journaled before unlink. Multi-file apply and rollback
are compensated transactions with per-file SHA-256 verification; partial
failures are returned to the last verified state when possible and recorded
as `Recovered` or `RecoveryFailed`. Rollback remains an explicit medium-risk
mutation.

Current v0 post-apply validation defaults to built-in `forge:` checks. It can
also run allowlisted project validation presets, such as runtime `npm run
check` and `npm run build`, after task-level approval. These commands are
logged and visible, run without a shell, use repo-local cwd values, and are not
accepted from arbitrary user input. Workspace validation config can compose
runtime-known command IDs, but it cannot provide raw command strings.
The Review panel now presents these commands as task-specific permission
requests with approval state, blocked reasons, command boundary, and last-run
metadata before the user approves or runs them.

Validation-preset permission is now a bounded capability, not a permanent
boolean. New grants are `Task` scoped, default to one hour, accept only fixed
durations up to 24 hours, and persist their expiry. Repository and session
scope semantics are advertised but cannot be granted by the task endpoint;
this prevents accidental cross-task widening and prevents a supposed
session-only grant from surviving restart. Legacy records without a task scope
and valid expiry fail closed.

Explicit revocation appends a `Revoke Validation Preset Approval` record with
the original approval ID. The original approval is retained for audit export.
Permission snapshots expose `Expired`/`Revoked`, and the runtime checks current
state before task-command spawn and before each validation child. A restart
therefore cannot revive stale evidence. Revocation affects future process
starts; an already-authorized active child continues until it exits or the user
uses the separate explicit cancellation boundary. JSON and Markdown audit
exports retain scope, expiry, and revocation linkage.

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
provider can choose only one enum action, and the runtime reuses the existing
proposal, command, validation repair, and rerun-evidence gates before any side
effect. A provider-selected `RunTaskCommand` is accepted only for a
runtime-known command whose task-command permission snapshot is already
runnable. A provider-selected `RerunRepairCommand` is accepted only for stored
ready/failed rerun evidence. Waiting for human review and requesting plan
approval are explicit blocked states, not silent no-ops.

The mock-OpenAI provider reliability negative control verifies this policy
through the real HTTP lifecycle: a valid proposal remains pending review, the
medium-risk preset remains unapproved, and a provider-selected
`RunTaskCommand` is downgraded to `WaitForHumanReview`. No command process,
file mutation, or repair lineage is created; Git and independent content
oracles remain clean.

`POST /tasks/:taskID/run-agent-loop` does not add a broader autonomy tier. It
repeats the same `run-agent-step` boundary under a runtime-enforced step limit
and stops at review gates, passed commands, verified self-fix reruns,
blocked/failed steps, busy-task guards, no-progress guards, or max-step
protection. It cannot apply a proposed patch, invent raw shell commands,
commit, push, or publish anything.

Pause and abort are cooperative controls, not arbitrary process control. They
can target only the runtime-owned active loop ID for the task and take effect
after the current safe step. Resume accepts only a persisted paused, aborted,
or failed loop and creates a linked new bounded loop under the same permissions.
None of these endpoints cancels a child process, applies edits, or expands the
provider action enum.

The task queue adds no permission tier. It stores only a bounded Agent Loop
request (step limit, optional already-known command preference, resume lineage,
position, and timestamps). This single-repository runtime permits one active
Agent Loop at a time regardless of the stored future global 1-3 ceiling, and
rejects an unqueued direct step while another loop owns the repository slot.
Reordering or removing a queue entry cannot run a command, apply a proposal,
commit, push, or publish. Dispatch re-enters the same Agent Loop gates and
audit trail used by an immediate run.

Task-level cancellation composes existing controls without granting a broader
process capability. `POST /tasks/:taskID/cancel` identifies work only from the
runtime-owned task snapshot: it may dequeue the task, request the active Agent
Loop's existing cooperative abort, and terminate only the active task-command
or validation child registered by this runtime. It accepts no PID, executable,
shell text, file operation, or Git target. The runtime records one `Cancel
Task` approval plus request/completion events, waits for every persisted
in-flight item to reach a terminal state, and then makes the task immutable in
`Cancelled`; existing review artifacts are retained.

Audit export is read-only but may contain repository and command evidence, so
it remains an explicit local user action. The exported schema selects audit
fields rather than serializing process configuration or provider settings,
omits proposal diff bodies, and recursively replaces known credential patterns
with `[REDACTED]`. This is defense in depth, not a guarantee that arbitrary
private customer data is safe to share; the native save panel warns the user
to review the local Markdown or JSON file before distribution. Each envelope
also returns content SHA-256, source-task SHA-256, and source `updatedAt`.

Command-output purge is a separate destructive local action, not a side effect
of export. Forge keeps task history by default and schedules no automatic
cleanup. Purge is limited to a terminal task and the `CommandOutput` scope,
requires exact `PurgeTaskHistory` confirmation plus a matching current export
receipt, and rejects stale or fabricated evidence before saving. The native
Audit surface stores that receipt in memory only after the save panel has
successfully written the current export. Purge clears bounded task-command
chunks and command/validation output summaries while preserving command
identity, status, exit code, timestamps, approvals, events, and an atomic
schema-v5 receipt. Observer runtimes may preview retention but reject purge as
they do every POST.

Workspace data lifecycle is a separate versioned boundary under
`forge-workspace-retention` v1. Its exact scopes are `TaskEvents`, `ToolCalls`,
`TaskMessages`, and `RepositoryIndexes`; retention is indefinite and automatic
purge is disabled. Preview and deterministic JSON export are GET-only and safe
for observers, but the export may still contain arbitrary private task or
repository metadata after known credentials are redacted. A purge must carry
`PurgeWorkspaceHistory`, policy version, ordered scopes, and the source/content
SHA-256 receipt from the saved current export. The runtime recomputes both
hashes at that export timestamp, rejects stale/forged/mismatched evidence, and
deletes selected history only from Completed, Failed, or Cancelled tasks.
Unfinished-task evidence is never eligible. Repository index rows are explicitly
rebuildable derived data. Changed task snapshots, index clears, and the
append-only schema-v6 receipt commit in one transaction; no model tool or
background timer can invoke this action.

Database schema destruction has a separate startup/offline boundary. Every
migration declares whether it is additive or destructive. A destructive
migration cannot start until Forge has produced and verified an owner-only
SQLite snapshot plus manifest containing source/target schema, task count,
bytes, integrity, and SHA-256. Backup creation failure executes no destructive
SQL; migration failure rolls back its transaction and keeps the backup.

Writable runtimes hold an owner-only database writer lease. Read-only observers
may coexist, but a second writer fails closed. Offline restore is not exposed
over HTTP or to model tools: the operator must stop the runtime, provide the
exact manifest/database paths and `RestoreForgeDatabaseBackup`, and have a
checkpointed database. Hash/schema/task mismatches, unreadable or live leases,
and non-empty WAL fail before replacement. Forge preserves the displaced
database and writes a restore receipt; these artifacts can contain private task
history and must remain local with owner-only permissions.

Mission Control observer runtimes add visibility, not authority. They use
unique loopback ports, remove remote-provider secrets from their child
environment, open existing task SQLite files read-only, skip all startup
recovery and queue dispatch, and reject every non-GET request. The app accepts
observer data only after health proves `observer` mode, `readOnly: true`, and
the exact expected repository root. Focusing an observer repository is a
separate primary-runtime transition; viewing it cannot run a tool, command,
edit, validation, git action, or queued Agent Loop.

Promoting an observer is a separate medium-risk approval. Mission Control must
show the exact repository path, loopback port, session duration, forced-local
provider, and the consequence that recovery resumes while persisted queued
work becomes eligible for supervisor grants. Approval creates a per-session
authorization ID. The child must echo
that ID with `repository-active` scope plus primary/read-write mode and the
exact repo root before its data is trusted; a mismatch terminates the process.
It must also advertise `queueDispatch.mode: supervised` and accept grants; an
automatic-dispatch child is rejected even if its repository and authorization
otherwise match.
The child locks provider selection to local, strips inherited remote-provider
configuration/secrets, and rejects provider-setting mutation for its lifetime.
Authorization is memory-only, does not persist across app launches, and can be
revoked back to observer mode only after visible running work is paused.

Queue authorization and queue dispatch are separate capabilities. Plan
approval creates durable repository-local queued work. A background active
runtime cannot start it on startup, after settings changes, or when a prior
loop ends. Mission Control grants a slot only through
`POST /queue/dispatch-next`, placing the current authorization ID in the JSON
body (never the URL) and revalidating health first. The runtime compares that
ID with its environment-scoped session evidence; stale or cross-runtime IDs
fail with 403. The grant selects only the existing queue head and cannot name a
different task or add plan/edit/command/Git authority. Per-repository
serialization remains enforced underneath the cross-runtime 1-2 slot limit.

Reconnect behavior cannot expand authorization. Transport and process failures
use a capped `2, 4, 8, 16, 30` second retry schedule and may relaunch only the
supervisor-owned target already held in memory for that repository. A relaunched
active child receives the same session-scoped authorization and remains in
`supervised` queue mode; it still must echo the exact repository, mode,
read/write, authorization, and grant evidence before any mutation route is
available. Identity or authorization mismatches clear the restart target and
active authorization instead of retrying. Telemetry stores bounded error
summaries and counters only; it does not capture tokens, child environments,
command output, repository content, or authorization secrets.

The process-level reconnect test does not add a product process-control route.
It obtains the PID only from the supervisor's existing in-memory observation
inside `@testable` SwiftPM code and sends `SIGKILL` to the temporary fixture
child it just created. Its temporary repository event log proves all observed
HTTP traffic remains GET-only while one running entry consumes the global slot
and a second entry stays queued. The fixture directory and its session-only
authorization evidence are deleted during test cleanup.

Background task routing does not convert cached visibility into authority.
Task detail uses the observer-safe `GET /tasks/:taskID` route after fresh health
identity validation. The same validated child supplies the validation
permission envelope and Git status/diff/commit/branch/publish/push/PR review
artifacts. Every background POST—new task, conversation, plan, per-file review,
Apply, validation approval/run, known-command run/cancel, reviewed repair
rerun, local commit/branch, or non-force publish/push—first revalidates the
exact repo root, primary/read-write mode, `repository-active` scope, and
current session authorization ID. Git requests carry the reviewed task ID and
optimistic-concurrency evidence; missing HEAD/branch/upstream/paths fails in
the app before the request, and the runtime rechecks it again. Mutations are
serialized per repository, authorization cannot change while one is in
flight, and a mode/root/ID mismatch terminates the child and clears the session
authorization. The app never falls back to the primary runtime for a
background task ID. Mission Control does not publish PRs or accept GitHub
tokens; that action remains in the focused Keychain-backed flow.

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

Current conflict resolution is high risk and requires an exact explicit
confirmation from the macOS conflict workspace. The runtime rechecks the
reviewed short HEAD and SHA-256 conflict fingerprint, confirms the path is
still unmerged, and either selects one Git index side/deletion or atomically
writes bounded manual UTF-8 text before staging only that file. Manual writes
reject symlinks, escaping parents, binary/oversized content, and remaining
conflict markers while preserving the existing regular-file mode. Forge does
not continue or abort the merge/rebase/cherry-pick, commit, reset, or push.

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

Current PR publication is high risk and requires the exact
`PublishPullRequest` confirmation, a fresh reviewed HEAD/base/head tuple, and a
GitHub token loaded by the app from Keychain for that request. The runtime
re-derives preflight, rejects stale or blocked state, pushes the head branch
without force, creates the PR, and records task approval/event/lineage. It does
not merge, close, approve, comment, force push, reset, or delete branches.

PR status refresh is read-only against GitHub and does not require a publishing
approval. It can be user-triggered or explicitly enabled as a conservative
app-side schedule because it spends external API quota and sends a credential.
Scheduling is off by default; permitted intervals are 15/30/60 minutes and a
cycle may touch only 1/3/5 oldest open, unmerged PRs, sequentially. The app
loads the token from Keychain once per cycle, makes no request without it,
prevents overlapping work, stops after an authentication/authorization
failure, and cancels its in-memory schedule on exit. `POST /git/pr-status`
keeps the token out of URLs and persistence, reads only PR/review/check
metadata, normalizes the latest decisive review per reviewer, and fails closed
on GitHub authentication or authorization errors. Missing non-auth auxiliary
metadata is displayed as Unknown rather than treated as approval or passing
CI. A per-task runtime in-flight gate rejects overlapping refreshes before a
second read begins. The runtime retains at most 20 credential-free attempt records per PR with
source, timestamps, success/failure, request count, change flag, and bounded
summary so automated reads remain auditable.

Fork topology is inferred only from local remote URLs and branch upstream
metadata. A detected contributor `origin` plus base `upstream` separates the
push target from the GitHub PR target and derives the qualified head owner. A
caller-supplied owner that conflicts with current local topology is rejected
before push or publication; Forge does not call a repository-discovery API to
guess missing ownership.

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

The context builder respects repository skip rules. Retained operational
evidence additionally passes through the versioned `forge-secret-redaction`
policy v1. It recognizes authorization headers; GitHub, OpenAI, GitLab, Slack,
AWS, and JWT token shapes; structured API-key/access-token/password/secret
fields; private-key blocks; credential-bearing URLs; and percent/base64-encoded
values whose decoded printable content contains a known credential pattern.

Redaction happens at the earliest durable boundary:

- task-command output is line-buffered so a credential split across transport
  chunks is still classified, then redacted before SSE broadcast and SQLite save;
- task-command and validation summaries, Git output summaries, runtime/HTTP
  errors, Provider failure bodies, public Provider diagnostics, task evidence
  fields, and audit exports use the same Runtime policy;
- copied macOS Runtime diagnostics use a native implementation with the same
  policy ID/version and fixtures;
- audit JSON includes policy ID, version, and replacement marker;
- classification evidence contains only kind and count. Forge does not retain
  the match, a hash of the match, nearby context, or reconstructable offsets.

The policy is intentionally conservative about false positives. Configuration
states such as `Configured`/`Missing`, environment placeholders, public OAuth
Client IDs, SHA-256 values, and prose such as “secret detection” remain
visible. Persisted task evidence is cloned and sanitized without altering an
executable reviewed patch body; rewriting an approved proposal during save
would violate review integrity. Secret Redaction is defense in depth, not a
general DLP claim and not permission to share arbitrary private task content.

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
- Provider base-URL updates reject URL userinfo. A legacy/environment base URL
  containing userinfo is redacted before it appears in public settings or
  copied diagnostics.
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
- clear command logs only after current audit export and destructive
  confirmation
- remove integrations

## Product Promise

Forge should feel powerful, but never sneaky.
