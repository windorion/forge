#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-mission-routing-${process.pid}-${Date.now()}`);
const basePort = 19700 + Math.floor(Math.random() * 250);
const soakIterations = boundedInteger(process.env.FORGE_MISSION_CONTROL_SOAK_ITERATIONS, 8, 1, 100);
const taskCountPerRepository = boundedInteger(process.env.FORGE_MISSION_CONTROL_TASK_COUNT, 6, 1, 30);
const repositories = [
  repository("alpha", basePort, "mission-alpha-authorization"),
  repository("beta", basePort + 1, "mission-beta-authorization")
];
const runtimes = new Map();

try {
  await mkdir(tempRoot, { recursive: true });
  for (const repo of repositories) {
    await mkdir(repo.root, { recursive: true });
    await mkdir(join(repo.root, "runtime"), { recursive: true });
    await writeFile(join(repo.root, "README.md"), `# ${repo.name}\n`, "utf8");
    await writeFile(join(repo.root, "runtime", ".keep"), "", "utf8");
    await run("git", ["init", "--quiet", repo.root], tempRoot);
    await run("git", ["config", "user.name", "Forge Mission Fixture"], repo.root);
    await run("git", ["config", "user.email", "forge-mission@example.invalid"], repo.root);
    await run("git", ["add", "README.md", "runtime/.keep"], repo.root);
    await run("git", ["commit", "--quiet", "-m", "Seed Mission Control fixture"], repo.root);
    const seed = await startRuntime(repo, "primary");
    await stopRuntime(seed);
  }

  for (const repo of repositories) {
    runtimes.set(repo.name, await startRuntime(repo, "observer"));
  }
  for (const repo of repositories) {
    const health = await request(repo, "GET", "/health");
    assert(health.runtimeMode === "observer" && health.readOnly === true, `${repo.name} observer boundary was not reported.`);
    assert(health.workspace.repoRoot === repo.root, `${repo.name} observer reported the wrong repository root.`);
    const rejected = await request(repo, "POST", "/tasks", taskInput(repo, -1), false);
    assert(rejected.status === 403 && rejected.body.error === "observer_read_only", `${repo.name} observer accepted task creation.`);
    const missing = await request(repo, "GET", "/tasks/not-present", undefined, false);
    assert(missing.status === 404, `${repo.name} missing task detail did not return 404.`);
  }

  await stopAll();

  for (const repo of repositories) {
    runtimes.set(repo.name, await startRuntime(repo, "primary", repo.authorizationID));
    const health = await request(repo, "GET", "/health");
    assert(health.runtimeAuthorization?.id === repo.authorizationID, `${repo.name} active authorization did not round-trip.`);
    assert(health.modelProvider?.id === "local", `${repo.name} active runtime was not local-provider locked.`);
  }

  const createdByRepository = new Map();
  await Promise.all(repositories.map(async (repo) => {
    const created = await Promise.all(
      Array.from({ length: taskCountPerRepository }, (_, index) =>
        request(repo, "POST", "/tasks", taskInput(repo, index))
      )
    );
    createdByRepository.set(repo.name, created);
  }));

  for (const repo of repositories) {
    const created = createdByRepository.get(repo.name);
    assert(created?.length === taskCountPerRepository, `${repo.name} concurrent creation count was incorrect.`);
    assert(new Set(created.map((task) => task.id)).size === taskCountPerRepository, `${repo.name} task IDs were not unique.`);
    for (const task of created) {
      const detail = await request(repo, "GET", `/tasks/${encodeURIComponent(task.id)}`);
      assert(detail.id === task.id && detail.title === task.title, `${repo.name} task detail routing returned the wrong task.`);
    }
  }

  const alphaIDs = new Set(createdByRepository.get("alpha").map((task) => task.id));
  const betaIDs = new Set(createdByRepository.get("beta").map((task) => task.id));
  assert([...alphaIDs].every((id) => !betaIDs.has(id)), "Repository task ID sets unexpectedly overlapped.");
  const crossRoute = await request(repositories[1], "GET", `/tasks/${[...alphaIDs][0]}`, undefined, false);
  assert(crossRoute.status === 404, "A task detail request crossed repository runtime boundaries.");

  await Promise.all(repositories.map((repo) =>
    exerciseRoutedCommandAndGitActions(repo, createdByRepository.get(repo.name)[0])
  ));

  await stopAll();
  const activeHashes = new Map();
  for (const repo of repositories) {
    activeHashes.set(repo.name, await sha256(repo.dbPath));
    runtimes.set(repo.name, await startRuntime(repo, "observer"));
  }

  for (let iteration = 0; iteration < soakIterations; iteration += 1) {
    await Promise.all(repositories.map(async (repo) => {
      const [health, tasks, queue, git] = await Promise.all([
        request(repo, "GET", "/health"),
        request(repo, "GET", "/tasks"),
        request(repo, "GET", "/queue"),
        request(repo, "GET", "/git/status")
      ]);
      assert(health.workspace.repoRoot === repo.root, `${repo.name} soak iteration ${iteration} changed identity.`);
      assert(tasks.tasks.length === taskCountPerRepository, `${repo.name} soak iteration ${iteration} lost task visibility.`);
      assert(Array.isArray(queue.running) && git.isRepository === true, `${repo.name} soak iteration ${iteration} returned malformed evidence.`);
      const selected = createdByRepository.get(repo.name)[iteration % taskCountPerRepository];
      const detail = await request(repo, "GET", `/tasks/${selected.id}`);
      assert(detail.id === selected.id, `${repo.name} soak iteration ${iteration} misrouted detail.`);
    }));
    await sleep(40);
  }

  for (const repo of repositories) {
    const rejected = await request(repo, "POST", "/tasks", taskInput(repo, 99), false);
    assert(rejected.status === 403, `${repo.name} observer accepted a mutation after active revocation.`);
    assert(await sha256(repo.dbPath) === activeHashes.get(repo.name), `${repo.name} observer supervision changed SQLite bytes.`);
  }

  console.log("Mission Control routing fixture passed.");
  console.log(`- Repositories: ${repositories.length} isolated loopback runtimes`);
  console.log(`- Authorized creation: ${taskCountPerRepository * repositories.length} tasks (${taskCountPerRepository} concurrent per repository)`);
  console.log("- Detail routing: exact task reads plus cross-repository 404 negative control");
  console.log("- Routed actions: permission approval, command start/cancel, diff, local commit, and local branch per repository");
  console.log("- Git review: branch-publish, push, and PR handoff previews stayed read-only with no configured remote");
  console.log(`- Observer soak: ${soakIterations} health/tasks/queue/git/detail polling iterations per repository`);
  console.log("- Revocation: POST blocked and task databases byte-identical during read-only supervision");
} finally {
  await stopAll();
  await rm(tempRoot, { recursive: true, force: true });
}

