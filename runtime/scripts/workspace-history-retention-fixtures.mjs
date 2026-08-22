#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { SqliteTaskStore } from "../dist/taskStore.js";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-workspace-retention-${process.pid}-${Date.now()}`);
const repoRoot = join(tempRoot, "repo");
const databasePath = join(tempRoot, "forge.sqlite");
const port = 20250 + Math.floor(Math.random() * 250);
const token = ["ghp", "workspacefixture1234567890abcd"].join("_");
const scopes = ["TaskEvents", "ToolCalls", "TaskMessages", "RepositoryIndexes"];
let runtime;
let stage = "setup";

try {
  await mkdir(join(repoRoot, "src"), { recursive: true });
  await writeFile(join(repoRoot, "src", "fixture.ts"), "export function fixture() { return true; }\n", "utf8");
  seedDatabase();
  runtime = await startRuntime("primary");

  stage = "preview";
  const preview = await get("/workspace/history-retention-preview", port);
  assert(preview.policy.id === "forge-workspace-retention", "Preview omitted the policy identity.");
  assert(preview.policy.version === 1, "Preview omitted policy v1.");
  assert(preview.policy.automaticPurge === false, "Workspace policy must never schedule automatic purge.");
  assert(preview.eligible, "Seeded workspace should be eligible for explicit purge.");
  assert(preview.preservedNonterminalRecords === 3, "Preview did not preserve unfinished-task evidence.");
  assert(preview.scopePreviews.find((item) => item.scope === "RepositoryIndexes")?.removableRecords > 0, "Index scope was not measured.");

  stage = "initial export";
  const initialExport = await get(`/workspace/history-export?scopes=${scopes.join(",")}`, port);
  assert(initialExport.contentSha256.length === 64 && initialExport.sourceSha256.length === 64, "Export omitted SHA-256 receipts.");
  assert(!initialExport.content.includes(token), "Workspace export leaked a known credential from a task message.");
  assert(initialExport.content.includes("[REDACTED]"), "Workspace export omitted redaction evidence.");
  assert(initialExport.content.includes("unfinished evidence remains"), "Workspace export omitted nonterminal evidence.");
  assert(initialExport.content.includes("ManifestWithRebuildableTrigramDigest"), "Workspace export omitted the rebuildable-index boundary.");

  stage = "confirmation guard";
  const refused = await post("/workspace/purge-history", {
    confirmation: "yes",
    policyVersion: 1,
    scopes,
    exportReceipt: receipt(initialExport)
  }, port);
  assert(refused.status === 400, `Wrong confirmation returned ${refused.status}, expected 400.`);

  stage = "stale receipt guard";
  const cancelled = await post("/tasks/stale-control/cancel", { note: "Advance the workspace source revision." }, port);
  assert(cancelled.status === 200 && cancelled.json.status === "Cancelled", "Stale-control task did not cancel.");
  const stale = await post("/workspace/purge-history", {
    confirmation: "PurgeWorkspaceHistory",
    policyVersion: 1,
    scopes,
    exportReceipt: receipt(initialExport)
  }, port);
  assert(stale.status === 409, `Stale export returned ${stale.status}, expected 409.`);

  stage = "verified purge";
  const currentExport = await get(`/workspace/history-export?scopes=${scopes.join(",")}`, port);
  const purged = await post("/workspace/purge-history", {
    confirmation: "PurgeWorkspaceHistory",
    policyVersion: 1,
    scopes,
    exportReceipt: receipt(currentExport)
  }, port);
  assert(purged.status === 200, `Verified workspace purge returned ${purged.status}: ${purged.text}`);
  assert(purged.json.receipt.policyVersion === 1, "Purge receipt omitted policy version.");
  assert(purged.json.receipt.taskRecordsAffected > 0, "Purge receipt omitted task records.");
  assert(purged.json.receipt.indexRecordsAffected > 0, "Purge receipt omitted index records.");
  assert(purged.json.receipt.preservedNonterminalRecords === 3, "Purge receipt omitted preserved unfinished evidence.");
  assert(purged.json.repositoryIndexesCleared === true, "Purge did not report index removal.");

  const tasks = await get("/tasks", port);
  const terminal = tasks.tasks.find((task) => task.id === "terminal");
  const active = tasks.tasks.find((task) => task.id === "active");
  assert(terminal.events.length === 0 && terminal.toolCalls.length === 0 && terminal.messages.length === 0, "Terminal task evidence survived selected purge scopes.");
  assert(active.events.length === 1 && active.toolCalls.length === 1 && active.messages.length === 1, "Unfinished task evidence was destructively purged.");
  assert(active.messages[0].content === "unfinished evidence remains", "Unfinished message content changed.");
  const index = await get("/index", port);
  assert(index.fileCount === 0 && index.symbolCount === 0 && index.inSync === false, "Repository index was not reset to a rebuild-required state.");

  stage = "SQLite atomic evidence";
  await stopRuntime(runtime);
  runtime = undefined;
  inspectSQLite();

  stage = "restart";
  runtime = await startRuntime("primary");
  const restartedPreview = await get("/workspace/history-retention-preview", port);
  assert(restartedPreview.eligible === false, "Purged workspace evidence revived after restart.");
  assert(restartedPreview.priorPurges === 1, "Workspace purge receipt did not survive restart.");
  await stopRuntime(runtime);
  runtime = undefined;

  stage = "observer boundary";
  runtime = await startRuntime("observer");
  const observerPreview = await get("/workspace/history-retention-preview", port);
  assert(observerPreview.policy.version === 1, "Observer could not read workspace retention policy.");
  const observerExport = await get("/workspace/history-export?scopes=TaskMessages", port);
  assert(observerExport.content.includes("unfinished evidence remains"), "Observer read-only export lost retained unfinished evidence.");
  const observerPost = await post("/workspace/purge-history", {
    confirmation: "PurgeWorkspaceHistory",
    policyVersion: 1,
    scopes: ["TaskMessages"],
    exportReceipt: receipt(observerExport)
  }, port);
  assert(observerPost.status === 403, `Observer mutation returned ${observerPost.status}, expected 403.`);

  console.log("Workspace history retention fixtures passed.");
  console.log("- Versioned keep-by-default policy and four explicit scopes");
  console.log("- Deterministic redacted export plus confirmation/stale-receipt guards");
  console.log("- Terminal-only task purge, unfinished-task preservation, rebuildable index reset");
  console.log("- Atomic schema-v6 receipt, restart durability, and observer read-only boundary");
} catch (error) {
  console.error(`Workspace history retention fixture failed during: ${stage}`);
  if (runtime?.output) console.error(`Runtime output before failure:\n${runtime.output}`);
  throw error;
} finally {
  await stopRuntime(runtime);
  await rm(tempRoot, { recursive: true, force: true });
}

