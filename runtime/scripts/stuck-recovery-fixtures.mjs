#!/usr/bin/env node
// End-to-end fixture for the LIVE stalled-work watchdog.
//
// Startup recovery already finalizes work that was non-terminal when the
// process died, so a restart-based fixture would prove nothing about the
// watchdog. This instead keeps one runtime up, starts genuinely in-flight work
// (a real 5s spawned task command), and runs the sweep with sub-minute
// thresholds so that live work is past its deadline. That is exactly the
// situation the watchdog exists for: a runtime that stays up while its work
// wedges.
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-stuck-${process.pid}-${Date.now()}`);
const port = 18900 + Math.floor(Math.random() * 400);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  await mkdir(tempRoot, { recursive: true });
  const repo = join(tempRoot, "repo");
  // The long smoke command runs with cwd "runtime", so that directory must exist.
  await mkdir(join(repo, "runtime"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Stuck fixture\n", "utf8");

  const runtime = await startRuntime(repo, port);
  try {
    const task = await post(port, "/tasks", { title: "Stalled work", objective: "Exercise the stalled-work watchdog." });

    // A brand-new task has nothing in flight — the sweep must leave it alone.
    const quiet = await post(port, "/maintenance/recover-stuck", {});
    assert(!quiet.recovered.some((r) => r.taskID === task.id), "Sweep must not touch a task with no in-flight work.");

    // Start real in-flight work: an approved 5-second spawned command.
    await post(port, `/tasks/${task.id}/approve-validation-preset`, {
      presetID: "smoke-task-commands",
      note: "Stuck fixture approves the long smoke command."
    });
    const runPromise = post(port, `/tasks/${task.id}/run-task-command`, { commandID: "smoke-long-task-command" })
      .catch(() => undefined); // the run is swept mid-flight; its response is not the subject here

    const running = await waitFor(
      port,
      task.id,
      (t) => t.taskCommandRuns?.some((r) => r.commandID === "smoke-long-task-command" && r.status === "Running"),
      "long task command to enter Running"
    );
    assert(running.status === "Running" || running.status === "Testing", `Expected an active task, got ${running.status}`);

    // Sweep while it is genuinely running. Thresholds are sub-minute (set in
    // startRuntime), so this in-flight work is past its deadline.
    await sleep(1200);
    const swept = await post(port, "/maintenance/recover-stuck", {});
    const entry = swept.recovered.find((r) => r.taskID === task.id);
    assert(entry, `Watchdog did not recover the in-flight task: ${JSON.stringify(swept)}`);
    assert(
      entry.findings.some((f) => f.kind === "TaskCommandRun"),
      `Expected a TaskCommandRun finding, got ${JSON.stringify(entry.findings.map((f) => f.kind))}`
    );
    assert(
      entry.findings.every((f) => typeof f.stalledMinutes === "number" && f.reason.includes("terminal state")),
      `Findings lost their evidence: ${JSON.stringify(entry.findings)}`
    );

    const after = await getTask(port, task.id);
    assert(after.status === "Human Review", `Expected Human Review, got ${after.status}`);
    assert(after.currentPhase === "Stalled Work Recovered", `Expected the watchdog phase, got ${after.currentPhase}`);
    const sweptRun = after.taskCommandRuns.find((r) => r.commandID === "smoke-long-task-command");
    assert(sweptRun.status === "Failed", `Wedged command run was not failed closed: ${sweptRun.status}`);
    assert(sweptRun.outputSummary.includes("terminal state"), "Command run lost its stall evidence.");
    assert(
      sweptRun.outputChunks.some((c) => c.stream === "system" && c.text.includes("terminal state")),
      "Command run did not record a system output chunk explaining the stall."
    );
    assert(after.events.some((e) => e.type === "agent.stalled_work.recovered"), "No recovery event was recorded.");
    assert(after.reviewSummary.includes("stalled"), `Review summary lost the stall context: ${after.reviewSummary}`);

    // Idempotent: everything is terminal now, so a second sweep finds nothing.
    const again = await post(port, "/maintenance/recover-stuck", {});
    assert(!again.recovered.some((r) => r.taskID === task.id), "Sweep should be idempotent once work is terminal.");

    await runPromise;
    console.log("Stuck recovery fixtures passed.");
    console.log("- Live in-flight command detected past its deadline (no restart involved)");
    console.log("- Failed closed to Human Review with elapsed evidence + system output chunk");
    console.log("- Recovery event recorded; sweep is idempotent and leaves quiet tasks alone");
  } finally {
    await stopRuntime(runtime);
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function startRuntime(repoRoot, p) {
  const runtime = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "dist/server.js"],
    {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        FORGE_RUNTIME_PORT: String(p),
        FORGE_REPO_ROOT: repoRoot,
        FORGE_RUNTIME_DB_PATH: join(tempRoot, "forge.sqlite"),
        FORGE_MODEL_PROVIDER_SETTINGS_PATH: join(tempRoot, "model-provider.json"),
        FORGE_MODEL_PROVIDER: "local",
        FORGE_ENABLE_SMOKE_COMMANDS: "1",
        // Sub-minute deadlines so live work is past due; the sweep itself is
        // driven explicitly rather than on a timer.
        FORGE_STUCK_STEP_MINUTES: "0.01",
        FORGE_STUCK_COMMAND_MINUTES: "0.01",
        FORGE_STUCK_TOOL_MINUTES: "0.01",
        FORGE_STUCK_SWEEP_INTERVAL_MS: "0"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  runtime.output = "";
  runtime.stdout.on("data", (chunk) => { runtime.output += chunk.toString("utf8"); });
  runtime.stderr.on("data", (chunk) => { runtime.output += chunk.toString("utf8"); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const health = await get(p, "/health");
      if (health.ok && health.workspace?.repoRoot === repoRoot) {
        return runtime;
      }
    } catch {
      // keep waiting
    }
    await sleep(100);
  }
  await stopRuntime(runtime);
  throw new Error(`Runtime did not become healthy.\n${runtime.output}`);
}

async function stopRuntime(runtime) {
  if (!runtime || runtime.killed) {
    return;
  }
  runtime.kill("SIGTERM");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (runtime.exitCode !== null || runtime.signalCode !== null) {
      return;
    }
    await sleep(100);
  }
  runtime.kill("SIGKILL");
}

async function getTask(p, taskID) {
  const list = await get(p, "/tasks");
  return (list.tasks ?? list).find((t) => t.id === taskID);
}

async function waitFor(p, taskID, predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await getTask(p, taskID);
    if (task && predicate(task)) {
      return task;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function get(p, path) {
  const response = await fetch(`http://127.0.0.1:${p}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function post(p, path, body) {
  const response = await fetch(`http://127.0.0.1:${p}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${path} failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}
