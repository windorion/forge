# Forge Runtime

The runtime is the local agent execution process for Forge.

This first slice is intentionally small:

- `GET /`
- `GET /health`
- `GET /tasks`
- `POST /tasks`
- `GET /events` as a Server-Sent Events stream

Creating a task starts Agent Loop v0. It is deterministic for now: the Manager
and Planner update task state, plan steps, events, and the review gate without
calling a model.

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
```
