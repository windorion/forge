#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createModelProvider,
  createModelProviderFromEnv,
  defaultModelProviderRuntimeSettings,
  getModelProviderConfiguration,
  getModelProviderConfigurationFromEnv
} from "../dist/modelProvider.js";

let count = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  count += 1;
};

const local = createModelProvider({ providerID: " LOCAL ", modelName: " custom-local " });
ok(local.info.id === "local" && local.info.model === "custom-local" && local.info.mode === "local", "local factory normalization");

const localConfig = getModelProviderConfiguration({ providerID: undefined, modelName: " " });
ok(localConfig.status === "Ready" && localConfig.sendsRemoteContext === false, "local configuration is ready and local-only");
ok(localConfig.provider.model === "local-deterministic-v0", "local model fallback");

const followUpMessage = {
  id: "follow-up",
  role: "User",
  kind: "UserMessage",
  content: "Use @src/slugify.py and replace the named expression.",
  createdAt: "2026-08-08T12:00:00.000Z",
  fileReferences: [{
    id: "reference",
    requestedPath: "src/slugify.py",
    path: "src/slugify.py",
    status: "Resolved",
    summary: "slugify source",
    detectedAt: "2026-08-08T12:00:00.000Z"
  }]
};
const establishedTask = {
  objective: "Refactor slugify and verify it with the repository test.",
  messages: [
    {
      id: "initial-brief",
      role: "Assistant",
      kind: "IntentBrief",
      content: "Intent established.",
      createdAt: "2026-08-08T11:59:00.000Z",
      fileReferences: [],
      intentBrief: {
        summary: "Refactor and test slugify.",
        constraints: [],
        acceptanceCriteria: ["Repository test passes."],
        openQuestions: [],
        nextAction: "Generate the plan."
      }
    },
    followUpMessage
  ],
  planRevisions: [{ id: "plan-1" }],
  contextFiles: [],
  changedFiles: []
};
const preservedFollowUp = await local.createIntentBrief({ task: establishedTask, latestUserMessage: followUpMessage });
ok(preservedFollowUp.openQuestions.length === 0, "bounded follow-up preserves established intent without reopening generic clarification");
ok(preservedFollowUp.nextAction.includes("revised reviewable plan"), "bounded follow-up routes to plan revision");

const unplannedTask = { ...establishedTask, messages: [followUpMessage], planRevisions: [] };
const unplannedFollowUp = await local.createIntentBrief({ task: unplannedTask, latestUserMessage: followUpMessage });
ok(unplannedFollowUp.openQuestions.length === 1, "unplanned request still asks for missing validation criteria");

const escapedPatchMessage = {
  ...followUpMessage,
  id: "escaped-patch",
  content: [
    "Use @src/slugify.py.",
    "Replace \"value = text.strip()\" with \"value = text.strip().lower()\".",
    "Replace \"return value.replace(\\\" \\\", \\\"_\\\")\" with \"return value.replace(\\\" \\\", \\\"-\\\")\"."
  ].join(" ")
};
const escapedPatch = await local.createEditProposal({
  task: {
    ...establishedTask,
    title: "Escaped quote patch",
    messages: [escapedPatchMessage]
  },
  sourceMessage: escapedPatchMessage,
  revisionNumber: 1
});
const escapedOperation = escapedPatch.fileChanges[0].applyOperation;
ok(escapedOperation.kind === "PatchText" && escapedOperation.hunks.length === 2, "escaped quotes produce a two-hunk patch");
ok(
  escapedOperation.kind === "PatchText" && escapedOperation.hunks[1].findText === "return value.replace(\" \", \"_\")",
  "escaped quote text is decoded before exact-match validation"
);

const originalFetch = globalThis.fetch;
let capturedRepairPrompt = "";
try {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    capturedRepairPrompt = body.input.flatMap((message) => message.content).map((part) => part.text).join("\n");
    return new Response(JSON.stringify({
      status: "completed",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            summary: "Repair the failed command fixture.",
            riskLevel: "Medium",
            fileChanges: [{
              path: "runtime/src/broken.ts",
              changeType: "Modify",
              rationale: "Use the complete repair brief.",
              diffPreview: "--- a/runtime/src/broken.ts\n+++ b/runtime/src/broken.ts\n@@ -1 +1 @@\n-broken\n+fixed",
              operationKind: "ReplaceText",
              appendText: "",
              findText: "broken",
              replaceWith: "fixed",
              patchHunks: [],
              unifiedDiff: "",
              content: ""
            }]
          })
        }]
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const openAIForRepair = createModelProvider({
    providerID: "openai",
    modelName: "repair-context-test",
    openAIBaseURL: "https://provider.test/v1",
    openAIAPIKey: "test-key"
  });
  const repairBrief = {
    id: "brief-1",
    provider: openAIForRepair.info,
    source: "TaskCommandRun",
    sourceSummary: "Runtime type-check / Failed",
    taskCommandRunID: "command-run-1",
    summary: "The TypeScript check failed.",
    likelyCause: "An incomplete assignment is present.",
    recommendedActions: ["Fix the exact assignment."],
    followUpPrompt: "Fix broken.ts and rerun runtime-npm-check.",
    riskLevel: "Medium",
    generatedAt: "2026-08-08T12:00:00.000Z"
  };
  await openAIForRepair.createEditProposal({
    task: {
      ...establishedTask,
      id: "task-1",
      title: "Repair command failure",
      status: "Failed",
      currentPhase: "Command Failed",
      reviewSummary: "Review the repair brief.",
      planSteps: [],
      validationRepairBriefs: [repairBrief],
      agentRunSteps: []
    },
    revisionNumber: 1,
    validationRepairBrief: repairBrief
  });
  ok(capturedRepairPrompt.includes('"validationRepairBrief": {'), "first command repair proposal includes a dedicated repair-brief object");
  ok(capturedRepairPrompt.includes('"id": "brief-1"'), "first command repair proposal includes repair-brief identity");
  ok(capturedRepairPrompt.includes('"followUpPrompt": "Fix broken.ts and rerun runtime-npm-check."'), "first command repair proposal includes the full follow-up prompt");
} finally {
  globalThis.fetch = originalFetch;
}

