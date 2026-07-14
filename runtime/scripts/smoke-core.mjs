#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

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
const unifiedDiffSmokePathOne = `runtime/src/${smokeID}-unified-one.ts`;
const unifiedDiffSmokePathTwo = `runtime/src/${smokeID}-unified-two.ts`;
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
  },
  {
    relativePath: unifiedDiffSmokePathOne,
    initialContent: [
      "export function forgeUnifiedGreeting(name: string) {",
      "  const label = \"hello\";",
      "  return `${label}, ${name}`;",
      "}",
      ""
    ].join("\n")
  },
  {
    relativePath: unifiedDiffSmokePathTwo,
    initialContent: [
      "export const forgeUnifiedRetry = {",
      "  attempts: 2,",
      "  backoff: true",
      "};",
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
  const taskCommandTask = await runTaskCommandFlow();
  const cancelledTaskCommandTask = await runTaskCommandCancellationFlow();

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
  const openAIUnifiedDiffTask = await runOpenAIUnifiedDiffTransactionFlow();
  const openAIApplyRecoveryTask = await runOpenAIApplyRecoveryFlow();
  const openAIAgentRunStepTask = await runOpenAIAgentRunStepFlow();
  const openAIRepositoryInspectionTask = await runOpenAIRepositoryInspectionLoopFlow();
  const openAIFileReviewRevisionTask = await runOpenAIFileReviewRevisionFlow();
  const openAIInspectionRepeatGuardTask = await runOpenAIInspectionRepeatGuardFlow();
  const openAIAgentStepOutputRecoveryTask = await runOpenAIAgentStepOutputRecoveryFlow();
  const openAIAgentStepOutputFailureTask = await runOpenAIAgentStepOutputFailureFlow();
  const openAIAgentRunLoopTask = await runOpenAIAgentRunLoopFlow();
  const openAIAgentLoopControlsTask = await runOpenAIAgentLoopControlsFlow();
  const openAIAutoRepairTask = await runOpenAIAutoRepairFlow();
  const openAIValidationRepairTask = await runOpenAIValidationFailureRepairFlow();
  const openAITaskCommandRepairTask = await runOpenAITaskCommandFailureRepairFlow();
  const openAIPreviewBlockedTask = await runOpenAIPreviewBlockedFlow();
  const restartFixtureTask = await prepareOpenAIAgentLoopRestartFixture();
  await stopRuntime(runtime);
  runtime = undefined;
  markAgentLoopRunningInDatabase(restartFixtureTask.id);
  runtime = await startRuntime({
    providerID: "openai",
    modelName: "openai-context-smoke",
    openAIBaseURL: mockOpenAI.baseURL,
    openAIAPIKey: "sk-forge-smoke"
  });
  const openAIAgentLoopRestartTask = await assertOpenAIAgentLoopRestartRecovery(restartFixtureTask.id);

  console.log("Core runtime smoke passed.");
  console.log(`- Runtime: ${baseURL}`);
  console.log(`- Append task: ${appendTask.id}`);
  console.log(`- Replace task: ${replaceTask.id}`);
  console.log(`- Source replace task: ${sourceReplaceTask.id}`);
  console.log(`- Source patch task: ${sourcePatchTask.id}`);
  console.log(`- Task command task: ${taskCommandTask.id}`);
  console.log(`- Cancelled task command task: ${cancelledTaskCommandTask.id}`);
  console.log(`- OpenAI context task: ${openAIContextTask.id}`);
  console.log(`- OpenAI unified diff task: ${openAIUnifiedDiffTask.id}`);
  console.log(`- OpenAI apply recovery task: ${openAIApplyRecoveryTask.id}`);
  console.log(`- OpenAI agent run step task: ${openAIAgentRunStepTask.id}`);
  console.log(`- OpenAI repository inspection task: ${openAIRepositoryInspectionTask.id}`);
  console.log(`- OpenAI file review revision task: ${openAIFileReviewRevisionTask.id}`);
  console.log(`- OpenAI inspection repeat guard task: ${openAIInspectionRepeatGuardTask.id}`);
  console.log(`- OpenAI agent step output recovery task: ${openAIAgentStepOutputRecoveryTask.id}`);
  console.log(`- OpenAI agent step output failure task: ${openAIAgentStepOutputFailureTask.id}`);
  console.log(`- OpenAI agent run loop task: ${openAIAgentRunLoopTask.id}`);
  console.log(`- OpenAI agent loop controls task: ${openAIAgentLoopControlsTask.id}`);
  console.log(`- OpenAI auto-repair task: ${openAIAutoRepairTask.id}`);
  console.log(`- OpenAI validation repair task: ${openAIValidationRepairTask.id}`);
  console.log(`- OpenAI task command repair task: ${openAITaskCommandRepairTask.id}`);
  console.log(`- OpenAI preview-blocked task: ${openAIPreviewBlockedTask.id}`);
  console.log(`- OpenAI agent loop restart task: ${openAIAgentLoopRestartTask.id}`);
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

  const unreviewedApply = await postExpectError(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke verifies file review is required before apply."
  });
  assert(unreviewedApply.status === 409, `Expected unreviewed apply 409, got ${unreviewedApply.status}.`);
  assert(unreviewedApply.text.includes("Every proposed file must be approved"), "Unreviewed apply did not report the file review gate.");
  current = await approveAllProposalFiles(current);
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

  current = await approveAllProposalFiles(current);
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

  current = await approveAllProposalFiles(current);
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

  current = await approveAllProposalFiles(current);
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

async function runTaskCommandFlow() {
  const task = await createTask({
    title: "Smoke task command run",
    objective: "Approve and run an allowlisted runtime command without applying an edit proposal."
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "task command task to reach initial plan review"
  );

  const blocked = await postExpectError(`/tasks/${task.id}/run-task-command`, {
    commandID: "runtime-npm-check"
  });
  assert(blocked.status === 409, `Expected unapproved task command to be blocked, got ${blocked.status}.`);
  assert(
    blocked.text.includes("requires approval"),
    `Expected unapproved task command response to mention approval: ${blocked.text}`
  );

  let permissions = await get(`/tasks/${task.id}/validation-permissions`);
  const blockedRuntimeCommandPermission = permissions.taskCommands?.find((permission) =>
    permission.command?.id === "runtime-npm-check"
  );
  assert(blockedRuntimeCommandPermission, "Task command permissions did not include runtime-npm-check.");
  assert(
    blockedRuntimeCommandPermission.executionState === "NeedsApproval" &&
      blockedRuntimeCommandPermission.canRun === false,
    `Expected runtime-npm-check to need approval: ${JSON.stringify(blockedRuntimeCommandPermission)}`
  );
  assert(
    blockedRuntimeCommandPermission.command.executionMode === "SpawnNoShell",
    "Task command permission did not expose the no-shell execution boundary."
  );
  assert(
    !permissions.taskCommands?.some((permission) => permission.command?.kind === "BuiltIn"),
    "Task command chooser should expose project commands, not built-in post-apply checks."
  );

  let current = await post(`/tasks/${task.id}/approve-validation-preset`, {
    presetID: "runtime-typescript",
    note: "Core smoke test approves runtime command execution."
  });
  assert(
    current.approvals?.some((approval) => approval.action === "Approve Validation Preset" && approval.targetID === "runtime-typescript"),
    "Task command flow did not approve the runtime-typescript preset."
  );

  permissions = await get(`/tasks/${task.id}/validation-permissions`);
  const readyRuntimeCommandPermission = permissions.taskCommands?.find((permission) =>
    permission.command?.id === "runtime-npm-check"
  );
  const readyRuntimeBuildPermission = permissions.taskCommands?.find((permission) =>
    permission.command?.id === "runtime-npm-build"
  );
  assert(
    readyRuntimeCommandPermission?.canRun === true &&
      readyRuntimeCommandPermission.executionState === "Ready" &&
      readyRuntimeCommandPermission.presetID === "runtime-typescript",
    `Expected approved runtime-npm-check to be runnable: ${JSON.stringify(readyRuntimeCommandPermission)}`
  );
  assert(
    readyRuntimeBuildPermission?.canRun === true &&
      readyRuntimeBuildPermission.executionState === "Ready",
    `Expected approved runtime-npm-build to be runnable through the chooser: ${JSON.stringify(readyRuntimeBuildPermission)}`
  );

  const collected = await collectRuntimeEventsDuring(async () =>
    post(`/tasks/${task.id}/run-task-command`, {
      commandID: "runtime-npm-check"
    })
  );
  current = collected.result;
  assertState(current, "Human Review", "Command Passed");

  const commandRun = current.taskCommandRuns?.at(-1);
  assert(commandRun, "Task command flow did not record a task command run.");
  assert(commandRun.commandID === "runtime-npm-check", `Expected runtime-npm-check, got ${commandRun.commandID}.`);
  assert(commandRun.status === "Passed", `Task command did not pass: ${commandRun.outputSummary}`);
  assert(commandRun.exitCode === 0, `Expected task command exit code 0, got ${commandRun.exitCode}.`);
  assert(commandRun.outputSummary.includes("npm run check exited with code 0"), "Task command summary did not include the exit code.");
  assert(commandRun.outputChunks?.length > 0, "Task command flow did not persist output chunks.");
  assert(
    commandRun.outputChunks.some((chunk) => chunk.stream === "stdout" || chunk.stream === "stderr"),
    "Task command flow did not persist process stdout/stderr chunks."
  );
  assert(commandRun.presetID === "runtime-typescript", "Task command run did not retain the approving preset id.");
  assert(
    current.events?.some((event) => event.type === "task.command.passed"),
    "Task command flow did not record a passed event."
  );
  assert(
    current.planSteps?.some((step) => step.id === "run-task-command-runtime-npm-check" && step.status === "Done"),
    "Task command flow did not update the task plan step."
  );
  assert(
    collected.events.some((event) => event.type === "task.command.started" && event.data?.taskID === current.id),
    "Task command flow did not stream a started event."
  );
  assert(
    collected.events.some((event) => event.type === "task.command.output" && event.data?.taskCommandRunID === commandRun.id),
    "Task command flow did not stream output chunks."
  );
  assert(
    collected.events.some((event) => event.type === "task.command.completed" && event.data?.taskCommandRunID === commandRun.id),
    "Task command flow did not stream a completed event."
  );

  permissions = await get(`/tasks/${task.id}/validation-permissions`);
  const completedRuntimeCommandPermission = permissions.taskCommands?.find((permission) =>
    permission.command?.id === "runtime-npm-check"
  );
  assert(
    completedRuntimeCommandPermission?.lastRun?.status === "Passed" &&
      completedRuntimeCommandPermission.lastRun.id === commandRun.id,
    `Task command permission did not retain the last run: ${JSON.stringify(completedRuntimeCommandPermission)}`
  );

  return current;
}

async function runTaskCommandCancellationFlow() {
  const task = await createTask({
    title: "Smoke task command cancellation",
    objective: "Start and cancel a long-running allowlisted runtime command."
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "task command cancellation task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    note: "Core smoke test approves the long-running task command fixture."
  });
  assert(
    current.approvals?.some((approval) => approval.action === "Approve Validation Preset" && approval.targetID === "smoke-task-commands"),
    "Task command cancellation flow did not approve the smoke-task-commands preset."
  );

  const controller = new AbortController();
  const events = [];
  const streamPromise = collectRuntimeEvents(controller, events);
  await sleep(100);

  const runPromise = post(`/tasks/${task.id}/run-task-command`, {
    commandID: "smoke-long-task-command"
  });

  current = await waitForTask(
    task.id,
    (candidate) => candidate.taskCommandRuns?.some((run) => run.commandID === "smoke-long-task-command" && run.status === "Running"),
    "long-running task command to enter Running"
  );

  const runningRun = current.taskCommandRuns?.find(
    (run) => run.commandID === "smoke-long-task-command" && run.status === "Running"
  );
  assert(runningRun, "Task command cancellation flow did not observe a running task command.");

  current = await post(`/tasks/${task.id}/cancel-task-command`, {
    taskCommandRunID: runningRun.id,
    note: "Core smoke test cancels the long-running task command."
  });
  assert(
    current.approvals?.some((approval) => approval.action === "Cancel Task Command" && approval.targetID === runningRun.id),
    "Task command cancellation flow did not record a cancel approval."
  );
  assert(
    current.events?.some((event) => event.type === "task.command.cancel.requested"),
    "Task command cancellation flow did not record a cancel requested event."
  );

  current = await runPromise;
  assertState(current, "Human Review", "Command Cancelled");
  const cancelledRun = current.taskCommandRuns?.find((run) => run.id === runningRun.id);
  assert(cancelledRun?.status === "Cancelled", `Expected cancelled task command, got ${cancelledRun?.status}.`);
  assert(cancelledRun.exitCode === 130, `Expected cancelled task command exit code 130, got ${cancelledRun.exitCode}.`);
  assert(
    cancelledRun.outputSummary.includes("cancelled by user"),
    `Cancelled task command summary did not mention cancellation: ${cancelledRun.outputSummary}`
  );
  assert(
    cancelledRun.outputChunks?.some((chunk) => chunk.stream === "system" && chunk.text.includes("Cancellation requested")),
    "Cancelled task command did not persist the cancellation system chunk."
  );
  assert(
    current.events?.some((event) => event.type === "task.command.cancelled"),
    "Task command cancellation flow did not record a cancelled event."
  );
  assert(
    !current.validationRepairBriefs?.some((brief) => brief.taskCommandRunID === runningRun.id),
    "Task command cancellation should not create a repair brief."
  );

  const deadline = Date.now() + 2_000;
  while (
    Date.now() < deadline &&
    !events.some((event) => event.type === "task.command.completed" && event.data?.taskCommandRunID === runningRun.id)
  ) {
    await sleep(50);
  }

  controller.abort();
  await streamPromise;
  assert(
    events.some((event) => event.type === "task.command.cancel.requested" && event.data?.taskID === current.id),
    "Task command cancellation flow did not stream the cancel requested event."
  );
  assert(
    events.some((event) => event.type === "task.command.cancelled" && event.data?.taskID === current.id),
    "Task command cancellation flow did not stream the cancelled event."
  );
  assert(
    events.some((event) => event.type === "task.command.completed" && event.data?.taskCommandRunID === runningRun.id),
    "Task command cancellation flow did not stream the completed event."
  );

  const afterComplete = await postExpectError(`/tasks/${task.id}/cancel-task-command`, {
    taskCommandRunID: runningRun.id
  });
  assert(afterComplete.status === 409, `Expected completed cancellation to be rejected, got ${afterComplete.status}.`);
  assert(afterComplete.text.includes("not running"), `Expected completed cancellation error to mention not running: ${afterComplete.text}`);

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

  current = await approveAllProposalFiles(current);
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

async function runOpenAIUnifiedDiffTransactionFlow() {
  const task = await createTask({
    title: "OpenAI unified diff transaction smoke",
    objective: `Apply a reviewed cross-file unified diff to @${unifiedDiffSmokePathOne} and @${unifiedDiffSmokePathTwo}, then verify rollback.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "unified diff task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/generate-plan-revision`, {});
  assertState(current, "Human Review", "Plan Review");

  current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the cross-file unified diff plan."
  });
  assert(current.executionProposal, "Unified diff flow did not create an execution proposal.");

  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assert(current.editProposal?.status === "Proposed", "Unified diff flow did not create a proposed edit.");
  assert(current.editProposal?.fileChanges?.length === 2, "Unified diff flow did not propose two file changes.");
  assert(
    current.editProposal.fileChanges.every((change) => change.applyOperation?.kind === "UnifiedDiff"),
    "Unified diff flow did not normalize both operations as UnifiedDiff."
  );
  assert(
    current.editProposal.validation?.fileResults?.every((result) =>
      result.status === "Ready" &&
      result.checks?.some((check) => check.includes("context and deletion line matches"))
    ),
    "Unified diff validation did not record strict context matching for both files."
  );

  current = await approveAllProposalFiles(current);
  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the cross-file unified diff transaction."
  });
  assertState(current, "Completed", "Validation Passed");
  assert(current.editProposal?.applyTransaction?.status === "Completed", "Unified diff apply transaction did not complete.");
  assert(current.editProposal.applyTransaction.paths?.length === 2, "Unified diff apply transaction did not record two paths.");
  assert(current.editProposal.applyTransaction.verifiedAt, "Unified diff apply transaction did not record verification.");

  const firstApplied = await readFile(join(repoRoot, unifiedDiffSmokePathOne), "utf8");
  const secondApplied = await readFile(join(repoRoot, unifiedDiffSmokePathTwo), "utf8");
  assert(firstApplied.includes('const punctuation = "!";'), "Unified diff did not add the first-file line.");
  assert(firstApplied.includes("${name}${punctuation}"), "Unified diff did not rewrite the first-file return line.");
  assert(secondApplied.includes("attempts: 3"), "Unified diff did not update the second-file value.");
  assert(!secondApplied.includes("backoff"), "Unified diff did not delete the second-file line.");
  for (const expectedPath of [unifiedDiffSmokePathOne, unifiedDiffSmokePathTwo]) {
    const applied = assertAppliedChangeMetadata(current, expectedPath, "UnifiedDiff");
    assert(applied.applyVerifiedAt, `Unified diff apply did not verify ${expectedPath}.`);
  }

  current = await post(`/tasks/${task.id}/rollback-edit-proposal`, {
    note: "Core smoke test rolls back the cross-file unified diff transaction."
  });
  assertState(current, "Human Review", "Rollback Applied");
  assert(current.editProposal?.rollbackTransaction?.status === "Completed", "Unified diff rollback transaction did not complete.");
  assert(current.editProposal.rollbackTransaction.verifiedAt, "Unified diff rollback transaction did not record verification.");
  for (const expectedPath of [unifiedDiffSmokePathOne, unifiedDiffSmokePathTwo]) {
    const applied = assertAppliedChangeMetadata(current, expectedPath, "UnifiedDiff");
    assert(applied.rollbackVerifiedAt, `Unified diff rollback did not verify ${expectedPath}.`);
  }

  const firstRestored = await readFile(join(repoRoot, unifiedDiffSmokePathOne), "utf8");
  const secondRestored = await readFile(join(repoRoot, unifiedDiffSmokePathTwo), "utf8");
  assert(firstRestored.includes('const label = "hello";'), "Unified diff rollback did not restore the first file.");
  assert(!firstRestored.includes("punctuation"), "Unified diff rollback left added first-file content.");
  assert(secondRestored.includes("attempts: 2"), "Unified diff rollback did not restore the second-file value.");
  assert(secondRestored.includes("backoff: true"), "Unified diff rollback did not restore the deleted line.");

  return current;
}

