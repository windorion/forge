import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import {
  createModelProvider,
  defaultModelProviderRuntimeSettings,
  getModelProviderConfiguration
} from "./modelProvider.js";
import { SqliteTaskStore } from "./taskStore.js";
import type {
  AgentState,
  ApprovalRecord,
  ApprovePlanRequest,
  ApproveValidationPresetRequest,
  ContextFile,
  CreateTaskMessageRequest,
  CreateTaskRequest,
  EditProposal,
  EditProposalDecisionRequest,
  EditProposalValidation,
  FileChangeValidation,
  ForgeTask,
  ModelProviderRuntimeSettings,
  ModelProviderSettingsUpdateRequest,
  PlanRevision,
  PlanStep,
  ProposedFileChange,
  RuntimeEvent,
  RunValidationRequest,
  TaskFileReference,
  TaskMessage,
  ToolCall,
  ValidationCommandDefinition,
  ValidationCommandResult,
  ValidationPermissionEnvelope,
  ValidationPermissionLastRun,
  ValidationPresetPermission,
  ValidationPreset,
  ValidationRun
} from "./types.js";

const startedAt = Date.now();
const port = Number(process.env.FORGE_RUNTIME_PORT ?? 17373);
const eventClients = new Set<ServerResponse>();
const runtimeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(runtimeDir, "..");
const taskStore = new SqliteTaskStore(resolveDatabasePath());
const tasks = new Map<string, ForgeTask>(taskStore.loadTasks().map((task) => [task.id, task]));
let modelProviderSettings = loadModelProviderRuntimeSettings();
let modelProvider = createModelProvider(modelProviderSettings);
const validationCommandTimeoutMs = 60_000;
const repositoryScanMaxFiles = 400;
const repositorySearchMaxFiles = 240;
const repositoryContextMaxFiles = 6;
const repositoryContextMaxFileBytes = 220_000;
const repositoryIgnoredDirectories = new Set([
  ".build",
  ".forge",
  ".git",
  ".swiftpm",
  "DerivedData",
  "dist",
  "node_modules"
]);
const repositoryIgnoredFileNames = new Set([
  ".DS_Store",
  "package-lock.json"
]);
const repositoryContextExtensions = new Set([
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".swift",
  ".sh",
  ".yml",
  ".yaml",
  ".toml"
]);
const repositoryImportantFiles = [
  "README.md",
  "AGENTS.md",
  "docs/v0_scope.md",
  "docs/development.md",
  "docs/runtime_architecture.md",
  "docs/model_providers.md",
  "docs/local_first.md",
  "runtime/src/server.ts",
  "runtime/src/modelProvider.ts",
  "runtime/src/types.ts",
  "Package.swift"
];
const repositorySearchStopWords = new Set([
  "about",
  "after",
  "again",
  "agent",
  "because",
  "before",
  "build",
  "code",
  "continue",
  "current",
  "doing",
  "done",
  "files",
  "forge",
  "from",
  "have",
  "into",
  "like",
  "local",
  "make",
  "next",
  "only",
  "plan",
  "project",
  "repo",
  "task",
  "that",
  "this",
  "what",
  "with",
  "work"
]);
const chineseIntentSearchTerms: Array<[string, string[]]> = [
  ["模型", ["model", "provider", "intent"]],
  ["意图", ["intent", "brief", "objective"]],
  ["上下文", ["context", "repository", "file"]],
  ["搜索", ["search", "context", "file"]],
  ["仓库", ["repository", "repo", "context"]],
  ["代码", ["code", "edit", "diff"]],
  ["聊天", ["conversation", "message", "intent"]],
  ["对话", ["conversation", "message", "intent"]],
  ["验证", ["validation", "preset", "command"]],
  ["测试", ["test", "validation", "command"]],
  ["权限", ["permission", "approval", "risk"]],
  ["审批", ["approval", "review", "permission"]],
  ["本地", ["local", "runtime", "context"]],
  ["执行", ["execution", "proposal", "agent"]],
  ["修改", ["edit", "proposal", "diff"]],
  ["文件", ["file", "context", "read"]],
  ["不是", ["mimic", "deterministic", "provider"]],
  ["模拟", ["mimic", "deterministic", "provider"]]
];

type InternalValidationCommand = Omit<ValidationCommandDefinition, "executionMode" | "boundary"> & {
  executable?: string;
  args?: string[];
  executeBuiltIn?: (task: ForgeTask) => Promise<string>;
};

type InternalValidationPreset = Omit<ValidationPreset, "commands"> & {
  commands: InternalValidationCommand[];
};

interface WorkspacePresetConfigStatus {
  path: string;
  exists: boolean;
  issues: string[];
}

interface ValidationPresetRegistry {
  presets: InternalValidationPreset[];
  workspaceConfig: WorkspacePresetConfigStatus;
}

interface PublicModelProviderRuntimeSettings {
  providerID: string;
  modelName?: string;
  openAIBaseURL?: string;
  openAITimeoutMs?: number;
  openAIMaxOutputTokens?: number;
  hasOpenAIAPIKey: boolean;
  settingsPath: string;
}

interface RepositorySearchMatch {
  path: string;
  score: number;
  reasons: string[];
  matchedLines: string[];
}

const builtInValidationCommands: InternalValidationCommand[] = [
  {
    id: "changed-files-exist",
    name: "Changed files exist",
    command: "forge:changed-files-exist",
    kind: "BuiltIn",
    riskLevel: "Low",
    executeBuiltIn: validateChangedFiles
  },
  {
    id: "applied-proposal-recorded",
    name: "Applied proposal recorded",
    command: "forge:applied-proposal-recorded",
    kind: "BuiltIn",
    riskLevel: "Low",
    executeBuiltIn: validateAppliedProposalRecorded
  },
  {
    id: "ready-validation-retained",
    name: "Ready validation retained",
    command: "forge:ready-validation-retained",
    kind: "BuiltIn",
    riskLevel: "Low",
    executeBuiltIn: validateReadyProposalValidation
  }
];

const projectValidationCommands: InternalValidationCommand[] = [
  {
    id: "runtime-npm-check",
    name: "Runtime type-check",
    command: "npm run check",
    kind: "ProjectCommand",
    riskLevel: "Medium",
    cwd: "runtime",
    executable: "npm",
    args: ["run", "check"]
  },
  {
    id: "runtime-npm-build",
    name: "Runtime build",
    command: "npm run build",
    kind: "ProjectCommand",
    riskLevel: "Medium",
    cwd: "runtime",
    executable: "npm",
    args: ["run", "build"]
  },
  {
    id: "macos-swift-build",
    name: "macOS SwiftPM build",
    command: "swift build",
    kind: "ProjectCommand",
    riskLevel: "Medium",
    executable: "swift",
    args: ["build"]
  }
];

const validationCommandCatalog = new Map(
  [...builtInValidationCommands, ...projectValidationCommands].map((command) => [command.id, command])
);

const builtInValidationPresets: InternalValidationPreset[] = [
  {
    id: "forge-post-apply",
    name: "Forge Post-Apply Checks",
    description: "Built-in checks that confirm the applied proposal and changed files are still auditable.",
    source: "BuiltIn",
    riskLevel: "Low",
    requiresApproval: false,
    commands: builtInValidationCommands
  },
  {
    id: "runtime-typescript",
    name: "Runtime TypeScript Checks",
    description: "Approved project checks for the local TypeScript runtime: type-check and build.",
    source: "BuiltIn",
    riskLevel: "Medium",
    requiresApproval: true,
    commands: projectValidationCommands.filter((command) => command.id.startsWith("runtime-"))
  },
  {
    id: "macos-swiftpm",
    name: "macOS SwiftPM Build",
    description: "Approved project check for the native macOS SwiftPM app: swift build from the repository root.",
    source: "BuiltIn",
    riskLevel: "Medium",
    requiresApproval: true,
    commands: projectValidationCommands.filter((command) => command.id === "macos-swift-build")
  }
];

const defaultAgents: AgentState[] = [
  { role: "Manager", status: "Active", summary: "Owns task lifecycle and constraints" },
  { role: "Planner", status: "Ready", summary: "Preparing the first implementation plan" },
  { role: "Coder", status: "Idle", summary: "Waiting for approved plan" },
  { role: "Tester", status: "Idle", summary: "Waiting for validation command" },
  { role: "Reviewer", status: "Idle", summary: "Waiting for diff" }
];

const defaultPlanSteps: PlanStep[] = [
  {
    id: "understand-objective",
    title: "Understand task objective",
    status: "Active",
    summary: "Parse the user request and preserve constraints."
  },
  {
    id: "build-context",
    title: "Build repository context",
    status: "Pending",
    summary: "Inspect project memory and local repository signals."
  },
  {
    id: "draft-plan",
    title: "Draft implementation plan",
    status: "Pending",
    summary: "Turn context into a reviewable plan."
  },
  {
    id: "request-review",
    title: "Request human review",
    status: "Pending",
    summary: "Pause before code changes."
  }
];