const providerFailureToken = ["sk", "providerfailure1234567890"].join("-");
try {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: `upstream echoed Bearer ${providerFailureToken}` } }),
    { status: 401, headers: { "content-type": "application/json" } }
  );
  const failingProvider = createModelProvider({
    providerID: "openai",
    openAIBaseURL: "https://provider.test/v1",
    openAIAPIKey: "fixture-key"
  });
  let providerFailure;
  try {
    await failingProvider.createIntentBrief({
      task: {
        ...establishedTask,
        title: "Provider failure redaction",
        status: "Planning",
        currentPhase: "Intent",
        planSteps: [],
        validationRepairBriefs: [],
        agentRunSteps: []
      },
      latestUserMessage: followUpMessage
    });
  } catch (error) {
    providerFailure = error;
  }
  ok(providerFailure instanceof Error, "provider HTTP failure remains actionable");
  ok(!providerFailure.message.includes(providerFailureToken), "provider HTTP failure redacts echoed credentials");
  ok(providerFailure.message.includes("[REDACTED]"), "provider HTTP failure retains explicit redaction evidence");
} finally {
  globalThis.fetch = originalFetch;
}

const openAIMissing = getModelProviderConfiguration({
  providerID: "openai",
  modelName: " ",
  openAIBaseURL: "https://example.test/v1///",
  openAITimeoutMs: -1,
  openAIMaxOutputTokens: 0,
  openAIAPIKey: " "
});
ok(openAIMissing.status === "NeedsConfiguration" && openAIMissing.issues.length === 1, "missing OpenAI key is explicit");
ok(openAIMissing.provider.model === "gpt-5.5" && openAIMissing.sendsRemoteContext === true, "OpenAI defaults and remote boundary");
ok(openAIMissing.settings.some((item) => item.id === "base-url" && item.value === "https://example.test/v1"), "base URL trailing slashes normalized");
ok(openAIMissing.settings.some((item) => item.id === "timeout" && item.value === "30000 ms"), "invalid timeout falls back");
ok(openAIMissing.settings.some((item) => item.id === "max-output" && item.value === "1800 tokens"), "invalid output limit falls back");

const credentialURLConfig = getModelProviderConfiguration({
  providerID: "openai",
  openAIBaseURL: "https://forge:provider-password@example.test/v1"
});
const publicCredentialURL = credentialURLConfig.settings.find((item) => item.id === "base-url")?.value ?? "";
ok(!publicCredentialURL.includes("provider-password") && publicCredentialURL.includes("[REDACTED]"), "public provider configuration redacts URL credentials");

const openAIReady = getModelProviderConfiguration({ providerID: "OPENAI", openAIAPIKey: " test-key " });
ok(openAIReady.status === "Ready" && openAIReady.issues.length === 0, "configured OpenAI provider is ready");
ok(openAIReady.settings.some((item) => item.id === "api-key" && item.value === "Configured" && item.isSecret), "API key is represented without disclosure");

const unsupported = createModelProvider({ providerID: "custom", modelName: "remote-x" });
const unsupportedConfig = getModelProviderConfiguration({ providerID: "custom", modelName: "remote-x" });
ok(unsupported.info.id === "custom" && unsupportedConfig.status === "Unsupported", "unsupported provider is fail-closed");
for (const method of [
  "createIntentBrief",
  "createPlanRevision",
  "createExecutionProposal",
  "createAgentRunStep",
  "createEditProposal",
  "createValidationRepairBrief"
]) {
  await assert.rejects(() => unsupported[method](), /Unsupported model provider "custom"/);
  count += 1;
}

const envKeys = [
  "FORGE_MODEL_PROVIDER",
  "FORGE_MODEL_NAME",
  "FORGE_OPENAI_BASE_URL",
  "FORGE_OPENAI_TIMEOUT_MS",
  "FORGE_OPENAI_MAX_OUTPUT_TOKENS",
  "OPENAI_API_KEY"
];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
try {
  process.env.FORGE_MODEL_PROVIDER = " OPENAI ";
  process.env.FORGE_MODEL_NAME = " env-model ";
  process.env.FORGE_OPENAI_BASE_URL = " https://env.test/v1 ";
  process.env.FORGE_OPENAI_TIMEOUT_MS = "4500";
  process.env.FORGE_OPENAI_MAX_OUTPUT_TOKENS = "not-a-number";
  process.env.OPENAI_API_KEY = " env-key ";

  const settings = defaultModelProviderRuntimeSettings();
  ok(settings.providerID === "openai" && settings.modelName === "env-model", "environment provider settings normalized");
  ok(settings.openAITimeoutMs === 4500 && settings.openAIMaxOutputTokens === undefined, "environment numeric settings validated");
  ok(settings.openAIAPIKey === "env-key", "environment key trimmed in memory");
  ok(createModelProviderFromEnv().info.model === "env-model", "environment factory wrapper");
  ok(getModelProviderConfigurationFromEnv().status === "Ready", "environment configuration wrapper");
} finally {
  for (const key of envKeys) {
    const value = previousEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

console.log(`Model provider test passed: ${count} assertions.`);
