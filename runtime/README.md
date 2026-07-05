# Forge Runtime

The runtime is the local agent execution process for Forge.

This first slice is intentionally small:

- `GET /`
- `GET /health`
- `GET /tasks`
- `GET /validation-presets`
- `GET /tasks/:taskID/validation-permissions`
- `POST /tasks`
- `POST /tasks/:taskID/messages`
- `POST /tasks/:taskID/generate-plan-revision`
- `POST /tasks/:taskID/approve-plan`
- `POST /tasks/:taskID/generate-edit-proposal`
- `POST /tasks/:taskID/revise-edit-proposal`
- `POST /tasks/:taskID/validate-edit-proposal`
- `POST /tasks/:taskID/apply-edit-proposal`
- `POST /tasks/:taskID/reject-edit-proposal`
- `POST /tasks/:taskID/approve-validation-preset`
- `POST /tasks/:taskID/run-validation`
- `GET /events` as a Server-Sent Events stream

Creating a task starts Agent Loop v0. It is deterministic for now: the Manager
and Planner update task state, plan steps, events, task conversation, and the
review gate without calling a remote model. Creating a task records the initial
user objective as a task message and asks the configured provider for a
structured intent brief. The task conversation can continue through
`POST /tasks/:taskID/messages`; each user message gets a new provider-generated
intent brief with summary, constraints, acceptance criteria, open questions,
and next action. User messages can mention repo files with paths such as
`README.md`, `docs/v0_scope.md`, or `@runtime/src/server.ts:120`. The runtime
resolves up to six safe repo-local file references, stores their summaries on
the message, and exposes missing or blocked references without reading outside
the workspace.

The task conversation can also drive planning through
`POST /tasks/:taskID/generate-plan-revision`. It asks the configured model
provider to turn the latest task message and intent brief into a new plan
revision. The runtime replaces the visible plan steps with the revision, clears
any prepared execution proposal, returns the task to `Human Review`, and
requires a fresh plan approval before execution can continue. The endpoint is
blocked while an edit proposal is still proposed or already applied.

Approving a plan records an approval and opens the controlled execution
preparation phase. The runtime then asks the configured model provider for a
safe execution proposal without applying file changes.
After that, a safe edit proposal can be generated as a proposed diff preview.
It is validated when generated and is not applied to the workspace until the
user explicitly applies it. If the user requests changes, the rejected proposal
can be revised through `POST /tasks/:taskID/revise-edit-proposal`; the runtime
archives the rejected proposal, asks the model provider for a new proposal from
the latest task conversation, validates it, and returns to human review without
writing files. The apply path revalidates against the current workspace before
writing. The current apply path is intentionally narrow: it only supports
append-text operations on existing Markdown files in `README.md` or `docs/`.
After apply, the runtime runs controlled built-in validation commands and only
marks the task completed if validation passes.

Validation presets:

- `forge-post-apply`: low-risk built-in audit checks.
- `runtime-typescript`: medium-risk project commands for `runtime`
  (`npm run check` and `npm run build`). This preset requires task-level
  approval before it can run.
- `macos-swiftpm`: medium-risk project command for the native macOS app
  (`swift build` from the repository root). This preset requires task-level
  approval before it can run.

Workspace presets can be loaded from:

```text
.forge/validation-presets.json
```

Workspace presets can only reference runtime-known command IDs such as
`runtime-npm-check`, `runtime-npm-build`, and `macos-swift-build`; they cannot
define raw shell commands.

Project validation commands are allowlisted by the runtime, run without a
shell, use repo-local cwd values, and record exit code plus output summary.
`GET /tasks/:taskID/validation-permissions` returns a task-specific permission
snapshot for each preset, including approval state, execution state, blocked
reasons, command execution mode, and the last run for that preset.

Task state is persisted locally in SQLite. By default the runtime stores task
snapshots in:

```text
.forge/forge.sqlite
```

Set `FORGE_RUNTIME_DB_PATH` to use a different SQLite file.

The default model provider is local and deterministic:

```text
FORGE_MODEL_PROVIDER=local
FORGE_MODEL_NAME=local-deterministic-v0
```

## Development

```bash
cd runtime
npm install
npm run dev
```

The server listens on:

```text
http://127.0.0.1:17373
```

## Example

```bash
curl http://127.0.0.1:17373/health
curl -X POST http://127.0.0.1:17373/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Demo task","objective":"Prove task creation."}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/messages \
  -H 'Content-Type: application/json' \
  -d '{"content":"Make the acceptance criteria explicit before planning. Use `docs/v0_scope.md`."}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/generate-plan-revision \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/approve-plan \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/generate-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/reject-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{"note":"Needs a narrower change."}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/messages \
  -H 'Content-Type: application/json' \
  -d '{"content":"Revise the proposal around a narrower documentation change in @docs/development.md."}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/revise-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/validate-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/apply-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl http://127.0.0.1:17373/validation-presets
curl http://127.0.0.1:17373/tasks/<task-id>/validation-permissions
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/approve-validation-preset \
  -H 'Content-Type: application/json' \
  -d '{"presetID":"runtime-typescript"}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/run-validation \
  -H 'Content-Type: application/json' \
  -d '{"presetID":"runtime-typescript"}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/approve-validation-preset \
  -H 'Content-Type: application/json' \
  -d '{"presetID":"macos-swiftpm"}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/run-validation \
  -H 'Content-Type: application/json' \
  -d '{"presetID":"macos-swiftpm"}'
```
