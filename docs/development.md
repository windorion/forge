# Development

Document role: record how to run the current development skeleton.

## Current Shape

Forge currently has two implementation pieces:

- `ForgeApp`: SwiftUI macOS shell built with SwiftPM.
- `runtime`: TypeScript local runtime skeleton.

The first vertical slice is app-runtime connectivity, not LLM execution.
The current slice adds Agent Loop v0: a deterministic local planner loop that
updates task state, agent status, plan steps, review summary, task
conversation, tool calls, context files, approval history, model-provider
intent briefs and execution proposals, SSE events, safe edit proposals, and
SQLite task persistence. The loop now includes a bounded repo-context pass
that scans safe local files, derives search terms from the task intent, records
matching files, and reads selected context before planning.
When the OpenAI provider generates a plan revision, it can first run a bounded
read/search context loop. Each round returns either `SearchAndRead` with search
terms and repo-relative read paths or `ReadyForPlan` to stop. The runtime
validates requests, executes only logged read-only tools, stops on repeated
context or the round limit, and then sends compact context summaries into the
plan revision call.
After a plan is approved, the runtime now runs another bounded read-only
execution-context pass before asking the provider for an execution proposal.
The proposal stores the inspected context files and concise tool evidence so
the app can show what informed the proposed next action.
The latest slice extends Agent Run Step v0 with provider-selected repository
inspection. A model can request bounded search terms and optional repo-relative
paths, but the runtime filters them and performs only logged list/search/read
tools before continuing to a reviewed edit or other gated action. Agent Run
Loop v0 wraps the step runner with a small runtime-enforced step limit and safe
stop reasons.

The runtime core has an automated smoke regression that exercises the main
task lifecycle without using real project memory or provider settings.

Product-direction note: this development slice now has the first real
provider-selected bounded loop with cooperative pause/abort/resume checkpoints,
but it still is not a full Codex/Claude Code style autonomous agent. The next
app/runtime work should add result-quality evidence, broader patch operations,
deeper self-fix, and final review polish.

The macOS app now switches between the handoff's primary states instead of
stacking them: `1a` is a full-window new-task composer, `32a` is a sidebar-free
clarification/plan workspace, and `14a` adds the square-edged task queue for a
running/review task. One live-work column switches between Log/Diff/Tests, and
the task header owns run/pause/abort/resume controls. The packaged build copies
the handoff Forge logo into app resources and uses a hidden native title bar.
The former Planner, Review, action-rail, duplicate-log, toolbar-demo, and
Git-workbench view trees were removed to avoid rendering old and new product
concepts together.

Startup recovery is explicit. When `Reopen last workspace` is enabled (the
default), the app restores the saved repository, probes the configured runtime
endpoint, and starts the app-managed bundled/local runtime if the probe fails.
The Offline workspace exposes Start/Reconnect, Switch Repository, and Settings
instead of claiming unavailable cold-launch cache features. Any tasks still in
the current app session can open their cached audit, while persisted history,
agent execution, validation, and Git actions wait for the runtime. General
Settings exposes the same runtime recovery, stop, repository-switch, and copy
diagnostics controls.

Full-page secondary handoff destinations also use one root-owned presentation
coordinator rather than SwiftUI Sheets. Mission Control, Queue, History, Batch
Questions, Full Plan, Full Diff, and Audit Log are opaque window-filling
surfaces. While one is open, the underlying workspace is opacity-zero, ignores
pointer input, and is hidden from accessibility; every surface closes through
its visible Close control or Escape. The Command Palette intentionally keeps
its handoff-specified dimmed overlay behavior.

The sidebar Queue button (`⌘⇧Q`) now opens the handoff `26a` 1240px queue
surface backed by `GET /queue`. Running, queued, and needs-you lanes use real
task/loop state. The runtime persists queue priority and its 1-3 global ceiling,
but deliberately enforces one active Agent Loop for this single repository.
Priority arrows call the exact-order reorder endpoint; remove returns an
approved task to `Execution Ready`; pause reuses the cooperative loop gate.

The live task header also exposes a composed `Cancel Task` emergency action
behind a native consequence-confirmation alert. It calls
`POST /tasks/:taskID/cancel`, which removes queued work, aborts an active Agent
Loop at a safe checkpoint, and stops runtime-owned task-command/validation
children before the task becomes immutable `Cancelled`. The app continues to
show retained plan, diff, output, and audit evidence while cancellation is
settling.

The full-page Audit Log's export control now fetches the runtime's read-only
`audit-export` envelope and presents a native macOS save panel for Markdown or
JSON. The exported record includes approvals, timeline, loop/tool/command/
validation evidence, edit transaction metadata, and task cancellation
dispositions; known credential patterns are redacted and the save panel asks
the user to review the local file before sharing it. Successful save records a
revision-bound SHA-256 receipt in app memory. For terminal tasks, the Audit
surface then enables a destructive confirmation that clears only exported
task-command chunks and command/validation output summaries. A cancelled save,
stale task revision, mismatched receipt, active task, or observer runtime cannot
purge. Status, exit codes, timestamps, approvals, events, and a schema-v5 purge
receipt remain.

The full-page History surface also loads the workspace policy-v1 preview for
all four supported scopes. `EXPORT EVIDENCE` writes deterministic redacted JSON
through a native save panel and keeps its source/content receipt only in the app
session. `PURGE EXPORTED` remains disabled until that receipt matches the active
policy/scopes, then presents the terminal-task/index consequences before the
POST. After success the app refreshes tasks and reports that an explicitly
cleared repository index requires rebuilding.

Exercise the API-free retention and prior-schema paths with:

```bash
cd runtime
npm run smoke:task-retention
npm run smoke:workspace-retention
npm run smoke:database-recovery
npm run test:unit
```

The task retention smoke covers preview, forged receipt rejection, explicit
purge, SQLite receipt persistence, and restart recovery through real HTTP. The
workspace smoke covers policy/scopes, deterministic redacted export,
stale/forged receipt rejection, terminal-only deletion, unfinished-task
preservation, rebuildable index reset, atomic schema-v6 receipt, restart, and
observer refusal. The database recovery smoke creates a real v6 task store,
applies an isolated destructive-v7 fixture only after a verified backup, rejects an incorrect CLI
confirmation, then restores the removed data and task through the production
offline command. The unit suite covers v4 → v5, writer-lease exclusion, stale
lease recovery, backup failure before SQL, transaction rollback, corrupt and
mismatched artifacts, WAL/live-writer refusal, displaced-database rescue, and
restore receipts.

For a real offline restore, stop every Forge runtime using the target database,
confirm no non-empty SQLite WAL remains, then use the exact manifest source path:

```bash
cd runtime
npm run database:restore -- \
  /absolute/path/to/forge.sqlite...manifest.json \
  /absolute/path/to/forge.sqlite \
  RestoreForgeDatabaseBackup
```

Do not delete the manifest, backup, displaced database, or restore receipt until
the recovered workspace has been independently reviewed.

