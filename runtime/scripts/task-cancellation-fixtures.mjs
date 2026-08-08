#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-task-cancel-${process.pid}-${Date.now()}`);
const repoRoot = join(tempRoot, "repo");
const port = 19200 + Math.floor(Math.random() * 400);
let runtime;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await mkdir(join(repoRoot, "runtime"), { recursive: true });
  await writeFile(join(repoRoot, "README.md"), "# Cancellation fixture\n", "utf8");
  runtime = await startRuntime();

  const idle = await createPlanReadyTask("idle", "Prepare an idle task cancellation fixture.");
  const idleCancelled = await post(`/tasks/${idle.id}/cancel`, { note: "Cancel before execution." });
  assertCancellationCompleted(idleCancelled, "idle task");
  assert(idleCancelled.cancellation.queueDisposition === "NotQueued", "Idle cancellation reported a queue removal.");
  const idempotent = await post(`/tasks/${idle.id}/cancel`, { note: "Duplicate request." });
  assert(idempotent.cancellation.id === idleCancelled.cancellation.id, "Duplicate cancellation created new evidence.");
  const immutable = await postExpectError(`/tasks/${idle.id}/messages`, { content: "Should be blocked." });
  assert(immutable.status === 409 && immutable.text.includes("immutable"), "Cancelled task accepted a mutation.");
  const markdownAudit = await get(`/tasks/${idle.id}/audit-export?format=markdown`);
  assert(markdownAudit.filename.endsWith(".md"), "Markdown audit export has the wrong filename.");
  assert(markdownAudit.content.includes("## Cancellation"), "Markdown audit omitted cancellation evidence.");
  const jsonAudit = await get(`/tasks/${idle.id}/audit-export?format=json`);
  const parsedAudit = JSON.parse(jsonAudit.content);
  assert(parsedAudit.task.status === "Cancelled", "JSON audit omitted the task terminal state.");
  assert(parsedAudit.approvals.some((approval) => approval.action === "Cancel Task"), "JSON audit omitted cancellation approval.");

  const commandTask = await createPlanReadyTask("command", "Start then cancel an approved long task command.");
  await post(`/tasks/${commandTask.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    note: "Approve the test-only long command."
  });
  const commandPromise = post(`/tasks/${commandTask.id}/run-task-command`, {
    commandID: "smoke-long-task-command"
  });
  await waitForTask(
    commandTask.id,
    (task) => task.taskCommandRuns.some((run) => run.status === "Running"),
    "task command to start"
  );
  const commandRequested = await post(`/tasks/${commandTask.id}/cancel`, { note: "Stop the command and task." });
  assert(commandRequested.cancellation.taskCommandDisposition === "CancelRequested", "Task cancellation did not target the command.");
  const commandCancelled = await waitForTask(
    commandTask.id,
    (task) => task.status === "Cancelled",
    "task command cancellation to settle"
  );
  await commandPromise;
  assertCancellationCompleted(commandCancelled, "command task");
  assert(commandCancelled.taskCommandRuns.at(-1).status === "Cancelled", "Active task command did not become Cancelled.");
  assert(commandCancelled.taskCommandRuns.at(-1).exitCode === 130, "Cancelled task command lost exit code 130 evidence.");

  const activeLoopTask = await createPlanReadyTask("active-loop", "Occupy the serialized Agent Loop slot.");
  const queuedTask = await createPlanReadyTask("queued", "Queue behind another task, then cancel before execution.");
  const activeLoopPromise = post(`/tasks/${activeLoopTask.id}/approve-plan-and-run`, {
    note: "Start the active cancellation fixture.",
    maxSteps: 1
  });
  await waitForQueue(
    (queue) => queue.running.some((entry) => entry.taskID === activeLoopTask.id),
    "Agent Loop to occupy the repository slot"
  );
  const queued = await post(`/tasks/${queuedTask.id}/approve-plan-and-run`, {
    note: "Queue the cancellation fixture.",
    maxSteps: 1
  });
  assert(queued.queueRequest, "Second Agent Loop was not queued.");
  const queuedCancelled = await post(`/tasks/${queuedTask.id}/cancel`, { note: "Remove this queued task." });
  assertCancellationCompleted(queuedCancelled, "queued task");
  assert(queuedCancelled.cancellation.queueDisposition === "Removed", "Queued cancellation did not record removal.");
  assert(!queuedCancelled.queueRequest, "Cancelled queued task retained its queue request.");

  const loopRequested = await post(`/tasks/${activeLoopTask.id}/cancel`, { note: "Abort at the next safe checkpoint." });
  assert(loopRequested.cancellation.agentLoopDisposition === "AbortRequested", "Active loop cancellation did not request abort.");
  const loopCancelled = await waitForTask(
    activeLoopTask.id,
    (task) => task.status === "Cancelled",
    "Agent Loop cancellation to settle"
  );
  await activeLoopPromise;
  assertCancellationCompleted(loopCancelled, "Agent Loop task");
  assert(loopCancelled.agentRunLoops.at(-1).status === "Aborted", "Active Agent Loop did not stop as Aborted.");
  assert(loopCancelled.agentRunLoops.at(-1).stopReason === "UserAborted", "Agent Loop lost its user-abort stop reason.");

  const validationTask = await createAppliedTask();
  await post(`/tasks/${validationTask.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    note: "Approve the validation cancellation fixture."
  });
  const validationPromise = post(`/tasks/${validationTask.id}/run-validation`, {
    presetID: "smoke-task-commands"
  });
  await waitForTask(
    validationTask.id,
    (task) => task.validationRuns.some((run) => run.status === "Running"),
    "validation command to start"
  );
  const validationRequested = await post(`/tasks/${validationTask.id}/cancel`, { note: "Stop validation and skip remaining work." });
  assert(validationRequested.cancellation.validationDisposition === "CancelRequested", "Task cancellation did not target validation.");
  const validationCancelled = await waitForTask(
    validationTask.id,
    (task) => task.status === "Cancelled",
    "validation cancellation to settle"
  );
  await validationPromise;
  assertCancellationCompleted(validationCancelled, "validation task");
  assert(validationCancelled.validationRuns.at(-1).status === "Cancelled", "Validation run did not become Cancelled.");
  assert(validationCancelled.validationRuns.at(-1).commands.at(-1).status === "Cancelled", "Validation command did not become Cancelled.");

  const restartTask = await createPlanReadyTask("restart", "Recover a persisted cancellation request after runtime restart.");
  await stopRuntime(runtime);
  runtime = undefined;
  persistInterruptedCancellation(restartTask.id);
  runtime = await startRuntime();
  const restartCancelled = await waitForTask(
    restartTask.id,
    (task) => task.status === "Cancelled",
    "persisted task cancellation to recover after restart"
  );
  assertCancellationCompleted(restartCancelled, "restart-recovered task");
  assert(restartCancelled.agentRunLoops.at(-1).stopReason === "RuntimeRestarted", "Restart recovery lost the loop checkpoint evidence.");
  assert(restartCancelled.agentRunSteps.at(-1).status === "Failed", "Restart recovery did not finalize the running step.");
  assert(restartCancelled.toolCalls.at(-1).status === "Failed", "Restart recovery did not finalize the running tool call.");

  const readme = await readFile(join(repoRoot, "README.md"), "utf8");
  assert(readme.includes("Forge Implementation Note"), "Applied validation fixture lost its reviewed edit.");
  console.log("Task cancellation fixtures passed.");
  console.log("- Idle + idempotent cancellation and cancelled-task immutability");
  console.log("- Queued removal + active Agent Loop safe-checkpoint abort");
  console.log("- SIGTERM task-command cancellation with exit evidence");
  console.log("- Validation process cancellation with remaining-command stop boundary");
  console.log("- Persisted cancellation request completed safely after runtime restart");
  console.log("- Read-only Markdown + JSON audit exports preserve cancellation evidence");
} finally {
  await stopRuntime(runtime);
  await rm(tempRoot, { recursive: true, force: true });
}

