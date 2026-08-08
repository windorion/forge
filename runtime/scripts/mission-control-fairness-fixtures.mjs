#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-fair-queue-${process.pid}-${Date.now()}`);
const basePort = 19980 + Math.floor(Math.random() * 120);
const tasksPerRepository = boundedInteger(process.env.FORGE_FAIR_QUEUE_TASKS_PER_REPOSITORY, 3, 2, 20);
const restartEveryGrants = boundedInteger(process.env.FORGE_FAIR_QUEUE_RESTART_EVERY_GRANTS, 2, 1, 20);
const soakSeconds = boundedInteger(process.env.FORGE_FAIR_QUEUE_SOAK_SECONDS, 0, 0, 86_400);
const repos = [repository("alpha", basePort), repository("beta", basePort + 1)];
const runtimes = new Map();
const grantOrder = [];

try {
  await mkdir(tempRoot, { recursive: true });
  for (const repo of repos) {
    await mkdir(repo.root, { recursive: true });
    await writeFile(join(repo.root, "README.md"), `# ${repo.name}\n`, "utf8");
    await run("git", ["init", "--quiet", repo.root], tempRoot);
    runtimes.set(repo.name, await startRuntime(repo));
  }

  for (const repo of repos) {
    const health = await get(repo, "/health");
    assert(health.queueDispatch?.mode === "supervised", `${repo.name} did not report supervised dispatch.`);
    assert(health.queueDispatch?.acceptsSupervisorGrants === true, `${repo.name} did not accept supervisor grants.`);
    const wrongGrant = await request(repo, "POST", "/queue/dispatch-next", { authorizationID: "wrong" }, false);
    assert(wrongGrant.status === 403, `${repo.name} accepted a stale supervisor authorization.`);
  }

  for (const repo of repos) {
    repo.tasks = [];
    for (let index = 0; index < tasksPerRepository; index += 1) {
      const task = await createPlanReadyTask(repo, index);
      repo.tasks.push(task);
      const queued = await post(repo, `/tasks/${task.id}/approve-plan-and-run`, {
        note: "Mission Control fairness fixture queues work behind a supervisor grant.",
        maxSteps: 1
      });
      assert(queued.currentPhase === "Agent Loop Queued", `${repo.name} task ${index} bypassed supervised queueing.`);
    }
  }

  await sleep(700);
  await assertGlobalState(0, tasksPerRepository * repos.length, "pre-grant hold");

  let nextIndex = 0;
  let grants = 0;
  while (true) {
    const snapshots = await Promise.all(repos.map(async (repo) => [repo, await get(repo, "/queue")]));
    const queuedTotal = snapshots.reduce((sum, [, queue]) => sum + queue.queued.length, 0);
    const runningTotal = snapshots.reduce((sum, [, queue]) => sum + queue.running.length, 0);
    if (queuedTotal === 0 && runningTotal === 0) break;

    if (runningTotal === 0) {
      const candidates = repos.filter((repo) => snapshots.find(([item]) => item === repo)[1].queued.length > 0);
      const preferred = repos[nextIndex % repos.length];
      const repo = candidates.includes(preferred) ? preferred : candidates[0];
      nextIndex = repos.indexOf(repo) + 1;
      const result = await post(repo, "/queue/dispatch-next", { authorizationID: repo.authorizationID }, 202);
      assert(result.accepted && result.taskID, `${repo.name} did not accept an available fair grant.`);
      grantOrder.push(repo.name);
      grants += 1;
      await waitForGlobalRunningAtMost(1);
      await waitUntil(async () => (await get(repo, "/queue")).running.length === 0, `${repo.name} granted loop completion`, 12_000);

      if (grants % restartEveryGrants === 0 && (await queuedCount()) > 0) {
        await restartRuntime(repo);
        await sleep(650);
        const afterRestart = await get(repo, "/queue");
        assert(afterRestart.running.length === 0, `${repo.name} dispatched persisted work during supervised restart.`);
      }
    } else {
      await sleep(80);
    }
  }

  assert(grants === tasksPerRepository * repos.length, "Not every queued task received exactly one grant.");
  assertNoStarvation(grantOrder);

  const soakDeadline = Date.now() + soakSeconds * 1_000;
  let soakCycles = 0;
  while (Date.now() < soakDeadline) {
    const repo = repos[soakCycles % repos.length];
    await restartRuntime(repo);
    const [health, queue, tasks] = await Promise.all([
      get(repo, "/health"), get(repo, "/queue"), get(repo, "/tasks")
    ]);
    assert(health.workspace.repoRoot === repo.root, `${repo.name} changed identity during soak.`);
    assert(queue.running.length === 0 && queue.queued.length === 0, `${repo.name} resurrected drained work during soak.`);
    assert(tasks.tasks.length === tasksPerRepository, `${repo.name} lost persisted tasks during soak.`);
    soakCycles += 1;
    await sleep(150);
  }

  console.log("Mission Control fair queue fixture passed.");
  console.log(`- Supervised hold: ${tasksPerRepository * repos.length} tasks stayed queued before grants`);
  console.log(`- Fair grants: ${grantOrder.join(" -> ")}`);
  console.log(`- Restart injection: every ${restartEveryGrants} grants; no startup auto-dispatch`);
  console.log("- Negative control: stale authorization rejected with 403");
  console.log(`- Optional soak: ${soakSeconds}s / ${soakCycles} restart cycles`);
} finally {
  await Promise.all([...runtimes.values()].map(stopRuntime));
  await rm(tempRoot, { recursive: true, force: true });
}

