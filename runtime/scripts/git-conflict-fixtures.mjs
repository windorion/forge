#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = await mkdtemp(join(tmpdir(), "forge-git-conflicts-"));
const repositoryRoot = join(tempRoot, "repo");
const databasePath = join(tempRoot, "forge.sqlite");
const settingsPath = join(tempRoot, "settings.json");
const port = 18400 + Math.floor(Math.random() * 600);
const baseURL = `http://127.0.0.1:${port}`;
let runtime;
let runtimeOutput = "";

try {
  await git(["init", "--initial-branch=main", repositoryRoot], tempRoot);
  await git(["config", "user.name", "Forge Smoke"], repositoryRoot);
  await git(["config", "user.email", "forge-smoke@example.invalid"], repositoryRoot);
  await writeFile(join(repositoryRoot, "alpha.txt"), "base alpha\n", "utf8");
  await writeFile(join(repositoryRoot, "beta.txt"), "base beta\n", "utf8");
  await git(["add", "alpha.txt", "beta.txt"], repositoryRoot);
  await git(["commit", "-m", "base"], repositoryRoot);

  await git(["checkout", "-b", "agent/change"], repositoryRoot);
  await writeFile(join(repositoryRoot, "alpha.txt"), "agent alpha\n", "utf8");
  await writeFile(join(repositoryRoot, "beta.txt"), "agent beta\n", "utf8");
  await git(["commit", "-am", "agent versions"], repositoryRoot);

  await git(["checkout", "main"], repositoryRoot);
  await writeFile(join(repositoryRoot, "alpha.txt"), "main alpha\n", "utf8");
  await writeFile(join(repositoryRoot, "beta.txt"), "main beta\n", "utf8");
  await git(["commit", "-am", "main versions"], repositoryRoot);
  await git(["checkout", "agent/change"], repositoryRoot);
  await gitExpectFailure(["merge", "main"], repositoryRoot);

  runtime = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_REPO_ROOT: repositoryRoot,
      FORGE_RUNTIME_DB_PATH: databasePath,
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: settingsPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  runtime.stdout.on("data", (chunk) => { runtimeOutput += chunk.toString("utf8"); });
  runtime.stderr.on("data", (chunk) => { runtimeOutput += chunk.toString("utf8"); });
  await waitForHealth();

  let snapshot = await get("/git/conflicts");
  assert(snapshot.operation === "Merge", `Expected Merge, got ${snapshot.operation}.`);
  assert(snapshot.files.length === 2, `Expected two conflicts, got ${snapshot.files.length}.`);
  const alpha = snapshot.files.find((file) => file.path === "alpha.txt");
  const beta = snapshot.files.find((file) => file.path === "beta.txt");
  assert(alpha?.ours.content === "agent alpha\n", "Ours did not expose the current branch version.");
  assert(alpha?.theirs.content === "main alpha\n", "Theirs did not expose the incoming version.");
  assert(alpha?.working.content.includes("<<<<<<<"), "Working version did not expose conflict markers.");

  const missingConfirmation = await postExpectError("/git/conflicts/resolve", {
    path: alpha.path,
    strategy: "Ours",
    expectedHead: snapshot.head,
    expectedConflictHash: alpha.conflictHash,
    confirmation: "NO"
  });
  assert(missingConfirmation.status === 409, `Expected confirmation gate 409, got ${missingConfirmation.status}.`);

  let result = await post("/git/conflicts/resolve", {
    path: alpha.path,
    strategy: "Ours",
    expectedHead: snapshot.head,
    expectedConflictHash: alpha.conflictHash,
    confirmation: "RESOLVE_GIT_CONFLICT"
  });
  assert(result.remainingConflicts === 1, `Expected one remaining conflict, got ${result.remainingConflicts}.`);
  assert(await readFile(join(repositoryRoot, "alpha.txt"), "utf8") === "agent alpha\n", "Ours resolution wrote the wrong content.");

  const stale = await postExpectError("/git/conflicts/resolve", {
    path: beta.path,
    strategy: "Manual",
    content: "manual beta\n",
    expectedHead: snapshot.head,
    expectedConflictHash: "stale-hash",
    confirmation: "RESOLVE_GIT_CONFLICT"
  });
  assert(stale.status === 409, `Expected stale-review gate 409, got ${stale.status}.`);

  snapshot = await get("/git/conflicts");
  const refreshedBeta = snapshot.files.find((file) => file.path === "beta.txt");
  result = await post("/git/conflicts/resolve", {
    path: refreshedBeta.path,
    strategy: "Manual",
    content: "agent and main beta\n",
    expectedHead: snapshot.head,
    expectedConflictHash: refreshedBeta.conflictHash,
    confirmation: "RESOLVE_GIT_CONFLICT"
  });
  assert(result.remainingConflicts === 0, `Expected zero conflicts, got ${result.remainingConflicts}.`);
  assert(await readFile(join(repositoryRoot, "beta.txt"), "utf8") === "agent and main beta\n", "Manual resolution wrote the wrong content.");

  const staged = await git(["diff", "--cached", "--name-only"], repositoryRoot);
  assert(staged.includes("beta.txt"), "Manual resolution was not staged.");
  const unmerged = await git(["diff", "--name-only", "--diff-filter=U"], repositoryRoot);
  assert(unmerged.trim() === "", `Unmerged entries remain: ${unmerged}`);
  await stat(join(repositoryRoot, ".git", "MERGE_HEAD"));

  console.log("Git conflict fixture smoke passed.");
  console.log("- Read base/ours/theirs/working conflict stages");
  console.log("- Enforced confirmation and stale-review gates");
  console.log("- Resolved and staged ours + manual strategies");
  console.log("- Left merge continuation under human control");
} finally {
  if (runtime && runtime.exitCode === null) {
    runtime.kill("SIGTERM");
    await Promise.race([onceExit(runtime), sleep(2_000)]);
  }
  await rm(tempRoot, { recursive: true, force: true });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (runtime.exitCode !== null) throw new Error(`Runtime exited with ${runtime.exitCode}: ${runtimeOutput}`);
    try {
      const health = await get("/health");
      if (health.ok) return;
    } catch {}
    await sleep(50);
  }
  throw new Error("Runtime health check timed out.");
}

async function get(pathname) {
  const response = await fetch(`${baseURL}${pathname}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function post(pathname, body) {
  const response = await fetch(`${baseURL}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function postExpectError(pathname, body) {
  const response = await fetch(`${baseURL}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, text: await response.text() };
}

async function git(args, cwd) {
  const result = await run("git", args, cwd);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.output}`);
  return result.output;
}

async function gitExpectFailure(args, cwd) {
  const result = await run("git", args, cwd);
  assert(result.exitCode !== 0, `git ${args.join(" ")} unexpectedly succeeded.`);
  return result.output;
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ exitCode: code ?? 1, output }));
  });
}

function onceExit(child) {
  return new Promise((resolveExit) => child.once("exit", resolveExit));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