function seedDatabase() {
  const store = new SqliteTaskStore(databasePath);
  store.saveTask(task("terminal", "Completed", {
    events: [event("task.completed", "terminal event")],
    toolCalls: [toolCall("terminal-tool")],
    messages: [message(`access_token=${token}`)]
  }));
  store.saveTask(task("active", "Human Review", {
    events: [event("task.review", "unfinished event")],
    toolCalls: [toolCall("active-tool")],
    messages: [message("unfinished evidence remains")]
  }));
  store.saveTask(task("stale-control", "Created", {}));
  const indexedAt = "2026-08-22T09:00:00.000Z";
  store.upsertIndexedFile({
    path: "src/fixture.ts", language: "TypeScript", byteSize: 43, lineCount: 2,
    contentHash: "f".repeat(32), indexedAt
  });
  store.replaceSymbolsForFile("src/fixture.ts", [{ kind: "function", name: "fixture", line: 1 }]);
  store.replaceTrigramsForFile("src/fixture.ts", ["exp", "xpo", "por"]);
  store.setIndexMeta({ lastIndexedAt: indexedAt, gitRoot: repoRoot });
  store.close();
}

function inspectSQLite() {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert(Number(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version) === 6, "Database did not reach schema v6.");
    assert(Number(database.prepare("SELECT COUNT(*) AS count FROM workspace_history_purges").get().count) === 1, "Atomic workspace purge receipt missing.");
    assert(Number(database.prepare("SELECT COUNT(*) AS count FROM repo_index").get().count) === 0, "repo_index rows survived purge.");
    assert(Number(database.prepare("SELECT COUNT(*) AS count FROM repo_symbols").get().count) === 0, "repo_symbols rows survived purge.");
    assert(Number(database.prepare("SELECT COUNT(*) AS count FROM repo_trigrams").get().count) === 0, "repo_trigrams rows survived purge.");
    const terminalPayload = String(database.prepare("SELECT payload_json FROM tasks WHERE id = 'terminal'").get().payload_json);
    const activePayload = String(database.prepare("SELECT payload_json FROM tasks WHERE id = 'active'").get().payload_json);
    assert(!terminalPayload.includes(token), "Purged terminal message survived in raw SQLite.");
    assert(activePayload.includes("unfinished evidence remains"), "Unfinished evidence was removed from raw SQLite.");
  } finally {
    database.close();
  }
}