Mission Control (`⌘⇧M`) opens the exclusive handoff `4a` 1240px three-column
surface while preserving the main task workspace state underneath. The primary column uses
the main runtime; up to two additional repositories receive app-supervised
observer runtimes on ports 17374 and 17375. Observers are verified read-only,
poll tasks/queue/git/health every two seconds, and display live/offline PID and
port evidence. Each observer exposes `AUTHORIZE ACTIVE`; confirming the exact
repository, port, recovery/supervised-queue consequence, and session boundary restarts it
as a local-provider read-write runtime. Health must return the generated
`repository-active` authorization ID before the app accepts it. Mismatched
mode, ID, or repo root terminates the child. Active access is session-only and
its provider is locked local even if that repository saved a remote choice;
provider-setting mutation is rejected. It can return to read-only after running work is paused. `⌘1–3` focuses a
repository, `⌘⇧N` opens a new task, and Pause All covers primary plus every
authorized active runtime.

Authorized background runtimes use `FORGE_QUEUE_DISPATCH_MODE=supervised`.
Plan approval persists queue state even when that repository is idle; startup
and loop completion do not dispatch it. Mission Control carries the current
session authorization ID in `POST /queue/dispatch-next`, applies a persisted
1-2 background concurrency limit, grants the oldest eligible repository first,
then rotates later grants round-robin. The bottom bar shows running/limit,
grant count, and next/waiting status. The primary focused runtime retains its
normal automatic one-repository queue; the Mission Control limit is explicitly
for authorized background repositories.

Mission Control connection failures use a repository-local capped exponential
backoff of 2, 4, 8, 16, then 30 seconds. Transport failures pause polling until
the deadline; unexpected supervisor-owned child exits use the same deadline
before relaunch. A successful identity-validated refresh resets consecutive
failures and records one recovery. Repository/mode/authorization/supervised-
dispatch mismatches do not retry: they terminate the child and clear active
authorization. General runtime diagnostics and the compact Mission Control
footer expose consecutive/total failures, restart attempts, recovery count,
last connection, and next retry without persisting this session telemetry.

The Mission Control new-task flow now keeps explicit repository selection. A
focused repository uses the primary client; an accepted background repository
uses its own loopback client after the supervisor refreshes health and verifies
the exact repository root, primary/read-write mode, `repository-active` scope,
and current in-memory authorization ID. Background cards use the read-only
`GET /tasks/:taskID` route for fresh detail and open a Mission Control-owned
Overview/Review/Commands/Git/Activity surface instead of replacing the primary
workspace. When active, that surface can send conversation, regenerate/approve
plans, review proposal files, Apply, approve/run validation presets, run/cancel
runtime-known commands, rerun reviewed repairs, and separately confirm local
commit/branch/non-force publish/push. The Git tab loads bounded status/diff and
all five preflight artifacts from the owning runtime; PR publication remains in
the focused Keychain-backed workflow. All writes share one per-repository
in-flight gate; observer detail never issues a POST.

Run the observer safety regression with:

```bash
cd runtime
npm run smoke:observer
npm run smoke:mission-control
npm run smoke:mission-control-fairness
```

That fixture now verifies observer → authorized active → observer mode on one
port: writes are rejected before authorization, accepted and persisted while
active, then rejected again after read-only restoration.

`smoke:mission-control` starts two isolated temporary repositories/runtimes,
creates six tasks concurrently in each authorized runtime, verifies exact task
detail and a cross-repository 404 negative control, then approves and runs one
known command per repository, cancels each runtime's active long command by its
own run ID, verifies retained Cancelled evidence, modifies each isolated Git
worktree, loads its status/diff/commit/branch preflights, creates a scoped local
commit and task branch, and proves remote-less publish/push/PR previews remain
blocked. It then returns both runtimes to observer mode for repeated health/
tasks/queue/git/detail polling. The final oracle requires observer POST
rejection and byte-identical SQLite files across the read-only soak.
`FORGE_MISSION_CONTROL_SOAK_ITERATIONS` and
`FORGE_MISSION_CONTROL_TASK_COUNT` can raise the local stress budget.

`smoke:mission-control-fairness` starts two authorized supervised runtimes,
queues three local-provider tasks per repository, proves they remain held
before a grant, rejects a stale authorization ID, alternates all six grants,
injects runtime restarts every two grants, and asserts no startup auto-dispatch
or starvation. Increase the fixture without APIs through
`FORGE_FAIR_QUEUE_TASKS_PER_REPOSITORY`,
`FORGE_FAIR_QUEUE_RESTART_EVERY_GRANTS`, and
`FORGE_FAIR_QUEUE_SOAK_SECONDS`. The convenience command below runs the same
oracles for six hours and writes timestamped JSON/Markdown evidence under
`build/mission-control-soak/`:

```bash
cd runtime
npm run soak:mission-control
```

For a shorter diagnostic or an explicit archive location/power note, run:

```bash
script/run_mission_control_soak.sh 30 /tmp/forge-soak-proof \
  "AC power; sleep disabled for this diagnostic"
```

The report records requested and actual soak duration, full fixture elapsed
time, start/end timestamps, host/Node/OS/architecture, operator-supplied power
conditions, held/granted/restarted/final queue totals, and all negative-control
results. Failures include the stack and bounded runtime output tails and keep
the temporary repositories by default (`FORGE_FAIR_QUEUE_PRESERVE_FAILURES=0`
disables preservation). The 2026-08-09 bounded five-minute proof completed six
fair grants in alpha/beta alternation, two drain-time restarts, 1,086 soak
restarts, stale-authorization rejection, no startup auto-dispatch, no
starvation, and empty final queues. It ran under an explicit battery/power note
and is a pipeline diagnostic, not the outstanding six-hour evidence.

For native visual automation, run a DEBUG ForgeApp and use:

```bash
script/drive_surface.sh missionControlFixture:observer
script/drive_surface.sh missionControlFixture:active
script/drive_surface.sh missionControlFixture:queued
script/drive_surface.sh missionControlFixture:review
script/verify_mission_control_surfaces.sh
script/drive_surface.sh missionControlRouteFixture:commands
script/drive_mission_control_action.sh show-git
script/verify_mission_control_routed_actions.sh
```

The fixture state lives in the shared `WorkspaceModel`, not view-local state,
and the verification scripts capture the app's native view hierarchy without
Screen Recording permission. The routed-action script proves a Commands -> Git
-> Commands transition in the view that owns the real tab buttons. This is
deterministic DEBUG native action/transition automation, not XCUITest.

True Mission Control UI automation uses an explicit generated Xcode host and
the real `XCUIApplication` API. Build the 3 test methods without launching
UI automation:

```bash
FORGE_XCUI_BUILD_ONLY=1 script/test_mission_control_ui.sh
```

Run the action-level tests and retain the `.xcresult` plus log under the ignored
`build/mission-control-xcui/` tree with:

```bash
script/test_mission_control_ui.sh
```