function persistInterruptedCancellation(taskID) {
  const database = new DatabaseSync(join(tempRoot, "forge.sqlite"));
  try {
    const row = database.prepare("SELECT payload_json FROM tasks WHERE id = ?").get(taskID);
    assert(row?.payload_json, "Restart cancellation fixture task was not persisted.");
    const task = JSON.parse(row.payload_json);
    const requestedAt = new Date().toISOString();
    const loopID = `cancel-restart-loop-${taskID}`;
    const stepID = `cancel-restart-step-${taskID}`;
    task.cancellation = {
      id: `cancel-restart-${taskID}`,
      status: "Requested",
      requestedAt,
      note: "Persisted restart fixture.",
      queueDisposition: "NotQueued",
      agentLoopDisposition: "AbortRequested",
      taskCommandDisposition: "NotRunning",
      validationDisposition: "NotRunning",
      summary: "Task cancellation requested before runtime restart."
    };
    task.agentRunLoops.push({
      id: loopID,
      provider: { id: "local", name: "Local Deterministic", model: "local-deterministic-v0", mode: "local" },
      status: "Running",
      maxSteps: 1,
      stepsRun: 1,
      stepIDs: [stepID],
      controlState: "AbortRequested",
      controlRequestedAt: requestedAt,
      summary: "Persisted cancellation fixture loop.",
      startedAt: requestedAt
    });
    task.agentRunSteps.push({
      id: stepID,
      provider: { id: "local", name: "Local Deterministic", model: "local-deterministic-v0", mode: "local" },
      loopID,
      action: "InspectRepository",
      status: "Running",
      summary: "Persisted cancellation fixture step.",
      rationale: "Verify restart recovery ordering.",
      createdAt: requestedAt
    });
    task.toolCalls.push({
      id: `cancel-restart-tool-${taskID}`,
      name: "search_repo_context",
      status: "Started",
      input: "restart cancellation fixture",
      outputSummary: "Running",
      startedAt: requestedAt
    });
    task.approvals.push({
      id: `cancel-restart-approval-${taskID}`,
      action: "Cancel Task",
      decision: "Approved",
      summary: "Persisted cancellation fixture.",
      decidedAt: requestedAt,
      targetID: task.cancellation.id
    });
    task.events.push({ type: "task.cancel.requested", message: task.cancellation.summary, createdAt: requestedAt });
    task.status = "Running";
    task.currentPhase = "Task Cancellation Requested";
    task.updatedAt = requestedAt;
    database.prepare("UPDATE tasks SET status = ?, current_phase = ?, updated_at = ?, payload_json = ? WHERE id = ?")
      .run(task.status, task.currentPhase, task.updatedAt, JSON.stringify(task), taskID);
  } finally {
    database.close();
  }
}