function repository(name, port, authorizationID) {
  const root = join(tempRoot, name);
  return {
    name,
    root,
    port,
    authorizationID,
    dbPath: join(root, ".forge", "forge.sqlite"),
    settingsPath: join(tempRoot, `${name}-provider-settings.json`)
  };
}

function taskInput(repo, index) {
  return {
    title: `${repo.name} background task ${index}`,
    objective: `Exercise repository-scoped Mission Control routing for ${repo.name} without external APIs.`
  };
}

async function exerciseRoutedCommandAndGitActions(repo, task) {
  let permissions = await request(repo, "GET", `/tasks/${task.id}/validation-permissions`);
  const smokePreset = permissions.permissions.find((item) => item.preset.id === "smoke-task-commands");
  const smokeCommand = permissions.taskCommands.find((item) => item.command.id === "smoke-long-task-command");
  assert(smokePreset?.canApprove === true, `${repo.name} did not expose the task-level command approval.`);
  assert(smokeCommand?.canRun === false, `${repo.name} allowed the command before approval.`);

  await request(repo, "POST", `/tasks/${task.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    note: "Mission Control routed command fixture approval."
  });
  permissions = await request(repo, "GET", `/tasks/${task.id}/validation-permissions`);
  assert(
    permissions.taskCommands.find((item) => item.command.id === "smoke-long-task-command")?.canRun === true,
    `${repo.name} did not make the approved command runnable.`
  );

  const commandPromise = request(repo, "POST", `/tasks/${task.id}/run-task-command`, {
    commandID: "smoke-long-task-command"
  });
  let runningID;
  await waitUntil(async () => {
    const detail = await request(repo, "GET", `/tasks/${task.id}`);
    runningID = detail.taskCommandRuns?.find((run) => run.commandID === "smoke-long-task-command" && run.status === "Running")?.id;
    return Boolean(runningID);
  }, `${repo.name} routed command start`);
  await request(repo, "POST", `/tasks/${task.id}/cancel-task-command`, {
    taskCommandRunID: runningID,
    note: "Mission Control routed command fixture cancellation."
  });
  await commandPromise;
  const cancelled = await request(repo, "GET", `/tasks/${task.id}`);
  assert(
    cancelled.taskCommandRuns.some((run) => run.id === runningID && run.status === "Cancelled"),
    `${repo.name} did not retain routed command cancellation evidence.`
  );

  await writeFile(
    join(repo.root, "README.md"),
    `# ${repo.name}\n\nMission Control routed command and Git evidence.\n`,
    "utf8"
  );
  const status = await request(repo, "GET", "/git/status");
  assert(status.changedFiles.some((file) => file.path === "README.md"), `${repo.name} Git status missed its own change.`);
  const diff = await request(repo, "GET", "/git/diff?path=README.md");
  assert(diff.diff.includes("Mission Control routed command"), `${repo.name} Git diff returned the wrong repository content.`);

  const commitPreview = await request(repo, "GET", `/git/commit-preview?taskID=${task.id}`);
  assert(commitPreview.expectedHead && commitPreview.blockers.length === 0, `${repo.name} commit preview was unexpectedly blocked.`);
  assert(commitPreview.includedFiles.some((file) => file.path === "README.md"), `${repo.name} commit preview missed README.md.`);
  const commit = await request(repo, "POST", "/git/commit", {
    taskID: task.id,
    expectedHead: commitPreview.expectedHead,
    title: `Record ${repo.name} routed action evidence`,
    body: ["Created by the isolated Mission Control fixture."],
    paths: ["README.md"],
    confirmation: "CreateLocalCommit"
  });
  assert(commit.committedFiles.some((file) => file.path === "README.md"), `${repo.name} local commit omitted README.md.`);

  const targetBranch = `forge/mission-${repo.name}`;
  const branchPreview = await request(
    repo,
    "GET",
    `/git/branch-preview?taskID=${task.id}&targetBranch=${encodeURIComponent(targetBranch)}`
  );
  assert(branchPreview.blockers.length === 0 && branchPreview.mode === "CreateBranch", `${repo.name} branch preview was not ready to create.`);
  const branch = await request(repo, "POST", "/git/branch", {
    taskID: task.id,
    expectedHead: branchPreview.expectedHead,
    expectedCurrentBranch: branchPreview.currentBranch,
    targetBranch: branchPreview.targetBranch,
    mode: branchPreview.mode,
    confirmation: branchPreview.mode
  });
  assert(branch.branch === targetBranch, `${repo.name} changed to the wrong local branch.`);

  const [publishPreview, pushPreview, prPreview] = await Promise.all([
    request(repo, "GET", `/git/branch-publish-preview?taskID=${task.id}`),
    request(repo, "GET", `/git/push-preview?taskID=${task.id}`),
    request(repo, "GET", `/git/pr-preview?taskID=${task.id}`)
  ]);
  assert(publishPreview.blockers.length > 0, `${repo.name} branch publish preview invented a remote.`);
  assert(pushPreview.blockers.length > 0, `${repo.name} push preview invented an upstream.`);
  assert(prPreview.blockers.length > 0, `${repo.name} PR preview invented publish readiness.`);
}