The suite covers observer authorization/revocation alerts, 1-to-2 background
slot changes, review-card navigation, preset approval, active command cancel,
and Git branch/commit confirmation cancellation. The script regenerates
`ForgeApp.xcodeproj` deterministically from all app/UI-test Swift sources. On
first use macOS may require local authentication before XCTest can control the
UI. On 2026-08-09 an authenticated run executed all three methods: slot change
and review-card navigation passed; the authorization/revocation method exposed
sheet-scoping semantics, and the command/Git method exposed a stale element
query after cancellation. The fixes now scope text and Cancel queries to the
owning sheet and re-query the cancellation control after observing retained
`CANCELLED` evidence; `build-for-testing` passes. This is not yet a complete
passing archive. Because action-level XCUITest takes foreground focus, run it
only in a user-approved unattended desktop window. Build-only mode is safe for
normal background development.

GitHub Actions also builds the committed `ForgeAppUI` scheme in a separate
`Mission Control XCUITest build` job on the macOS 15 arm64 image. It uses
`CODE_SIGNING_ALLOWED=NO` and stops at `build-for-testing`: this catches app-host
and UI-test compiler/toolchain drift, but deliberately does not claim an
authenticated action-level run. Keep the local interactive `.xcresult` gate
separate.

The shell also includes a first usable `10a`-style full-screen diff review
surface. It opens from the Diff tab or review state card, shows a file tree,
main diff pane, why-this-change reasoning, validation evidence, and
apply/request-change actions wired to the existing proposal review gates. It
now renders pending proposal diffs before Apply, parses standard unified hunks
into real aligned split rows with old/new line numbers, and supports keyboard
file/hunk navigation plus per-file approval.

Actual Git unmerged state now replaces the normal task workspace with the
handoff `18a` conflict review. The runtime serves Base/Ours/Theirs/working
versions and a stale-review fingerprint; the app provides paired source panes,
an editable resolution draft, explicit confirmation, and live remaining-file
refresh. Resolution stages only one reviewed file and never continues the Git
operation automatically.

The first persisted Completed task now opens the handoff `24a` celebration
once. Its receipt derives elapsed and Agent Loop durations, proposal diff line
counts, passed validation/task commands, requested review changes, and the last
plan cost estimate from task state. Queue Next returns to the task composer;
View on GitHub is enabled only for a runtime-normalized `github.com` remote.
The UI intentionally says Shipped/Completed until a hosted PR integration can
prove a merge and supply the actual PR URL.

## Run Runtime

```bash
cd runtime
npm install
npm run dev
```

Runtime endpoint:

```text
http://127.0.0.1:17373
```

Run the dedicated queue/restart regression with:

```bash
cd runtime
npm run smoke:queue
```

It uses an isolated SQLite database and settings files, occupies one repository
slot, queues and reorders three tasks, removes one, restarts the runtime, and
verifies automatic ordered drain.

Run the composed cancellation/audit regression with:

```bash
cd runtime
npm run smoke:task-cancel
```

It covers idle/idempotent cancellation, cancelled-task immutability, queue
removal, Agent Loop safe-checkpoint abort, task-command and validation process
termination, restart completion, and JSON/Markdown audit export.

Opening that URL in a browser shows a small runtime status page. The full app
UI still runs through the SwiftUI app.

By default, runtime task history is stored in:

```text
.forge/forge.sqlite
```

Use `FORGE_RUNTIME_DB_PATH` to point the runtime at a different SQLite file.
Use `FORGE_REPO_ROOT` to point a packaged or separately installed runtime at
the repository it should inspect. When omitted, the runtime keeps the
development default of treating the runtime directory's parent as the repo
root.

The runtime uses a model-provider abstraction. The default provider is local
and deterministic:

```text
FORGE_MODEL_PROVIDER=local
FORGE_MODEL_NAME=local-deterministic-v0
```

To exercise the optional OpenAI Responses provider:

```text
FORGE_MODEL_PROVIDER=openai
FORGE_MODEL_NAME=gpt-5.5
OPENAI_API_KEY=...
```

Optional OpenAI provider settings:

```text
FORGE_OPENAI_BASE_URL=https://api.openai.com/v1
FORGE_OPENAI_TIMEOUT_MS=30000
FORGE_OPENAI_MAX_OUTPUT_TOKENS=1800
```

When enabled, the provider uses Responses API Structured Outputs for intent
briefs, plan revisions, execution proposals, agent run step decisions, and
edit proposal guidance. The runtime still owns validation, approvals, IDs,
timestamps, and restricted file operations.

The runtime health endpoint exposes provider configuration status through
`modelProviderConfiguration`. The macOS Settings window shows the active
provider, model, mode, non-secret provider settings, missing key issues, and
remote-context boundary. It can also edit provider settings through
`GET /settings/model-provider` and `POST /settings/model-provider`.

Non-secret provider settings are persisted in:

```text
.forge/model-provider-settings.json
```

Use `FORGE_MODEL_PROVIDER_SETTINGS_PATH` to point the runtime at another
non-secret settings file. The runtime never writes API keys to this file. The
macOS app stores the OpenAI API key in Keychain and syncs it into runtime
memory through the settings endpoint.

## Run macOS App

From the repository root, prefer the app bundle runner:

```bash
./script/build_and_run.sh
```

This builds `dist/Forge.app` and launches it as a native macOS app.

You can also build the SwiftPM target directly:

```bash
swift run ForgeApp
```

The task-queue footer shows compact runtime health plus a refresh action.
Start/stop and detailed diagnostics live in Settings so runtime administration
does not compete with the task flow. The Settings runtime tab shows service,
version, uptime, database path, task count, last checked time, last error, and
the runtime process status, PID, directory, launch command, checked runtime
directory candidates, and bounded build/launch output. If a runtime is already
reachable but was not started by the app, Forge marks it as external and does
not offer to stop that process.

