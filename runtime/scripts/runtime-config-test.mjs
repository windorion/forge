#!/usr/bin/env node
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultModelProviderRuntimeSettings } from "../dist/modelProvider.js";
import { loadRuntimeConfig } from "../dist/runtime/config.js";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entryURL = new URL("../dist/server.js", import.meta.url).href;
const configuredRepo = resolve(runtimeRoot, "fixture-repo");
const environment = {
  FORGE_RUNTIME_PORT: "18181",
  FORGE_RUNTIME_MODE: "observer",
  FORGE_RUNTIME_AUTHORIZATION_ID: " auth-1 ",
  FORGE_RUNTIME_AUTHORIZED_AT: " 2026-08-01T00:00:00.000Z ",
  FORGE_MODEL_PROVIDER_LOCK: "local",
  FORGE_REPO_ROOT: configuredRepo,
  FORGE_RUNTIME_DB_PATH: "state/tasks.sqlite",
  FORGE_MODEL_PROVIDER_SETTINGS_PATH: "state/provider.json",
  FORGE_VALIDATION_PRESET_CONFIG_PATH: "state/validation.json",
  FORGE_TASK_QUEUE_SETTINGS_PATH: "state/queue.json",
  FORGE_GITHUB_API_BASE: "https://github.example/api///",
  FORGE_ENABLE_SMOKE_COMMANDS: "1",
  FORGE_QUEUE_SMOKE_DELAY_MS: "9999",
  FORGE_STUCK_SWEEP_INTERVAL_MS: "1234",
  FORGE_MODEL_PROVIDER: "openai",
  FORGE_MODEL_NAME: "gpt-fixture",
  FORGE_OPENAI_BASE_URL: "https://openai.example/v1",
  FORGE_OPENAI_TIMEOUT_MS: "4321",
  FORGE_OPENAI_MAX_OUTPUT_TOKENS: "2048",
  OPENAI_API_KEY: "secret-fixture"
};

const config = loadRuntimeConfig(entryURL, environment);
assert.equal(config.runtimeDir, runtimeRoot);
assert.equal(config.repoRoot, configuredRepo);
assert.equal(config.repoRootSource, "FORGE_REPO_ROOT");
assert.equal(config.port, 18181);
assert.equal(config.observerMode, true);
assert.equal(config.runtimeAuthorizationID, "auth-1");
assert.equal(config.modelProviderLock, "local");
assert.equal(config.databasePath, resolve(configuredRepo, "state/tasks.sqlite"));
assert.equal(config.modelProviderSettingsPath, resolve(configuredRepo, "state/provider.json"));
assert.equal(config.validationPresetConfigPath, resolve(configuredRepo, "state/validation.json"));
assert.equal(config.taskQueueSettingsPath, resolve(configuredRepo, "state/queue.json"));
assert.equal(config.githubApiBase, "https://github.example/api");
assert.equal(config.taskQueueSmokeDelayMs, 5_000);
assert.equal(config.stuckSweepIntervalMs, 1234);
assert.notEqual(config.environment, environment);

const defaults = defaultModelProviderRuntimeSettings(config.environment);
assert.equal(defaults.providerID, "openai");
assert.equal(defaults.modelName, "gpt-fixture");
assert.equal(defaults.openAITimeoutMs, 4321);
assert.equal(defaults.openAIMaxOutputTokens, 2048);
assert.equal(defaults.openAIAPIKey, "secret-fixture");

const fallback = loadRuntimeConfig(entryURL, {});
assert.equal(fallback.repoRoot, resolve(runtimeRoot, ".."));
assert.equal(fallback.databasePath, resolve(runtimeRoot, "..", ".forge/forge.sqlite"));
assert.equal(fallback.observerMode, false);
assert.equal(fallback.taskQueueSmokeDelayMs, 0);

console.log("Runtime config test passed: 24 assertions.");
