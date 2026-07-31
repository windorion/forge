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