const server = createServer(async (request, response) => {
  applyCors(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/") {
      writeHtml(response, 200, renderRuntimeHome());
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        ok: true,
        service: "forge-runtime",
        version: "0.1.0",
        uptimeSeconds: (Date.now() - startedAt) / 1000,
        modelProvider: modelProvider.info,
        modelProviderConfiguration: getModelProviderConfiguration(modelProviderSettings),
        persistence: {
          databasePath: taskStore.dbPath,
          taskCount: tasks.size
        }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/tasks") {
      writeJson(response, 200, { tasks: listTasks() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/validation-presets") {
      const registry = await loadValidationPresetRegistry();
      writeJson(response, 200, {
        presets: listValidationPresets(registry),
        workspaceConfig: registry.workspaceConfig
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/settings/model-provider") {
      writeJson(response, 200, {
        configuration: getModelProviderConfiguration(modelProviderSettings),
        editableSettings: publicModelProviderRuntimeSettings(modelProviderSettings)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/settings/model-provider") {
      const input = await readJson<ModelProviderSettingsUpdateRequest>(request);
      const configuration = await updateModelProviderSettings(input);
      writeJson(response, 200, {
        configuration,
        editableSettings: publicModelProviderRuntimeSettings(modelProviderSettings)
      });
      return;
    }

    const validationPermissionsTaskID = taskIDFromActionPath(url.pathname, "validation-permissions");
    if (request.method === "GET" && validationPermissionsTaskID) {
      writeJson(response, 200, await listValidationPermissions(validationPermissionsTaskID));
      return;
    }

    const createMessageTaskID = taskIDFromActionPath(url.pathname, "messages");
    if (request.method === "POST" && createMessageTaskID) {
      const input = await readJson<CreateTaskMessageRequest>(request);
      const task = await createTaskMessage(createMessageTaskID, input);
      writeJson(response, 201, task);
      return;
    }

    const generatePlanRevisionTaskID = taskIDFromActionPath(url.pathname, "generate-plan-revision");
    if (request.method === "POST" && generatePlanRevisionTaskID) {
      const task = await generatePlanRevision(generatePlanRevisionTaskID);
      writeJson(response, 200, task);
      return;
    }

    if (request.method === "POST" && url.pathname === "/tasks") {
      const input = await readJson<CreateTaskRequest>(request);
      const task = await createTask(input);
      tasks.set(task.id, task);
      taskStore.saveTask(task);
      emit("task.created", { taskID: task.id, title: task.title, task });
      runAgentLoopV0(task.id);
      writeJson(response, 201, task);
      return;
    }

    const approvePlanTaskID = taskIDFromActionPath(url.pathname, "approve-plan");
    if (request.method === "POST" && approvePlanTaskID) {
      const input = await readJson<ApprovePlanRequest>(request);
      const task = await approvePlan(approvePlanTaskID, input);
      writeJson(response, 200, task);
      return;
    }

    const generateEditProposalTaskID = taskIDFromActionPath(url.pathname, "generate-edit-proposal");
    if (request.method === "POST" && generateEditProposalTaskID) {
      const task = await generateEditProposal(generateEditProposalTaskID);
      writeJson(response, 200, task);
      return;
    }

    const reviseEditProposalTaskID = taskIDFromActionPath(url.pathname, "revise-edit-proposal");
    if (request.method === "POST" && reviseEditProposalTaskID) {
      const task = await reviseEditProposal(reviseEditProposalTaskID);
      writeJson(response, 200, task);
      return;
    }

    const validateEditProposalTaskID = taskIDFromActionPath(url.pathname, "validate-edit-proposal");
    if (request.method === "POST" && validateEditProposalTaskID) {
      const task = await validateEditProposal(validateEditProposalTaskID);
      writeJson(response, 200, task);
      return;
    }

    const applyEditProposalTaskID = taskIDFromActionPath(url.pathname, "apply-edit-proposal");
    if (request.method === "POST" && applyEditProposalTaskID) {
      const input = await readJson<EditProposalDecisionRequest>(request);
      const task = await applyEditProposal(applyEditProposalTaskID, input);
      writeJson(response, 200, task);
      return;
    }

    const rejectEditProposalTaskID = taskIDFromActionPath(url.pathname, "reject-edit-proposal");
    if (request.method === "POST" && rejectEditProposalTaskID) {
      const input = await readJson<EditProposalDecisionRequest>(request);
      const task = rejectEditProposal(rejectEditProposalTaskID, input);
      writeJson(response, 200, task);
      return;
    }

    const approveValidationPresetTaskID = taskIDFromActionPath(url.pathname, "approve-validation-preset");
    if (request.method === "POST" && approveValidationPresetTaskID) {
      const input = await readJson<ApproveValidationPresetRequest>(request);
      const task = await approveValidationPreset(approveValidationPresetTaskID, input);
      writeJson(response, 200, task);
      return;
    }

    const runValidationTaskID = taskIDFromActionPath(url.pathname, "run-validation");
    if (request.method === "POST" && runValidationTaskID) {
      const input = await readJson<RunValidationRequest>(request);
      const task = await runValidation(runValidationTaskID, "Manual", input.presetID);
      writeJson(response, 200, task);
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      openEventStream(response);
      return;
    }

    writeJson(response, 404, { error: "not_found" });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    writeJson(response, status, {
      error: "runtime_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Forge runtime listening on http://127.0.0.1:${port}`);
  console.log(`Forge task store: ${taskStore.dbPath}`);
  console.log(`Forge model provider: ${modelProvider.info.name} (${modelProvider.info.model})`);
});

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));

function resolveDatabasePath(): string {
  const configured = process.env.FORGE_RUNTIME_DB_PATH;
  if (configured) {
    return path.resolve(repoRoot, configured);
  }

  return path.join(repoRoot, ".forge", "forge.sqlite");
}

function resolveModelProviderSettingsPath(): string {
  const configured = process.env.FORGE_MODEL_PROVIDER_SETTINGS_PATH;
  if (configured) {
    return path.resolve(repoRoot, configured);
  }

  return path.join(repoRoot, ".forge", "model-provider-settings.json");
}

function loadModelProviderRuntimeSettings(): ModelProviderRuntimeSettings {
  const defaults = defaultModelProviderRuntimeSettings();
  const settingsPath = resolveModelProviderSettingsPath();

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return defaults;
    }

    console.warn(`Forge model provider settings ignored: ${error instanceof Error ? error.message : String(error)}`);
    return defaults;
  }

  if (!isRecord(parsed)) {
    console.warn("Forge model provider settings ignored: root value must be an object.");
    return defaults;
  }

  return {
    ...defaults,
    providerID: providerIDFromPersistedSetting(parsed.providerID, defaults.providerID),
    modelName: stringSettingFromUnknown(parsed.modelName) ?? defaults.modelName,
    openAIBaseURL: stringSettingFromUnknown(parsed.openAIBaseURL) ?? defaults.openAIBaseURL,
    openAITimeoutMs: positiveIntegerFromUnknown(parsed.openAITimeoutMs) ?? defaults.openAITimeoutMs,
    openAIMaxOutputTokens: positiveIntegerFromUnknown(parsed.openAIMaxOutputTokens)
      ?? defaults.openAIMaxOutputTokens,
    openAIAPIKey: defaults.openAIAPIKey
  };
}

async function updateModelProviderSettings(
  input: ModelProviderSettingsUpdateRequest
): Promise<ReturnType<typeof getModelProviderConfiguration>> {
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
  const settingsPath = resolveModelProviderSettingsPath();
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
    openAIBaseURL: settings.openAIBaseURL,
    openAITimeoutMs: settings.openAITimeoutMs,
    openAIMaxOutputTokens: settings.openAIMaxOutputTokens,
    hasOpenAIAPIKey: Boolean(settings.openAIAPIKey?.trim()),
    settingsPath: resolveModelProviderSettingsPath()
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

function listTasks(): ForgeTask[] {
  return [...tasks.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function listValidationPresets(registry: ValidationPresetRegistry): ValidationPreset[] {
  return registry.presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    source: preset.source,
    riskLevel: preset.riskLevel,
    requiresApproval: preset.requiresApproval,
    commands: preset.commands.map(stripInternalCommandFields)
  }));
}

function stripInternalCommandFields(command: InternalValidationCommand): ValidationCommandDefinition {
  return {
    id: command.id,
    name: command.name,
    command: command.command,
    kind: command.kind,
    riskLevel: command.riskLevel,
    cwd: command.cwd,
    executionMode: command.kind === "BuiltIn" ? "BuiltIn" : "SpawnNoShell",
    boundary: command.kind === "BuiltIn"
      ? "Runs inside the Forge runtime without spawning a project process."
      : `Runs with shell disabled from ${command.cwd ?? "the repository root"}.`
  };
}

async function listValidationPermissions(taskID: string): Promise<ValidationPermissionEnvelope> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const registry = await loadValidationPresetRegistry();
  return {
    taskID: task.id,
    taskStatus: task.status,
    currentPhase: task.currentPhase,
    permissions: registry.presets.map((preset) => buildValidationPermission(task, preset))
  };
}

function buildValidationPermission(
  task: ForgeTask,
  preset: InternalValidationPreset
): ValidationPresetPermission {
  const approval = findValidationPresetApproval(task, preset.id);
  const approvalState: ValidationPresetPermission["approvalState"] = !preset.requiresApproval
    ? "NotRequired"
    : approval
      ? "Approved"
      : "NeedsApproval";
  const blockedReasons: string[] = [];

  if (task.editProposal?.status !== "Applied") {
    blockedReasons.push("Validation requires an applied edit proposal.");
  }

  if (hasRunningValidationRun(task)) {
    blockedReasons.push("Another validation run is already active.");
  }

  if (preset.requiresApproval && !approval) {
    blockedReasons.push("Preset requires task-level approval before execution.");
  }

  const executionState: ValidationPresetPermission["executionState"] = hasRunningValidationRun(task)
    ? "Running"
    : task.editProposal?.status !== "Applied"
      ? "Blocked"
      : preset.requiresApproval && !approval
        ? "NeedsApproval"
        : "Ready";

  return {
    preset: {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      source: preset.source,
      riskLevel: preset.riskLevel,
      requiresApproval: preset.requiresApproval,
      commands: preset.commands.map(stripInternalCommandFields)
    },
    approvalState,
    executionState,
    canApprove: executionState === "NeedsApproval",
    canRun: executionState === "Ready",
    blockedReasons,
    approval: approval
      ? {
          id: approval.id,
          decidedAt: approval.decidedAt,
          summary: approval.summary
        }
      : undefined,
    lastRun: findLastValidationRun(task, preset.id)
  };
}

async function loadValidationPresetRegistry(): Promise<ValidationPresetRegistry> {
  const workspaceConfig = await loadWorkspaceValidationPresets();
  const usedIDs = new Set(builtInValidationPresets.map((preset) => preset.id));
  const workspacePresets: InternalValidationPreset[] = [];

  for (const preset of workspaceConfig.presets) {
    if (usedIDs.has(preset.id)) {
      workspaceConfig.status.issues.push(`Skipped duplicate preset id: ${preset.id}`);
      continue;
    }

    usedIDs.add(preset.id);
    workspacePresets.push(preset);
  }

  return {
    presets: [...builtInValidationPresets, ...workspacePresets],
    workspaceConfig: workspaceConfig.status
  };
}

async function loadWorkspaceValidationPresets(): Promise<{
  status: WorkspacePresetConfigStatus;
  presets: InternalValidationPreset[];
}> {
  const configPath = resolveWorkspaceValidationPresetConfigPath();
  const status: WorkspacePresetConfigStatus = {
    path: configPath,
    exists: false,
    issues: []
  };

  let rawConfig: string;
  try {
    rawConfig = await readFile(configPath, "utf8");
    status.exists = true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status, presets: [] };
    }

    status.issues.push(error instanceof Error ? error.message : String(error));
    return { status, presets: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch (error) {
    status.issues.push(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return { status, presets: [] };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.presets)) {
    status.issues.push("Config must be an object with a presets array.");
    return { status, presets: [] };
  }

  const presets: InternalValidationPreset[] = [];
  for (const candidate of parsed.presets) {
    const preset = parseWorkspacePreset(candidate, status.issues);
    if (preset) {
      presets.push(preset);
    }
  }

  return { status, presets };
}

function parseWorkspacePreset(
  candidate: unknown,
  issues: string[]
): InternalValidationPreset | undefined {
  if (!isRecord(candidate)) {
    issues.push("Skipped workspace preset because it is not an object.");
    return undefined;
  }

  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) {
    issues.push(`Skipped workspace preset with invalid id: ${id || "<missing>"}`);
    return undefined;
  }

  const name = typeof candidate.name === "string" && candidate.name.trim()
    ? candidate.name.trim()
    : id;
  const description = typeof candidate.description === "string"
    ? candidate.description.trim()
    : "Workspace validation preset.";
  const commandIDs = Array.isArray(candidate.commandIDs) ? candidate.commandIDs : [];
  if (commandIDs.length === 0) {
    issues.push(`Skipped workspace preset ${id}: commandIDs must be a non-empty array.`);
    return undefined;
  }

  const commands: InternalValidationCommand[] = [];
  for (const commandID of commandIDs) {
    if (typeof commandID !== "string") {
      issues.push(`Skipped non-string command id in workspace preset ${id}.`);
      continue;
    }

    const command = validationCommandCatalog.get(commandID);
    if (!command) {
      issues.push(`Skipped unknown command id in workspace preset ${id}: ${commandID}`);
      continue;
    }

    commands.push(command);
  }

  if (commands.length === 0) {
    issues.push(`Skipped workspace preset ${id}: no valid commands remained.`);
    return undefined;
  }

  const riskLevel = maxRiskLevel(commands.map((command) => command.riskLevel));
  return {
    id,
    name,
    description,
    source: "Workspace",
    riskLevel,
    requiresApproval: riskLevel !== "Low",
    commands
  };
}

function maxRiskLevel(riskLevels: Array<ValidationPreset["riskLevel"]>): ValidationPreset["riskLevel"] {
  if (riskLevels.includes("High")) {
    return "High";
  }

  if (riskLevels.includes("Medium")) {
    return "Medium";
  }

  return "Low";
}

function resolveWorkspaceValidationPresetConfigPath(): string {
  const configured = process.env.FORGE_VALIDATION_PRESET_CONFIG_PATH;
  if (configured) {
    return path.resolve(repoRoot, configured);
  }

  return path.join(repoRoot, ".forge", "validation-presets.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function saveTask(task: ForgeTask): void {
  taskStore.saveTask(task);
}

function saveAndBroadcast(task: ForgeTask, runtimeEvent: RuntimeEvent): void {
  task.events.push(runtimeEvent);
  task.updatedAt = runtimeEvent.createdAt;
  tasks.set(task.id, task);
  saveTask(task);
  emit(runtimeEvent.type, { taskID: task.id, message: runtimeEvent.message, task });
  emit("task.updated", { taskID: task.id, task });
}

function shutdown(exitCode: number): never {
  taskStore.close();
  process.exit(exitCode);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function createTask(input: CreateTaskRequest): Promise<ForgeTask> {
  const now = new Date().toISOString();
  const title = input.title?.trim() || "Untitled Forge task";
  const objective = input.objective?.trim() || "No objective provided.";
  const createdEvent: RuntimeEvent = {
    type: "task.created",
    message: "Task created and queued for planning.",
    createdAt: now
  };
  const userMessage = await createUserTaskMessage(objective, now);

  const task: ForgeTask = {
    id: randomUUID(),
    title,
    objective,
    status: "Planning",
    currentPhase: "Planning",
    createdAt: now,
    updatedAt: now,
    agentStates: cloneAgents(defaultAgents),
    planSteps: clonePlanSteps(defaultPlanSteps),
    events: [createdEvent],
    approvals: [],
    toolCalls: [],
    validationRuns: [],
    messages: [userMessage],
    planRevisions: [],
    editProposalRevisions: [],
    contextFiles: [],
    changedFiles: [],
    executionProposal: undefined,
    editProposal: undefined,
    reviewSummary: "No review yet. The planner is preparing a first plan."
  };

  if (userMessage.fileReferences.length > 0) {
    const resolvedCount = userMessage.fileReferences.filter((reference) => reference.status === "Resolved").length;
    task.events.push({
      type: "conversation.file_references.detected",
      message: `Detected ${userMessage.fileReferences.length} file reference(s), ${resolvedCount} resolved.`,
      createdAt: now
    });
  }

  const assistantMessage = await createAssistantIntentBriefMessage(task, userMessage);
  task.messages.push(assistantMessage);
  task.updatedAt = assistantMessage.createdAt;
  task.events.push({
    type: "conversation.intent_brief.created",
    message: "Initial task intent brief created from the user objective.",
    createdAt: assistantMessage.createdAt
  });
  task.reviewSummary = "Intent brief created. The planner is preparing the first implementation plan.";
  setAgent(task, "Manager", "Active", "Captured the task objective and opened a task conversation.");
  setAgent(task, "Planner", "Active", "Created an initial intent brief before planning.");
  upsertPlanStep(task, {
    id: "clarify-intent",
    title: "Clarify task intent",
    status: "Done",
    summary: assistantMessage.intentBrief?.summary ?? "Task intent captured from the initial objective."
  });

  return task;
}

async function createTaskMessage(taskID: string, input: CreateTaskMessageRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const content = input.content?.trim() ?? "";
  if (!content) {
    throw new HttpError(400, "Task message content is required.");
  }

  if (content.length > 8_000) {
    throw new HttpError(413, "Task message content is too large.");
  }

  const now = new Date().toISOString();
  const userMessage = await createUserTaskMessage(content, now);
  task.messages.push(userMessage);

  setAgent(task, "Manager", "Active", "Received a task conversation update from the user.");
  setAgent(task, "Planner", "Active", `Updating intent brief with ${modelProvider.info.name}.`);
  upsertPlanStep(task, {
    id: "clarify-intent",
    title: "Clarify task intent",
    status: "Active",
    summary: "Reading the latest task message and updating the structured brief."
  });

  const received = event("conversation.user_message.created", "User added a task conversation message.");
  received.createdAt = now;
  saveAndBroadcast(task, received);

  if (userMessage.fileReferences.length > 0) {
    const resolvedCount = userMessage.fileReferences.filter((reference) => reference.status === "Resolved").length;
    const referenced = event(
      "conversation.file_references.detected",
      `Detected ${userMessage.fileReferences.length} file reference(s), ${resolvedCount} resolved.`
    );
    referenced.createdAt = new Date().toISOString();
    saveAndBroadcast(task, referenced);
  }

  const assistantMessage = await createAssistantIntentBriefMessage(task, userMessage);
  task.messages.push(assistantMessage);
  task.reviewSummary = "Intent brief updated from the latest task conversation message.";
  setAgent(task, "Planner", "Ready", "Updated the task intent brief; waiting for the next planning or review action.");
  upsertPlanStep(task, {
    id: "clarify-intent",
    title: "Clarify task intent",
    status: "Done",
    summary: assistantMessage.intentBrief?.summary ?? "Task intent updated."
  });

  const briefCreated = event("conversation.intent_brief.created", "Assistant created an updated task intent brief.");
  briefCreated.createdAt = assistantMessage.createdAt;
  saveAndBroadcast(task, briefCreated);
  return task;
}

async function generatePlanRevision(taskID: string): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status === "Proposed" || task.editProposal?.status === "Applied") {
    throw new HttpError(409, "Resolve the current edit proposal before generating a new plan revision.");
  }

  const sourceMessage = latestTaskMessage(task, "User");
  task.status = "Planning";
  task.currentPhase = "Plan Revision";
  task.reviewSummary = "Generating a plan revision from the task conversation.";
  task.executionProposal = undefined;
  setAgent(task, "Manager", "Active", "Routing the latest task conversation into planning.");
  setAgent(task, "Planner", "Active", `Generating a plan revision with ${modelProvider.info.name}.`);
  setAgent(task, "Coder", "Idle", "Waiting for an approved revised plan.");
  setAgent(task, "Reviewer", "Idle", "Waiting for the revised plan.");
  upsertPlanStep(task, {
    id: "generate-plan-revision",
    title: "Generate plan revision",
    status: "Active",
    summary: "Using the latest task conversation and intent brief to revise the plan."
  });

  const started = event("plan.revision.started", "Generating a plan revision from the task conversation.");
  started.createdAt = new Date().toISOString();
  saveAndBroadcast(task, started);

  const revision = await modelProvider.createPlanRevision({ task, sourceMessage });
  task.planRevisions.push(revision);
  task.planSteps = revision.steps.map((step) => ({ ...step }));
  task.status = "Human Review";
  task.currentPhase = "Plan Review";
  task.reviewSummary = revision.summary;
  setAgent(task, "Manager", "Active", "Holding revised plan at the review gate.");
  setAgent(task, "Planner", "Done", "Generated a revised plan from the task conversation.");
  setAgent(task, "Reviewer", "Active", "Review the plan revision before approving execution.");

  const ready = event("plan.revision.ready", "Plan revision is ready for human review.");
  ready.createdAt = revision.generatedAt;
  saveAndBroadcast(task, ready);
  return task;
}

async function createUserTaskMessage(content: string, createdAt: string): Promise<TaskMessage> {
  return {
    id: randomUUID(),
    role: "User",
    kind: "UserMessage",
    content,
    fileReferences: await resolveTaskFileReferences(content, createdAt),
    createdAt
  };
}

async function createAssistantIntentBriefMessage(
  task: ForgeTask,
  latestUserMessage: TaskMessage
): Promise<TaskMessage> {
  const intentBrief = await modelProvider.createIntentBrief({ task, latestUserMessage });
  return {
    id: randomUUID(),
    role: "Assistant",
    kind: "IntentBrief",
    content: formatIntentBrief(intentBrief),
    createdAt: new Date().toISOString(),
    fileReferences: [],
    provider: modelProvider.info,
    intentBrief
  };
}

function formatIntentBrief(intentBrief: NonNullable<TaskMessage["intentBrief"]>): string {
  return [
    `Intent: ${intentBrief.summary}`,
    formatBriefList("Constraints", intentBrief.constraints),
    formatBriefList("Acceptance", intentBrief.acceptanceCriteria),
    formatBriefList("Open questions", intentBrief.openQuestions),
    `Next: ${intentBrief.nextAction}`
  ].filter(Boolean).join("\n");
}

function formatBriefList(title: string, values: string[]): string {
  if (values.length === 0) {
    return "";
  }

  return `${title}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

async function resolveTaskFileReferences(content: string, detectedAt: string): Promise<TaskFileReference[]> {
  const mentions = extractFileMentionCandidates(content).slice(0, 6);
  const references: TaskFileReference[] = [];

  for (const mention of mentions) {
    references.push(await resolveTaskFileReference(mention, detectedAt));
  }

  return references;
}

function extractFileMentionCandidates(content: string): string[] {
  const candidates = new Set<string>();
  const add = (raw: string | undefined) => {
    const candidate = cleanFileMention(raw ?? "");
    if (candidate && looksLikeFileMention(candidate)) {
      candidates.add(candidate);
    }
  };

  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    add(match[1]);
  }

  for (const match of content.matchAll(/(?:^|[\s(])@([A-Za-z0-9._/-]+(?::\d+(?:-\d+)?)?)/g)) {
    add(match[1]);
  }

  for (const match of content.matchAll(
    /(?:^|[\s(])((?:\.\/)?(?:README\.md|AGENTS\.md|docs\/[A-Za-z0-9._/-]+|runtime\/[A-Za-z0-9._/-]+|apps\/[A-Za-z0-9._/-]+|script\/[A-Za-z0-9._/-]+|\.forge\/[A-Za-z0-9._/-]+)(?::\d+(?:-\d+)?)?)/g
  )) {
    add(match[1]);
  }

  return [...candidates];
}

function cleanFileMention(raw: string): string {
  return raw
    .trim()
    .replace(/^@/, "")
    .replace(/^\.\/+/, "")
    .replace(/[),.;\]]+$/g, "");
}

function looksLikeFileMention(candidate: string): boolean {
  const pathOnly = candidate.replace(/:\d+(?:-\d+)?$/, "");
  return (
    pathOnly === "README.md" ||
    pathOnly === "AGENTS.md" ||
    pathOnly.includes("/") ||
    /\.[A-Za-z0-9]{1,8}$/.test(pathOnly)
  );
}

async function resolveTaskFileReference(mention: string, detectedAt: string): Promise<TaskFileReference> {
  const parsed = parseMentionPathAndLine(mention);
  const baseReference = {
    id: randomUUID(),
    requestedPath: mention,
    lineStart: parsed.lineStart,
    lineEnd: parsed.lineEnd,
    detectedAt
  };

  try {
    const { absolutePath, relativePath } = resolveReadOnlyWorkspacePath(parsed.path);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return {
        ...baseReference,
        path: relativePath,
        status: "Missing",
        summary: `Referenced path is not a file: ${relativePath}.`
      };
    }

    if (fileStat.size > 200_000) {
      return {
        ...baseReference,
        path: relativePath,
        status: "Blocked",
        byteSize: fileStat.size,
        summary: `File is too large for conversation context: ${relativePath}.`
      };
    }

    const content = await readFile(absolutePath, "utf8");
    if (content.includes("\0")) {
      return {
        ...baseReference,
        path: relativePath,
        status: "Blocked",
        byteSize: fileStat.size,
        summary: `File appears to be binary and was not added as conversation context: ${relativePath}.`
      };
    }

    const lineCount = content.split("\n").length;
    return {
      ...baseReference,
      path: relativePath,
      status: "Resolved",
      byteSize: fileStat.size,
      lineCount,
      summary: summarizeReferencedFile(relativePath, content, parsed.lineStart, parsed.lineEnd)
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        ...baseReference,
        path: parsed.path,
        status: "Missing",
        summary: `Referenced file does not exist: ${parsed.path}.`
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      ...baseReference,
      status: "Blocked",
      summary: message
    };
  }
}

function parseMentionPathAndLine(mention: string): { path: string; lineStart?: number; lineEnd?: number } {
  const match = mention.match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!match) {
    return { path: mention };
  }

  const lineStart = Number(match[2]);
  const lineEnd = match[3] ? Number(match[3]) : lineStart;
  return {
    path: match[1],
    lineStart,
    lineEnd: Math.max(lineStart, lineEnd)
  };
}

function resolveReadOnlyWorkspacePath(inputPath: string): { absolutePath: string; relativePath: string } {
  if (inputPath.includes("\0") || path.isAbsolute(inputPath)) {
    throw new HttpError(409, `Unsafe file reference path: ${inputPath}`);
  }

  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/").replace(/^\.\/+/, ""));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.startsWith(".git/") ||
    normalized.startsWith(".forge/") ||
    normalized.includes("/.git/") ||
    normalized.includes("/.forge/")
  ) {
    throw new HttpError(409, `Unsafe file reference path: ${inputPath}`);
  }

  const absolutePath = path.resolve(repoRoot, normalized);
  if (!absolutePath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new HttpError(409, `Unsafe file reference path: ${inputPath}`);
  }

  return { absolutePath, relativePath: normalized };
}

function summarizeReferencedFile(
  relativePath: string,
  content: string,
  lineStart?: number,
  lineEnd?: number
): string {
  if (relativePath.endsWith(".md")) {
    return summarizeMarkdown(content) || `${relativePath} resolved as Markdown context.`;
  }

  const lines = content.split("\n");
  const selectedLine = lineStart
    ? lines.slice(Math.max(0, lineStart - 1), Math.min(lines.length, lineEnd ?? lineStart))
    : lines;
  const firstMeaningfulLine = selectedLine
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("#!"));
  const location = lineStart ? ` lines ${lineStart}${lineEnd && lineEnd !== lineStart ? `-${lineEnd}` : ""}` : "";
  return [
    `${relativePath}${location}`,
    `${lines.length} line(s)`,
    firstMeaningfulLine
  ].filter(Boolean).join(" - ").slice(0, 220);
}

async function approvePlan(taskID: string, input: ApprovePlanRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.status !== "Human Review") {
    throw new HttpError(409, "Only tasks waiting for human review can have their plan approved.");
  }

  const now = new Date().toISOString();
  const planRevision = latestPlanRevision(task);
  if (hasPlanApproval(task, planRevision?.id)) {
    throw new HttpError(409, "The current plan is already approved.");
  }

  const approval: ApprovalRecord = {
    id: randomUUID(),
    action: "Approve Plan",
    decision: "Approved",
    summary: "Approved the current plan and opened controlled execution preparation.",
    decidedAt: now,
    targetID: planRevision?.id,
    userNote: input.note?.trim() || undefined
  };

  task.approvals.push(approval);
  task.status = "Running";
  task.currentPhase = "Execution Preparation";
  task.changedFiles = [];
  task.reviewSummary = "Plan approved. The model provider is preparing a safe execution proposal.";
  setAgent(task, "Manager", "Active", "Recorded plan approval and opened the execution phase.");
  setAgent(task, "Planner", "Done", "Plan approved by the user.");
  setAgent(task, "Coder", "Active", `Preparing an execution proposal with ${modelProvider.info.name}.`);
  setAgent(task, "Tester", "Idle", "Waiting for code changes or validation commands.");
  setAgent(task, "Reviewer", "Idle", "No diff to review yet.");
  upsertPlanStep(task, {
    id: "prepare-execution",
    title: "Prepare controlled execution",
    status: "Done",
    summary: "Plan approved and execution phase opened. No files changed in v0."
  });
  upsertPlanStep(task, {
    id: "generate-execution-proposal",
    title: "Generate execution proposal",
    status: "Active",
    summary: `Using ${modelProvider.info.name} to draft a safe next-step proposal.`
  });

  const approved = event("approval.plan.approved", "User approved the plan. Controlled execution preparation is open.");
  approved.createdAt = now;
  saveAndBroadcast(task, approved);

  const proposal = await modelProvider.createExecutionProposal({ task });
  task.executionProposal = proposal;
  task.reviewSummary = "Execution proposal generated. No files changed; the next slice will turn this into a reviewable diff.";
  setAgent(task, "Coder", "Ready", "Execution proposal generated; waiting for safe edit proposal tooling.");
  upsertPlanStep(task, {
    id: "generate-execution-proposal",
    title: "Generate execution proposal",
    status: "Done",
    summary: `Generated by ${proposal.provider.name} (${proposal.provider.model}).`
  });
  upsertPlanStep(task, {
    id: "await-safe-diff",
    title: "Await safe diff proposal",
    status: "Active",
    summary: "Next runtime slice will create a reviewable diff before any file mutation."
  });

  const proposed = event("model.execution.proposed", "Model provider generated a safe execution proposal after plan approval.");
  proposed.createdAt = proposal.generatedAt;
  saveAndBroadcast(task, proposed);
  return task;
}

async function generateEditProposal(taskID: string): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (!task.executionProposal) {
    throw new HttpError(409, "An execution proposal is required before generating edit proposals.");
  }

  if (task.editProposal?.status === "Proposed") {
    throw new HttpError(409, "This task already has a proposed edit awaiting review.");
  }

  if (task.editProposal?.status === "Applied") {
    throw new HttpError(409, "Applied edit proposals cannot be regenerated.");
  }

  if (task.editProposal?.status === "Rejected") {
    return createEditProposalForTask(task, "Revision", task.editProposal);
  }

  return createEditProposalForTask(task, "Initial");
}

async function reviseEditProposal(taskID: string): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (!task.executionProposal) {
    throw new HttpError(409, "An execution proposal is required before revising edit proposals.");
  }

  if (task.editProposal?.status !== "Rejected") {
    throw new HttpError(409, "A rejected edit proposal is required before revision.");
  }

  return createEditProposalForTask(task, "Revision", task.editProposal);
}

async function createEditProposalForTask(
  task: ForgeTask,
  mode: "Initial" | "Revision",
  previousProposal?: EditProposal
): Promise<ForgeTask> {
  const isRevision = mode === "Revision";
  const sourceMessage = latestTaskMessage(task, "User");
  const revisionNumber = previousProposal ? (previousProposal.revisionNumber ?? 1) + 1 : 1;

  task.status = "Running";
  task.currentPhase = isRevision ? "Edit Proposal Revision" : "Edit Proposal Generation";
  task.reviewSummary = isRevision
    ? "Revising the rejected edit proposal from the latest task conversation. No files will be changed."
    : "Generating a safe edit proposal. No files will be changed.";
  setAgent(
    task,
    "Coder",
    "Active",
    isRevision
      ? `Revising a safe edit proposal with ${modelProvider.info.name}.`
      : `Generating a safe edit proposal with ${modelProvider.info.name}.`
  );
  setAgent(task, "Reviewer", "Idle", "Waiting for a proposed diff to review.");
  upsertPlanStep(task, {
    id: isRevision ? "revise-edit-proposal" : "generate-safe-edit-proposal",
    title: isRevision ? "Revise edit proposal" : "Generate safe edit proposal",
    status: "Active",
    summary: isRevision
      ? "Using the latest task conversation to revise the rejected proposal without touching files."
      : "Drafting a proposed diff without touching the working tree."
  });

  const started = event(
    isRevision ? "edit.proposal.revision.started" : "edit.proposal.started",
    isRevision
      ? "Revising a rejected edit proposal without applying file changes."
      : "Generating a safe edit proposal without applying file changes."
  );
  started.createdAt = new Date().toISOString();
  saveAndBroadcast(task, started);

  const proposal = await modelProvider.createEditProposal({
    task,
    previousProposal,
    sourceMessage,
    revisionNumber
  });
  proposal.validation = await buildEditProposalValidation(proposal.fileChanges);
  if (previousProposal) {
    archiveEditProposalRevision(task, previousProposal);
  }
  task.editProposal = proposal;
  task.status = "Human Review";
  task.currentPhase = "Edit Proposal Review";
  task.changedFiles = [];
  task.reviewSummary =
    proposal.validation.status === "Ready"
      ? "Edit proposal ready and validated for review. No file changes have been applied."
      : proposal.validation.summary;
  setAgent(task, "Coder", "Done", "Prepared a proposed diff without modifying files.");
  setAgent(task, "Reviewer", "Active", "Review the proposed file changes and validation result before applying.");
  upsertPlanStep(task, {
    id: isRevision ? "revise-edit-proposal" : "generate-safe-edit-proposal",
    title: isRevision ? "Revise edit proposal" : "Generate safe edit proposal",
    status: "Done",
    summary: isRevision
      ? `Proposed revision ${proposal.revisionNumber} with ${proposal.fileChanges.length} file change(s). No files changed.`
      : `Proposed ${proposal.fileChanges.length} file change(s). No files changed.`
  });
  upsertPlanStep(task, {
    id: "validate-edit-proposal",
    title: "Validate edit proposal",
    status: proposal.validation.status === "Ready" ? "Done" : "Blocked",
    summary: proposal.validation.summary
  });
  upsertPlanStep(task, {
    id: "review-edit-proposal",
    title: "Review edit proposal",
    status: "Active",
    summary: "Human review required before applying proposed file changes."
  });

  const ready = event(
    proposal.validation.status === "Ready"
      ? isRevision ? "edit.proposal.revision.ready" : "edit.proposal.ready"
      : "edit.proposal.validation.blocked",
    proposal.validation.status === "Ready"
      ? isRevision
        ? "Revised edit proposal is validated and ready for human review. No files changed."
        : "Safe edit proposal is validated and ready for human review. No files changed."
      : proposal.validation.summary
  );
  ready.createdAt = proposal.generatedAt;
  saveAndBroadcast(task, ready);
  return task;
}

function archiveEditProposalRevision(task: ForgeTask, proposal: EditProposal): void {
  if (!task.editProposalRevisions.some((candidate) => candidate.id === proposal.id)) {
    task.editProposalRevisions.push(structuredClone(proposal));
  }
}

async function validateEditProposal(taskID: string): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status !== "Proposed") {
    throw new HttpError(409, "A proposed edit is required before validation.");
  }

  const validation = await buildEditProposalValidation(task.editProposal.fileChanges);
  task.editProposal.validation = validation;
  task.status = "Human Review";
  task.currentPhase =
    validation.status === "Ready" ? "Edit Proposal Review" : "Edit Proposal Validation Blocked";
  task.reviewSummary = validation.summary;
  setAgent(
    task,
    "Reviewer",
    validation.status === "Ready" ? "Active" : "Blocked",
    validation.status === "Ready"
      ? "Proposal validation passed; ready for human review."
      : "Proposal validation is blocked; review the failed checks."
  );
  upsertPlanStep(task, {
    id: "validate-edit-proposal",
    title: "Validate edit proposal",
    status: validation.status === "Ready" ? "Done" : "Blocked",
    summary: validation.summary
  });

  const validated = event(
    validation.status === "Ready" ? "edit.proposal.validated" : "edit.proposal.validation.blocked",
    validation.summary
  );
  validated.createdAt = validation.checkedAt;
  saveAndBroadcast(task, validated);
  return task;
}

async function applyEditProposal(
  taskID: string,
  input: EditProposalDecisionRequest
): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status !== "Proposed") {
    throw new HttpError(409, "A proposed edit is required before applying changes.");
  }

  const validation = await buildEditProposalValidation(task.editProposal.fileChanges);
  task.editProposal.validation = validation;
  if (validation.status !== "Ready") {
    task.status = "Human Review";
    task.currentPhase = "Edit Proposal Validation Blocked";
    task.reviewSummary = validation.summary;
    setAgent(task, "Coder", "Blocked", "Cannot apply until proposal validation passes.");
    setAgent(task, "Reviewer", "Blocked", "Review failed proposal validation checks.");
    upsertPlanStep(task, {
      id: "validate-edit-proposal",
      title: "Validate edit proposal",
      status: "Blocked",
      summary: validation.summary
    });

    const blocked = event("edit.proposal.validation.blocked", validation.summary);
    blocked.createdAt = validation.checkedAt;
    saveAndBroadcast(task, blocked);
    return task;
  }

  task.status = "Running";
  task.currentPhase = "Applying Edit Proposal";
  task.reviewSummary = "Applying the approved edit proposal with restricted file operations.";
  setAgent(task, "Coder", "Active", "Applying the approved restricted edit proposal.");
  setAgent(task, "Reviewer", "Active", "Watching the controlled apply step.");
  upsertPlanStep(task, {
    id: "apply-edit-proposal",
    title: "Apply edit proposal",
    status: "Active",
    summary: "Applying reviewed file changes with repo-local path checks."
  });
  upsertPlanStep(task, {
    id: "validate-edit-proposal",
    title: "Validate edit proposal",
    status: "Done",
    summary: validation.summary
  });

  const started = event("edit.proposal.apply.started", "Applying approved edit proposal.");
  started.createdAt = new Date().toISOString();
  saveAndBroadcast(task, started);

  try {
    const appliedFiles: string[] = [];
    for (const change of task.editProposal.fileChanges) {
      const appliedPath = await applyProposedFileChange(change);
      appliedFiles.push(appliedPath);
    }

    const now = new Date().toISOString();
    task.editProposal.status = "Applied";
    task.editProposal.decidedAt = now;
    task.editProposal.decisionNote = input.note?.trim() || undefined;
    task.status = "Testing";
    task.currentPhase = "Awaiting Validation";
    task.changedFiles = [...new Set(appliedFiles)];
    task.approvals.push({
      id: randomUUID(),
      action: "Apply Edit Proposal",
      decision: "Approved",
      summary: `Applied ${task.changedFiles.length} reviewed file change(s).`,
      decidedAt: now,
      userNote: input.note?.trim() || undefined
    });
    task.reviewSummary = "Approved edit proposal applied. Running controlled validation.";
    setAgent(task, "Coder", "Done", "Applied the reviewed edit proposal.");
    setAgent(task, "Tester", "Active", "Running controlled post-apply validation.");
    setAgent(task, "Reviewer", "Idle", "Waiting for validation results.");
    upsertPlanStep(task, {
      id: "review-edit-proposal",
      title: "Review edit proposal",
      status: "Done",
      summary: "Human review completed by applying the proposal."
    });
    upsertPlanStep(task, {
      id: "apply-edit-proposal",
      title: "Apply edit proposal",
      status: "Done",
      summary: `Applied ${task.changedFiles.join(", ")}.`
    });

    const applied = event("edit.proposal.applied", "Approved edit proposal was applied to the workspace.");
    applied.createdAt = now;
    saveAndBroadcast(task, applied);
    return runValidation(task.id, "PostApply");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    task.status = "Failed";
    task.currentPhase = "Apply Failed";
    task.reviewSummary = message;
    setAgent(task, "Coder", "Blocked", "Could not apply the approved edit proposal.");
    setAgent(task, "Reviewer", "Active", "Review the apply failure before retrying.");
    upsertPlanStep(task, {
      id: "apply-edit-proposal",
      title: "Apply edit proposal",
      status: "Blocked",
      summary: message
    });

    const failed = event("edit.proposal.apply.failed", message);
    failed.createdAt = new Date().toISOString();
    saveAndBroadcast(task, failed);
    throw error;
  }
}

function rejectEditProposal(taskID: string, input: EditProposalDecisionRequest): ForgeTask {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status !== "Proposed") {
    throw new HttpError(409, "A proposed edit is required before requesting changes.");
  }

  const now = new Date().toISOString();
  task.editProposal.status = "Rejected";
  task.editProposal.decidedAt = now;
  task.editProposal.decisionNote = input.note?.trim() || undefined;
  task.status = "Human Review";
  task.currentPhase = "Edit Proposal Rejected";
  task.changedFiles = [];
  task.approvals.push({
    id: randomUUID(),
    action: "Reject Edit Proposal",
    decision: "Rejected",
    summary: "Rejected the proposed edit without changing files.",
    decidedAt: now,
    userNote: input.note?.trim() || undefined
  });
  task.reviewSummary = "Edit proposal rejected. No file changes were applied; another proposal can be generated.";
  setAgent(task, "Coder", "Ready", "Waiting to generate a revised edit proposal.");
  setAgent(task, "Reviewer", "Done", "Rejected the current proposed diff.");
  upsertPlanStep(task, {
    id: "review-edit-proposal",
    title: "Review edit proposal",
    status: "Done",
    summary: "Human review rejected the proposal without applying changes."
  });
  upsertPlanStep(task, {
    id: "revise-edit-proposal",
    title: "Revise edit proposal",
    status: "Active",
    summary: "A new edit proposal can be generated after rejection."
  });

  const rejected = event("edit.proposal.rejected", "Edit proposal rejected. No files changed.");
  rejected.createdAt = now;
  saveAndBroadcast(task, rejected);
  return task;
}

async function approveValidationPreset(taskID: string, input: ApproveValidationPresetRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const preset = await findValidationPreset(input.presetID);
  if (!preset.requiresApproval) {
    throw new HttpError(409, `Validation preset does not require approval: ${preset.id}`);
  }

  if (hasValidationPresetApproval(task, preset.id)) {
    throw new HttpError(409, `Validation preset already approved: ${preset.id}`);
  }

  const now = new Date().toISOString();
  task.approvals.push({
    id: randomUUID(),
    action: "Approve Validation Preset",
    decision: "Approved",
    summary: `Approved validation preset "${preset.name}".`,
    targetID: preset.id,
    decidedAt: now,
    userNote: input.note?.trim() || undefined
  });
  task.reviewSummary = `Validation preset approved: ${preset.name}.`;
  setAgent(task, "Tester", "Ready", `Validation preset approved: ${preset.name}.`);
  upsertPlanStep(task, {
    id: `approve-validation-preset-${preset.id}`,
    title: "Approve validation preset",
    status: "Done",
    summary: `${preset.name} can now run for this task.`
  });

  const approved = event("validation.preset.approved", `Validation preset approved: ${preset.name}.`);
  approved.createdAt = now;
  saveAndBroadcast(task, approved);
  return task;
}

async function runValidation(
  taskID: string,
  trigger: ValidationRun["trigger"],
  presetID = "forge-post-apply"
): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status !== "Applied") {
    throw new HttpError(409, "Validation requires an applied edit proposal.");
  }

  if (hasRunningValidationRun(task)) {
    throw new HttpError(409, "Another validation run is already active.");
  }

  const preset = await findValidationPreset(presetID);
  if (preset.requiresApproval && !hasValidationPresetApproval(task, preset.id)) {
    throw new HttpError(409, `Validation preset requires approval before it can run: ${preset.name}`);
  }

  const startedAt = new Date().toISOString();
  const validationRun: ValidationRun = {
    id: randomUUID(),
    trigger,
    presetID: preset.id,
    presetName: preset.name,
    presetSource: preset.source,
    riskLevel: preset.riskLevel,
    status: "Running",
    summary: `${preset.name} is running.`,
    startedAt,
    commands: []
  };

  task.validationRuns.push(validationRun);
  task.status = "Testing";
  task.currentPhase = "Validation";
  task.reviewSummary = "Running controlled post-apply validation.";
  setAgent(task, "Tester", "Active", "Running controlled validation commands.");
  setAgent(task, "Reviewer", "Idle", "Waiting for validation results.");
  upsertPlanStep(task, {
    id: "run-validation",
    title: "Run validation",
    status: "Active",
    summary: `Running validation preset: ${preset.name}.`
  });

  const started = event("validation.started", `Validation started: ${preset.name}.`);
  started.createdAt = startedAt;
  saveAndBroadcast(task, started);

  for (const command of preset.commands) {
    const result = await runValidationCommand(command, task);
    validationRun.commands.push(result);
    task.updatedAt = result.endedAt ?? new Date().toISOString();
    saveTask(task);
    emit("validation.command.completed", {
      taskID: task.id,
      validationRunID: validationRun.id,
      command: result,
      task
    });
  }

  const failedCommands = validationRun.commands.filter((command) => command.status === "Failed");
  const endedAt = new Date().toISOString();
  validationRun.endedAt = endedAt;
  validationRun.status = failedCommands.length === 0 ? "Passed" : "Failed";
  validationRun.summary =
    failedCommands.length === 0
      ? `Validation passed with ${validationRun.commands.length} command(s).`
      : `Validation failed: ${failedCommands.length} of ${validationRun.commands.length} command(s) failed.`;

  task.status = validationRun.status === "Passed" ? "Completed" : "Failed";
  task.currentPhase = validationRun.status === "Passed" ? "Validation Passed" : "Validation Failed";
  task.reviewSummary = validationRun.summary;
  setAgent(
    task,
    "Tester",
    validationRun.status === "Passed" ? "Done" : "Blocked",
    validationRun.summary
  );
  setAgent(
    task,
    "Reviewer",
    validationRun.status === "Passed" ? "Active" : "Blocked",
    validationRun.status === "Passed"
      ? "Validation passed; ready to review final changed files."
      : "Validation failed; review failed commands before continuing."
  );
  upsertPlanStep(task, {
    id: "run-validation",
    title: "Run validation",
    status: validationRun.status === "Passed" ? "Done" : "Blocked",
    summary: validationRun.summary
  });

  const finished = event(
    validationRun.status === "Passed" ? "validation.passed" : "validation.failed",
    validationRun.summary
  );
  finished.createdAt = endedAt;
  saveAndBroadcast(task, finished);
  return task;
}

async function runValidationCommand(
  command: InternalValidationCommand,
  task: ForgeTask
): Promise<ValidationCommandResult> {
  const startedAt = new Date().toISOString();
  const result: ValidationCommandResult = {
    id: randomUUID(),
    name: command.name,
    command: command.command,
    kind: command.kind,
    riskLevel: command.riskLevel,
    cwd: command.cwd,
    status: "Running",
    outputSummary: "Running",
    startedAt
  };

  try {
    const output = command.kind === "BuiltIn"
      ? await runBuiltInValidationCommand(command, task)
      : await runProjectValidationCommand(command);
    result.outputSummary = output.outputSummary;
    result.exitCode = output.exitCode;
    result.status = output.exitCode === 0 ? "Passed" : "Failed";
  } catch (error) {
    result.status = "Failed";
    result.outputSummary = error instanceof Error ? error.message : String(error);
  }

  result.endedAt = new Date().toISOString();
  return result;
}

async function runBuiltInValidationCommand(
  command: InternalValidationCommand,
  task: ForgeTask
): Promise<{ outputSummary: string; exitCode?: number }> {
  if (!command.executeBuiltIn) {
    throw new Error(`Built-in validation command is missing an implementation: ${command.command}`);
  }

  return {
    outputSummary: await command.executeBuiltIn(task),
    exitCode: 0
  };
}

async function runProjectValidationCommand(
  command: InternalValidationCommand
): Promise<{ outputSummary: string; exitCode?: number }> {
  if (!command.executable || !command.args) {
    throw new Error(`Project validation command is missing executable metadata: ${command.command}`);
  }

  const cwd = resolvePresetCommandCwd(command.cwd);
  const { exitCode, output } = await runSpawnedCommand(command.executable, command.args, cwd);
  const summary = summarizeCommandOutput(command.command, exitCode, output);

  return { outputSummary: summary, exitCode };
}

function runSpawnedCommand(
  executable: string,
  args: string[],
  cwd: string
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      env: { ...process.env, CI: "1" }
    });

    let output = "";
    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 12_000) {
        output = output.slice(output.length - 12_000);
      }
    };

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${validationCommandTimeoutMs / 1000}s.`));
    }, validationCommandTimeoutMs);

    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

