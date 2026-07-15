#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(runtimeRoot, "..");
const tempRoot = join(tmpdir(), `forge-queue-smoke-${process.pid}-${Date.now()}`);
const dbPath = join(tempRoot, "forge.sqlite");
const providerSettingsPath = join(tempRoot, "model-provider-settings.json");
const queueSettingsPath = join(tempRoot, "task-queue.json");
const port = 18400 + Math.floor(Math.random() * 800);
const baseURL = `http://127.0.0.1:${port}`;
let runtime;

try {
  await mkdir(tempRoot, { recursive: true });
  runtime = await startRuntime();

  const tasks = [];
  for (const suffix of ["one", "two", "three", "four"]) {
    tasks.push(await createPlanReadyTask(suffix));
  }

  let snapshot = await post("/queue/settings", { concurrencyLimit: 3 });
  assert(snapshot.concurrencyLimit === 3, "Queue concurrency setting was not updated.");
  assert(snapshot.effectiveRepositoryLimit === 1, "Same-repository execution must remain serialized.");

  const firstRun = post(`/tasks/${tasks[0].id}/approve-plan-and-run`, {
    note: "Queue smoke occupies the repository execution slot.",
    maxSteps: 1
  }).catch(() => undefined);

  await waitForQueue(
    (queue) => queue.running.length === 1 && queue.running[0].taskID === tasks[0].id,
    "first task to occupy the repository slot"
  );

  for (const task of tasks.slice(1)) {
    const queued = await post(`/tasks/${task.id}/approve-plan-and-run`, {
      note: "Queue smoke verifies serialized scheduling.",
      maxSteps: 1
    });
    assert(queued.currentPhase === "Agent Loop Queued", `Expected ${task.id} to be queued.`);
  }

  snapshot = await get("/queue");
  assert(snapshot.running.length === 1, "Only one same-repository task may run.");
  assert(snapshot.queued.length === 3, "Expected three persisted queued tasks.");
  assert(snapshot.queued.every((entry, index) => entry.position === index + 1), "Queue positions were not normalized.");

  snapshot = await post("/queue/reorder", {
    orderedTaskIDs: [tasks[3].id, tasks[1].id, tasks[2].id]
  });
  assert(snapshot.queued[0].taskID === tasks[3].id, "Queue reorder did not pin the selected task next.");

  snapshot = await post(`/tasks/${tasks[2].id}/remove-from-queue`, {});
  assert(snapshot.queued.length === 2, "Queue removal did not remove exactly one task.");
  assert(snapshot.queued.map((entry) => entry.taskID).join(",") === `${tasks[3].id},${tasks[1].id}`, "Queue order changed unexpectedly after removal.");
  const removed = await waitForTask(tasks[2].id, (task) => task.currentPhase === "Execution Ready", "removed task to become execution-ready");
  assert(removed.status === "Human Review", "Removed approved task should return to human review, not appear to be running.");

  await stopRuntime(runtime);
  runtime = undefined;
  await firstRun;

  runtime = await startRuntime();
  snapshot = await waitForQueue(
    (queue) => queue.running.some((entry) => entry.taskID === tasks[3].id),
    "restarted runtime to dispatch the persisted next task"
  );
  assert(snapshot.concurrencyLimit === 3, "Queue concurrency setting did not survive restart.");
  assert(snapshot.queued.length === 1 && snapshot.queued[0].taskID === tasks[1].id, "Persisted queue order did not survive restart.");

  snapshot = await waitForQueue(
    (queue) => queue.running.length === 0 && queue.queued.length === 0,
    "persisted queue to drain",
    14_000
  );
  assert(snapshot.operationBoundary.includes("serializes agent loops"), "Queue snapshot did not explain its safety boundary.");

  const fourth = await getTask(tasks[3].id);
  const second = await getTask(tasks[1].id);
  assert(fourth.events.some((event) => event.type === "agent.run_loop.started"), "Restart did not start the reordered next task.");
  assert(second.events.some((event) => event.type === "agent.run_loop.started"), "Queue did not dispatch the remaining task.");

  console.log("Task queue smoke passed.");
  console.log("- Same-repository serialization: 1 active task");
  console.log("- Reorder/remove: persisted and normalized");
  console.log("- Restart recovery: queue order and concurrency setting restored");
} finally {
  await stopRuntime(runtime);
  await rm(tempRoot, { recursive: true, force: true });
}

async function createPlanReadyTask(suffix) {
  let task = await post("/tasks", {
    title: `Queue smoke ${suffix}`,
    objective: `Prepare a bounded read-only queue smoke plan for ${suffix}; do not edit files.`
  });
  task = await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review",
    `${suffix} task to request review`
  );
  if (task.currentPhase === "Clarification") {
    task = await post(`/tasks/${task.id}/messages`, {
      content: "Done means the queue scheduler has accepted this bounded task. Use README.md as context and do not modify files."
    });
  }
  return waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review" && candidate.planRevisions.length > 0,
    `${suffix} task to reach plan review`
  );
}

async function startRuntime() {
  const child = spawn("node", ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    shell: false,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_RUNTIME_DB_PATH: dbPath,
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: providerSettingsPath,
      FORGE_TASK_QUEUE_SETTINGS_PATH: queueSettingsPath,
      FORGE_REPO_ROOT: repoRoot,
      FORGE_MODEL_PROVIDER: "local",
      FORGE_MODEL_NAME: "local-deterministic-queue-smoke",
      FORGE_ENABLE_SMOKE_COMMANDS: "1",
      FORGE_QUEUE_SMOKE_DELAY_MS: "3000"
    }
  });
  let output = "";
  let exited = false;
  const closed = new Promise((resolveClosed) => child.on("exit", resolveClosed));
  const appendOutput = (chunk) => { output = `${output}${chunk.toString("utf8")}`.slice(-12_000); };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  child.on("exit", () => { exited = true; });
  const handle = { child, closed, get output() { return output; }, get exited() { return exited; } };
  await waitUntil(async () => {
    const health = await get("/health").catch(() => undefined);
    return health?.ok === true && health.persistence?.databasePath === dbPath;
  }, "runtime health", 10_000, handle);
  return handle;
}

async function stopRuntime(handle) {
  if (!handle || handle.exited) return;
  handle.child.kill("SIGTERM");
  const closed = await Promise.race([handle.closed.then(() => true), sleep(2_500).then(() => false)]);
  if (!closed && !handle.exited) {
    handle.child.kill("SIGKILL");
    await handle.closed;
  }
}

async function waitForQueue(predicate, label, timeoutMs = 8_000) {
  let latest;
  await waitUntil(async () => {
    latest = await get("/queue");
    return predicate(latest);
  }, label, timeoutMs, runtime);
  return latest;
}

async function waitForTask(taskID, predicate, label, timeoutMs = 8_000) {
  let latest;
  await waitUntil(async () => {
    latest = await getTask(taskID);
    return latest && predicate(latest);
  }, label, timeoutMs, runtime);
  return latest;
}

async function waitUntil(check, label, timeoutMs, handle) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (handle?.exited) throw new Error(`Runtime exited while waiting for ${label}.\n${handle.output}`);
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message ?? "condition not met"}\n${handle?.output ?? ""}`);
}

async function getTask(taskID) {
  const response = await get("/tasks");
  return response.tasks.find((task) => task.id === taskID);
}

async function get(path) { return request("GET", path); }
async function post(path, body) { return request("POST", path, body); }

async function request(method, path, body) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : undefined;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
