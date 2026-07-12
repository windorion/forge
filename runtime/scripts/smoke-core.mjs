#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(runtimeRoot, "..");
const smokeID = `forge-core-smoke-${process.pid}-${Date.now()}`;
const tempRoot = join(tmpdir(), smokeID);
const dbPath = join(tempRoot, "forge.sqlite");
const settingsPath = join(tempRoot, "model-provider-settings.json");
const port = 17400 + Math.floor(Math.random() * 1000);
const mockOpenAIPort = port + 2000;
const baseURL = `http://127.0.0.1:${port}`;
const appendSmokePath = `docs/${smokeID}-append.md`;
const replaceSmokePath = `docs/${smokeID}-replace.md`;
const sourceReplaceSmokePath = `runtime/src/${smokeID}-source-replace.ts`;
const sourcePatchSmokePath = `runtime/src/${smokeID}-source-patch.ts`;
const createSmokePath = `docs/${smokeID}-openai-created.md`;
const binarySmokePath = `docs/${smokeID}-binary.bin`;
const largeDiffSmokePath = `docs/${smokeID}-large-diff.txt`;
const brokenTypeScriptSmokePath = `runtime/src/${smokeID}-broken.ts`;
const branchSmokeName = `forge/${smokeID}-branch`;

const smokeFiles = [
  {
    relativePath: appendSmokePath,
    initialContent: "# Forge Append Smoke\n\nInitial append smoke fixture.\n"
  },
  {
    relativePath: replaceSmokePath,
    initialContent: "# Forge Replace Smoke\n\nSMOKE_OLD\n"
  },
  {
    relativePath: sourceReplaceSmokePath,
    initialContent: "export const forgeSourceReplaceSmoke = \"SOURCE_OLD\";\n"
  },
  {
    relativePath: sourcePatchSmokePath,
    initialContent: [
      "export const forgePatchSmokeOne = \"PATCH_OLD_ONE\";",
      "export const forgePatchSmokeTwo = \"PATCH_OLD_TWO\";",
      ""
    ].join("\n")
  }
];

const rollbackSnapshotDirectories = new Set();

let runtime;
let mockOpenAI;

try {
  await mkdir(tempRoot, { recursive: true });
  await createSmokeFiles();

  runtime = await startRuntime();
  await assertRuntimeDiagnosticsAndSettings();
  await assertGitReviewEndpoints();
  const appendTask = await runAppendFlow();

  await stopRuntime(runtime);
  runtime = await startRuntime();
  await assertRestartRecovery(appendTask.id, appendSmokePath);

  const replaceTask = await runReplaceFlow();
  const sourceReplaceTask = await runSourceReplaceFlow();
  const sourcePatchTask = await runSourcePatchFlow();

  await stopRuntime(runtime);
  runtime = undefined;
  await rm(settingsPath, { force: true });

  mockOpenAI = await startMockOpenAI();
  runtime = await startRuntime({
    providerID: "openai",
    modelName: "openai-context-smoke",
    openAIBaseURL: mockOpenAI.baseURL,
    openAIAPIKey: "sk-forge-smoke"
  });
  const openAIContextTask = await runOpenAIContextFlow();
  const openAIAutoRepairTask = await runOpenAIAutoRepairFlow();
  const openAIValidationRepairTask = await runOpenAIValidationFailureRepairFlow();
  const openAIPreviewBlockedTask = await runOpenAIPreviewBlockedFlow();

  console.log("Core runtime smoke passed.");
  console.log(`- Runtime: ${baseURL}`);
  console.log(`- Append task: ${appendTask.id}`);
  console.log(`- Replace task: ${replaceTask.id}`);
  console.log(`- Source replace task: ${sourceReplaceTask.id}`);
  console.log(`- Source patch task: ${sourcePatchTask.id}`);
  console.log(`- OpenAI context task: ${openAIContextTask.id}`);
  console.log(`- OpenAI auto-repair task: ${openAIAutoRepairTask.id}`);
  console.log(`- OpenAI validation repair task: ${openAIValidationRepairTask.id}`);
  console.log(`- OpenAI preview-blocked task: ${openAIPreviewBlockedTask.id}`);
  console.log(`- Temporary database: ${dbPath}`);
} finally {
  await stopRuntime(runtime);
  await stopMockOpenAI(mockOpenAI);
  await cleanupSmokeFiles();
  await rm(tempRoot, { recursive: true, force: true });
}

async function runAppendFlow() {
  const task = await createTask({
    title: "Smoke append lifecycle",
    objective: `Run an append lifecycle smoke against @${appendSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "append task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/messages`, {
    content: `Use @${appendSmokePath} for this smoke proposal. Add a small append-only note.`
  });
  assertResolvedReference(current, appendSmokePath);

  current = await post(`/tasks/${task.id}/generate-plan-revision`, {});
  assertState(current, "Human Review", "Plan Review");

  current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the append plan."
  });
  assert(current.executionProposal, "Append flow did not create an execution proposal.");
  assertExecutionProposalContext(current, appendSmokePath);

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assertProposal(current, appendSmokePath, "AppendText");

  current = await post(`/tasks/${task.id}/validate-edit-proposal`, {});
  assertProposal(current, appendSmokePath, "AppendText");

  const appendPath = join(repoRoot, appendSmokePath);
  const before = await readFile(appendPath, "utf8");

  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the append proposal."
  });
  assertCompletedTask(current, appendSmokePath);

  const after = await readFile(appendPath, "utf8");
  assert(after.startsWith(before), "Append smoke did not preserve the original file prefix.");
  assert(after.includes("## Forge Implementation Note"), "Append smoke did not add the implementation note.");

  return current;
}

async function runReplaceFlow() {
  const task = await createTask({
    title: "Smoke replace lifecycle",
    objective: `Run an exact replace lifecycle smoke against @${replaceSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "replace task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/messages`, {
    content: `Use @${replaceSmokePath} and replace "SMOKE_OLD" with "SMOKE_NEW".`
  });
  assertResolvedReference(current, replaceSmokePath);

  current = await post(`/tasks/${task.id}/generate-plan-revision`, {});
  assertState(current, "Human Review", "Plan Review");

  current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the replace plan."
  });
  assert(current.executionProposal, "Replace flow did not create an execution proposal.");

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assertProposal(current, replaceSmokePath, "ReplaceText");

  current = await post(`/tasks/${task.id}/validate-edit-proposal`, {});
  assertProposal(current, replaceSmokePath, "ReplaceText");

  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the replace proposal."
  });
  assertCompletedTask(current, replaceSmokePath);

  const after = await readFile(join(repoRoot, replaceSmokePath), "utf8");
  assert(after.includes("SMOKE_NEW"), "Replace smoke did not write the replacement text.");
  assert(!after.includes("SMOKE_OLD"), "Replace smoke left the original find text behind.");

  return current;
}

