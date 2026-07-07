#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(runtimeRoot, "..");
const smokeID = `forge-core-smoke-${process.pid}-${Date.now()}`;
const tempRoot = join(tmpdir(), smokeID);
const dbPath = join(tempRoot, "forge.sqlite");
const settingsPath = join(tempRoot, "model-provider-settings.json");
const port = 17400 + Math.floor(Math.random() * 1000);
const baseURL = `http://127.0.0.1:${port}`;
const appendSmokePath = `docs/${smokeID}-append.md`;
const replaceSmokePath = `docs/${smokeID}-replace.md`;

const smokeFiles = [
  {
    relativePath: appendSmokePath,
    initialContent: "# Forge Append Smoke\n\nInitial append smoke fixture.\n"
  },
  {
    relativePath: replaceSmokePath,
    initialContent: "# Forge Replace Smoke\n\nSMOKE_OLD\n"
  }
];

let runtime;

try {
  await mkdir(tempRoot, { recursive: true });
  await createSmokeFiles();

  runtime = await startRuntime();
  const appendTask = await runAppendFlow();

  await stopRuntime(runtime);
  runtime = await startRuntime();
  await assertRestartRecovery(appendTask.id, appendSmokePath);

  const replaceTask = await runReplaceFlow();

  console.log("Core runtime smoke passed.");
  console.log(`- Runtime: ${baseURL}`);
  console.log(`- Append task: ${appendTask.id}`);
  console.log(`- Replace task: ${replaceTask.id}`);
  console.log(`- Temporary database: ${dbPath}`);
} finally {
  await stopRuntime(runtime);
  await cleanupSmokeFiles();
  await rm(tempRoot, { recursive: true, force: true });
}

async function runAppendFlow() {
  const task = await createTask({
    title: "Smoke append lifecycle",
    objective: `Run an append lifecycle smoke against @${appendSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "append task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/messages`, {
    content: `Use @${appendSmokePath} for this smoke proposal. Add a small append-only note.`
  });
  assertResolvedReference(current, appendSmokePath);

  current = await post(`/tasks/${task.id}/generate-plan-revision`, {});
  assertState(current, "Human Review", "Plan Review");

  current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the append plan."
  });
  assert(current.executionProposal, "Append flow did not create an execution proposal.");

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assertProposal(current, appendSmokePath, "AppendText");

  current = await post(`/tasks/${task.id}/validate-edit-proposal`, {});
  assertProposal(current, appendSmokePath, "AppendText");

  const appendPath = join(repoRoot, appendSmokePath);
  const before = await readFile(appendPath, "utf8");

  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the append proposal."
  });
  assertCompletedTask(current, appendSmokePath);

  const after = await readFile(appendPath, "utf8");
  assert(after.startsWith(before), "Append smoke did not preserve the original file prefix.");
  assert(after.includes("## Forge Implementation Note"), "Append smoke did not add the implementation note.");

  return current;
}

async function runReplaceFlow() {
  const task = await createTask({
    title: "Smoke replace lifecycle",
    objective: `Run an exact replace lifecycle smoke against @${replaceSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "replace task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/messages`, {
    content: `Use @${replaceSmokePath} and replace "SMOKE_OLD" with "SMOKE_NEW".`
  });
  assertResolvedReference(current, replaceSmokePath);

  current = await post(`/tasks/${task.id}/generate-plan-revision`, {});
  assertState(current, "Human Review", "Plan Review");

  current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the replace plan."
  });
  assert(current.executionProposal, "Replace flow did not create an execution proposal.");

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assertProposal(current, replaceSmokePath, "ReplaceText");

  current = await post(`/tasks/${task.id}/validate-edit-proposal`, {});
  assertProposal(current, replaceSmokePath, "ReplaceText");

  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the replace proposal."
  });
  assertCompletedTask(current, replaceSmokePath);

  const after = await readFile(join(repoRoot, replaceSmokePath), "utf8");
  assert(after.includes("SMOKE_NEW"), "Replace smoke did not write the replacement text.");
  assert(!after.includes("SMOKE_OLD"), "Replace smoke left the original find text behind.");

  return current;
}

async function assertRestartRecovery(taskID, expectedChangedFile) {
  const recovered = await waitForTask(
    taskID,
    (candidate) => candidate.status === "Completed" && candidate.changedFiles?.includes(expectedChangedFile),
    "completed append task to reload after runtime restart"
  );

  assertCompletedTask(recovered, expectedChangedFile);
}

async function createTask(body) {
  const task = await post("/tasks", body);
  assert(task.id, "Create task response did not include an id.");
  return task;
}

async function createSmokeFiles() {
  for (const file of smokeFiles) {
    const absolutePath = join(repoRoot, file.relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.initialContent, "utf8");
  }
}

async function cleanupSmokeFiles() {
  for (const file of smokeFiles) {
    await rm(join(repoRoot, file.relativePath), { force: true });
  }
}