function summarizeCommandOutput(command: string, exitCode: number, output: string): string {
  const trimmed = output.replace(/\s+$/g, "").trim();
  const tail = trimmed.length > 1_800 ? trimmed.slice(trimmed.length - 1_800) : trimmed;
  return [`${command} exited with code ${exitCode}.`, tail].filter(Boolean).join("\n");
}

async function validateChangedFiles(task: ForgeTask): Promise<string> {
  if (task.changedFiles.length === 0) {
    throw new Error("No changed files were recorded for validation.");
  }

  const validatedFiles: string[] = [];
  for (const changedFile of task.changedFiles) {
    const { absolutePath, relativePath } = resolveMarkdownWorkspacePath(changedFile);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error(`Changed file is no longer a file: ${relativePath}`);
    }
    validatedFiles.push(relativePath);
  }

  return `Validated ${validatedFiles.length} changed file(s): ${validatedFiles.join(", ")}.`;
}

async function validateAppliedProposalRecorded(task: ForgeTask): Promise<string> {
  if (task.editProposal?.status !== "Applied") {
    throw new Error("Edit proposal is not marked Applied.");
  }

  const applyApproval = task.approvals.find((approval) => approval.action === "Apply Edit Proposal");
  if (!applyApproval) {
    throw new Error("No Apply Edit Proposal approval record exists.");
  }

  return `Applied proposal ${task.editProposal.id} is recorded with approval ${applyApproval.id}.`;
}