async function runSourceReplaceFlow() {
  const task = await createTask({
    title: "Smoke source replace lifecycle",
    objective: `Run an exact source replace lifecycle smoke against @${sourceReplaceSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "source replace task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/messages`, {
    content: `Use @${sourceReplaceSmokePath} and replace "SOURCE_OLD" with "SOURCE_NEW".`
  });
  assertResolvedReference(current, sourceReplaceSmokePath);

  current = await post(`/tasks/${task.id}/generate-plan-revision`, {});
  assertState(current, "Human Review", "Plan Review");

  current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the source replace plan."
  });
  assert(current.executionProposal, "Source replace flow did not create an execution proposal.");
  assertExecutionProposalContext(current, sourceReplaceSmokePath);

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assertProposal(current, sourceReplaceSmokePath, "ReplaceText");

  current = await post(`/tasks/${task.id}/validate-edit-proposal`, {});
  assertProposal(current, sourceReplaceSmokePath, "ReplaceText");
  assert(
    current.editProposal.validation.fileResults?.some((result) =>
      result.path === sourceReplaceSmokePath &&
        result.checks?.some((check) => check.includes("editable source/text workspace boundary"))
    ),
    "Source replace validation did not use the source/text workspace boundary."
  );

  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the source replace proposal."
  });
  assertCompletedTask(current, sourceReplaceSmokePath);

  const after = await readFile(join(repoRoot, sourceReplaceSmokePath), "utf8");
  assert(after.includes("SOURCE_NEW"), "Source replace smoke did not write the replacement text.");
  assert(!after.includes("SOURCE_OLD"), "Source replace smoke left the original find text behind.");
  assertAppliedChangeMetadata(current, sourceReplaceSmokePath, "ReplaceText");

  current = await post(`/tasks/${task.id}/rollback-edit-proposal`, {
    note: "Core smoke test rolls back the source replace proposal."
  });
  assertState(current, "Human Review", "Rollback Applied");
  assert(current.editProposal?.status === "RolledBack", "Source replace rollback did not mark proposal RolledBack.");
  assert(
    current.approvals?.some((approval) => approval.action === "Rollback Edit Proposal"),
    "Source replace rollback did not record a rollback approval."
  );
  assert(
    current.events?.some((event) => event.type === "edit.proposal.rolled_back"),
    "Source replace rollback did not record a rolled-back event."
  );
  const rolledBackChange = assertAppliedChangeMetadata(current, sourceReplaceSmokePath, "ReplaceText");
  assert(rolledBackChange.rolledBackAt, "Source replace rollback did not timestamp the applied change metadata.");

  const restored = await readFile(join(repoRoot, sourceReplaceSmokePath), "utf8");
  assert(restored.includes("SOURCE_OLD"), "Source replace rollback did not restore the original text.");
  assert(!restored.includes("SOURCE_NEW"), "Source replace rollback left the replacement text behind.");

  return current;
}

async function runSourcePatchFlow() {
  const task = await createTask({
    title: "Smoke source patch lifecycle",
    objective: `Run a multi-hunk source patch lifecycle smoke against @${sourcePatchSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "source patch task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/messages`, {
    content: [
      `Use @${sourcePatchSmokePath}.`,
      `Replace "PATCH_OLD_ONE" with "PATCH_NEW_ONE".`,
      `Replace "PATCH_OLD_TWO" with "PATCH_NEW_TWO".`
    ].join(" ")
  });
  assertResolvedReference(current, sourcePatchSmokePath);

  current = await post(`/tasks/${task.id}/generate-plan-revision`, {});
  assertState(current, "Human Review", "Plan Review");

  current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the source patch plan."
  });
  assert(current.executionProposal, "Source patch flow did not create an execution proposal.");
  assertExecutionProposalContext(current, sourcePatchSmokePath);

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assertProposal(current, sourcePatchSmokePath, "PatchText");
  assert(
    current.editProposal.fileChanges?.[0]?.applyOperation?.hunks?.length === 2,
    "Source patch proposal did not include two patch hunks."
  );

  current = await post(`/tasks/${task.id}/validate-edit-proposal`, {});
  assertProposal(current, sourcePatchSmokePath, "PatchText");
  assert(
    current.editProposal.validation.fileResults?.some((result) =>
      result.path === sourcePatchSmokePath &&
        result.checks?.some((check) => check.includes("Patch hunks apply cleanly in order"))
    ),
    "Source patch validation did not record ordered hunk application."
  );

  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the source patch proposal."
  });
  assertCompletedTask(current, sourcePatchSmokePath);

  const after = await readFile(join(repoRoot, sourcePatchSmokePath), "utf8");
  assert(after.includes("PATCH_NEW_ONE"), "Source patch smoke did not write the first replacement.");
  assert(after.includes("PATCH_NEW_TWO"), "Source patch smoke did not write the second replacement.");
  assert(!after.includes("PATCH_OLD_ONE"), "Source patch smoke left the first original text behind.");
  assert(!after.includes("PATCH_OLD_TWO"), "Source patch smoke left the second original text behind.");
  assertAppliedChangeMetadata(current, sourcePatchSmokePath, "PatchText");

  current = await post(`/tasks/${task.id}/rollback-edit-proposal`, {
    note: "Core smoke test rolls back the source patch proposal."
  });
  assertState(current, "Human Review", "Rollback Applied");
  assert(current.editProposal?.status === "RolledBack", "Source patch rollback did not mark proposal RolledBack.");
  const rolledBackChange = assertAppliedChangeMetadata(current, sourcePatchSmokePath, "PatchText");
  assert(rolledBackChange.rolledBackAt, "Source patch rollback did not timestamp the applied change metadata.");

  const restored = await readFile(join(repoRoot, sourcePatchSmokePath), "utf8");
  assert(restored.includes("PATCH_OLD_ONE"), "Source patch rollback did not restore the first original text.");
  assert(restored.includes("PATCH_OLD_TWO"), "Source patch rollback did not restore the second original text.");
  assert(!restored.includes("PATCH_NEW_ONE"), "Source patch rollback left the first replacement text behind.");
  assert(!restored.includes("PATCH_NEW_TWO"), "Source patch rollback left the second replacement text behind.");

  return current;
}

async function runOpenAIContextFlow() {
  const task = await createTask({
    title: "Smoke OpenAI model-guided context",
    objective: `Plan a model-guided context smoke against @${appendSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "OpenAI context task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/messages`, {
    content: `Use @${appendSmokePath} and docs/runtime_architecture.md when revising this plan.`
  });
  assertResolvedReference(current, appendSmokePath);

  current = await post(`/tasks/${task.id}/generate-plan-revision`, {});
  assertState(current, "Human Review", "Plan Review");
  assert(
    current.planRevisions?.at(-1)?.provider?.id === "openai",
    "OpenAI context flow did not create an OpenAI-backed plan revision."
  );
  assert(
    current.contextFiles?.some((file) => file.path === appendSmokePath),
    `OpenAI context flow did not inspect requested fixture ${appendSmokePath}.`
  );
  assert(
    ["list_repo_files", "search_repo_context", "read_context_file"].every((toolName) =>
      current.toolCalls?.some((tool) => tool.name === toolName && tool.status === "Completed")
    ),
    "OpenAI context flow did not run the expected read-only repository tools."
  );
  assert(
    current.events?.some((event) => event.type === "model.context_loop.completed"),
    "OpenAI context flow did not record a model-guided context loop completion event."
  );
  const contextRequestCount = mockOpenAI.requests.filter((request) => request.name === "forge_plan_context_request").length;
  assert(
    contextRequestCount === 2,
    `Mock OpenAI server expected 2 plan context requests, got ${contextRequestCount}.`
  );

  current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the OpenAI context plan."
  });
  assert(current.executionProposal, "OpenAI context flow did not create an execution proposal.");
  assertExecutionProposalContext(current, appendSmokePath);

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assertState(current, "Human Review", "Edit Proposal Review");
  assert(current.editProposal?.status === "Proposed", "OpenAI context flow did not create an edit proposal.");
  assert(
    current.editProposal.fileChanges?.length === 2,
    `Expected 2 rich OpenAI proposal changes, got ${current.editProposal.fileChanges?.length ?? 0}.`
  );
  assert(
    current.editProposal.validation?.status === "Ready",
    current.editProposal.validation?.summary ?? "Rich OpenAI proposal should be ready for safe append/create apply."
  );
  assert(
    current.editProposal.fileChanges?.some((change) =>
      change.path === createSmokePath &&
        change.changeType === "Create" &&
        change.applyOperation?.kind === "CreateFile"
    ),
    "Rich OpenAI proposal did not retain the create-file operation."
  );

  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the OpenAI append/create proposal."
  });
  assertCompletedTask(current, appendSmokePath);
  assert(
    current.changedFiles?.includes(createSmokePath),
    `Changed files did not include created file ${createSmokePath}.`
  );
  const created = await readFile(join(repoRoot, createSmokePath), "utf8");
  assert(created.includes("Preview created by the OpenAI smoke flow."), "CreateFile smoke did not write expected content.");

  return current;
}

