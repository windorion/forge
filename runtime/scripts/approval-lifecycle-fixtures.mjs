#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-approval-lifecycle-${process.pid}-${Date.now()}`);
const repoRoot = join(tempRoot, "repo");
const databasePath = join(tempRoot, "forge.sqlite");
const port = 19600 + Math.floor(Math.random() * 300);
let runtime;
let stage = "setup";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await mkdir(join(repoRoot, "runtime"), { recursive: true });
  await writeFile(join(repoRoot, "README.md"), "# Approval lifecycle fixture\n", "utf8");
  runtime = await startRuntime();

  stage = "bounded approval";
  const lifecycleTask = await createTask("Approve, revoke, and reapprove a bounded command grant.");
  const approved = await post(`/tasks/${lifecycleTask.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    scope: "Task",
    durationSeconds: 900,
    note: "Fixture approval"
  });
  const firstApproval = approved.approvals.at(-1);
  assert(firstApproval.scope === "Task", "Approval did not persist its task scope.");
  assert(Date.parse(firstApproval.expiresAt) > Date.parse(firstApproval.decidedAt), "Approval did not persist a future expiry.");

  let permissions = await get(`/tasks/${lifecycleTask.id}/validation-permissions`);
  const approvedPermission = permissionFor(permissions, "smoke-task-commands");
  assert(approvedPermission.approvalState === "Approved", "Fresh approval was not active.");
  assert(approvedPermission.canRevoke === true, "Fresh approval was not revocable.");
  assert(approvedPermission.approval.expiresAt === firstApproval.expiresAt, "Permission envelope lost expiry evidence.");
  assert(permissions.approvalPolicy.defaultDurationSeconds === 3600, "Permission envelope lost lifecycle policy.");
  assert(
    permissions.approvalPolicy.scopes.map((scope) => `${scope.scope}:${scope.grantable}`).join(",") ===
      "Task:true,Repository:false,Session:false",
    "Permission envelope widened unsupported scopes."
  );

  stage = "revocation";
  const revoked = await post(`/tasks/${lifecycleTask.id}/revoke-validation-preset-approval`, {
    presetID: "smoke-task-commands",
    note: "Fixture revocation"
  });
  const revocation = revoked.approvals.at(-1);
  assert(revocation.decision === "Revoked", "Revocation did not append a Revoked audit record.");
  assert(revocation.revokedApprovalID === firstApproval.id, "Revocation did not link to the grant it invalidated.");
  assert(revoked.approvals.some((entry) => entry.id === firstApproval.id), "Revocation mutated or removed the original grant.");

  permissions = await get(`/tasks/${lifecycleTask.id}/validation-permissions`);
  const revokedPermission = permissionFor(permissions, "smoke-task-commands");
  assert(revokedPermission.approvalState === "Revoked", "Permission envelope did not expose revocation.");
  assert(revokedPermission.canApprove === true && revokedPermission.canRevoke === false, "Revoked grant did not require reapproval.");
  const revokedRun = await postExpectError(`/tasks/${lifecycleTask.id}/run-task-command`, {
    commandID: "smoke-long-task-command"
  });
  assert(revokedRun.status === 409, `Revoked command start returned ${revokedRun.status}, expected 409.`);
  assert((await taskByID(lifecycleTask.id)).taskCommandRuns.length === 0, "Revoked command created process evidence.");

  stage = "reapproval";
  const reapproved = await post(`/tasks/${lifecycleTask.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    durationSeconds: 3600
  });
  assert(reapproved.approvals.at(-1).action === "Approve Validation Preset", "Reapproval was not appended after revocation.");
  assert(permissionFor(await get(`/tasks/${lifecycleTask.id}/validation-permissions`), "smoke-task-commands").approvalState === "Approved", "Reapproval did not reactivate the preset.");

  stage = "invalid requests";
  const invalidTask = await createTask("Reject unsupported approval scope and duration.");
  const invalidDuration = await postExpectError(`/tasks/${invalidTask.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    durationSeconds: 901
  });
  assert(invalidDuration.status === 400, "Unsupported approval duration did not fail with 400.");
  const repositoryScope = await postExpectError(`/tasks/${invalidTask.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    scope: "Repository",
    durationSeconds: 900
  });
  assert(repositoryScope.status === 400, "Unsupported repository scope did not fail with 400.");

  stage = "active command revocation";
  const activeTask = await createTask("Revoke future starts without killing an active process.");
  await post(`/tasks/${activeTask.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    durationSeconds: 900
  });
  const activeRunPromise = post(`/tasks/${activeTask.id}/run-task-command`, {
    commandID: "smoke-long-task-command"
  });
  activeRunPromise.catch(() => undefined);
  await waitForTask(
    activeTask.id,
    (task) => task.taskCommandRuns.some((run) => run.commandID === "smoke-long-task-command" && run.status === "Running"),
    "long command to start"
  );
  await post(`/tasks/${activeTask.id}/revoke-validation-preset-approval`, {
    presetID: "smoke-task-commands",
    note: "Do not kill the process already authorized at spawn."
  });
  const activeEnvelope = await get(`/tasks/${activeTask.id}/validation-permissions`);
  const activePermission = permissionFor(activeEnvelope, "smoke-task-commands");
  assert(activePermission.approvalState === "Revoked", "Active command revocation was not visible immediately.");
  const afterRevocation = await taskByID(activeTask.id);
  const inFlightStatus = afterRevocation.taskCommandRuns.at(-1).status;
  if (inFlightStatus === "Running") {
    const commandPermission = activeEnvelope.taskCommands.find((candidate) => candidate.command.id === "smoke-long-task-command");
    assert(commandPermission?.executionState === "Running", "Permission envelope hid the still-running command.");
  } else {
    assert(inFlightStatus === "Passed", `Already-authorized command ended unexpectedly as ${inFlightStatus}.`);
  }
  const activeCompleted = await activeRunPromise;
  assert(activeCompleted.taskCommandRuns.at(-1).status === "Passed", "Revocation incorrectly killed the already-running process.");
  const secondStart = await postExpectError(`/tasks/${activeTask.id}/run-task-command`, {
    commandID: "smoke-long-task-command"
  });
  assert(secondStart.status === 409, "Revocation did not block the next process start.");

  stage = "restart expiry preparation";
  const restartTask = await createTask("Do not revive an expired approval after restart.");
  await post(`/tasks/${restartTask.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    durationSeconds: 900
  });
  stage = "stopping runtime for restart";
  await stopRuntime(runtime);
  runtime = undefined;
  expirePersistedApproval(restartTask.id);
  runtime = await startRuntime();
  stage = "restart expiry assertions";

  const restartedPermission = permissionFor(await get(`/tasks/${restartTask.id}/validation-permissions`), "smoke-task-commands");
  assert(restartedPermission.approvalState === "Expired", "Restart revived an expired persisted approval.");
  assert(restartedPermission.canApprove === true && restartedPermission.canRun === false, "Expired permission envelope was not fail-closed.");
  const expiredRun = await postExpectError(`/tasks/${restartTask.id}/run-task-command`, {
    commandID: "smoke-long-task-command"
  });
  assert(expiredRun.status === 409, "Expired approval started a command after restart.");
  assert((await taskByID(restartTask.id)).taskCommandRuns.length === 0, "Expired approval created a task command run after restart.");

  console.log("Approval lifecycle fixtures passed.");
  console.log("- Bounded task grant + permission policy envelope");
  console.log("- Append-only revocation + explicit reapproval");
  console.log("- Unsupported duration/repository scope fail closed");
  console.log("- Active process continues while all future starts are blocked");
  console.log("- Persisted expiry remains invalid after runtime restart");
} catch (error) {
  console.error(`Approval lifecycle fixture failed during: ${stage}`);
  if (runtime?.output) {
    console.error("Runtime output before fixture failure:\n" + runtime.output);
  }
  throw error;
} finally {
  await stopRuntime(runtime);
  await rm(tempRoot, { recursive: true, force: true });
}