async function validateReadyProposalValidation(task: ForgeTask): Promise<string> {
  if (task.editProposal?.validation?.status !== "Ready") {
    throw new Error("Applied proposal does not retain a Ready validation result.");
  }

  return `Ready validation retained from ${task.editProposal.validation.checkedAt}.`;
}

async function buildEditProposalValidation(fileChanges: ProposedFileChange[]): Promise<EditProposalValidation> {
  const fileResults = await Promise.all(fileChanges.map(validateProposedFileChange));
  const blockedCount = fileResults.filter((result) => result.status === "Blocked").length;
  const status: EditProposalValidation["status"] = blockedCount > 0 ? "Blocked" : "Ready";
  const summary =
    fileChanges.length === 0
      ? "Validation blocked: proposal contains no file changes."
      : blockedCount === 0
        ? `Validation passed for ${fileResults.length} proposed file change(s).`
        : `Validation blocked ${blockedCount} of ${fileResults.length} proposed file change(s).`;

  return {
    status: fileChanges.length === 0 ? "Blocked" : status,
    summary,
    checkedAt: new Date().toISOString(),
    fileResults
  };
}

async function validateProposedFileChange(change: ProposedFileChange): Promise<FileChangeValidation> {
  const checks: string[] = [];

  try {
    if (change.changeType !== "Modify") {
      return blockedValidation(change, `Only modify changes can be applied in v0: ${change.path}`, checks);
    }
    checks.push("Change type is supported.");

    const operation = change.applyOperation;
    if (!operation) {
      return blockedValidation(change, `No apply operation was provided: ${change.path}`, checks);
    }

    const { absolutePath, relativePath } = resolveMarkdownWorkspacePath(change.path);
    checks.push("Path is inside the editable Markdown workspace boundary.");

    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return blockedValidation(change, `Can only append to existing files in v0: ${relativePath}`, checks);
    }
    checks.push("Target file exists.");

    const currentContent = await readFile(absolutePath, "utf8");

    if (operation.kind === "AppendText") {
      checks.push("Apply operation is append-text.");

      if (operation.text.length === 0) {
        return blockedValidation(change, `Append text is empty: ${change.path}`, checks);
      }

      if (operation.text.length > 10_000) {
        return blockedValidation(change, `Edit operation is too large for v0 apply: ${change.path}`, checks);
      }
      checks.push("Append text size is within the v0 limit.");

      if (currentContent.endsWith(operation.text)) {
        return blockedValidation(change, `Proposed append text is already present at the end of ${relativePath}.`, checks);
      }
      checks.push("Proposed append text is not already present at the file end.");

      return {
        id: change.id,
        path: relativePath,
        status: "Ready",
        summary: `${relativePath} is ready for the restricted append-text operation.`,
        checks
      };
    }

    if (operation.kind === "ReplaceText") {
      checks.push("Apply operation is replace-text.");

      if (operation.findText.length === 0) {
        return blockedValidation(change, `Find text is empty: ${change.path}`, checks);
      }

      if (operation.replaceWith.length === 0) {
        return blockedValidation(change, `Replacement text is empty: ${change.path}`, checks);
      }

      if (operation.findText.length > 10_000 || operation.replaceWith.length > 10_000) {
        return blockedValidation(change, `Replace operation is too large for v0 apply: ${change.path}`, checks);
      }
      checks.push("Replace text size is within the v0 limit.");

      if (operation.findText === operation.replaceWith) {
        return blockedValidation(change, `Find text and replacement text are identical: ${change.path}`, checks);
      }

      const occurrenceCount = countTextOccurrences(currentContent, operation.findText);
      if (occurrenceCount === 0) {
        return blockedValidation(change, `Find text was not found in ${relativePath}.`, checks);
      }

      if (occurrenceCount > 1) {
        return blockedValidation(
          change,
          `Find text appears ${occurrenceCount} times in ${relativePath}; exact replace requires one match.`,
          checks
        );
      }
      checks.push("Find text appears exactly once in the target file.");

      return {
        id: change.id,
        path: relativePath,
        status: "Ready",
        summary: `${relativePath} is ready for the restricted replace-text operation.`,
        checks
      };
    }

    return {
      id: change.id,
      path: relativePath,
      status: "Blocked",
      summary: `Unsupported apply operation for ${relativePath}.`,
      checks
    };
  } catch (error) {
    return blockedValidation(change, error instanceof Error ? error.message : String(error), checks);
  }
}