Full-screen Diff review is backed by runtime git endpoints. It refreshes
`GET /git/status` and can load a bounded unified or side-by-side diff from
`GET /git/diff?path=<repo-relative-path>`. File actions are read-only: open
the file or reveal it in Finder. Diff responses include display mode,
unavailable reason, byte/line counts, and app preview limits so binary or
oversized files are shown as explicit messages instead of broken textual
diffs. Runtime APIs can also prepare a Branch Review
through `GET /git/branch-preview`, showing current branch, target branch,
create/switch mode, structured preflight metadata, blockers, and risk notes.
The preflight card summarizes target branch validity, current branch/default
branch status, dirty-worktree handling, existing local/remote branch state, and
action readiness. From that reviewed card, the user can explicitly create a
new local branch or switch to an existing clean local branch through
`POST /git/branch`; the runtime rechecks expected HEAD and current branch,
validates the branch name, blocks default-base branch targets, blocks unmerged
files, blocks dirty switches, and does not push or publish a PR.
The same section can prepare a Branch Publish Review through
`GET /git/branch-publish-preview`, showing the current branch, configured
remote, remote branch, default base branch, commits to publish, local changes
that will remain local, structured preflight metadata, blockers, and risk
notes. The preflight card summarizes branch/remote/base/commit/worktree/action
readiness and common remote failure categories Forge will classify after an
approved publish attempt. From that reviewed card, the user can explicitly
publish the current branch and set upstream through `POST /git/branch-publish`;
the runtime rechecks expected HEAD, branch, remote, and remote branch, blocks
detached/default-base/already-upstream/no-commit/unmerged/remote-collision
states, performs a non-force `git push --set-upstream`, and classifies failed
git push output before surfacing it. It does not create a PR.
The same section can prepare a read-only Commit Review through
`GET /git/commit-preview?taskID=<task-id>`, showing a
suggested commit message, included files, validation suggestions, preflight
metadata, blockers, risk notes, and the explicit boundary that Forge has not
staged, committed, or pushed anything. Commit preflight shows git author
identity status, staged/unstaged/untracked counts, line stats, large-change
warnings, validation state, hook-risk disclosure, and the commit path limit.
From that reviewed card, the user can explicitly create one local commit
through `POST /git/commit`. The runtime rechecks the expected HEAD, validates
the selected paths, rejects unmerged files and staged files outside the
reviewed selection, preflights git identity, stages the selected paths,
creates the local commit, records a task event when linked, and still does not
push. A separate Push Review through `GET /git/push-preview` shows
branch, upstream, ahead/behind counts, commits to push, uncommitted local
changes, structured preflight metadata, blockers, and risk notes. The
preflight card summarizes branch/upstream/remote/commit/worktree/action
readiness and common remote failure categories Forge will classify after an
approved push attempt. From that reviewed card, the user can explicitly push
the current branch through `POST /git/push`; the runtime rechecks expected
HEAD, branch, and upstream, blocks detached/no-upstream/behind/no-ahead/
unmerged states, performs a non-force push to the configured upstream, and
classifies failed git push output before surfacing it. It does not create a
PR. A read-only PR Handoff through
`GET /git/pr-preview` shows the default base branch, current head branch,
upstream, suggested branch name, PR title, draft body, test plan, commits,
changed files, structured preflight metadata, blockers, and risk notes. The
preflight card summarizes base ref resolution, head/upstream readiness,
multi-remote or fork-like review risk, validation state, test evidence, and
publish readiness. That preview does not create, publish, update, close, or
comment on any pull request. After explicit confirmation, `POST
/git/pr-publish` rechecks the reviewed HEAD/branches, pushes without force,
opens the PR through GitHub, and persists its task lineage. Common fork
layouts are derived from local remotes: `origin` is pushed as the contributor
head while GitHub `upstream` is targeted as the base, with an automatically
qualified owner/branch and no discovery request. `POST
/git/pr-status` is read-only against GitHub and uses a token supplied only in
that request to refresh open/closed/merged state, latest decisive reviews,
requested reviewers/teams, head-SHA check runs, and mergeability. The macOS
completion surface shows normalized review/check evidence and bounded attempt
audit. Manual refresh remains, while Git settings offer an off-by-default
15/30/60-minute scheduler capped at 1/3/5 oldest open PRs per cycle. It reloads
Keychain credentials per cycle, stops on auth failure, and is cancelled when
the app exits. Forge does not approve, merge, close, rerun checks, or comment
on the PR.

Use the sidebar composer to create a custom task. The app connects to
`GET /events` and refreshes tasks as runtime events arrive.

The main workspace includes `Task Conversation`. Creating a task records the
initial objective as a user message and stores a provider-generated intent
brief. Sending another message calls `POST /tasks/:taskID/messages`, appends
the user message, and creates a new structured intent brief with summary,
constraints, acceptance criteria, open questions, and next action.

Task messages can mention files with repo-relative paths such as `README.md`,
`docs/v0_scope.md`, or `@runtime/src/server.ts:120`. The runtime resolves up
to six safe file references, stores summaries on the message, and shows
resolved, missing, or blocked references in the conversation panel. These
references are read-only context; sending a message never mutates files.

The conversation panel also includes `Update Plan From Conversation`. That
action calls `POST /tasks/:taskID/generate-plan-revision`, asks the model
provider for a new plan revision from the latest message and intent brief,
shows the revision in the Planner panel, clears any prepared execution
proposal, and moves the task back to `Human Review`. The user must approve the
current plan revision before Forge prepares execution again.
For the OpenAI provider, this action now performs a bounded model-guided
context loop first: the provider can return `SearchAndRead` for additional
read-only context or `ReadyForPlan` to stop, and the runtime executes
`list_repo_files`, `search_repo_context`, and `read_context_file` only after
repo-local safety checks.

Agent Loop v0 currently runs local read-only tools:

- `list_repo_files`: lists safe repo-local source, config, script, and
  documentation files while skipping private/generated directories.
- `search_repo_context`: scores repo files from task-derived search terms and
  explicit file references.
- `read_context_file`: reads selected context files after repo-local safety
  checks.

The app shows those tool calls and the resulting context file summaries before
the task stops at the human review gate.

When intake is ambiguous, the task first reaches `Human Review / Clarification`.
The conversation displays the active questions, planning stays paused, and the
runtime rejects approval until a reply clears them. The resolving reply
automatically generates a plan with expected file areas, validation, risk
notes, and bounded time/cost estimates.

When a task reaches `Human Review / Plan Review`, the embedded plan and Review
rail enable `Approve & Run`. That action calls
`POST /tasks/:taskID/approve-plan-and-run`, records approval history, targets
the current plan revision, runs bounded read-only repository tools for
execution context, asks the provider for an execution proposal, and enters the
bounded Agent Run Loop. The proposal carries `contextFiles` and `toolEvidence`;
all later file, command, Apply, and git gates remain unchanged.

After an execution proposal exists, the Review panel enables
`Generate Edit Proposal`. That action calls
`POST /tasks/:taskID/generate-edit-proposal`, creates a proposed diff preview,
validates it against the current workspace, and returns the task to
`Human Review` with current phase `Edit Proposal Review`. It still does not
change files.
For the OpenAI provider, edit proposals can now include multiple file changes.
`AppendText` remains limited to existing Markdown files in `README.md` or
`docs/*.md`, exact `ReplaceText` and multi-hunk `PatchText` can validate for
existing allowlisted source/text files when every find text appears exactly
once, and `UnifiedDiff` handles normal context-anchored modifications to one
existing allowlisted source/text file, including standard EOF markers.
Restricted `CreateFile` creates new allowlisted source/text paths without
overwriting; `DeleteFile` removes an existing bounded text file only after
per-file review and snapshot journaling. Unsafe or stale diffs, unsupported
paths, and preview-only operations block apply until revised.
If generated validation is blocked, the runtime can run a bounded repair loop:
it archives the blocked proposal as `Superseded`, sends the failed checks back
to the provider, and validates the repaired proposal before returning to human
review.