async function startRuntime(repo, mode, authorizationID) {
  const environment = {
    ...process.env,
    FORGE_RUNTIME_PORT: String(repo.port),
    FORGE_RUNTIME_MODE: mode,
    FORGE_REPO_ROOT: repo.root,
    FORGE_RUNTIME_DB_PATH: repo.dbPath,
    FORGE_MODEL_PROVIDER_SETTINGS_PATH: repo.settingsPath,
    FORGE_MODEL_PROVIDER: "local",
    FORGE_MODEL_PROVIDER_LOCK: "local",
    FORGE_ENABLE_SMOKE_COMMANDS: "1",
    OPENAI_API_KEY: ""
  };
  if (authorizationID) {
    environment.FORGE_RUNTIME_AUTHORIZATION_ID = authorizationID;
    environment.FORGE_RUNTIME_AUTHORIZED_AT = "2026-08-08T12:00:00.000Z";
    environment.FORGE_QUEUE_DISPATCH_MODE = "supervised";
  } else {
    delete environment.FORGE_RUNTIME_AUTHORIZATION_ID;
    delete environment.FORGE_RUNTIME_AUTHORIZED_AT;
    delete environment.FORGE_QUEUE_DISPATCH_MODE;
  }

  const child = spawn("node", ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    shell: false,
    env: environment
  });
  let output = "";
  let exited = false;
  const closed = new Promise((resolveClosed) => child.on("exit", resolveClosed));
  const append = (chunk) => { output = `${output}${chunk.toString("utf8")}`.slice(-10_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", () => { exited = true; });
  const handle = { child, closed, get exited() { return exited; }, get output() { return output; } };
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (handle.exited) throw new Error(`${repo.name} ${mode} runtime exited before health.\n${handle.output}`);
    const result = await request(repo, "GET", "/health", undefined, false).catch(() => undefined);
    if (result?.status === 200) return handle;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${repo.name} ${mode} runtime.\n${handle.output}`);
}

async function stopAll() {
  await Promise.all([...runtimes.values()].map(stopRuntime));
  runtimes.clear();
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

async function waitUntil(operation, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await operation()) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for ${label}.`);
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

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