async function runOpenAIApplyRecoveryFlow() {
  const task = await createTask({
    title: "OpenAI apply recovery smoke",
    objective: `Verify automatic cross-file apply recovery for @${unifiedDiffSmokePathOne} and @${unifiedDiffSmokePathTwo}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "apply recovery task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/generate-plan-revision`, {});
  current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the recoverable cross-file apply."
  });
  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  assert(current.editProposal?.validation?.status === "Ready", "Apply recovery proposal was not ready before fault injection.");

  const protectedPath = join(repoRoot, unifiedDiffSmokePathTwo);
  current = await approveAllProposalFiles(current);
  await chmod(protectedPath, 0o444);
  try {
    const failedApply = await postExpectError(`/tasks/${task.id}/apply-edit-proposal`, {
      note: "Core smoke test intentionally makes the second file read-only."
    });
    assert(failedApply.status === 500, `Expected recoverable apply to fail with 500, got ${failedApply.status}.`);
    assert(
      failedApply.text.includes("Automatic recovery restored and verified 1 previously written file"),
      `Apply recovery response did not include compensation evidence: ${failedApply.text}`
    );

    const taskList = await get("/tasks");
    current = taskList.tasks?.find((candidate) => candidate.id === task.id);
    assert(current, "Recovered apply task was not present in the task list.");
    assertState(current, "Failed", "Apply Recovered");
    assert(current.editProposal?.status === "Proposed", "Recovered apply should keep the proposal reviewable.");
    assert(current.editProposal?.applyTransaction?.status === "Recovered", "Apply transaction was not marked Recovered.");
    assert(current.editProposal.applyTransaction.verifiedAt, "Recovered apply transaction did not record verification.");
    assert(
      current.events?.some((event) => event.type === "edit.proposal.apply.recovered"),
      "Recovered apply did not record the recovery event."
    );

    const firstRestored = await readFile(join(repoRoot, unifiedDiffSmokePathOne), "utf8");
    const secondUntouched = await readFile(protectedPath, "utf8");
    assert(firstRestored.includes('const label = "hello";'), "Apply recovery did not restore the first file.");
    assert(!firstRestored.includes("punctuation"), "Apply recovery left the first file partially changed.");
    assert(secondUntouched.includes("attempts: 2"), "Faulted second file should remain unchanged.");
  } finally {
    await chmod(protectedPath, 0o644);
  }

  return current;
}

