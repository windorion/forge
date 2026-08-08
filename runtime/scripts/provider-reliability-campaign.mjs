#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROVIDER_RELIABILITY_STAGE_IDS,
  buildProviderReliabilityCampaignReport,
  renderProviderReliabilityCampaignMarkdown
} from "../dist/providerReliabilityCampaign.js";
import {
  createFixtureRepository,
  startMockOpenAI,
  startProviderRuntime
} from "./lib/provider-campaign-harness.mjs";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectRoot = resolve(runtimeRoot, "..");
const campaignStartedAt = Date.now();
const tempRoot = join(tmpdir(), `forge-provider-reliability-${process.pid}-${campaignStartedAt}`);
const writeBaseline = process.argv.includes("--write-baseline");
const keepFixtures = process.argv.includes("--keep-fixtures");
const outputDirectory = writeBaseline ? join(projectRoot, "docs", "reliability") : join(tempRoot, "reports");

class StageFailure extends Error {
  constructor(stageID, message) {
    super(message);
    this.stageID = stageID;
  }
}

const miniRuntimeFiles = {
  "runtime/package.json": `${JSON.stringify({
    name: "forge-provider-reliability-fixture",
    private: true,
    type: "module",
    scripts: {
      check: "node scripts/check.mjs",
      build: "node scripts/check.mjs"
    }
  }, null, 2)}\n`,
  "runtime/tsconfig.json": `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      outDir: "dist",
      rootDir: "src"
    },
    include: ["src/**/*.ts"]
  }, null, 2)}\n`,
  "runtime/scripts/check.mjs": [
    "import { readFile, readdir } from \"node:fs/promises\";",
    "import { join } from \"node:path\";",
    "",
    "const sourceRoot = new URL(\"../src/\", import.meta.url);",
    "const sourceFiles = (await readdir(sourceRoot)).filter((name) => name.endsWith(\".ts\"));",
    "for (const sourceFile of sourceFiles) {",
    "  const content = await readFile(new URL(sourceFile, sourceRoot), \"utf8\");",
    "  if (/=\\s*;/.test(content)) {",
    "    console.error(`${join(\"runtime/src\", sourceFile)}: incomplete assignment expression`);",
    "    process.exitCode = 2;",
    "  }",
    "}",
    "if (!process.exitCode) console.log(`checked ${sourceFiles.length} TypeScript fixture file(s)`);",
    ""
  ].join("\n")
};

