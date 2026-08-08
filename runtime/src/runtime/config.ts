import path from "node:path";
import { fileURLToPath } from "node:url";

import { thresholdsFromEnv, type StuckThresholds } from "../stuckDetection.js";

export interface RuntimeConfig {
  startedAt: number;
  port: number;
  observerMode: boolean;
  runtimeAuthorizationID?: string;
  runtimeAuthorizedAt?: string;
  modelProviderLock?: "local";
  runtimeDir: string;
  repoRoot: string;
  repoRootSource: "FORGE_REPO_ROOT" | "runtime parent";
  databasePath: string;
  modelProviderSettingsPath: string;
  rollbackSnapshotRoot: string;
  validationPresetConfigPath: string;
  taskQueueSettingsPath: string;
  githubApiBase: string;
  enableSmokeCommands: boolean;
  taskQueueSmokeDelayMs: number;
  supervisedQueueDispatch: boolean;
  stuckThresholds: StuckThresholds;
  stuckSweepIntervalMs: number;
  environment: NodeJS.ProcessEnv;
}

export function loadRuntimeConfig(
  entryModuleURL: string,
  sourceEnvironment: NodeJS.ProcessEnv = process.env
): RuntimeConfig {
  const environment = { ...sourceEnvironment };
  const runtimeDir = path.resolve(path.dirname(fileURLToPath(entryModuleURL)), "..");
  const configuredRepoRoot = environment.FORGE_REPO_ROOT?.trim();
  const repoRoot = configuredRepoRoot ? path.resolve(configuredRepoRoot) : path.resolve(runtimeDir, "..");
  const observerMode = environment.FORGE_RUNTIME_MODE === "observer";
  const enableSmokeCommands = environment.FORGE_ENABLE_SMOKE_COMMANDS === "1";
  const configuredQueueDelay = Number.parseInt(environment.FORGE_QUEUE_SMOKE_DELAY_MS ?? "0", 10) || 0;
  const supervisedQueueDispatch = environment.FORGE_QUEUE_DISPATCH_MODE === "supervised";

  return {
    startedAt: Date.now(),
    port: Number(environment.FORGE_RUNTIME_PORT ?? 17373),
    observerMode,
    runtimeAuthorizationID: environment.FORGE_RUNTIME_AUTHORIZATION_ID?.trim() || undefined,
    runtimeAuthorizedAt: environment.FORGE_RUNTIME_AUTHORIZED_AT?.trim() || undefined,
    modelProviderLock: environment.FORGE_MODEL_PROVIDER_LOCK === "local" ? "local" : undefined,
    runtimeDir,
    repoRoot,
    repoRootSource: configuredRepoRoot ? "FORGE_REPO_ROOT" : "runtime parent",
    databasePath: resolveRepoPath(repoRoot, environment.FORGE_RUNTIME_DB_PATH, ".forge/forge.sqlite"),
    modelProviderSettingsPath: resolveRepoPath(
      repoRoot,
      environment.FORGE_MODEL_PROVIDER_SETTINGS_PATH,
      ".forge/model-provider-settings.json"
    ),
    rollbackSnapshotRoot: path.join(repoRoot, ".forge", "rollback-snapshots"),
    validationPresetConfigPath: resolveRepoPath(
      repoRoot,
      environment.FORGE_VALIDATION_PRESET_CONFIG_PATH,
      ".forge/validation-presets.json"
    ),
    taskQueueSettingsPath: resolveRepoPath(
      repoRoot,
      environment.FORGE_TASK_QUEUE_SETTINGS_PATH?.trim(),
      ".forge/task-queue.json"
    ),
    githubApiBase: (environment.FORGE_GITHUB_API_BASE ?? "https://api.github.com").replace(/\/+$/, ""),
    enableSmokeCommands,
    taskQueueSmokeDelayMs: enableSmokeCommands ? Math.min(Math.max(configuredQueueDelay, 0), 5_000) : 0,
    supervisedQueueDispatch,
    stuckThresholds: thresholdsFromEnv(environment),
    stuckSweepIntervalMs: Number(environment.FORGE_STUCK_SWEEP_INTERVAL_MS ?? 60_000),
    environment
  };
}

function resolveRepoPath(repoRoot: string, configured: string | undefined, fallback: string): string {
  return configured ? path.resolve(repoRoot, configured) : path.join(repoRoot, fallback);
}
