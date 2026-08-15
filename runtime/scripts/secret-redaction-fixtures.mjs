#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-secret-redaction-${process.pid}-${Date.now()}`);
const repoRoot = join(tempRoot, "repo");
const databasePath = join(tempRoot, "forge.sqlite");
const settingsPath = join(tempRoot, "model-provider.json");
const port = 19900 + Math.floor(Math.random() * 300);
const token = ["ghp", "redactionfixture1234567890abcd"].join("_");
const baseURLPassword = "diagnostic-password-value";
let runtime;
let stage = "setup";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await mkdir(join(repoRoot, "runtime"), { recursive: true });
  await writeFile(join(repoRoot, "README.md"), "# Secret redaction fixture\n", "utf8");
  runtime = await startRuntime();

  stage = "diagnostic settings";
  const settings = await get("/settings/model-provider");
  const settingsText = JSON.stringify(settings);
  assert(!settingsText.includes(baseURLPassword), "Public provider diagnostics leaked URL credentials.");
  assert(settingsText.includes("[REDACTED]"), "Public provider diagnostics did not disclose the redaction marker.");

  stage = "HTTP error";
  const rejected = await postExpectError("/settings/model-provider", {
    providerID: token
  });
  assert(rejected.status === 400, `Invalid provider returned ${rejected.status}, expected 400.`);
  assert(!rejected.text.includes(token), "HTTP error response leaked request-supplied credential material.");

  stage = "command output";
  const task = await post("/tasks", {
    title: "Secret output boundary",
    objective: "Prove command evidence is redacted before persistence."
  });
  await post(`/tasks/${task.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    durationSeconds: 900
  });
  await post(`/tasks/${task.id}/run-task-command`, {
    commandID: "smoke-secret-output-command"
  });
  const completed = await waitForTask(
    task.id,
    (candidate) => candidate.taskCommandRuns.at(-1)?.status !== "Running",
    "secret fixture command to complete"
  );
  const commandRun = completed.taskCommandRuns.at(-1);
  assert(commandRun.status === "Passed", `Secret fixture command ended as ${commandRun.status}.`);
  assert(!commandRun.outputSummary.includes(token), "Command summary leaked a token.");
  assert(commandRun.outputSummary.includes("[REDACTED]"), "Command summary omitted redaction evidence.");
  assert(commandRun.outputChunks.length > 0, "Command output chunk was not recorded.");
  assert(commandRun.outputChunks.every((chunk) => !chunk.text.includes(token)), "Command chunk leaked a token.");

  stage = "audit export";
  const audit = await get(`/tasks/${task.id}/audit-export?format=json`);
  assert(!audit.content.includes(token), "Audit export leaked command credential material.");
  const auditRecord = JSON.parse(audit.content);
  assert(auditRecord.redactionPolicy.id === "forge-secret-redaction", "Audit omitted redaction policy identity.");
  assert(auditRecord.redactionPolicy.version === 1, "Audit omitted redaction policy version.");

  stage = "persistence and restart";
  await stopRuntime(runtime);
  runtime = undefined;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database.prepare("SELECT payload_json FROM tasks WHERE id = ?").get(task.id);
    assert(row?.payload_json, "Fixture task was not persisted.");
    assert(!String(row.payload_json).includes(token), "SQLite task payload leaked command credential material.");
    assert(String(row.payload_json).includes("[REDACTED]"), "SQLite task payload lost redaction evidence.");
  } finally {
    database.close();
  }

  runtime = await startRuntime();
  const restarted = await taskByID(task.id);
  assert(restarted, "Redacted task did not survive restart.");
  assert(!JSON.stringify(restarted).includes(token), "Restart revived credential material from persistence.");

  console.log("Secret redaction fixtures passed.");
  console.log("- Provider diagnostics remove URL credentials");
  console.log("- HTTP errors redact request-supplied tokens");
  console.log("- Command chunks and summaries redact before SSE/task persistence");
  console.log("- Audit policy evidence and restart-safe SQLite boundary");
} catch (error) {
  console.error(`Secret redaction fixture failed during: ${stage}`);
  if (runtime?.output) console.error(`Runtime output before failure:\n${runtime.output}`);
  throw error;
} finally {
  await stopRuntime(runtime);
  await rm(tempRoot, { recursive: true, force: true });
}

async function startRuntime() {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_REPO_ROOT: repoRoot,
      FORGE_RUNTIME_DB_PATH: databasePath,
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: settingsPath,
      FORGE_MODEL_PROVIDER: "local",
      FORGE_OPENAI_BASE_URL: `https://forge:${baseURLPassword}@example.test/v1`,
      FORGE_SECRET_REDACTION_FIXTURE: token,
      FORGE_ENABLE_SMOKE_COMMANDS: "1",
      FORGE_STUCK_SWEEP_INTERVAL_MS: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { child.output += chunk.toString("utf8"); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const health = await get("/health");
      if (health.ok && health.workspace?.repoRoot === repoRoot) return child;
    } catch {
      // Runtime is still starting.
    }
    await sleep(100);
  }
  await stopRuntime(child);
  throw new Error(`Runtime did not become healthy.\n${child.output}`);
}

async function stopRuntime(child) {
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await sleep(100);
  }
  child.kill("SIGKILL");
}

async function taskByID(taskID) {
  const payload = await get("/tasks");
  return (payload.tasks ?? payload).find((task) => task.id === taskID);
}

async function waitForTask(taskID, predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await taskByID(taskID);
    if (task && predicate(task)) return task;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function get(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { connection: "close" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${path} failed with ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function postExpectError(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(body)
  });
  return { status: response.status, text: await response.text() };
}
