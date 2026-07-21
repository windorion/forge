#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureID = `forge-repo-index-${process.pid}-${Date.now()}`;
const tempRoot = join(tmpdir(), fixtureID);
const port = 18700 + Math.floor(Math.random() * 600);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  await mkdir(tempRoot, { recursive: true });
  const repo = join(tempRoot, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "node_modules", "dep"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Repo\n\nHello.\n", "utf8");
  await writeFile(join(repo, "src", "a.ts"), "export const a = 1;\n", "utf8");
  await writeFile(join(repo, "src", "b.ts"), "export const b = 2;\n", "utf8");
  await writeFile(join(repo, "src", "app.swift"), "let x = 1\n", "utf8");
  // ignored: should never be indexed
  await writeFile(join(repo, "node_modules", "dep", "index.js"), "module.exports = {}\n", "utf8");

  const runtime = await startRuntime(repo, port);
  try {
    // initial status: empty
    const before = await get(port, "/index");
    assert(before.fileCount === 0 && before.inSync === false, `Expected empty index, got ${JSON.stringify(before)}`);

    // full build
    const built = await post(port, "/index/rebuild", {});
    assert(built.fileCount === 4, `Expected 4 indexed files (README + 3 src), got ${built.fileCount}`);
    assert(built.indexed === 4 && built.skipped === 0 && built.removed === 0, `Expected 4 indexed/0 skipped/0 removed, got ${JSON.stringify({ i: built.indexed, s: built.skipped, r: built.removed })}`);
    const langs = Object.fromEntries(built.languages.map((l) => [l.language, l.files]));
    assert(langs.TypeScript === 2 && langs.Swift === 1 && langs.Markdown === 1, `Unexpected language distribution: ${JSON.stringify(langs)}`);
    assert(built.inSync === true && built.lastIndexedAt, "Built index should be in sync with a timestamp");

    // node_modules must be excluded
    const paths = await get(port, "/index");
    assert(!JSON.stringify(paths).includes("node_modules"), "node_modules must not be indexed");

    // GET reflects the built state
    const after = await get(port, "/index");
    assert(after.fileCount === 4 && after.inSync === true, `Expected 4 in-sync files, got ${JSON.stringify(after)}`);

    // health carries a compact index summary
    const health = await get(port, "/health");
    assert(health.index && health.index.fileCount === 4 && health.index.inSync === true, `health.index wrong: ${JSON.stringify(health.index)}`);

    // incremental: no changes → all skipped
    const noop = await post(port, "/index/rebuild", {});
    assert(noop.indexed === 0 && noop.skipped === 4 && noop.removed === 0, `Expected all skipped, got ${JSON.stringify({ i: noop.indexed, s: noop.skipped, r: noop.removed })}`);

    // change one file + add one + delete one → 1 changed + 1 added indexed, 1 removed
    await writeFile(join(repo, "src", "a.ts"), "export const a = 999;\n// changed\n", "utf8");
    await writeFile(join(repo, "src", "c.go"), "package main\n", "utf8");
    await unlink(join(repo, "src", "b.ts"));
    const incremental = await post(port, "/index/rebuild", {});
    assert(incremental.indexed === 2, `Expected 2 indexed (changed + added), got ${incremental.indexed}`);
    assert(incremental.removed === 1, `Expected 1 removed (deleted b.ts), got ${incremental.removed}`);
    assert(incremental.fileCount === 4, `Expected 4 files after churn, got ${incremental.fileCount}`);
    const langs2 = Object.fromEntries(incremental.languages.map((l) => [l.language, l.files]));
    assert(langs2.Go === 1 && langs2.TypeScript === 1, `Expected Go=1, TS=1 after churn, got ${JSON.stringify(langs2)}`);

    // persistence: restart runtime, index survives without rebuild
    await stopRuntime(runtime);
    const runtime2 = await startRuntime(repo, port);
    try {
      const restored = await get(port, "/index");
      assert(restored.fileCount === 4 && restored.inSync === true, `Index should survive restart, got ${JSON.stringify(restored)}`);
    } finally {
      await stopRuntime(runtime2);
    }
  } finally {
    if (runtime.exitCode === null) {
      await stopRuntime(runtime);
    }
  }
  console.log("Repo index fixtures passed.");
  console.log("- Full build, ignore filtering, language distribution");
  console.log("- Incremental: unchanged skipped, changed/added reindexed, deleted removed");
  console.log("- Health summary and restart persistence");
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
        FORGE_RUNTIME_DB_PATH: join(tempRoot, `forge-${p}.sqlite`),
        FORGE_MODEL_PROVIDER_SETTINGS_PATH: join(tempRoot, `model-provider-${p}.json`),
        FORGE_MODEL_PROVIDER: "local"
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

async function get(p, urlPath) {
  const response = await fetch(`http://127.0.0.1:${p}${urlPath}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${urlPath} failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function post(p, urlPath, body) {
  const response = await fetch(`http://127.0.0.1:${p}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${urlPath} failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}