async function runOpenAIPreviewBlockedFlow() {
  const task = await createTask({
    title: "Smoke preview-only blocked proposal",
    objective: `Generate a preview-only blocked proposal for @${appendSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "OpenAI preview-only task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the preview-only plan."
  });
  assert(current.executionProposal, "OpenAI preview-only flow did not create an execution proposal.");

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assertState(current, "Human Review", "Edit Proposal Validation Blocked");
  assert(current.editProposal?.status === "Proposed", "OpenAI preview-only flow did not create an edit proposal.");
  assert(
    current.editProposal.validation?.status === "Blocked",
    "Preview-only proposal should be blocked from apply."
  );
  assert(
    current.editProposal.fileChanges?.some((change) => change.applyOperation?.kind === "PreviewOnly"),
    "Preview-only proposal did not retain the preview-only operation."
  );
  assert(
    current.editProposal.revisionNumber === 3,
    `Preview-only proposal should stop after revision 3, got ${current.editProposal.revisionNumber}.`
  );
  assert(
    current.editProposalRevisions?.filter((proposal) => proposal.status === "Superseded").length >= 2,
    "Preview-only proposal did not archive superseded repair attempts."
  );
  assert(
    current.events?.filter((event) => event.type === "edit.proposal.repair.started").length >= 2,
    "Preview-only proposal did not record repair attempt events."
  );

  return current;
}

async function runOpenAIAutoRepairFlow() {
  const task = await createTask({
    title: "Smoke auto-repair blocked proposal",
    objective: `Generate a blocked proposal first, then repair it for @${appendSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "OpenAI auto-repair task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the auto-repair plan."
  });
  assert(current.executionProposal, "OpenAI auto-repair flow did not create an execution proposal.");

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assertState(current, "Human Review", "Edit Proposal Review");
  assert(current.editProposal?.status === "Proposed", "OpenAI auto-repair flow did not create an edit proposal.");
  assert(
    current.editProposal.validation?.status === "Ready",
    current.editProposal.validation?.summary ?? "Auto-repaired proposal should be ready."
  );
  assert(
    current.editProposal.revisionNumber === 2,
    `Auto-repaired proposal should expose revision 2, got ${current.editProposal.revisionNumber}.`
  );
  assert(
    current.editProposal.fileChanges?.some((change) => change.applyOperation?.kind === "AppendText"),
    "Auto-repaired proposal did not switch to an apply-ready AppendText operation."
  );
  assert(
    current.editProposalRevisions?.some((proposal) =>
      proposal.status === "Superseded" &&
        proposal.validation?.status === "Blocked" &&
        proposal.fileChanges?.some((change) => change.applyOperation?.kind === "PreviewOnly")
    ),
    "Auto-repaired proposal did not retain the blocked superseded proposal in history."
  );
  assert(
    current.events?.some((event) => event.type === "edit.proposal.repair.started"),
    "Auto-repaired proposal did not record a repair attempt event."
  );

  return current;
}

async function runOpenAIValidationFailureRepairFlow() {
  const task = await createTask({
    title: "Smoke validation failure repair brief",
    objective: `Generate a safe edit, then analyze a failed runtime validation for @${appendSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "OpenAI validation-repair task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the validation repair plan."
  });
  assert(current.executionProposal, "OpenAI validation-repair flow did not create an execution proposal.");

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assertState(current, "Human Review", "Edit Proposal Review");
  assert(current.editProposal?.validation?.status === "Ready", "Validation-repair proposal should be ready.");
  assert(
    current.editProposal.fileChanges?.some((change) => change.applyOperation?.kind === "AppendText"),
    "Validation-repair proposal did not include an append operation."
  );

  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies before forcing validation failure."
  });
  assertCompletedTask(current, appendSmokePath);

  const brokenPath = join(repoRoot, brokenTypeScriptSmokePath);
  await mkdir(dirname(brokenPath), { recursive: true });
  await writeFile(brokenPath, "export const forgeSmokeBroken: string = ;\n", "utf8");

  current = await post(`/tasks/${task.id}/approve-validation-preset`, {
    presetID: "runtime-typescript",
    note: "Core smoke test approves runtime validation failure analysis."
  });
  assert(
    current.approvals?.some((approval) => approval.action === "Approve Validation Preset" && approval.targetID === "runtime-typescript"),
    "Validation-repair flow did not approve the runtime-typescript preset."
  );

  current = await post(`/tasks/${task.id}/run-validation`, {
    presetID: "runtime-typescript"
  });
  assertState(current, "Failed", "Validation Failed");
  const failedRun = current.validationRuns?.at(-1);
  assert(failedRun?.status === "Failed", "Validation-repair flow did not record a failed validation run.");
  assert(
    current.validationRepairBriefs?.some((brief) =>
      brief.validationRunID === failedRun.id &&
        brief.provider?.id === "openai" &&
        brief.recommendedActions?.length > 0
    ),
    "Validation-repair flow did not create an OpenAI repair brief."
  );
  assert(
    current.events?.some((event) => event.type === "validation.repair_brief.ready"),
    "Validation-repair flow did not record a repair brief ready event."
  );
  assert(
    current.planSteps?.some((step) => step.id === "plan-validation-repair" && step.status === "Active"),
    "Validation-repair flow did not create an active repair planning step."
  );
  const repairBrief = current.validationRepairBriefs.at(-1);
  const appliedProposalID = current.editProposal?.id;
  const changedFilesBeforeRepairProposal = [...(current.changedFiles ?? [])];

  current = await post(`/tasks/${task.id}/generate-validation-repair-proposal`, {});
  assertState(current, "Human Review", "Edit Proposal Review");
  assert(current.editProposal?.status === "Proposed", "Validation repair proposal was not proposed.");
  assert(
    current.editProposal.validationRepairBriefID === repairBrief.id,
    "Validation repair proposal did not retain the repair brief link."
  );
  assert(
    current.editProposal.revisionNumber === 2,
    `Validation repair proposal should be revision 2, got ${current.editProposal.revisionNumber}.`
  );
  assert(
    current.editProposal.validation?.status === "Ready",
    current.editProposal.validation?.summary ?? "Validation repair proposal should validate as ready."
  );
  assert(
    current.editProposal.fileChanges?.some((change) => change.applyOperation?.kind === "AppendText"),
    "Validation repair proposal did not include a safe append operation."
  );
  assert(
    current.editProposalRevisions?.some((proposal) => proposal.id === appliedProposalID && proposal.status === "Applied"),
    "Validation repair proposal did not archive the previously applied proposal."
  );
  assert(
    JSON.stringify(current.changedFiles ?? []) === JSON.stringify(changedFilesBeforeRepairProposal),
    "Validation repair proposal generation should not mutate changedFiles."
  );
  assert(
    current.events?.some((event) => event.type === "edit.proposal.validation_repair.ready"),
    "Validation repair proposal did not record a ready event."
  );

  return current;
}

async function assertRestartRecovery(taskID, expectedChangedFile) {
  const recovered = await waitForTask(
    taskID,
    (candidate) => candidate.status === "Completed" && candidate.changedFiles?.includes(expectedChangedFile),
    "completed append task to reload after runtime restart"
  );

  assertCompletedTask(recovered, expectedChangedFile);
}

async function createTask(body) {
  const task = await post("/tasks", body);
  assert(task.id, "Create task response did not include an id.");
  return task;
}

async function assertRuntimeDiagnosticsAndSettings() {
  const home = await getText("/");
  assert(home.includes("Forge Runtime is running"), "Runtime home page did not render the status page.");
  assert(
    home.includes("GET /settings/model-provider"),
    "Runtime home page did not link the model provider settings endpoint."
  );
  assert(
    home.includes("GET /git/branch-publish-preview"),
    "Runtime home page did not link the branch publish preview endpoint."
  );

  const initialHealth = await get("/health");
  assert(initialHealth.ok === true, "Runtime health did not report ok.");
  assert(initialHealth.service === "forge-runtime", `Unexpected runtime service ${initialHealth.service}.`);
  assert(initialHealth.version === "0.1.0", `Unexpected runtime version ${initialHealth.version}.`);
  assert(typeof initialHealth.uptimeSeconds === "number", "Runtime health did not include uptime seconds.");
  assert(
    initialHealth.persistence?.databasePath === dbPath,
    `Runtime health did not expose the temporary database path ${dbPath}.`
  );
  assert(typeof initialHealth.persistence?.taskCount === "number", "Runtime health did not include task count.");
  assert(initialHealth.modelProvider?.id === "local", "Initial runtime model provider should be local.");
  assert(
    initialHealth.modelProviderConfiguration?.status === "Ready",
    "Initial runtime model provider configuration should be ready."
  );
  assert(
    initialHealth.modelProviderConfiguration?.sendsRemoteContext === false,
    "Local provider health should report that no remote context is sent."
  );

  const initialSettings = await get("/settings/model-provider");
  assert(initialSettings.configuration?.provider?.id === "local", "Initial settings provider should be local.");
  assert(initialSettings.configuration?.status === "Ready", "Initial settings provider should be ready.");
  assert(
    initialSettings.editableSettings?.settingsPath === settingsPath,
    `Settings endpoint did not expose the temporary settings path ${settingsPath}.`
  );
  assert(
    initialSettings.editableSettings?.hasOpenAIAPIKey === false,
    "Initial settings should not report an OpenAI API key."
  );

  const missingKeySettings = await post("/settings/model-provider", {
    providerID: "openai",
    modelName: "settings-smoke-openai",
    openAIBaseURL: "http://127.0.0.1:9/v1/",
    openAITimeoutMs: 12_345,
    openAIMaxOutputTokens: 777,
    clearOpenAIAPIKey: true
  });
  assert(missingKeySettings.configuration?.provider?.id === "openai", "Settings did not switch to OpenAI.");
  assert(
    missingKeySettings.configuration?.status === "NeedsConfiguration",
    "OpenAI settings without an API key should need configuration."
  );
  assert(
    missingKeySettings.configuration?.sendsRemoteContext === true,
    "OpenAI settings should disclose that remote context may be sent."
  );
  assert(
    missingKeySettings.editableSettings?.openAIBaseURL === "http://127.0.0.1:9/v1",
    "OpenAI base URL was not normalized in editable settings."
  );
  assert(
    missingKeySettings.editableSettings?.hasOpenAIAPIKey === false,
    "OpenAI settings without a key should report hasOpenAIAPIKey false."
  );

  const persistedMissingKey = await readPersistedModelProviderSettings();
  assert(persistedMissingKey.providerID === "openai", "Persisted settings did not retain providerID openai.");
  assert(persistedMissingKey.modelName === "settings-smoke-openai", "Persisted settings did not retain modelName.");
  assert(persistedMissingKey.openAIBaseURL === "http://127.0.0.1:9/v1", "Persisted settings did not normalize base URL.");
  assert(!("openAIAPIKey" in persistedMissingKey), "Persisted settings must not include an OpenAI API key.");

  const configuredSettings = await post("/settings/model-provider", {
    openAIAPIKey: "sk-forge-settings-smoke"
  });
  assert(
    configuredSettings.configuration?.status === "Ready",
    "OpenAI settings with an in-memory API key should be ready."
  );
  assert(
    configuredSettings.editableSettings?.hasOpenAIAPIKey === true,
    "OpenAI settings with a key should report hasOpenAIAPIKey true."
  );

  const persistedConfiguredRaw = await readFile(settingsPath, "utf8");
  assert(
    !persistedConfiguredRaw.includes("sk-forge-settings-smoke"),
    "Persisted settings leaked the smoke OpenAI API key."
  );

  const clearedSettings = await post("/settings/model-provider", {
    clearOpenAIAPIKey: true
  });
  assert(
    clearedSettings.configuration?.status === "NeedsConfiguration",
    "Clearing the OpenAI key should return provider configuration to NeedsConfiguration."
  );
  assert(
    clearedSettings.editableSettings?.hasOpenAIAPIKey === false,
    "Clearing the OpenAI key should report hasOpenAIAPIKey false."
  );

  const restoredSettings = await post("/settings/model-provider", {
    providerID: "local",
    modelName: "settings-smoke-local",
    openAIBaseURL: null,
    openAITimeoutMs: null,
    openAIMaxOutputTokens: null,
    clearOpenAIAPIKey: true
  });
  assert(restoredSettings.configuration?.provider?.id === "local", "Settings did not restore local provider.");
  assert(restoredSettings.configuration?.status === "Ready", "Restored local provider should be ready.");
  assert(
    restoredSettings.configuration?.sendsRemoteContext === false,
    "Restored local provider should report no remote context."
  );

  const restoredHealth = await get("/health");
  assert(restoredHealth.modelProvider?.id === "local", "Health did not reflect restored local provider.");
  assert(
    restoredHealth.modelProviderConfiguration?.status === "Ready",
    "Health did not reflect restored ready provider configuration."
  );
}

async function assertGitReviewEndpoints() {
  const status = await get("/git/status");
  assert(status.isRepository === true, `Git status did not detect the repository: ${JSON.stringify(status)}`);
  assert(typeof status.summary === "string" && status.summary.length > 0, "Git status did not include a summary.");
  assert(Array.isArray(status.changedFiles), "Git status did not include changed files.");
  assert(
    status.changedFiles.some((change) => change.path === appendSmokePath && change.status === "Untracked"),
    `Git status did not include the untracked smoke fixture ${appendSmokePath}.`
  );

  const diff = await get(`/git/diff?path=${encodeURIComponent(appendSmokePath)}`);
  assert(diff.path === appendSmokePath, `Git diff returned unexpected path ${diff.path}.`);
  assert(diff.diff.includes("Forge Append Smoke"), "Git diff did not include the smoke fixture content.");
  assert(diff.truncated === false, "Git diff for the small smoke fixture should not be truncated.");
  assert(diff.displayMode === "SideBySide", `Git diff expected SideBySide display mode, got ${diff.displayMode}.`);
  assert(diff.unavailableReason === undefined, "Text git diff should not include an unavailable reason.");
  assert(diff.appPreviewLineLimit === 260, "Git diff did not include the app preview line limit.");

  const binaryDiff = await get(`/git/diff?path=${encodeURIComponent(binarySmokePath)}`);
  assert(binaryDiff.path === binarySmokePath, `Binary git diff returned unexpected path ${binaryDiff.path}.`);
  assert(binaryDiff.displayMode === "Message", "Binary git diff should use message display mode.");
  assert(binaryDiff.unavailableReason === "Binary", `Binary git diff returned ${binaryDiff.unavailableReason}.`);
  assert(binaryDiff.byteCount > 0, "Binary git diff did not include byte count metadata.");
  assert(
    binaryDiff.summary.includes("Binary diff preview is unavailable"),
    "Binary git diff did not explain unavailable preview."
  );

  const largeDiff = await get(`/git/diff?path=${encodeURIComponent(largeDiffSmokePath)}`);
  assert(largeDiff.path === largeDiffSmokePath, `Large git diff returned unexpected path ${largeDiff.path}.`);
  assert(largeDiff.displayMode === "Message", "Large git diff should use message display mode.");
  assert(largeDiff.unavailableReason === "TooLarge", `Large git diff returned ${largeDiff.unavailableReason}.`);
  assert(largeDiff.byteCount > 48_000, "Large git diff did not include byte count over the runtime threshold.");
  assert(largeDiff.lineCount > 0, "Large git diff did not include line count metadata.");

  const commitPreview = await get("/git/commit-preview");
  assert(
    commitPreview.includedFiles.some((change) => change.path === appendSmokePath),
    `Git commit preview did not include the untracked smoke fixture ${appendSmokePath}.`
  );
  assert(commitPreview.expectedHead, "Git commit preview did not include the expected head.");
  assert(commitPreview.suggestedTitle, "Git commit preview did not include a suggested title.");
  assert(commitPreview.preflight, "Git commit preview did not include preflight metadata.");
  assert(
    commitPreview.preflight.identityStatus === "Ready",
    `Git commit preview expected ready author identity, got ${commitPreview.preflight.identityStatus}.`
  );
  assert(
    commitPreview.preflight.stagedFileCount >= 0 &&
      commitPreview.preflight.unstagedFileCount >= 0 &&
      commitPreview.preflight.untrackedFileCount >= 0,
    "Git commit preview did not include staged/unstaged/untracked preflight counts."
  );
  assert(
    commitPreview.preflight.filesWithoutStats > 0,
    "Git commit preview preflight should flag binary or untracked large files without line stats."
  );
  assert(
    commitPreview.preflight.hookRiskSummary.includes("hooks"),
    "Git commit preview preflight did not disclose hook risk."
  );
  assert(
    commitPreview.validationCommands.includes("git diff --check"),
    "Git commit preview did not suggest git diff whitespace validation."
  );
  assert(
    commitPreview.operationBoundary.includes("has not staged"),
    "Git commit preview did not state the non-mutating operation boundary."
  );
  assert(
    commitPreview.readiness === "Ready" || commitPreview.readiness === "NeedsReview",
    `Git commit preview should not be blocked for the smoke fixture: ${commitPreview.readiness}.`
  );

  const branchPreview = await get("/git/branch-preview");
  assert(branchPreview.expectedHead, "Git branch preview did not include the expected head.");
  assert(branchPreview.currentBranch, "Git branch preview did not include the current branch.");
  assert(branchPreview.targetBranch, "Git branch preview did not include a target branch.");
  assert(branchPreview.preflight, "Git branch preview did not include preflight metadata.");
  assert(
    ["Valid", "Invalid", "DefaultBranch", "CurrentBranch"].includes(branchPreview.preflight.targetStatus),
    `Git branch preflight returned an unknown target status: ${branchPreview.preflight.targetStatus}.`
  );
  assert(
    ["Ready", "Detached", "DefaultBranch", "Unknown"].includes(branchPreview.preflight.currentBranchStatus),
    `Git branch preflight returned an unknown current branch status: ${branchPreview.preflight.currentBranchStatus}.`
  );
  assert(
    ["Clean", "DirtyAllowed", "DirtyBlocked"].includes(branchPreview.preflight.worktreeStatus),
    `Git branch preflight returned an unknown worktree status: ${branchPreview.preflight.worktreeStatus}.`
  );
  assert(
    ["NewLocal", "ExistingLocal", "CurrentBranch", "RemoteCollision", "Invalid"].includes(branchPreview.preflight.existingBranchStatus),
    `Git branch preflight returned an unknown existing branch status: ${branchPreview.preflight.existingBranchStatus}.`
  );
  assert(
    ["Ready", "NeedsReview", "Blocked"].includes(branchPreview.preflight.actionReadiness),
    `Git branch preflight returned an unknown action readiness: ${branchPreview.preflight.actionReadiness}.`
  );
  assert(
    branchPreview.operationBoundary.includes("has not created"),
    "Git branch preview did not state the non-mutating operation boundary."
  );

  const blockedBranch = await postExpectError("/git/branch", {
    expectedHead: "not-current-head",
    expectedCurrentBranch: branchPreview.currentBranch,
    targetBranch: branchPreview.targetBranch,
    mode: branchPreview.mode === "SwitchBranch" ? "SwitchBranch" : "CreateBranch",
    confirmation: branchPreview.mode === "SwitchBranch" ? "SwitchBranch" : "CreateBranch"
  });
  assert(blockedBranch.status === 409, `Expected stale-head branch attempt to return 409, got ${blockedBranch.status}.`);
  assert(
    blockedBranch.text.includes("Git HEAD changed since branch review"),
    "Stale-head branch attempt did not fail before git switch."
  );

  await assertGitBranchSuccessPath(branchPreview.currentBranch);

  const branchPublishPreview = await get("/git/branch-publish-preview");
  assert(branchPublishPreview.expectedHead, "Git branch publish preview did not include the expected head.");
  assert(Array.isArray(branchPublishPreview.commitsToPublish), "Git branch publish preview did not include commitsToPublish.");
  assert(branchPublishPreview.preflight, "Git branch publish preview did not include preflight metadata.");
  assert(
    ["Ready", "Detached", "DefaultBranch", "AlreadyTracking", "Missing"].includes(branchPublishPreview.preflight.branchStatus),
    `Git branch publish preflight returned an unknown branch status: ${branchPublishPreview.preflight.branchStatus}.`
  );
  assert(
    ["Ready", "Missing", "Unknown", "RemoteCollision"].includes(branchPublishPreview.preflight.remoteStatus),
    `Git branch publish preflight returned an unknown remote status: ${branchPublishPreview.preflight.remoteStatus}.`
  );
  assert(
    ["Resolved", "Missing"].includes(branchPublishPreview.preflight.baseStatus),
    `Git branch publish preflight returned an unknown base status: ${branchPublishPreview.preflight.baseStatus}.`
  );
  assert(
    ["Ready", "Empty", "Truncated"].includes(branchPublishPreview.preflight.commitStatus),
    `Git branch publish preflight returned an unknown commit status: ${branchPublishPreview.preflight.commitStatus}.`
  );
  assert(
    ["Clean", "Dirty"].includes(branchPublishPreview.preflight.worktreeStatus),
    `Git branch publish preflight returned an unknown worktree status: ${branchPublishPreview.preflight.worktreeStatus}.`
  );
  assert(
    ["Ready", "NeedsReview", "Blocked"].includes(branchPublishPreview.preflight.actionReadiness),
    `Git branch publish preflight returned an unknown action readiness: ${branchPublishPreview.preflight.actionReadiness}.`
  );
  assert(
    branchPublishPreview.preflight.failureRiskSummary.includes("classifies"),
    "Git branch publish preflight did not disclose classified remote failure handling."
  );
  assert(
    branchPublishPreview.operationBoundary.includes("has not pushed"),
    "Git branch publish preview did not state the non-mutating operation boundary."
  );

  const blockedBranchPublish = await postExpectError("/git/branch-publish", {
    expectedHead: "not-current-head",
    expectedBranch: branchPublishPreview.branch ?? "main",
    remote: branchPublishPreview.remote ?? "origin",
    remoteBranch: branchPublishPreview.remoteBranch ?? branchPublishPreview.branch ?? "main",
    confirmation: "PublishCurrentBranch"
  });
  assert(
    blockedBranchPublish.status === 409,
    `Expected stale-head branch publish attempt to return 409, got ${blockedBranchPublish.status}.`
  );
  assert(
    blockedBranchPublish.text.includes("Git HEAD changed since branch publish review"),
    "Stale-head branch publish attempt did not fail before network push."
  );

  const blockedCommit = await postExpectError("/git/commit", {
    expectedHead: "not-current-head",
    title: commitPreview.suggestedTitle,
    body: commitPreview.suggestedBody,
    paths: [appendSmokePath],
    confirmation: "CreateLocalCommit"
  });
  assert(blockedCommit.status === 409, `Expected stale-head commit attempt to return 409, got ${blockedCommit.status}.`);
  assert(
    blockedCommit.text.includes("Git HEAD changed since commit review"),
    "Stale-head commit attempt did not fail before staging."
  );

  const pushPreview = await get("/git/push-preview");
  assert(pushPreview.expectedHead, "Git push preview did not include the expected head.");
  assert(Array.isArray(pushPreview.commitsToPush), "Git push preview did not include commitsToPush.");
  assert(pushPreview.preflight, "Git push preview did not include preflight metadata.");
  assert(
    ["Ready", "Detached", "Missing"].includes(pushPreview.preflight.branchStatus),
    `Git push preflight returned an unknown branch status: ${pushPreview.preflight.branchStatus}.`
  );
  assert(
    ["Ready", "Missing", "Unpushed", "Behind", "NoAhead"].includes(pushPreview.preflight.upstreamStatus),
    `Git push preflight returned an unknown upstream status: ${pushPreview.preflight.upstreamStatus}.`
  );
  assert(
    ["Ready", "Missing", "Unknown"].includes(pushPreview.preflight.remoteStatus),
    `Git push preflight returned an unknown remote status: ${pushPreview.preflight.remoteStatus}.`
  );
  assert(
    ["Ready", "Empty", "Truncated"].includes(pushPreview.preflight.commitStatus),
    `Git push preflight returned an unknown commit status: ${pushPreview.preflight.commitStatus}.`
  );
  assert(
    ["Clean", "Dirty"].includes(pushPreview.preflight.worktreeStatus),
    `Git push preflight returned an unknown worktree status: ${pushPreview.preflight.worktreeStatus}.`
  );
  assert(
    ["Ready", "NeedsReview", "Blocked"].includes(pushPreview.preflight.actionReadiness),
    `Git push preflight returned an unknown action readiness: ${pushPreview.preflight.actionReadiness}.`
  );
  assert(
    pushPreview.preflight.failureRiskSummary.includes("classifies"),
    "Git push preflight did not disclose classified remote failure handling."
  );
  assert(
    pushPreview.operationBoundary.includes("has not pushed"),
    "Git push preview did not state the non-mutating operation boundary."
  );

  const blockedPush = await postExpectError("/git/push", {
    expectedHead: "not-current-head",
    expectedBranch: pushPreview.branch ?? "main",
    expectedUpstream: pushPreview.upstream ?? "origin/main",
    confirmation: "PushCurrentBranch"
  });
  assert(blockedPush.status === 409, `Expected stale-head push attempt to return 409, got ${blockedPush.status}.`);
  assert(
    blockedPush.text.includes("Git HEAD changed since push review"),
    "Stale-head push attempt did not fail before network push."
  );

  const pullRequestPreview = await get("/git/pr-preview");
  assert(pullRequestPreview.title, "Git PR preview did not include a suggested title.");
  assert(pullRequestPreview.suggestedBranchName, "Git PR preview did not include a suggested branch name.");
  assert(Array.isArray(pullRequestPreview.body), "Git PR preview did not include a draft body.");
  assert(Array.isArray(pullRequestPreview.testPlan), "Git PR preview did not include a test plan.");
  assert(pullRequestPreview.preflight, "Git PR preview did not include preflight metadata.");
  assert(
    ["Resolved", "Missing"].includes(pullRequestPreview.preflight.baseRefStatus),
    `Git PR preflight returned an unknown base ref status: ${pullRequestPreview.preflight.baseRefStatus}.`
  );
  assert(
    ["Ready", "Detached", "DefaultBranch"].includes(pullRequestPreview.preflight.headBranchStatus),
    `Git PR preflight returned an unknown head branch status: ${pullRequestPreview.preflight.headBranchStatus}.`
  );
  assert(
    ["Ready", "Missing", "Unpushed", "Behind"].includes(pullRequestPreview.preflight.upstreamStatus),
    `Git PR preflight returned an unknown upstream status: ${pullRequestPreview.preflight.upstreamStatus}.`
  );
  assert(
    ["Ready", "Missing", "ForkLike", "Unknown"].includes(pullRequestPreview.preflight.remoteStatus),
    `Git PR preflight returned an unknown remote status: ${pullRequestPreview.preflight.remoteStatus}.`
  );
  assert(
    Array.isArray(pullRequestPreview.preflight.testEvidence),
    "Git PR preflight did not include validation/test evidence."
  );
  assert(
    pullRequestPreview.preflight.publishReadinessSummary,
    "Git PR preflight did not include a publish readiness summary."
  );
  assert(
    pullRequestPreview.operationBoundary.includes("has not created"),
    "Git PR preview did not state the non-mutating operation boundary."
  );
  assert(
    pullRequestPreview.readiness === "Blocked" || pullRequestPreview.readiness === "NeedsReview" || pullRequestPreview.readiness === "Ready",
    `Git PR preview returned an unknown readiness value: ${pullRequestPreview.readiness}.`
  );
}

async function assertGitBranchSuccessPath(originalBranch) {
  const preview = await get(`/git/branch-preview?targetBranch=${encodeURIComponent(branchSmokeName)}`);
  assert(preview.expectedHead, "Git branch success preview did not include expected head.");
  assert(preview.currentBranch === originalBranch, "Git branch success preview did not start from the original branch.");
  assert(preview.targetBranch === branchSmokeName, "Git branch success preview returned the wrong target branch.");
  assert(preview.mode === "CreateBranch", `Git branch success preview expected CreateBranch, got ${preview.mode}.`);
  assert(preview.blockers.length === 0, `Git branch success preview was blocked: ${preview.blockers.join(" ")}`);
  assert(preview.preflight?.targetStatus === "Valid", "Git branch success preflight did not validate the target branch.");
  assert(preview.preflight?.existingBranchStatus === "NewLocal", "Git branch success preflight did not classify a new local branch.");

  try {
    const result = await post("/git/branch", {
      expectedHead: preview.expectedHead,
      expectedCurrentBranch: preview.currentBranch,
      targetBranch: preview.targetBranch,
      mode: "CreateBranch",
      confirmation: "CreateBranch"
    });

    assert(result.branch === branchSmokeName, `Git branch action created unexpected branch ${result.branch}.`);
    assert(result.mode === "CreateBranch", `Git branch action returned unexpected mode ${result.mode}.`);
    assert(
      result.operationBoundary.includes("did not commit") && result.operationBoundary.includes("push"),
      "Git branch action did not state the non-publishing operation boundary."
    );

    const current = await runGit(["branch", "--show-current"]);
    assert(current.output.trim() === branchSmokeName, "Git branch action did not switch to the new branch.");
  } finally {
    const current = await runGit(["branch", "--show-current"], { allowFailure: true });
    if (current.output.trim() === branchSmokeName && originalBranch) {
      await runGit(["switch", originalBranch], { allowFailure: true });
    }
    await runGit(["branch", "-D", branchSmokeName], { allowFailure: true });
  }

  const restored = await runGit(["branch", "--show-current"]);
  assert(restored.output.trim() === originalBranch, "Git branch success cleanup did not restore the original branch.");
}

async function createSmokeFiles() {
  for (const file of smokeFiles) {
    const absolutePath = join(repoRoot, file.relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.initialContent, "utf8");
  }

  await writeFile(join(repoRoot, binarySmokePath), Buffer.from([0, 1, 2, 3, 4, 5, 255]));
  await writeFile(
    join(repoRoot, largeDiffSmokePath),
    Array.from({ length: 6_200 }, (_, index) => `Large diff smoke line ${index}`).join("\n"),
    "utf8"
  );
}

async function cleanupSmokeFiles() {
  for (const file of smokeFiles) {
    await rm(join(repoRoot, file.relativePath), { force: true });
  }
  await rm(join(repoRoot, binarySmokePath), { force: true });
  await rm(join(repoRoot, largeDiffSmokePath), { force: true });
  await rm(join(repoRoot, createSmokePath), { force: true });
  await rm(join(repoRoot, brokenTypeScriptSmokePath), { force: true });
  for (const directory of rollbackSnapshotDirectories) {
    await rm(join(repoRoot, directory), { recursive: true, force: true });
  }
}

async function startRuntime(options = {}) {
  const child = spawn("node", ["--disable-warning=ExperimentalWarning", "dist/server.js"], {
    cwd: runtimeRoot,
    shell: false,
    env: {
      ...process.env,
      FORGE_RUNTIME_PORT: String(port),
      FORGE_RUNTIME_DB_PATH: dbPath,
      FORGE_MODEL_PROVIDER_SETTINGS_PATH: settingsPath,
      FORGE_MODEL_PROVIDER: options.providerID ?? "local",
      FORGE_MODEL_NAME: options.modelName ?? "local-deterministic-smoke",
      FORGE_OPENAI_BASE_URL: options.openAIBaseURL ?? "",
      OPENAI_API_KEY: options.openAIAPIKey ?? ""
    }
  });

  let output = "";
  let exited = false;
  let exitInfo = "process has not exited";
  const appendOutput = (chunk) => {
    output += chunk.toString("utf8");
    if (output.length > 12_000) {
      output = output.slice(output.length - 12_000);
    }
  };

  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  child.on("error", (error) => {
    exited = true;
    exitInfo = `spawn error: ${error.message}`;
  });

  const closed = new Promise((resolveClosed) => {
    child.on("exit", (code, signal) => {
      exited = true;
      exitInfo = `exit code ${code ?? "null"}, signal ${signal ?? "null"}`;
      resolveClosed({ code, signal });
    });
  });

  const handle = {
    child,
    closed,
    get output() {
      return output;
    },
    get exited() {
      return exited;
    },
    get exitInfo() {
      return exitInfo;
    }
  };

  await waitForHealth(handle);
  return handle;
}

async function startMockOpenAI() {
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/responses") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const raw = await readRequestBody(request);
    const body = JSON.parse(raw);
    const name = body?.text?.format?.name;
    requests.push({ name, body });
    const output = mockOpenAIOutput(name, requests, body);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(output)
            }
          ]
        }
      ]
    }));
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(mockOpenAIPort, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  return {
    server,
    requests,
    baseURL: `http://127.0.0.1:${mockOpenAIPort}`
  };
}

async function stopMockOpenAI(handle) {
  if (!handle) {
    return;
  }

  await new Promise((resolveClose) => handle.server.close(resolveClose));
}

function mockOpenAIOutput(name, requests, body) {
  const bodyText = JSON.stringify(body);
  if (name === "forge_intent_brief") {
    return {
      summary: "Plan the smoke task using explicitly referenced local files.",
      constraints: [
        "Use only read-only context tools before planning.",
        "Keep file changes behind human approval."
      ],
      acceptanceCriteria: [
        "The runtime records model-guided context tool calls.",
        "The revised plan is ready for human review."
      ],
      openQuestions: [],
      nextAction: "Build bounded repository context, then revise the plan."
    };
  }

  if (name === "forge_plan_context_request") {
    const contextRequestCount = requests.filter((request) => request.name === "forge_plan_context_request").length;
    if (contextRequestCount > 1) {
      return {
        status: "ReadyForPlan",
        rationale: "The requested fixture and architecture context are already available.",
        searchTerms: [],
        readPaths: []
      };
    }

    return {
      status: "SearchAndRead",
      rationale: "The task names a smoke fixture and runtime architecture docs, so inspect those before planning.",
      searchTerms: ["smoke", "runtime", "architecture"],
      readPaths: [appendSmokePath, "docs/runtime_architecture.md"]
    };
  }

  if (name === "forge_plan_revision") {
    return {
      intentSummary: "Verify OpenAI model-guided context before a plan revision.",
      summary: "Model-guided context was requested and the plan is ready for review.",
      rationale: "The runtime should own tool execution while the provider chooses useful read-only context.",
      riskLevel: "Low",
      steps: [
        {
          id: "read-context",
          title: "Read model-requested context",
          status: "Done",
          summary: "Inspect the referenced smoke fixture and architecture docs."
        },
        {
          id: "revise-plan",
          title: "Revise the plan",
          status: "Done",
          summary: "Use inspected context to make the plan reviewable."
        },
        {
          id: "request-human-review",
          title: "Request human review",
          status: "Active",
          summary: "Pause before file, command, or git side effects."
        }
      ]
    };
  }

  if (name === "forge_execution_proposal") {
    return {
      summary: "Prepare a reviewable edit proposal after model-guided context.",
      proposedActions: [
        "Propose one safe append to the referenced smoke fixture.",
        "Include one create-file preview so the review surface can show unsupported future work.",
        "Keep all file writes behind validation and human approval."
      ],
      riskLevel: "Medium"
    };
  }

  if (name === "forge_validation_repair_brief") {
    return {
      summary: "Runtime TypeScript validation failed after the reviewed edit; inspect the temporary syntax error before retrying.",
      likelyCause: "The validation output reports a TypeScript syntax error in the temporary smoke fixture.",
      recommendedActions: [
        "Remove or fix the invalid TypeScript fixture.",
        "Generate a revised proposal only if the reviewed edit caused the failure.",
        "Rerun the approved runtime-typescript preset after the repair is reviewed."
      ],
      followUpPrompt: "Repair the TypeScript validation failure, then rerun runtime-typescript.",
      riskLevel: "Medium"
    };
  }

  if (name === "forge_edit_proposal") {
    if (bodyText.includes("validation failure repair brief")) {
      if (bodyText.includes("followUpPrompt")) {
        return {
          summary: "Generate a follow-up proposal from the validation repair brief.",
          riskLevel: "Medium",
          fileChanges: [
            {
              path: appendSmokePath,
              changeType: "Modify",
              rationale: "Use the repair brief to propose the next reviewed fix without applying it automatically.",
              diffPreview: [
                `--- a/${appendSmokePath}`,
                `+++ b/${appendSmokePath}`,
                "@@ validation repair follow-up @@",
                "+",
                "+## OpenAI Validation Repair Follow-up",
                "+",
                "+- Proposed from the validation repair brief after a failed runtime check."
              ].join("\n"),
              operationKind: "AppendText",
              appendText: "\n## OpenAI Validation Repair Follow-up\n\n- Proposed from the validation repair brief after a failed runtime check.\n",
              findText: "",
              replaceWith: "",
              content: ""
            }
          ]
        };
      }

      return {
        summary: "Propose a safe append before validation failure analysis.",
        riskLevel: "Low",
        fileChanges: [
          {
            path: appendSmokePath,
            changeType: "Modify",
            rationale: "Add a distinct note before forcing a separate validation failure.",
            diffPreview: [
              `--- a/${appendSmokePath}`,
              `+++ b/${appendSmokePath}`,
              "@@ validation repair append @@",
              "+",
              "+## OpenAI Validation Repair Smoke",
              "+",
              "+- Prepared a reviewed edit before validation failure analysis."
            ].join("\n"),
            operationKind: "AppendText",
            appendText: "\n## OpenAI Validation Repair Smoke\n\n- Prepared a reviewed edit before validation failure analysis.\n",
            findText: "",
            replaceWith: "",
            content: ""
          }
        ]
      };
    }

    if (bodyText.includes("auto-repair blocked proposal")) {
      if (!bodyText.includes("validationFeedback")) {
        return {
          summary: "Start with an unsupported preview-only patch so the runtime can repair it.",
          riskLevel: "Medium",
          fileChanges: [
            {
              path: appendSmokePath,
              changeType: "Modify",
              rationale: "Represent the first attempt as an unsupported broad patch.",
              diffPreview: [
                `--- a/${appendSmokePath}`,
                `+++ b/${appendSmokePath}`,
                "@@ first unsupported attempt @@",
                "+This patch should be repaired into a restricted operation."
              ].join("\n"),
              operationKind: "PreviewOnly",
              appendText: "",
              findText: "",
              replaceWith: "",
              content: ""
            }
          ]
        };
      }

      return {
        summary: "Repair the blocked proposal into a safe append operation.",
        riskLevel: "Low",
        fileChanges: [
          {
            path: appendSmokePath,
            changeType: "Modify",
            rationale: "Address runtime validation feedback by switching to an apply-ready append operation.",
            diffPreview: [
              `--- a/${appendSmokePath}`,
              `+++ b/${appendSmokePath}`,
              "@@ repaired safe append @@",
              "+",
              "+## OpenAI Auto Repair Smoke",
              "+",
              "+- Repaired a preview-only proposal into a restricted append."
            ].join("\n"),
            operationKind: "AppendText",
            appendText: "\n## OpenAI Auto Repair Smoke\n\n- Repaired a preview-only proposal into a restricted append.\n",
            findText: "",
            replaceWith: "",
            content: ""
          }
        ]
      };
    }

    if (bodyText.includes("preview-only blocked proposal")) {
      return {
        summary: "Preview an unsupported patch without allowing apply.",
        riskLevel: "Medium",
        fileChanges: [
          {
            path: appendSmokePath,
            changeType: "Modify",
            rationale: "Represent a broad patch as a review-only artifact.",
            diffPreview: [
              `--- a/${appendSmokePath}`,
              `+++ b/${appendSmokePath}`,
              "@@ preview-only unsupported patch @@",
              "+This patch is intentionally preview-only."
            ].join("\n"),
            operationKind: "PreviewOnly",
            appendText: "",
            findText: "",
            replaceWith: "",
            content: ""
          }
        ]
      };
    }

    return {
      summary: "Propose a safe append plus a safe Markdown create-file change.",
      riskLevel: "Medium",
      fileChanges: [
        {
          path: appendSmokePath,
          changeType: "Modify",
          rationale: "Add an audit note to the explicit smoke fixture using the current v0 append operation.",
          diffPreview: [
            `--- a/${appendSmokePath}`,
            `+++ b/${appendSmokePath}`,
            "@@ proposed safe append @@",
            "+",
            "+## OpenAI Context Smoke",
            "+",
            "+- Verified model-guided context before edit proposal generation."
          ].join("\n"),
          operationKind: "AppendText",
          appendText: "\n## OpenAI Context Smoke\n\n- Verified model-guided context before edit proposal generation.\n",
          findText: "",
          replaceWith: "",
          content: ""
        },
        {
          path: createSmokePath,
          changeType: "Create",
          rationale: "Create a new Markdown smoke artifact inside the docs boundary.",
          diffPreview: [
            "--- /dev/null",
            `+++ b/${createSmokePath}`,
            "@@ create file @@",
            "+# OpenAI Created Smoke",
            "+",
            "+Preview created by the OpenAI smoke flow."
          ].join("\n"),
          operationKind: "CreateFile",
          appendText: "",
          findText: "",
          replaceWith: "",
          content: "# OpenAI Created Smoke\n\nPreview created by the OpenAI smoke flow.\n"
        }
      ]
    };
  }

  throw new Error(`Unexpected mock OpenAI structured output request: ${name}`);
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function stopRuntime(handle) {
  if (!handle || handle.exited) {
    return;
  }

  handle.child.kill("SIGTERM");
  const closed = await Promise.race([
    handle.closed.then(() => true),
    sleep(2500).then(() => false)
  ]);

  if (!closed && !handle.exited) {
    handle.child.kill("SIGKILL");
    await handle.closed;
  }
}

async function waitForHealth(handle) {
  const deadline = Date.now() + 10_000;
  let lastError = "";

  while (Date.now() < deadline) {
    if (handle.exited) {
      throw new Error(`Runtime exited before health check succeeded: ${handle.exitInfo}\n${handle.output}`);
    }

    try {
      const health = await get("/health");
      if (health.ok === true && health.persistence?.databasePath === dbPath) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting for runtime health: ${lastError}\n${handle.output}`);
}

async function waitForTask(taskID, predicate, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastTask;

  while (Date.now() < deadline) {
    const response = await get("/tasks");
    lastTask = response.tasks?.find((task) => task.id === taskID);
    if (lastTask && predicate(lastTask)) {
      return lastTask;
    }

    await sleep(150);
  }

  throw new Error(`Timed out waiting for ${label}.\nLast task: ${JSON.stringify(summarizeTask(lastTask), null, 2)}`);
}

async function get(path) {
  return request("GET", path);
}

async function post(path, body) {
  return request("POST", path, body);
}

async function postExpectError(path, body) {
  return requestExpectError("POST", path, body);
}

async function runGit(args, options = {}) {
  const child = spawn("git", args, {
    cwd: repoRoot,
    shell: false
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });

  const exitCode = await new Promise((resolveExit) => {
    child.on("exit", (code) => resolveExit(code ?? 1));
    child.on("error", () => resolveExit(1));
  });

  const result = { exitCode, output };
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(" ")} failed with ${exitCode}: ${output.slice(0, 1200)}`);
  }

  return result;
}

async function getText(path) {
  const response = await fetch(`${baseURL}${path}`);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${text.slice(0, 1200)}`);
  }

  return text;
}

async function request(method, path, body) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 1200)}`);
  }

  return parsed;
}

async function requestExpectError(method, path, body) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();

  if (response.ok) {
    throw new Error(`${method} ${path} unexpectedly succeeded: ${text.slice(0, 1200)}`);
  }

  return { status: response.status, text };
}