async function runOpenAIAgentRunStepFlow() {
  const task = await createTask({
    title: "Smoke OpenAI agent run step",
    objective: `Run an agent run step smoke against @${appendSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "OpenAI agent run step task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the agent run step plan."
  });
  assert(current.executionProposal, "OpenAI agent run step flow did not create an execution proposal.");

  const proposalStep = await collectRuntimeEventsDuring(
    () => post(`/tasks/${task.id}/run-agent-step`, {}),
    (event, result) => event.type === "agent.run_step.completed" && event.data?.taskID === result.id
  );
  current = proposalStep.result;
  assertState(current, "Human Review", "Edit Proposal Review");
  assert(current.editProposal?.status === "Proposed", "Agent run step did not create an edit proposal.");
  const generatedStep = current.agentRunSteps?.at(-1);
  assert(generatedStep?.action === "GenerateEditProposal", `Expected GenerateEditProposal, got ${generatedStep?.action}.`);
  assert(generatedStep.status === "Completed", `Expected generated step Completed, got ${generatedStep.status}.`);
  assert(generatedStep.targetID === current.editProposal.id, "Agent run step did not link the generated edit proposal.");
  assert(
    proposalStep.events.some((event) => event.type === "agent.run_step.started" && event.data?.taskID === current.id),
    "Agent run step flow did not stream the started event for proposal generation."
  );
  assert(
    proposalStep.events.some((event) => event.type === "agent.run_step.completed" && event.data?.taskID === current.id),
    "Agent run step flow did not stream the completed event for proposal generation."
  );

  current = await approveAllProposalFiles(current);
  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the agent-generated proposal."
  });
  assertCompletedTask(current, appendSmokePath);

  current = await post(`/tasks/${task.id}/approve-validation-preset`, {
    presetID: "runtime-typescript",
    note: "Core smoke test approves the agent-selected runtime command."
  });
  assert(
    current.approvals?.some((approval) => approval.action === "Approve Validation Preset" && approval.targetID === "runtime-typescript"),
    "Agent run step flow did not approve the runtime-typescript preset."
  );

  const commandStep = await collectRuntimeEventsDuring(
    () => post(`/tasks/${task.id}/run-agent-step`, {
      preferredCommandID: "runtime-npm-check"
    }),
    (event, result) => event.type === "agent.run_step.completed" && event.data?.taskID === result.id
  );
  current = commandStep.result;
  assertState(current, "Human Review", "Command Passed");
  const commandRun = current.taskCommandRuns?.at(-1);
  assert(commandRun?.commandID === "runtime-npm-check", `Expected runtime-npm-check, got ${commandRun?.commandID}.`);
  assert(commandRun.status === "Passed", `Expected agent-selected command to pass, got ${commandRun.status}.`);
  const commandAgentStep = current.agentRunSteps?.at(-1);
  assert(commandAgentStep?.action === "RunTaskCommand", `Expected RunTaskCommand, got ${commandAgentStep?.action}.`);
  assert(commandAgentStep.status === "Completed", `Expected command step Completed, got ${commandAgentStep.status}.`);
  assert(commandAgentStep.commandID === "runtime-npm-check", "Agent run step did not retain the selected command id.");
  assert(commandAgentStep.targetID === commandRun.id, "Agent run step did not link the task command run.");
  assert(
    commandStep.events.some((event) => event.type === "agent.run_step.started" && event.data?.taskID === current.id),
    "Agent run step flow did not stream the started event for command execution."
  );
  assert(
    commandStep.events.some((event) => event.type === "task.command.completed" && event.data?.taskID === current.id),
    "Agent run step flow did not stream the nested task command completion event."
  );
  assert(
    commandStep.events.some((event) => event.type === "agent.run_step.completed" && event.data?.taskID === current.id),
    "Agent run step flow did not stream the completed event for command execution."
  );

  return current;
}

async function runOpenAIRepositoryInspectionLoopFlow() {
  const task = await createTask({
    title: "Smoke agent repository inspection",
    objective: "Let the bounded agent loop choose one read-only repository inspection before proposing work."
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "repository inspection task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves read-only inspection before proposal generation."
  });
  const contextBefore = new Set(current.contextFiles?.map((file) => file.path));
  assert(!contextBefore.has("apps/macos/Sources/ForgeApp/KeychainStore.swift"), "Inspection fixture path was already in context.");

  current = await post(`/tasks/${task.id}/run-agent-loop`, { maxSteps: 3 });
  const loop = current.agentRunLoops?.at(-1);
  const loopSteps = loop?.stepIDs?.map((stepID) => current.agentRunSteps.find((step) => step.id === stepID));
  assert(loopSteps?.[0]?.action === "InspectRepository", `Expected InspectRepository first, got ${loopSteps?.[0]?.action}.`);
  assert(loopSteps?.[0]?.status === "Completed", "Repository inspection step did not complete.");
  assert(
    loopSteps?.[0]?.contextFilePaths?.includes("apps/macos/Sources/ForgeApp/KeychainStore.swift"),
    "Repository inspection did not record the provider-requested safe read path."
  );
  assert(loopSteps?.[1]?.action === "GenerateEditProposal", `Expected proposal second, got ${loopSteps?.[1]?.action}.`);
  assert(current.editProposal?.status === "Proposed", "Repository inspection loop did not reach proposal review.");
  assert(
    current.contextFiles?.some((file) => file.path === "apps/macos/Sources/ForgeApp/KeychainStore.swift"),
    "Repository inspection did not merge new context into task state."
  );
  assert(
    current.toolCalls?.some((tool) => tool.name === "list_repo_files") &&
      current.toolCalls?.some((tool) => tool.name === "search_repository_text") &&
      current.toolCalls?.some((tool) => tool.name === "read_context_file"),
    "Repository inspection did not execute the runtime-owned read-only tool chain."
  );
  assert(
    current.events?.some((event) => event.type === "agent.repository_inspection.completed"),
    "Repository inspection did not record its completion event."
  );

  return current;
}

async function runOpenAIAgentStepOutputRecoveryFlow() {
  const task = await createTask({
    title: "Smoke provider output recovery",
    objective: "Recover one malformed provider agent-step decision without executing side effects."
  });

  const before = await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "provider output recovery task to reach plan review"
  );
  const toolCallCountBefore = before.toolCalls?.length ?? 0;
  const commandRunCountBefore = before.taskCommandRuns?.length ?? 0;

  const current = await post(`/tasks/${task.id}/run-agent-loop`, { maxSteps: 2 });
  const loop = current.agentRunLoops?.at(-1);
  const step = current.agentRunSteps?.find((candidate) => candidate.id === loop?.stepIDs?.at(-1));
  assert(loop?.status === "Paused", `Expected recovered-output loop Paused, got ${loop?.status}.`);
  assert(loop.stopReason === "StepBlocked", `Expected recovered-output StepBlocked, got ${loop.stopReason}.`);
  assert(step?.action === "RequestPlanApproval", `Expected recovered RequestPlanApproval, got ${step?.action}.`);
  assert(step.status === "Blocked", `Expected recovered decision to reach its safe review gate, got ${step.status}.`);
  assert(step.providerAttemptCount === 2, `Expected two provider attempts, got ${step.providerAttemptCount}.`);
  assert(step.providerOutputRecovered === true, "Recovered provider decision did not retain recovery evidence.");
  assert(step.providerAttemptErrors?.length === 1, "Recovered provider decision did not retain the first format error.");
  assert(current.toolCalls?.length === toolCallCountBefore, "Malformed provider output recovery unexpectedly executed a tool.");
  assert(current.taskCommandRuns?.length === commandRunCountBefore, "Malformed provider output recovery unexpectedly ran a command.");

  return current;
}

async function runOpenAIFileReviewRevisionFlow() {
  const task = await createTask({
    title: "Smoke file review revision",
    objective: `Persist a file-level change request and generate a linked revision for @${appendSmokePath}.`
  });
  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "file review revision task to reach plan review"
  );
  let current = await post(`/tasks/${task.id}/approve-plan`, { note: "Approve file review revision smoke." });
  current = await post(`/tasks/${task.id}/generate-edit-proposal`, {});
  const firstProposal = current.editProposal;
  const firstChange = firstProposal.fileChanges[0];
  current = await post(`/tasks/${task.id}/review-edit-proposal-file`, {
    fileChangeID: firstChange.id,
    decision: "ChangesRequested",
    note: "Use the revised wording for this file."
  });
  assert(current.editProposal.revisionNumber === 2, `Expected revision 2, got ${current.editProposal.revisionNumber}.`);
  assert(current.editProposal.revisionOfID === firstProposal.id, "File change request did not link the new proposal revision.");
  const archived = current.editProposalRevisions.find((proposal) => proposal.id === firstProposal.id);
  assert(archived?.status === "Rejected", "Requested-change proposal was not archived as rejected.");
  assert(
    archived?.fileDecisions?.some((decision) =>
      decision.fileChangeID === firstChange.id && decision.decision === "ChangesRequested"
    ),
    "Archived proposal did not retain the file-level change request."
  );
  assert(current.changedFiles.length === 0, "File review revision mutated the workspace.");
  return current;
}

async function runOpenAIInspectionRepeatGuardFlow() {
  const task = await createTask({
    title: "Smoke inspection repeat guard",
    objective: "Block a repeated provider-selected repository inspection before duplicate search and read calls."
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "inspection repeat guard task to reach plan review"
  );
  const before = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the repeated-inspection guard flow."
  });
  const searchCallsBefore = before.toolCalls?.filter((tool) => tool.name === "search_repository_symbols").length ?? 0;
  const readCallsBefore = before.toolCalls?.filter((tool) => tool.name === "read_context_file").length ?? 0;

  const current = await post(`/tasks/${task.id}/run-agent-loop`, { maxSteps: 3 });
  const loop = current.agentRunLoops?.at(-1);
  const steps = loop?.stepIDs?.map((stepID) => current.agentRunSteps?.find((step) => step.id === stepID));
  assert(loop?.status === "Paused", `Expected repeated-inspection loop Paused, got ${loop?.status}.`);
  assert(loop.stopReason === "StepBlocked", `Expected repeated-inspection StepBlocked, got ${loop.stopReason}.`);
  assert(steps?.length === 2, `Expected two inspection attempts, got ${steps?.length}.`);
  assert(steps?.every((step) => step?.action === "InspectRepository"), "Repeat guard flow did not record two inspection decisions.");
  assert(steps?.[0]?.status === "Completed", "First inspection did not complete.");
  assert(steps?.[1]?.status === "Blocked", "Repeated inspection was not blocked.");
  assert(
    steps?.[0]?.inspectionRequestFingerprint === steps?.[1]?.inspectionRequestFingerprint,
    "Repeated inspection steps did not retain the same request fingerprint."
  );
  assert(steps?.[0]?.inspectionBudgetSummary?.includes("scan<=400"), "Inspection step did not retain visible budget evidence.");
  assert(steps?.[0]?.inspectionSearchMode === "Symbol", "Inspection step did not retain the selected Symbol mode.");
  assert(steps?.[0]?.inspectionSearchEngine === "ripgrep-word", `Expected ripgrep-word, got ${steps?.[0]?.inspectionSearchEngine}.`);
  assert(
    (current.toolCalls?.filter((tool) => tool.name === "search_repository_symbols").length ?? 0) - searchCallsBefore === 1,
    "Repeated inspection executed a duplicate repository search."
  );
  assert(
    (current.toolCalls?.filter((tool) => tool.name === "read_context_file").length ?? 0) - readCallsBefore ===
      (steps?.[0]?.contextFilePaths?.length ?? 0),
    "Repeated inspection executed a duplicate context read."
  );

  return current;
}

async function runOpenAIAgentStepOutputFailureFlow() {
  const task = await createTask({
    title: "Smoke provider output retry exhaustion",
    objective: "Fail closed after repeated malformed provider agent-step decisions."
  });

  const before = await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "provider output retry exhaustion task to reach plan review"
  );
  const toolCallCountBefore = before.toolCalls?.length ?? 0;
  const commandRunCountBefore = before.taskCommandRuns?.length ?? 0;

  const current = await post(`/tasks/${task.id}/run-agent-loop`, { maxSteps: 2 });
  const loop = current.agentRunLoops?.at(-1);
  const step = current.agentRunSteps?.find((candidate) => candidate.id === loop?.stepIDs?.at(-1));
  assert(loop?.status === "Failed", `Expected exhausted-output loop Failed, got ${loop?.status}.`);
  assert(loop.stopReason === "StepFailed", `Expected exhausted-output StepFailed, got ${loop.stopReason}.`);
  assert(step?.status === "Failed", `Expected exhausted provider decision step Failed, got ${step?.status}.`);
  assert(step.action === "WaitForHumanReview", `Expected fail-closed WaitForHumanReview, got ${step.action}.`);
  assert(step.providerAttemptCount === 2, `Expected exhausted provider decision to record two attempts, got ${step.providerAttemptCount}.`);
  assert(step.providerOutputRecovered === false, "Exhausted provider decision was incorrectly marked recovered.");
  assert(step.providerAttemptErrors?.length === 2, "Exhausted provider decision did not retain both bounded errors.");
  assert(current.events?.some((event) => event.type === "agent.run_step.failed"), "Exhausted provider retry did not emit a failed step event.");
  assert(current.toolCalls?.length === toolCallCountBefore, "Exhausted malformed output unexpectedly executed a tool.");
  assert(current.taskCommandRuns?.length === commandRunCountBefore, "Exhausted malformed output unexpectedly ran a command.");

  return current;
}

async function runOpenAIAgentRunLoopFlow() {
  const task = await createTask({
    title: "Smoke OpenAI agent run loop",
    objective: `Run an agent run loop smoke against @${appendSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "OpenAI agent run loop task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the agent run loop plan."
  });
  assert(current.executionProposal, "OpenAI agent run loop flow did not create an execution proposal.");

  const proposalLoop = await collectRuntimeEventsDuring(
    () => post(`/tasks/${task.id}/run-agent-loop`, { maxSteps: 4 }),
    (event, result) => event.type === "agent.run_loop.paused" && event.data?.taskID === result.id
  );
  current = proposalLoop.result;
  assertState(current, "Human Review", "Edit Proposal Review");
  assert(current.editProposal?.status === "Proposed", "Agent run loop did not create an edit proposal.");
  const firstLoop = current.agentRunLoops?.at(-1);
  assert(firstLoop?.status === "Paused", `Expected first agent loop Paused, got ${firstLoop?.status}.`);
  assert(firstLoop.stopReason === "HumanReviewRequired", `Expected HumanReviewRequired, got ${firstLoop.stopReason}.`);
  assert(firstLoop.stepsRun === 1, `Expected one loop step before proposal review, got ${firstLoop.stepsRun}.`);
  const firstLoopStep = current.agentRunSteps?.find((step) => step.id === firstLoop.stepIDs.at(-1));
  assert(firstLoopStep?.action === "GenerateEditProposal", `Expected loop GenerateEditProposal, got ${firstLoopStep?.action}.`);
  assert(firstLoopStep.loopID === firstLoop.id, "Agent loop did not link its generated proposal step.");
  assert(
    proposalLoop.events.some((event) => event.type === "agent.run_loop.started" && event.data?.taskID === current.id),
    "Agent run loop did not stream the started event for proposal loop."
  );
  assert(
    proposalLoop.events.some((event) => event.type === "agent.run_loop.paused" && event.data?.taskID === current.id),
    "Agent run loop did not stream the paused event for proposal loop."
  );

  current = await approveAllProposalFiles(current);
  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the loop-generated proposal."
  });
  assertCompletedTask(current, appendSmokePath);

  current = await post(`/tasks/${task.id}/approve-validation-preset`, {
    presetID: "runtime-typescript",
    note: "Core smoke test approves the agent loop runtime command."
  });
  assert(
    current.approvals?.some((approval) => approval.action === "Approve Validation Preset" && approval.targetID === "runtime-typescript"),
    "Agent run loop flow did not approve the runtime-typescript preset."
  );

  const brokenPath = join(repoRoot, brokenTypeScriptSmokePath);
  await mkdir(dirname(brokenPath), { recursive: true });
  await writeFile(brokenPath, "export const forgeSmokeBroken: string = ;\n", "utf8");

  const repairLoop = await collectRuntimeEventsDuring(
    () => post(`/tasks/${task.id}/run-agent-loop`, {
      preferredCommandID: "runtime-npm-check",
      maxSteps: 4
    }),
    (event, result) => event.type === "agent.run_loop.paused" && event.data?.taskID === result.id
  );
  current = repairLoop.result;
  assertState(current, "Human Review", "Edit Proposal Review");
  const secondLoop = current.agentRunLoops?.at(-1);
  assert(secondLoop?.status === "Paused", `Expected repair loop Paused, got ${secondLoop?.status}.`);
  assert(secondLoop.stopReason === "HumanReviewRequired", `Expected repair loop HumanReviewRequired, got ${secondLoop.stopReason}.`);
  assert(secondLoop.stepsRun === 2, `Expected repair loop to run command and repair proposal, got ${secondLoop.stepsRun}.`);
  const loopSteps = secondLoop.stepIDs.map((id) => current.agentRunSteps?.find((step) => step.id === id));
  assert(loopSteps[0]?.action === "RunTaskCommand", `Expected first repair loop action RunTaskCommand, got ${loopSteps[0]?.action}.`);
  assert(loopSteps[1]?.action === "GenerateValidationRepairProposal", `Expected second repair loop action GenerateValidationRepairProposal, got ${loopSteps[1]?.action}.`);
  assert(loopSteps.every((step) => step?.loopID === secondLoop.id), "Repair loop steps did not retain the loop id.");
  const failedCommandRun = current.taskCommandRuns?.at(-1);
  assert(failedCommandRun?.status === "Failed", "Repair loop did not record the failed runtime command.");
  const repairBrief = current.validationRepairBriefs?.at(-1);
  assert(repairBrief?.taskCommandRunID === failedCommandRun.id, "Repair loop did not create a task-command repair brief.");
  assert(current.editProposal?.validationRepairBriefID === repairBrief.id, "Repair loop did not link the generated self-fix proposal.");
  assert(
    current.editProposal.fileChanges?.some((change) =>
      change.path === brokenTypeScriptSmokePath && change.applyOperation?.kind === "ReplaceText"
    ),
    "Repair loop proposal did not include the expected broken TypeScript replacement."
  );
  assert(
    repairLoop.events.some((event) => event.type === "task.command.completed" && event.data?.taskID === current.id),
    "Agent repair loop did not stream nested command completion."
  );
  assert(
    repairLoop.events.some((event) => event.type === "agent.run_loop.paused" && event.data?.taskID === current.id),
    "Agent repair loop did not stream the paused event."
  );

  return current;
}

