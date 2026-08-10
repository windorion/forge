#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { SqliteTaskStore } from "../dist/taskStore.js";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-retention-${process.pid}-${Date.now()}`);
const repoRoot = join(tempRoot, "repo");
const dbPath = join(tempRoot, "forge.sqlite");
const port = 20500 + Math.floor(Math.random() * 300);
let runtime;

try {
  await mkdir(repoRoot, { recursive: true });
  await writeFile(join(repoRoot, "README.md"), "# Retention fixture\n", "utf8");
  seedTerminalTask();
  runtime = await startRuntime(port, "primary");

  const preview = await request(port, "GET", "/tasks/retention-fixture/history-retention-preview");
  assert.equal(preview.status, 200);
  assert.equal(preview.json.policy.taskHistory, "KeepByDefault");
  assert.equal(preview.json.policy.automaticPurge, false);
  assert.equal(preview.json.eligible, true);
  assert.equal(preview.json.commandRunsWithOutput, 1);
  assert.equal(preview.json.validationCommandsWithOutput, 1);

  const exportEnvelope = (await request(
    port, "GET", "/tasks/retention-fixture/audit-export?format=json"
  )).json;
  assert.match(exportEnvelope.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(exportEnvelope.sourceTaskUpdatedAt, preview.json.taskUpdatedAt);
  assert(exportEnvelope.content.includes("fixture command output"));

  const forged = await request(port, "POST", "/tasks/retention-fixture/purge-history", {
    confirmation: "PurgeTaskHistory",
    expectedUpdatedAt: preview.json.taskUpdatedAt,
    scope: "CommandOutput",
    exportReceipt: {
      generatedAt: exportEnvelope.generatedAt,
      sourceTaskUpdatedAt: exportEnvelope.sourceTaskUpdatedAt,
      sourceSha256: "0".repeat(64)
    }
  });
  assert.equal(forged.status, 409);
  assert.match(forged.json.message, /receipt hash does not match/);

  const purged = await request(port, "POST", "/tasks/retention-fixture/purge-history", {
    confirmation: "PurgeTaskHistory",
    expectedUpdatedAt: preview.json.taskUpdatedAt,
    scope: "CommandOutput",
    exportReceipt: {
      generatedAt: exportEnvelope.generatedAt,
      sourceTaskUpdatedAt: exportEnvelope.sourceTaskUpdatedAt,
      sourceSha256: exportEnvelope.sourceSha256
    }
  });
  assert.equal(purged.status, 200);
  assert.equal(purged.json.receipt.recordsAffected, 2);
  assert(purged.json.receipt.bytesRemoved > 0);
  assert.equal(purged.json.task.taskCommandRuns[0].outputChunks.length, 0);
  assert.match(purged.json.task.taskCommandRuns[0].outputSummary, /purged after verified audit export/);
  assert.match(purged.json.task.validationRuns[0].commands[0].outputSummary, /purged after verified audit export/);
  assert.equal(purged.json.task.taskCommandRuns[0].exitCode, 0);
  assert.equal(purged.json.task.historyPurges.length, 1);
  assert.equal(purged.json.task.events.at(-1).type, "task.history.purged");

  const repeated = await request(port, "POST", "/tasks/retention-fixture/purge-history", {
    confirmation: "PurgeTaskHistory",
    expectedUpdatedAt: purged.json.task.updatedAt,
    scope: "CommandOutput",
    exportReceipt: {
      generatedAt: exportEnvelope.generatedAt,
      sourceTaskUpdatedAt: exportEnvelope.sourceTaskUpdatedAt,
      sourceSha256: exportEnvelope.sourceSha256
    }
  });
  assert.equal(repeated.status, 409);
  assert.match(repeated.json.message, /No retained command output/);

  await stopRuntime(runtime);
  runtime = undefined;
  const raw = new DatabaseSync(dbPath, { readOnly: true });
  const receiptCount = Number(raw.prepare(
    "SELECT COUNT(*) AS count FROM task_history_purges WHERE task_id = ?"
  ).get("retention-fixture").count);
  raw.close();
  assert.equal(receiptCount, 1, "Purge receipt table did not retain exactly one atomic receipt.");

  runtime = await startRuntime(port + 1, "primary");
  const restored = (await request(port + 1, "GET", "/tasks/retention-fixture")).json;
  assert.equal(restored.historyPurges.length, 1);
  assert.equal(restored.taskCommandRuns[0].outputChunks.length, 0);
  const afterExport = (await request(
    port + 1, "GET", "/tasks/retention-fixture/audit-export?format=json"
  )).json;
  assert(!afterExport.content.includes("fixture command output"));
  assert.equal(JSON.parse(afterExport.content).historyPurges.length, 1);

  console.log("Task history retention fixtures passed.");
  console.log("- Keep-by-default preview with no automatic purge");
  console.log("- Forged/stale export receipt rejected before mutation");
  console.log("- Explicit terminal-task command output purge preserves metadata");
  console.log("- Atomic schema-v5 receipt and purged snapshot survive restart");
} finally {
  await stopRuntime(runtime);
  await rm(tempRoot, { recursive: true, force: true });
}

function seedTerminalTask() {
  const store = new SqliteTaskStore(dbPath);
  store.saveTask({
    id: "retention-fixture",
    title: "Retention fixture",
    objective: "Prove the export-before-purge runtime boundary.",
    status: "Completed",
    currentPhase: "Completed",
    createdAt: "2026-08-10T18:00:00.000Z",
    updatedAt: "2026-08-10T18:05:00.000Z",
    agentStates: [], planSteps: [], events: [], approvals: [], toolCalls: [],
    agentRunLoops: [], agentRunSteps: [], commandRerunEvidence: [],
    validationRepairBriefs: [], messages: [], planRevisions: [],
    editProposalRevisions: [], contextFiles: [], changedFiles: [],
    taskCommandRuns: [{
      id: "command-1", commandID: "runtime-test", name: "Runtime tests",
      command: "npm test", kind: "ProjectCommand", riskLevel: "Medium",
      status: "Passed", outputSummary: "fixture command output",
      outputChunks: [{
        id: "chunk-1", stream: "stdout", text: "fixture command output body\n",
        createdAt: "2026-08-10T18:01:00.000Z"
      }],
      exitCode: 0, startedAt: "2026-08-10T18:01:00.000Z", endedAt: "2026-08-10T18:01:01.000Z"
    }],
    validationRuns: [{
      id: "validation-1", trigger: "PostApply", presetID: "runtime-typescript",
      presetName: "Runtime TypeScript", presetSource: "BuiltIn", riskLevel: "Medium",
      status: "Passed", summary: "Validation passed.",
      startedAt: "2026-08-10T18:02:00.000Z", endedAt: "2026-08-10T18:02:01.000Z",
      commands: [{
        id: "validation-command-1", name: "Type check", command: "npm run check",
        kind: "ProjectCommand", riskLevel: "Medium", status: "Passed",
        outputSummary: "fixture validation output", exitCode: 0,
        startedAt: "2026-08-10T18:02:00.000Z", endedAt: "2026-08-10T18:02:01.000Z"
      }]
    }]
  });
  store.close();
}

async function startRuntime(runtimePort, mode) {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    shell: false,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(runtimePort),
      FORGE_RUNTIME_MODE: mode,
      FORGE_REPO_ROOT: repoRoot,
      FORGE_RUNTIME_DB_PATH: dbPath,
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: join(tempRoot, "model-provider.json"),
      FORGE_MODEL_PROVIDER: "local",
      OPENAI_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
  child.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Runtime exited before health.\n${output}`);
    const health = await request(runtimePort, "GET", "/health").catch(() => undefined);
    if (health?.status === 200) return child;
    await sleep(100);
  }
  child.kill("SIGKILL");
  throw new Error(`Timed out waiting for retention runtime.\n${output}`);
}

async function stopRuntime(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await sleep(100);
  }
  child.kill("SIGKILL");
}

async function request(runtimePort, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${runtimePort}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, json, text };
}
