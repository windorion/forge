const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const port = Number.parseInt(process.env.FORGE_RUNTIME_PORT ?? "0", 10);
const repositoryRoot = process.env.FORGE_REPO_ROOT;
const runtimeMode = process.env.FORGE_RUNTIME_MODE === "observer" ? "observer" : "primary";
const authorizationID = process.env.FORGE_RUNTIME_AUTHORIZATION_ID;
const authorizedAt = process.env.FORGE_RUNTIME_AUTHORIZED_AT;
const eventLogPath = path.join(repositoryRoot, "supervisor-events.jsonl");
const disconnectControlPath = path.join(repositoryRoot, "disconnect-once");
const startedAt = Date.now();
let disconnecting = false;
let stopping = false;

function record(event) {
  fs.appendFileSync(eventLogPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

function respond(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function queueEntry(taskID, status, position, enqueuedAt) {
  return {
    taskID,
    title: `Fixture ${taskID}`,
    status,
    currentPhase: status === "Running" ? "Execution" : "Queued",
    position,
    enqueuedAt,
    estimatedMinutes: 1,
    loop: null
  };
}

function queueSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    concurrencyLimit: 1,
    effectiveRepositoryLimit: 1,
    running: [queueEntry("fixture-running", "Running", null, null)],
    queued: [queueEntry("fixture-queued", "Queued", 1, "2026-08-10T00:00:00.000Z")],
    needsAttention: [],
    completed: [],
    summary: "One running and one supervised queued fixture task.",
    operationBoundary: "Supervisor grant required.",
    dispatchMode: runtimeMode === "primary" ? "supervised" : "observer"
  };
}

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  record({ event: "request", pid: process.pid, method: request.method, path: requestPath });

  if (request.method !== "GET") {
    respond(response, 500, { error: "The supervisor fixture accepts no mutation request." });
    return;
  }
  if (requestPath === "/health") {
    respond(response, 200, {
      ok: true,
      service: "forge-runtime-supervisor-fixture",
      version: "0.1.0-test",
      uptimeSeconds: (Date.now() - startedAt) / 1000,
      runtimeMode,
      readOnly: runtimeMode === "observer",
      runtimeAuthorization: runtimeMode === "primary" ? {
        id: authorizationID,
        authorizedAt,
        scope: "repository-active"
      } : null,
      queueDispatch: runtimeMode === "primary" ? {
        mode: "supervised",
        acceptsSupervisorGrants: true
      } : null,
      workspace: {
        runtimeDir: process.cwd(),
        repoRoot: repositoryRoot,
        repoRootSource: "environment"
      },
      persistence: null,
      index: null
    });
    return;
  }
  if (requestPath === "/tasks") {
    respond(response, 200, { tasks: [] });
    return;
  }
  if (requestPath === "/queue") {
    respond(response, 200, queueSnapshot());
    return;
  }
  if (requestPath === "/git/status") {
    respond(response, 200, {
      isRepository: true,
      root: repositoryRoot,
      branch: "fixture-main",
      upstream: null,
      repositoryWebURL: null,
      head: "0123456789abcdef",
      ahead: 0,
      behind: 0,
      isDirty: false,
      summary: "Fixture repository is clean.",
      generatedAt: new Date().toISOString(),
      changedFiles: [],
      error: null
    });
    return;
  }
  respond(response, 404, { error: `Unknown fixture route: ${requestPath}` });
});

server.on("error", (error) => {
  record({ event: "server-error", pid: process.pid, code: error.code, message: error.message });
  if (!disconnecting && !stopping) process.exitCode = 1;
});

function listen(event) {
  server.listen(port, "127.0.0.1", () => {
    record({
      event,
      pid: process.pid,
      mode: runtimeMode,
      authorizationID: authorizationID ?? null,
      queueDispatchMode: process.env.FORGE_QUEUE_DISPATCH_MODE ?? null
    });
  });
}

const controlTimer = setInterval(() => {
  if (disconnecting || stopping || !fs.existsSync(disconnectControlPath)) return;
  disconnecting = true;
  fs.unlinkSync(disconnectControlPath);
  record({ event: "transport-down", pid: process.pid });
  server.close(() => {
    setTimeout(() => {
      if (stopping) return;
      listen("transport-up");
      disconnecting = false;
    }, 350);
  });
}, 20);

function stop(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(controlTimer);
  record({ event: "stop", pid: process.pid, signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

record({
  event: "start",
  pid: process.pid,
  mode: runtimeMode,
  authorizationID: authorizationID ?? null,
  queueDispatchMode: process.env.FORGE_QUEUE_DISPATCH_MODE ?? null
});
listen("listening");