When an edit proposal is ready, the Review panel enables `Apply Edit Proposal`
and `Request Changes`. It also exposes `Validate Proposal`, which calls
`POST /tasks/:taskID/validate-edit-proposal` to refresh applicability checks
without writing files. Applying calls `POST /tasks/:taskID/apply-edit-proposal`,
revalidates the current workspace, runs the restricted v0 edit operation,
records the changed file plus before/after rollback metadata, and marks the
task completed. Multi-file apply records transaction state, verifies every
resulting hash, and restores already-written files if a later file fails. A
versioned per-file write-ahead journal is persisted before each mutation so a
runtime restart can distinguish before, after, and unknown disk state.
Applied proposals with rollback metadata can be explicitly
rolled back with `POST /tasks/:taskID/rollback-edit-proposal`; the runtime
checks current hashes before restoring snapshots or deleting created files,
verifies restored results, and compensates a partial rollback back to the
verified applied state when possible. Startup performs the same guarded
reconciliation for transactions left `Running`; unknown hashes are never
overwritten automatically. Full diff review shows this evidence.
Requesting changes calls `POST /tasks/:taskID/reject-edit-proposal`, records
the rejection, leaves files unchanged, and allows another edit proposal to be
generated. After a rejection, the same Review action area exposes
`Revise Edit Proposal`; it calls `POST /tasks/:taskID/revise-edit-proposal`,
uses the latest task conversation and intent brief, archives the rejected
proposal in revision history, validates the new proposal, and returns to
`Human Review`.

After a proposal is applied, the runtime enters `Testing` and runs controlled
built-in validation commands. The Review panel shows `Validation Runs`,
including each command name, status, command id, and output summary. The user
can manually rerun validation with `POST /tasks/:taskID/run-validation` through
the `Run Validation Again` button after an applied proposal exists.
If a validation run fails, the runtime asks the model provider for a repair
brief from compact failed command summaries. The brief is stored in task state
with likely cause, recommended actions, and a follow-up repair prompt; it does
not rerun commands or edit files. The Review panel shows repair briefs next to
validation runs.
After a repair brief exists, `POST /tasks/:taskID/generate-validation-repair-proposal`
can generate a new proposed repair diff linked to the brief. The previously
applied proposal is archived, the new proposal is validated, and no files are
changed until explicit apply. The Review panel exposes this action when the
latest failed validation run has a matching repair brief and the current edit
proposal is still the applied proposal.

The runtime also has a first task-scoped command runner for live agent
sessions:

```text
POST /tasks/:taskID/run-task-command
POST /tasks/:taskID/rerun-repair-command
POST /tasks/:taskID/cancel-task-command
```

The request accepts only a runtime-known `commandID`. It reuses validation
preset approvals, blocks concurrent validation/command runs, and does not
accept arbitrary shell text. Project commands run with `spawn`, `shell:false`,
and runtime-owned repo-local cwd values. The response stores a
`taskCommandRuns` record with status, exit code, output summary, approving
preset, and bounded output chunks. The runtime also emits
`task.command.started`, `task.command.output`, and `task.command.completed`
events over `GET /events`.

In the macOS session shell, the Tests control strip exposes a command chooser populated
from runtime-derived task-command permissions. After approval, the same
`runtime-typescript` preset can expose both `runtime-npm-check` and
`runtime-npm-build`; other project presets such as `macos-swiftpm` appear with
their own approval/readiness state. The Tests tab shows task command runs
before validation runs, including stdout/stderr/system chunks. When a task
command fails, the runtime asks the model provider for a repair brief linked to
the failed `taskCommandRunID`. The same `Generate Self-Fix` action calls
`POST /tasks/:taskID/generate-validation-repair-proposal` and can produce a
review-only repair proposal from that command-sourced brief. Active-run
controls include a Cancel Command action: the app calls
`POST /tasks/:taskID/cancel-task-command` with the active task command run id,
the runtime sends SIGTERM with a short SIGKILL grace path, records a
`Cancel Task Command` audit entry, streams a system output chunk, and marks the
run `Cancelled` without generating a repair brief.

When a command-sourced self-fix proposal is applied, the runtime records
`commandRerunEvidence` linking the failed source command, repair brief, and
applied repair proposal. The macOS Tests tab shows that evidence chain and the
Tests control strip exposes `Rerun Self-Fix`. That action calls
`POST /tasks/:taskID/rerun-repair-command`, which reruns the original command
ID through the same approval/cwd/no-shell path, attaches the new command run to
the evidence, and moves the task to `Repair Verified` when it passes.

The running-task header exposes Agent Run Step v0 and Agent Run Loop v0:

```text
POST /tasks/:taskID/run-agent-step
POST /tasks/:taskID/run-agent-loop
POST /tasks/:taskID/pause-agent-loop
POST /tasks/:taskID/abort-agent-loop
POST /tasks/:taskID/resume-agent-loop
```

The request can include an optional `preferredCommandID`, but the runtime only
uses it when the provider-selected action is `RunTaskCommand` and the command
is already approved/runnable in the runtime permission snapshot. The provider
chooses exactly one action from `GenerateEditProposal`, `RunTaskCommand`,
`GenerateValidationRepairProposal`, `RerunRepairCommand`,
`WaitForHumanReview`, `RequestPlanApproval`, and `InspectRepository`. The
inspection action accepts bounded search terms and optional repo-relative read
paths, then the runtime filters unsafe paths and executes only its logged
read-only list/search/read tools. The runtime rechecks the same proposal,
command, repair, and review gates used by the manual endpoints before any side
effect. Each decision is stored in
`agentRunSteps` with provider metadata, action, summary, rationale, command or
rerun evidence IDs, linked proposal/command target, status, result, and
timestamps. SSE emits `agent.run_step.started`, `agent.run_step.completed`,
`agent.run_step.blocked`, or `agent.run_step.failed`.

`run-agent-loop` repeatedly invokes the same step boundary up to a bounded
`maxSteps` value. It stops at edit-proposal review gates, passed commands,
verified self-fix reruns, blocked/failed steps, busy-task guards, no-progress
guards, or max-step protection. Pause and abort requests are audited while the
loop is active and stop it after the current safe step. Resume creates a new
linked loop from a paused, aborted, or failed checkpoint. These controls do not
kill in-flight commands or model calls and do not add permissions. A complete
V0 agent still needs stronger query-variation handling and wider recovery for
malformed planning/patch output.

Repository inspection steps also store a stable fingerprint of their
normalized search terms and safe read paths plus a compact budget summary. If
the same request fingerprint already exists on the task, Forge blocks the new
step after path normalization but before duplicate `search_repo_context` or
`read_context_file` calls. Completed steps persist a result-quality rating,
query-term coverage, match/file/new-context counts, total context bytes, and
per-file byte length, SHA-256, matched-line count, and match reasons.

OpenAI Agent Run Step decisions have a narrow format-recovery boundary. If the
response cannot be decoded or fails required-field/action-enum normalization,
Forge sends one corrective structured-output request. Successful recovery
stores the attempt count and bounded prior error on the step. If the second
attempt also fails, Forge records a failed `WaitForHumanReview` step, stops the
loop with `StepFailed`, and runs no step tools, commands, or mutations. Network,
HTTP, and timeout errors are not blindly retried.

