#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  RELIABILITY_STAGE_IDS,
  buildReliabilityCampaignReport,
  renderReliabilityCampaignMarkdown
} from "../dist/reliabilityCampaign.js";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectRoot = resolve(runtimeRoot, "..");
const campaignStartedAt = Date.now();
const tempRoot = join(tmpdir(), `forge-reliability-${process.pid}-${campaignStartedAt}`);
const writeBaseline = process.argv.includes("--write-baseline");
const keepFixtures = process.argv.includes("--keep-fixtures");
const outputDirectory = writeBaseline ? join(projectRoot, "docs", "reliability") : join(tempRoot, "reports");

class StageFailure extends Error {
  constructor(stageID, message) {
    super(message);
    this.stageID = stageID;
  }
}

const cases = [
  {
    id: "typescript-bugfix",
    title: "TypeScript arithmetic bugfix",
    category: "code-bugfix",
    language: "TypeScript",
    expectedOutcome: "Applied",
    targetPath: "src/calculator.ts",
    operationKind: "ReplaceText",
    files: {
      "README.md": "# TypeScript calculator fixture\n",
      "src/calculator.ts": [
        "export function add(left: number, right: number): number {",
        "  return left - right;",
        "}",
        ""
      ].join("\n"),
      "src/calculator.test.ts": [
        "import { strict as assert } from \"node:assert\";",
        "import { add } from \"./calculator.js\";",
        "assert.equal(add(2, 3), 5);",
        ""
      ].join("\n")
    },
    objective: "Fix the arithmetic defect in @src/calculator.ts with a bounded reviewed edit.",
    instruction: "Use @src/calculator.ts and replace \"return left - right;\" with \"return left + right;\".",
    oracle: (content) => content.includes("return left + right;") && !content.includes("return left - right;")
  },
  {
    id: "python-refactor",
    title: "Python two-hunk normalization refactor",
    category: "code-refactor",
    language: "Python",
    expectedOutcome: "Applied",
    targetPath: "src/slugify.py",
    operationKind: "PatchText",
    files: {
      "README.md": "# Python slug fixture\n",
      "src/slugify.py": [
        "def slugify(text: str) -> str:",
        "    value = text.strip()",
        "    return value.replace(\" \", \"_\")",
        ""
      ].join("\n"),
      "tests/test_slugify.py": [
        "from src.slugify import slugify",
        "",
        "def test_slugify():",
        "    assert slugify(\" Hello Forge \") == \"hello-forge\"",
        ""
      ].join("\n")
    },
    objective: "Refactor @src/slugify.py so normalization matches the repository test intent.",
    instruction: [
      "Use @src/slugify.py.",
      "Replace \"value = text.strip()\" with \"value = text.strip().lower()\".",
      "Replace \"return value.replace(\\\" \\\", \\\"_\\\")\" with \"return value.replace(\\\" \\\", \\\"-\\\")\"."
    ].join(" "),
    oracle: (content) => content.includes("text.strip().lower()") && content.includes("replace(\" \", \"-\")")
  },
  {
    id: "documentation-append",
    title: "Documentation append",
    category: "documentation",
    language: "Markdown",
    expectedOutcome: "Applied",
    targetPath: "docs/usage.md",
    operationKind: "AppendText",
    files: {
      "README.md": "# Documentation fixture\n",
      "docs/usage.md": "# Usage\n\nRun the fixture locally.\n"
    },
    objective: "Add a bounded implementation record to @docs/usage.md.",
    instruction: "Use @docs/usage.md and add a small append-only implementation note for this reliability task.",
    oracle: (content) => content.startsWith("# Usage\n") && content.includes("## Forge Implementation Note")
  },
  {
    id: "ambiguous-replacement-guard",
    title: "Ambiguous replacement safety guard",
    category: "negative-control",
    language: "TypeScript",
    expectedOutcome: "Guarded",
    targetPath: "src/repeated.ts",
    operationKind: "ReplaceText",
    files: {
      "README.md": "# Ambiguous replacement fixture\n",
      "src/repeated.ts": [
        "export const first = \"OLD_MARKER\";",
        "export const second = \"OLD_MARKER\";",
        ""
      ].join("\n")
    },
    objective: "Exercise the safe-edit ambiguity boundary in @src/repeated.ts.",
    instruction: "Use @src/repeated.ts and replace \"OLD_MARKER\" with \"NEW_MARKER\".",
    oracle: (content) => content.match(/OLD_MARKER/g)?.length === 2 && !content.includes("NEW_MARKER")
  }
];