async function readPersistedModelProviderSettings() {
  const raw = await readFile(settingsPath, "utf8");
  return JSON.parse(raw);
}

function assertProposal(task, expectedPath, expectedOperation) {
  assertState(task, "Human Review", "Edit Proposal Review");
  assert(task.editProposal?.status === "Proposed", "Task does not have a proposed edit proposal.");
  assert(task.editProposal.validation?.status === "Ready", task.editProposal.validation?.summary ?? "Proposal validation is not ready.");

  const changes = task.editProposal.fileChanges ?? [];
  assert(changes.length === 1, `Expected exactly one file change, got ${changes.length}.`);

  const change = changes[0];
  assert(change.path === expectedPath, `Expected proposal path ${expectedPath}, got ${change.path}.`);
  assert(
    change.applyOperation?.kind === expectedOperation,
    `Expected ${expectedOperation}, got ${change.applyOperation?.kind ?? "missing operation"}.`
  );
  assert(
    task.editProposal.validation.fileResults?.every((result) => result.status === "Ready"),
    "Expected every proposal file validation result to be Ready."
  );
}

function assertCompletedTask(task, expectedChangedFile) {
  assertState(task, "Completed", "Validation Passed");
  assert(task.changedFiles?.includes(expectedChangedFile), `Changed files did not include ${expectedChangedFile}.`);
  assert(task.editProposal?.status === "Applied", "Completed task does not have an applied edit proposal.");
  assertAppliedChangeMetadata(task, expectedChangedFile);
  assert(
    task.validationRuns?.some((run) => run.presetID === "forge-post-apply" && run.status === "Passed"),
    "Completed task does not include a passed forge-post-apply validation run."
  );
}