Current validation presets:

- `forge-post-apply`: low-risk built-in audit checks.
- `runtime-typescript`: medium-risk project checks for the runtime
  (`npm run check` and `npm run build` from `runtime/`).
- `macos-swiftpm`: medium-risk project check for the native macOS app
  (`swift build` from the repository root).

Workspace validation presets can be declared in `.forge/validation-presets.json`.
They can only reference runtime-known command IDs such as `runtime-npm-check`
`runtime-npm-build`, and `macos-swift-build`; raw shell command strings are
not accepted from the workspace config.

Medium-risk validation presets require task-level approval through
`POST /tasks/:taskID/approve-validation-preset` before they can run. The Review
panel shows command permission requests with source, approval state, execution
state, blocked reasons, command manifest, cwd, risk level, approval button, and
run button. Approval requests send `scope: "Task"` and a fixed bounded
`durationSeconds` (the native client currently uses the one-hour default).
`POST /tasks/:taskID/revoke-validation-preset-approval` appends revocation
evidence and the Tests action rail exposes it next to runnable commands. The
runtime provides expiry/revocation state and the authoritative scope/duration
policy through
`GET /tasks/:taskID/validation-permissions`. The Settings window shows the
active provider status, editable provider settings, loaded workspace
validation config path, and any config issues.

## Foundation Demo Script

Use this path for a local foundation walkthrough. It verifies the current
runtime, review, validation, and git preflight surfaces; it is not the new
coding-agent V0 described in `docs/v0_scope.md`.

1. Start the macOS app with `./script/build_and_run.sh`.
2. Use the toolbar or Settings window to start/check the local runtime.
3. Confirm the sidebar runtime badge is running and Settings shows provider,
   database, task count, event stream, and runtime process diagnostics.
4. In Settings, keep the local provider or switch to OpenAI only with an
   intentional API key; verify the remote-context summary before saving.
5. Create a task from the sidebar composer and mention a repo-local docs file.
6. Send the task message, generate a plan revision, and approve the plan.
7. Generate an edit proposal, inspect the Review panel, and apply only after
   the proposal validation is ready.
8. Watch post-apply validation pass and review any repair brief if validation
   fails.
9. In Working Tree, inspect git status and a changed-file diff.
10. Prepare Branch, Publish, Commit, Push, and PR Handoff reviews as relevant;
    approve only the local/remote git actions you intend to run.
11. Run `cd runtime && npm run smoke:core` before treating the demo as clean.

## Core Runtime Smoke

```bash
cd runtime
npm run smoke:core
```

This command builds the runtime, starts a temporary runtime process on a random
local port, uses a temporary SQLite database and provider settings file,
creates unique temporary Markdown fixtures under `docs/` plus a temporary
TypeScript source fixture under `runtime/src/`, and deletes them at the end.

It covers:

- create task
- message with repo-local file reference
- generate plan revision
- approve plan
- bounded execution-context evidence before execution proposal generation
- generate and validate edit proposal
- apply restricted edit proposal
- built-in post-apply validation
- SQLite restart recovery
- `AppendText`, Markdown exact `ReplaceText`, source-file exact `ReplaceText`,
  multi-hunk source `PatchText`, two-file `UnifiedDiff` apply/rollback,
  applied-file hash verification, and explicit rollback
- a real cross-file partial-apply failure caused by a read-only second fixture,
  with automatic restoration and verification of the first written file
- runtime home page, health diagnostics, persistence metadata, and model
  provider settings GET/POST paths
- provider settings key handling with a fake OpenAI key, including verification
  that the API key is never persisted to the settings file
- read-only git status and bounded git diff endpoints, including text,
  binary, and oversized untracked file previews
- mock OpenAI plan-context loop before a plan revision
- mock OpenAI provider-selected agent run step that generates a proposal, then
  another step that runs an approved runtime command
- mock OpenAI bounded loop that first selects `InspectRepository`, filters an
  unsafe path, reads a safe macOS source file, then generates a proposal using
  the newly persisted context
- repeated `InspectRepository` decisions with identical fingerprints, proving
  the second step is blocked before duplicate search/read tools
- mock OpenAI malformed agent-step output that recovers on the second bounded
  request, plus retry exhaustion that records both errors and fails closed
- mock OpenAI bounded agent run loop that generates a proposal, applies it
  after review, then runs an approved command, creates a repair brief from the
  failed command, and generates a self-fix proposal inside one loop
- concurrent pause/resume/abort requests around approved five-second task
  commands, including checkpoint lineage, audit records, and SSE events
- read-only branch, branch-publish, commit, push, and PR handoff preview
  endpoints plus stale-head rejection checks for high-risk git actions
- commit preview preflight metadata for author identity, staged/unstaged/
  untracked counts, hook-risk disclosure, and files without line stats
- mock OpenAI richer edit proposal with append/create apply and blocked
  preview-only artifact coverage
- mock OpenAI blocked-to-repaired edit proposal flow
- mock OpenAI failed validation repair brief flow
- mock OpenAI validation repair brief to follow-up proposal flow

In sandboxed Codex sessions, the command may need approval because it listens
on `127.0.0.1`.

### Environment requirement: standalone ripgrep binary

`smoke:core` no longer requires a standalone `rg` binary. Both inspection-engine
assertions rebuild the durable index first and are served by it: the `Symbol`
inspection by the symbol index (engine `symbol-index+ripgrep-word` with a real
`rg`, `symbol-index` on fallback) and the `Text` inspection by the trigram index
(engine `trigram-index+ripgrep-fixed` with a real `rg`, `trigram-index+substring`
on fallback), so the suite passes whether or not `spawn("rg")` can exec. The
runtime still spawns `rg` directly (`spawn("rg", args, { shell: false })`) for
scan fidelity; if only a shell-function `rg` is present (e.g. an interactive tool
wrapper), Node's `spawn` cannot use it and the runtime falls back to substring
search — correct behavior, and no smoke assertion depends on it. Install a
standalone ripgrep binary (`brew install ripgrep`) for production-grade scans.
The git-specific suites below do not depend on ripgrep either.

If you want to exercise the real ripgrep path (so `Text` search and the
`symbol-index+ripgrep-word` engine run through `rg`) but only a
ripgrep-compatible executable behind a shell function is available, a small
shim on `PATH` lets Node's `spawn("rg")` reach it:

```bash
mkdir -p /tmp/rgbin
printf '#!/bin/bash\nexec -a rg "%s" "$@"\n' "$RG_COMPATIBLE_BINARY" > /tmp/rgbin/rg
chmod +x /tmp/rgbin/rg
PATH="/tmp/rgbin:$PATH" npm run smoke:core
```

## Git Remote Fixtures

```bash
cd runtime
npm run smoke:git-remote
```

This command builds the runtime, creates temporary local bare remotes and
working clones, starts the real runtime HTTP server with `FORGE_REPO_ROOT`
pointing at each fixture repo, and verifies:

