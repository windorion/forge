# Forge Runtime

The runtime is the local agent execution process for Forge.

This first slice is intentionally small:

- `GET /health`
- `GET /tasks`
- `POST /tasks`
- `GET /events` as a Server-Sent Events stream

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
