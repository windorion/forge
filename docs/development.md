# Development

Document role: record how to run the current development skeleton.

## Current Shape

Forge currently has two implementation pieces:

- `ForgeApp`: SwiftUI macOS shell built with SwiftPM.
- `runtime`: TypeScript local runtime skeleton.

The first vertical slice is app-runtime connectivity, not LLM execution.
The current slice adds Agent Loop v0: a deterministic local planner loop that
updates task state, agent status, plan steps, review summary, tool calls,
context files, approval history, model-provider execution proposals, SSE
events, safe edit proposals, and SQLite task persistence.

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

Agent Loop v0 currently runs local read-only tools:

- `list_project_files`: lists root and docs markdown files.
- `read_context_file`: reads selected project memory files.

The app shows those tool calls and the resulting context file summaries before
the task stops at the human review gate.

When a task reaches `Human Review`, the Review panel enables `Approve Plan`.
That action calls `POST /tasks/:taskID/approve-plan`, records approval history,
asks the model provider for an execution proposal, and moves the task into
`Execution Preparation` without changing files.

After an execution proposal exists, the Review panel enables
`Generate Edit Proposal`. That action calls
`POST /tasks/:taskID/generate-edit-proposal`, creates a proposed diff preview,
and returns the task to `Human Review` with current phase
`Edit Proposal Review`. It still does not change files.

When an edit proposal is ready, the Review panel enables `Apply Edit Proposal`
and `Request Changes`. Applying calls
`POST /tasks/:taskID/apply-edit-proposal`, runs the restricted v0 append-text
operation, records the changed Markdown file, and marks the task completed.
Requesting changes calls `POST /tasks/:taskID/reject-edit-proposal`, records the
rejection, leaves files unchanged, and allows another edit proposal to be
generated.

## Build Checks

```bash
swift build
cd runtime && npm run check
```

## Current Limitations

- No remote LLM provider is wired yet. The current provider is local and
  deterministic.
- Edit proposal application is intentionally narrow: v0 only supports
  append-text operations on existing Markdown files in `README.md` or `docs/`.
- SQLite currently stores full task snapshots plus basic task index fields; the
  full normalized runs/messages/tool-calls schema is still ahead.
- No repository scanner yet.
- Agent Loop v0 is deterministic and local; it simulates the planning and
  review gate before real model execution exists.