- stale remote/non-fast-forward push rejection after a reviewed push preview
- branch-publish remote branch collision detection
- branch-publish remote policy rejection through a pre-receive hook

It does not require GitHub credentials or network access. Hosted-provider auth,
network, branch-protection, and hosted fork-failure fixtures are still future
work; local fork topology is covered by the PR mock suite below.

## Git Conflict Fixtures

```bash
cd runtime
npm run smoke:git-conflicts
```

This command creates a temporary repository with a real two-file merge
conflict, starts the runtime against it, and verifies conflict stage reading,
confirmation and stale-review gates, side/manual resolution, staging, and the
no-auto-continue boundary. It does not touch the Forge worktree.

## Repository Index, PR, And Watchdog Suites

```bash
cd runtime
npm run smoke:repo-index-pure    # index metadata/summary (pure)
npm run smoke:repo-index         # index build/incremental/persistence (e2e)
npm run smoke:symbol-extract     # per-language symbol regexes (pure)
npm run smoke:symbol-search      # index-backed symbol matches (pure)
npm run smoke:text-search        # trigram extraction + candidates (pure)
npm run smoke:github-remote      # git remote URL parsing (pure)
npm run smoke:pr-publish         # PR create/status against a mock GitHub API
npm run smoke:stuck-detection    # stalled-work detection (pure)
npm run smoke:stuck-recovery     # live watchdog against real in-flight work
npm run smoke:inspection-guard   # redundant-inspection guard (pure)
npm run smoke:provider-recovery  # bounded malformed-output recovery (pure)
```

The pure suites need no repository, network, provider, or ripgrep. The e2e
suites build temporary repositories (and, for `smoke:pr-publish`, a local mock
GitHub API plus a bare remote) and never touch the Forge worktree. The PR suite
sets separate fetch and local file push URLs to prove automatic contributor
`origin` / base `upstream` detection without contacting GitHub, then covers
qualified payloads, stale-owner rejection, and durable manual/background
refresh-attempt evidence.

## Unit Tests And Coverage

The runtime has a dependency-free Node test entrypoint that gathers the pure
module tests plus focused model-provider configuration and SQLite task-store
boundary tests:

```bash
cd runtime
npm run test:unit
npm run coverage:unit
```

`coverage:unit` uses Node's built-in test coverage. The small pure search,
index, recovery, parser, and stuck-detection modules are expected to stay near
complete coverage. `modelProvider.ts` and the composed runtime services are
primarily exercised by the end-to-end smoke fixtures, so the unit-only
aggregate must not be misread as whole-runtime coverage.

The SwiftPM package now has a `ForgeAppTests` target for native runtime-contract
decoding, provider-settings request encoding, pull-request display state,
appcast parsing, and runtime error messages. `RuntimeClient` accepts an injected
`URLSession`, so mock-transport tests also cover representative GET and JSON
POST requests, percent-encoded query paths, structured and plain-text HTTP
errors, non-HTTP fail-closed behavior, pull-request token placement, task-detail
routing, Mission Control access-policy negatives, and SSE frame parsing:

```bash
swift test --enable-code-coverage
```

This remains an early native test baseline. The 62 current tests include
three focused GitHub Device Flow tests covering local Client ID configuration,
GitHub `slow_down` interval handling, user validation before token persistence,
connected-state restoration, and actionable HTTP failures. The broader suite
raises direct `RuntimeClient.swift` line coverage to 53.37%, including explicit
review, validation, agent-loop control, and PR refresh source parameters.
The suite also covers Mission Control supervised-runtime evidence, fair queue
oldest-first/round-robin/eligibility/global-limit policy, and authorization
placement for supervisor grants. It additionally covers routed background
command/Git HTTP contracts and exact fail-closed Git request construction from
reviewed evidence, capped Mission Control reconnect timing/failure/recovery
state, and reconnect telemetry in copied diagnostics. One process-level
integration test bundles a minimal Node runtime fixture, uses a temporary
repository and random loopback port, pauses/restores transport on the same PID,
then sends `SIGKILL` only to the supervisor-owned fixture child. It verifies a
new PID, exact authorization/supervised-mode retention, cached Git/queue state,
recovery counters, and zero POST/dispatch requests. The fixture and event log
are removed with the temporary directory after the test; it never launches the
app or uses UI automation. `WorkspaceModel` now accepts an
isolated runtime and preferences store for tests; mock-runtime tests cover
successful and failed health refreshes, task creation/upsert/selection,
selection persistence, runtime-process start eligibility, validation-preset
approval success/loading state, validation failure cleanup, PR refresh
eligibility/order/caps, Background request labeling, and the zero-request
missing-credential boundary. The focused `PullRequestRefreshPolicy.swift` line
coverage is 85.45%, and the expanded `WorkspaceModel.swift` line coverage is
16.69%. SwiftUI rendering, most
model actions, CLI commands, widgets, and native system integrations still rely
on builds, handoff screenshot verification, and runtime smoke tests rather than
direct Swift unit or UI coverage.

GitHub Actions runs this same SwiftPM command on the `macos-15` hosted runner
for every pull request, every push to `main`, and manual dispatch. The workflow
also prints the application-only LLVM coverage report:

```text
.github/workflows/swift-tests.yml
```

## Build Checks

```bash
swift build
swift test --enable-code-coverage
cd runtime && npm run check
cd runtime && npm run check:docs
cd runtime && npm run build
cd runtime && npm run test:unit
cd runtime && npm run smoke:core
cd runtime && npm run smoke:git-conflicts
cd runtime && npm run smoke:git-remote
cd runtime && npm run smoke:mission-control-fairness
cd runtime && npm run smoke:secret-redaction
cd runtime && npm run campaign:reliability
cd runtime && npm run campaign:provider-reliability
cd runtime && npm run performance:smoke
```

Before a release-shaped change, run every `smoke:*` script — the full suite is
25 scripts and takes a few minutes. Both reliability campaigns are
intentionally separate from `smoke:all`: each creates four isolated Git
repositories and emits a staged scorecard. Use the corresponding `:baseline`
variant only when intentionally refreshing durable evidence in
`docs/reliability/`. The provider campaign runs the production OpenAI Responses
adapter against a loopback strict-schema mock, so it sends no repository data
to an external API and incurs no API cost.

`npm run check:docs` validates duplicated headline facts against the handoff
table, versioned reliability JSON, route manifest, and package scripts. See
`docs/documentation_truth.md` for the authority and branch-publication rules.

`npm run smoke:secret-redaction` requires no remote API. It launches one
isolated loopback Runtime and proves Provider-setting diagnostics, HTTP error
envelopes, task-command chunks/summaries, audit policy evidence, raw SQLite
payloads, and restart state contain the replacement marker without the fixture
credential. `scripts/secret-redaction-test.mjs` separately covers direct,
structured, private-key, URL, percent/base64, idempotence, false-positive, and
proposal-integrity behavior. Runtime Security CI runs this fixture alongside
the bounded approval lifecycle.

## Runtime Performance Budgets