async function createPlanReadyTask(suffix, objective) {
  let task = await post("/tasks", { title: `Cancellation ${suffix}`, objective });
  task = await waitForTask(task.id, (candidate) => candidate.status === "Human Review", `${suffix} task to need review`);
  if (task.currentPhase === "Clarification") {
    task = await post(`/tasks/${task.id}/messages`, {
      content: "Done means this bounded cancellation fixture reaches its explicit runtime checkpoint. Use README.md as context."
    });
  }
  return waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review" && candidate.planRevisions.length > 0,
    `${suffix} task to reach Plan Review`
  );
}

async function createAppliedTask() {
  let task = await createPlanReadyTask(
    "validation",
    "Append a small implementation note to @README.md so manual validation can be cancelled."
  );
  task = await post(`/tasks/${task.id}/messages`, {
    content: "Use @README.md for this fixture and add a small append-only note."
  });
  task = await post(`/tasks/${task.id}/generate-plan-revision`, {});
  task = await post(`/tasks/${task.id}/approve-plan`, { note: "Approve the fixture edit plan." });
  task = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  task = await post(`/tasks/${task.id}/validate-edit-proposal`, {});
  for (const change of task.editProposal.fileChanges) {
    task = await post(`/tasks/${task.id}/review-edit-proposal-file`, {
      fileChangeID: change.id,
      decision: "Approved",
      note: "Approve the fixture file."
    });
  }
  task = await post(`/tasks/${task.id}/apply-edit-proposal`, { note: "Apply the fixture before validation." });
  assert(task.status === "Completed" && task.editProposal?.status === "Applied", "Validation fixture edit did not apply.");
  return task;
}

function assertCancellationCompleted(task, label) {
  assert(task.status === "Cancelled", `${label} did not reach Cancelled: ${task.status}.`);
  assert(task.currentPhase === "Task Cancelled", `${label} has wrong phase: ${task.currentPhase}.`);
  assert(task.cancellation?.status === "Completed", `${label} has no completed cancellation evidence.`);
  assert(task.cancellation.completedAt, `${label} cancellation has no completion timestamp.`);
  assert(task.approvals.some((approval) => approval.action === "Cancel Task"), `${label} has no cancellation approval.`);
  assert(task.events.some((event) => event.type === "task.cancel.requested"), `${label} has no request event.`);
  assert(task.events.some((event) => event.type === "task.cancelled"), `${label} has no completion event.`);
}

async function startRuntime() {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_REPO_ROOT: repoRoot,
      FORGE_RUNTIME_DB_PATH: join(tempRoot, "forge.sqlite"),
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: join(tempRoot, "model-provider.json"),
      FORGE_TASK_QUEUE_SETTINGS_PATH: join(tempRoot, "task-queue.json"),
      FORGE_MODEL_PROVIDER: "local",
      FORGE_ENABLE_SMOKE_COMMANDS: "1",
      FORGE_QUEUE_SMOKE_DELAY_MS: "1200",
      FORGE_STUCK_SWEEP_INTERVAL_MS: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { child.output += chunk.toString("utf8"); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const health = await get("/health");
      if (health.ok && health.workspace?.repoRoot === repoRoot) return child;
    } catch {
      // Continue until the runtime is listening.
    }
    await sleep(100);
  }
  await stopRuntime(child);
  throw new Error(`Runtime did not become healthy.\n${child.output}`);
}

async function stopRuntime(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await sleep(100);
  }
  child.kill("SIGKILL");
}

async function waitForTask(taskID, predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastTask;
  while (Date.now() < deadline) {
    lastTask = (await get("/tasks")).tasks.find((task) => task.id === taskID);
    if (lastTask && predicate(lastTask)) return lastTask;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}. Last task: ${JSON.stringify(lastTask)}`);
}

async function waitForQueue(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const queue = await get("/queue");
    if (predicate(queue)) return queue;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function get(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${path} failed with ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function postExpectError(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (response.ok) throw new Error(`POST ${path} unexpectedly succeeded: ${text}`);
  return { status: response.status, text };
}