function assertAppliedChangeMetadata(task, expectedChangedFile, expectedOperation) {
  const appliedChange = task.editProposal?.appliedFileChanges?.find((change) => change.path === expectedChangedFile);
  assert(appliedChange, `Applied change metadata did not include ${expectedChangedFile}.`);
  if (expectedOperation) {
    assert(
      appliedChange.operationKind === expectedOperation,
      `Expected applied operation ${expectedOperation}, got ${appliedChange.operationKind}.`
    );
  }
  assert(appliedChange.appliedAt, "Applied change metadata did not include appliedAt.");
  assert(["RestorePreviousContent", "DeleteCreatedFile"].includes(appliedChange.rollbackKind), "Applied change metadata has an unknown rollback kind.");
  assert(appliedChange.rollbackSummary, "Applied change metadata did not include a rollback summary.");
  assert(appliedChange.afterSha256?.length === 64, "Applied change metadata did not include an after SHA-256.");
  assert(
    typeof appliedChange.afterByteLength === "number" && appliedChange.afterByteLength > 0,
    "Applied change metadata did not include an after byte length."
  );

  if (appliedChange.rollbackKind === "RestorePreviousContent") {
    assert(appliedChange.beforeSha256?.length === 64, "Restore rollback metadata did not include a before SHA-256.");
    assert(
      typeof appliedChange.beforeByteLength === "number" && appliedChange.beforeByteLength > 0,
      "Restore rollback metadata did not include a before byte length."
    );
    assert(appliedChange.rollbackSnapshotPath, "Restore rollback metadata did not include a snapshot path.");
    rollbackSnapshotDirectories.add(dirname(appliedChange.rollbackSnapshotPath));
    assert(
      appliedChange.beforeSha256 !== appliedChange.afterSha256,
      "Restore rollback metadata should show different before and after hashes."
    );
  }

  return appliedChange;
}