async function runOpenAIAgentLoopControlsFlow() {
  const task = await createTask({
    title: "Smoke agent loop controls",
    objective: "Pause, resume, and abort a bounded agent loop at safe checkpoints."
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "agent loop controls task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the agent loop controls plan."
  });
  current = await post(`/tasks/${task.id}/approve-validation-preset`, {
    presetID: "smoke-task-commands",
    note: "Core smoke test approves the long command used for cooperative loop controls."
  });

  const firstLoopPromise = post(`/tasks/${task.id}/run-agent-loop`, {
    preferredCommandID: "smoke-long-task-command",
    maxSteps: 2
  });
  const firstRunning = await waitForTask(
    task.id,
    (candidate) =>
      candidate.agentRunLoops?.at(-1)?.status === "Running" &&
      candidate.taskCommandRuns?.at(-1)?.commandID === "smoke-long-task-command" &&
      candidate.taskCommandRuns?.at(-1)?.status === "Running",
    "first controlled agent loop to run its long command"
  );
  const firstLoop = firstRunning.agentRunLoops.at(-1);
  const pauseRequested = await post(`/tasks/${task.id}/pause-agent-loop`, {
    loopID: firstLoop.id,
    note: "Pause after the current approved command."
  });
  assert(
    pauseRequested.agentRunLoops.at(-1)?.controlState === "PauseRequested",
    "Pause request did not persist on the active loop."
  );
  current = await firstLoopPromise;
  const pausedLoop = current.agentRunLoops.find((loop) => loop.id === firstLoop.id);
  assert(pausedLoop?.status === "Paused", `Expected controlled loop Paused, got ${pausedLoop?.status}.`);
  assert(pausedLoop.stopReason === "UserPaused", `Expected UserPaused, got ${pausedLoop.stopReason}.`);
  assert(
    current.approvals?.some((approval) => approval.action === "Pause Agent Loop" && approval.targetID === firstLoop.id),
    "Pause request did not record an approval/audit entry."
  );
  assert(
    current.events?.some((event) => event.type === "agent.run_loop.pause.requested") &&
      current.events?.some((event) => event.type === "agent.run_loop.paused"),
    "Pause lifecycle events were not recorded."
  );

  const resumePromise = post(`/tasks/${task.id}/resume-agent-loop`, {
    resumeLoopID: firstLoop.id,
    preferredCommandID: "smoke-long-task-command",
    maxSteps: 2
  });
  const resumedRunning = await waitForTask(
    task.id,
    (candidate) =>
      candidate.agentRunLoops?.length >= 2 &&
      candidate.agentRunLoops?.at(-1)?.status === "Running" &&
      candidate.agentRunLoops?.at(-1)?.resumedFromLoopID === firstLoop.id &&
      candidate.taskCommandRuns?.at(-1)?.status === "Running",
    "resumed agent loop to run its long command"
  );
  const resumedLoop = resumedRunning.agentRunLoops.at(-1);
  const abortRequested = await post(`/tasks/${task.id}/abort-agent-loop`, {
    loopID: resumedLoop.id,
    note: "Abort after the current approved command."
  });
  assert(
    abortRequested.agentRunLoops.at(-1)?.controlState === "AbortRequested",
    "Abort request did not persist on the resumed loop."
  );
  current = await resumePromise;
  const abortedLoop = current.agentRunLoops.find((loop) => loop.id === resumedLoop.id);
  const linkedSourceLoop = current.agentRunLoops.find((loop) => loop.id === firstLoop.id);
  assert(abortedLoop?.status === "Aborted", `Expected resumed loop Aborted, got ${abortedLoop?.status}.`);
  assert(abortedLoop.stopReason === "UserAborted", `Expected UserAborted, got ${abortedLoop.stopReason}.`);
  assert(linkedSourceLoop?.resumedByLoopID === resumedLoop.id, "Paused loop did not link to the resumed loop.");
  assert(
    current.approvals?.some((approval) => approval.action === "Abort Agent Loop" && approval.targetID === resumedLoop.id),
    "Abort request did not record an approval/audit entry."
  );
  assert(
    current.events?.some((event) => event.type === "agent.run_loop.resumed") &&
      current.events?.some((event) => event.type === "agent.run_loop.abort.requested") &&
      current.events?.some((event) => event.type === "agent.run_loop.aborted"),
    "Resume/abort lifecycle events were not recorded."
  );

  const inactiveControl = await postExpectError(`/tasks/${task.id}/pause-agent-loop`, {
    loopID: resumedLoop.id
  });
  assert(inactiveControl.status === 409, "Controlling an inactive loop should be rejected.");

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

  current = await approveAllProposalFiles(current);
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

async function runOpenAITaskCommandFailureRepairFlow() {
  const task = await createTask({
    title: "Smoke task command validation failure repair brief",
    objective: `Analyze a failed live task command and generate a reviewed repair proposal for @${appendSmokePath}.`
  });

  await waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "OpenAI task-command repair task to reach initial plan review"
  );

  let current = await post(`/tasks/${task.id}/approve-plan`, {
    note: "Core smoke test approves the task command repair plan."
  });
  assert(current.executionProposal, "Task-command repair flow did not create an execution proposal.");

  current = await post(`/tasks/${task.id}/approve-validation-preset`, {
    presetID: "runtime-typescript",
    note: "Core smoke test approves task command failure analysis."
  });
  assert(
    current.approvals?.some((approval) => approval.action === "Approve Validation Preset" && approval.targetID === "runtime-typescript"),
    "Task-command repair flow did not approve the runtime-typescript preset."
  );

  current = await post(`/tasks/${task.id}/run-task-command`, {
    commandID: "runtime-npm-check"
  });
  assertState(current, "Failed", "Command Failed");
  const failedCommandRun = current.taskCommandRuns?.at(-1);
  assert(failedCommandRun?.status === "Failed", "Task-command repair flow did not record a failed task command run.");
  assert(
    current.validationRepairBriefs?.some((brief) =>
      brief.taskCommandRunID === failedCommandRun.id &&
        brief.source === "TaskCommandRun" &&
        brief.provider?.id === "openai" &&
        brief.recommendedActions?.length > 0
    ),
    "Task-command repair flow did not create an OpenAI command repair brief."
  );
  assert(
    current.events?.some((event) => event.type === "task.command.repair_brief.ready"),
    "Task-command repair flow did not record a command repair brief ready event."
  );
  assert(
    current.planSteps?.some((step) => step.id === "plan-validation-repair" && step.status === "Active"),
    "Task-command repair flow did not create an active repair planning step."
  );

  const repairBrief = current.validationRepairBriefs.at(-1);
  const changedFilesBeforeRepairProposal = [...(current.changedFiles ?? [])];

  current = await post(`/tasks/${task.id}/generate-validation-repair-proposal`, {});
  assertState(current, "Human Review", "Edit Proposal Review");
  assert(current.editProposal?.status === "Proposed", "Task-command repair proposal was not proposed.");
  assert(
    current.editProposal.validationRepairBriefID === repairBrief.id,
    "Task-command repair proposal did not retain the repair brief link."
  );
  assert(
    current.editProposal.revisionNumber >= 1,
    `Task-command repair proposal should have a valid revision number, got ${current.editProposal.revisionNumber}.`
  );
  assert(
    current.editProposal.validation?.status === "Ready",
    current.editProposal.validation?.summary ?? "Task-command repair proposal should validate as ready."
  );
  assert(
    current.editProposal.fileChanges?.some((change) =>
      change.path === brokenTypeScriptSmokePath && change.applyOperation?.kind === "ReplaceText"
    ),
    "Task-command repair proposal did not include a safe replace operation for the broken TypeScript fixture."
  );
  assert(
    JSON.stringify(current.changedFiles ?? []) === JSON.stringify(changedFilesBeforeRepairProposal),
    "Task-command repair proposal generation should not mutate changedFiles."
  );
  assert(
    current.events?.some((event) => event.type === "edit.proposal.validation_repair.ready"),
    "Task-command repair proposal did not record a ready event."
  );

  const repairProposalID = current.editProposal.id;
  current = await approveAllProposalFiles(current);
  current = await post(`/tasks/${task.id}/apply-edit-proposal`, {
    note: "Core smoke test applies the task-command repair proposal."
  });
  assertCompletedTask(current, brokenTypeScriptSmokePath);
  const repairedSource = await readFile(join(repoRoot, brokenTypeScriptSmokePath), "utf8");
  assert(
    repairedSource.includes("forgeSmokeBroken: string = \"fixed\""),
    "Task-command repair proposal did not fix the broken TypeScript fixture."
  );

  const rerunEvidence = current.commandRerunEvidence?.at(-1);
  assert(rerunEvidence, "Task-command repair apply did not create rerun evidence.");
  assert(rerunEvidence.sourceTaskCommandRunID === failedCommandRun.id, "Rerun evidence did not link the failed source command run.");
  assert(rerunEvidence.validationRepairBriefID === repairBrief.id, "Rerun evidence did not link the repair brief.");
  assert(rerunEvidence.repairProposalID === repairProposalID, "Rerun evidence did not link the applied repair proposal.");
  assert(rerunEvidence.status === "Ready", `Expected rerun evidence Ready, got ${rerunEvidence.status}.`);
  assert(!rerunEvidence.rerunTaskCommandRunID, "Ready rerun evidence should not have a rerun command id yet.");
  assert(
    current.events?.some((event) => event.type === "task.command.rerun_evidence.ready"),
    "Task-command repair apply did not record rerun evidence ready event."
  );

  const collected = await collectRuntimeEventsDuring(async () =>
    post(`/tasks/${task.id}/rerun-repair-command`, {
      commandRerunEvidenceID: rerunEvidence.id
    })
  );
  current = collected.result;
  assertState(current, "Human Review", "Repair Verified");
  const verifiedEvidence = current.commandRerunEvidence?.find((evidence) => evidence.id === rerunEvidence.id);
  assert(verifiedEvidence?.status === "Passed", `Expected rerun evidence Passed, got ${verifiedEvidence?.status}.`);
  assert(verifiedEvidence.rerunTaskCommandRunID, "Passed rerun evidence did not link the rerun command.");
  const rerunCommand = current.taskCommandRuns?.find((run) => run.id === verifiedEvidence.rerunTaskCommandRunID);
  assert(rerunCommand?.commandID === "runtime-npm-check", `Expected rerun command runtime-npm-check, got ${rerunCommand?.commandID}.`);
  assert(rerunCommand.status === "Passed", `Expected rerun command to pass, got ${rerunCommand.status}: ${rerunCommand.outputSummary}`);
  assert(rerunCommand.exitCode === 0, `Expected rerun command exit code 0, got ${rerunCommand.exitCode}.`);
  assert(
    current.events?.some((event) => event.type === "task.command.rerun_evidence.passed"),
    "Task-command repair rerun did not record rerun evidence passed event."
  );
  assert(
    collected.events.some((event) => event.type === "task.command.rerun_evidence.started" && event.data?.taskID === current.id),
    "Task-command repair rerun did not stream rerun evidence started event."
  );
  assert(
    collected.events.some((event) => event.type === "task.command.completed" && event.data?.taskCommandRunID === rerunCommand.id),
    "Task-command repair rerun did not stream the rerun command completion event."
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

async function prepareOpenAIAgentLoopRestartFixture() {
  const task = await createTask({
    title: "Smoke agent loop restart recovery",
    objective: "Recover a persisted running agent loop after runtime restart."
  });
  return waitForTask(
    task.id,
    (candidate) => candidate.status === "Human Review" && candidate.currentPhase === "Plan Review",
    "agent loop restart fixture to reach plan review"
  );
}

function markAgentLoopRunningInDatabase(taskID) {
  const database = new DatabaseSync(dbPath);
  try {
    const row = database.prepare("SELECT payload_json FROM tasks WHERE id = ?").get(taskID);
    assert(row?.payload_json, "Restart fixture task was not persisted.");
    const task = JSON.parse(row.payload_json);
    const now = new Date().toISOString();
    const loopID = `restart-loop-${smokeID}`;
    const stepID = `restart-step-${smokeID}`;
    task.agentRunLoops.push({
      id: loopID,
      provider: { id: "openai", name: "OpenAI Responses", model: "openai-context-smoke", mode: "remote" },
      status: "Running",
      maxSteps: 3,
      stepsRun: 1,
      stepIDs: [stepID],
      summary: "Persisted running loop fixture.",
      startedAt: now
    });
    task.agentRunSteps.push({
      id: stepID,
      provider: { id: "openai", name: "OpenAI Responses", model: "openai-context-smoke", mode: "remote" },
      loopID,
      action: "InspectRepository",
      status: "Running",
      summary: "Persisted running step fixture.",
      rationale: "Exercise restart recovery.",
      createdAt: now
    });
    task.toolCalls.push({
      id: `restart-tool-${smokeID}`,
      name: "search_repository_text",
      status: "Started",
      input: "restart fixture",
      outputSummary: "Running",
      startedAt: now
    });
    task.status = "Running";
    task.currentPhase = "Agent Loop";
    task.reviewSummary = "Persisted running loop fixture.";
    database.prepare("UPDATE tasks SET status = ?, current_phase = ?, payload_json = ? WHERE id = ?")
      .run(task.status, task.currentPhase, JSON.stringify(task), taskID);
  } finally {
    database.close();
  }
}

async function assertOpenAIAgentLoopRestartRecovery(taskID) {
  let current = await waitForTask(
    taskID,
    (candidate) => candidate.currentPhase === "Agent Loop Interrupted",
    "running agent loop to recover after restart"
  );
  const interruptedLoop = current.agentRunLoops.at(-1);
  const interruptedStep = current.agentRunSteps.find((step) => step.id === interruptedLoop.stepIDs[0]);
  assert(interruptedLoop.status === "Paused", `Expected recovered loop Paused, got ${interruptedLoop.status}.`);
  assert(interruptedLoop.stopReason === "RuntimeRestarted", `Expected RuntimeRestarted, got ${interruptedLoop.stopReason}.`);
  assert(interruptedStep?.status === "Failed", "Interrupted running step was not finalized as failed evidence.");
  assert(current.toolCalls.at(-1)?.status === "Failed", "Interrupted tool call was not finalized as failed evidence.");
  assert(current.events.some((event) => event.type === "agent.run_loop.interrupted"), "Restart recovery event was not persisted.");

  current = await post(`/tasks/${taskID}/resume-agent-loop`, { resumeLoopID: interruptedLoop.id, maxSteps: 1 });
  const resumedLoop = current.agentRunLoops.at(-1);
  const sourceLoop = current.agentRunLoops.find((loop) => loop.id === interruptedLoop.id);
  assert(resumedLoop.resumedFromLoopID === interruptedLoop.id, "Restarted loop did not resume from the interrupted checkpoint.");
  assert(sourceLoop?.resumedByLoopID === resumedLoop.id, "Interrupted loop did not retain forward resume lineage.");
  assert(resumedLoop.status === "Paused" && resumedLoop.stopReason === "StepBlocked", "Resumed loop did not stop at the plan review gate.");
  return current;
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
  assert(
    home.includes("POST /tasks/:taskID/run-agent-step"),
    "Runtime home page did not link the agent run step endpoint."
  );
  assert(
    home.includes("POST /tasks/:taskID/run-agent-loop"),
    "Runtime home page did not link the agent run loop endpoint."
  );
  assert(
    home.includes("POST /tasks/:taskID/pause-agent-loop") &&
      home.includes("POST /tasks/:taskID/abort-agent-loop") &&
      home.includes("POST /tasks/:taskID/resume-agent-loop"),
    "Runtime home page did not link the agent run loop control endpoints."
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
      FORGE_ENABLE_SMOKE_COMMANDS: "1",
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

  if (name === "forge_agent_run_step") {
    if (bodyText.includes("agent loop restart recovery")) {
      return {
        action: "RequestPlanApproval",
        summary: "Pause at plan review after restart recovery.",
        rationale: "The interrupted loop recovered safely and still requires plan approval.",
        commandID: "",
        commandRerunEvidenceID: "",
        searchTerms: [],
        readPaths: [],
        searchMode: "Text"
      };
    }

    if (bodyText.includes("inspection repeat guard")) {
      return {
        action: "InspectRepository",
        summary: "Inspect the same Keychain boundary to exercise cross-step request suppression.",
        rationale: "The smoke provider intentionally repeats an identical safe read-only request.",
        commandID: "",
        commandRerunEvidenceID: "",
        searchTerms: ["Keychain", "security", "provider"],
        readPaths: ["apps/macos/Sources/ForgeApp/KeychainStore.swift"],
        searchMode: "Symbol"
      };
    }

    if (bodyText.includes("provider output recovery")) {
      const taskRequestCount = requests.filter((request) =>
        request.name === "forge_agent_run_step" && JSON.stringify(request.body).includes("provider output recovery")
      ).length;
      if (taskRequestCount === 1) {
        return {
          action: "RunUnapprovedShell",
          summary: "This action is outside the allowed enum.",
          rationale: "The smoke server intentionally returns one malformed decision.",
          commandID: "",
          commandRerunEvidenceID: "",
          searchTerms: [],
          readPaths: []
        };
      }

      return {
        action: "RequestPlanApproval",
        summary: "Pause at the existing plan approval gate after output recovery.",
        rationale: "The corrected decision uses an allowed action and performs no side effect.",
        commandID: "",
        commandRerunEvidenceID: "",
        searchTerms: [],
        readPaths: []
      };
    }

    if (bodyText.includes("provider output retry exhaustion")) {
      return {
        action: "BypassHumanReview",
        summary: "This action remains outside the allowed enum.",
        rationale: "The smoke server intentionally exhausts both format attempts.",
        commandID: "",
        commandRerunEvidenceID: "",
        searchTerms: [],
        readPaths: []
      };
    }

    if (bodyText.includes("agent repository inspection")) {
      if (!bodyText.includes("KeychainStore.swift")) {
        return {
          action: "InspectRepository",
          summary: "Inspect Keychain integration before proposing the next reviewed change.",
          rationale: "The current task context does not yet include the macOS Keychain boundary.",
          commandID: "",
          commandRerunEvidenceID: "",
          searchTerms: ["Keychain", "security", "provider"],
          readPaths: ["apps/macos/Sources/ForgeApp/KeychainStore.swift", "../unsafe.txt"],
          searchMode: "Text"
        };
      }

      return {
        action: "GenerateEditProposal",
        summary: "Generate a reviewed proposal after the read-only inspection.",
        rationale: "The requested Keychain context is now recorded in task state.",
        commandID: "",
        commandRerunEvidenceID: "",
        searchTerms: [],
        readPaths: []
      };
    }

    if (bodyText.includes("agent loop controls")) {
      return {
        action: "RunTaskCommand",
        summary: "Run the approved long smoke command so loop control can stop at a safe checkpoint.",
        rationale: "The command is runtime-known and already approved for this task.",
        commandID: "smoke-long-task-command",
        commandRerunEvidenceID: ""
      };
    }

    if (bodyText.includes("agent run loop smoke")) {
      if (bodyText.includes("Command Failed")) {
        return {
          action: "GenerateValidationRepairProposal",
          summary: "Generate a reviewed self-fix proposal from the failed command output.",
          rationale: "The approved runtime command failed and the runtime produced a repair brief.",
          commandID: "",
          commandRerunEvidenceID: ""
        };
      }

      if (bodyText.includes("Applied")) {
        return {
          action: "RunTaskCommand",
          summary: "Run the approved TypeScript/runtime check from the loop.",
          rationale: "The reviewed loop proposal has been applied and runtime-typescript is approved.",
          commandID: "runtime-npm-check",
          commandRerunEvidenceID: ""
        };
      }

      return {
        action: "GenerateEditProposal",
        summary: "Generate the first loop-managed implementation proposal.",
        rationale: "The plan has been approved and no proposal is waiting for review.",
        commandID: "",
        commandRerunEvidenceID: ""
      };
    }

    const runStepCount = requests.filter((request) => request.name === "forge_agent_run_step").length;
    if (runStepCount === 1) {
      return {
        action: "GenerateEditProposal",
        summary: "Generate the first reviewed implementation proposal.",
        rationale: "The plan has been approved and no proposal is waiting for human review.",
        commandID: "",
        commandRerunEvidenceID: ""
      };
    }

    if (runStepCount === 2) {
      return {
        action: "RunTaskCommand",
        summary: "Run the approved TypeScript/runtime check.",
        rationale: "The reviewed edit has been applied and runtime-typescript is approved for this task.",
        commandID: "runtime-npm-check",
        commandRerunEvidenceID: ""
      };
    }

    return {
      action: "WaitForHumanReview",
      summary: "Wait for the next human decision.",
      rationale: "The smoke flow has already exercised the provider-driven proposal and command paths.",
      commandID: "",
      commandRerunEvidenceID: ""
    };
  }

  if (name === "forge_validation_repair_brief") {
    if (bodyText.includes("agent run loop")) {
      return {
        summary: "Agent run loop smoke command repair: runtime type-check failed on the temporary syntax fixture.",
        likelyCause: "The loop-created task command output reports a TypeScript syntax error in the temporary smoke fixture.",
        recommendedActions: [
          "Replace the invalid TypeScript assignment with a fixed string literal.",
          "Keep the repair as a review-only proposal.",
          "Rerun the approved runtime-typescript command after the repair is applied."
        ],
        followUpPrompt: "Agent run loop smoke command repair: fix the temporary TypeScript syntax fixture, then rerun runtime-npm-check.",
        riskLevel: "Medium"
      };
    }

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
    if (bodyText.includes("file review revision")) {
      const revised = bodyText.includes('"revisionNumber": 2');
      const note = revised ? "Revised wording after durable file review." : "Initial wording before file review.";
      return {
        summary: revised ? "Generate the linked file-review revision." : "Generate the first file-review proposal.",
        riskLevel: "Low",
        fileChanges: [{
          path: appendSmokePath,
          changeType: "Modify",
          rationale: "Exercise durable per-file review decisions without applying files.",
          diffPreview: `--- a/${appendSmokePath}\n+++ b/${appendSmokePath}\n+${note}`,
          operationKind: "AppendText",
          appendText: `\n## File Review Revision Smoke\n\n- ${note}\n`,
          findText: "",
          replaceWith: "",
          patchHunks: [],
          unifiedDiff: "",
          createContent: ""
        }]
      };
    }

    if (bodyText.includes("agent repository inspection")) {
      return {
        summary: "Propose a distinct note after runtime-owned repository inspection.",
        riskLevel: "Low",
        fileChanges: [
          {
            path: appendSmokePath,
            changeType: "Modify",
            rationale: "Record that the bounded loop inspected provider-requested repository context before proposing work.",
            diffPreview: [
              `--- a/${appendSmokePath}`,
              `+++ b/${appendSmokePath}`,
              "@@ repository inspection smoke @@",
              "+",
              "+## Agent Repository Inspection Smoke",
              "+",
              "+- Runtime-owned read/search tools completed before proposal generation."
            ].join("\n"),
            operationKind: "AppendText",
            appendText: "\n## Agent Repository Inspection Smoke\n\n- Runtime-owned read/search tools completed before proposal generation.\n",
            findText: "",
            replaceWith: "",
            patchHunks: [],
            unifiedDiff: "",
            content: ""
          }
        ]
      };
    }

    if (bodyText.includes("unified diff transaction smoke") || bodyText.includes("apply recovery smoke")) {
      const firstPatch = [
        `--- a/${unifiedDiffSmokePathOne}`,
        `+++ b/${unifiedDiffSmokePathOne}`,
        "@@ -1,4 +1,5 @@",
        " export function forgeUnifiedGreeting(name: string) {",
        "-  const label = \"hello\";",
        "+  const label = \"Hello\";",
        "+  const punctuation = \"!\";",
        "-  return `${label}, ${name}`;",
        "+  return `${label}, ${name}${punctuation}`;",
        " }"
      ].join("\n");
      const secondPatch = [
        `--- a/${unifiedDiffSmokePathTwo}`,
        `+++ b/${unifiedDiffSmokePathTwo}`,
        "@@ -1,4 +1,3 @@",
        " export const forgeUnifiedRetry = {",
        "-  attempts: 2,",
        "+  attempts: 3,",
        "-  backoff: true",
        " };"
      ].join("\n");
      return {
        summary: "Apply a reviewable two-file source change through strict unified diffs.",
        riskLevel: "Medium",
        fileChanges: [
          {
            path: unifiedDiffSmokePathOne,
            changeType: "Modify",
            rationale: "Exercise context-anchored additions and replacements in a source file.",
            diffPreview: firstPatch,
            operationKind: "UnifiedDiff",
            appendText: "",
            findText: "",
            replaceWith: "",
            patchHunks: [],
            unifiedDiff: firstPatch,
            content: ""
          },
          {
            path: unifiedDiffSmokePathTwo,
            changeType: "Modify",
            rationale: "Exercise a second-file replacement and deletion in the same reviewed transaction.",
            diffPreview: secondPatch,
            operationKind: "UnifiedDiff",
            appendText: "",
            findText: "",
            replaceWith: "",
            patchHunks: [],
            unifiedDiff: secondPatch,
            content: ""
          }
        ]
      };
    }

    if (bodyText.includes("Agent run loop smoke command repair")) {
      return {
        summary: "Fix the broken TypeScript fixture from the agent run loop command failure.",
        riskLevel: "Medium",
        fileChanges: [
          {
            path: brokenTypeScriptSmokePath,
            changeType: "Modify",
            rationale: "The agent loop repair brief points to a syntax error in this temporary TypeScript fixture.",
            diffPreview: [
              `--- a/${brokenTypeScriptSmokePath}`,
              `+++ b/${brokenTypeScriptSmokePath}`,
              "@@ agent loop command repair @@",
              "-export const forgeSmokeBroken: string = ;",
              "+export const forgeSmokeBroken: string = \"fixed\";"
            ].join("\n"),
            operationKind: "ReplaceText",
            appendText: "",
            findText: "export const forgeSmokeBroken: string = ;\n",
            replaceWith: "export const forgeSmokeBroken: string = \"fixed\";\n",
            content: ""
          }
        ]
      };
    }

    if (bodyText.includes("agent run loop smoke") && !bodyText.includes("TaskCommandRun")) {
      return {
        summary: "Propose the implementation selected by the agent run loop.",
        riskLevel: "Low",
        fileChanges: [
          {
            path: appendSmokePath,
            changeType: "Modify",
            rationale: "Add a distinct note proving the provider-selected loop can generate a reviewed edit.",
            diffPreview: [
              `--- a/${appendSmokePath}`,
              `+++ b/${appendSmokePath}`,
              "@@ agent run loop append @@",
              "+",
              "+## OpenAI Agent Run Loop Smoke",
              "+",
              "+- Generated a reviewed proposal from a provider-selected bounded loop."
            ].join("\n"),
            operationKind: "AppendText",
            appendText: "\n## OpenAI Agent Run Loop Smoke\n\n- Generated a reviewed proposal from a provider-selected bounded loop.\n",
            findText: "",
            replaceWith: "",
            content: ""
          }
        ]
      };
    }

    if (bodyText.includes("agent run step smoke")) {
      return {
        summary: "Propose the implementation selected by the agent run step.",
        riskLevel: "Low",
        fileChanges: [
          {
            path: appendSmokePath,
            changeType: "Modify",
            rationale: "Add a distinct note proving the provider-selected agent step can generate a reviewed edit.",
            diffPreview: [
              `--- a/${appendSmokePath}`,
              `+++ b/${appendSmokePath}`,
              "@@ agent run step append @@",
              "+",
              "+## OpenAI Agent Run Step Smoke",
              "+",
              "+- Generated a reviewed proposal from a provider-selected agent step."
            ].join("\n"),
            operationKind: "AppendText",
            appendText: "\n## OpenAI Agent Run Step Smoke\n\n- Generated a reviewed proposal from a provider-selected agent step.\n",
            findText: "",
            replaceWith: "",
            content: ""
          }
        ]
      };
    }

    if (bodyText.includes("validation failure repair brief") || bodyText.includes("Validation repair brief")) {
      if (bodyText.includes("TaskCommandRun") || bodyText.includes("taskCommandRunID")) {
        return {
          summary: "Fix the broken TypeScript fixture from the failed task command.",
          riskLevel: "Medium",
          fileChanges: [
            {
              path: brokenTypeScriptSmokePath,
              changeType: "Modify",
              rationale: "The failed runtime-npm-check command reports a syntax error in this temporary TypeScript fixture.",
              diffPreview: [
                `--- a/${brokenTypeScriptSmokePath}`,
                `+++ b/${brokenTypeScriptSmokePath}`,
                "@@ task command repair @@",
                "-export const forgeSmokeBroken: string = ;",
                "+export const forgeSmokeBroken: string = \"fixed\";"
              ].join("\n"),
              operationKind: "ReplaceText",
              appendText: "",
              findText: "export const forgeSmokeBroken: string = ;\n",
              replaceWith: "export const forgeSmokeBroken: string = \"fixed\";\n",
              content: ""
            }
          ]
        };
      }

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

async function collectRuntimeEventsDuring(
  action,
  done = (event, result) => event.type === "task.command.completed" && event.data?.taskID === result.id
) {
  const controller = new AbortController();
  const events = [];
  const streamPromise = collectRuntimeEvents(controller, events);

  await sleep(100);
  const result = await action();
  const deadline = Date.now() + 2_000;
  while (
    Date.now() < deadline &&
    !events.some((event) => done(event, result))
  ) {
    await sleep(50);
  }

  controller.abort();
  await streamPromise;
  return { result, events };
}

async function collectRuntimeEvents(controller, events) {
  try {
    const response = await fetch(`${baseURL}/events`, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`GET /events failed with ${response.status}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const parsed = parseRuntimeEventBlock(block);
        if (parsed) {
          events.push(parsed);
        }
        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
  }
}

function parseRuntimeEventBlock(block) {
  const lines = block.split("\n");
  let type = "message";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      type = line.slice("event: ".length);
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice("data: ".length));
    }
  }

  if (dataLines.length === 0) {
    return { type, data: undefined };
  }

  const dataText = dataLines.join("\n");
  try {
    return { type, data: JSON.parse(dataText) };
  } catch {
    return { type, data: dataText };
  }
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

async function approveAllProposalFiles(task) {
  let current = task;
  const proposal = current.editProposal;
  assert(proposal?.status === "Proposed", "File approval requires a proposed edit.");
  for (const change of proposal.fileChanges) {
    current = await post(`/tasks/${current.id}/review-edit-proposal-file`, {
      fileChangeID: change.id,
      decision: "Approved",
      note: `Core smoke approves ${change.path}.`
    });
  }
  assert(
    current.editProposal.fileChanges.every((change) =>
      current.editProposal.fileDecisions?.some((decision) =>
        decision.fileChangeID === change.id && decision.decision === "Approved"
      )
    ),
    "Not every proposed file retained an approved review decision."
  );
  return current;
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