function permissionFor(envelope, presetID) {
  const permission = envelope.permissions.find((candidate) => candidate.preset.id === presetID);
  assert(permission, `Permission not found for preset ${presetID}.`);
  return permission;
}

function expirePersistedApproval(taskID) {
  const database = new DatabaseSync(databasePath);
  try {
    const row = database.prepare("SELECT payload_json FROM tasks WHERE id = ?").get(taskID);
    assert(row?.payload_json, "Restart fixture task was not persisted.");
    const task = JSON.parse(row.payload_json);
    const approval = [...task.approvals].reverse().find((entry) => entry.action === "Approve Validation Preset");
    assert(approval, "Restart fixture approval was not persisted.");
    approval.expiresAt = "2000-01-01T00:00:00.000Z";
    task.updatedAt = new Date().toISOString();
    database.prepare("UPDATE tasks SET payload_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(task), task.updatedAt, taskID);
  } finally {
    database.close();
  }
}

async function createTask(objective) {
  return post("/tasks", { title: "Approval lifecycle", objective });
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

async function startRuntime() {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_REPO_ROOT: repoRoot,
      FORGE_RUNTIME_DB_PATH: databasePath,
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: join(tempRoot, "model-provider.json"),
      FORGE_MODEL_PROVIDER: "local",
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