function assertExecutionProposalContext(task, expectedPath) {
  const proposal = task.executionProposal;
  assert(proposal, "Task does not have an execution proposal.");
  assert(
    proposal.contextFiles?.some((file) => file.path === expectedPath),
    `Execution proposal did not include expected context file ${expectedPath}.`
  );
  assert(
    proposal.toolEvidence?.some((line) => line.includes("Scanned")) &&
      proposal.toolEvidence?.some((line) => line.includes("Read")),
    "Execution proposal did not include read-only tool evidence."
  );
  assert(
    task.events?.some((event) => event.type === "agent.execution_context.completed"),
    "Task did not record execution context completion event."
  );
}

function assertResolvedReference(task, expectedPath) {
  const references = (task.messages ?? []).flatMap((message) => message.fileReferences ?? []);
  assert(
    references.some((reference) => reference.path === expectedPath && reference.status === "Resolved"),
    `Task did not resolve expected file reference ${expectedPath}.`
  );
}

function assertState(task, status, phase) {
  const summary = JSON.stringify(summarizeTask(task), null, 2);
  assert(task.status === status, `Expected task status ${status}, got ${task.status}.\n${summary}`);
  assert(task.currentPhase === phase, `Expected task phase ${phase}, got ${task.currentPhase}.\n${summary}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function summarizeTask(task) {
  if (!task) {
    return undefined;
  }

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    currentPhase: task.currentPhase,
    reviewSummary: task.reviewSummary,
    changedFiles: task.changedFiles,
    editProposal: task.editProposal
      ? {
          status: task.editProposal.status,
          summary: task.editProposal.summary,
          validation: task.editProposal.validation?.summary,
          fileResults: task.editProposal.validation?.fileResults,
          changes: task.editProposal.fileChanges?.map((change) => ({
            path: change.path,
            operation: change.applyOperation?.kind
          }))
        }
      : undefined,
    latestEvents: task.events?.slice(-6)
  };
}
