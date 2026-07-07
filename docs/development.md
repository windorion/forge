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

- `Check Runtime`: calls `GET /health` and refreshes tasks.
- `Start Demo Agent`: calls `POST /tasks` and starts Agent Loop v0.

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
  Outputs, but it is not yet part of a full tool-using agent loop.
- Edit proposal application is intentionally narrow: v0 only supports
  append-text and exact replace-text operations on existing Markdown files in
  `README.md` or `docs/`. Validation blocks unsupported paths, unsupported
  operations, oversized edits, missing files, duplicate append text at the file
  end, and replace operations whose find text is missing or appears more than
  once.
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