The dependency-free performance campaign uses fresh temporary Git repositories,
SQLite stores, random loopback ports, and the local deterministic provider. It
does not use OpenAI/GitHub, mutate the Forge worktree, or launch the macOS app:

```bash
cd runtime
npm run performance:smoke     # hosted-CI safety ceiling
npm run performance:standard  # routine developer baseline
npm run performance:large     # manual stress profile
```

It measures runtime cold start, idle child CPU/RSS, retained-task list latency,
cold and unchanged repository indexing, Git status/diff, and one prepared local
agent step. Reports contain versioned JSON, Markdown, the exact environment and
fixture description, p50/p95/max summaries, hard/advisory evaluations, and an
exact budget snapshot. By default they land under the ignored
`.forge/performance-results/` directory; pass `--output <directory>` to retain
them elsewhere.

The separate `Runtime Performance` workflow runs the `smoke` profile with Node
22 on hosted macOS and uploads its reports on success or failure. Hard limits
are broad cross-machine guardrails; narrower idle resource targets remain
advisory. Optional comparisons require both a percentage regression and an
absolute noise-floor increase, and only compare matching profiles. See
`docs/performance_budgets.md` for the metric definitions, policy, limitations,
and follow-up real-repository/signed-package work.

## Current Limitations

- GitHub Device Flow is implemented but a live authorization requires a
  founder-owned GitHub OAuth App Client ID with Device Flow enabled. The public
  Client ID can be saved in Sign In or Settings; access tokens are validated
  against GitHub `/user` and stored in Keychain. Forge requests GitHub's
  classic `repo` OAuth scope, while the read/branch/PR cards describe Forge's
  own action boundary rather than three distinct GitHub OAuth scopes.
- Hosted Windorion Email sign-in is not implemented because the repository has
  no account backend, verification-email service, or sync API. The sign-in UI
  states this explicitly and allows local continuation. Product direction must
  choose hosted accounts or remove Email sign-in before implementation resumes.
- The OpenAI provider path is now editable in the macOS Settings UI, including
  provider id, model name, base URL, timeout, max output tokens, and Keychain
  API key sync.
- The OpenAI provider uses compact task/context summaries and Structured
  Outputs. It can now run bounded read/search context loops before plan
  revisions and before execution proposals, but tool use is still read-only.
  A first command-sourced repair proposal receives the complete dedicated
  repair-brief object even when no prior proposal or ordinary validation
  feedback exists; the mock-provider campaign covers this boundary. This
  protocol evidence does not measure live-model coding quality.
- Edit proposal application is intentionally narrow: v0 supports append-text
  operations on existing Markdown files in `README.md` or `docs/`, exact
  replace-text and multi-hunk patch-text operations on existing Markdown or
  allowlisted source/text files, strict Unified Diff modifications to existing
  allowlisted source/text files with EOF markers, and reviewed create/delete
  operations for allowlisted bounded text files. Validation blocks duplicate targets, unsupported paths, generated directories,
  lockfiles, secret-like files, unsupported operations, oversized edits,
  missing files, existing create targets, duplicate append text at the file
  end, replace operations whose find text is missing or appears more than
  once, patch hunks that cannot be matched exactly once, and Unified Diffs with
  mismatched paths, counts, ranges, context, or malformed newline markers. Richer OpenAI proposals can include unsupported
  preview-only operations for review, but those proposals are blocked from
  apply until revised to an apply-ready subset.
- The local deterministic provider recognizes explicit quoted replacements,
  including escaped quotes inside source strings, and bounded Markdown
  appends. Its passing repository reliability baseline is deterministic
  regression evidence, not a claim that it can synthesize arbitrary code from
  unconstrained natural language. Broader model quality still depends on the
  OpenAI path and a future curated external-repository campaign.
- Rollback is explicit and guarded. The runtime stores restore snapshots under
  `.forge/rollback-snapshots/`, verifies the current file still matches the
  recorded post-apply hash, and then restores prior contents or deletes a
  created file. Restores are hash-verified and partial rollback is compensated
  back to the applied state when possible. Rollback does not yet run a
  dedicated project validation preset automatically.
- Proposal repair is bounded and proposal-only. It can ask the provider to
  revise a blocked artifact from runtime validation feedback, but it does not
  apply files or run commands.
- Validation and task-command failure repair briefs are advisory. They
  summarize failed command output and suggest a next repair prompt, but they do
  not apply fixes or rerun validation/commands automatically.
- Follow-up repair proposals are review artifacts. They can be generated from a
  repair brief, but they still require validation and explicit human apply.
- General Git status and diff inspection are read-only review surfaces. The runtime
  blocks absolute paths, parent-directory traversal, and `.git`/`.forge`
  internals; diffs are bounded and large previews are truncated. The dedicated
  conflict action is the narrow exception: after exact confirmation and stale
  review checks it resolves and stages only one current unmerged file, without
  continuing the surrounding Git operation.
- App-managed runtime start/stop is a lifecycle convenience. During
  development it can build `runtime`; in an app bundle it can launch a
  prebuilt bundled runtime resource and pass the resolved repository root via
  `FORGE_REPO_ROOT`. A cold launch with a restored repository probes for an
  external runtime first and starts the managed runtime only after that probe
  fails. External terminal-launched runtime processes are detected through
  health checks but are not terminated by the app.
- Post-apply validation defaults to built-in `forge:` checks. Medium-risk
  project validation commands are allowlisted runtime presets, run without a
  shell, and require explicit task-level approval before execution.
- Command permission cards are a visibility and approval surface for
  allowlisted validation presets; they are not arbitrary shell execution.
- Task command runs reuse those approvals for one command ID at a time and
  stream bounded output chunks into task state. They are not arbitrary shell
  execution; the command chooser is runtime-derived and sends only command
  IDs, cancellation is limited to active runtime-owned task command runs by run
  id, and reviewed command-sourced self-fixes can be explicitly rerun through
  stored rerun evidence.
- SQLite schema v6 stores full task snapshots plus task/index fields and
  append-only task/workspace purge receipts. Migrations are ordered and
  transactional, prior-schema recovery is rehearsed, and destructive migrations
  are safety-classified behind verified snapshot manifests plus an offline
  restore CLI. Workspace retention v1 now covers task events, tool calls,
  messages, and rebuildable indexes with deterministic export-before-purge,
  terminal-only deletion, and unfinished-evidence preservation. Fully
  normalized runs/messages/tool-call tables remain deferred until query or
  scale evidence justifies the migration.
- Repository context remains bounded, but it now has durable file metadata,
  lightweight symbols, and trigram text indexes with live-scan verification.
  It still does not use Tree-sitter, embeddings, dependency graphs, or
  semantic/hybrid retrieval.
- Agent Loop v0 is still bounded and proposal-first. It now gathers read-only
  context before planning and before execution proposals. Agent Run Step v0
  can choose one safe proposal/command/repair action at a time, and Agent Run
  Loop v0 can chain those actions until a safe stop condition. It still does
  not provide arbitrary autonomous write/command/git execution.
