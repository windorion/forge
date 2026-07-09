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

The runtime core has an automated smoke regression that exercises the main
task lifecycle without using real project memory or provider settings.

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

Opening that URL in a browser shows a small runtime status page. The full app
UI still runs through the SwiftUI app.

By default, runtime task history is stored in:

```text
.forge/forge.sqlite
```

Use `FORGE_RUNTIME_DB_PATH` to point the runtime at a different SQLite file.

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
briefs, plan revisions, execution proposals, and edit proposal guidance. The
runtime still owns validation, approvals, IDs, timestamps, and restricted file
operations.

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

Use the toolbar buttons:

- `Start Runtime`: builds the TypeScript runtime and launches the local Node
  runtime process from the app when the repository checkout can be resolved.
- `Stop Runtime`: stops the app-managed runtime process. It only controls the
  process started by Forge, not an unrelated terminal-launched runtime.
- `Check Runtime`: calls `GET /health` and refreshes tasks.
- `Start Demo Agent`: calls `POST /tasks` and starts Agent Loop v0.

The sidebar runtime badge shows app-level runtime state: unchecked, checking,
running, disconnected, wrong version, provider configuration issues, endpoint,
and event-stream state. It also provides actions to refresh health, open the
runtime status page, copy a diagnostics bundle, and start/stop the app-managed
runtime process. The Settings runtime tab shows the same state plus service,
version, uptime, database path, task count, last checked time, last error, and
the app-managed runtime process status, PID, and directory.

The Review panel also shows a `Working Tree` section backed by runtime git
endpoints. It refreshes `GET /git/status`, highlights files related to the
selected task, shows staged/unstaged/untracked state plus line stats when git
provides them, and can load a bounded side-by-side diff from
`GET /git/diff?path=<repo-relative-path>`. File actions are read-only: open
the file or reveal it in Finder. The same section can prepare a Branch Review
through `GET /git/branch-preview`, showing current branch, target branch,
create/switch mode, blockers, and risk notes. From that reviewed card, the
user can explicitly create a new local branch or switch to an existing clean
local branch through `POST /git/branch`; the runtime rechecks expected HEAD
and current branch, validates the branch name, blocks unmerged files, blocks
dirty switches, and does not push or publish a PR.
The same section can prepare a Branch Publish Review through
`GET /git/branch-publish-preview`, showing the current branch, configured
remote, remote branch, default base branch, commits to publish, local changes
that will remain local, blockers, and risk notes. From that reviewed card, the
user can explicitly publish the current branch and set upstream through
`POST /git/branch-publish`; the runtime rechecks expected HEAD, branch,
remote, and remote branch, blocks detached/default-base/already-upstream/
no-commit/unmerged/remote-collision states, and performs a non-force
`git push --set-upstream`. It does not create a PR.
The same section can prepare a read-only Commit Review through
`GET /git/commit-preview?taskID=<task-id>`, showing a
suggested commit message, included files, validation suggestions, blockers,
risk notes, and the explicit boundary that Forge has not staged, committed, or
pushed anything. From that reviewed card, the user can explicitly create one
local commit through `POST /git/commit`. The runtime rechecks the expected
HEAD, validates the selected paths, rejects unmerged files and staged files
outside the reviewed selection, preflights git identity, stages the selected
paths, creates the local commit, records a task event when linked, and still
does not push. A separate Push Review through `GET /git/push-preview` shows
branch, upstream, ahead/behind counts, commits to push, uncommitted local
changes, blockers, and risk notes. From that reviewed card, the user can
explicitly push the current branch through `POST /git/push`; the runtime
rechecks expected HEAD, branch, and upstream, blocks detached/no-upstream/
behind/no-ahead/unmerged states, and performs a non-force push to the
configured upstream. It does not create a PR. A read-only PR Handoff through
`GET /git/pr-preview` shows the default base branch, current head branch,
upstream, suggested branch name, PR title, draft body, test plan, commits,
changed files, blockers, and risk notes. That preview does not create,
publish, update, close, or comment on any pull request.

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

When a task reaches `Human Review`, the Review panel enables `Approve Plan`.
That action calls `POST /tasks/:taskID/approve-plan`, records approval history,
targets the current plan revision when one exists, asks the model provider for
an execution proposal, and moves the task into `Execution Preparation` without
changing files.

After an execution proposal exists, the Review panel enables
`Generate Edit Proposal`. That action calls
`POST /tasks/:taskID/generate-edit-proposal`, creates a proposed diff preview,
validates it against the current workspace, and returns the task to
`Human Review` with current phase `Edit Proposal Review`. It still does not
change files.
For the OpenAI provider, edit proposals can now include multiple file changes.
Only `AppendText`, exact `ReplaceText`, and restricted `CreateFile` operations
inside the Markdown boundary can validate as apply-ready. Create-file apply is
limited to new `docs/*.md` files. Delete, broad patch, unsupported path, or
preview-only operations remain review artifacts and block apply until revised.
If generated validation is blocked, the runtime can run a bounded repair loop:
it archives the blocked proposal as `Superseded`, sends the failed checks back
to the provider, and validates the repaired proposal before returning to human
review.