function blockedValidation(
  change: ProposedFileChange,
  summary: string,
  checks: string[]
): FileChangeValidation {
  return {
    id: change.id,
    path: change.path,
    status: "Blocked",
    summary,
    checks
  };
}

async function findValidationPreset(presetID: string): Promise<InternalValidationPreset> {
  const registry = await loadValidationPresetRegistry();
  const preset = registry.presets.find((candidate) => candidate.id === presetID);
  if (!preset) {
    throw new HttpError(404, `Validation preset not found: ${presetID}`);
  }

  return preset;
}

function latestTaskMessage(task: ForgeTask, role?: TaskMessage["role"]): TaskMessage | undefined {
  return [...task.messages].reverse().find((message) => !role || message.role === role);
}

function latestPlanRevision(task: ForgeTask): PlanRevision | undefined {
  return task.planRevisions.at(-1);
}

function hasPlanApproval(task: ForgeTask, planRevisionID: string | undefined): boolean {
  return task.approvals.some(
    (approval) =>
      approval.action === "Approve Plan" &&
      approval.decision === "Approved" &&
      approval.targetID === planRevisionID
  );
}

function hasValidationPresetApproval(task: ForgeTask, presetID: string): boolean {
  return findValidationPresetApproval(task, presetID) !== undefined;
}