async function startRuntime() {
  const child = spawn("node", ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    shell: false,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_RUNTIME_DB_PATH: dbPath,
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: settingsPath,
      FORGE_MODEL_PROVIDER: "local",
      FORGE_MODEL_NAME: "local-deterministic-smoke"
    }
  });

  let output = "";
  let exited = false;
  let exitInfo = "process has not exited";
  const appendOutput = (chunk) => {
    output += chunk.toString("utf8");
    if (output.length > 12_000) {
      output = output.slice(output.length - 12_000);
    }
  };

  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  child.on("error", (error) => {
    exited = true;
    exitInfo = `spawn error: ${error.message}`;
  });

  const closed = new Promise((resolveClosed) => {
    child.on("exit", (code, signal) => {
      exited = true;
      exitInfo = `exit code ${code ?? "null"}, signal ${signal ?? "null"}`;
      resolveClosed({ code, signal });
    });
  });

  const handle = {
    child,
    closed,
    get output() {
      return output;
    },
    get exited() {
      return exited;
    },
    get exitInfo() {
      return exitInfo;
    }
  };

  await waitForHealth(handle);
  return handle;
}

async function stopRuntime(handle) {
  if (!handle || handle.exited) {
    return;
  }

  handle.child.kill("SIGTERM");
  const closed = await Promise.race([
    handle.closed.then(() => true),
    sleep(2500).then(() => false)
  ]);

  if (!closed && !handle.exited) {
    handle.child.kill("SIGKILL");
    await handle.closed;
  }
}

async function waitForHealth(handle) {
  const deadline = Date.now() + 10_000;
  let lastError = "";

  while (Date.now() < deadline) {
    if (handle.exited) {
      throw new Error(`Runtime exited before health check succeeded: ${handle.exitInfo}\n${handle.output}`);
    }

    try {
      const health = await get("/health");
      if (health.ok === true && health.persistence?.databasePath === dbPath) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting for runtime health: ${lastError}\n${handle.output}`);
}

async function waitForTask(taskID, predicate, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastTask;

  while (Date.now() < deadline) {
    const response = await get("/tasks");
    lastTask = response.tasks?.find((task) => task.id === taskID);
    if (lastTask && predicate(lastTask)) {
      return lastTask;
    }

    await sleep(150);
  }

  throw new Error(`Timed out waiting for ${label}.\nLast task: ${JSON.stringify(summarizeTask(lastTask), null, 2)}`);
}

async function get(path) {
  return request("GET", path);
}

async function post(path, body) {
  return request("POST", path, body);
}

async function request(method, path, body) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 1200)}`);
  }

  return parsed;
}

function assertProposal(task, expectedPath, expectedOperation) {
  assertState(task, "Human Review", "Edit Proposal Review");
  assert(task.editProposal?.status === "Proposed", "Task does not have a proposed edit proposal.");
  assert(task.editProposal.validation?.status === "Ready", task.editProposal.validation?.summary ?? "Proposal validation is not ready.");

  const changes = task.editProposal.fileChanges ?? [];
  assert(changes.length === 1, `Expected exactly one file change, got ${changes.length}.`);

  const change = changes[0];
  assert(change.path === expectedPath, `Expected proposal path ${expectedPath}, got ${change.path}.`);
  assert(
    change.applyOperation?.kind === expectedOperation,
    `Expected ${expectedOperation}, got ${change.applyOperation?.kind ?? "missing operation"}.`
  );
  assert(
    task.editProposal.validation.fileResults?.every((result) => result.status === "Ready"),
    "Expected every proposal file validation result to be Ready."
  );
}

function assertCompletedTask(task, expectedChangedFile) {
  assertState(task, "Completed", "Validation Passed");
  assert(task.changedFiles?.includes(expectedChangedFile), `Changed files did not include ${expectedChangedFile}.`);
  assert(task.editProposal?.status === "Applied", "Completed task does not have an applied edit proposal.");
  assert(
    task.validationRuns?.some((run) => run.presetID === "forge-post-apply" && run.status === "Passed"),
    "Completed task does not include a passed forge-post-apply validation run."
  );
}

function assertResolvedReference(task, expectedPath) {
  const references = (task.messages ?? []).flatMap((message) => message.fileReferences ?? []);
  assert(
    references.some((reference) => reference.path === expectedPath && reference.status === "Resolved"),
    `Task did not resolve expected file reference ${expectedPath}.`
  );
}

function assertState(task, status, phase) {
  assert(task.status === status, `Expected task status ${status}, got ${task.status}.`);
  assert(task.currentPhase === phase, `Expected task phase ${phase}, got ${task.currentPhase}.`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function summarizeTask(task) {
  if (!task) {
    return undefined;
  }

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    currentPhase: task.currentPhase,
    reviewSummary: task.reviewSummary,
    changedFiles: task.changedFiles,
    editProposal: task.editProposal
      ? {
          status: task.editProposal.status,
          summary: task.editProposal.summary,
          validation: task.editProposal.validation?.summary,
          changes: task.editProposal.fileChanges?.map((change) => ({
            path: change.path,
            operation: change.applyOperation?.kind
          }))
        }
      : undefined,
    latestEvents: task.events?.slice(-6)
  };
}