When an edit proposal is ready, the Review panel enables `Apply Edit Proposal`
and `Request Changes`. It also exposes `Validate Proposal`, which calls
`POST /tasks/:taskID/validate-edit-proposal` to refresh applicability checks
without writing files. Applying calls `POST /tasks/:taskID/apply-edit-proposal`,
revalidates the current workspace, runs the restricted v0 edit operation,
records the changed Markdown file, and marks the task completed.
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
run button. The runtime provides the task-specific permission state through
`GET /tasks/:taskID/validation-permissions`. The Settings window shows the
active provider status, editable provider settings, loaded workspace
validation config path, and any config issues.

## V0 Demo Script

Use this path for a local V0 walkthrough:

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
creates unique temporary Markdown fixtures under `docs/`, and deletes them at
the end.

It covers:

- create task
- message with repo-local file reference
- generate plan revision
- approve plan
- generate and validate edit proposal
- apply restricted edit proposal
- built-in post-apply validation
- SQLite restart recovery
- both `AppendText` and exact `ReplaceText`
- runtime home page, health diagnostics, persistence metadata, and model
  provider settings GET/POST paths
- provider settings key handling with a fake OpenAI key, including verification
  that the API key is never persisted to the settings file
- read-only git status and bounded git diff endpoints
- mock OpenAI plan-context loop before a plan revision
- read-only branch, branch-publish, commit, push, and PR handoff preview
  endpoints plus stale-head rejection checks for high-risk git actions
- mock OpenAI richer edit proposal with append/create apply and blocked
  preview-only artifact coverage
- mock OpenAI blocked-to-repaired edit proposal flow
- mock OpenAI failed validation repair brief flow
- mock OpenAI validation repair brief to follow-up proposal flow

In sandboxed Codex sessions, the command may need approval because it listens
on `127.0.0.1`.

## Build Checks

```bash
swift build
cd runtime && npm run check
cd runtime && npm run build
cd runtime && npm run smoke:core
```

## Current Limitations

- The OpenAI provider path is now editable in the macOS Settings UI, including
  provider id, model name, base URL, timeout, max output tokens, and Keychain
  API key sync.
- The OpenAI provider uses compact task/context summaries and Structured
  Outputs. It can now run a bounded read/search context loop before plan
  revisions, but tool use is still limited to pre-plan read-only context.
- Edit proposal application is intentionally narrow: v0 supports append-text
  and exact replace-text operations on existing Markdown files in `README.md`
  or `docs/`, plus create-file operations for new `docs/*.md` files only.
  Validation blocks unsupported paths, unsupported operations, oversized edits,
  missing files, existing create targets, duplicate append text at the file
  end, and replace operations whose find text is missing or appears more than
  once. Richer OpenAI proposals can include unsupported preview-only operations
  for review, but those proposals are blocked from apply until revised to an
  apply-ready subset.
- Proposal repair is bounded and proposal-only. It can ask the provider to
  revise a blocked artifact from runtime validation feedback, but it does not
  apply files or run commands.
- Validation failure repair briefs are advisory. They summarize failed command
  output and suggest a next repair prompt, but they do not apply fixes or rerun
  validation automatically.
- Follow-up repair proposals are review artifacts. They can be generated from a
  repair brief, but they still require validation and explicit human apply.
- Git status and diff inspection are read-only review surfaces. The runtime
  blocks absolute paths, parent-directory traversal, and `.git`/`.forge`
  internals; diffs are bounded and large previews are truncated.
- App-managed runtime start/stop is a development-lifecycle convenience. It
  builds `runtime`, launches `node dist/server.js`, and can stop only the
  process started by the app. External terminal-launched runtime processes are
  detected through health checks but are not terminated by the app.
- Post-apply validation defaults to built-in `forge:` checks. Medium-risk
  project validation commands are allowlisted runtime presets, run without a
  shell, and require explicit task-level approval before execution.
- Command permission cards are a visibility and approval surface for
  allowlisted validation presets; they are not arbitrary shell execution.
- SQLite currently stores full task snapshots plus basic task index fields; the
  full normalized runs/messages/tool-calls schema is still ahead.
- Repository context is still a bounded v1 scanner, not a full repository
  index. It does not use Tree-sitter, symbols, embeddings, dependency graphs,
  or semantic search yet.
- Agent Loop v0 is deterministic and local; it can inspect task-selected repo
  context, but it still simulates planning and review before real model
  execution exists.