function receipt(envelope) {
  return {
    generatedAt: envelope.generatedAt,
    policyID: envelope.policyID,
    policyVersion: envelope.policyVersion,
    scopes: envelope.scopes,
    sourceSha256: envelope.sourceSha256,
    contentSha256: envelope.contentSha256
  };
}

function task(id, status, overrides) {
  return {
    id, title: `${id} task`, objective: `${id} objective`, status, currentPhase: "Review",
    createdAt: "2026-08-22T08:00:00.000Z", updatedAt: "2026-08-22T08:30:00.000Z",
    agentStates: [], planSteps: [], events: [], approvals: [], toolCalls: [], agentRunLoops: [],
    agentRunSteps: [], taskCommandRuns: [], historyPurges: [], commandRerunEvidence: [],
    validationRuns: [], validationRepairBriefs: [], messages: [], planRevisions: [],
    editProposalRevisions: [], contextFiles: [], changedFiles: [], ...overrides
  };
}

function event(type, messageText) {
  return { type, message: messageText, createdAt: "2026-08-22T08:20:00.000Z" };
}

function toolCall(name) {
  return {
    id: name, name, status: "Completed", input: `${name} input`, outputSummary: `${name} output`,
    startedAt: "2026-08-22T08:10:00.000Z", endedAt: "2026-08-22T08:10:01.000Z"
  };
}

function message(content) {
  return {
    id: content, role: "User", kind: "UserMessage", content,
    createdAt: "2026-08-22T08:05:00.000Z", fileReferences: []
  };
}

async function startRuntime(mode) {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_REPO_ROOT: repoRoot,
      FORGE_RUNTIME_DB_PATH: databasePath,
      FORGE_MODEL_PROVIDER: "local",
      FORGE_RUNTIME_MODE: mode,
      FORGE_STUCK_SWEEP_INTERVAL_MS: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { child.output += chunk.toString("utf8"); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const health = await get("/health", port);
      if (health.ok && health.runtimeMode === mode) return child;
    } catch {
      // Runtime is still starting.
    }
    await sleep(100);
  }
  await stopRuntime(child);
  throw new Error(`Runtime did not become healthy in ${mode} mode.\n${child.output}`);
}

async function stopRuntime(child) {
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await sleep(100);
  }
  child.kill("SIGKILL");
}

async function get(path, targetPort) {
  const response = await fetch(`http://127.0.0.1:${targetPort}${path}`, { headers: { connection: "close" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function post(path, body, targetPort) {
  const response = await fetch(`http://127.0.0.1:${targetPort}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, text, json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
