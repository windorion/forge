# Development

Document role: record how to run the current development skeleton.

## Current Shape

Forge currently has two implementation pieces:

- `ForgeApp`: SwiftUI macOS shell built with SwiftPM.
- `runtime`: TypeScript local runtime skeleton.

The first vertical slice is app-runtime connectivity, not LLM execution.

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

## Run macOS App

From the repository root:

```bash
swift run ForgeApp
```

Use the toolbar buttons:

- `Check Runtime`: calls `GET /health` and refreshes tasks.
- `Create Demo Task`: calls `POST /tasks` and inserts the returned task.

## Build Checks

```bash
swift build
cd runtime && npm run check
```

## Current Limitations

- No LLM provider is wired yet.
- No SQLite persistence yet.
- No repository scanner yet.
- The runtime stores tasks in memory.
- The app does not consume the SSE event stream yet; it refreshes via HTTP.
