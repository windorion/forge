import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import type { AgentState, CreateTaskRequest, ForgeTask, RuntimeEvent } from "./types.js";

const startedAt = Date.now();
const port = Number(process.env.FORGE_RUNTIME_PORT ?? 17373);
const tasks = new Map<string, ForgeTask>();
const eventClients = new Set<ServerResponse>();

const defaultAgents: AgentState[] = [
  { role: "Manager", status: "Active", summary: "Owns task lifecycle and constraints" },
  { role: "Planner", status: "Ready", summary: "Preparing the first implementation plan" },
  { role: "Coder", status: "Idle", summary: "Waiting for approved plan" },
  { role: "Tester", status: "Idle", summary: "Waiting for validation command" },
  { role: "Reviewer", status: "Idle", summary: "Waiting for diff" }
];

const server = createServer(async (request, response) => {
  applyCors(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/") {
      writeHtml(response, 200, renderRuntimeHome());
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        ok: true,
        service: "forge-runtime",
        version: "0.1.0",
        uptimeSeconds: (Date.now() - startedAt) / 1000
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/tasks") {
      writeJson(response, 200, { tasks: [...tasks.values()] });
      return;
    }

    if (request.method === "POST" && url.pathname === "/tasks") {
      const input = await readJson<CreateTaskRequest>(request);
      const task = createTask(input);
      tasks.set(task.id, task);
      emit("task.created", { taskID: task.id, title: task.title });
      scheduleDemoProgress(task.id);
      writeJson(response, 201, task);
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      openEventStream(response);
      return;
    }

    writeJson(response, 404, { error: "not_found" });
  } catch (error) {
    writeJson(response, 500, {
      error: "runtime_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Forge runtime listening on http://127.0.0.1:${port}`);
});

function createTask(input: CreateTaskRequest): ForgeTask {
  const now = new Date().toISOString();
  const title = input.title?.trim() || "Untitled Forge task";
  const objective = input.objective?.trim() || "No objective provided.";
  const event: RuntimeEvent = {
    type: "task.created",
    message: "Task created and queued for planning.",
    createdAt: now
  };

  return {
    id: randomUUID(),
    title,
    objective,
    status: "Planning",
    currentPhase: "Planning",
    createdAt: now,
    updatedAt: now,
    agentStates: defaultAgents,
    events: [event]
  };
}

function scheduleDemoProgress(taskID: string): void {
  const updates: Array<[number, RuntimeEvent]> = [
    [600, { type: "plan.started", message: "Planner is building the first task plan.", createdAt: "" }],
    [1400, { type: "context.pending", message: "Repository context integration is not wired yet.", createdAt: "" }],
    [2200, { type: "review.pending", message: "Human review remains the next required gate.", createdAt: "" }]
  ];

  for (const [delay, event] of updates) {
    setTimeout(() => {
      const task = tasks.get(taskID);
      if (!task) {
        return;
      }

      const stamped = { ...event, createdAt: new Date().toISOString() };
      task.events.push(stamped);
      task.updatedAt = stamped.createdAt;
      task.currentPhase = stamped.type === "review.pending" ? "Plan Review" : task.currentPhase;
      tasks.set(taskID, task);
      emit(stamped.type, { taskID, message: stamped.message });
    }, delay);
  }
}

function openEventStream(response: ServerResponse): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  response.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  eventClients.add(response);

  response.on("close", () => {
    eventClients.delete(response);
  });
}

function emit(type: string, data: Record<string, unknown>): void {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of eventClients) {
    client.write(payload);
  }
}

function applyCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

function writeHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  response.end(body);
}

function renderRuntimeHome(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Forge Runtime</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f5f2;
      color: #171717;
    }
    main {
      max-width: 760px;
      margin: 72px auto;
      padding: 0 28px;
    }
    h1 {
      font-size: 34px;
      margin-bottom: 8px;
      letter-spacing: 0;
    }
    p {
      color: #555;
      line-height: 1.6;
    }
    code {
      background: #e9e6df;
      border-radius: 6px;
      padding: 2px 6px;
    }
    ul {
      margin-top: 24px;
      padding-left: 20px;
      line-height: 1.8;
    }
    a {
      color: #1756a9;
    }
  </style>
</head>
<body>
  <main>
    <h1>Forge Runtime is running</h1>
    <p>This local service powers the Forge macOS app. The full product UI runs through <code>swift run ForgeApp</code>.</p>
    <ul>
      <li><a href="/health">GET /health</a></li>
      <li><a href="/tasks">GET /tasks</a></li>
      <li><code>POST /tasks</code></li>
      <li><code>GET /events</code></li>
    </ul>
  </main>
</body>
</html>`;
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
