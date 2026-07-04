# Forge Runtime

The runtime is the local agent execution process for Forge.

This first slice is intentionally small:

- `GET /`
- `GET /health`
- `GET /tasks`
- `POST /tasks`
- `POST /tasks/:taskID/approve-plan`
- `GET /events` as a Server-Sent Events stream

Creating a task starts Agent Loop v0. It is deterministic for now: the Manager
and Planner update task state, plan steps, events, and the review gate without
calling a model. Approving a plan records an approval and opens the controlled
execution preparation phase without applying file changes.

Task state is persisted locally in SQLite. By default the runtime stores task
snapshots in:

```text
.forge/forge.sqlite
```

Set `FORGE_RUNTIME_DB_PATH` to use a different SQLite file.

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
```
