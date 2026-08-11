#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  buildPerformanceReport,
  renderPerformanceReportMarkdown
} from "../dist/performanceBudget.js";
import { SqliteTaskStore } from "../dist/taskStore.js";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectRoot = resolve(runtimeRoot, "..");
const campaignStartedAt = Date.now();
const config = JSON.parse(await readFile(join(runtimeRoot, "performance-budgets.json"), "utf8"));
const profileID = argumentValue("--profile") ?? "smoke";
const profile = config.profiles?.[profileID];
if (!profile) {
  throw new Error(`Unknown performance profile ${profileID}. Expected one of: ${Object.keys(config.profiles ?? {}).join(", ")}.`);
}

const enforce = process.argv.includes("--enforce");
const keepFixture = process.argv.includes("--keep-fixture");
const baselinePath = argumentValue("--baseline");
const outputDirectory = resolve(argumentValue("--output") ?? join(
  projectRoot,
  ".forge",
  "performance-results",
  `${profileID}-${new Date(campaignStartedAt).toISOString().replaceAll(":", "-")}`
));
const tempRoot = join(tmpdir(), `forge-performance-${profileID}-${process.pid}-${campaignStartedAt}`);
const repoRoot = join(tempRoot, "repo");
const databasePath = join(tempRoot, "forge.sqlite");
let runtime;