await mkdir(tempRoot, { recursive: true });
const results = [];
try {
  for (let index = 0; index < cases.length; index += 1) {
    const definition = cases[index];
    process.stdout.write(`[reliability] ${index + 1}/${cases.length} ${definition.id} ... `);
    const result = await runCase(definition, index);
    results.push(result);
    console.log(result.status);
  }

  const report = buildReliabilityCampaignReport(results, {
    durationMs: Date.now() - campaignStartedAt,
    runtimeProvider: "local-deterministic"
  });
  await mkdir(outputDirectory, { recursive: true });
  const jsonPath = join(outputDirectory, "alpha-repository-baseline.json");
  const markdownPath = join(outputDirectory, "alpha-repository-baseline.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderReliabilityCampaignMarkdown(report), "utf8");

  console.log(`\nReliability campaign ${report.status.toLowerCase()}: ${report.passedCount} applied, ${report.guardedCount} guarded, ${report.failedCount} failed.`);
  console.log(`Stage pass rate: ${(report.stagePassRate * 100).toFixed(1)}%.`);
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
  if (report.status !== "Passed") process.exitCode = 1;
} finally {
  if (!keepFixtures && !writeBaseline) await rm(tempRoot, { recursive: true, force: true });
  if (!keepFixtures && writeBaseline) {
    for (const definition of cases) {
      await rm(join(tempRoot, definition.id), { recursive: true, force: true });
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function runCase(definition, index) {
  const startedAt = Date.now();
  const caseRoot = join(tempRoot, definition.id);
  const repoRoot = join(caseRoot, "repo");
  const stages = [];
  let runtime;
  let task;
  let operationKind;
  let changedFiles = [];
  let clarificationDisposition = "not-needed";
  let failureStage;
  let failure;

  const runStage = async (id, action, summary) => {
    const stageStartedAt = Date.now();
    try {
      const value = await action();
      const details = typeof summary === "function" ? summary(value) : summary;
      stages.push({
        id,
        status: "Passed",
        durationMs: Date.now() - stageStartedAt,
        summary: details?.summary ?? details ?? `${id} passed.`,
        evidence: details?.evidence
      });
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stages.push({ id, status: "Failed", durationMs: Date.now() - stageStartedAt, summary: message });
      throw new StageFailure(id, message);
    }
  };

  try {
    await runStage("fixture", async () => {
      await createFixtureRepository(repoRoot, definition.files);
      return Object.keys(definition.files).length;
    }, (fileCount) => ({ summary: `Initialized isolated Git repository with ${fileCount} tracked files.` }));

    runtime = await runStage("runtime", () => startRuntime(caseRoot, repoRoot, index), (handle) => ({
      summary: "Started an isolated runtime with local provider, database, settings, and queue state.",
      evidence: ["workspace=isolated-git-repository", "provider=local-deterministic"]
    }));

    await runStage("index", async () => {
      const indexResult = await runtime.post("/index/rebuild", {});
      assert(indexResult.indexed + indexResult.skipped >= Object.keys(definition.files).length, "Repository index omitted fixture files.");
      return indexResult;
    }, (indexResult) => ({ summary: `Indexed ${indexResult.indexed} changed and ${indexResult.skipped} unchanged files.` }));

    task = await runStage("intake", async () => {
      const created = await runtime.post("/tasks", { title: definition.title, objective: definition.objective });
      assert(created.id, "Task creation returned no id.");
      let current = await runtime.waitForTask(created.id, (candidate) =>
        candidate.status === "Human Review" && ["Clarification", "Plan Review"].includes(candidate.currentPhase)
      , "initial human-review gate");
      if (current.currentPhase === "Clarification") {
        clarificationDisposition = "resolved";
        current = await runtime.post(`/tasks/${created.id}/messages`, {
          content: `Done means the requested change in @${definition.targetPath} is applied through review, the repository contains only that expected change, and the external campaign oracle passes.`
        });
        current = await runtime.waitForTask(created.id, (candidate) =>
          candidate.status === "Human Review" && candidate.currentPhase === "Plan Review" && candidate.planRevisions.length > 0
        , "plan review after clarification");
      }
      return current;
    }, (current) => ({
      summary: "Task intake reached human plan review with persisted planning evidence.",
      evidence: [
        `planRevisions=${current.planRevisions.length}`,
        `clarification=${clarificationDisposition}`
      ]
    }));

    task = await runStage("plan", async () => {
      const messaged = await runtime.post(`/tasks/${task.id}/messages`, { content: definition.instruction });
      const reference = messaged.messages
        .filter((message) => message.role === "User")
        .flatMap((message) => message.fileReferences ?? [])
        .find((candidate) => candidate.path === definition.targetPath);
      assert(reference?.status === "Resolved", `Task did not resolve @${definition.targetPath}.`);
      const planned = await runtime.post(`/tasks/${task.id}/generate-plan-revision`, {});
      assert(planned.currentPhase === "Plan Review", `Expected Plan Review, got ${planned.currentPhase}.`);
      assert(planned.planRevisions.at(-1)?.validationPlan?.length > 0, "Plan omitted validation evidence.");
      return planned;
    }, (current) => ({ summary: `Generated plan revision ${current.planRevisions.length} from a resolved file reference.` }));

    task = await runStage("approval", async () => {
      const approved = await runtime.post(`/tasks/${task.id}/approve-plan`, { note: "Reliability campaign approves this isolated fixture plan." });
      assert(approved.executionProposal, "Plan approval did not create an execution proposal.");
      assert(approved.approvals.some((approval) => approval.action === "Approve Plan"), "Plan approval evidence was not persisted.");
      return approved;
    }, () => ({ summary: "Approved the plan and retained a human approval plus execution proposal." }));

    task = await runStage("proposal", async () => {
      const proposed = await runtime.post(`/tasks/${task.id}/generate-edit-proposal`, {});
      const change = proposed.editProposal?.fileChanges?.[0];
      assert(proposed.editProposal?.status === "Proposed", "No proposed edit was returned.");
      assert(proposed.editProposal.fileChanges.length === 1, "Campaign case must remain a one-file bounded edit.");
      assert(change.path === definition.targetPath, `Proposal targeted ${change.path} instead of ${definition.targetPath}.`);
      operationKind = change.applyOperation?.kind;
      assert(operationKind === definition.operationKind, `Expected ${definition.operationKind}, got ${operationKind}.`);
      return proposed;
    }, (current) => ({
      summary: `Generated a bounded ${operationKind} proposal for ${definition.targetPath}.`,
      evidence: [`revision=${current.editProposal.revisionNumber}`, `repairAttempts=${current.editProposal.revisionNumber - 1}`]
    }));

    task = await runStage("proposal-validation", async () => {
      const validated = await runtime.post(`/tasks/${task.id}/validate-edit-proposal`, {});
      const status = validated.editProposal?.validation?.status;
      const expected = definition.expectedOutcome === "Guarded" ? "Blocked" : "Ready";
      assert(status === expected, `Expected proposal validation ${expected}, got ${status}.`);
      return validated;
    }, (current) => ({
      summary: definition.expectedOutcome === "Guarded"
        ? "Runtime correctly blocked the ambiguous replacement after bounded repair attempts."
        : "Runtime validated the proposed operation as apply-ready.",
      evidence: [current.editProposal.validation.summary]
    }));

    if (definition.expectedOutcome === "Guarded") {
      stages.push({ id: "file-review", status: "Skipped", durationMs: 0, summary: "Unsafe proposal was not offered for approval." });
      stages.push({ id: "apply", status: "Skipped", durationMs: 0, summary: "Blocked proposal was not applied." });
    } else {
      task = await runStage("file-review", async () => {
        let reviewed = task;
        for (const change of reviewed.editProposal.fileChanges) {
          reviewed = await runtime.post(`/tasks/${task.id}/review-edit-proposal-file`, {
            fileChangeID: change.id,
            decision: "Approved",
            note: `Reliability campaign approves ${change.path}.`
          });
        }
        assert(reviewed.editProposal.fileDecisions?.length === reviewed.editProposal.fileChanges.length, "File review evidence is incomplete.");
        return reviewed;
      }, () => ({ summary: "Approved every proposed file individually before mutation." }));

      task = await runStage("apply", async () => {
        const applied = await runtime.post(`/tasks/${task.id}/apply-edit-proposal`, { note: "Apply the reviewed isolated reliability fixture." });
        assert(applied.status === "Completed", `Expected Completed, got ${applied.status}.`);
        assert(applied.editProposal?.status === "Applied", "Edit proposal was not marked Applied.");
        assert(applied.validationRuns.some((run) => run.presetID === "forge-post-apply" && run.status === "Passed"), "Built-in post-apply validation did not pass.");
        return applied;
      }, () => ({ summary: "Applied the reviewed edit and passed built-in post-apply validation." }));
    }

    await runStage("git-evidence", async () => {
      const status = await runtime.get("/git/status");
      assert(status.isRepository, "Runtime did not recognize the isolated Git repository.");
      changedFiles = status.changedFiles.map((change) => change.path).sort();
      const expected = definition.expectedOutcome === "Guarded" ? [] : [definition.targetPath];
      assert(JSON.stringify(changedFiles) === JSON.stringify(expected), `Expected Git changes ${JSON.stringify(expected)}, got ${JSON.stringify(changedFiles)}.`);
      return status;
    }, (status) => ({ summary: status.summary, evidence: status.changedFiles.map((change) => `${change.status}:${change.path}`) }));

    await runStage("oracle", async () => {
      const content = await readFile(join(repoRoot, definition.targetPath), "utf8");
      assert(definition.oracle(content), `External content oracle failed for ${definition.targetPath}.`);
      return content;
    }, () => ({ summary: `External content oracle verified ${definition.targetPath}.` }));

    await runStage("audit-export", async () => {
      const [jsonExport, markdownExport] = await Promise.all([
        runtime.get(`/tasks/${task.id}/audit-export?format=json`),
        runtime.get(`/tasks/${task.id}/audit-export?format=markdown`)
      ]);
      const audit = JSON.parse(jsonExport.content);
      assert(audit.task.id === task.id, "JSON audit export returned the wrong task.");
      assert(audit.approvals.some((approval) => approval.action === "Approve Plan"), "JSON audit omitted plan approval.");
      assert(markdownExport.content.includes(definition.title), "Markdown audit omitted the task title.");
      assert(markdownExport.content.includes("## Event Timeline"), "Markdown audit omitted the event timeline.");
      return { jsonExport, markdownExport };
    }, ({ jsonExport, markdownExport }) => ({
      summary: "Exported parseable JSON and readable Markdown audit artifacts.",
      evidence: ["jsonSchemaVersion=1", "markdownEventTimeline=true"]
    }));
  } catch (error) {
    failureStage = error instanceof StageFailure ? error.stageID : undefined;
    failure = compactFailure(error instanceof Error ? error.message : String(error));
  } finally {
    await stopRuntime(runtime);
  }

  const presentStages = new Set(stages.map((stage) => stage.id));
  for (const id of RELIABILITY_STAGE_IDS) {
    if (!presentStages.has(id)) {
      stages.push({ id, status: "Skipped", durationMs: 0, summary: "Skipped after an earlier unexpected failure." });
    }
  }
  stages.sort((left, right) => RELIABILITY_STAGE_IDS.indexOf(left.id) - RELIABILITY_STAGE_IDS.indexOf(right.id));

  return {
    id: definition.id,
    title: definition.title,
    category: definition.category,
    language: definition.language,
    expectedOutcome: definition.expectedOutcome,
    status: failure ? "Failed" : definition.expectedOutcome === "Guarded" ? "Guarded" : "Passed",
    durationMs: Date.now() - startedAt,
    operationKind,
    changedFiles,
    failureStage,
    failure,
    stages
  };
}

async function createFixtureRepository(repoRoot, files) {
  await mkdir(repoRoot, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(repoRoot, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  runGit(["init", "--quiet"], repoRoot);
  runGit(["add", "."], repoRoot);
  runGit(["-c", "user.name=Forge Reliability", "-c", "user.email=forge-reliability@example.invalid", "commit", "--quiet", "-m", "Initial fixture"], repoRoot);
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
}

async function startRuntime(caseRoot, repoRoot, index) {
  const port = 19600 + ((process.pid + index * 37) % 700);
  const baseURL = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_REPO_ROOT: repoRoot,
      FORGE_RUNTIME_DB_PATH: join(caseRoot, "forge.sqlite"),
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: join(caseRoot, "model-provider.json"),
      FORGE_TASK_QUEUE_SETTINGS_PATH: join(caseRoot, "task-queue.json"),
      FORGE_MODEL_PROVIDER: "local",
      FORGE_MODEL_NAME: "local-deterministic-reliability",
      FORGE_STUCK_SWEEP_INTERVAL_MS: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  let exited = false;
  child.stdout.on("data", (chunk) => { output = boundedOutput(output, chunk); });
  child.stderr.on("data", (chunk) => { output = boundedOutput(output, chunk); });
  child.on("exit", () => { exited = true; });

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
    port,
    get output() { return output; },
    get exited() { return exited; },
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    async waitForTask(taskID, predicate, label, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      let lastTask;
      while (Date.now() < deadline) {
        const response = await request("GET", "/tasks");
        lastTask = response.tasks.find((candidate) => candidate.id === taskID);
        if (lastTask && predicate(lastTask)) return lastTask;
        await sleep(100);
      }
      throw new Error(`Timed out waiting for ${label}. Last task: ${JSON.stringify(summarizeTask(lastTask))}`);
    }
  };

  const deadline = Date.now() + 10_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Runtime exited before health check.\n${output}`);
    try {
      const health = await handle.get("/health");
      if (health.ok && health.workspace?.repoRoot === repoRoot) return handle;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  await stopRuntime(handle);
  throw new Error(`Runtime health timed out: ${lastError}\n${output}`);
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function summarizeTask(task) {
  if (!task) return undefined;
  return {
    id: task.id,
    status: task.status,
    currentPhase: task.currentPhase,
    planRevisions: task.planRevisions?.length ?? 0,
    lastEvent: task.events?.at(-1)?.type,
    openQuestions: task.messages?.at(-1)?.intentBrief?.openQuestions ?? []
  };
}

function compactFailure(message) {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 900 ? `${normalized.slice(0, 897)}...` : normalized;
}