function repository(name, port) {
  return {
    name,
    port,
    root: join(tempRoot, name),
    authorizationID: `fair-${name}-authorization`,
    dbPath: join(tempRoot, `${name}.sqlite`),
    settingsPath: join(tempRoot, `${name}-provider.json`),
    queuePath: join(tempRoot, `${name}-queue.json`),
    tasks: []
  };
}

async function createPlanReadyTask(repo, index) {
  let task = await post(repo, "/tasks", {
    title: `${repo.name} fair task ${index}`,
    objective: `Inspect README.md for bounded queue evidence in ${repo.name}; do not edit files.`
  });
  task = await waitForTask(repo, task.id, (candidate) => candidate.status === "Human Review", "human review");
  if (task.currentPhase === "Clarification") {
    task = await post(repo, `/tasks/${task.id}/messages`, {
      content: "Done means the bounded read-only Agent Loop records one step. Use README.md and do not modify files."
    });
  }
  return waitForTask(
    repo,
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review" && candidate.planRevisions.length > 0,
    "plan review"
  );
}

async function startRuntime(repo) {
  const child = spawn("node", ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    shell: false,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(repo.port),
      FORGE_RUNTIME_MODE: "primary",
      FORGE_RUNTIME_AUTHORIZATION_ID: repo.authorizationID,
      FORGE_RUNTIME_AUTHORIZED_AT: "2026-08-08T12:00:00.000Z",
      FORGE_QUEUE_DISPATCH_MODE: "supervised",
      FORGE_REPO_ROOT: repo.root,
      FORGE_RUNTIME_DB_PATH: repo.dbPath,
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: repo.settingsPath,
      FORGE_TASK_QUEUE_SETTINGS_PATH: repo.queuePath,
      FORGE_MODEL_PROVIDER: "local",
      FORGE_MODEL_PROVIDER_LOCK: "local",
      FORGE_ENABLE_SMOKE_COMMANDS: "1",
      FORGE_QUEUE_SMOKE_DELAY_MS: "600",
      OPENAI_API_KEY: ""
    }
  });
  let output = "";
  let exited = false;
  const closed = new Promise((resolveClosed) => child.on("exit", resolveClosed));
  const append = (chunk) => { output = `${output}${chunk.toString("utf8")}`.slice(-12_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", () => { exited = true; });
  const handle = { child, closed, get exited() { return exited; }, get output() { return output; } };
  await waitUntil(async () => (await request(repo, "GET", "/health", undefined, false).catch(() => undefined))?.status === 200, `${repo.name} health`, 12_000, handle);
  return handle;
}

async function restartRuntime(repo) {
  await stopRuntime(runtimes.get(repo.name));
  runtimes.set(repo.name, await startRuntime(repo));
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

async function assertGlobalState(running, queued, label) {
  const snapshots = await Promise.all(repos.map((repo) => get(repo, "/queue")));
  assert(snapshots.reduce((sum, queue) => sum + queue.running.length, 0) === running, `${label}: wrong running count.`);
  assert(snapshots.reduce((sum, queue) => sum + queue.queued.length, 0) === queued, `${label}: wrong queued count.`);
}

async function waitForGlobalRunningAtMost(limit) {
  await waitUntil(async () => {
    const queues = await Promise.all(repos.map((repo) => get(repo, "/queue")));
    return queues.reduce((sum, queue) => sum + queue.running.length, 0) <= limit;
  }, `global running <= ${limit}`);
}

async function queuedCount() {
  const queues = await Promise.all(repos.map((repo) => get(repo, "/queue")));
  return queues.reduce((sum, queue) => sum + queue.queued.length, 0);
}

function assertNoStarvation(order) {
  for (let index = 1; index < order.length; index += 1) {
    assert(order[index] !== order[index - 1], `Fair order starved ${order[index] === "alpha" ? "beta" : "alpha"}.`);
  }
}

async function waitForTask(repo, taskID, predicate, label) {
  let latest;
  await waitUntil(async () => {
    latest = await get(repo, `/tasks/${taskID}`);
    return predicate(latest);
  }, `${repo.name} ${label}`, 10_000);
  return latest;
}

async function waitUntil(operation, label, timeoutMs = 8_000, handle) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle?.exited) throw new Error(`${label}: runtime exited.\n${handle.output}`);
    if (await operation()) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function get(repo, path) { return request(repo, "GET", path); }
async function post(repo, path, body, expectedStatus) {
  const result = await request(repo, "POST", path, body, false);
  const accepted = expectedStatus === undefined
    ? result.status >= 200 && result.status < 300
    : result.status === expectedStatus;
  if (!accepted) throw new Error(`${repo.name} POST ${path} returned ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function request(repo, method, path, body, requireOK = true) {
  const response = await fetch(`http://127.0.0.1:${repo.port}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (requireOK && !response.ok) throw new Error(`${repo.name} ${method} ${path} failed (${response.status}): ${text}`);
  return requireOK ? parsed : { status: response.status, body: parsed };
}

async function run(command, args, cwd) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: "ignore" });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited ${code}`)));
  });
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