function findValidationPresetApproval(task: ForgeTask, presetID: string): ApprovalRecord | undefined {
  return task.approvals.find(
    (approval) =>
      approval.action === "Approve Validation Preset" &&
      approval.decision === "Approved" &&
      approval.targetID === presetID
  );
}

function hasRunningValidationRun(task: ForgeTask): boolean {
  return task.validationRuns.some((run) => run.status === "Running");
}

function findLastValidationRun(task: ForgeTask, presetID: string): ValidationPermissionLastRun | undefined {
  const run = [...task.validationRuns].reverse().find((candidate) => candidate.presetID === presetID);
  if (!run) {
    return undefined;
  }

  return {
    id: run.id,
    status: run.status,
    summary: run.summary,
    startedAt: run.startedAt,
    endedAt: run.endedAt
  };
}

async function applyProposedFileChange(change: ProposedFileChange): Promise<string> {
  if (change.changeType !== "Modify") {
    throw new HttpError(409, `Only modify changes can be applied in v0: ${change.path}`);
  }

  const operation = change.applyOperation;
  if (!operation) {
    throw new HttpError(409, `No apply operation was provided: ${change.path}`);
  }

  const { absolutePath, relativePath } = resolveMarkdownWorkspacePath(change.path);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new HttpError(409, `Can only append to existing files in v0: ${relativePath}`);
  }

  const currentContent = await readFile(absolutePath, "utf8");

  if (operation.kind === "AppendText") {
    if (operation.text.length === 0) {
      throw new HttpError(409, `Append text is empty: ${relativePath}`);
    }

    if (operation.text.length > 10_000) {
      throw new HttpError(409, `Edit operation is too large for v0 apply: ${relativePath}`);
    }

    if (currentContent.endsWith(operation.text)) {
      throw new HttpError(409, `Proposed append text is already present at the end of ${relativePath}.`);
    }

    await appendFile(absolutePath, operation.text, "utf8");
    return relativePath;
  }

  if (operation.kind === "ReplaceText") {
    if (operation.findText.length === 0 || operation.replaceWith.length === 0) {
      throw new HttpError(409, `Replace operation requires non-empty find and replacement text: ${relativePath}`);
    }

    if (operation.findText.length > 10_000 || operation.replaceWith.length > 10_000) {
      throw new HttpError(409, `Replace operation is too large for v0 apply: ${relativePath}`);
    }

    if (operation.findText === operation.replaceWith) {
      throw new HttpError(409, `Find text and replacement text are identical: ${relativePath}`);
    }

    const occurrenceCount = countTextOccurrences(currentContent, operation.findText);
    if (occurrenceCount !== 1) {
      throw new HttpError(
        409,
        `Replace operation requires exactly one match in ${relativePath}; found ${occurrenceCount}.`
      );
    }

    await writeFile(absolutePath, currentContent.replace(operation.findText, operation.replaceWith), "utf8");
    return relativePath;
  }

  throw new HttpError(409, `Unsupported apply operation for ${relativePath}.`);
}