try {
  console.log(`[performance] profile=${profileID} files=${profile.fileCount} tasks=${profile.taskCount}`);
  await createFixtureRepository(repoRoot, profile.fileCount, profile.linesPerFile);
  const seededSchema = seedTaskHistory(databasePath, profile.taskCount);

  const port = await reserveLoopbackPort();
  const started = await startRuntime(port);
  runtime = started.handle;
  const samples = [{
    id: "runtime.cold_start",
    title: "Runtime cold start to healthy",
    unit: "ms",
    samples: [started.durationMs],
    context: { taskCount: profile.taskCount, schemaVersion: seededSchema.currentVersion }
  }];

  const idleSamples = await sampleIdleResources(runtime.child.pid, profile.idleSampleCount, profile.idleSampleIntervalMs);
  samples.push({
    id: "runtime.idle_rss",
    title: "Runtime idle resident memory",
    unit: "MiB",
    samples: idleSamples.rssMiB,
    context: { intervalMs: profile.idleSampleIntervalMs }
  });
  samples.push({
    id: "runtime.idle_cpu",
    title: "Runtime idle CPU",
    unit: "%",
    samples: idleSamples.cpuPercent,
    context: { intervalMs: profile.idleSampleIntervalMs, source: "ps" }
  });

  samples.push(await measureRequests({
    id: "database.task_list",
    title: "Retained task list request",
    unit: "ms",
    count: profile.requestSamples,
    action: () => runtime.get("/tasks"),
    context: { taskCount: profile.taskCount }
  }));

  const coldIndex = await measure(() => runtime.post("/index/rebuild", {}));
  const indexStatus = coldIndex.value;
  const expectedIndexedFiles = Math.min(profile.fileCount + 3, 400);
  assert(
    indexStatus.fileCount === expectedIndexedFiles,
    `Index returned ${indexStatus.fileCount} files; expected the bounded scan to retain ${expectedIndexedFiles}.`
  );
  samples.push({
    id: "repository.index_cold",
    title: "Repository cold index rebuild",
    unit: "ms",
    samples: [coldIndex.durationMs],
    context: { indexedFiles: indexStatus.indexed, totalBytes: indexStatus.totalBytes }
  });
  samples.push(await measureRequests({
    id: "repository.index_warm",
    title: "Repository unchanged index rebuild",
    unit: "ms",
    count: profile.warmIndexSamples,
    action: () => runtime.post("/index/rebuild", {}),
    context: { fileCount: indexStatus.fileCount }
  }));

  await changeDiffTarget(repoRoot, profile.linesPerFile);
  const gitStatusMetric = await measureRequests({
    id: "git.status",
    title: "Git working-tree status",
    unit: "ms",
    count: profile.requestSamples,
    action: () => runtime.get("/git/status"),
    context: { trackedFiles: profile.fileCount + 3 }
  });
  samples.push(gitStatusMetric);
  samples.push(await measureRequests({
    id: "git.diff",
    title: "Bounded single-file Git diff",
    unit: "ms",
    count: profile.requestSamples,
    action: () => runtime.get("/git/diff?path=src%2Fdiff-target.ts"),
    context: { path: "src/diff-target.ts" }
  }));

  const agentStepDurations = [];
  const agentStepActions = [];
  for (let index = 0; index < profile.agentStepSamples; index += 1) {
    const taskID = await prepareAgentStepTask(runtime, index);
    const measured = await measure(() => runtime.post(`/tasks/${taskID}/run-agent-step`, {}));
    const step = measured.value.agentRunSteps?.at(-1);
    assert(step?.status === "Completed", `Agent step did not complete: ${step?.status ?? "missing"}.`);
    assert(step.action === "GenerateEditProposal", `Performance agent step selected ${step.action} instead of GenerateEditProposal.`);
    assert(measured.value.editProposal?.status === "Proposed", "Performance agent step did not produce the expected review-only proposal.");
    agentStepDurations.push(measured.durationMs);
    agentStepActions.push(step.action);
  }
  samples.push({
    id: "agent.step",
    title: "Deterministic local agent step",
    unit: "ms",
    samples: agentStepDurations,
    context: {
      provider: "local-deterministic-performance",
      action: [...new Set(agentStepActions)].join(","),
      reviewOnly: true,
      includesSetup: false
    }
  });

  const environment = {
    platform: platform(),
    architecture: arch(),
    nodeVersion: process.version,
    cpuCount: cpus().length,
    totalMemoryMiB: Math.round(totalmem() / 1024 / 1024),
    ci: process.env.CI === "true" || process.env.CI === "1",
    gitCommit: gitCommit()
  };
  const baseline = baselinePath ? await readBaseline(baselinePath, profileID, environment) : undefined;
  const report = buildPerformanceReport({
    profile: profileID,
    durationMs: Date.now() - campaignStartedAt,
    environment,
    fixture: {
      description: profile.description,
      fileCount: profile.fileCount,
      indexedFileCount: indexStatus.fileCount,
      repositoryScanLimit: 400,
      linesPerFile: profile.linesPerFile,
      taskCount: profile.taskCount,
      requestSamples: profile.requestSamples,
      agentStepSamples: profile.agentStepSamples,
      synthetic: true,
      networkAccess: false
    },
    samples,
    budgets: profile.budgets,
    baselineMetrics: baseline?.metrics,
    baselinePolicy: config.baselinePolicy
  });

  await mkdir(outputDirectory, { recursive: true });
  const jsonPath = join(outputDirectory, "runtime-performance.json");
  const markdownPath = join(outputDirectory, "runtime-performance.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderPerformanceReportMarkdown(report), "utf8");
  await writeFile(join(outputDirectory, "performance-budgets.snapshot.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  console.log(`\nPerformance campaign ${report.status.toLowerCase()} in ${report.durationMs} ms.`);
  for (const metric of report.metrics) {
    console.log(`- ${metric.id}: p50=${metric.p50} ${metric.unit}, p95=${metric.p95} ${metric.unit}, max=${metric.max} ${metric.unit}`);
  }
  for (const evaluation of report.evaluations.filter((candidate) => candidate.status !== "Passed")) {
    console.log(`- ${evaluation.severity} gate ${evaluation.status.toLowerCase()}: ${evaluation.metricID}/${evaluation.statistic} observed=${evaluation.observed ?? "missing"} limit=${evaluation.limit}`);
  }
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
  if (enforce && report.status !== "Passed") process.exitCode = 1;
} finally {
  await stopRuntime(runtime);
  if (!keepFixture) await rm(tempRoot, { recursive: true, force: true });
  else console.log(`Fixture retained: ${tempRoot}`);
}

async function createFixtureRepository(root, fileCount, linesPerFile) {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Forge performance fixture\n\nSynthetic, local, and dependency-free.\n", "utf8");
  for (let index = 0; index < fileCount; index += 1) {
    const id = String(index).padStart(4, "0");
    const lines = [
      `export const module${id} = {`,
      `  id: "module-${id}",`,
      `  searchMarker: "forge-performance-marker-${id}",`,
      "  values: ["
    ];
    for (let line = 0; line < Math.max(1, linesPerFile - 6); line += 1) {
      lines.push(`    "value-${id}-${String(line).padStart(3, "0")}",`);
    }
    lines.push("  ]", "};", "");
    await writeFile(join(root, "src", `module-${id}.ts`), lines.join("\n"), "utf8");
  }
  await writeFile(join(root, "src", "agent-target.ts"), "export function performanceValue(): number {\n  return 1;\n}\n", "utf8");
  await writeFile(join(root, "src", "diff-target.ts"), diffTargetContent(linesPerFile, false), "utf8");
  runGit(["init", "--quiet"], root);
  runGit(["add", "."], root);
  runGit(["-c", "user.name=Forge Performance", "-c", "user.email=forge-performance@example.invalid", "commit", "--quiet", "-m", "Initial performance fixture"], root);
}

function seedTaskHistory(dbPath, taskCount) {
  const store = new SqliteTaskStore(dbPath);
  try {
    for (let index = 0; index < taskCount; index += 1) {
      const createdAt = new Date(campaignStartedAt - (taskCount - index) * 1000).toISOString();
      store.saveTask({
        id: `performance-task-${String(index).padStart(5, "0")}`,
        title: `Retained performance task ${index}`,
        objective: `Measure bounded task history serialization for fixture task ${index}.`,
        status: "Completed",
        currentPhase: "Completed",
        createdAt,
        updatedAt: createdAt,
        agentStates: [],
        planSteps: [],
        events: [{ type: "performance.fixture.seeded", message: "Synthetic retained task.", createdAt }],
        approvals: [],
        toolCalls: [],
        agentRunLoops: [],
        agentRunSteps: [],
        taskCommandRuns: [],
        historyPurges: [],
        commandRerunEvidence: [],
        validationRuns: [],
        validationRepairBriefs: [],
        messages: [],
        planRevisions: [],
        editProposalRevisions: [],
        contextFiles: [],
        changedFiles: [],
        reviewSummary: "Synthetic completed task retained for local performance measurement."
      });
    }
    return store.schemaStatus();
  } finally {
    store.close();
  }
}

async function startRuntime(port) {
  const startedAt = process.hrtime.bigint();
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    shell: false,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_REPO_ROOT: repoRoot,
      FORGE_RUNTIME_DB_PATH: databasePath,
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: join(tempRoot, "model-provider.json"),
      FORGE_TASK_QUEUE_SETTINGS_PATH: join(tempRoot, "task-queue.json"),
      FORGE_MODEL_PROVIDER: "local",
      FORGE_MODEL_NAME: "local-deterministic-performance",
      FORGE_STUCK_SWEEP_INTERVAL_MS: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  let exited = false;
  child.stdout.on("data", (chunk) => { output = boundedOutput(output, chunk); });
  child.stderr.on("data", (chunk) => { output = boundedOutput(output, chunk); });
  child.on("exit", () => { exited = true; });

  const baseURL = `http://127.0.0.1:${port}`;
  const request = async (method, path, body) => {
    const response = await fetch(`${baseURL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 1600)}`);
    return text ? JSON.parse(text) : {};
  };
  const handle = {
    child,
    get exited() { return exited; },
    get output() { return output; },
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body)
  };
  const deadline = Date.now() + 15_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Runtime exited before health check.\n${output}`);
    try {
      const health = await handle.get("/health");
      if (health.ok && health.workspace?.repoRoot === repoRoot) {
        return { handle, health, durationMs: elapsedMs(startedAt) };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(50);
  }
  await stopRuntime(handle);
  throw new Error(`Runtime health timed out: ${lastError}\n${output}`);
}

async function sampleIdleResources(pid, sampleCount, intervalMs) {
  const rssMiB = [];
  const cpuPercent = [];
  // ps reports a recent/lifetime-weighted CPU percentage. Give startup work a
  // full second to decay so this measures the idle runtime rather than module
  // loading and SQLite initialization.
  await sleep(Math.max(1_000, intervalMs * 2));
  for (let index = 0; index < sampleCount; index += 1) {
    const result = spawnSync("ps", ["-o", "rss=", "-o", "%cpu=", "-p", String(pid)], {
      encoding: "utf8",
      shell: false
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`ps resource sample failed: ${(result.stderr || result.stdout).trim()}`);
    const fields = result.stdout.trim().split(/\s+/).map(Number);
    if (fields.length < 2 || fields.some((value) => !Number.isFinite(value))) {
      throw new Error(`Unable to parse ps resource sample: ${result.stdout.trim()}`);
    }
    rssMiB.push(fields[0] / 1024);
    cpuPercent.push(fields[1]);
    await sleep(intervalMs);
  }
  return { rssMiB, cpuPercent };
}

async function prepareAgentStepTask(handle, index) {
  const created = await handle.post("/tasks", {
    title: `Performance agent step ${index + 1}`,
    objective: "In @src/agent-target.ts, change performanceValue to return 2 through a bounded reviewed proposal."
  });
  let task = await waitForTask(handle, created.id, (candidate) =>
    candidate.status === "Human Review" && ["Clarification", "Plan Review"].includes(candidate.currentPhase)
  , "initial planning gate");
  if (task.currentPhase === "Clarification") {
    await handle.post(`/tasks/${created.id}/messages`, {
      content: "Done means a review-only proposal changes only @src/agent-target.ts from return 1 to return 2; do not apply it."
    });
    task = await waitForTask(handle, created.id, (candidate) =>
      candidate.status === "Human Review" && candidate.currentPhase === "Plan Review" && candidate.planRevisions?.length > 0
    , "plan review after clarification");
  }
  if (!task.planRevisions?.length) {
    task = await handle.post(`/tasks/${created.id}/generate-plan-revision`, {});
  }
  await handle.post(`/tasks/${created.id}/approve-plan`, { note: "Performance campaign approves isolated read-only execution preparation." });
  return created.id;
}

async function waitForTask(handle, taskID, predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastTask;
  while (Date.now() < deadline) {
    lastTask = await handle.get(`/tasks/${taskID}`);
    if (lastTask && predicate(lastTask)) return lastTask;
    await sleep(75);
  }
  throw new Error(`Timed out waiting for ${label}. Last task: ${JSON.stringify({
    status: lastTask?.status,
    currentPhase: lastTask?.currentPhase,
    planRevisions: lastTask?.planRevisions?.length
  })}`);
}

async function measureRequests(options) {
  const samples = [];
  for (let index = 0; index < options.count; index += 1) {
    const result = await measure(options.action);
    samples.push(result.durationMs);
  }
  return {
    id: options.id,
    title: options.title,
    unit: options.unit,
    samples,
    context: options.context
  };
}

async function measure(action) {
  const startedAt = process.hrtime.bigint();
  const value = await action();
  return { value, durationMs: elapsedMs(startedAt) };
}

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function changeDiffTarget(root, linesPerFile) {
  await writeFile(join(root, "src", "diff-target.ts"), diffTargetContent(linesPerFile, true), "utf8");
}

function diffTargetContent(linesPerFile, changed) {
  const lines = ["export const diffFixture = ["];
  for (let line = 0; line < Math.max(10, linesPerFile); line += 1) {
    const value = changed && line === Math.floor(linesPerFile / 2) ? "changed-value" : `line-${line}`;
    lines.push(`  "${value}",`);
  }
  lines.push("];", "");
  return lines.join("\n");
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
}

function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8", shell: false });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback performance port.");
  const port = address.port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function readBaseline(rawPath, expectedProfile, currentEnvironment) {
  const baseline = JSON.parse(await readFile(resolve(rawPath), "utf8"));
  if (baseline.schemaVersion !== 1 || baseline.campaign !== "Forge runtime performance budget campaign") {
    throw new Error(`Baseline ${rawPath} is not a Forge runtime performance report.`);
  }
  if (baseline.profile !== expectedProfile) {
    throw new Error(`Baseline profile ${baseline.profile} does not match current profile ${expectedProfile}.`);
  }
  const baselineNodeMajor = String(baseline.environment?.nodeVersion ?? "").match(/^v?(\d+)/)?.[1];
  const currentNodeMajor = String(currentEnvironment.nodeVersion).match(/^v?(\d+)/)?.[1];
  if (
    baseline.environment?.platform !== currentEnvironment.platform ||
    baseline.environment?.architecture !== currentEnvironment.architecture ||
    baselineNodeMajor !== currentNodeMajor
  ) {
    throw new Error(
      `Baseline environment ${baseline.environment?.platform}/${baseline.environment?.architecture}/Node ${baselineNodeMajor ?? "unknown"} ` +
      `does not match current ${currentEnvironment.platform}/${currentEnvironment.architecture}/Node ${currentNodeMajor ?? "unknown"}.`
    );
  }
  return baseline;
}

async function stopRuntime(handle) {
  if (!handle || handle.exited) return;
  handle.child.kill("SIGTERM");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (handle.exited) return;
    await sleep(100);
  }
  handle.child.kill("SIGKILL");
}

function boundedOutput(current, chunk) {
  const next = current + chunk.toString("utf8");
  return next.length > 12_000 ? next.slice(next.length - 12_000) : next;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
