#!/usr/bin/env node
// End-to-end fixture for real GitHub PR creation (POST /git/pr-publish).
// The git remote's fetch URL is a github.com URL (so owner/repo parse), while
// its pushurl points at a local bare repo (so the push lands with no network).
// A mock GitHub API server stands in for api.github.com via FORGE_GITHUB_API_BASE.
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = join(tmpdir(), `forge-pr-publish-${process.pid}-${Date.now()}`);
const port = 18800 + Math.floor(Math.random() * 500);
const mockPort = port + 1;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

let captured = null;
const mock = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    captured = { method: req.method, url: req.url, authorization: req.headers.authorization, apiVersion: req.headers["x-github-api-version"], body: JSON.parse(body || "{}") };
    if (req.method === "POST" && req.url === "/repos/acme/widgets/pulls") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ number: 42, html_url: "https://github.com/acme/widgets/pull/42", state: "open", draft: captured.body.draft === true }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Not Found" }));
  });
});

try {
  await mkdir(tempRoot, { recursive: true });
  const bare = join(tempRoot, "origin.git");
  const worktree = join(tempRoot, "worktree");
  await git(["init", "--bare", bare]);
  await git(["symbolic-ref", "HEAD", "refs/heads/main"], bare);
  await git(["clone", bare, worktree]);
  await git(["config", "user.name", "Forge Fixture"], worktree);
  await git(["config", "user.email", "forge-fixture@example.invalid"], worktree);
  await writeFile(join(worktree, "README.md"), "# Fixture\n\nInitial.\n", "utf8");
  await git(["add", "README.md"], worktree);
  await git(["commit", "-m", "Initial commit"], worktree);
  await git(["branch", "-M", "main"], worktree);
  await git(["push", "-u", "origin", "main"], worktree);
  // Feature branch with one commit ahead of main, pushed with an upstream
  // (the real flow pushes via /git/push before PR handoff).
  await git(["checkout", "-b", "feature/pr"], worktree);
  await writeFile(join(worktree, "feature.txt"), "feature work\n", "utf8");
  await git(["add", "feature.txt"], worktree);
  await git(["commit", "-m", "Add feature work"], worktree);
  await git(["push", "-u", "origin", "feature/pr"], worktree);
  // Fetch URL parses as GitHub; push goes to the local bare repo.
  await git(["remote", "set-url", "origin", "https://github.com/acme/widgets.git"], worktree);
  await git(["remote", "set-url", "--push", "origin", `file://${bare}`], worktree);
  const headSha = (await git(["rev-parse", "HEAD"], worktree)).trim();

  await new Promise((r) => mock.listen(mockPort, "127.0.0.1", r));

  const runtime = await startRuntime(worktree, port, mockPort);
  try {
    const task = await post(port, "/tasks", { title: "Publish PR smoke", objective: "Open a real pull request against the fixture remote." });

    const preview = await get(port, `/git/pr-preview?taskID=${task.id}`);
    assert(preview.blockers.length === 0, `Expected no PR blockers, got: ${JSON.stringify(preview.blockers)}`);
    assert(preview.baseBranch === "main", `Expected base main, got ${preview.baseBranch}`);
    assert(preview.headBranch === "feature/pr", `Expected head feature/pr, got ${preview.headBranch}`);
    assert(typeof preview.head === "string" && preview.head.length > 0, "Preview did not expose a head SHA for concurrency.");
    const reviewedHead = preview.head;

    // 400: confirmation and token are required.
    const noConfirm = await postRaw(port, "/git/pr-publish", { taskID: task.id, expectedHead: reviewedHead, expectedHeadBranch: "feature/pr", headBranch: "feature/pr", baseBranch: "main", title: "T", body: "", githubToken: "t" });
    assert(noConfirm.status === 400, `Expected 400 without confirmation, got ${noConfirm.status}`);
    const noToken = await postRaw(port, "/git/pr-publish", { taskID: task.id, confirmation: "PublishPullRequest", expectedHead: reviewedHead, expectedHeadBranch: "feature/pr", headBranch: "feature/pr", baseBranch: "main", title: "T", body: "", githubToken: "" });
    assert(noToken.status === 400, `Expected 400 without token, got ${noToken.status}`);

    // 409: stale HEAD is rejected before any push or API call.
    const stale = await postRaw(port, "/git/pr-publish", { taskID: task.id, confirmation: "PublishPullRequest", expectedHead: "0000000000000000000000000000000000000000", expectedHeadBranch: "feature/pr", headBranch: "feature/pr", baseBranch: "main", title: "T", body: "", githubToken: "t" });
    assert(stale.status === 409, `Expected 409 for stale HEAD, got ${stale.status}: ${stale.text}`);
    assert(captured === null, "Stale-HEAD publish must not reach the GitHub API.");

    // Success.
    const result = await post(port, "/git/pr-publish", {
      taskID: task.id,
      confirmation: "PublishPullRequest",
      expectedHead: reviewedHead,
      expectedHeadBranch: "feature/pr",
      headBranch: "feature/pr",
      baseBranch: "main",
      title: "Add feature work",
      body: "This PR adds feature work.\n\nGenerated by Forge.",
      githubToken: "test-token-123",
      draft: false
    });
    assert(result.number === 42, `Expected PR #42, got ${result.number}`);
    assert(result.url === "https://github.com/acme/widgets/pull/42", `Unexpected PR url ${result.url}`);
    assert(result.owner === "acme" && result.repo === "widgets", `Unexpected owner/repo ${result.owner}/${result.repo}`);
    assert(result.headBranch === "feature/pr" && result.baseBranch === "main", "Result branches mismatch.");

    // The GitHub API received the right payload and auth (token not logged, but sent).
    assert(captured && captured.method === "POST", "Mock GitHub API did not receive a POST.");
    assert(captured.authorization === "Bearer test-token-123", `Authorization header wrong: ${captured.authorization}`);
    assert(captured.apiVersion === "2022-11-28", `Missing API version header: ${captured.apiVersion}`);
    assert(captured.body.head === "feature/pr" && captured.body.base === "main", "PR head/base payload wrong.");
    assert(captured.body.title === "Add feature work", "PR title payload wrong.");
    assert(captured.body.body.includes("feature work"), "PR body payload wrong.");

    // The head branch was actually pushed to the (local) remote.
    const remoteSha = (await git(["--git-dir", bare, "rev-parse", "feature/pr"], tempRoot)).trim();
    assert(remoteSha === headSha, `Feature branch not pushed to remote: ${remoteSha} != ${headSha}`);

    // The task recorded the approval and event.
    const list = await get(port, "/tasks");
    const after = (list.tasks ?? list).find((t) => t.id === task.id);
    assert(after, "Published task not found in task list.");
    assert(after.approvals?.some((a) => a.action === "Publish Pull Request"), "Task missing Publish Pull Request approval.");
    assert(after.events?.some((e) => e.type === "git.pull_request.published"), "Task missing pull_request.published event.");
    assert(result.relatedTask?.id === task.id, "PR result did not link the related task.");

    console.log("PR publish fixtures passed.");
    console.log("- Preview readiness, 400 (confirmation/token), 409 (stale HEAD, no API call)");
    console.log("- Real PR creation: payload, Bearer auth, owner/repo parsed from remote");
    console.log("- Head branch pushed to remote; task approval + event recorded");
  } finally {
    await stopRuntime(runtime);
  }
} finally {
  await new Promise((r) => mock.close(r));
  await rm(tempRoot, { recursive: true, force: true });
}

async function startRuntime(repoRoot, p, apiPort) {
  const runtime = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "dist/server.js"],
    {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        FORGE_RUNTIME_PORT: String(p),
        FORGE_REPO_ROOT: repoRoot,
        FORGE_RUNTIME_DB_PATH: join(tempRoot, `forge-${p}.sqlite`),
        FORGE_MODEL_PROVIDER_SETTINGS_PATH: join(tempRoot, `model-provider-${p}.json`),
        FORGE_MODEL_PROVIDER: "local",
        FORGE_GITHUB_API_BASE: `http://127.0.0.1:${apiPort}`
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

async function postRaw(p, path, body) {
  const response = await fetch(`http://127.0.0.1:${p}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, text };
}

function git(args, cwd = tempRoot) {
  return new Promise((resolveGit, rejectGit) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.on("error", rejectGit);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectGit(new Error(`git ${args.join(" ")} failed in ${cwd}\n${output}`));
        return;
      }
      resolveGit(output);
    });
  });
}