function countTextOccurrences(content: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(needle, offset);
    if (index === -1) {
      return count;
    }

    count += 1;
    offset = index + needle.length;
  }
}

function resolveMarkdownWorkspacePath(inputPath: string): { absolutePath: string; relativePath: string } {
  if (inputPath.includes("\0") || path.isAbsolute(inputPath)) {
    throw new HttpError(409, `Unsafe edit path: ${inputPath}`);
  }

  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.startsWith(".git/") ||
    normalized.startsWith(".forge/")
  ) {
    throw new HttpError(409, `Unsafe edit path: ${inputPath}`);
  }

  if (normalized !== "README.md" && !normalized.startsWith("docs/")) {
    throw new HttpError(409, `Only README.md and docs/*.md paths can be edited in v0: ${inputPath}`);
  }

  if (!normalized.endsWith(".md")) {
    throw new HttpError(409, `Only Markdown files can be edited in v0: ${inputPath}`);
  }

  const absolutePath = path.resolve(repoRoot, normalized);
  if (!absolutePath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new HttpError(409, `Unsafe edit path: ${inputPath}`);
  }

  return { absolutePath, relativePath: normalized };
}

function resolvePresetCommandCwd(inputPath: string | undefined): string {
  if (!inputPath) {
    return repoRoot;
  }

  if (inputPath.includes("\0") || path.isAbsolute(inputPath)) {
    throw new Error(`Unsafe validation command cwd: ${inputPath ?? ""}`);
  }

  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.startsWith(".git/") ||
    normalized.startsWith(".forge/")
  ) {
    throw new Error(`Unsafe validation command cwd: ${inputPath}`);
  }

  const absolutePath = path.resolve(repoRoot, normalized);
  if (!absolutePath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(`Unsafe validation command cwd: ${inputPath}`);
  }

  return absolutePath;
}

function runAgentLoopV0(taskID: string): void {
  const updates: Array<[number, (task: ForgeTask) => Promise<RuntimeEvent> | RuntimeEvent]> = [
    [
      500,
      (task) => {
        setAgent(task, "Manager", "Active", "Accepted task and started the planner handoff.");
        setAgent(task, "Planner", "Active", "Reading objective and preparing context requests.");
        setPlanStep(task, "understand-objective", "Done", "Objective captured and converted into a task frame.");
        setPlanStep(task, "build-context", "Active", "Looking for useful project memory and repo context.");
        task.status = "Planning";
        task.currentPhase = "Context Building";
        return event("agent.manager.started", "Manager accepted the task and activated Planner.");
      }
    ],
    [
      1300,
      async (task) => {
        setAgent(task, "Planner", "Active", "Scanning local repository context from the task intent.");
        const projectFiles = await runTool(
          task,
          "list_repo_files",
          "Bounded repo scan excluding private and generated directories",
          listRepositoryFiles
        );
        const searchTerms = deriveRepositorySearchTerms(task);
        const contextMatches = await runTool(
          task,
          "search_repo_context",
          searchTerms.join(", "),
          () => searchRepositoryContext(projectFiles, searchTerms, explicitContextPathsForTask(task))
        );
        const contextFiles = await buildContextFiles(task, projectFiles, contextMatches);
        task.contextFiles = contextFiles;
        setAgent(
          task,
          "Planner",
          "Active",
          `Read ${contextFiles.length} context file(s) selected from ${projectFiles.length} repo file(s).`
        );
        setPlanStep(
          task,
          "build-context",
          "Done",
          `Searched for ${searchTerms.join(", ")} and inspected ${formatPathList(contextFiles.map((file) => file.path))}.`
        );
        setPlanStep(task, "draft-plan", "Active", "Drafting the safest next implementation slice.");
        return event(
          "tool.context.completed",
          `Planner searched repo context and inspected ${contextFiles.length} local context file(s).`
        );
      }
    ],
    [
      2300,
      (task) => {
        setAgent(task, "Planner", "Done", "Prepared a reviewable implementation plan.");
        setAgent(task, "Coder", "Ready", "Waiting for human approval before file changes.");
        setAgent(task, "Reviewer", "Ready", "Ready to review plan risk before execution.");
        setPlanStep(task, "draft-plan", "Done", "Plan prepared from real local project docs: add context, propose changes, wait for review, then execute.");
        setPlanStep(task, "request-review", "Active", "Human approval required before code changes.");
        task.status = "Human Review";
        task.currentPhase = "Plan Review";
        task.reviewSummary = "Agent Loop v0 read local project context and prepared a plan. It stopped before modifying files.";
        return event("plan.ready", "Planner prepared a plan and is waiting for human review.");
      }
    ],
    [
      3200,
      (task) => {
        setAgent(task, "Manager", "Active", "Holding at review gate.");
        setAgent(task, "Reviewer", "Active", "Summarizing plan risk and next approval.");
        setPlanStep(task, "request-review", "Done", "Plan is ready for review. No files changed.");
        task.changedFiles = [];
        task.reviewSummary = "Ready for approval: no files changed yet; next step would allow Coder to execute the plan.";
        return event("review.required", "Human review gate reached. No code changes have been applied.");
      }
    ]
  ];

  for (const [delay, update] of updates) {
    setTimeout(() => {
      const task = tasks.get(taskID);
      if (!task) {
        return;
      }

      if (!shouldContinueAgentLoopV0(task)) {
        return;
      }

      void Promise.resolve(update(task))
        .then((stamped) => {
          stamped.createdAt = new Date().toISOString();
          task.events.push(stamped);
          task.updatedAt = stamped.createdAt;
          tasks.set(taskID, task);
          saveTask(task);
          emit(stamped.type, { taskID, message: stamped.message, task });
          emit("task.updated", { taskID, task });
        })
        .catch((error) => {
          const failed = event("tool.failed", error instanceof Error ? error.message : String(error));
          failed.createdAt = new Date().toISOString();
          task.events.push(failed);
          task.updatedAt = failed.createdAt;
          setAgent(task, "Planner", "Blocked", "A local read-only tool failed.");
          setPlanStep(task, "build-context", "Blocked", failed.message);
          tasks.set(taskID, task);
          saveTask(task);
          emit(failed.type, { taskID, message: failed.message, task });
          emit("task.updated", { taskID, task });
        });
    }, delay);
  }
}

function shouldContinueAgentLoopV0(task: ForgeTask): boolean {
  const planApproved = task.approvals.some((approval) => approval.action === "Approve Plan");
  return (
    task.planRevisions.length === 0 &&
    !planApproved &&
    !task.executionProposal &&
    !task.editProposal
  );
}

async function listRepositoryFiles(): Promise<string[]> {
  const files: string[] = [];

  async function walk(relativeDirectory: string): Promise<void> {
    if (files.length >= repositoryScanMaxFiles) {
      return;
    }

    const absoluteDirectory = path.join(repoRoot, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= repositoryScanMaxFiles) {
        return;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        if (!shouldSkipRepositoryDirectory(entry.name, relativePath)) {
          await walk(relativePath);
        }
        continue;
      }

      if (!entry.isFile() || shouldSkipRepositoryFile(entry.name, relativePath)) {
        continue;
      }

      const absolutePath = path.join(repoRoot, relativePath);
      const fileStat = await stat(absolutePath);
      if (fileStat.size > repositoryContextMaxFileBytes) {
        continue;
      }

      files.push(relativePath);
    }
  }

  await walk("");
  return files.sort();
}

function shouldSkipRepositoryDirectory(name: string, relativePath: string): boolean {
  if (repositoryIgnoredDirectories.has(name) || name.endsWith(".xcodeproj")) {
    return true;
  }

  return relativePath.split("/").some((part) => repositoryIgnoredDirectories.has(part));
}

function shouldSkipRepositoryFile(name: string, relativePath: string): boolean {
  if (repositoryIgnoredFileNames.has(name) || name.endsWith(".sqlite") || name.endsWith(".sqlite-shm") || name.endsWith(".sqlite-wal")) {
    return true;
  }

  if (relativePath.includes("/.git/") || relativePath.includes("/.forge/")) {
    return true;
  }

  if (repositoryImportantFiles.includes(relativePath)) {
    return false;
  }

  return !repositoryContextExtensions.has(path.extname(name));
}

async function searchRepositoryContext(
  files: string[],
  searchTerms: string[],
  explicitPaths: string[]
): Promise<RepositorySearchMatch[]> {
  const explicitPathSet = new Set(explicitPaths);
  const matches: RepositorySearchMatch[] = [];

  for (const file of files.slice(0, repositorySearchMaxFiles)) {
    const match = await scoreRepositoryFile(file, searchTerms, explicitPathSet);
    if (match && match.score > 0) {
      matches.push(match);
    }
  }

  return matches
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 12);
}

