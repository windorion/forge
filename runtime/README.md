# Forge Runtime

The runtime is the local agent execution process for Forge.

This first slice is intentionally small:

- `GET /`
- `GET /health`
- `GET /tasks`
- `GET /validation-presets`
- `POST /tasks`
- `POST /tasks/:taskID/approve-plan`
- `POST /tasks/:taskID/generate-edit-proposal`
- `POST /tasks/:taskID/validate-edit-proposal`
- `POST /tasks/:taskID/apply-edit-proposal`
- `POST /tasks/:taskID/reject-edit-proposal`
- `POST /tasks/:taskID/approve-validation-preset`
- `POST /tasks/:taskID/run-validation`
- `GET /events` as a Server-Sent Events stream

Creating a task starts Agent Loop v0. It is deterministic for now: the Manager
and Planner update task state, plan steps, events, and the review gate without
calling a model. Approving a plan records an approval and opens the controlled
execution preparation phase. The runtime then asks the configured model
provider for a safe execution proposal without applying file changes.
After that, a safe edit proposal can be generated as a proposed diff preview.
It is validated when generated and is not applied to the workspace until the
user explicitly applies it. The apply path revalidates against the current
workspace before writing. The current apply path is intentionally narrow: it
only supports append-text operations on existing Markdown files in `README.md`
or `docs/`. After apply, the runtime runs controlled built-in validation
commands and only marks the task completed if validation passes.

Validation presets:

- `forge-post-apply`: low-risk built-in audit checks.
- `runtime-typescript`: medium-risk project commands for `runtime`
  (`npm run check` and `npm run build`). This preset requires task-level
  approval before it can run.

Project validation commands are allowlisted by the runtime, run without a
shell, use repo-local cwd values, and record exit code plus output summary.

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
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/approve-plan \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/generate-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/validate-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/apply-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/reject-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{"note":"Needs a narrower change."}'
curl http://127.0.0.1:17373/validation-presets
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/approve-validation-preset \
  -H 'Content-Type: application/json' \
  -d '{"presetID":"runtime-typescript"}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/run-validation \
  -H 'Content-Type: application/json' \
  -d '{"presetID":"runtime-typescript"}'
```
