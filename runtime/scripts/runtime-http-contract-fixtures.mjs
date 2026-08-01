#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { runtimeRouteManifest } from "../dist/http/routeManifest.js";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-http-contract-${process.pid}-${Date.now()}`);
const repoRoot = join(tempRoot, "repo");
const dbPath = join(tempRoot, "forge.sqlite");
const settingsPath = join(tempRoot, "model-provider-settings.json");
const primaryPort = 20100 + Math.floor(Math.random() * 300);
let runtime;

try {
  await assertRouteManifestMatchesHandler();
  await mkdir(repoRoot, { recursive: true });
  await writeFile(join(repoRoot, "README.md"), "# HTTP contract fixture\n", "utf8");
  await run("git", ["init", "--quiet", repoRoot], tempRoot);

  runtime = await startRuntime(primaryPort, "primary");
  const primaryURL = `http://127.0.0.1:${primaryPort}`;

  const preflight = await rawRequest(primaryURL, "OPTIONS", "/not-a-route");
  assert.equal(preflight.status, 204);
  assertCors(preflight);

  const health = await rawRequest(primaryURL, "GET", "/health");
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.runtimeMode, "primary");
  assertCors(health);

  const missing = await rawRequest(primaryURL, "GET", "/not-a-route");
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { error: "not_found" });

  const malformed = await rawRequest(primaryURL, "POST", "/tasks", "{\"title\":}", {
    "Content-Type": "application/json"
  });
  assert.equal(malformed.status, 500);
  assert.equal(malformed.json.error, "runtime_error");
  assert.match(malformed.json.message, /JSON|Unexpected/i);

  const eventStream = await openEventStream(primaryPort);
  await eventStream.waitFor("connected");
  const created = await rawRequest(primaryURL, "POST", "/tasks", JSON.stringify({
    title: "HTTP contract task",
    objective: "Verify the runtime HTTP and SSE contract."
  }), { "Content-Type": "application/json" });
  assert.equal(created.status, 201);
  const taskCreatedEvent = await eventStream.waitFor("task.created");
  assert.equal(taskCreatedEvent.taskID, created.json.id);
  eventStream.close();
  await sleep(50);
  assert.equal((await rawRequest(primaryURL, "GET", "/health")).status, 200);

  await stopRuntime(runtime);
  runtime = await startRuntime(primaryPort + 1, "observer");
  const observerURL = `http://127.0.0.1:${primaryPort + 1}`;
  const observerRejected = await rawRequest(observerURL, "POST", "/tasks", "{not-json", {
    "Content-Type": "application/json"
  });
  assert.equal(observerRejected.status, 403);
  assert.deepEqual(observerRejected.json, {
    error: "observer_read_only",
    message: "Observer runtime accepts read-only GET requests only. Focus the repository before taking an action."
  });

  console.log(`Runtime HTTP contract passed (${runtimeRouteManifest.length} routes).`);
} finally {
  await stopRuntime(runtime);
  await rm(tempRoot, { recursive: true, force: true });
}

async function assertRouteManifestMatchesHandler() {
  const source = await readFile(join(runtimeRoot, "src", "http", "runtimeRoutes.ts"), "utf8");
  const staticRoutes = [...source.matchAll(
    /request\.method === "(GET|POST)" && url\.pathname === "([^"]+)"/g
  )].map((match) => `${match[1]} ${match[2]}`);
  const actionRoutes = [...source.matchAll(
    /const (\w+) = taskIDFromActionPath\(url\.pathname, "([^"]+)"\);[\s\S]*?if \(request\.method === "(GET|POST)" && \1\)/g
  )].map((match) => `${match[3]} /tasks/:taskID/${match[2]}`);
  const implemented = ["OPTIONS /*", ...staticRoutes, ...actionRoutes].sort();
  const manifested = runtimeRouteManifest.map((route) => `${route.method} ${route.path}`).sort();

  assert.equal(runtimeRouteManifest.length, 55, "Route count changed; update the explicit contract intentionally.");
  assert.deepEqual(manifested, [...new Set(manifested)].sort(), "Route manifest contains duplicates.");
  assert.deepEqual(manifested, implemented, "Route manifest and request handler branches differ.");
  for (const route of runtimeRouteManifest) {
    assert.equal(route.availableInObserverMode, route.method !== "POST");
    assert.ok([200, 201, 204].includes(route.successStatus));
  }
}

async function startRuntime(port, mode) {
  const child = spawn("node", ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    shell: false,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_RUNTIME_MODE: mode,
      FORGE_REPO_ROOT: repoRoot,
      FORGE_RUNTIME_DB_PATH: dbPath,
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: settingsPath,
      FORGE_MODEL_PROVIDER: "local",
      FORGE_MODEL_PROVIDER_LOCK: "local",
      OPENAI_API_KEY: ""
    }
  });
  let output = "";
  let exited = false;
  const closed = new Promise((resolveClosed) => child.once("exit", resolveClosed));
  const append = (chunk) => { output = `${output}${chunk.toString("utf8")}`.slice(-8_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.once("exit", () => { exited = true; });
  const handle = { child, closed, get exited() { return exited; }, get output() { return output; } };
  const baseURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (handle.exited) throw new Error(`Runtime exited before health check.\n${handle.output}`);
    const result = await rawRequest(baseURL, "GET", "/health").catch(() => undefined);
    if (result?.status === 200) return handle;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${mode} runtime.\n${handle.output}`);
}

async function stopRuntime(handle) {
  if (!handle || handle.exited) return;
  handle.child.kill("SIGTERM");
  const stopped = await Promise.race([handle.closed.then(() => true), sleep(2_000).then(() => false)]);
  if (!stopped && !handle.exited) {
    handle.child.kill("SIGKILL");
    await handle.closed;
  }
}

async function rawRequest(baseURL, method, path, body, headers = {}) {
  const response = await fetch(`${baseURL}${path}`, { method, headers, body });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, headers: response.headers, text, json };
}

function assertCors(response) {
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET,POST,OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type");
}

async function openEventStream(port) {
  let buffer = "";
  const waiters = new Map();
  let response;
  const ready = new Promise((resolveReady, rejectReady) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/events", method: "GET" });
    request.once("error", rejectReady);
    request.once("response", (incoming) => {
      response = incoming;
      assert.equal(incoming.statusCode, 200);
      assert.equal(incoming.headers["content-type"], "text/event-stream");
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk) => {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (event && data) {
            const waiter = waiters.get(event);
            if (waiter) {
              waiters.delete(event);
              waiter.resolve(JSON.parse(data));
            } else {
              waiters.set(event, { value: JSON.parse(data) });
            }
          }
        }
      });
      resolveReady();
    });
    request.end();
  });
  await ready;
  return {
    waitFor(event) {
      const buffered = waiters.get(event);
      if (buffered?.value) {
        waiters.delete(event);
        return Promise.resolve(buffered.value);
      }
      return new Promise((resolveEvent, rejectEvent) => {
        const timeout = setTimeout(() => rejectEvent(new Error(`Timed out waiting for SSE event ${event}.`)), 5_000);
        waiters.set(event, {
          resolve(value) {
            clearTimeout(timeout);
            resolveEvent(value);
          }
        });
      });
    },
    close() { response?.destroy(); }
  };
}

async function run(command, args, cwd) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: "ignore" });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited ${code}`)));
  });
}