const cases = [
  {
    id: "openai-context-unified-diff",
    title: "OpenAI context-guided two-file Unified Diff",
    category: "provider-edit",
    expectedOutcome: "Applied",
    contextPaths: ["src/greeting.ts", "src/greeting.test.ts"],
    files: {
      "README.md": "# Greeting provider fixture\n",
      "src/greeting.ts": [
        "export function greet(name: string): string {",
        "  return `hello, ${name}`;",
        "}",
        ""
      ].join("\n"),
      "src/greeting.test.ts": "export const expectedGreeting = \"hello, Forge\";\n"
    },
    objective: "Update @src/greeting.ts and @src/greeting.test.ts with a reviewed context-aware greeting implementation and verify the result.",
    initialProposal: () => {
      const sourcePatch = [
        "--- a/src/greeting.ts",
        "+++ b/src/greeting.ts",
        "@@ -1,3 +1,4 @@",
        " export function greet(name: string): string {",
        "-  return `hello, ${name}`;",
        "+  const label = name.trim();",
        "+  return `Hello, ${label}!`;",
        " }"
      ].join("\n");
      const testPatch = [
        "--- a/src/greeting.test.ts",
        "+++ b/src/greeting.test.ts",
        "@@ -1 +1 @@",
        "-export const expectedGreeting = \"hello, Forge\";",
        "+export const expectedGreeting = \"Hello, Forge!\";"
      ].join("\n");
      return editProposal("Apply two context-anchored greeting changes.", [
        unifiedDiffChange("src/greeting.ts", sourcePatch, "Normalize the input and return the reviewed greeting."),
        unifiedDiffChange("src/greeting.test.ts", testPatch, "Keep the fixture expectation aligned with the implementation.")
      ]);
    },
    expectedChangedFiles: ["src/greeting.test.ts", "src/greeting.ts"],
    oracle: async (repoRoot) => {
      const source = await readFile(join(repoRoot, "src/greeting.ts"), "utf8");
      const test = await readFile(join(repoRoot, "src/greeting.test.ts"), "utf8");
      return source.includes("const label = name.trim();") && source.includes("`Hello, ${label}!`") && test.includes("Hello, Forge!");
    }
  },
  {
    id: "openai-approved-command-pass",
    title: "OpenAI-selected approved project command",
    category: "provider-command",
    expectedOutcome: "CommandPassed",
    contextPaths: ["runtime/src/math.ts", "runtime/tsconfig.json"],
    files: {
      "README.md": "# Approved command provider fixture\n",
      ...miniRuntimeFiles,
      "runtime/src/math.ts": [
        "export function add(left: number, right: number): number {",
        "  return left - right;",
        "}",
        ""
      ].join("\n")
    },
    objective: "Fix @runtime/src/math.ts, review the diff, then run the approved runtime TypeScript check to verify it.",
    initialProposal: () => {
      const patch = [
        "--- a/runtime/src/math.ts",
        "+++ b/runtime/src/math.ts",
        "@@ -1,3 +1,3 @@",
        " export function add(left: number, right: number): number {",
        "-  return left - right;",
        "+  return left + right;",
        " }"
      ].join("\n");
      return editProposal("Fix arithmetic before the approved project check.", [
        unifiedDiffChange("runtime/src/math.ts", patch, "Correct the implementation through a reviewable Unified Diff.")
      ]);
    },
    agentStep: () => agentDecision("RunTaskCommand", {
      summary: "Run the already-approved runtime TypeScript check.",
      rationale: "The reviewed fix is applied and runtime-npm-check is currently runnable.",
      commandID: "runtime-npm-check"
    }),
    expectedChangedFiles: ["runtime/src/math.ts"],
    oracle: async (repoRoot) => {
      const source = await readFile(join(repoRoot, "runtime/src/math.ts"), "utf8");
      return source.includes("return left + right;");
    }
  },
  {
    id: "openai-unapproved-command-guard",
    title: "OpenAI unapproved command safety guard",
    category: "provider-negative-control",
    expectedOutcome: "Guarded",
    guardUnapprovedCommand: true,
    contextPaths: ["runtime/src/guard.ts", "runtime/tsconfig.json"],
    files: {
      "README.md": "# Unapproved command provider fixture\n",
      ...miniRuntimeFiles,
      "runtime/src/guard.ts": "export const commandGuard = false;\n"
    },
    objective: "Prepare a reviewed change for @runtime/src/guard.ts but do not approve or execute any project command while the proposal awaits review.",
    initialProposal: () => {
      const patch = [
        "--- a/runtime/src/guard.ts",
        "+++ b/runtime/src/guard.ts",
        "@@ -1 +1 @@",
        "-export const commandGuard = false;",
        "+export const commandGuard = true;"
      ].join("\n");
      return editProposal("Keep a valid edit waiting at the human review boundary.", [
        unifiedDiffChange("runtime/src/guard.ts", patch, "Exercise command rejection while an unapplied proposal is pending.")
      ]);
    },
    agentStep: () => agentDecision("RunTaskCommand", {
      summary: "Attempt to run an unapproved project command.",
      rationale: "The negative-control provider intentionally selects a command that is not runnable.",
      commandID: "runtime-npm-check"
    }),
    expectedChangedFiles: [],
    oracle: async (repoRoot) => {
      const source = await readFile(join(repoRoot, "runtime/src/guard.ts"), "utf8");
      return source === "export const commandGuard = false;\n";
    }
  },
  {
    id: "openai-command-self-repair",
    title: "OpenAI command failure, reviewed repair, and rerun",
    category: "provider-recovery",
    expectedOutcome: "RepairVerified",
    contextPaths: ["runtime/src/broken.ts", "runtime/tsconfig.json"],
    files: {
      "README.md": "# Command repair provider fixture\n",
      ...miniRuntimeFiles,
      "runtime/src/broken.ts": "export const repairedValue: string = ;\n"
    },
    objective: "Diagnose the failing approved TypeScript check caused by @runtime/src/broken.ts, propose a reviewed self-fix, and verify the linked rerun.",
    agentStep: (entry) => {
      const prompt = providerPrompt(entry.body);
      const evidenceID = prompt.match(/"commandRerunEvidence"\s*:\s*\[\s*\{\s*"id"\s*:\s*"([^"]+)"/)?.[1];
      return evidenceID
        ? agentDecision("RerunRepairCommand", {
            summary: "Rerun the original approved command using stored repair evidence.",
            rationale: "The reviewed self-fix has been applied and the runtime exposed one runnable evidence id.",
            commandRerunEvidenceID: evidenceID
          })
        : agentDecision("RunTaskCommand", {
            summary: "Run the approved TypeScript check to capture the current failure.",
            rationale: "The runtime marks runtime-npm-check runnable after explicit preset approval.",
            commandID: "runtime-npm-check"
          });
    },
    repairBrief: () => ({
      summary: "The approved TypeScript check failed on the incomplete assignment in runtime/src/broken.ts.",
      likelyCause: "The repository check reports an incomplete assignment expression.",
      recommendedActions: [
        "Propose a narrow reviewed change for runtime/src/broken.ts.",
        "Apply only after per-file approval.",
        "Rerun the original runtime-npm-check through stored evidence."
      ],
      followUpPrompt: "Replace the incomplete assignment with a valid fixed string and rerun the original approved command.",
      riskLevel: "Medium"
    }),
    repairProposal: () => {
      const patch = [
        "--- a/runtime/src/broken.ts",
        "+++ b/runtime/src/broken.ts",
        "@@ -1 +1 @@",
        "-export const repairedValue: string = ;",
        "+export const repairedValue: string = \"fixed\";"
      ].join("\n");
      return editProposal("Repair the compiler error from the failed approved command.", [
        unifiedDiffChange("runtime/src/broken.ts", patch, "Use the repair brief to fix exactly the compiler-reported line.")
      ]);
    },
    expectedChangedFiles: ["runtime/src/broken.ts"],
    oracle: async (repoRoot) => {
      const source = await readFile(join(repoRoot, "runtime/src/broken.ts"), "utf8");
      return source === "export const repairedValue: string = \"fixed\";\n";
    }
  }
];

await mkdir(tempRoot, { recursive: true });
const results = [];
try {
  for (let index = 0; index < cases.length; index += 1) {
    const definition = cases[index];
    process.stdout.write(`[provider-reliability] ${index + 1}/${cases.length} ${definition.id} ... `);
    const result = await runCase(definition, index);
    results.push(result);
    console.log(result.status);
  }

  const report = buildProviderReliabilityCampaignReport(results, { durationMs: Date.now() - campaignStartedAt });
  await mkdir(outputDirectory, { recursive: true });
  const jsonPath = join(outputDirectory, "alpha-provider-baseline.json");
  const markdownPath = join(outputDirectory, "alpha-provider-baseline.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderProviderReliabilityCampaignMarkdown(report), "utf8");
  console.log(`\nProvider reliability campaign ${report.status.toLowerCase()}: ${report.passedCount} passed, ${report.guardedCount} guarded, ${report.failedCount} failed.`);
  console.log(`Provider requests: ${report.providerRequestCount}; scored-stage pass rate: ${(report.stagePassRate * 100).toFixed(1)}%.`);
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
  if (report.status !== "Passed") process.exitCode = 1;
} finally {
  if (!keepFixtures) await rm(tempRoot, { recursive: true, force: true });
}

async function runCase(definition, index) {
  const startedAt = Date.now();
  const caseRoot = join(tempRoot, definition.id);
  const repoRoot = join(caseRoot, "repo");
  const stages = [];
  let mockProvider;
  let runtime;
  let task;
  let operationKinds = [];
  let changedFiles = [];
  let commandStatuses = [];
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

  const skip = (id, summary) => stages.push({ id, status: "Skipped", durationMs: 0, summary });

  try {
    await runStage("fixture", () => createFixtureRepository(repoRoot, definition.files), {
      summary: `Initialized an isolated committed repository with ${Object.keys(definition.files).length} files.`
    });

    const basePort = 20500 + ((process.pid + index * 73) % 700);
    mockProvider = await runStage("mock-provider", () => startMockOpenAI({
      port: basePort,
      responder: createScenarioResponder(definition)
    }), { summary: "Started a loopback OpenAI Responses-compatible strict-schema mock." });

    runtime = await runStage("runtime", () => startProviderRuntime({
      runtimeRoot,
      caseRoot,
      repoRoot,
      port: basePort + 1,
      openAIBaseURL: mockProvider.baseURL
    }), {
      summary: "Started an isolated runtime configured for the remote OpenAI provider boundary.",
      evidence: ["provider=openai", "remoteEndpoint=loopback-mock", "apiCost=0"]
    });

    await runStage("index", async () => {
      const result = await runtime.post("/index/rebuild", {});
      assert(result.indexed + result.skipped >= Object.keys(definition.files).length, "Repository index omitted fixture files.");
      return result;
    }, (result) => ({ summary: `Indexed ${result.indexed} changed and ${result.skipped} unchanged files.` }));

    task = await runStage("intake", async () => {
      const created = await runtime.post("/tasks", { title: definition.title, objective: definition.objective });
      let current = await runtime.waitForTask(created.id, (candidate) =>
        candidate.status === "Human Review" && candidate.currentPhase === "Plan Review" && candidate.planRevisions.length > 0
      , "OpenAI plan review");
      current = await runtime.post(`/tasks/${created.id}/messages`, {
        content: `Revise the plan using the named context in ${definition.contextPaths.map((path) => `@${path}`).join(" and ")}; done means the reviewed result and approved validation evidence both pass.`
      });
      current = await runtime.post(`/tasks/${created.id}/generate-plan-revision`, {});
      assert(current.currentPhase === "Plan Review" && current.planRevisions.length >= 2, "Explicit provider-guided plan revision did not return to Plan Review.");
      return current;
    }, (current) => ({
      summary: "OpenAI intent, provider-guided context loop, and revised plan reached human review.",
      evidence: [`planProvider=${current.planRevisions.at(-1).provider.id}`, `planRevisions=${current.planRevisions.length}`]
    }));

    await runStage("provider-contract", async () => {
      assert(mockProvider.requests.length >= 5, `Expected at least 5 provider requests, got ${mockProvider.requests.length}.`);
      assert(mockProvider.requests.every((request) => request.authorization === "Bearer provider-reliability-secret"), "Provider request lost Bearer authentication.");
      assert(mockProvider.requests.every((request) => request.body.store === false), "Provider request did not disable response storage.");
      assert(mockProvider.requests.every((request) => request.body.text?.format?.strict === true), "Provider request did not use strict JSON schema output.");
      const names = providerRequestNames(mockProvider.requests);
      for (const required of ["forge_intent_brief", "forge_plan_context_request", "forge_plan_revision"]) {
        assert(names[required] > 0, `Provider contract omitted ${required}.`);
      }
      return names;
    }, (names) => ({
      summary: "Verified Bearer auth, store=false, strict schemas, and required planning calls.",
      evidence: Object.entries(names).map(([name, count]) => `${name}=${count}`)
    }));

    await runStage("context-evidence", async () => {
      for (const path of definition.contextPaths) {
        assert(task.contextFiles.some((file) => file.path === path), `Task context omitted provider-requested path ${path}.`);
      }
      assert(task.toolCalls.some((call) => call.name === "search_repo_context" && call.status === "Completed"), "Context loop did not persist search tool evidence.");
      assert(task.toolCalls.some((call) => call.name === "read_context_file" && call.status === "Completed"), "Context loop did not persist read tool evidence.");
      return task.contextFiles;
    }, (files) => ({
      summary: "Runtime mediated the provider's read-only context request and persisted tool evidence.",
      evidence: files.map((file) => file.path)
    }));

    task = await runStage("plan-approval", async () => {
      const approved = await runtime.post(`/tasks/${task.id}/approve-plan`, { note: "Provider reliability campaign approves the reviewed plan." });
      assert(approved.executionProposal?.provider?.id === "openai", "Execution proposal did not come from OpenAI provider boundary.");
      assert(approved.approvals.some((approval) => approval.action === "Approve Plan"), "Plan approval evidence was not persisted.");
      return approved;
    }, (current) => ({
      summary: "Approved the OpenAI-authored plan and prepared a context-backed execution proposal.",
      evidence: [`executionContextFiles=${current.executionProposal.contextFiles?.length ?? 0}`]
    }));

    if (definition.initialProposal) {
      task = await runStage("proposal", async () => {
        const proposed = await runtime.post(`/tasks/${task.id}/generate-edit-proposal`, {});
        assert(proposed.editProposal?.status === "Proposed", "OpenAI edit proposal was not persisted.");
        operationKinds = proposed.editProposal.fileChanges.map((change) => change.applyOperation?.kind ?? "Unknown");
        assert(operationKinds.every((kind) => kind === "UnifiedDiff"), `Expected only UnifiedDiff operations, got ${operationKinds.join(", ")}.`);
        return proposed;
      }, (current) => ({
        summary: `Generated ${current.editProposal.fileChanges.length} OpenAI Unified Diff change(s).`,
        evidence: operationKinds
      }));

      task = await runStage("proposal-validation", async () => {
        const validated = await runtime.post(`/tasks/${task.id}/validate-edit-proposal`, {});
        assert(validated.editProposal?.validation?.status === "Ready", validated.editProposal?.validation?.summary ?? "Proposal did not validate.");
        return validated;
      }, (current) => ({ summary: current.editProposal.validation.summary }));

      if (definition.guardUnapprovedCommand) {
        skip("file-review", "The negative control intentionally leaves the valid proposal awaiting human review.");
        skip("apply", "The negative control must not mutate the repository.");
      } else {
        task = await runStage("file-review", () => approveAllProposalFiles(runtime, task), {
          summary: "Approved every provider-proposed file individually before mutation."
        });

        task = await runStage("apply", async () => {
          const applied = await runtime.post(`/tasks/${task.id}/apply-edit-proposal`, { note: "Apply the reviewed provider reliability proposal." });
          assert(applied.editProposal?.status === "Applied", "Reviewed provider proposal was not applied.");
          assert(applied.validationRuns.some((run) => run.presetID === "forge-post-apply" && run.status === "Passed"), "Post-apply validation did not pass.");
          return applied;
        }, { summary: "Applied the reviewed Unified Diff transaction and passed built-in validation." });
      }
    } else {
      for (const id of ["proposal", "proposal-validation", "file-review", "apply"]) {
        skip(id, "This recovery case begins with an approved command failure before any edit proposal.");
      }
    }

    if (definition.expectedOutcome === "Applied") {
      skip("command-approval", "This provider-edit case does not run a project command.");
      skip("command-run", "This provider-edit case does not run a project command.");
      for (const id of ["repair-brief", "repair-proposal", "repair-apply", "repair-rerun"]) {
        skip(id, "No repair was expected for the passing provider-edit case.");
      }
    } else if (definition.expectedOutcome === "Guarded") {
      await runStage("command-approval", async () => {
        const permissions = await runtime.get(`/tasks/${task.id}/validation-permissions`);
        const command = permissions.taskCommands.find((permission) => permission.command.id === "runtime-npm-check");
        assert(command?.approvalState === "NeedsApproval" && command.canRun === false, "Negative-control command unexpectedly became runnable.");
        assert(!task.approvals.some((approval) => approval.action === "Approve Validation Preset"), "Negative control unexpectedly persisted command approval.");
      }, { summary: "Intentionally withheld the medium-risk command preset approval." });

      task = await runStage("command-run", async () => {
        const beforeRunCount = task.taskCommandRuns.length;
        const stepped = await runtime.post(`/tasks/${task.id}/run-agent-step`, {});
        const step = stepped.agentRunSteps.at(-1);
        assert(step?.action === "WaitForHumanReview", `Unsafe provider command was not downgraded to WaitForHumanReview: ${step?.action}.`);
        assert(stepped.taskCommandRuns.length === beforeRunCount, "Runtime started a task command without preset approval.");
        assert(stepped.editProposal?.status === "Proposed", "Pending proposal review boundary was not preserved.");
        return stepped;
      }, { summary: "Runtime rejected the provider-selected unapproved command and waited for human review without a process side effect." });
      for (const id of ["repair-brief", "repair-proposal", "repair-apply", "repair-rerun"]) {
        skip(id, "The unsafe command never ran, so no failure repair lineage was created.");
      }
    } else {
      task = await runStage("command-approval", async () => {
        const before = await runtime.get(`/tasks/${task.id}/validation-permissions`);
        const blocked = before.taskCommands.find((permission) => permission.command.id === "runtime-npm-check");
        assert(blocked?.approvalState === "NeedsApproval" && blocked.canRun === false, "Command should be blocked before approval.");
        const approved = await runtime.post(`/tasks/${task.id}/approve-validation-preset`, {
          presetID: "runtime-typescript",
          note: "Approve the known no-shell TypeScript project checks for this isolated fixture."
        });
        assert(approved.approvals.some((approval) => approval.action === "Approve Validation Preset" && approval.targetID === "runtime-typescript"), "Command preset approval was not persisted.");
        const after = await runtime.get(`/tasks/${task.id}/validation-permissions`);
        const ready = after.taskCommands.find((permission) => permission.command.id === "runtime-npm-check");
        assert(ready?.canRun === true, `Approved command is not runnable: ${JSON.stringify(ready?.blockedReasons)}`);
        return approved;
      }, { summary: "Proved blocked-before-approval and runnable-after-approval command states." });

      task = await runStage("command-run", async () => {
        const stepped = await runtime.post(`/tasks/${task.id}/run-agent-step`, { preferredCommandID: "runtime-npm-check" });
        const step = stepped.agentRunSteps.at(-1);
        assert(step?.action === "RunTaskCommand", `Provider step selected ${step?.action} instead of RunTaskCommand.`);
        const run = stepped.taskCommandRuns.at(-1);
        assert(run?.commandID === "runtime-npm-check", `Expected runtime-npm-check, got ${run?.commandID}.`);
        commandStatuses = stepped.taskCommandRuns.map((candidate) => candidate.status);
        if (definition.expectedOutcome === "CommandPassed") {
          assert(run.status === "Passed" && run.exitCode === 0, `Approved command failed: ${run.outputSummary}`);
        } else {
          assert(run.status === "Failed" && run.exitCode !== 0, "Recovery case did not produce the expected command failure.");
        }
        return stepped;
      }, (current) => ({
        summary: definition.expectedOutcome === "CommandPassed"
          ? "OpenAI selected the approved command and the no-shell process passed."
          : "OpenAI selected the approved command and the runtime captured its expected compiler failure.",
        evidence: [`status=${current.taskCommandRuns.at(-1).status}`, `exitCode=${current.taskCommandRuns.at(-1).exitCode}`]
      }));

      if (definition.expectedOutcome === "CommandPassed") {
        for (const id of ["repair-brief", "repair-proposal", "repair-apply", "repair-rerun"]) {
          skip(id, "The approved project command passed; no repair lineage was needed.");
        }
      } else {
        await runStage("repair-brief", async () => {
          const brief = task.validationRepairBriefs.at(-1);
          assert(brief?.source === "TaskCommandRun", "Failed task command did not produce a command-sourced repair brief.");
          assert(brief.provider?.id === "openai", "Repair brief did not come from the OpenAI provider boundary.");
          assert(brief.taskCommandRunID === task.taskCommandRuns.at(-1).id, "Repair brief lost source command lineage.");
          return brief;
        }, (brief) => ({
          summary: "Generated an OpenAI repair brief from bounded command output.",
          evidence: [`source=${brief.source}`, `risk=${brief.riskLevel}`]
        }));

        task = await runStage("repair-proposal", async () => {
          let proposed = await runtime.post(`/tasks/${task.id}/generate-validation-repair-proposal`, {});
          assert(proposed.editProposal?.validationRepairBriefID === proposed.validationRepairBriefs.at(-1).id, "Repair proposal lost repair-brief lineage.");
          assert(proposed.editProposal?.validation?.status === "Ready", proposed.editProposal?.validation?.summary ?? "Repair proposal is not ready.");
          operationKinds = proposed.editProposal.fileChanges.map((change) => change.applyOperation?.kind ?? "Unknown");
          assert(operationKinds.length === 1 && operationKinds[0] === "UnifiedDiff", `Expected one UnifiedDiff repair, got ${operationKinds.join(", ")}.`);
          proposed = await approveAllProposalFiles(runtime, proposed);
          return proposed;
        }, { summary: "Generated, validated, and per-file approved a repair-linked Unified Diff." });

        task = await runStage("repair-apply", async () => {
          const applied = await runtime.post(`/tasks/${task.id}/apply-edit-proposal`, { note: "Apply the reviewed command-sourced self-fix." });
          const evidence = applied.commandRerunEvidence.at(-1);
          assert(evidence?.status === "Ready", `Expected ready rerun evidence, got ${evidence?.status}.`);
          assert(evidence.sourceTaskCommandRunID === applied.taskCommandRuns[0].id, "Rerun evidence lost the failed source command.");
          assert(evidence.repairProposalID === applied.editProposal.id, "Rerun evidence lost the applied repair proposal.");
          return applied;
        }, { summary: "Applied the reviewed self-fix and created linked rerun evidence." });

        task = await runStage("repair-rerun", async () => {
          const stepped = await runtime.post(`/tasks/${task.id}/run-agent-step`, {});
          const step = stepped.agentRunSteps.at(-1);
          assert(step?.action === "RerunRepairCommand", `Provider selected ${step?.action} instead of RerunRepairCommand.`);
          const evidence = stepped.commandRerunEvidence.at(-1);
          assert(evidence?.status === "Passed", `Repair rerun evidence did not pass: ${evidence?.summary}`);
          const rerun = stepped.taskCommandRuns.find((run) => run.id === evidence.rerunTaskCommandRunID);
          assert(rerun?.status === "Passed" && rerun.exitCode === 0, `Repaired command did not pass: ${rerun?.outputSummary}`);
          commandStatuses = stepped.taskCommandRuns.map((candidate) => candidate.status);
          return stepped;
        }, (current) => ({
          summary: "OpenAI selected stored rerun evidence; the original command passed after the reviewed repair.",
          evidence: [`source=${current.taskCommandRuns[0].status}`, `rerun=${current.taskCommandRuns.at(-1).status}`, `evidence=${current.commandRerunEvidence.at(-1).status}`]
        }));
      }
    }

    await runStage("git-evidence", async () => {
      const status = await runtime.get("/git/status");
      changedFiles = status.changedFiles.map((change) => change.path).sort();
      assert(JSON.stringify(changedFiles) === JSON.stringify(definition.expectedChangedFiles), `Expected ${JSON.stringify(definition.expectedChangedFiles)}, got ${JSON.stringify(changedFiles)}.`);
      return status;
    }, (status) => ({
      summary: status.summary,
      evidence: status.changedFiles.map((change) => `${change.status}:${change.path}`)
    }));

    await runStage("oracle", async () => {
      assert(await definition.oracle(repoRoot), "External content oracle failed.");
    }, { summary: "Independent file-content oracle verified the expected repository state." });

    await runStage("audit-export", async () => {
      const [jsonExport, markdownExport] = await Promise.all([
        runtime.get(`/tasks/${task.id}/audit-export?format=json`),
        runtime.get(`/tasks/${task.id}/audit-export?format=markdown`)
      ]);
      const audit = JSON.parse(jsonExport.content);
      assert(audit.task.id === task.id, "JSON audit exported the wrong task.");
      assert(audit.approvals.some((approval) => approval.action === "Approve Plan"), "Audit omitted plan approval.");
      assert(markdownExport.content.includes("## Event Timeline"), "Markdown audit omitted event timeline.");
      assert(!jsonExport.content.includes("provider-reliability-secret"), "JSON audit leaked provider credentials.");
      assert(!markdownExport.content.includes("provider-reliability-secret"), "Markdown audit leaked provider credentials.");
    }, { summary: "Exported redacted JSON and Markdown audit evidence without provider credentials." });
  } catch (error) {
    failureStage = error instanceof StageFailure ? error.stageID : undefined;
    failure = compactFailure(error instanceof Error ? error.message : String(error));
  } finally {
    await runtime?.stop();
    await mockProvider?.stop();
  }

  const present = new Set(stages.map((stage) => stage.id));
  for (const id of PROVIDER_RELIABILITY_STAGE_IDS) {
    if (!present.has(id)) skip(id, "Skipped after an earlier unexpected failure.");
  }
  stages.sort((left, right) => PROVIDER_RELIABILITY_STAGE_IDS.indexOf(left.id) - PROVIDER_RELIABILITY_STAGE_IDS.indexOf(right.id));
  const requestNames = providerRequestNames(mockProvider?.requests ?? []);
  return {
    id: definition.id,
    title: definition.title,
    category: definition.category,
    expectedOutcome: definition.expectedOutcome,
    status: failure ? "Failed" : definition.expectedOutcome === "Guarded" ? "Guarded" : "Passed",
    durationMs: Date.now() - startedAt,
    providerRequestCount: mockProvider?.requests.length ?? 0,
    providerRequestNames: requestNames,
    operationKinds,
    changedFiles,
    commandStatuses,
    failureStage,
    failure,
    stages
  };
}

function createScenarioResponder(definition) {
  return (entry, requests) => {
    const name = entry.name;
    if (name === "forge_intent_brief") {
      return {
        summary: definition.objective,
        constraints: ["Use runtime-owned context tools only.", "Keep edits and commands behind explicit human approval."],
        acceptanceCriteria: ["The reviewed repository state matches the task.", "Relevant approved validation evidence is persisted."],
        openQuestions: [],
        nextAction: "Inspect bounded repository context and generate a reviewable plan."
      };
    }
    if (name === "forge_plan_context_request") {
      const count = requests.filter((request) => request.name === name).length;
      return count === 1
        ? {
            status: "SearchAndRead",
            rationale: "Inspect the task-named implementation and validation context before planning.",
            searchTerms: ["runtime", "test", "greeting", "typescript"],
            readPaths: definition.contextPaths
          }
        : {
            status: "ReadyForPlan",
            rationale: "The requested repository context is now available.",
            searchTerms: [],
            readPaths: []
          };
    }
    if (name === "forge_plan_revision") {
      return {
        intentSummary: definition.objective,
        summary: "Use the inspected repository evidence and preserve every review boundary.",
        rationale: "The runtime executed the provider-requested read-only tools and supplied compact context.",
        riskLevel: "Medium",
        steps: [
          { id: "inspect", title: "Inspect context", status: "Done", summary: "Use runtime-owned repository evidence." },
          { id: "propose", title: "Propose reviewed work", status: "Pending", summary: "Generate a bounded provider artifact." },
          { id: "verify", title: "Verify evidence", status: "Pending", summary: "Use approved validation and audit evidence." },
          { id: "review", title: "Request human review", status: "Active", summary: "Pause before edits or commands." }
        ]
      };
    }
    if (name === "forge_execution_proposal") {
      return {
        summary: "Prepare the smallest reviewable provider action from inspected context.",
        proposedActions: ["Generate a strict-schema edit when needed.", "Use only approved command IDs.", "Preserve audit lineage."],
        riskLevel: "Medium"
      };
    }
    if (name === "forge_edit_proposal") {
      const prompt = providerPrompt(entry.body);
      return /"validationRepairBrief"\s*:\s*\{/.test(prompt)
        ? definition.repairProposal?.()
        : definition.initialProposal?.() ?? editProposal("No initial edit requested.", []);
    }
    if (name === "forge_validation_repair_brief") {
      return definition.repairBrief?.() ?? {
        summary: "No repair expected.",
        likelyCause: "Not applicable.",
        recommendedActions: ["Wait for human review."],
        followUpPrompt: "Review the command output.",
        riskLevel: "Low"
      };
    }
    if (name === "forge_agent_run_step") {
      return definition.agentStep?.(entry) ?? agentDecision("WaitForHumanReview", {
        summary: "Wait for human review.",
        rationale: "No provider-selected command is needed in this case."
      });
    }
    throw new Error(`Unexpected provider schema request: ${name}`);
  };
}

function editProposal(summary, fileChanges) {
  return { summary, riskLevel: "Medium", fileChanges };
}

function unifiedDiffChange(path, patch, rationale) {
  return {
    path,
    changeType: "Modify",
    rationale,
    diffPreview: patch,
    operationKind: "UnifiedDiff",
    appendText: "",
    findText: "",
    replaceWith: "",
    patchHunks: [],
    unifiedDiff: patch,
    content: ""
  };
}

function agentDecision(action, overrides) {
  return {
    action,
    summary: overrides.summary,
    rationale: overrides.rationale,
    commandID: overrides.commandID ?? "",
    commandRerunEvidenceID: overrides.commandRerunEvidenceID ?? "",
    searchTerms: [],
    readPaths: [],
    searchMode: "Text"
  };
}

function providerPrompt(body) {
  return body?.input?.flatMap((message) => message.content ?? [])
    .filter((part) => part.type === "input_text")
    .map((part) => part.text ?? "")
    .join("\n") ?? "";
}

async function approveAllProposalFiles(runtime, task) {
  let current = task;
  for (const change of task.editProposal.fileChanges) {
    current = await runtime.post(`/tasks/${task.id}/review-edit-proposal-file`, {
      fileChangeID: change.id,
      decision: "Approved",
      note: `Provider reliability campaign approves ${change.path}.`
    });
  }
  assert(current.editProposal.fileDecisions?.length === current.editProposal.fileChanges.length, "Per-file approval evidence is incomplete.");
  return current;
}

function providerRequestNames(requests) {
  const names = {};
  for (const request of requests) names[request.name] = (names[request.name] ?? 0) + 1;
  return names;
}

function compactFailure(message) {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 900 ? `${normalized.slice(0, 897)}...` : normalized;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
