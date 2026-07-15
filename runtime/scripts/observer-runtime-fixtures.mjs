#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-observer-smoke-${process.pid}-${Date.now()}`);
const repoRoot = join(tempRoot, "repo");
const dbPath = join(repoRoot, ".forge", "forge.sqlite");
const settingsPath = join(tempRoot, "model-provider-settings.json");
const primaryPort = 19300 + Math.floor(Math.random() * 300);
let runtime;

try {
  await mkdir(repoRoot, { recursive: true });
  await writeFile(join(repoRoot, "README.md"), "# Observer Smoke\n", "utf8");
  await run("git", ["init", "--quiet", repoRoot], tempRoot);

  runtime = await startRuntime(primaryPort, "primary");
  await stopRuntime(runtime);
  runtime = undefined;
  const beforeHash = await sha256(dbPath);

  runtime = await startRuntime(primaryPort + 1, "observer");
  const baseURL = `http://127.0.0.1:${primaryPort + 1}`;
  const health = await request(baseURL, "GET", "/health");
  assert(health.runtimeMode === "observer", "Observer health did not report observer mode.");
  assert(health.readOnly === true, "Observer health did not report its read-only boundary.");
  assert(health.workspace.repoRoot === repoRoot, "Observer inspected the wrong repository.");
  await request(baseURL, "GET", "/tasks");
  await request(baseURL, "GET", "/queue");
  const git = await request(baseURL, "GET", "/git/status");
  assert(git.isRepository === true, "Observer git status did not inspect the registered repository.");

  const rejected = await request(baseURL, "POST", "/tasks", { title: "blocked", objective: "must not run" }, false);
  assert(rejected.status === 403, `Expected observer POST guard 403, got ${rejected.status}.`);
  assert(rejected.body.error === "observer_read_only", "Observer POST guard returned the wrong error.");

  await stopRuntime(runtime);
  runtime = undefined;
  const afterHash = await sha256(dbPath);
  assert(afterHash === beforeHash, "Observer runtime changed the repository task database.");

  const authorizationID = "observer-smoke-active-authorization";
  runtime = await startRuntime(primaryPort + 1, "primary", authorizationID);
  const activeBaseURL = `http://127.0.0.1:${primaryPort + 1}`;
  const activeHealth = await request(activeBaseURL, "GET", "/health");
  assert(activeHealth.runtimeMode === "primary", "Authorized runtime did not report primary mode.");
  assert(activeHealth.readOnly === false, "Authorized runtime did not report read-write access.");
  assert(activeHealth.runtimeAuthorization?.id === authorizationID, "Authorized runtime did not echo its authorization evidence.");
  assert(activeHealth.runtimeAuthorization?.scope === "repository-active", "Authorized runtime reported the wrong authorization scope.");
  assert(activeHealth.modelProvider?.id === "local", "Authorized runtime did not enforce the local provider lock.");
  const rejectedProviderChange = await request(
    activeBaseURL,
    "POST",
    "/settings/model-provider",
    { providerID: "openai" },
    false
  );
  assert(rejectedProviderChange.status === 403, "Authorized background runtime allowed its provider lock to change.");
  const created = await request(activeBaseURL, "POST", "/tasks", {
    title: "Authorized background task",
    objective: "Prove writes occur only after explicit runtime promotion."
  });
  assert(created.title === "Authorized background task", "Authorized runtime did not create the task.");
  await stopRuntime(runtime);
  runtime = undefined;
  const activeHash = await sha256(dbPath);
  assert(activeHash !== beforeHash, "Authorized runtime did not persist its accepted mutation.");

  runtime = await startRuntime(primaryPort + 1, "observer");
  const restoredReadOnlyTasks = await request(baseURL, "GET", "/tasks");
  assert(restoredReadOnlyTasks.tasks.some((task) => task.id === created.id), "Restored observer could not see the authorized task.");
  const rejectedAfterRevoke = await request(
    baseURL,
    "POST",
    "/tasks",
    { title: "blocked again", objective: "read-only must be restored" },
    false
  );
  assert(rejectedAfterRevoke.status === 403, "Restored observer accepted a mutation after authorization was revoked.");
  await stopRuntime(runtime);
  runtime = undefined;
  assert(await sha256(dbPath) === activeHash, "Restored observer changed the authorized runtime database.");

  console.log("Observer runtime smoke passed.");
  console.log("- Health mode: observer/read-only");
  console.log("- GET tasks/queue/git: available");
  console.log("- POST mutation: rejected with 403");
  console.log("- SQLite bytes: unchanged");
  console.log("- Explicit active mode: mutation accepted and persisted");
  console.log("- Active provider: locked local; settings mutation rejected");
  console.log("- Authorization revoked: observer restored and POST blocked");
} finally {
  await stopRuntime(runtime);
  await rm(tempRoot, { recursive: true, force: true });
}

async function startRuntime(port, mode, authorizationID) {
  const environment = {
    ...process.env,
    FORGE_RUNTIME_PORT: String(port),
    FORGE_RUNTIME_MODE: mode,
    FORGE_REPO_ROOT: repoRoot,
    FORGE_RUNTIME_DB_PATH: dbPath,
    FORGE_MODEL_PROVIDER_SETTINGS_PATH: settingsPath,
    FORGE_MODEL_PROVIDER: "local",
    FORGE_MODEL_PROVIDER_LOCK: "local",
    OPENAI_API_KEY: ""
  };
  if (authorizationID) {
    environment.FORGE_RUNTIME_AUTHORIZATION_ID = authorizationID;
    environment.FORGE_RUNTIME_AUTHORIZED_AT = "2026-07-15T20:00:00.000Z";
  } else {
    delete environment.FORGE_RUNTIME_AUTHORIZATION_ID;
    delete environment.FORGE_RUNTIME_AUTHORIZED_AT;
  }
  const child = spawn("node", ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    shell: false,
    env: environment
  });
  let output = "";
  let exited = false;
  const closed = new Promise((resolveClosed) => child.on("exit", resolveClosed));
  const append = (chunk) => { output = `${output}${chunk.toString("utf8")}`.slice(-8_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", () => { exited = true; });
  const handle = { child, closed, get exited() { return exited; }, get output() { return output; } };
  const baseURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (handle.exited) throw new Error(`Runtime exited before health check.\n${handle.output}`);
    const health = await request(baseURL, "GET", "/health", undefined, false).catch(() => undefined);
    if (health?.status === 200) return handle;
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

async function request(baseURL, method, path, body, requireOK = true) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (requireOK && !response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  return requireOK ? parsed : { status: response.status, body: parsed };
}

async function run(command, args, cwd) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: "ignore" });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited ${code}`)));
  });
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
