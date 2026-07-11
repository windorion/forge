#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureID = `forge-git-remote-${process.pid}-${Date.now()}`;
const tempRoot = join(tmpdir(), fixtureID);
const portBase = 18400 + Math.floor(Math.random() * 800);

try {
  await mkdir(tempRoot, { recursive: true });
  await runNonFastForwardPushFixture(portBase);
  await runBranchPublishCollisionFixture(portBase + 1);
  await runBranchPublishRemoteRejectionFixture(portBase + 2);
  console.log("Git remote fixtures passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function runNonFastForwardPushFixture(port) {
  const fixture = await createGitFixture("non-fast-forward");
  const runtime = await startRuntime(fixture.worktree, port);
  try {
    await writeFile(join(fixture.worktree, "README.md"), "# Fixture\n\nLocal push commit.\n", "utf8");
    await git(["add", "README.md"], fixture.worktree);
    await git(["commit", "-m", "Local push commit"], fixture.worktree);

    const preview = await get(port, "/git/push-preview");
    assert(
      preview.readiness === "Ready" || preview.readiness === "NeedsReview",
      `Expected push preview actionable, got ${preview.readiness}.`
    );
    assert(preview.blockers.length === 0, `Expected push preview without blockers, got ${preview.blockers.join(" ")}`);
    assert(preview.ahead === 1, `Expected one local commit ahead, got ${preview.ahead}.`);

    const peer = await clonePeer(fixture.origin, "peer-non-fast-forward");
    await writeFile(join(peer, "README.md"), "# Fixture\n\nRemote peer commit.\n", "utf8");
    await git(["add", "README.md"], peer);
    await git(["commit", "-m", "Remote peer commit"], peer);
    await git(["push", "origin", "main"], peer);

    const blocked = await postExpectError(port, "/git/push", {
      expectedHead: preview.expectedHead,
      expectedBranch: preview.branch,
      expectedUpstream: preview.upstream,
      confirmation: "PushCurrentBranch"
    });
    assert(blocked.status === 409, `Expected stale remote push to fail with 409, got ${blocked.status}.`);
    assert(
      blocked.text.includes("remote has commits that are not present locally"),
      "Push failure was not classified as non-fast-forward."
    );
  } finally {
    await stopRuntime(runtime);
  }
}

async function runBranchPublishCollisionFixture(port) {
  const fixture = await createGitFixture("branch-publish-collision");
  const runtime = await startRuntime(fixture.worktree, port);
  try {
    const branch = "forge/collision-fixture";
    await git(["switch", "-c", branch], fixture.worktree);
    await writeFile(join(fixture.worktree, "collision.md"), "# Collision\n", "utf8");
    await git(["add", "collision.md"], fixture.worktree);
    await git(["commit", "-m", "Local collision branch"], fixture.worktree);

    const peer = await clonePeer(fixture.origin, "peer-collision");
    await git(["switch", "-c", branch], peer);
    await writeFile(join(peer, "collision.md"), "# Remote Collision\n", "utf8");
    await git(["add", "collision.md"], peer);
    await git(["commit", "-m", "Remote collision branch"], peer);
    await git(["push", "origin", `${branch}:${branch}`], peer);

    const preview = await get(port, "/git/branch-publish-preview");
    assert(preview.readiness === "Blocked", `Expected branch publish collision blocked, got ${preview.readiness}.`);
    assert(
      preview.blockers.some((blocker) => blocker.includes(`Remote branch already exists: origin/${branch}`)),
      "Branch publish preview did not report the remote branch collision."
    );
    assert(
      preview.preflight?.remoteStatus === "RemoteCollision",
      `Expected RemoteCollision preflight, got ${preview.preflight?.remoteStatus}.`
    );
  } finally {
    await stopRuntime(runtime);
  }
}

async function runBranchPublishRemoteRejectionFixture(port) {
  const fixture = await createGitFixture("branch-publish-rejection");
  await installRejectingHook(fixture.origin);

  const runtime = await startRuntime(fixture.worktree, port);
  try {
    const branch = "forge/rejected-fixture";
    await git(["switch", "-c", branch], fixture.worktree);
    await writeFile(join(fixture.worktree, "rejected.md"), "# Rejected\n", "utf8");
    await git(["add", "rejected.md"], fixture.worktree);
    await git(["commit", "-m", "Rejected branch publish"], fixture.worktree);

    const preview = await get(port, "/git/branch-publish-preview");
    assert(
      preview.readiness === "Ready" || preview.readiness === "NeedsReview",
      `Expected publish preview actionable before hook rejection, got ${preview.readiness}.`
    );
    assert(preview.blockers.length === 0, `Expected publish preview without blockers, got ${preview.blockers.join(" ")}`);

    const blocked = await postExpectError(port, "/git/branch-publish", {
      expectedHead: preview.expectedHead,
      expectedBranch: preview.branch,
      remote: preview.remote,
      remoteBranch: preview.remoteBranch,
      confirmation: "PublishCurrentBranch"
    });
    assert(blocked.status === 409, `Expected rejected publish to fail with 409, got ${blocked.status}.`);
    assert(
      blocked.text.includes("remote policy rejected the branch update"),
      "Branch publish failure was not classified as a remote policy rejection."
    );
  } finally {
    await stopRuntime(runtime);
  }
}

async function createGitFixture(name) {
  const root = join(tempRoot, name);
  const origin = join(root, "origin.git");
  const worktree = join(root, "worktree");
  await mkdir(root, { recursive: true });
  await git(["init", "--bare", origin]);
  await git(["symbolic-ref", "HEAD", "refs/heads/main"], origin);
  await git(["clone", origin, worktree]);
  await configureGitIdentity(worktree);
  await writeFile(join(worktree, "README.md"), "# Fixture\n\nInitial commit.\n", "utf8");
  await git(["add", "README.md"], worktree);
  await git(["commit", "-m", "Initial commit"], worktree);
  await git(["branch", "-M", "main"], worktree);
  await git(["push", "-u", "origin", "main"], worktree);
  return { root, origin, worktree };
}

async function clonePeer(origin, name) {
  const peer = join(tempRoot, name);
  await git(["clone", origin, peer]);
  await configureGitIdentity(peer);
  return peer;
}

async function configureGitIdentity(cwd) {
  await git(["config", "user.name", "Forge Fixture"], cwd);
  await git(["config", "user.email", "forge-fixture@example.invalid"], cwd);
}

async function installRejectingHook(origin) {
  const hook = join(origin, "hooks", "pre-receive");
  await writeFile(
    hook,
    [
      "#!/bin/sh",
      "echo 'protected branch hook declined by Forge fixture' >&2",
      "exit 1",
      ""
    ].join("\n"),
    "utf8"
  );
  await chmod(hook, 0o755);
}

async function startRuntime(repoRoot, port) {
  const runtime = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "dist/server.js"],
    {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        FORGE_RUNTIME_PORT: String(port),
        FORGE_REPO_ROOT: repoRoot,
        FORGE_RUNTIME_DB_PATH: join(tempRoot, `forge-${port}.sqlite`),
        FORGE_MODEL_PROVIDER_SETTINGS_PATH: join(tempRoot, `model-provider-${port}.json`),
        FORGE_MODEL_PROVIDER: "local"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  runtime.output = "";
  runtime.stdout.on("data", (chunk) => {
    runtime.output += chunk.toString("utf8");
  });
  runtime.stderr.on("data", (chunk) => {
    runtime.output += chunk.toString("utf8");
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const health = await get(port, "/health");
      if (health.ok && health.workspace?.repoRoot === repoRoot) {
        return runtime;
      }
    } catch {
      // keep waiting
    }
    await sleep(100);
  }

  await stopRuntime(runtime);
  throw new Error(`Runtime did not become healthy for ${repoRoot}.\n${runtime.output}`);
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

async function get(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function postExpectError(port, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (response.ok) {
    throw new Error(`POST ${path} unexpectedly succeeded: ${text}`);
  }
  return { status: response.status, text };
}

async function git(args, cwd = tempRoot) {
  const result = await run("git", args, cwd);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}\n${result.output}`);
  }
  return result.output;
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      resolveRun({ code, output });
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
