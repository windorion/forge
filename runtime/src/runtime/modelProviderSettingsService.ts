import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import { redactSensitiveText, safeErrorMessage } from "../security/secretRedaction.js";
import {
  createModelProvider,
  defaultModelProviderRuntimeSettings,
  getModelProviderConfiguration,
  type ModelProvider
} from "../modelProvider.js";
import type {
  ModelProviderRuntimeSettings,
  ModelProviderSettingsUpdateRequest
} from "../types.js";

export interface PublicModelProviderRuntimeSettings {
  providerID: string;
  modelName?: string;
  openAIBaseURL?: string;
  openAITimeoutMs?: number;
  openAIMaxOutputTokens?: number;
  hasOpenAIAPIKey: boolean;
  settingsPath: string;
}

export function createModelProviderSettingsService(options: {
  modelProviderSettingsPath: string;
  modelProviderLock?: string;
  runtimeEnvironment: NodeJS.ProcessEnv;
  repoRoot: string;
  observerMode: boolean;
  emit: (type: string, data: Record<string, unknown>) => void;
}) {
const {
  modelProviderSettingsPath,
  modelProviderLock,
  runtimeEnvironment,
  repoRoot,
  observerMode,
  emit
} = options;

let modelProviderSettings = loadModelProviderRuntimeSettings();
let modelProvider: ModelProvider = createModelProvider(modelProviderSettings);

function loadModelProviderRuntimeSettings(): ModelProviderRuntimeSettings {
  const defaults = defaultModelProviderRuntimeSettings(runtimeEnvironment);
  const settingsPath = modelProviderSettingsPath;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return applyModelProviderLock(defaults);
    }

    console.warn(`Forge model provider settings ignored: ${safeErrorMessage(error)}`);
    return applyModelProviderLock(defaults);
  }

  if (!isRecord(parsed)) {
    console.warn("Forge model provider settings ignored: root value must be an object.");
    return applyModelProviderLock(defaults);
  }

  return applyModelProviderLock({
    ...defaults,
    providerID: providerIDFromPersistedSetting(parsed.providerID, defaults.providerID),
    modelName: stringSettingFromUnknown(parsed.modelName) ?? defaults.modelName,
    openAIBaseURL: stringSettingFromUnknown(parsed.openAIBaseURL) ?? defaults.openAIBaseURL,
    openAITimeoutMs: positiveIntegerFromUnknown(parsed.openAITimeoutMs) ?? defaults.openAITimeoutMs,
    openAIMaxOutputTokens: positiveIntegerFromUnknown(parsed.openAIMaxOutputTokens)
      ?? defaults.openAIMaxOutputTokens,
    openAIAPIKey: defaults.openAIAPIKey
  });
}

function applyModelProviderLock(settings: ModelProviderRuntimeSettings): ModelProviderRuntimeSettings {
  if (modelProviderLock !== "local") return settings;
  return {
    ...settings,
    providerID: "local",
    modelName: undefined,
    openAIAPIKey: undefined
  };
}

async function updateModelProviderSettings(
  input: ModelProviderSettingsUpdateRequest
): Promise<ReturnType<typeof getModelProviderConfiguration>> {
  if (modelProviderLock) {
    throw new HttpError(403, "Model provider settings are locked to local for this authorized background runtime.");
  }
  if (!isRecord(input)) {
    throw new HttpError(400, "Model provider settings update must be an object.");
  }

  const previousProviderID = modelProviderSettings.providerID;
  const nextProviderID = "providerID" in input
    ? providerIDFromUnknown(input.providerID, modelProviderSettings.providerID)
    : modelProviderSettings.providerID;
  const providerChanged = nextProviderID !== previousProviderID;
  const nextSettings: ModelProviderRuntimeSettings = {
    ...modelProviderSettings,
    providerID: nextProviderID
  };

  if (providerChanged && !("modelName" in input)) {
    nextSettings.modelName = undefined;
  }

  if ("modelName" in input) {
    nextSettings.modelName = optionalTrimmedString(input.modelName, "modelName", 120);
  }

  if ("openAIBaseURL" in input) {
    nextSettings.openAIBaseURL = optionalURLString(input.openAIBaseURL, "openAIBaseURL");
  }

  if ("openAITimeoutMs" in input) {
    nextSettings.openAITimeoutMs = optionalPositiveInteger(input.openAITimeoutMs, "openAITimeoutMs", 1, 300_000);
  }

  if ("openAIMaxOutputTokens" in input) {
    nextSettings.openAIMaxOutputTokens = optionalPositiveInteger(
      input.openAIMaxOutputTokens,
      "openAIMaxOutputTokens",
      1,
      200_000
    );
  }

  if (input.clearOpenAIAPIKey === true) {
    nextSettings.openAIAPIKey = undefined;
  }

  if ("openAIAPIKey" in input) {
    const apiKey = optionalTrimmedString(input.openAIAPIKey, "openAIAPIKey", 20_000);
    if (apiKey) {
      nextSettings.openAIAPIKey = apiKey;
    }
  }

  await persistModelProviderSettings(nextSettings);
  modelProviderSettings = nextSettings;
  modelProvider = createModelProvider(modelProviderSettings);
  return getModelProviderConfiguration(modelProviderSettings);
}