async function scoreRepositoryFile(
  relativePath: string,
  searchTerms: string[],
  explicitPaths: Set<string>
): Promise<RepositorySearchMatch | undefined> {
  const reasons: string[] = [];
  let score = 0;

  if (explicitPaths.has(relativePath)) {
    score += 100;
    reasons.push("explicitly referenced by task conversation");
  }

  if (repositoryImportantFiles.includes(relativePath)) {
    score += 5;
    reasons.push("important project file");
  }

  const { absolutePath } = resolveReadOnlyWorkspacePath(relativePath);
  const content = await readFile(absolutePath, "utf8");
  if (content.includes("\0")) {
    return undefined;
  }

  const lowerPath = relativePath.toLowerCase();
  const lowerContent = content.toLowerCase();
  for (const term of searchTerms) {
    const lowerTerm = term.toLowerCase();
    if (lowerPath.includes(lowerTerm)) {
      score += 12;
      reasons.push(`path matches "${term}"`);
    }

    const hitCount = countOccurrences(lowerContent, lowerTerm, 6);
    if (hitCount > 0) {
      score += Math.min(24, hitCount * 4);
      reasons.push(`content matches "${term}" ${hitCount} time(s)`);
    }
  }

  if (score === 0) {
    return undefined;
  }

  return {
    path: relativePath,
    score,
    reasons: reasons.slice(0, 4),
    matchedLines: matchedLinesForTerms(content, searchTerms).slice(0, 3)
  };
}

function countOccurrences(content: string, term: string, maxCount: number): number {
  if (!term) {
    return 0;
  }

  let count = 0;
  let index = content.indexOf(term);
  while (index >= 0 && count < maxCount) {
    count += 1;
    index = content.indexOf(term, index + term.length);
  }

  return count;
}

function matchedLinesForTerms(content: string, searchTerms: string[]): string[] {
  const lines = content.split("\n");
  const matches: string[] = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const lowerLine = trimmed.toLowerCase();
    if (searchTerms.some((term) => lowerLine.includes(term.toLowerCase()))) {
      matches.push(`${index + 1}: ${trimmed.replace(/\s+/g, " ").slice(0, 160)}`);
    }

    if (matches.length >= 4) {
      break;
    }
  }

  return matches;
}

async function buildContextFiles(
  task: ForgeTask,
  files: string[],
  matches: RepositorySearchMatch[]
): Promise<ContextFile[]> {
  const selected = selectRepositoryContextPaths(task, files, matches);
  const contextFiles: ContextFile[] = [];

  for (const file of selected) {
    const content = await runTool(task, "read_context_file", file, () => runReadOnlyFileTool(file));
    const match = matches.find((candidate) => candidate.path === file);
    contextFiles.push({
      path: file,
      summary: summarizeContextFile(file, content, match)
    });
  }

  return contextFiles;
}

function selectRepositoryContextPaths(
  task: ForgeTask,
  files: string[],
  matches: RepositorySearchMatch[]
): string[] {
  const selected: string[] = [];
  const fileSet = new Set(files);
  const add = (candidate: string | undefined) => {
    if (!candidate || selected.includes(candidate)) {
      return;
    }

    if (fileSet.has(candidate) || explicitContextPathsForTask(task).includes(candidate)) {
      selected.push(candidate);
    }
  };

  for (const explicitPath of explicitContextPathsForTask(task)) {
    add(explicitPath);
  }

  for (const match of matches) {
    add(match.path);
  }

  for (const importantPath of repositoryImportantFiles) {
    add(importantPath);
  }

  return selected.slice(0, repositoryContextMaxFiles);
}

function explicitContextPathsForTask(task: ForgeTask): string[] {
  return [
    ...new Set(
      task.messages
        .flatMap((message) => message.fileReferences)
        .filter((reference) => reference.status === "Resolved" && reference.path)
        .map((reference) => reference.path as string)
    )
  ];
}

function deriveRepositorySearchTerms(task: ForgeTask): string[] {
  const source = [
    task.title,
    task.objective,
    ...task.messages.slice(-6).map((message) => message.content),
    ...task.contextFiles.map((file) => `${file.path} ${file.summary}`)
  ].join(" ");
  const lowerSource = source.toLowerCase();
  const terms = new Set<string>();

  for (const match of lowerSource.matchAll(/[a-z][a-z0-9_-]{2,}/g)) {
    const term = match[0].replaceAll("_", "-");
    if (!repositorySearchStopWords.has(term)) {
      terms.add(term);
    }
  }

  for (const [needle, mappedTerms] of chineseIntentSearchTerms) {
    if (source.includes(needle)) {
      for (const mappedTerm of mappedTerms) {
        terms.add(mappedTerm);
      }
    }
  }

  for (const explicitPath of explicitContextPathsForTask(task)) {
    for (const part of explicitPath.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 3 && !repositorySearchStopWords.has(part)) {
        terms.add(part);
      }
    }
  }

  if (terms.size === 0) {
    for (const fallbackTerm of ["agent", "runtime", "context", "review"]) {
      terms.add(fallbackTerm);
    }
  }

  return [...terms].slice(0, 10);
}

async function runReadOnlyFileTool(relativePath: string): Promise<string> {
  const { absolutePath } = resolveReadOnlyWorkspacePath(relativePath);

  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }

  return readFile(absolutePath, "utf8");
}

function summarizeContextFile(
  relativePath: string,
  content: string,
  match?: RepositorySearchMatch
): string {
  const baseSummary = relativePath.endsWith(".md")
    ? summarizeMarkdown(content)
    : summarizeSourceFile(relativePath, content);
  const matchSummary = match
    ? [
        `Score ${match.score}`,
        match.reasons.length > 0 ? match.reasons.join("; ") : undefined,
        match.matchedLines.length > 0 ? `Snippets: ${match.matchedLines.join(" | ")}` : undefined
      ].filter(Boolean).join(". ")
    : "";

  return [baseSummary, matchSummary].filter(Boolean).join(" ").slice(0, 360);
}

function summarizeSourceFile(relativePath: string, content: string): string {
  const lines = content.split("\n");
  const firstMeaningfulLine = lines
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("#!"));
  return [
    relativePath,
    `${lines.length} line(s)`,
    firstMeaningfulLine
  ].filter(Boolean).join(" - ").slice(0, 220);
}

function summarizeMarkdown(content: string): string {
  const heading = content
    .split("\n")
    .find((line) => line.startsWith("# "))
    ?.replace(/^#\s+/, "")
    .trim();
  const firstParagraph = content
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find((part) => part.length > 30 && !part.startsWith("#"));
  return [heading, firstParagraph].filter(Boolean).join(" - ").slice(0, 220);
}

function formatPathList(paths: string[]): string {
  if (paths.length === 0) {
    return "no files";
  }

  return paths.slice(0, 6).join(", ");
}

async function runTool<T>(
  task: ForgeTask,
  name: string,
  input: string,
  execute: () => Promise<T>
): Promise<T> {
  const startedAt = new Date().toISOString();
  const toolCall: ToolCall = {
    id: randomUUID(),
    name,
    status: "Started",
    input,
    outputSummary: "Running",
    startedAt
  };
  task.toolCalls.push(toolCall);
  task.updatedAt = startedAt;
  saveTask(task);
  emit("tool.started", { taskID: task.id, toolCall });

  try {
    const output = await execute();
    toolCall.status = "Completed";
    toolCall.endedAt = new Date().toISOString();
    toolCall.outputSummary = summarizeToolOutput(output);
    task.updatedAt = toolCall.endedAt;
    saveTask(task);
    emit("tool.completed", { taskID: task.id, toolCall });
    return output;
  } catch (error) {
    toolCall.status = "Failed";
    toolCall.endedAt = new Date().toISOString();
    toolCall.outputSummary = error instanceof Error ? error.message : String(error);
    task.updatedAt = toolCall.endedAt;
    saveTask(task);
    emit("tool.failed", { taskID: task.id, toolCall });
    throw error;
  }
}

function summarizeToolOutput(output: unknown): string {
  if (Array.isArray(output)) {
    const preview = output
      .slice(0, 4)
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (isRecord(item) && typeof item.path === "string") {
          return typeof item.score === "number" ? `${item.path} (${item.score})` : item.path;
        }

        return JSON.stringify(item);
      })
      .join(", ");
    return `${output.length} result(s): ${preview}`;
  }

  if (typeof output === "string") {
    return `${output.length} characters read`;
  }

  return "Completed";
}

function event(type: string, message: string): RuntimeEvent {
  return { type, message, createdAt: "" };
}

function cloneAgents(agents: AgentState[]): AgentState[] {
  return agents.map((agent) => ({ ...agent }));
}

function clonePlanSteps(steps: PlanStep[]): PlanStep[] {
  return steps.map((step) => ({ ...step }));
}

function setAgent(
  task: ForgeTask,
  role: AgentState["role"],
  status: AgentState["status"],
  summary: string
): void {
  task.agentStates = task.agentStates.map((agent) =>
    agent.role === role ? { ...agent, status, summary } : agent
  );
}

function setPlanStep(
  task: ForgeTask,
  id: string,
  status: PlanStep["status"],
  summary: string
): void {
  task.planSteps = task.planSteps.map((step) =>
    step.id === id ? { ...step, status, summary } : step
  );
}

function upsertPlanStep(task: ForgeTask, planStep: PlanStep): void {
  const index = task.planSteps.findIndex((step) => step.id === planStep.id);
  if (index >= 0) {
    task.planSteps[index] = planStep;
  } else {
    task.planSteps.push(planStep);
  }
}

function taskIDFromActionPath(pathname: string, action: string): string | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "tasks" && parts[2] === action) {
    return parts[1];
  }

  return undefined;
}

function openEventStream(response: ServerResponse): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  response.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  eventClients.add(response);

  response.on("close", () => {
    eventClients.delete(response);
  });
}

function emit(type: string, data: Record<string, unknown>): void {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of eventClients) {
    client.write(payload);
  }
}

function applyCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

function writeHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  response.end(body);
}

function renderRuntimeHome(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Forge Runtime</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f5f2;
      color: #171717;
    }
    main {
      max-width: 760px;
      margin: 72px auto;
      padding: 0 28px;
    }
    h1 {
      font-size: 34px;
      margin-bottom: 8px;
      letter-spacing: 0;
    }
    p {
      color: #555;
      line-height: 1.6;
    }
    code {
      background: #e9e6df;
      border-radius: 6px;
      padding: 2px 6px;
    }
    ul {
      margin-top: 24px;
      padding-left: 20px;
      line-height: 1.8;
    }
    a {
      color: #1756a9;
    }
  </style>
</head>
<body>
  <main>
    <h1>Forge Runtime is running</h1>
    <p>This local service powers the Forge macOS app. The full product UI runs through <code>swift run ForgeApp</code>.</p>
    <ul>
      <li><a href="/health">GET /health</a></li>
      <li><a href="/tasks">GET /tasks</a></li>
      <li><a href="/validation-presets">GET /validation-presets</a></li>
      <li><a href="/settings/model-provider">GET /settings/model-provider</a></li>
      <li><code>POST /settings/model-provider</code></li>
      <li><code>POST /tasks</code></li>
      <li><code>POST /tasks/:taskID/messages</code></li>
      <li><code>POST /tasks/:taskID/generate-plan-revision</code></li>
      <li><code>POST /tasks/:taskID/approve-plan</code></li>
      <li><code>POST /tasks/:taskID/generate-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/revise-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/validate-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/apply-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/reject-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/approve-validation-preset</code></li>
      <li><code>POST /tasks/:taskID/run-validation</code></li>
      <li><code>GET /events</code></li>
    </ul>
  </main>
</body>
</html>`;
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