async function persistModelProviderSettings(settings: ModelProviderRuntimeSettings): Promise<void> {
  const settingsPath = modelProviderSettingsPath;
  const persisted = stripUndefinedValues({
    providerID: providerIDFromUnknown(settings.providerID, "local"),
    modelName: optionalPersistedString(settings.modelName),
    openAIBaseURL: optionalPersistedString(settings.openAIBaseURL),
    openAITimeoutMs: positiveIntegerFromUnknown(settings.openAITimeoutMs),
    openAIMaxOutputTokens: positiveIntegerFromUnknown(settings.openAIMaxOutputTokens)
  });

  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
}

function publicModelProviderRuntimeSettings(
  settings: ModelProviderRuntimeSettings
): PublicModelProviderRuntimeSettings {
  return {
    providerID: providerIDForPublicSettings(settings.providerID),
    modelName: settings.modelName,
    openAIBaseURL: settings.openAIBaseURL ? redactSensitiveText(settings.openAIBaseURL).text : undefined,
    openAITimeoutMs: settings.openAITimeoutMs,
    openAIMaxOutputTokens: settings.openAIMaxOutputTokens,
    hasOpenAIAPIKey: Boolean(settings.openAIAPIKey?.trim()),
    settingsPath: modelProviderSettingsPath
  };
}

function providerIDFromUnknown(value: unknown, fallback: string): string {
  const providerID = typeof value === "string" ? value.trim().toLowerCase() : fallback;
  if (providerID === "local" || providerID === "openai") {
    return providerID;
  }

  throw new HttpError(400, `Unsupported model provider "${providerID}". Use local or openai.`);
}

function providerIDFromPersistedSetting(value: unknown, fallback: string): string {
  const providerID = typeof value === "string" ? value.trim().toLowerCase() : fallback;
  if (providerID === "local" || providerID === "openai") {
    return providerID;
  }

  console.warn(`Forge model provider settings ignored unsupported provider: ${providerID}`);
  return fallback;
}

function providerIDForPublicSettings(value: unknown): string {
  const providerID = typeof value === "string" ? value.trim().toLowerCase() : "";
  return providerID || "local";
}

function stringSettingFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalPersistedString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function optionalTrimmedString(value: unknown, fieldName: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(413, `${fieldName} is too large.`);
  }

  return trimmed || undefined;
}

function stringFieldFromUnknown(value: unknown, fieldName: string, minLength: number, maxLength: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new HttpError(400, `${fieldName} is too short.`);
  }

  if (trimmed.length > maxLength) {
    throw new HttpError(413, `${fieldName} is too large.`);
  }

  return trimmed;
}

function normalizeSingleLineField(value: unknown, fieldName: string, minLength: number, maxLength: number): string {
  const trimmed = stringFieldFromUnknown(value, fieldName, minLength, maxLength);
  if (trimmed.includes("\n") || trimmed.includes("\r")) {
    throw new HttpError(400, `${fieldName} must be a single line.`);
  }
  return trimmed;
}

function optionalURLString(value: unknown, fieldName: string): string | undefined {
  const trimmed = optionalTrimmedString(value, fieldName, 2_000);
  if (!trimmed) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, `${fieldName} must be a valid URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, `${fieldName} must use http or https.`);
  }
  if (parsed.username || parsed.password) {
    throw new HttpError(400, `${fieldName} must not contain URL credentials.`);
  }

  return trimmed.replace(/\/+$/, "");
}

function optionalPositiveInteger(
  value: unknown,
  fieldName: string,
  min: number,
  max: number
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
    throw new HttpError(400, `${fieldName} must be an integer from ${min} to ${max}.`);
  }

  return numberValue;
}

function positiveIntegerFromUnknown(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function stripUndefinedValues<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

return {
  getSettings: () => modelProviderSettings,
  getModelProvider: () => modelProvider,
  updateModelProviderSettings,
  publicModelProviderRuntimeSettings
};
}
