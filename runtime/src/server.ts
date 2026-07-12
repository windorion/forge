import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import {
  createModelProvider,
  defaultModelProviderRuntimeSettings,
  getModelProviderConfiguration,
  type PlanContextRequestResult
} from "./modelProvider.js";
import { SqliteTaskStore } from "./taskStore.js";
import type {
  AgentState,
  AppliedFileChange,
  ApprovalRecord,
  ApprovePlanRequest,
  ApproveValidationPresetRequest,
  CancelTaskCommandRequest,
  ContextFile,
  CreateTaskMessageRequest,
  CreateTaskRequest,
  EditProposal,
  EditProposalDecisionRequest,
  EditProposalValidation,
  FileChangeValidation,
  ForgeTask,
  GitBranchPublishPreview,
  GitBranchPublishRequest,
  GitBranchPublishResult,
  GitBranchPreview,
  GitBranchRequest,
  GitBranchResult,
  GitCreateCommitRequest,
  GitCreateCommitResult,
  GitCommitPreview,
  GitCommitToPush,
  GitFileChange,
  GitFileDiff,
  GitPullRequestPreview,
  GitPushPreview,
  GitPushRequest,
  GitPushResult,
  GitStatusSnapshot,
  ModelProviderRuntimeSettings,
  ModelProviderSettingsUpdateRequest,
  PlanRevision,
  PlanStep,
  ProposedFileChange,
  RuntimeEvent,
  RunTaskCommandRequest,
  RunValidationRequest,
  TaskCommandOutputChunk,
  TaskCommandPermission,
  TaskCommandRun,
  TaskFileReference,
  TaskMessage,
  ToolCall,
  ValidationCommandDefinition,
  ValidationCommandResult,
  ValidationPermissionEnvelope,
  ValidationPermissionLastRun,
  ValidationPresetPermission,
  ValidationPreset,
  ValidationRepairBrief,
  ValidationRun
} from "./types.js";

const startedAt = Date.now();
const port = Number(process.env.FORGE_RUNTIME_PORT ?? 17373);
const eventClients = new Set<ServerResponse>();
const runtimeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolveRepoRoot(runtimeDir);
const repoRootSource = process.env.FORGE_REPO_ROOT?.trim() ? "FORGE_REPO_ROOT" : "runtime parent";
const rollbackSnapshotRoot = path.join(repoRoot, ".forge", "rollback-snapshots");
const taskStore = new SqliteTaskStore(resolveDatabasePath());
const tasks = new Map<string, ForgeTask>(taskStore.loadTasks().map((task) => [task.id, task]));
const activeTaskCommands = new Map<string, ActiveTaskCommand>();
let modelProviderSettings = loadModelProviderRuntimeSettings();
let modelProvider = createModelProvider(modelProviderSettings);
const validationCommandTimeoutMs = 60_000;
const taskCommandCancellationGraceMs = 3_000;
const taskCommandOutputChunkLimit = 80;
const taskCommandOutputTextLimit = 24_000;
const taskCommandChunkTextLimit = 4_000;
const repositoryScanMaxFiles = 400;
const repositorySearchMaxFiles = 240;
const repositoryContextMaxFiles = 6;
const modelGuidedContextMaxRounds = 3;
const modelGuidedContextMaxStoredFiles = 8;
const editProposalRepairMaxAttempts = 2;
const repositoryContextMaxFileBytes = 220_000;
const editProposalTextOperationMaxChars = 10_000;
const editProposalPatchMaxHunks = 8;
const editProposalPatchMaxTotalChars = 40_000;
const editProposalCreateFileMaxChars = 20_000;
const editProposalEditableFileMaxBytes = 220_000;
const gitDiffMaxBytes = 48_000;
const gitDiffAppPreviewLineLimit = 260;
const enableSmokeCommands = process.env.FORGE_ENABLE_SMOKE_COMMANDS === "1";
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
const editProposalBlockedFileNames = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Package.resolved"
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
const editProposalEditableExtensions = new Set([
  ...repositoryContextExtensions,
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".cts",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".kt",
  ".kts",
  ".m",
  ".mjs",
  ".mm",
  ".mts",
  ".py",
  ".rb",
  ".rs"
]);
const editProposalEditableFileNames = new Set([
  "Dockerfile",
  "Makefile",
  "Package.swift",
  "Podfile",
  "Rakefile"
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

interface ActiveTaskCommand {
  taskID: string;
  taskCommandRunID: string;
  child: ReturnType<typeof spawn>;
  timeout?: ReturnType<typeof setTimeout>;
  cancelTimeout?: ReturnType<typeof setTimeout>;
  cancelled: boolean;
  cancellationNote?: string;
  cancelledAt?: string;
}

interface TaskCommandExecutionResult {
  outputSummary: string;
  exitCode: number;
  cancelled?: boolean;
}

interface SpawnedTaskCommandResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
}

type GitDiffBuildResult = {
  text: string;
  displayMode: NonNullable<GitFileDiff["displayMode"]>;
  unavailableReason?: GitFileDiff["unavailableReason"];
  byteCount?: number;
  lineCount?: number;
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

const smokeTaskValidationCommands: InternalValidationCommand[] = enableSmokeCommands
  ? [
      {
        id: "smoke-long-task-command",
        name: "Smoke long task command",
        command: "node -e \"setTimeout(() => console.log('forge smoke long command done'), 5000)\"",
        kind: "ProjectCommand",
        riskLevel: "Medium",
        cwd: "runtime",
        executable: "node",
        args: ["-e", "setTimeout(() => console.log('forge smoke long command done'), 5000)"]
      }
    ]
  : [];

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
  },
  ...smokeTaskValidationCommands
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
  },
  ...(enableSmokeCommands
    ? [
        {
          id: "smoke-task-commands",
          name: "Smoke Task Commands",
          description: "Test-only long-running task command used by runtime smoke coverage.",
          source: "BuiltIn" as const,
          riskLevel: "Medium" as const,
          requiresApproval: true,
          commands: smokeTaskValidationCommands
        }
      ]
    : [])
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
        workspace: {
          runtimeDir,
          repoRoot,
          repoRootSource
        },
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

    if (request.method === "GET" && url.pathname === "/git/status") {
      writeJson(response, 200, await getGitStatusSnapshot());
      return;
    }

    if (request.method === "GET" && url.pathname === "/git/diff") {
      writeJson(response, 200, await getGitFileDiff(url.searchParams.get("path")));
      return;
    }

    if (request.method === "GET" && url.pathname === "/git/commit-preview") {
      writeJson(response, 200, await getGitCommitPreview(url.searchParams.get("taskID")));
      return;
    }

    if (request.method === "GET" && url.pathname === "/git/branch-preview") {
      writeJson(response, 200, await getGitBranchPreview(
        url.searchParams.get("taskID"),
        url.searchParams.get("targetBranch")
      ));
      return;
    }

    if (request.method === "POST" && url.pathname === "/git/branch") {
      const input = await readJson<GitBranchRequest>(request);
      writeJson(response, 200, await createOrSwitchGitBranch(input));
      return;
    }

    if (request.method === "GET" && url.pathname === "/git/branch-publish-preview") {
      writeJson(response, 200, await getGitBranchPublishPreview(
        url.searchParams.get("taskID"),
        url.searchParams.get("remote"),
        url.searchParams.get("remoteBranch")
      ));
      return;
    }

    if (request.method === "POST" && url.pathname === "/git/branch-publish") {
      const input = await readJson<GitBranchPublishRequest>(request);
      writeJson(response, 200, await publishGitBranch(input));
      return;
    }

    if (request.method === "POST" && url.pathname === "/git/commit") {
      const input = await readJson<GitCreateCommitRequest>(request);
      writeJson(response, 201, await createGitCommit(input));
      return;
    }

    if (request.method === "GET" && url.pathname === "/git/push-preview") {
      writeJson(response, 200, await getGitPushPreview(url.searchParams.get("taskID")));
      return;
    }

    if (request.method === "POST" && url.pathname === "/git/push") {
      const input = await readJson<GitPushRequest>(request);
      writeJson(response, 200, await pushGitBranch(input));
      return;
    }

    if (request.method === "GET" && url.pathname === "/git/pr-preview") {
      writeJson(response, 200, await getGitPullRequestPreview(url.searchParams.get("taskID")));
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

    const generateValidationRepairProposalTaskID = taskIDFromActionPath(url.pathname, "generate-validation-repair-proposal");
    if (request.method === "POST" && generateValidationRepairProposalTaskID) {
      const task = await generateValidationRepairProposal(generateValidationRepairProposalTaskID);
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

    const rollbackEditProposalTaskID = taskIDFromActionPath(url.pathname, "rollback-edit-proposal");
    if (request.method === "POST" && rollbackEditProposalTaskID) {
      const input = await readJson<EditProposalDecisionRequest>(request);
      const task = await rollbackEditProposal(rollbackEditProposalTaskID, input);
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

    const runTaskCommandTaskID = taskIDFromActionPath(url.pathname, "run-task-command");
    if (request.method === "POST" && runTaskCommandTaskID) {
      const input = await readJson<RunTaskCommandRequest>(request);
      const task = await runTaskCommand(runTaskCommandTaskID, input);
      writeJson(response, 200, task);
      return;
    }

    const cancelTaskCommandTaskID = taskIDFromActionPath(url.pathname, "cancel-task-command");
    if (request.method === "POST" && cancelTaskCommandTaskID) {
      const input = await readJson<CancelTaskCommandRequest>(request);
      const task = await cancelTaskCommand(cancelTaskCommandTaskID, input);
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

function resolveRepoRoot(runtimeDirectory: string): string {
  const configured = process.env.FORGE_REPO_ROOT?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.resolve(runtimeDirectory, "..");
}

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

async function getGitStatusSnapshot(): Promise<GitStatusSnapshot> {
  const generatedAt = new Date().toISOString();

  try {
    const inside = await runGitCommand(["rev-parse", "--is-inside-work-tree"], repoRoot);
    if (inside.exitCode !== 0 || inside.output.trim() !== "true") {
      return {
        isRepository: false,
        isDirty: false,
        summary: "Workspace is not inside a git repository.",
        generatedAt,
        changedFiles: [],
        error: inside.output.trim() || "git rev-parse did not report a repository."
      };
    }

    const rootResult = await runGitCommand(["rev-parse", "--show-toplevel"], repoRoot);
    const gitRoot = rootResult.output.trim() || repoRoot;
    const statusResult = await runGitCommand(["status", "--porcelain=v1", "-b"], gitRoot, 64_000);
    if (statusResult.exitCode !== 0) {
      throw new Error(statusResult.output.trim() || "git status failed.");
    }

    const branch = parseGitBranchLine(statusResult.output.split(/\r?\n/).find((line) => line.startsWith("## ")));
    const changes = parseGitStatusChanges(statusResult.output).filter(isSafeGitChange);
    const stats = await collectGitNumstat(gitRoot);
    const changedFiles = changes.map((change) => ({
      ...change,
      ...stats.get(change.path)
    }));
    const headResult = await runGitCommand(["rev-parse", "--short", "HEAD"], gitRoot);
    const head = headResult.exitCode === 0 ? headResult.output.trim() : undefined;
    const isDirty = changedFiles.length > 0;

    return {
      isRepository: true,
      root: gitRoot,
      branch: branch.branch,
      upstream: branch.upstream,
      head,
      ahead: branch.ahead,
      behind: branch.behind,
      isDirty,
      summary: isDirty
        ? `${changedFiles.length} changed file(s) in ${branch.branch ?? "current checkout"}.`
        : `Working tree clean on ${branch.branch ?? "current checkout"}.`,
      generatedAt,
      changedFiles
    };
  } catch (error) {
    return {
      isRepository: false,
      isDirty: false,
      summary: "Git status could not be read.",
      generatedAt,
      changedFiles: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function getGitFileDiff(rawPath: string | null): Promise<GitFileDiff> {
  const relativePath = normalizeGitDiffPath(rawPath);
  const status = await getGitStatusSnapshot();
  if (!status.isRepository || !status.root) {
    throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
  }

  const change = status.changedFiles.find((candidate) =>
    candidate.path === relativePath || candidate.oldPath === relativePath
  );
  if (!change) {
    throw new HttpError(404, `No git change found for ${relativePath}.`);
  }

  const generatedAt = new Date().toISOString();
  const diffResult = change.untracked
    ? await buildUntrackedFileDiff(status.root, change.path)
    : await buildTrackedFileDiff(status.root, change.path);
  const bounded = truncateGitDiff(diffResult.text);
  const displayMode: GitFileDiff["displayMode"] = diffResult.displayMode === "SideBySide" && bounded.text.trim()
    ? "SideBySide"
    : "Message";
  const unavailableReason = diffResult.unavailableReason
    ?? (bounded.text.trim() ? undefined : "NoTextualDiff");

  return {
    path: change.path,
    oldPath: change.oldPath,
    status: change.status,
    generatedAt,
    diff: bounded.text,
    truncated: bounded.truncated,
    displayMode,
    unavailableReason,
    byteCount: diffResult.byteCount,
    lineCount: diffResult.lineCount,
    appPreviewLineLimit: gitDiffAppPreviewLineLimit,
    summary: summarizeGitFileDiff(change.path, displayMode, unavailableReason, bounded.truncated, diffResult)
  };
}

async function getGitBranchPreview(
  rawTaskID: string | null,
  rawTargetBranch: string | null
): Promise<GitBranchPreview> {
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();
  const task = rawTaskID ? tasks.get(rawTaskID) : undefined;
  const taskMissing = Boolean(rawTaskID && !task);
  const operationBoundary = "Review artifact only. Forge has not created, switched, deleted, pushed, or reset branches.";
  const fallbackBaseBranch = "main";
  const fallbackTargetBranch = normalizeGitBranchTarget(rawTargetBranch, suggestPullRequestBranchName(task, status.branch, fallbackBaseBranch));

  if (!status.isRepository || !status.root) {
    const preflight = unavailableGitBranchPreflight(status, fallbackBaseBranch, fallbackTargetBranch);
    return {
      generatedAt,
      readiness: "Blocked",
      summary: "Branch preparation is blocked because git status is unavailable.",
      preflight,
      expectedHead: status.head,
      currentBranch: status.branch,
      baseBranch: fallbackBaseBranch,
      targetBranch: fallbackTargetBranch,
      mode: "CreateBranch",
      branchExists: false,
      isDirty: status.isDirty,
      changedFiles: [],
      relatedTask: undefined,
      riskNotes: taskMissing ? [`Task ${rawTaskID} was not found.`] : [],
      blockers: [status.error ?? "Workspace is not inside a git repository."],
      operationBoundary
    };
  }

  const upstreamParts = parseGitUpstream(status.upstream);
  const remote = upstreamParts?.remote ?? await getFirstGitRemote(status.root);
  const baseBranch = await getGitDefaultBaseBranch(status.root, remote ?? "origin");
  const targetBranch = normalizeGitBranchTarget(rawTargetBranch, suggestPullRequestBranchName(task, status.branch, baseBranch));
  const branchNameIssue = await gitBranchNameIssue(status.root, targetBranch);
  const branchExists = branchNameIssue ? false : await localGitBranchExists(status.root, targetBranch);
  const remoteBranchExists = branchNameIssue || !remote ? false : await remoteGitBranchExists(status.root, remote, targetBranch);
  const mode = status.branch === targetBranch
    ? "AlreadyOnBranch"
    : branchExists
      ? "SwitchBranch"
      : "CreateBranch";
  const blockers = gitBranchPreviewBlockers(status, targetBranch, baseBranch, mode, branchNameIssue);
  const preflight = gitBranchPreflight(
    status,
    targetBranch,
    baseBranch,
    mode,
    branchNameIssue,
    branchExists,
    remoteBranchExists,
    remote,
    blockers
  );
  const riskNotes = gitBranchRiskNotes(status, task, taskMissing, mode, remoteBranchExists, remote);
  const readiness: GitBranchPreview["readiness"] = blockers.length > 0
    ? "Blocked"
    : riskNotes.length > 0
      ? "NeedsReview"
      : "Ready";

  return {
    generatedAt,
    readiness,
    summary: gitBranchPreviewSummary(status, targetBranch, mode, readiness),
    preflight,
    expectedHead: status.head,
    currentBranch: status.branch,
    baseBranch,
    targetBranch,
    mode,
    branchExists,
    isDirty: status.isDirty,
    changedFiles: status.changedFiles,
    relatedTask: task ? {
      id: task.id,
      title: task.title,
      status: task.status,
      currentPhase: task.currentPhase,
      summary: task.reviewSummary ?? task.objective
    } : undefined,
    riskNotes,
    blockers,
    operationBoundary
  };
}

async function createOrSwitchGitBranch(input: GitBranchRequest): Promise<GitBranchResult> {
  const request = normalizeGitBranchRequest(input);
  const preview = await getGitBranchPreview(request.taskID || null, request.targetBranch);
  const generatedAt = new Date().toISOString();

  if (!preview.expectedHead || preview.expectedHead !== request.expectedHead) {
    throw new HttpError(409, `Git HEAD changed since branch review. Expected ${request.expectedHead}, current ${preview.expectedHead ?? "unknown"}.`);
  }

  if (!preview.currentBranch || preview.currentBranch !== request.expectedCurrentBranch) {
    throw new HttpError(409, `Git branch changed since branch review. Expected ${request.expectedCurrentBranch}, current ${preview.currentBranch ?? "unknown"}.`);
  }

  if (preview.targetBranch !== request.targetBranch) {
    throw new HttpError(409, `Target branch changed since branch review. Expected ${request.targetBranch}, current ${preview.targetBranch}.`);
  }

  if (preview.mode !== request.mode) {
    throw new HttpError(409, `Branch action changed since review. Expected ${request.mode}, current ${preview.mode}.`);
  }

  if (preview.blockers.length > 0) {
    throw new HttpError(409, `Branch action is blocked: ${preview.blockers.join(" ")}`);
  }

  const status = await getGitStatusSnapshot();
  if (!status.isRepository || !status.root) {
    throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
  }

  const args = request.mode === "CreateBranch"
    ? ["switch", "--create", request.targetBranch]
    : ["switch", request.targetBranch];
  const branchResult = await runGitCommand(args, status.root, 96_000);
  if (branchResult.exitCode !== 0) {
    throw new HttpError(409, branchResult.output.trim() || "git branch action failed.");
  }

  const relatedTask = recordGitBranchOnTask(request.taskID, request.mode, preview.currentBranch, request.targetBranch);
  const actionLabel = request.mode === "CreateBranch" ? "Created" : "Switched to";

  return {
    generatedAt,
    previousBranch: preview.currentBranch,
    branch: request.targetBranch,
    mode: request.mode,
    summary: `${actionLabel} branch ${request.targetBranch}.`,
    outputSummary: summarizeGitCommandOutput(branchResult.output),
    relatedTask,
    operationBoundary: "Branch action completed. Forge did not commit, push, merge, reset, delete branches, or publish a PR."
  };
}

function normalizeGitBranchRequest(input: GitBranchRequest): Required<GitBranchRequest> {
  if (!isRecord(input)) {
    throw new HttpError(400, "Git branch request must be an object.");
  }

  if (input.mode !== "CreateBranch" && input.mode !== "SwitchBranch") {
    throw new HttpError(400, "Git branch mode must be CreateBranch or SwitchBranch.");
  }

  if (input.confirmation !== input.mode) {
    throw new HttpError(400, `Git branch action requires explicit confirmation: ${input.mode}.`);
  }

  return {
    taskID: typeof input.taskID === "string" ? input.taskID.trim() : "",
    expectedHead: normalizeSingleLineField(input.expectedHead, "expectedHead", 4, 64),
    expectedCurrentBranch: normalizeSingleLineField(input.expectedCurrentBranch, "expectedCurrentBranch", 1, 200),
    targetBranch: normalizeGitBranchTarget(input.targetBranch, ""),
    mode: input.mode,
    confirmation: input.confirmation
  };
}

function normalizeGitBranchTarget(rawTargetBranch: unknown, fallback: string): string {
  const source = typeof rawTargetBranch === "string" && rawTargetBranch.trim()
    ? rawTargetBranch
    : fallback;
  const targetBranch = normalizeSingleLineField(source, "targetBranch", 1, 120)
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");

  if (!targetBranch) {
    throw new HttpError(400, "targetBranch is required.");
  }

  if (targetBranch.startsWith("-")) {
    throw new HttpError(400, "targetBranch must not start with a dash.");
  }

  return targetBranch;
}

async function gitBranchNameIssue(gitRoot: string, targetBranch: string): Promise<string | undefined> {
  const result = await runGitCommand(["check-ref-format", "--branch", targetBranch], gitRoot, 8_000);
  if (result.exitCode === 0) {
    return undefined;
  }

  return result.output.trim() || `Invalid git branch name: ${targetBranch}`;
}

async function localGitBranchExists(gitRoot: string, targetBranch: string): Promise<boolean> {
  const result = await runGitCommand([
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${targetBranch}`
  ], gitRoot, 8_000);
  return result.exitCode === 0;
}

async function remoteGitBranchExists(gitRoot: string, remote: string, targetBranch: string): Promise<boolean> {
  const localTrackingResult = await runGitCommand([
    "show-ref",
    "--verify",
    "--quiet",
    `refs/remotes/${remote}/${targetBranch}`
  ], gitRoot, 8_000);
  if (localTrackingResult.exitCode === 0) {
    return true;
  }

  const remoteResult = await runGitCommand([
    "ls-remote",
    "--heads",
    remote,
    targetBranch
  ], gitRoot, 16_000);
  return remoteResult.exitCode === 0 && remoteResult.output.trim().length > 0;
}

function unavailableGitBranchPreflight(
  status: GitStatusSnapshot,
  baseBranch: string,
  targetBranch: string
): NonNullable<GitBranchPreview["preflight"]> {
  return {
    targetStatus: targetBranch === baseBranch ? "DefaultBranch" : "Valid",
    targetSummary: "Target branch could not be fully inspected because git status is unavailable.",
    currentBranchStatus: status.branch && !status.branch.startsWith("HEAD") ? "Ready" : "Unknown",
    currentBranchSummary: status.branch
      ? `Current checkout reports ${status.branch}.`
      : "Current branch could not be resolved.",
    worktreeStatus: status.isDirty ? "DirtyBlocked" : "Clean",
    worktreeSummary: status.isDirty
      ? "Working tree state could not be safely inspected for branch changes."
      : "Working tree did not report local changes.",
    existingBranchStatus: "Invalid",
    existingBranchSummary: "Existing local and remote branch state could not be inspected.",
    actionReadiness: "Blocked",
    actionReadinessSummary: "Resolve git repository access before creating or switching branches."
  };
}

function gitBranchPreflight(
  status: GitStatusSnapshot,
  targetBranch: string,
  baseBranch: string,
  mode: GitBranchPreview["mode"],
  branchNameIssue: string | undefined,
  branchExists: boolean,
  remoteBranchExists: boolean,
  remote: string | undefined,
  blockers: string[]
): NonNullable<GitBranchPreview["preflight"]> {
  const targetStatus = branchNameIssue
    ? "Invalid"
    : targetBranch === baseBranch
      ? "DefaultBranch"
      : mode === "AlreadyOnBranch"
        ? "CurrentBranch"
        : "Valid";
  const currentBranchStatus = branchCurrentBranchStatus(status, baseBranch);
  const worktreeStatus = branchWorktreeStatus(status, mode);
  const existingBranchStatus = branchExistingBranchStatus(mode, branchNameIssue, branchExists, remoteBranchExists);
  const actionReadiness: NonNullable<GitBranchPreview["preflight"]>["actionReadiness"] = blockers.length > 0
    ? "Blocked"
    : mode === "CreateBranch" && (status.isDirty || remoteBranchExists)
      ? "NeedsReview"
      : "Ready";

  return {
    targetStatus,
    targetSummary: branchTargetSummary(targetBranch, baseBranch, targetStatus, branchNameIssue),
    currentBranchStatus,
    currentBranchSummary: branchCurrentBranchSummary(status, baseBranch, currentBranchStatus),
    worktreeStatus,
    worktreeSummary: branchWorktreeSummary(status, mode, worktreeStatus),
    existingBranchStatus,
    existingBranchSummary: branchExistingBranchSummary(targetBranch, remote, existingBranchStatus),
    actionReadiness,
    actionReadinessSummary: branchActionReadinessSummary(blockers, mode, actionReadiness)
  };
}

function branchCurrentBranchStatus(
  status: GitStatusSnapshot,
  baseBranch: string
): NonNullable<GitBranchPreview["preflight"]>["currentBranchStatus"] {
  if (!status.branch) {
    return "Unknown";
  }

  if (status.branch.startsWith("HEAD")) {
    return "Detached";
  }

  if (status.branch === baseBranch) {
    return "DefaultBranch";
  }

  return "Ready";
}

function branchCurrentBranchSummary(
  status: GitStatusSnapshot,
  baseBranch: string,
  currentBranchStatus: NonNullable<GitBranchPreview["preflight"]>["currentBranchStatus"]
): string {
  switch (currentBranchStatus) {
  case "DefaultBranch":
    return `Current branch is the default base branch ${baseBranch}; creating a task branch is the expected next step.`;
  case "Detached":
    return "Current checkout is detached; branch creation can attach work to a named branch.";
  case "Ready":
    return `Current branch ${status.branch} is available as the source for this branch action.`;
  default:
    return "Current branch could not be resolved.";
  }
}

function branchWorktreeStatus(
  status: GitStatusSnapshot,
  mode: GitBranchPreview["mode"]
): NonNullable<GitBranchPreview["preflight"]>["worktreeStatus"] {
  if (!status.isDirty) {
    return "Clean";
  }

  return mode === "CreateBranch" ? "DirtyAllowed" : "DirtyBlocked";
}

function branchWorktreeSummary(
  status: GitStatusSnapshot,
  mode: GitBranchPreview["mode"],
  worktreeStatus: NonNullable<GitBranchPreview["preflight"]>["worktreeStatus"]
): string {
  if (worktreeStatus === "Clean") {
    return "Working tree is clean for this branch action.";
  }

  if (worktreeStatus === "DirtyAllowed") {
    return `${status.changedFiles.length} local change(s) will carry onto the new branch.`;
  }

  if (mode === "AlreadyOnBranch") {
    return "No branch switch is needed while local changes are present.";
  }

  return "Switching to an existing branch is blocked until local changes are committed, stashed, or otherwise resolved.";
}

function branchExistingBranchStatus(
  mode: GitBranchPreview["mode"],
  branchNameIssue: string | undefined,
  branchExists: boolean,
  remoteBranchExists: boolean
): NonNullable<GitBranchPreview["preflight"]>["existingBranchStatus"] {
  if (branchNameIssue) {
    return "Invalid";
  }

  if (mode === "AlreadyOnBranch") {
    return "CurrentBranch";
  }

  if (branchExists) {
    return "ExistingLocal";
  }

  if (remoteBranchExists) {
    return "RemoteCollision";
  }

  return "NewLocal";
}

function branchTargetSummary(
  targetBranch: string,
  baseBranch: string,
  targetStatus: NonNullable<GitBranchPreview["preflight"]>["targetStatus"],
  branchNameIssue: string | undefined
): string {
  switch (targetStatus) {
  case "Invalid":
    return branchNameIssue ?? `Target branch ${targetBranch} is not a valid git branch name.`;
  case "DefaultBranch":
    return `Target branch ${targetBranch} is the default base branch ${baseBranch}; choose a task branch instead.`;
  case "CurrentBranch":
    return `Target branch ${targetBranch} is already checked out.`;
  default:
    return `Target branch ${targetBranch} passed local branch-name validation.`;
  }
}

function branchExistingBranchSummary(
  targetBranch: string,
  remote: string | undefined,
  existingBranchStatus: NonNullable<GitBranchPreview["preflight"]>["existingBranchStatus"]
): string {
  switch (existingBranchStatus) {
  case "ExistingLocal":
    return `A local branch named ${targetBranch} already exists; this review is for switching.`;
  case "CurrentBranch":
    return `Already on local branch ${targetBranch}.`;
  case "RemoteCollision":
    return `A remote branch named ${targetBranch} exists on ${remote ?? "the configured remote"}; this action will not set upstream.`;
  case "Invalid":
    return "Existing branch state was not inspected because the target branch name is invalid.";
  default:
    return `No local branch named ${targetBranch} exists; this review is for creating it.`;
  }
}

function branchActionReadinessSummary(
  blockers: string[],
  mode: GitBranchPreview["mode"],
  actionReadiness: NonNullable<GitBranchPreview["preflight"]>["actionReadiness"]
): string {
  if (actionReadiness === "Blocked") {
    return `Resolve ${blockers.length} blocker(s) before changing branches.`;
  }

  if (actionReadiness === "NeedsReview") {
    return "Branch action can proceed after review, but local or remote branch context needs attention.";
  }

  if (mode === "SwitchBranch") {
    return "Ready to switch to the existing local branch after explicit confirmation.";
  }

  return "Ready to create and switch to the new local branch after explicit confirmation.";
}

function gitBranchPreviewBlockers(
  status: GitStatusSnapshot,
  targetBranch: string,
  baseBranch: string,
  mode: GitBranchPreview["mode"],
  branchNameIssue: string | undefined
): string[] {
  const blockers: string[] = [];

  if (branchNameIssue) {
    blockers.push(branchNameIssue);
  }

  if (targetBranch === baseBranch) {
    blockers.push(`Target branch ${targetBranch} is the default base branch; choose a task branch before changing branches.`);
  }

  if (!status.head) {
    blockers.push("Current HEAD could not be read.");
  }

  const unmerged = status.changedFiles.filter((change) => change.status === "Unmerged");
  if (unmerged.length > 0) {
    blockers.push(`Resolve ${unmerged.length} unmerged file(s) before changing branches.`);
  }

  if (mode === "SwitchBranch" && status.isDirty) {
    blockers.push("Switching to an existing branch is blocked while the working tree has uncommitted changes.");
  }

  if (mode === "AlreadyOnBranch") {
    blockers.push(`Already on branch ${targetBranch}; no branch action is needed.`);
  }

  return blockers;
}

function gitBranchRiskNotes(
  status: GitStatusSnapshot,
  task: ForgeTask | undefined,
  taskMissing: boolean,
  mode: GitBranchPreview["mode"],
  remoteBranchExists: boolean,
  remote: string | undefined
): string[] {
  const notes: string[] = [];

  if (taskMissing) {
    notes.push("The requested task was not found, so this branch preview is based on repository state only.");
  }

  if (!task) {
    notes.push("No task context is linked to this branch preview.");
  }

  if (mode === "CreateBranch" && status.isDirty) {
    notes.push(`${status.changedFiles.length} uncommitted file(s) will remain in the working tree after branch creation.`);
  }

  if (mode === "CreateBranch" && remoteBranchExists) {
    notes.push(`A remote branch with this name already exists on ${remote}; this action creates a local branch only and does not set upstream.`);
  }

  if (mode === "SwitchBranch") {
    notes.push("Switching branches can change the visible working tree; Forge blocks this when local changes are present.");
  }

  return notes;
}

function gitBranchPreviewSummary(
  status: GitStatusSnapshot,
  targetBranch: string,
  mode: GitBranchPreview["mode"],
  readiness: GitBranchPreview["readiness"]
): string {
  if (readiness === "Blocked") {
    return `Branch preparation is blocked for ${targetBranch}.`;
  }

  if (mode === "SwitchBranch") {
    return `Ready to switch from ${status.branch ?? "current checkout"} to existing branch ${targetBranch}.`;
  }

  if (mode === "AlreadyOnBranch") {
    return `Already on ${targetBranch}.`;
  }

  return `Ready to create branch ${targetBranch} from ${status.branch ?? "current checkout"}.`;
}

function recordGitBranchOnTask(
  taskID: string,
  mode: GitBranchResult["mode"],
  previousBranch: string | undefined,
  branch: string
): GitBranchResult["relatedTask"] {
  if (!taskID) {
    return undefined;
  }

  const task = tasks.get(taskID);
  if (!task) {
    return undefined;
  }

  const now = new Date().toISOString();
  const action = mode === "CreateBranch" ? "Create Git Branch" : "Switch Git Branch";
  const summary = mode === "CreateBranch"
    ? `Created git branch ${branch}`
    : `Switched git branch from ${previousBranch ?? "unknown"} to ${branch}`;
  const updatedTask = {
    ...task,
    updatedAt: now,
    approvals: [
      ...task.approvals,
      {
        id: randomUUID(),
        action: action as ApprovalRecord["action"],
        decision: "Approved" as const,
        summary,
        decidedAt: now,
        targetID: branch
      }
    ],
    events: [
      ...task.events,
      {
        type: mode === "CreateBranch" ? "git.branch.created" : "git.branch.switched",
        message: summary,
        createdAt: now
      }
    ]
  };

  tasks.set(task.id, updatedTask);
  taskStore.saveTask(updatedTask);
  emit(mode === "CreateBranch" ? "git.branch.created" : "git.branch.switched", {
    taskID: task.id,
    previousBranch,
    branch,
    task: updatedTask
  });

  return {
    id: updatedTask.id,
    title: updatedTask.title,
    status: updatedTask.status,
    currentPhase: updatedTask.currentPhase,
    summary: updatedTask.reviewSummary ?? updatedTask.objective
  };
}

async function getGitBranchPublishPreview(
  rawTaskID: string | null,
  rawRemote: string | null,
  rawRemoteBranch: string | null
): Promise<GitBranchPublishPreview> {
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();
  const task = rawTaskID ? tasks.get(rawTaskID) : undefined;
  const taskMissing = Boolean(rawTaskID && !task);
  const operationBoundary = "Review artifact only. Forge has not pushed, set upstream, force-pushed, or published a PR.";
  const fallbackBaseBranch = "main";

  if (!status.isRepository || !status.root) {
    const preflight = unavailableGitBranchPublishPreflight(status, fallbackBaseBranch);
    return {
      generatedAt,
      readiness: "Blocked",
      summary: "Branch publish is blocked because git status is unavailable.",
      preflight,
      expectedHead: status.head,
      branch: status.branch,
      baseBranch: fallbackBaseBranch,
      upstream: status.upstream,
      isDirty: status.isDirty,
      commitsToPublish: [],
      changedFiles: [],
      relatedTask: undefined,
      riskNotes: taskMissing ? [`Task ${rawTaskID} was not found.`] : [],
      blockers: [status.error ?? "Workspace is not inside a git repository."],
      operationBoundary
    };
  }

  const remotes = await listGitRemotes(status.root);
  const requestedRemote = normalizeOptionalGitRemoteName(rawRemote);
  const remote = requestedRemote ?? remotes[0];
  const baseBranch = await getGitDefaultBaseBranch(status.root, remote ?? "origin");
  const remoteBranch = normalizeGitBranchTarget(rawRemoteBranch, status.branch ?? suggestPullRequestBranchName(task, status.branch, baseBranch));
  const baseRef = remote
    ? await resolveGitBaseRef(status.root, remote, baseBranch)
    : await resolveGitBaseRef(status.root, "origin", baseBranch);
  const commitsToPublish = baseRef ? await collectGitCommitsInRange(status.root, `${baseRef}..HEAD`) : [];
  const remoteBranchExists = remote ? await remoteGitBranchExists(status.root, remote, remoteBranch) : false;
  const blockers = gitBranchPublishBlockers(
    status,
    baseBranch,
    remote,
    remotes,
    requestedRemote,
    remoteBranch,
    remoteBranchExists,
    commitsToPublish,
    baseRef
  );
  const preflight = gitBranchPublishPreflight(
    status,
    baseBranch,
    remote,
    remotes,
    requestedRemote,
    remoteBranch,
    remoteBranchExists,
    commitsToPublish,
    baseRef,
    blockers
  );
  const riskNotes = gitBranchPublishRiskNotes(status, task, taskMissing, baseRef, commitsToPublish);
  const readiness: GitBranchPublishPreview["readiness"] = blockers.length > 0
    ? "Blocked"
    : riskNotes.length > 0
      ? "NeedsReview"
      : "Ready";

  return {
    generatedAt,
    readiness,
    summary: gitBranchPublishPreviewSummary(status, remote, remoteBranch, commitsToPublish, readiness),
    preflight,
    expectedHead: status.head,
    branch: status.branch,
    baseBranch,
    remote,
    remoteBranch,
    upstream: status.upstream,
    isDirty: status.isDirty,
    commitsToPublish,
    changedFiles: status.changedFiles,
    relatedTask: task ? {
      id: task.id,
      title: task.title,
      status: task.status,
      currentPhase: task.currentPhase,
      summary: task.reviewSummary ?? task.objective
    } : undefined,
    riskNotes,
    blockers,
    operationBoundary
  };
}

async function publishGitBranch(input: GitBranchPublishRequest): Promise<GitBranchPublishResult> {
  const request = normalizeGitBranchPublishRequest(input);
  const preview = await getGitBranchPublishPreview(request.taskID || null, request.remote, request.remoteBranch);
  const generatedAt = new Date().toISOString();

  if (!preview.expectedHead || preview.expectedHead !== request.expectedHead) {
    throw new HttpError(409, `Git HEAD changed since branch publish review. Expected ${request.expectedHead}, current ${preview.expectedHead ?? "unknown"}.`);
  }

  if (!preview.branch || preview.branch !== request.expectedBranch) {
    throw new HttpError(409, `Git branch changed since branch publish review. Expected ${request.expectedBranch}, current ${preview.branch ?? "unknown"}.`);
  }

  if (!preview.remote || preview.remote !== request.remote) {
    throw new HttpError(409, `Git remote changed since branch publish review. Expected ${request.remote}, current ${preview.remote ?? "none"}.`);
  }

  if (!preview.remoteBranch || preview.remoteBranch !== request.remoteBranch) {
    throw new HttpError(409, `Remote branch changed since branch publish review. Expected ${request.remoteBranch}, current ${preview.remoteBranch ?? "none"}.`);
  }

  if (preview.blockers.length > 0) {
    throw new HttpError(409, `Branch publish is blocked: ${preview.blockers.join(" ")}`);
  }

  const status = await getGitStatusSnapshot();
  if (!status.isRepository || !status.root) {
    throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
  }

  const pushResult = await runGitCommand([
    "push",
    "--set-upstream",
    request.remote,
    `HEAD:${request.remoteBranch}`
  ], status.root, 96_000);
  if (pushResult.exitCode !== 0) {
    throw new HttpError(409, gitPushFailureMessage(pushResult.output, "Branch publish failed"));
  }

  const upstream = `${request.remote}/${request.remoteBranch}`;
  const relatedTask = recordGitBranchPublishOnTask(
    request.taskID,
    request.expectedBranch,
    upstream,
    preview.commitsToPublish
  );

  return {
    generatedAt,
    branch: request.expectedBranch,
    remote: request.remote,
    remoteBranch: request.remoteBranch,
    upstream,
    pushedCommits: preview.commitsToPublish,
    summary: `Published ${request.expectedBranch} to ${upstream} and set upstream.`,
    outputSummary: summarizeGitCommandOutput(pushResult.output),
    relatedTask,
    operationBoundary: "Published current branch and set upstream. Forge did not force push, merge, reset, delete branches, or publish a PR."
  };
}

function normalizeGitBranchPublishRequest(input: GitBranchPublishRequest): Required<GitBranchPublishRequest> {
  if (!isRecord(input)) {
    throw new HttpError(400, "Git branch publish request must be an object.");
  }

  if (input.confirmation !== "PublishCurrentBranch") {
    throw new HttpError(400, "Git branch publish requires explicit confirmation: PublishCurrentBranch.");
  }

  return {
    taskID: typeof input.taskID === "string" ? input.taskID.trim() : "",
    expectedHead: normalizeSingleLineField(input.expectedHead, "expectedHead", 4, 64),
    expectedBranch: normalizeSingleLineField(input.expectedBranch, "expectedBranch", 1, 200),
    remote: normalizeGitRemoteName(input.remote),
    remoteBranch: normalizeGitBranchTarget(input.remoteBranch, ""),
    confirmation: "PublishCurrentBranch"
  };
}

async function listGitRemotes(gitRoot: string): Promise<string[]> {
  const result = await runGitCommand(["remote"], gitRoot, 8_000);
  if (result.exitCode !== 0) {
    return [];
  }

  return result.output
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean);
}

function normalizeGitRemoteName(rawRemote: unknown): string {
  const remote = normalizeSingleLineField(rawRemote, "remote", 1, 120);
  if (remote.startsWith("-") || remote.includes("/") || remote.includes("\\")) {
    throw new HttpError(400, "remote must be an existing simple git remote name.");
  }

  return remote;
}

function normalizeOptionalGitRemoteName(rawRemote: unknown): string | undefined {
  if (rawRemote === undefined || rawRemote === null || rawRemote === "") {
    return undefined;
  }

  return normalizeGitRemoteName(rawRemote);
}

function unavailableGitBranchPublishPreflight(
  status: GitStatusSnapshot,
  baseBranch: string
): NonNullable<GitBranchPublishPreview["preflight"]> {
  return {
    branchStatus: status.branch && !status.branch.startsWith("HEAD")
      ? status.branch === baseBranch ? "DefaultBranch" : "Ready"
      : "Missing",
    branchSummary: status.branch
      ? `Current checkout reports ${status.branch}.`
      : "Current branch could not be resolved.",
    remoteStatus: "Missing",
    remoteSummary: "No configured remote could be inspected for branch publish.",
    baseStatus: "Missing",
    baseSummary: "Default base branch could not be inspected.",
    commitStatus: "Empty",
    commitSummary: "No publish commit range could be inspected.",
    worktreeStatus: status.isDirty ? "Dirty" : "Clean",
    worktreeSummary: status.isDirty
      ? "Local changes were reported but could not be inspected safely."
      : "Working tree did not report local changes.",
    actionReadiness: "Blocked",
    actionReadinessSummary: "Resolve git repository access before publishing a branch.",
    failureRiskSummary: "Publish failure details will be classified after an approved push attempt can run."
  };
}

function gitBranchPublishPreflight(
  status: GitStatusSnapshot,
  baseBranch: string,
  remote: string | undefined,
  remotes: string[],
  requestedRemote: string | undefined,
  remoteBranch: string,
  remoteBranchExists: boolean,
  commitsToPublish: GitCommitToPush[],
  baseRef: string | undefined,
  blockers: string[]
): NonNullable<GitBranchPublishPreview["preflight"]> {
  const branchStatus = branchPublishBranchStatus(status, baseBranch);
  const remoteStatus = branchPublishRemoteStatus(remote, remotes, requestedRemote, remoteBranchExists);
  const commitStatus = gitCommitRangeStatus(commitsToPublish);
  const worktreeStatus: NonNullable<GitBranchPublishPreview["preflight"]>["worktreeStatus"] = status.isDirty ? "Dirty" : "Clean";
  const actionReadiness: NonNullable<GitBranchPublishPreview["preflight"]>["actionReadiness"] = blockers.length > 0
    ? "Blocked"
    : status.isDirty || commitStatus === "Truncated"
      ? "NeedsReview"
      : "Ready";

  return {
    branchStatus,
    branchSummary: branchPublishBranchSummary(status, baseBranch, branchStatus),
    remoteStatus,
    remoteSummary: branchPublishRemoteSummary(remote, remotes, requestedRemote, remoteBranch, remoteStatus),
    baseStatus: baseRef ? "Resolved" : "Missing",
    baseSummary: baseRef
      ? `Publish comparison will use ${baseRef}.`
      : `Default base branch ${baseBranch} could not be resolved locally.`,
    commitStatus,
    commitSummary: gitCommitRangeSummary(commitsToPublish, "publish"),
    worktreeStatus,
    worktreeSummary: worktreeStatus === "Clean"
      ? "Working tree is clean for branch publish."
      : `${status.changedFiles.length} local change(s) will remain local and will not be published.`,
    actionReadiness,
    actionReadinessSummary: gitTransportActionReadinessSummary(blockers, actionReadiness, "publish this branch"),
    failureRiskSummary: gitPushFailureRiskSummary(remote)
  };
}

function branchPublishBranchStatus(
  status: GitStatusSnapshot,
  baseBranch: string
): NonNullable<GitBranchPublishPreview["preflight"]>["branchStatus"] {
  if (!status.branch) {
    return "Missing";
  }

  if (status.branch.startsWith("HEAD")) {
    return "Detached";
  }

  if (status.branch === baseBranch) {
    return "DefaultBranch";
  }

  if (status.upstream) {
    return "AlreadyTracking";
  }

  return "Ready";
}

function branchPublishBranchSummary(
  status: GitStatusSnapshot,
  baseBranch: string,
  branchStatus: NonNullable<GitBranchPublishPreview["preflight"]>["branchStatus"]
): string {
  switch (branchStatus) {
  case "Detached":
    return "Current checkout is detached; branch publish requires a named local branch.";
  case "DefaultBranch":
    return `Current branch is the default base branch ${baseBranch}; publish a task branch instead.`;
  case "AlreadyTracking":
    return `Current branch already tracks ${status.upstream}; use Push Review instead.`;
  case "Ready":
    return `Current branch ${status.branch} is ready for first publish review.`;
  default:
    return "Current branch could not be resolved.";
  }
}

function branchPublishRemoteStatus(
  remote: string | undefined,
  remotes: string[],
  requestedRemote: string | undefined,
  remoteBranchExists: boolean
): NonNullable<GitBranchPublishPreview["preflight"]>["remoteStatus"] {
  if (!remote) {
    return "Missing";
  }

  if (!remotes.includes(remote) || (requestedRemote && !remotes.includes(requestedRemote))) {
    return "Unknown";
  }

  if (remoteBranchExists) {
    return "RemoteCollision";
  }

  return "Ready";
}

function branchPublishRemoteSummary(
  remote: string | undefined,
  remotes: string[],
  requestedRemote: string | undefined,
  remoteBranch: string,
  remoteStatus: NonNullable<GitBranchPublishPreview["preflight"]>["remoteStatus"]
): string {
  switch (remoteStatus) {
  case "Missing":
    return "No git remote is configured for branch publish.";
  case "Unknown":
    return `Requested remote ${requestedRemote ?? remote ?? "unknown"} is not in the configured remote list (${remotes.join(", ") || "none"}).`;
  case "RemoteCollision":
    return `Remote branch already exists: ${remote}/${remoteBranch}.`;
  default:
    return `Remote ${remote} is configured and ${remoteBranch} is available for first publish.`;
  }
}

function gitBranchPublishBlockers(
  status: GitStatusSnapshot,
  baseBranch: string,
  remote: string | undefined,
  remotes: string[],
  requestedRemote: string | undefined,
  remoteBranch: string,
  remoteBranchExists: boolean,
  commitsToPublish: GitCommitToPush[],
  baseRef: string | undefined
): string[] {
  const blockers: string[] = [];

  if (!status.branch || status.branch.startsWith("HEAD")) {
    blockers.push("Current checkout is detached; branch publish requires a named branch.");
  } else if (status.branch === baseBranch) {
    blockers.push(`Current branch is the default base branch (${baseBranch}); create or switch to a task branch before publishing.`);
  }

  if (!status.head) {
    blockers.push("Current HEAD could not be read.");
  }

  if (!remote) {
    blockers.push("No git remote is configured for branch publish.");
  } else if (!remotes.includes(remote)) {
    blockers.push(`Git remote is not configured: ${remote}.`);
  }

  if (requestedRemote && !remotes.includes(requestedRemote)) {
    blockers.push(`Requested git remote is not configured: ${requestedRemote}.`);
  }

  if (status.upstream) {
    blockers.push(`Current branch already has upstream ${status.upstream}; use Push Review instead.`);
  }

  const unmerged = status.changedFiles.filter((change) => change.status === "Unmerged");
  if (unmerged.length > 0) {
    blockers.push(`Resolve ${unmerged.length} unmerged file(s) before publishing the branch.`);
  }

  if (remoteBranch !== status.branch) {
    blockers.push("Publishing to a differently named remote branch is not supported yet.");
  }

  if (remoteBranchExists) {
    blockers.push(`Remote branch already exists: ${remote}/${remoteBranch}.`);
  }

  if (!baseRef) {
    blockers.push(`Default base branch ${baseBranch} could not be resolved locally.`);
  }

  if (commitsToPublish.length === 0) {
    blockers.push("No commits were found between the base branch and HEAD to publish.");
  }

  return blockers;
}

function gitBranchPublishRiskNotes(
  status: GitStatusSnapshot,
  task: ForgeTask | undefined,
  taskMissing: boolean,
  baseRef: string | undefined,
  commitsToPublish: GitCommitToPush[]
): string[] {
  const notes: string[] = [];

  if (taskMissing) {
    notes.push("The requested task was not found, so this branch publish preview is based on repository state only.");
  }

  if (!task) {
    notes.push("No task context is linked to this branch publish preview.");
  }

  if (status.isDirty) {
    notes.push(`${status.changedFiles.length} uncommitted file(s) will remain local and will not be included in this publish.`);
  }

  if (!baseRef) {
    notes.push("Forge could not compare this branch against the default base branch.");
  }

  if (commitsToPublish.length >= 20) {
    notes.push("Only the first 20 commits are shown in this branch publish preview.");
  }

  return notes;
}

function gitBranchPublishPreviewSummary(
  status: GitStatusSnapshot,
  remote: string | undefined,
  remoteBranch: string,
  commitsToPublish: GitCommitToPush[],
  readiness: GitBranchPublishPreview["readiness"]
): string {
  if (readiness === "Blocked") {
    return `Branch publish is blocked for ${status.branch ?? "current checkout"}.`;
  }

  return `${commitsToPublish.length} commit(s) ready to publish from ${status.branch ?? "current checkout"} to ${remote ?? "remote"}/${remoteBranch}.`;
}

function recordGitBranchPublishOnTask(
  taskID: string,
  branch: string,
  upstream: string,
  commits: GitCommitToPush[]
): GitBranchPublishResult["relatedTask"] {
  if (!taskID) {
    return undefined;
  }

  const task = tasks.get(taskID);
  if (!task) {
    return undefined;
  }

  const now = new Date().toISOString();
  const updatedTask = {
    ...task,
    updatedAt: now,
    approvals: [
      ...task.approvals,
      {
        id: randomUUID(),
        action: "Publish Git Branch" as ApprovalRecord["action"],
        decision: "Approved" as const,
        summary: `Published ${commits.length} commit(s) from ${branch} to ${upstream}`,
        decidedAt: now,
        targetID: upstream
      }
    ],
    events: [
      ...task.events,
      {
        type: "git.branch.published",
        message: `Published ${commits.length} commit(s) from ${branch} to ${upstream}`,
        createdAt: now
      }
    ]
  };

  tasks.set(task.id, updatedTask);
  taskStore.saveTask(updatedTask);
  emit("git.branch.published", { taskID: task.id, branch, upstream, commits, task: updatedTask });

  return {
    id: updatedTask.id,
    title: updatedTask.title,
    status: updatedTask.status,
    currentPhase: updatedTask.currentPhase,
    summary: updatedTask.reviewSummary ?? updatedTask.objective
  };
}

async function getGitCommitPreview(rawTaskID: string | null): Promise<GitCommitPreview> {
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();
  const task = rawTaskID ? tasks.get(rawTaskID) : undefined;
  const taskMissing = Boolean(rawTaskID && !task);
  const operationBoundary = "Review artifact only. Forge has not staged, committed, pushed, or mutated the repository.";

  if (!status.isRepository) {
    return {
      generatedAt,
      readiness: "Blocked",
      summary: "Commit preparation is blocked because git status is unavailable.",
      expectedHead: undefined,
      suggestedTitle: "Update workspace",
      suggestedBody: [],
      includedFiles: [],
      relatedTask: undefined,
      validationSummary: "Validation was not inspected because this workspace is not a git repository.",
      validationCommands: [],
      riskNotes: taskMissing ? [`Task ${rawTaskID} was not found.`] : [],
      blockers: [status.error ?? "Workspace is not inside a git repository."],
      operationBoundary
    };
  }

  const includedFiles = status.changedFiles;
  const validationSummary = commitValidationSummary(task);
  const preflight = await collectGitCommitPreflight(status, includedFiles, validationSummary);
  const blockers = commitPreviewBlockers(status, includedFiles, preflight);
  const validationCommands = suggestedCommitValidationCommands(includedFiles);
  const riskNotes = commitPreviewRiskNotes(status, includedFiles, task, taskMissing, validationSummary, preflight);
  const readiness: GitCommitPreview["readiness"] = blockers.length > 0
    ? "Blocked"
    : riskNotes.length > 0
      ? "NeedsReview"
      : "Ready";
  const suggestedTitle = suggestCommitTitle(task, includedFiles);

  return {
    generatedAt,
    readiness,
    summary: commitPreviewSummary(status, includedFiles, readiness),
    expectedHead: status.head,
    suggestedTitle,
    suggestedBody: buildSuggestedCommitBody(status, task, includedFiles, validationSummary),
    includedFiles,
    relatedTask: task ? {
      id: task.id,
      title: task.title,
      status: task.status,
      currentPhase: task.currentPhase,
      summary: task.reviewSummary ?? task.objective
    } : undefined,
    validationSummary,
    validationCommands,
    preflight,
    riskNotes,
    blockers,
    operationBoundary
  };
}

async function createGitCommit(input: GitCreateCommitRequest): Promise<GitCreateCommitResult> {
  const request = normalizeGitCreateCommitRequest(input);
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();

  if (!status.isRepository || !status.root) {
    throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
  }

  if (!status.isDirty || status.changedFiles.length === 0) {
    throw new HttpError(409, "Working tree is clean; there are no file changes to commit.");
  }

  if (!status.head || status.head !== request.expectedHead) {
    throw new HttpError(409, `Git HEAD changed since commit review. Expected ${request.expectedHead}, current ${status.head ?? "unknown"}.`);
  }

  const changedByPath = new Map(status.changedFiles.map((change) => [change.path, change]));
  const selectedChanges = request.paths.map((filePath) => {
    const change = changedByPath.get(filePath);
    if (!change) {
      throw new HttpError(409, `Selected commit path is no longer changed: ${filePath}`);
    }
    return change;
  });

  const unmerged = selectedChanges.filter((change) => change.status === "Unmerged");
  if (unmerged.length > 0) {
    throw new HttpError(409, `Resolve unmerged file(s) before committing: ${unmerged.map((change) => change.path).join(", ")}`);
  }

  const stagedOutsideSelection = status.changedFiles.filter((change) => change.staged && !request.paths.includes(change.path));
  if (stagedOutsideSelection.length > 0) {
    throw new HttpError(
      409,
      `Existing staged file(s) are outside this commit review: ${stagedOutsideSelection.map((change) => change.path).join(", ")}`
    );
  }

  const identityResult = await runGitCommand(["var", "GIT_AUTHOR_IDENT"], status.root, 8_000);
  if (identityResult.exitCode !== 0) {
    throw new HttpError(409, identityResult.output.trim() || "Git author identity is not configured.");
  }

  const addResult = await runGitCommand(["add", "--", ...request.paths], status.root, 64_000);
  if (addResult.exitCode !== 0) {
    throw new HttpError(409, addResult.output.trim() || "git add failed.");
  }

  const stagedStatus = await getGitStatusSnapshot();
  if (!stagedStatus.isRepository || !stagedStatus.root) {
    throw new HttpError(409, stagedStatus.error ?? "Git status could not be read after staging.");
  }

  const stagedSelectedChanges = stagedStatus.changedFiles.filter((change) => request.paths.includes(change.path) && change.staged);
  if (stagedSelectedChanges.length === 0) {
    throw new HttpError(409, "No selected changes were staged for commit.");
  }

  const commitArgs = ["commit", "-m", request.title];
  for (const line of request.body) {
    commitArgs.push("-m", line);
  }

  const commitResult = await runGitCommand(commitArgs, status.root, 96_000);
  if (commitResult.exitCode !== 0) {
    throw new HttpError(409, commitResult.output.trim() || "git commit failed.");
  }

  const hashResult = await runGitCommand(["rev-parse", "HEAD"], status.root);
  if (hashResult.exitCode !== 0) {
    throw new HttpError(409, hashResult.output.trim() || "Commit was created, but HEAD could not be read.");
  }

  const commitHash = hashResult.output.trim();
  const shortHash = commitHash.slice(0, 7);
  const relatedTask = recordGitCommitOnTask(request.taskID, shortHash, request.title, commitHash);

  return {
    generatedAt,
    commitHash,
    shortHash,
    branch: status.branch,
    summary: `Created local commit ${shortHash} on ${status.branch ?? "current checkout"}.`,
    messageTitle: request.title,
    messageBody: request.body,
    committedFiles: selectedChanges,
    relatedTask,
    operationBoundary: "Local git commit created. Forge did not push, merge, delete branches, reset, or publish anything."
  };
}

function normalizeGitCreateCommitRequest(input: GitCreateCommitRequest): Required<GitCreateCommitRequest> {
  if (!isRecord(input)) {
    throw new HttpError(400, "Git commit request must be an object.");
  }

  if (input.confirmation !== "CreateLocalCommit") {
    throw new HttpError(400, "Git commit requires explicit confirmation: CreateLocalCommit.");
  }

  const expectedHead = stringFieldFromUnknown(input.expectedHead, "expectedHead", 4, 64);
  const title = normalizeCommitMessageTitle(input.title);
  const body = normalizeCommitMessageBody(input.body);
  const paths = normalizeGitCommitPaths(input.paths);
  const taskID = typeof input.taskID === "string" ? input.taskID.trim() : "";

  return {
    taskID,
    expectedHead,
    title,
    body,
    paths,
    confirmation: "CreateLocalCommit"
  };
}

function normalizeCommitMessageTitle(title: unknown): string {
  const normalized = stringFieldFromUnknown(title, "title", 3, 120)
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.includes("\n") || normalized.includes("\r")) {
    throw new HttpError(400, "Commit title must be a single line.");
  }

  return normalized;
}

function normalizeCommitMessageBody(body: unknown): string[] {
  if (body === undefined) {
    return [];
  }

  if (!Array.isArray(body)) {
    throw new HttpError(400, "Commit body must be an array of strings.");
  }

  return body
    .slice(0, 20)
    .map((line, index) => stringFieldFromUnknown(line, `body[${index}]`, 0, 220).trim())
    .filter(Boolean);
}

function normalizeGitCommitPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) {
    throw new HttpError(400, "Commit paths must be an array.");
  }

  const normalized = [...new Set(paths.map((filePath, index) =>
    normalizeGitDiffPath(stringFieldFromUnknown(filePath, `paths[${index}]`, 1, 500))
  ))];

  if (normalized.length === 0) {
    throw new HttpError(400, "At least one commit path is required.");
  }

  if (normalized.length > 100) {
    throw new HttpError(413, "Too many commit paths.");
  }

  return normalized;
}

function recordGitCommitOnTask(
  taskID: string,
  shortHash: string,
  title: string,
  commitHash: string
): GitCreateCommitResult["relatedTask"] {
  if (!taskID) {
    return undefined;
  }

  const task = tasks.get(taskID);
  if (!task) {
    return undefined;
  }

  const updatedTask = {
    ...task,
    updatedAt: new Date().toISOString(),
    approvals: [
      ...task.approvals,
      {
        id: randomUUID(),
        action: "Create Git Commit" as ApprovalRecord["action"],
        decision: "Approved" as const,
        summary: `Created local git commit ${shortHash}: ${title}`,
        decidedAt: new Date().toISOString(),
        targetID: commitHash
      }
    ],
    events: [
      ...task.events,
      {
        type: "git.commit.created",
        message: `Created local git commit ${shortHash}: ${title}`,
        createdAt: new Date().toISOString()
      }
    ]
  };

  tasks.set(task.id, updatedTask);
  taskStore.saveTask(updatedTask);
  emit("git.commit.created", { taskID: task.id, commitHash, shortHash, task: updatedTask });

  return {
    id: updatedTask.id,
    title: updatedTask.title,
    status: updatedTask.status,
    currentPhase: updatedTask.currentPhase,
    summary: updatedTask.reviewSummary ?? updatedTask.objective
  };
}

async function getGitPushPreview(rawTaskID: string | null): Promise<GitPushPreview> {
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();
  const task = rawTaskID ? tasks.get(rawTaskID) : undefined;
  const taskMissing = Boolean(rawTaskID && !task);
  const operationBoundary = "Review artifact only. Forge has not pushed, force-pushed, merged, or published anything.";

  if (!status.isRepository || !status.root) {
    const preflight = unavailableGitPushPreflight(status);
    return {
      generatedAt,
      readiness: "Blocked",
      summary: "Push preparation is blocked because git status is unavailable.",
      preflight,
      expectedHead: status.head,
      branch: status.branch,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      isDirty: status.isDirty,
      commitsToPush: [],
      changedFiles: [],
      relatedTask: undefined,
      riskNotes: taskMissing ? [`Task ${rawTaskID} was not found.`] : [],
      blockers: [status.error ?? "Workspace is not inside a git repository."],
      operationBoundary
    };
  }

  const upstreamParts = parseGitUpstream(status.upstream);
  const remotes = await listGitRemotes(status.root);
  const commitsToPush = upstreamParts && (status.ahead ?? 0) > 0
    ? await collectGitCommitsToPush(status.root, status.upstream)
    : [];
  const blockers = gitPushBlockers(status, upstreamParts, remotes);
  const preflight = gitPushPreflight(status, upstreamParts, remotes, commitsToPush, blockers);
  const riskNotes = gitPushRiskNotes(status, task, taskMissing, commitsToPush);
  const readiness: GitPushPreview["readiness"] = blockers.length > 0
    ? "Blocked"
    : riskNotes.length > 0
      ? "NeedsReview"
      : "Ready";

  return {
    generatedAt,
    readiness,
    summary: gitPushPreviewSummary(status, commitsToPush, readiness),
    preflight,
    expectedHead: status.head,
    branch: status.branch,
    upstream: status.upstream,
    remote: upstreamParts?.remote,
    remoteBranch: upstreamParts?.remoteBranch,
    ahead: status.ahead,
    behind: status.behind,
    isDirty: status.isDirty,
    commitsToPush,
    changedFiles: status.changedFiles,
    relatedTask: task ? {
      id: task.id,
      title: task.title,
      status: task.status,
      currentPhase: task.currentPhase,
      summary: task.reviewSummary ?? task.objective
    } : undefined,
    riskNotes,
    blockers,
    operationBoundary
  };
}

async function pushGitBranch(input: GitPushRequest): Promise<GitPushResult> {
  const request = normalizeGitPushRequest(input);
  const preview = await getGitPushPreview(request.taskID || null);
  const generatedAt = new Date().toISOString();

  if (!preview.expectedHead || preview.expectedHead !== request.expectedHead) {
    throw new HttpError(409, `Git HEAD changed since push review. Expected ${request.expectedHead}, current ${preview.expectedHead ?? "unknown"}.`);
  }

  if (!preview.branch || preview.branch !== request.expectedBranch) {
    throw new HttpError(409, `Git branch changed since push review. Expected ${request.expectedBranch}, current ${preview.branch ?? "unknown"}.`);
  }

  if (!preview.upstream || preview.upstream !== request.expectedUpstream) {
    throw new HttpError(409, `Git upstream changed since push review. Expected ${request.expectedUpstream}, current ${preview.upstream ?? "none"}.`);
  }

  if (preview.blockers.length > 0) {
    throw new HttpError(409, `Push is blocked: ${preview.blockers.join(" ")}`);
  }

  if (!preview.remote || !preview.remoteBranch) {
    throw new HttpError(409, "Push requires a configured upstream remote and branch.");
  }

  const status = await getGitStatusSnapshot();
  if (!status.isRepository || !status.root) {
    throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
  }

  const pushResult = await runGitCommand(
    ["push", preview.remote, `HEAD:${preview.remoteBranch}`],
    status.root,
    96_000
  );
  if (pushResult.exitCode !== 0) {
    throw new HttpError(409, gitPushFailureMessage(pushResult.output, "Push failed"));
  }

  const relatedTask = recordGitPushOnTask(request.taskID, preview.branch, preview.upstream, preview.commitsToPush);

  return {
    generatedAt,
    branch: preview.branch,
    upstream: preview.upstream,
    remote: preview.remote,
    remoteBranch: preview.remoteBranch,
    pushedCommits: preview.commitsToPush,
    summary: `Pushed ${preview.commitsToPush.length} commit(s) from ${preview.branch} to ${preview.upstream}.`,
    outputSummary: summarizeGitCommandOutput(pushResult.output),
    relatedTask,
    operationBoundary: "Pushed current branch to its upstream. Forge did not force push, merge, reset, delete branches, or publish a PR."
  };
}

function normalizeGitPushRequest(input: GitPushRequest): Required<GitPushRequest> {
  if (!isRecord(input)) {
    throw new HttpError(400, "Git push request must be an object.");
  }

  if (input.confirmation !== "PushCurrentBranch") {
    throw new HttpError(400, "Git push requires explicit confirmation: PushCurrentBranch.");
  }

  return {
    taskID: typeof input.taskID === "string" ? input.taskID.trim() : "",
    expectedHead: normalizeSingleLineField(input.expectedHead, "expectedHead", 4, 64),
    expectedBranch: normalizeSingleLineField(input.expectedBranch, "expectedBranch", 1, 200),
    expectedUpstream: normalizeSingleLineField(input.expectedUpstream, "expectedUpstream", 3, 300),
    confirmation: "PushCurrentBranch"
  };
}

function parseGitUpstream(upstream: string | undefined): { remote: string; remoteBranch: string } | undefined {
  const separatorIndex = upstream?.indexOf("/") ?? -1;
  if (!upstream || separatorIndex <= 0 || separatorIndex === upstream.length - 1) {
    return undefined;
  }

  return {
    remote: upstream.slice(0, separatorIndex),
    remoteBranch: upstream.slice(separatorIndex + 1)
  };
}

async function collectGitCommitsToPush(gitRoot: string, upstream: string | undefined): Promise<GitCommitToPush[]> {
  if (!upstream) {
    return [];
  }

  return collectGitCommitsInRange(gitRoot, `${upstream}..HEAD`);
}

async function collectGitCommitsInRange(gitRoot: string, range: string): Promise<GitCommitToPush[]> {
  const result = await runGitCommand([
    "log",
    "--max-count=20",
    "--format=%H%x1f%h%x1f%ad%x1f%s",
    "--date=iso-strict",
    range
  ], gitRoot, 64_000);
  if (result.exitCode !== 0) {
    return [];
  }

  return result.output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, authorDate, ...titleParts] = line.split("\x1f");
      return {
        hash,
        shortHash,
        authorDate,
        title: titleParts.join("\x1f") || "(no commit title)"
      };
    })
    .filter((commit) => commit.hash && commit.shortHash);
}

function unavailableGitPushPreflight(status: GitStatusSnapshot): NonNullable<GitPushPreview["preflight"]> {
  return {
    branchStatus: status.branch && !status.branch.startsWith("HEAD") ? "Ready" : "Missing",
    branchSummary: status.branch
      ? `Current checkout reports ${status.branch}.`
      : "Current branch could not be resolved.",
    upstreamStatus: "Missing",
    upstreamSummary: "No upstream remote branch could be inspected.",
    remoteStatus: "Missing",
    remoteSummary: "No configured upstream remote could be inspected.",
    commitStatus: "Empty",
    commitSummary: "No push commit range could be inspected.",
    worktreeStatus: status.isDirty ? "Dirty" : "Clean",
    worktreeSummary: status.isDirty
      ? "Local changes were reported but could not be inspected safely."
      : "Working tree did not report local changes.",
    actionReadiness: "Blocked",
    actionReadinessSummary: "Resolve git repository access before pushing.",
    failureRiskSummary: "Push failure details will be classified after an approved push attempt can run."
  };
}

function gitPushPreflight(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  remotes: string[],
  commitsToPush: GitCommitToPush[],
  blockers: string[]
): NonNullable<GitPushPreview["preflight"]> {
  const branchStatus = pushBranchStatus(status);
  const upstreamStatus = pushUpstreamStatus(status, upstreamParts);
  const remoteStatus = pushRemoteStatus(upstreamParts, remotes);
  const commitStatus = gitCommitRangeStatus(commitsToPush);
  const worktreeStatus: NonNullable<GitPushPreview["preflight"]>["worktreeStatus"] = status.isDirty ? "Dirty" : "Clean";
  const actionReadiness: NonNullable<GitPushPreview["preflight"]>["actionReadiness"] = blockers.length > 0
    ? "Blocked"
    : status.isDirty || commitStatus === "Truncated"
      ? "NeedsReview"
      : "Ready";

  return {
    branchStatus,
    branchSummary: pushBranchSummary(status, branchStatus),
    upstreamStatus,
    upstreamSummary: pushUpstreamSummary(status, upstreamParts, upstreamStatus),
    remoteStatus,
    remoteSummary: pushRemoteSummary(upstreamParts, remotes, remoteStatus),
    commitStatus,
    commitSummary: gitCommitRangeSummary(commitsToPush, "push"),
    worktreeStatus,
    worktreeSummary: worktreeStatus === "Clean"
      ? "Working tree is clean for push."
      : `${status.changedFiles.length} local change(s) will remain local after push.`,
    actionReadiness,
    actionReadinessSummary: gitTransportActionReadinessSummary(blockers, actionReadiness, "push this branch"),
    failureRiskSummary: gitPushFailureRiskSummary(upstreamParts?.remote)
  };
}

function pushBranchStatus(status: GitStatusSnapshot): NonNullable<GitPushPreview["preflight"]>["branchStatus"] {
  if (!status.branch) {
    return "Missing";
  }

  if (status.branch.startsWith("HEAD")) {
    return "Detached";
  }

  return "Ready";
}

function pushBranchSummary(
  status: GitStatusSnapshot,
  branchStatus: NonNullable<GitPushPreview["preflight"]>["branchStatus"]
): string {
  switch (branchStatus) {
  case "Detached":
    return "Current checkout is detached; push requires a named branch.";
  case "Ready":
    return `Current branch ${status.branch} is ready for upstream push review.`;
  default:
    return "Current branch could not be resolved.";
  }
}

function pushUpstreamStatus(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined
): NonNullable<GitPushPreview["preflight"]>["upstreamStatus"] {
  if (!upstreamParts) {
    return "Missing";
  }

  if ((status.behind ?? 0) > 0) {
    return "Behind";
  }

  if ((status.ahead ?? 0) <= 0) {
    return "NoAhead";
  }

  return "Unpushed";
}

function pushUpstreamSummary(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  upstreamStatus: NonNullable<GitPushPreview["preflight"]>["upstreamStatus"]
): string {
  if (!upstreamParts) {
    return "Current branch has no upstream remote branch.";
  }

  if (upstreamStatus === "Behind") {
    return `Current branch is behind ${upstreamParts.remote}/${upstreamParts.remoteBranch} by ${status.behind ?? 0} commit(s).`;
  }

  if (upstreamStatus === "NoAhead") {
    return `No local commits are ahead of ${upstreamParts.remote}/${upstreamParts.remoteBranch}.`;
  }

  return `${status.ahead ?? 0} local commit(s) are ready to push to ${upstreamParts.remote}/${upstreamParts.remoteBranch}.`;
}

function pushRemoteStatus(
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  remotes: string[]
): NonNullable<GitPushPreview["preflight"]>["remoteStatus"] {
  if (!upstreamParts) {
    return "Missing";
  }

  return remotes.includes(upstreamParts.remote) ? "Ready" : "Unknown";
}

function pushRemoteSummary(
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  remotes: string[],
  remoteStatus: NonNullable<GitPushPreview["preflight"]>["remoteStatus"]
): string {
  if (!upstreamParts) {
    return "No upstream remote is configured.";
  }

  if (remoteStatus === "Unknown") {
    return `Configured upstream remote ${upstreamParts.remote} is not in the local remote list (${remotes.join(", ") || "none"}).`;
  }

  return `Upstream remote ${upstreamParts.remote} is configured.`;
}

function gitCommitRangeStatus(commits: GitCommitToPush[]): "Ready" | "Empty" | "Truncated" {
  if (commits.length === 0) {
    return "Empty";
  }

  return commits.length >= 20 ? "Truncated" : "Ready";
}

function gitCommitRangeSummary(commits: GitCommitToPush[], action: "push" | "publish"): string {
  if (commits.length === 0) {
    return `No commits are currently ready to ${action}.`;
  }

  if (commits.length >= 20) {
    return `At least ${commits.length} commit(s) are in scope; only the first ${commits.length} are shown.`;
  }

  return `${commits.length} commit(s) are in scope for ${action}.`;
}

function gitTransportActionReadinessSummary(
  blockers: string[],
  actionReadiness: "Ready" | "NeedsReview" | "Blocked",
  actionLabel: string
): string {
  if (actionReadiness === "Blocked") {
    return `Resolve ${blockers.length} blocker(s) before attempting to ${actionLabel}.`;
  }

  if (actionReadiness === "NeedsReview") {
    return `Review local changes and commit range before attempting to ${actionLabel}.`;
  }

  return `Ready to ${actionLabel} after explicit confirmation.`;
}

function gitPushFailureRiskSummary(remote: string | undefined): string {
  return `If ${remote ?? "the remote"} rejects the operation, Forge classifies common authentication, non-fast-forward, network, and protected-branch failures before showing the error.`;
}

function gitPushBlockers(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  remotes: string[]
): string[] {
  const blockers: string[] = [];

  if (!status.branch || status.branch.startsWith("HEAD")) {
    blockers.push("Current checkout is detached; push requires a named branch.");
  }

  if (!upstreamParts) {
    blockers.push("Current branch does not have an upstream remote branch.");
  } else if (!remotes.includes(upstreamParts.remote)) {
    blockers.push(`Configured upstream remote is not present locally: ${upstreamParts.remote}.`);
  }

  if ((status.behind ?? 0) > 0) {
    blockers.push(`Current branch is behind upstream by ${status.behind} commit(s).`);
  }

  if ((status.ahead ?? 0) <= 0) {
    blockers.push("There are no local commits ahead of upstream to push.");
  }

  const unmerged = status.changedFiles.filter((change) => change.status === "Unmerged");
  if (unmerged.length > 0) {
    blockers.push(`Resolve ${unmerged.length} unmerged file(s) before pushing.`);
  }

  return blockers;
}

function gitPushRiskNotes(
  status: GitStatusSnapshot,
  task: ForgeTask | undefined,
  taskMissing: boolean,
  commitsToPush: GitCommitToPush[]
): string[] {
  const notes: string[] = [];

  if (taskMissing) {
    notes.push("The requested task was not found, so this preview is based on branch state only.");
  }

  if (!task) {
    notes.push("No task context is linked to this push preview.");
  }

  if (status.isDirty) {
    notes.push(`${status.changedFiles.length} uncommitted file(s) will remain local after the push.`);
  }

  if (commitsToPush.length >= 20 && (status.ahead ?? 0) > commitsToPush.length) {
    notes.push(`Only the first ${commitsToPush.length} commit(s) are shown; ${status.ahead} commit(s) are ahead.`);
  }

  return notes;
}

function gitPushPreviewSummary(
  status: GitStatusSnapshot,
  commitsToPush: GitCommitToPush[],
  readiness: GitPushPreview["readiness"]
): string {
  if (readiness === "Blocked") {
    return `Push preparation is blocked on ${status.branch ?? "current checkout"}.`;
  }

  return `${commitsToPush.length} commit(s) ready to push from ${status.branch ?? "current checkout"} to ${status.upstream ?? "upstream"}.`;
}

function recordGitPushOnTask(
  taskID: string,
  branch: string,
  upstream: string,
  commits: GitCommitToPush[]
): GitPushResult["relatedTask"] {
  if (!taskID) {
    return undefined;
  }

  const task = tasks.get(taskID);
  if (!task) {
    return undefined;
  }

  const now = new Date().toISOString();
  const updatedTask = {
    ...task,
    updatedAt: now,
    approvals: [
      ...task.approvals,
      {
        id: randomUUID(),
        action: "Push Git Branch" as ApprovalRecord["action"],
        decision: "Approved" as const,
        summary: `Pushed ${commits.length} commit(s) from ${branch} to ${upstream}`,
        decidedAt: now,
        targetID: upstream
      }
    ],
    events: [
      ...task.events,
      {
        type: "git.push.completed",
        message: `Pushed ${commits.length} commit(s) from ${branch} to ${upstream}`,
        createdAt: now
      }
    ]
  };

  tasks.set(task.id, updatedTask);
  taskStore.saveTask(updatedTask);
  emit("git.push.completed", { taskID: task.id, branch, upstream, commits, task: updatedTask });

  return {
    id: updatedTask.id,
    title: updatedTask.title,
    status: updatedTask.status,
    currentPhase: updatedTask.currentPhase,
    summary: updatedTask.reviewSummary ?? updatedTask.objective
  };
}

function summarizeGitCommandOutput(output: string): string {
  return output.replace(/\s+/g, " ").trim().slice(0, 800) || "git command completed.";
}

function gitPushFailureMessage(output: string, prefix: string): string {
  const cleaned = summarizeGitCommandOutput(output);
  const classification = classifyGitPushFailure(output);
  return `${prefix}: ${classification.summary} ${cleaned}`.trim();
}

function classifyGitPushFailure(output: string): { kind: string; summary: string } {
  const text = output.toLowerCase();

  if (
    text.includes("authentication failed") ||
    text.includes("permission denied") ||
    text.includes("could not read username") ||
    text.includes("repository not found") ||
    text.includes("access denied")
  ) {
    return {
      kind: "Authentication",
      summary: "authentication or repository access was rejected."
    };
  }

  if (
    text.includes("protected branch") ||
    text.includes("branch is protected") ||
    text.includes("cannot force-push") ||
    text.includes("pre-receive hook declined") ||
    text.includes("protected branch hook declined")
  ) {
    return {
      kind: "ProtectedBranch",
      summary: "remote policy rejected the branch update."
    };
  }

  if (
    text.includes("non-fast-forward") ||
    text.includes("fetch first") ||
    text.includes("failed to push some refs") && text.includes("rejected")
  ) {
    return {
      kind: "NonFastForward",
      summary: "remote has commits that are not present locally; update before pushing."
    };
  }

  if (
    text.includes("could not resolve host") ||
    text.includes("failed to connect") ||
    text.includes("network is unreachable") ||
    text.includes("operation timed out") ||
    text.includes("connection timed out") ||
    text.includes("couldn't connect")
  ) {
    return {
      kind: "Network",
      summary: "network connection to the remote failed."
    };
  }

  if (text.includes("remote rejected") || text.includes("[remote rejected]")) {
    return {
      kind: "RemoteRejected",
      summary: "remote rejected the push."
    };
  }

  return {
    kind: "Unknown",
    summary: "git remote operation failed."
  };
}

async function getGitPullRequestPreview(rawTaskID: string | null): Promise<GitPullRequestPreview> {
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();
  const task = rawTaskID ? tasks.get(rawTaskID) : undefined;
  const taskMissing = Boolean(rawTaskID && !task);
  const operationBoundary = "Review artifact only. Forge has not created, published, pushed, or modified a pull request.";
  const fallbackBaseBranch = "main";

  if (!status.isRepository || !status.root) {
    const riskNotes = taskMissing ? [`Task ${rawTaskID} was not found.`] : [];
    const preflight = unavailableGitPullRequestPreflight(status, fallbackBaseBranch, task);
    return {
      generatedAt,
      readiness: "Blocked",
      summary: "PR handoff is blocked because git status is unavailable.",
      preflight,
      baseBranch: fallbackBaseBranch,
      headBranch: status.branch,
      upstream: status.upstream,
      suggestedBranchName: suggestPullRequestBranchName(task, status.branch, fallbackBaseBranch),
      title: suggestPullRequestTitle(task, []),
      body: [],
      testPlan: pullRequestTestPlan(task, []),
      commits: [],
      changedFiles: [],
      relatedTask: undefined,
      riskNotes,
      blockers: [status.error ?? "Workspace is not inside a git repository."],
      operationBoundary
    };
  }

  const upstreamParts = parseGitUpstream(status.upstream);
  const remoteSummaries = await listGitRemoteSummaries(status.root);
  const remote = upstreamParts?.remote ?? remoteSummaries[0]?.name ?? await getFirstGitRemote(status.root);
  const baseBranch = await getGitDefaultBaseBranch(status.root, remote ?? "origin");
  const baseRef = remote
    ? await resolveGitBaseRef(status.root, remote, baseBranch)
    : await resolveGitBaseRef(status.root, "origin", baseBranch);
  const rangeFiles = baseRef ? await collectGitChangedFilesInRange(status.root, `${baseRef}...HEAD`) : [];
  const changedFiles = mergeGitFileChanges(rangeFiles, status.changedFiles);
  const commits = baseRef ? await collectGitCommitsInRange(status.root, `${baseRef}..HEAD`) : [];
  const blockers = gitPullRequestBlockers(status, baseBranch, upstreamParts, commits, baseRef);
  const preflight = gitPullRequestPreflight(
    status,
    baseBranch,
    baseRef,
    upstreamParts,
    remote,
    remoteSummaries,
    task,
    changedFiles,
    blockers
  );
  const riskNotes = gitPullRequestRiskNotes(status, task, taskMissing, commits, preflight);
  const readiness: GitPullRequestPreview["readiness"] = blockers.length > 0
    ? "Blocked"
    : riskNotes.length > 0
      ? "NeedsReview"
      : "Ready";
  const suggestedBranchName = suggestPullRequestBranchName(task, status.branch, baseBranch);
  const title = suggestPullRequestTitle(task, commits);

  return {
    generatedAt,
    readiness,
    summary: gitPullRequestPreviewSummary(status, baseBranch, commits, readiness),
    preflight,
    baseBranch,
    headBranch: status.branch,
    upstream: status.upstream,
    remote: upstreamParts?.remote ?? remote,
    remoteBranch: upstreamParts?.remoteBranch,
    suggestedBranchName,
    title,
    body: buildPullRequestBody(status, baseBranch, title, task, commits, changedFiles, blockers, riskNotes, preflight),
    testPlan: pullRequestTestPlan(task, changedFiles),
    commits,
    changedFiles,
    relatedTask: task ? {
      id: task.id,
      title: task.title,
      status: task.status,
      currentPhase: task.currentPhase,
      summary: task.reviewSummary ?? task.objective
    } : undefined,
    riskNotes,
    blockers,
    operationBoundary
  };
}

type GitRemoteSummary = {
  name: string;
  urlKind: "HTTPS" | "SSH" | "Local" | "Other" | "Unknown";
};

async function getFirstGitRemote(gitRoot: string): Promise<string | undefined> {
  const result = await runGitCommand(["remote"], gitRoot, 8_000);
  if (result.exitCode !== 0) {
    return undefined;
  }

  return result.output
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .find(Boolean);
}

async function listGitRemoteSummaries(gitRoot: string): Promise<GitRemoteSummary[]> {
  const result = await runGitCommand(["remote"], gitRoot, 8_000);
  if (result.exitCode !== 0) {
    return [];
  }

  const remotes = result.output
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean);

  return Promise.all(remotes.map(async (name) => {
    const urlResult = await runGitCommand(["remote", "get-url", name], gitRoot, 8_000);
    return {
      name,
      urlKind: summarizeRemoteURLKind(urlResult.exitCode === 0 ? urlResult.output.trim() : undefined)
    };
  }));
}

function summarizeRemoteURLKind(url: string | undefined): GitRemoteSummary["urlKind"] {
  if (!url) {
    return "Unknown";
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return "HTTPS";
  }

  if (url.startsWith("ssh://") || /^[^@\s]+@[^:\s]+:.+/.test(url)) {
    return "SSH";
  }

  if (url.startsWith("file://") || url.startsWith("/") || url.startsWith(".")) {
    return "Local";
  }

  return "Other";
}

async function getGitDefaultBaseBranch(gitRoot: string, remote: string): Promise<string> {
  const remoteHead = await runGitCommand([
    "symbolic-ref",
    "--quiet",
    "--short",
    `refs/remotes/${remote}/HEAD`
  ], gitRoot, 8_000);
  const remoteHeadBranch = remoteHead.output.trim();
  if (remoteHead.exitCode === 0 && remoteHeadBranch.startsWith(`${remote}/`)) {
    return remoteHeadBranch.slice(remote.length + 1);
  }

  for (const candidate of ["main", "master", "trunk"]) {
    const remoteCandidate = await runGitCommand([
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/remotes/${remote}/${candidate}`
    ], gitRoot, 8_000);
    if (remoteCandidate.exitCode === 0) {
      return candidate;
    }

    const localCandidate = await runGitCommand([
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${candidate}`
    ], gitRoot, 8_000);
    if (localCandidate.exitCode === 0) {
      return candidate;
    }
  }

  return "main";
}

async function resolveGitBaseRef(gitRoot: string, remote: string, baseBranch: string): Promise<string | undefined> {
  const remoteRef = `${remote}/${baseBranch}`;
  const remoteResult = await runGitCommand([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/remotes/${remoteRef}`
  ], gitRoot, 8_000);
  if (remoteResult.exitCode === 0) {
    return remoteRef;
  }

  const localResult = await runGitCommand([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${baseBranch}`
  ], gitRoot, 8_000);
  if (localResult.exitCode === 0) {
    return baseBranch;
  }

  return undefined;
}

async function collectGitChangedFilesInRange(gitRoot: string, range: string): Promise<GitFileChange[]> {
  const [nameStatusResult, numstatResult] = await Promise.all([
    runGitCommand(["diff", "--name-status", "--find-renames", range, "--"], gitRoot, 64_000),
    runGitCommand(["diff", "--numstat", range, "--"], gitRoot, 64_000)
  ]);
  if (nameStatusResult.exitCode !== 0) {
    return [];
  }

  const stats = parseGitRangeNumstat(numstatResult.exitCode === 0 ? numstatResult.output : "");
  return nameStatusResult.output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => gitFileChangeFromNameStatus(line, stats))
    .filter((change): change is GitFileChange => Boolean(change))
    .filter(isSafeGitChange);
}

function parseGitRangeNumstat(output: string): Map<string, { additions?: number; deletions?: number }> {
  const stats = new Map<string, { additions?: number; deletions?: number }>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [additionsText, deletionsText, ...pathParts] = line.split("\t");
    const filePath = pathParts.at(-1);
    if (!filePath) {
      continue;
    }

    stats.set(filePath, {
      additions: parseGitNumstatValue(additionsText),
      deletions: parseGitNumstatValue(deletionsText)
    });
  }

  return stats;
}

function gitFileChangeFromNameStatus(
  line: string,
  stats: Map<string, { additions?: number; deletions?: number }>
): GitFileChange | undefined {
  const [statusCode, ...pathParts] = line.split("\t");
  if (!statusCode || pathParts.length === 0) {
    return undefined;
  }

  const statusLetter = statusCode[0] ?? "M";
  const oldPath = statusLetter === "R" || statusLetter === "C" ? pathParts[0] : undefined;
  const filePath = oldPath ? pathParts[1] : pathParts[0];
  if (!filePath) {
    return undefined;
  }

  const status = statusLetter === "A"
    ? "Added"
    : statusLetter === "D"
      ? "Deleted"
      : statusLetter === "R"
        ? "Renamed"
        : statusLetter === "C"
          ? "Copied"
          : "Modified";
  const lineStats = stats.get(filePath);

  return {
    path: filePath,
    oldPath,
    status,
    indexStatus: statusLetter,
    worktreeStatus: " ",
    staged: false,
    unstaged: false,
    untracked: false,
    additions: lineStats?.additions,
    deletions: lineStats?.deletions
  };
}

function mergeGitFileChanges(primary: GitFileChange[], secondary: GitFileChange[]): GitFileChange[] {
  const merged = new Map<string, GitFileChange>();
  for (const change of [...primary, ...secondary]) {
    merged.set(change.path, change);
  }

  return [...merged.values()].sort((first, second) =>
    first.path.localeCompare(second.path, undefined, { numeric: true })
  );
}

function unavailableGitPullRequestPreflight(
  status: GitStatusSnapshot,
  baseBranch: string,
  task: ForgeTask | undefined
): NonNullable<GitPullRequestPreview["preflight"]> {
  const validationSummary = commitValidationSummary(task);
  return {
    baseRefStatus: "Missing",
    baseRefSummary: "Base branch could not be inspected because git status is unavailable.",
    headBranchStatus: status.branch && !status.branch.startsWith("HEAD") ? "Ready" : "Detached",
    headBranchSummary: status.branch
      ? `Current checkout reports ${status.branch}.`
      : "Current checkout could not be resolved to a branch.",
    upstreamStatus: "Missing",
    upstreamSummary: "No upstream remote branch could be inspected.",
    remoteStatus: "Missing",
    remoteSummary: "No git remote could be inspected.",
    validationState: commitValidationState(validationSummary),
    validationSummary,
    testEvidence: pullRequestValidationEvidence(task),
    publishReadinessSummary: `Resolve git repository access before preparing a PR into ${baseBranch}.`
  };
}

function gitPullRequestPreflight(
  status: GitStatusSnapshot,
  baseBranch: string,
  baseRef: string | undefined,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  remote: string | undefined,
  remoteSummaries: GitRemoteSummary[],
  task: ForgeTask | undefined,
  changedFiles: GitFileChange[],
  blockers: string[]
): NonNullable<GitPullRequestPreview["preflight"]> {
  const validationSummary = commitValidationSummary(task);
  const headBranchStatus = pullRequestHeadBranchStatus(status, baseBranch);
  const upstreamStatus = pullRequestUpstreamStatus(status, upstreamParts);
  const remoteState = pullRequestRemoteState(remote, remoteSummaries);
  const validationState = commitValidationState(validationSummary);

  return {
    baseRefStatus: baseRef ? "Resolved" : "Missing",
    baseRefSummary: baseRef
      ? `Base comparison will use ${baseRef}.`
      : `Default base branch ${baseBranch} could not be resolved locally.`,
    headBranchStatus,
    headBranchSummary: pullRequestHeadBranchSummary(status, baseBranch, headBranchStatus),
    upstreamStatus,
    upstreamSummary: pullRequestUpstreamSummary(status, upstreamParts, upstreamStatus),
    remoteStatus: remoteState.status,
    remoteSummary: remoteState.summary,
    validationState,
    validationSummary,
    testEvidence: pullRequestValidationEvidence(task, changedFiles),
    publishReadinessSummary: pullRequestPublishReadinessSummary(blockers, validationState, remoteState.status)
  };
}

function pullRequestHeadBranchStatus(
  status: GitStatusSnapshot,
  baseBranch: string
): NonNullable<GitPullRequestPreview["preflight"]>["headBranchStatus"] {
  if (!status.branch || status.branch.startsWith("HEAD")) {
    return "Detached";
  }

  if (status.branch === baseBranch) {
    return "DefaultBranch";
  }

  return "Ready";
}

function pullRequestHeadBranchSummary(
  status: GitStatusSnapshot,
  baseBranch: string,
  headBranchStatus: NonNullable<GitPullRequestPreview["preflight"]>["headBranchStatus"]
): string {
  if (headBranchStatus === "Detached") {
    return "Current checkout is detached; switch to a task branch before PR publication.";
  }

  if (headBranchStatus === "DefaultBranch") {
    return `Current branch is ${baseBranch}; create or switch to a task branch before PR publication.`;
  }

  return `Current branch ${status.branch} can be used as the PR head.`;
}

function pullRequestUpstreamStatus(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined
): NonNullable<GitPullRequestPreview["preflight"]>["upstreamStatus"] {
  if (!upstreamParts) {
    return "Missing";
  }

  if ((status.ahead ?? 0) > 0) {
    return "Unpushed";
  }

  if ((status.behind ?? 0) > 0) {
    return "Behind";
  }

  return "Ready";
}

function pullRequestUpstreamSummary(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  upstreamStatus: NonNullable<GitPullRequestPreview["preflight"]>["upstreamStatus"]
): string {
  if (!upstreamParts) {
    return "No upstream remote branch is configured for the current branch.";
  }

  if (upstreamStatus === "Unpushed") {
    return `Push ${status.ahead ?? 0} local commit(s) to ${upstreamParts.remote}/${upstreamParts.remoteBranch} before PR publication.`;
  }

  if (upstreamStatus === "Behind") {
    return `Update from ${upstreamParts.remote}/${upstreamParts.remoteBranch}; branch is behind by ${status.behind ?? 0} commit(s).`;
  }

  return `Current branch is synced with ${upstreamParts.remote}/${upstreamParts.remoteBranch}.`;
}

function pullRequestRemoteState(
  remote: string | undefined,
  remoteSummaries: GitRemoteSummary[]
): {
  status: NonNullable<GitPullRequestPreview["preflight"]>["remoteStatus"];
  summary: string;
} {
  if (!remote) {
    return {
      status: "Missing",
      summary: "No configured git remote was found for PR handoff."
    };
  }

  const selectedRemote = remoteSummaries.find((candidate) => candidate.name === remote);
  const remoteNames = remoteSummaries.map((candidate) => candidate.name).join(", ");

  if (!selectedRemote) {
    return {
      status: "Unknown",
      summary: `Selected remote ${remote} was not found in the local remote list.`
    };
  }

  if (remoteSummaries.length > 1 || remote !== "origin") {
    return {
      status: "ForkLike",
      summary: `Multiple or non-origin remotes are configured (${remoteNames}); verify the base repository before PR publication.`
    };
  }

  return {
    status: "Ready",
    summary: `Remote ${remote} is configured (${selectedRemote.urlKind}).`
  };
}

function pullRequestValidationEvidence(task: ForgeTask | undefined, changedFiles: GitFileChange[] = []): string[] {
  if (!task) {
    return ["No task context is linked, so Forge cannot attach task validation evidence."];
  }

  const runs = task.validationRuns.slice(-3);
  if (runs.length === 0) {
    return ["No Forge validation run is linked yet."];
  }

  const evidence = runs.map((run) => `${run.presetName}: ${run.status} - ${run.summary}`);
  for (const command of suggestedCommitValidationCommands(changedFiles)) {
    if (!evidence.some((line) => line.includes(command))) {
      evidence.push(`Suggested: ${command}`);
    }
  }

  return evidence.slice(0, 8);
}

function pullRequestPublishReadinessSummary(
  blockers: string[],
  validationState: NonNullable<GitPullRequestPreview["preflight"]>["validationState"],
  remoteStatus: NonNullable<GitPullRequestPreview["preflight"]>["remoteStatus"]
): string {
  if (blockers.length > 0) {
    return `Resolve ${blockers.length} blocker(s) before creating or publishing a PR.`;
  }

  if (validationState !== "Passed") {
    return "Branch metadata is ready, but validation evidence needs review before publication.";
  }

  if (remoteStatus === "ForkLike" || remoteStatus === "Unknown") {
    return "Branch metadata is ready, but the target base repository should be verified before publication.";
  }

  return "PR handoff is ready for a future approved publication step.";
}

function gitPullRequestBlockers(
  status: GitStatusSnapshot,
  baseBranch: string,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  commits: GitCommitToPush[],
  baseRef: string | undefined
): string[] {
  const blockers: string[] = [];

  if (!status.branch || status.branch.startsWith("HEAD")) {
    blockers.push("Current checkout is detached; PR handoff requires a named branch.");
  } else if (status.branch === baseBranch) {
    blockers.push(`Current branch is the default base branch (${baseBranch}); create or switch to a task branch before PR handoff.`);
  }

  if (!baseRef) {
    blockers.push(`Default base branch ${baseBranch} could not be resolved locally.`);
  }

  if (!upstreamParts) {
    blockers.push("Current branch has no upstream remote branch; push the branch before PR handoff.");
  }

  if ((status.ahead ?? 0) > 0) {
    blockers.push(`Current branch still has ${status.ahead} unpushed commit(s); push before PR handoff.`);
  }

  if ((status.behind ?? 0) > 0) {
    blockers.push(`Current branch is behind upstream by ${status.behind} commit(s); update before PR handoff.`);
  }

  const unmerged = status.changedFiles.filter((change) => change.status === "Unmerged");
  if (unmerged.length > 0) {
    blockers.push(`Resolve ${unmerged.length} unmerged file(s) before PR handoff.`);
  }

  if (commits.length === 0) {
    blockers.push("No commits were found between the base branch and HEAD for a PR.");
  }

  return blockers;
}

function gitPullRequestRiskNotes(
  status: GitStatusSnapshot,
  task: ForgeTask | undefined,
  taskMissing: boolean,
  commits: GitCommitToPush[],
  preflight?: NonNullable<GitPullRequestPreview["preflight"]>
): string[] {
  const notes: string[] = [];

  if (taskMissing) {
    notes.push("The requested task was not found, so this preview is based on branch state only.");
  }

  if (!task) {
    notes.push("No task context is linked to this PR preview.");
  }

  if (status.isDirty) {
    notes.push(`${status.changedFiles.length} uncommitted file(s) are not part of the pushed branch yet.`);
  }

  const latestRun = task?.validationRuns.at(-1);
  if (!latestRun) {
    notes.push("No Forge validation run is linked to this PR preview.");
  } else if (latestRun.status !== "Passed") {
    notes.push(`Latest Forge validation is ${latestRun.status}: ${latestRun.summary}`);
  }

  if (commits.length >= 20) {
    notes.push("Only the first 20 commits are shown in this PR preview.");
  }

  if (preflight?.remoteStatus === "ForkLike" || preflight?.remoteStatus === "Unknown") {
    notes.push(preflight.remoteSummary);
  }

  return notes;
}

function gitPullRequestPreviewSummary(
  status: GitStatusSnapshot,
  baseBranch: string,
  commits: GitCommitToPush[],
  readiness: GitPullRequestPreview["readiness"]
): string {
  if (readiness === "Blocked") {
    return `PR handoff is blocked for ${status.branch ?? "current checkout"} into ${baseBranch}.`;
  }

  return `${commits.length} commit(s) are ready for PR handoff from ${status.branch ?? "current checkout"} into ${baseBranch}.`;
}

function suggestPullRequestBranchName(
  task: ForgeTask | undefined,
  currentBranch: string | undefined,
  baseBranch: string
): string {
  if (currentBranch && !currentBranch.startsWith("HEAD") && currentBranch !== baseBranch) {
    return currentBranch;
  }

  const source = task?.title ?? task?.objective ?? "forge task";
  return `forge/${slugText(source, "task")}`;
}

function suggestPullRequestTitle(task: ForgeTask | undefined, commits: GitCommitToPush[]): string {
  if (task?.title) {
    return normalizeCommitTitle(task.title);
  }

  if (commits[0]?.title) {
    return normalizeCommitTitle(commits[0].title);
  }

  return "Update Forge workspace";
}

function slugText(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/g, "");

  return slug || fallback;
}

function buildPullRequestBody(
  status: GitStatusSnapshot,
  baseBranch: string,
  title: string,
  task: ForgeTask | undefined,
  commits: GitCommitToPush[],
  changedFiles: GitFileChange[],
  blockers: string[],
  riskNotes: string[],
  preflight?: NonNullable<GitPullRequestPreview["preflight"]>
): string[] {
  const lines = [
    "## Summary",
    `- ${task?.reviewSummary ?? task?.objective ?? title}`,
    "",
    "## Branch",
    `- Head: ${status.branch ?? "detached"}`,
    `- Base: ${baseBranch}`,
    `- Upstream: ${status.upstream ?? "not configured"}`
  ];

  if (preflight) {
    lines.push(
      "",
      "## Preflight",
      `- Base ref: ${preflight.baseRefStatus} - ${preflight.baseRefSummary}`,
      `- Head branch: ${preflight.headBranchStatus} - ${preflight.headBranchSummary}`,
      `- Upstream: ${preflight.upstreamStatus} - ${preflight.upstreamSummary}`,
      `- Remote: ${preflight.remoteStatus} - ${preflight.remoteSummary}`,
      `- Validation: ${preflight.validationState} - ${preflight.validationSummary}`
    );
  }

  if (task) {
    lines.push("", "## Linked Task", `- ${task.title} (${task.id})`, `- Status: ${task.status} / ${task.currentPhase}`);
  }

  if (commits.length > 0) {
    lines.push("", "## Commits");
    for (const commit of commits.slice(0, 10)) {
      lines.push(`- ${commit.shortHash} ${commit.title}`);
    }
    if (commits.length > 10) {
      lines.push(`- ${commits.length - 10} more commit(s)`);
    }
  }

  if (changedFiles.length > 0) {
    lines.push("", "## Changed Files");
    for (const file of changedFiles.slice(0, 12)) {
      lines.push(`- ${commitFileSummary(file)}`);
    }
    if (changedFiles.length > 12) {
      lines.push(`- ${changedFiles.length - 12} more file(s)`);
    }
  }

  if (blockers.length > 0) {
    lines.push("", "## Blockers", ...blockers.map((blocker) => `- ${blocker}`));
  }

  if (riskNotes.length > 0) {
    lines.push("", "## Risk Notes", ...riskNotes.map((note) => `- ${note}`));
  }

  return lines;
}

function pullRequestTestPlan(task: ForgeTask | undefined, changedFiles: GitFileChange[]): string[] {
  const latestRun = task?.validationRuns.at(-1);
  const plan: string[] = [];

  if (latestRun) {
    plan.push(`${latestRun.presetName}: ${latestRun.status} - ${latestRun.summary}`);
    plan.push(...latestRun.commands.slice(0, 5).map((command) =>
      `${command.command}: ${command.status}${command.exitCode === undefined ? "" : ` (${command.exitCode})`}`
    ));
  } else {
    plan.push("No Forge validation run is linked yet.");
  }

  for (const command of suggestedCommitValidationCommands(changedFiles)) {
    if (!plan.some((line) => line.includes(command))) {
      plan.push(`Suggested: ${command}`);
    }
  }

  return plan.slice(0, 8);
}

function commitPreviewBlockers(
  status: GitStatusSnapshot,
  files: GitFileChange[],
  preflight?: GitCommitPreview["preflight"]
): string[] {
  const blockers: string[] = [];

  if (!status.isDirty || files.length === 0) {
    blockers.push("Working tree is clean; there are no file changes to commit.");
  }

  const unmergedFiles = files.filter((file) => file.status === "Unmerged");
  if (unmergedFiles.length > 0) {
    blockers.push(`Resolve ${unmergedFiles.length} unmerged file(s) before preparing a commit.`);
  }

  if (preflight?.identityStatus === "Missing") {
    blockers.push("Git author identity is not configured; set user.name and user.email before committing.");
  }

  return blockers;
}

function commitPreviewRiskNotes(
  status: GitStatusSnapshot,
  files: GitFileChange[],
  task: ForgeTask | undefined,
  taskMissing: boolean,
  validationSummary: string,
  preflight?: GitCommitPreview["preflight"]
): string[] {
  const notes: string[] = [];

  if (taskMissing) {
    notes.push("The requested task was not found, so this preview is based on working tree state only.");
  }

  if (!task) {
    notes.push("No task context is linked to this preview.");
  }

  const unstagedCount = files.filter((file) => file.unstaged || file.untracked).length;
  if (unstagedCount > 0) {
    notes.push(`${unstagedCount} file(s) are unstaged or untracked; review inclusion before committing.`);
  }

  const stagedCount = files.filter((file) => file.staged).length;
  if (stagedCount > 0 && unstagedCount > 0) {
    notes.push("The working tree mixes staged and unstaged changes; the eventual commit boundary needs explicit review.");
  }

  if ((status.behind ?? 0) > 0) {
    notes.push(`Current branch is behind upstream by ${status.behind} commit(s).`);
  }

  if (preflight?.largeChangeSet && preflight.largeChangeSummary) {
    notes.push(preflight.largeChangeSummary);
  }

  if ((preflight?.filesWithoutStats ?? 0) > 0) {
    notes.push(`${preflight?.filesWithoutStats} file(s) do not have line-count stats; review binary or rename-only changes carefully.`);
  }

  if (validationSummary.includes("Failed")) {
    notes.push("Latest task validation failed; repair or explicitly accept the risk before committing.");
  } else if (validationSummary.includes("No validation run")) {
    notes.push("No task validation run is linked yet.");
  }

  return notes;
}

async function collectGitCommitPreflight(
  status: GitStatusSnapshot,
  files: GitFileChange[],
  validationSummary: string
): Promise<GitCommitPreview["preflight"]> {
  const identity = status.root
    ? await getGitAuthorIdentitySummary(status.root)
    : {
        identityStatus: "Unknown" as const,
        identitySummary: "Git author identity could not be inspected because the repository root is unavailable."
      };
  const stagedFileCount = files.filter((file) => file.staged).length;
  const unstagedFileCount = files.filter((file) => file.unstaged).length;
  const untrackedFileCount = files.filter((file) => file.untracked).length;
  const totalAdditions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const totalDeletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const filesWithoutStats = files.filter((file) => file.additions === undefined || file.deletions === undefined).length;
  const totalLineChanges = totalAdditions + totalDeletions;
  const largeChangeReasons = [
    files.length > 30 ? `${files.length} files` : undefined,
    totalLineChanges > 1_000 ? `${totalLineChanges} line changes` : undefined
  ].filter(Boolean);
  const largeChangeSet = largeChangeReasons.length > 0;

  return {
    ...identity,
    stagedFileCount,
    unstagedFileCount,
    untrackedFileCount,
    totalAdditions,
    totalDeletions,
    filesWithoutStats,
    largeChangeSet,
    largeChangeSummary: largeChangeSet
      ? `Large commit candidate: ${largeChangeReasons.join(", ")}. Consider splitting the commit or running targeted validation.`
      : undefined,
    validationState: commitValidationState(validationSummary),
    hookRiskSummary: "Local git commit hooks may still run during commit; Forge will surface git commit output if a hook rejects the commit.",
    pathLimit: 100
  };
}

async function getGitAuthorIdentitySummary(
  gitRoot: string
): Promise<Pick<NonNullable<GitCommitPreview["preflight"]>, "identityStatus" | "identitySummary">> {
  const identityResult = await runGitCommand(["var", "GIT_AUTHOR_IDENT"], gitRoot, 8_000);
  if (identityResult.exitCode === 0) {
    const identity = identityResult.output.trim().replace(/\s+\d+\s+[+-]\d{4}$/, "");
    return {
      identityStatus: "Ready",
      identitySummary: identity ? `Git author identity is configured as ${identity}.` : "Git author identity is configured."
    };
  }

  return {
    identityStatus: "Missing",
    identitySummary: identityResult.output.trim() || "Git author identity is not configured."
  };
}

function commitValidationState(validationSummary: string): NonNullable<GitCommitPreview["preflight"]>["validationState"] {
  if (validationSummary.includes("Passed")) {
    return "Passed";
  }

  if (validationSummary.includes("Failed")) {
    return "Failed";
  }

  if (validationSummary.includes("No validation run")) {
    return "Missing";
  }

  return "Unknown";
}

function suggestedCommitValidationCommands(files: GitFileChange[]): string[] {
  const paths = files.map((file) => file.path);
  const commands = ["git diff --check"];

  if (paths.some((filePath) => filePath.startsWith("runtime/"))) {
    commands.push("cd runtime && npm run check");
    commands.push("cd runtime && npm run build");
  }

  if (paths.some((filePath) => filePath.startsWith("apps/macos/") || filePath === "Package.swift")) {
    commands.push("swift build");
  }

  return [...new Set(commands)];
}

function commitValidationSummary(task: ForgeTask | undefined): string {
  if (!task) {
    return "No validation run is linked to this preview.";
  }

  const latestRun = task.validationRuns.at(-1);
  if (!latestRun) {
    return "No validation run is linked to this task yet.";
  }

  return `${latestRun.status}: ${latestRun.summary}`;
}

function suggestCommitTitle(task: ForgeTask | undefined, files: GitFileChange[]): string {
  if (task?.title) {
    return normalizeCommitTitle(task.title);
  }

  const paths = files.map((file) => file.path);
  const touchesRuntime = paths.some((filePath) => filePath.startsWith("runtime/"));
  const touchesMacApp = paths.some((filePath) => filePath.startsWith("apps/macos/") || filePath === "Package.swift");
  const touchesDocs = paths.some((filePath) => filePath === "README.md" || filePath.startsWith("docs/"));
  const touchesDesign = paths.some((filePath) => filePath.startsWith("design_handoff_forge/"));

  if (touchesRuntime && touchesMacApp) {
    return "Advance Forge agent review workflow";
  }

  if (touchesRuntime) {
    return "Update Forge runtime workflow";
  }

  if (touchesMacApp) {
    return "Update Forge macOS review UI";
  }

  if (touchesDesign) {
    return "Add Forge design handoff assets";
  }

  if (touchesDocs) {
    return "Update Forge documentation";
  }

  return "Update Forge workspace";
}

function normalizeCommitTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
  if (!normalized) {
    return "Update Forge workspace";
  }

  const capitalized = `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
  return capitalized.length > 72 ? `${capitalized.slice(0, 69).trimEnd()}...` : capitalized;
}

function buildSuggestedCommitBody(
  status: GitStatusSnapshot,
  task: ForgeTask | undefined,
  files: GitFileChange[],
  validationSummary: string
): string[] {
  const body = [
    `Branch: ${status.branch ?? "detached"}${status.head ? ` @ ${status.head}` : ""}`,
    `Files: ${files.length} changed`,
    `Validation: ${validationSummary}`
  ];

  if (task) {
    body.splice(1, 0, `Task: ${task.title} (${task.id})`);
  }

  const fileLines = files.slice(0, 8).map((file) => `- ${commitFileSummary(file)}`);
  if (fileLines.length > 0) {
    body.push("Changed files:", ...fileLines);
  }

  if (files.length > fileLines.length) {
    body.push(`- ${files.length - fileLines.length} more file(s)`);
  }

  return body;
}

function commitPreviewSummary(
  status: GitStatusSnapshot,
  files: GitFileChange[],
  readiness: GitCommitPreview["readiness"]
): string {
  if (readiness === "Blocked") {
    return `Commit preparation is blocked on ${status.branch ?? "current checkout"}.`;
  }

  const stagedCount = files.filter((file) => file.staged).length;
  const unstagedCount = files.filter((file) => file.unstaged || file.untracked).length;
  return `${files.length} file(s) on ${status.branch ?? "current checkout"}; ${stagedCount} staged, ${unstagedCount} unstaged or untracked.`;
}

function commitFileSummary(file: GitFileChange): string {
  const stats = file.additions === undefined || file.deletions === undefined
    ? ""
    : ` (+${file.additions} -${file.deletions})`;
  const staged = file.staged ? "staged" : "not staged";
  const working = file.untracked ? "untracked" : file.unstaged ? "unstaged" : "clean index";
  return `${file.status}: ${file.path}${stats} [${staged}, ${working}]`;
}

async function collectGitNumstat(gitRoot: string): Promise<Map<string, { additions?: number; deletions?: number }>> {
  const stats = new Map<string, { additions?: number; deletions?: number }>();
  const outputs = await Promise.all([
    runGitCommand(["diff", "--numstat", "--"], gitRoot),
    runGitCommand(["diff", "--cached", "--numstat", "--"], gitRoot)
  ]);

  for (const output of outputs) {
    if (output.exitCode !== 0) {
      continue;
    }

    for (const line of output.output.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      const [additionsText, deletionsText, ...pathParts] = line.split("\t");
      const filePath = pathParts.join("\t");
      if (!filePath) {
        continue;
      }

      const current = stats.get(filePath) ?? {};
      const additions = parseGitNumstatValue(additionsText);
      const deletions = parseGitNumstatValue(deletionsText);
      stats.set(filePath, {
        additions: additions === undefined ? current.additions : (current.additions ?? 0) + additions,
        deletions: deletions === undefined ? current.deletions : (current.deletions ?? 0) + deletions
      });
    }
  }

  return stats;
}

function parseGitBranchLine(line: string | undefined): {
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
} {
  if (!line?.startsWith("## ")) {
    return {};
  }

  const content = line.slice(3).trim();
  const bracketMatch = content.match(/\[(.*)\]$/);
  const relation = bracketMatch?.[1];
  const branchContent = bracketMatch ? content.slice(0, bracketMatch.index).trim() : content;
  const [branch, upstream] = branchContent.split("...").map((part) => part.trim()).filter(Boolean);
  const ahead = relation?.match(/ahead (\d+)/)?.[1];
  const behind = relation?.match(/behind (\d+)/)?.[1];

  return {
    branch,
    upstream,
    ahead: ahead ? Number(ahead) : undefined,
    behind: behind ? Number(behind) : undefined
  };
}

function parseGitStatusChanges(output: string): GitFileChange[] {
  const changes: GitFileChange[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line || line.startsWith("## ")) {
      continue;
    }

    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";
    const rawPath = line.slice(3);
    const renamedParts = rawPath.split(" -> ");
    const oldPath = renamedParts.length > 1 ? renamedParts[0] : undefined;
    const filePath = renamedParts.length > 1 ? renamedParts.slice(1).join(" -> ") : rawPath;
    const untracked = indexStatus === "?" && worktreeStatus === "?";
    const staged = ![" ", "?"].includes(indexStatus);
    const unstaged = ![" ", "?"].includes(worktreeStatus);

    changes.push({
      path: filePath,
      oldPath,
      status: gitChangeStatus(indexStatus, worktreeStatus),
      indexStatus,
      worktreeStatus,
      staged,
      unstaged,
      untracked
    });
  }

  return changes;
}

function gitChangeStatus(indexStatus: string, worktreeStatus: string): GitFileChange["status"] {
  const combined = `${indexStatus}${worktreeStatus}`;
  if (combined === "??") {
    return "Untracked";
  }

  if (combined.includes("U") || ["AA", "DD"].includes(combined)) {
    return "Unmerged";
  }

  if (combined.includes("R")) {
    return "Renamed";
  }

  if (combined.includes("C")) {
    return "Copied";
  }

  if (combined.includes("A")) {
    return "Added";
  }

  if (combined.includes("D")) {
    return "Deleted";
  }

  if (combined.includes("M")) {
    return "Modified";
  }

  return "Unknown";
}

function parseGitNumstatValue(value: string): number | undefined {
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

async function buildTrackedFileDiff(gitRoot: string, relativePath: string): Promise<GitDiffBuildResult> {
  const [staged, unstaged] = await Promise.all([
    runGitCommand(["diff", "--cached", "--no-ext-diff", "--", relativePath], gitRoot, gitDiffMaxBytes + 8_000),
    runGitCommand(["diff", "--no-ext-diff", "--", relativePath], gitRoot, gitDiffMaxBytes + 8_000)
  ]);
  const parts: string[] = [];
  const combinedOutput = `${staged.output}\n${unstaged.output}`;
  const commandFailed = staged.exitCode !== 0 || unstaged.exitCode !== 0;
  const binary = combinedOutput.includes("Binary files ") || combinedOutput.includes(" differ\n");

  if (staged.output.trim()) {
    parts.push("# Staged changes", staged.output.trimEnd());
  }

  if (unstaged.output.trim()) {
    parts.push("# Unstaged changes", unstaged.output.trimEnd());
  }

  if (staged.exitCode !== 0 && !staged.output.trim()) {
    parts.push(`# Staged diff failed with exit code ${staged.exitCode}.`);
  }

  if (unstaged.exitCode !== 0 && !unstaged.output.trim()) {
    parts.push(`# Unstaged diff failed with exit code ${unstaged.exitCode}.`);
  }

  const text = parts.join("\n\n");
  return {
    text,
    displayMode: binary || commandFailed || !text.trim() ? "Message" : "SideBySide",
    unavailableReason: binary
      ? "Binary"
      : commandFailed
        ? "CommandFailed"
        : text.trim()
          ? undefined
          : "NoTextualDiff",
    byteCount: Buffer.byteLength(text, "utf8"),
    lineCount: text ? text.split(/\r?\n/).length : 0
  };
}

async function buildUntrackedFileDiff(gitRoot: string, relativePath: string): Promise<GitDiffBuildResult> {
  const absolutePath = path.resolve(gitRoot, relativePath);
  assertPathInside(gitRoot, absolutePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    return {
      text: `# Untracked path is not a regular file: ${relativePath}`,
      displayMode: "Message",
      unavailableReason: "NotRegularFile",
      byteCount: fileStat.size,
      lineCount: 1
    };
  }

  const content = await readFile(absolutePath);
  if (content.includes(0)) {
    return {
      text: `# Binary untracked file preview is unavailable: ${relativePath}`,
      displayMode: "Message",
      unavailableReason: "Binary",
      byteCount: content.byteLength,
      lineCount: 1
    };
  }

  if (content.byteLength > gitDiffMaxBytes) {
    return {
      text: `# Untracked file is too large for an inline diff preview: ${relativePath}`,
      displayMode: "Message",
      unavailableReason: "TooLarge",
      byteCount: content.byteLength,
      lineCount: content.toString("utf8").split(/\r?\n/).length
    };
  }

  const text = content.toString("utf8");
  const lines = text.split(/\r?\n/);
  const previewLines = lines.slice(0, 420).map((line) => `+${line}`);
  const truncated = lines.length > previewLines.length;
  const diffText = [
    `diff --git a/${relativePath} b/${relativePath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...previewLines,
    truncated ? `# Diff preview truncated after ${previewLines.length} line(s).` : ""
  ].filter(Boolean).join("\n");
  return {
    text: diffText,
    displayMode: "SideBySide",
    byteCount: content.byteLength,
    lineCount: lines.length
  };
}

function truncateGitDiff(diff: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(diff, "utf8") <= gitDiffMaxBytes) {
    return { text: diff, truncated: false };
  }

  const buffer = Buffer.from(diff, "utf8").subarray(0, gitDiffMaxBytes);
  return {
    text: `${buffer.toString("utf8")}\n\n# Forge truncated this diff preview at ${gitDiffMaxBytes} bytes.`,
    truncated: true
  };
}

function summarizeGitFileDiff(
  relativePath: string,
  displayMode: GitFileDiff["displayMode"],
  unavailableReason: GitFileDiff["unavailableReason"],
  truncated: boolean,
  diffResult: GitDiffBuildResult
): string {
  if (displayMode === "SideBySide") {
    return `Diff for ${relativePath}${truncated ? " was truncated." : "."}`;
  }

  switch (unavailableReason) {
  case "Binary":
    return `Binary diff preview is unavailable for ${relativePath}.`;
  case "TooLarge":
    return `Diff preview is unavailable because ${relativePath} is larger than ${gitDiffMaxBytes} bytes.`;
  case "NotRegularFile":
    return `Diff preview is unavailable because ${relativePath} is not a regular file.`;
  case "CommandFailed":
    return `Diff preview command failed for ${relativePath}.`;
  case "NoTextualDiff":
    return `No textual diff is available for ${relativePath}.`;
  default:
    return diffResult.text.trim()
      ? `Diff preview for ${relativePath} is shown as a message.`
      : `No textual diff is available for ${relativePath}.`;
  }
}

function normalizeGitDiffPath(rawPath: string | null): string {
  if (!rawPath?.trim()) {
    throw new HttpError(400, "A repo-relative git diff path is required.");
  }

  if (path.isAbsolute(rawPath)) {
    throw new HttpError(400, "Git diff paths must be repo-relative.");
  }

  const normalized = path.posix.normalize(rawPath.replace(/\\/g, "/"));
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    normalized.startsWith(".git/") ||
    normalized === ".git" ||
    normalized.startsWith(".forge/") ||
    normalized === ".forge"
  ) {
    throw new HttpError(400, `Unsafe git diff path: ${rawPath}`);
  }

  return normalized;
}

function isSafeGitChange(change: GitFileChange): boolean {
  return [change.path, change.oldPath].every((candidate) => {
    if (!candidate) {
      return true;
    }

    return !(
      candidate === ".git" ||
      candidate.startsWith(".git/") ||
      candidate === ".forge" ||
      candidate.startsWith(".forge/")
    );
  });
}

function assertPathInside(root: string, absolutePath: string): void {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HttpError(400, `Path escapes git root: ${absolutePath}`);
  }
}

function runGitCommand(
  args: string[],
  cwd: string,
  maxOutputBytes = 32_000
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
    });

    let output = "";
    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > maxOutputBytes) {
        output = output.slice(output.length - maxOutputBytes);
      }
    };

    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, output });
    });
  });
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
    permissions: registry.presets.map((preset) => buildValidationPermission(task, preset)),
    taskCommands: buildTaskCommandPermissions(task, registry.presets)
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
    : preset.requiresApproval && !approval
      ? "NeedsApproval"
      : task.editProposal?.status !== "Applied"
        ? "Blocked"
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
    canApprove: preset.requiresApproval && !approval,
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

function buildTaskCommandPermissions(
  task: ForgeTask,
  presets: InternalValidationPreset[]
): TaskCommandPermission[] {
  const byCommandID = new Map<string, TaskCommandPermission>();

  for (const preset of presets) {
    for (const command of preset.commands) {
      if (command.kind !== "ProjectCommand") {
        continue;
      }

      const permission = buildTaskCommandPermission(task, preset, command);
      const existing = byCommandID.get(command.id);
      if (!existing || compareTaskCommandPermissionPriority(permission, existing) < 0) {
        byCommandID.set(command.id, permission);
      }
    }
  }

  return [...byCommandID.values()].sort(compareTaskCommandPermissionDisplay);
}

function buildTaskCommandPermission(
  task: ForgeTask,
  preset: InternalValidationPreset,
  command: InternalValidationCommand
): TaskCommandPermission {
  const approval = findValidationPresetApproval(task, preset.id);
  const approvalState: TaskCommandPermission["approvalState"] = !preset.requiresApproval
    ? "NotRequired"
    : approval
      ? "Approved"
      : "NeedsApproval";
  const blockedReasons: string[] = [];

  if (hasRunningTaskCommandRun(task)) {
    blockedReasons.push("Another task command is already active.");
  }

  if (hasRunningValidationRun(task)) {
    blockedReasons.push("A validation run is already active.");
  }

  if (preset.requiresApproval && !approval) {
    blockedReasons.push("Preset requires task-level approval before execution.");
  }

  const executionState: TaskCommandPermission["executionState"] = hasRunningTaskCommandRun(task) || hasRunningValidationRun(task)
    ? "Running"
    : preset.requiresApproval && !approval
      ? "NeedsApproval"
      : "Ready";

  return {
    command: stripInternalCommandFields(command),
    presetID: preset.id,
    presetName: preset.name,
    presetSource: preset.source,
    presetRiskLevel: preset.riskLevel,
    approvalState,
    executionState,
    canRun: executionState === "Ready",
    blockedReasons,
    approval: approval
      ? {
          id: approval.id,
          decidedAt: approval.decidedAt,
          summary: approval.summary
        }
      : undefined,
    lastRun: findLastTaskCommandRun(task, command.id)
  };
}

function compareTaskCommandPermissionPriority(
  left: TaskCommandPermission,
  right: TaskCommandPermission
): number {
  const leftRank = taskCommandPermissionRank(left);
  const rightRank = taskCommandPermissionRank(right);
  if (leftRank !== rightRank) {
    return rightRank - leftRank;
  }

  return left.presetName.localeCompare(right.presetName);
}

function compareTaskCommandPermissionDisplay(
  left: TaskCommandPermission,
  right: TaskCommandPermission
): number {
  if (left.canRun !== right.canRun) {
    return left.canRun ? -1 : 1;
  }

  const riskOrder = new Map([
    ["Low", 0],
    ["Medium", 1],
    ["High", 2]
  ]);
  const riskDiff = (riskOrder.get(left.command.riskLevel) ?? 99) - (riskOrder.get(right.command.riskLevel) ?? 99);
  if (riskDiff !== 0) {
    return riskDiff;
  }

  return left.command.name.localeCompare(right.command.name);
}

function taskCommandPermissionRank(permission: TaskCommandPermission): number {
  if (permission.canRun) {
    return 4;
  }

  if (permission.approvalState === "Approved" || permission.approvalState === "NotRequired") {
    return 3;
  }

  if (permission.executionState === "NeedsApproval") {
    return 2;
  }

  return 1;
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
    taskCommandRuns: [],
    validationRuns: [],
    validationRepairBriefs: [],
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

  await buildProviderGuidedPlanContext(task, sourceMessage);

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

async function buildProviderGuidedPlanContext(
  task: ForgeTask,
  sourceMessage?: TaskMessage
): Promise<void> {
  if (!modelProvider.createPlanContextRequest) {
    return;
  }

  setAgent(task, "Planner", "Active", `Asking ${modelProvider.info.name} which repo context to inspect.`);
  upsertPlanStep(task, {
    id: "build-model-guided-context",
    title: "Build model-guided context",
    status: "Active",
    summary: `The model provider can request up to ${modelGuidedContextMaxRounds} bounded read-only context round(s).`
  });

  let projectFiles: string[] | undefined;
  const executedSearchKeys = new Set<string>();
  const inspectedPaths = new Set(task.contextFiles.map((file) => file.path));
  const roundSummaries: string[] = [];
  let stopReason = "Reached the bounded context round limit.";

  for (let round = 1; round <= modelGuidedContextMaxRounds; round += 1) {
    const requestStarted = event(
      "model.context_request.started",
      `Model provider is selecting bounded read-only repository context (round ${round}/${modelGuidedContextMaxRounds}).`
    );
    requestStarted.createdAt = new Date().toISOString();
    saveAndBroadcast(task, requestStarted);

    const contextRequest = await modelProvider.createPlanContextRequest({
      task,
      sourceMessage,
      round,
      maxRounds: modelGuidedContextMaxRounds
    });

    if (contextRequest.status === "ReadyForPlan") {
      stopReason = `Provider reported enough context: ${contextRequest.rationale}`;
      roundSummaries.push(`Round ${round}: ready for plan.`);
      break;
    }

    if (!projectFiles) {
      projectFiles = await runTool(
        task,
        "list_repo_files",
        "Model-guided bounded repo scan excluding private and generated directories",
        listRepositoryFiles
      );
    }

    const searchTerms = normalizeProviderSearchTerms(contextRequest, task);
    const requestedReadPaths = normalizeProviderReadPaths(contextRequest.readPaths, projectFiles);
    const searchKey = searchTerms.join("\0");
    const hasNewSearch = !executedSearchKeys.has(searchKey);
    const newReadPaths = requestedReadPaths.filter((readPath) => !inspectedPaths.has(readPath));

    if (!hasNewSearch && newReadPaths.length === 0) {
      stopReason = `Provider repeated context that was already inspected: ${contextRequest.rationale}`;
      roundSummaries.push(`Round ${round}: stopped because no new safe context was requested.`);
      break;
    }

    executedSearchKeys.add(searchKey);
    const contextMatches = await runTool(
      task,
      "search_repo_context",
      searchTerms.join(", "),
      () => searchRepositoryContext(
        projectFiles as string[],
        searchTerms,
        [...explicitContextPathsForTask(task), ...requestedReadPaths]
      )
    );
    const contextFiles = await buildContextFiles(task, projectFiles, contextMatches, requestedReadPaths);
    task.contextFiles = mergeContextFiles(task.contextFiles, contextFiles);
    for (const contextFile of contextFiles) {
      inspectedPaths.add(contextFile.path);
    }

    const roundSummary = [
      `Round ${round}: ${contextRequest.rationale}`,
      `Search: ${searchTerms.join(", ")}`,
      requestedReadPaths.length > 0 ? `Requested reads: ${requestedReadPaths.join(", ")}` : undefined,
      `Stored ${task.contextFiles.length} context file(s).`
    ].filter(Boolean).join(" ");
    roundSummaries.push(roundSummary);

    const completed = event(
      "model.context_request.completed",
      `Model-guided context round ${round} inspected ${contextFiles.length} file(s).`
    );
    completed.createdAt = new Date().toISOString();
    saveAndBroadcast(task, completed);
  }

  setAgent(task, "Planner", "Active", `Inspected ${task.contextFiles.length} model-guided context file(s).`);
  upsertPlanStep(task, {
    id: "build-model-guided-context",
    title: "Build model-guided context",
    status: "Done",
    summary: [stopReason, ...roundSummaries].join(" ").slice(0, 500)
  });

  const loopCompleted = event(
    "model.context_loop.completed",
    `Model-guided context loop completed before plan revision: ${stopReason.slice(0, 180)}`
  );
  loopCompleted.createdAt = new Date().toISOString();
  saveAndBroadcast(task, loopCompleted);
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

  const executionContext = await prepareExecutionContext(task);
  const proposal = await modelProvider.createExecutionProposal({ task });
  proposal.contextFiles = executionContext.contextFiles;
  proposal.toolEvidence = executionContext.toolEvidence;
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

async function prepareExecutionContext(
  task: ForgeTask
): Promise<{ contextFiles: ContextFile[]; toolEvidence: string[] }> {
  upsertPlanStep(task, {
    id: "build-execution-context",
    title: "Build execution context",
    status: "Active",
    summary: "Running bounded read-only repository tools before drafting the execution proposal."
  });
  setAgent(task, "Coder", "Active", "Gathering execution context through read-only repository tools.");

  const started = event(
    "agent.execution_context.started",
    "Preparing execution proposal context with bounded read-only repository tools."
  );
  started.createdAt = new Date().toISOString();
  saveAndBroadcast(task, started);

  const projectFiles = await runTool(
    task,
    "list_repo_files",
    "Execution proposal bounded repo scan excluding private and generated directories",
    listRepositoryFiles
  );
  const searchTerms = deriveExecutionSearchTerms(task);
  const contextMatches = await runTool(
    task,
    "search_repo_context",
    searchTerms.join(", "),
    () => searchRepositoryContext(projectFiles, searchTerms, explicitContextPathsForTask(task))
  );
  const contextFiles = await buildContextFiles(task, projectFiles, contextMatches);
  task.contextFiles = mergeContextFiles(task.contextFiles, contextFiles);

  const toolEvidence = [
    `Scanned ${projectFiles.length} repo file(s).`,
    `Searched for ${searchTerms.slice(0, 8).join(", ")}.`,
    `Read ${contextFiles.length} execution context file(s).`
  ];

  upsertPlanStep(task, {
    id: "build-execution-context",
    title: "Build execution context",
    status: "Done",
    summary: `Prepared execution proposal context from ${contextFiles.length} read-only file(s): ${formatPathList(contextFiles.map((file) => file.path))}.`
  });

  const completed = event(
    "agent.execution_context.completed",
    `Execution context prepared from ${contextFiles.length} read-only file(s).`
  );
  completed.createdAt = new Date().toISOString();
  saveAndBroadcast(task, completed);

  return {
    contextFiles,
    toolEvidence
  };
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

async function generateValidationRepairProposal(taskID: string): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (!task.executionProposal) {
    throw new HttpError(409, "An execution proposal is required before generating validation repair proposals.");
  }

  if (task.editProposal?.status === "Proposed") {
    throw new HttpError(409, "This task already has a proposed edit awaiting review.");
  }

  const repairSource = latestRepairProposalSource(task);
  if (!repairSource) {
    throw new HttpError(409, "A failed validation run or task command repair brief is required before generating a repair proposal.");
  }

  if (repairSource.kind === "ValidationRun" && task.editProposal?.status !== "Applied") {
    throw new HttpError(409, "An applied edit proposal is required before generating a validation repair proposal.");
  }

  const previousProposal = task.editProposal?.status === "Applied" ? task.editProposal : undefined;
  return createEditProposalForTask(task, "ValidationRepair", previousProposal, {
    validationRepairBrief: repairSource.brief,
    preserveChangedFiles: Boolean(previousProposal)
  });
}

async function createEditProposalForTask(
  task: ForgeTask,
  mode: "Initial" | "Revision" | "ValidationRepair",
  previousProposal?: EditProposal,
  options: {
    validationRepairBrief?: ValidationRepairBrief;
    preserveChangedFiles?: boolean;
  } = {}
): Promise<ForgeTask> {
  const isRevision = mode === "Revision";
  const isValidationRepair = mode === "ValidationRepair";
  const sourceMessage = latestTaskMessage(task, "User");
  const revisionNumber = previousProposal ? (previousProposal.revisionNumber ?? 1) + 1 : 1;
  const stepID = isValidationRepair
    ? "generate-validation-repair-proposal"
    : isRevision
      ? "revise-edit-proposal"
      : "generate-safe-edit-proposal";
  const stepTitle = isValidationRepair
    ? "Generate validation repair proposal"
    : isRevision
      ? "Revise edit proposal"
      : "Generate safe edit proposal";

  task.status = "Running";
  task.currentPhase = isValidationRepair
    ? "Validation Repair Proposal Generation"
    : isRevision
      ? "Edit Proposal Revision"
      : "Edit Proposal Generation";
  task.reviewSummary = isValidationRepair
    ? "Generating a follow-up repair proposal from the validation repair brief. No files will be changed."
    : isRevision
      ? "Revising the rejected edit proposal from the latest task conversation. No files will be changed."
      : "Generating a safe edit proposal. No files will be changed.";
  setAgent(
    task,
    "Coder",
    "Active",
    isValidationRepair
      ? `Generating a validation repair proposal with ${modelProvider.info.name}.`
      : isRevision
      ? `Revising a safe edit proposal with ${modelProvider.info.name}.`
      : `Generating a safe edit proposal with ${modelProvider.info.name}.`
  );
  setAgent(task, "Reviewer", "Idle", "Waiting for a proposed diff to review.");
  upsertPlanStep(task, {
    id: stepID,
    title: stepTitle,
    status: "Active",
    summary: isValidationRepair
      ? "Using the validation repair brief to draft a follow-up proposal without touching files."
      : isRevision
      ? "Using the latest task conversation to revise the rejected proposal without touching files."
      : "Drafting a proposed diff without touching the working tree."
  });

  const started = event(
    isValidationRepair
      ? "edit.proposal.validation_repair.started"
      : isRevision ? "edit.proposal.revision.started" : "edit.proposal.started",
    isValidationRepair
      ? "Generating a validation repair proposal without applying file changes."
      : isRevision
      ? "Revising a rejected edit proposal without applying file changes."
      : "Generating a safe edit proposal without applying file changes."
  );
  started.createdAt = new Date().toISOString();
  saveAndBroadcast(task, started);

  const proposalResult = await createValidatedEditProposalWithRepair({
    task,
    previousProposal,
    sourceMessage,
    revisionNumber,
    validationRepairBrief: options.validationRepairBrief
  });
  const { proposal, repairAttempts } = proposalResult;
  const validation = proposal.validation;
  if (!validation) {
    throw new Error("Generated edit proposal is missing runtime validation.");
  }
  if (previousProposal) {
    archiveEditProposalRevision(task, previousProposal);
  }
  task.editProposal = proposal;
  task.status = "Human Review";
  task.currentPhase =
    validation.status === "Ready" ? "Edit Proposal Review" : "Edit Proposal Validation Blocked";
  if (!options.preserveChangedFiles) {
    task.changedFiles = [];
  }
  task.reviewSummary =
    validation.status === "Ready"
      ? "Edit proposal ready and validated for review. No file changes have been applied."
      : validation.summary;
  setAgent(
    task,
    "Coder",
    validation.status === "Ready" ? "Done" : "Blocked",
    validation.status === "Ready"
      ? "Prepared a proposed diff without modifying files."
      : "Could not repair the proposal into an apply-ready shape."
  );
  setAgent(
    task,
    "Reviewer",
    validation.status === "Ready" ? "Active" : "Blocked",
    validation.status === "Ready"
      ? "Review the proposed file changes and validation result before applying."
      : "Review failed proposal validation checks before requesting another revision."
  );
  upsertPlanStep(task, {
    id: stepID,
    title: stepTitle,
    status: "Done",
    summary: isValidationRepair
      ? `Proposed validation repair revision ${proposal.revisionNumber} from repair brief ${options.validationRepairBrief?.id ?? "unknown"} with ${proposal.fileChanges.length} file change(s). ${repairSummary(repairAttempts)} No files changed.`
      : isRevision
      ? `Proposed revision ${proposal.revisionNumber} with ${proposal.fileChanges.length} file change(s). ${repairSummary(repairAttempts)} No files changed.`
      : `Proposed ${proposal.fileChanges.length} file change(s). ${repairSummary(repairAttempts)} No files changed.`
  });
  upsertPlanStep(task, {
    id: "validate-edit-proposal",
    title: "Validate edit proposal",
    status: validation.status === "Ready" ? "Done" : "Blocked",
    summary: validation.summary
  });
  if (repairAttempts > 0) {
    upsertPlanStep(task, {
      id: "repair-edit-proposal",
      title: "Repair edit proposal",
      status: validation.status === "Ready" ? "Done" : "Blocked",
      summary: validation.status === "Ready"
        ? `Used validation feedback to repair the proposal after ${repairAttempts} attempt(s).`
        : `Stopped after ${repairAttempts} automatic repair attempt(s): ${validation.summary}`
    });
  }
  upsertPlanStep(task, {
    id: "review-edit-proposal",
    title: "Review edit proposal",
    status: validation.status === "Ready" ? "Active" : "Blocked",
    summary: validation.status === "Ready"
      ? "Human review required before applying proposed file changes."
      : "Proposal is blocked; request changes before applying."
  });

  const ready = event(
    validation.status === "Ready"
      ? isValidationRepair
        ? "edit.proposal.validation_repair.ready"
        : isRevision ? "edit.proposal.revision.ready" : "edit.proposal.ready"
      : "edit.proposal.validation.blocked",
    validation.status === "Ready"
      ? isValidationRepair
        ? "Validation repair proposal is validated and ready for human review. No files changed."
        : isRevision
        ? "Revised edit proposal is validated and ready for human review. No files changed."
        : "Safe edit proposal is validated and ready for human review. No files changed."
      : validation.summary
  );
  ready.createdAt = proposal.generatedAt;
  saveAndBroadcast(task, ready);
  return task;
}

interface EditProposalGenerationOptions {
  task: ForgeTask;
  previousProposal?: EditProposal;
  sourceMessage?: TaskMessage;
  revisionNumber: number;
  validationRepairBrief?: ValidationRepairBrief;
}

interface EditProposalGenerationResult {
  proposal: EditProposal;
  repairAttempts: number;
}

async function createValidatedEditProposalWithRepair(
  options: EditProposalGenerationOptions
): Promise<EditProposalGenerationResult> {
  let previousProposal = options.previousProposal;
  let validationFeedback: EditProposalValidation | undefined;
  let revisionNumber = options.revisionNumber;
  let repairAttempts = 0;

  while (true) {
    const proposal = await modelProvider.createEditProposal({
      task: options.task,
      previousProposal,
      sourceMessage: options.sourceMessage,
      revisionNumber,
      repairAttempt: repairAttempts,
      validationFeedback,
      validationRepairBrief: options.validationRepairBrief
    });
    if (options.validationRepairBrief && !proposal.validationRepairBriefID) {
      proposal.validationRepairBriefID = options.validationRepairBrief.id;
    }
    proposal.validation = await buildEditProposalValidation(proposal.fileChanges);

    if (proposal.validation.status === "Ready" || repairAttempts >= editProposalRepairMaxAttempts) {
      return { proposal, repairAttempts };
    }

    const nextAttempt = repairAttempts + 1;
    const repairStarted = event(
      "edit.proposal.repair.started",
      `Proposal revision ${proposal.revisionNumber} failed validation; requesting repair ${nextAttempt}/${editProposalRepairMaxAttempts}. ${proposal.validation.summary}`
    );
    repairStarted.createdAt = proposal.validation.checkedAt;
    saveAndBroadcast(options.task, repairStarted);

    proposal.status = "Superseded";
    proposal.decidedAt = new Date().toISOString();
    proposal.decisionNote = `Superseded by automatic repair attempt ${nextAttempt}/${editProposalRepairMaxAttempts}.`;
    archiveEditProposalRevision(options.task, proposal);

    previousProposal = proposal;
    validationFeedback = proposal.validation;
    revisionNumber = proposal.revisionNumber + 1;
    repairAttempts = nextAttempt;

    upsertPlanStep(options.task, {
      id: "repair-edit-proposal",
      title: "Repair edit proposal",
      status: "Active",
      summary: `Using runtime validation feedback to request repair ${repairAttempts}/${editProposalRepairMaxAttempts}.`
    });
  }
}

function repairSummary(repairAttempts: number): string {
  if (repairAttempts === 0) {
    return "No automatic repair was needed.";
  }

  return `Automatic repair attempts: ${repairAttempts}.`;
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
    const appliedFileChanges: AppliedFileChange[] = [];
    for (const change of task.editProposal.fileChanges) {
      const appliedChange = await applyProposedFileChange(task.editProposal.id, change);
      appliedFileChanges.push(appliedChange);
    }

    const now = new Date().toISOString();
    task.editProposal.status = "Applied";
    task.editProposal.decidedAt = now;
    task.editProposal.decisionNote = input.note?.trim() || undefined;
    task.editProposal.appliedFileChanges = appliedFileChanges;
    task.status = "Testing";
    task.currentPhase = "Awaiting Validation";
    task.changedFiles = [...new Set(appliedFileChanges.map((change) => change.path))];
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

async function rollbackEditProposal(
  taskID: string,
  input: EditProposalDecisionRequest
): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status !== "Applied") {
    throw new HttpError(409, "An applied edit proposal is required before rollback.");
  }

  const appliedFileChanges = task.editProposal.appliedFileChanges ?? [];
  if (appliedFileChanges.length === 0) {
    throw new HttpError(409, "Applied proposal does not include rollback metadata.");
  }

  task.status = "Running";
  task.currentPhase = "Rolling Back Edit Proposal";
  task.reviewSummary = "Rolling back the applied edit proposal after verifying current file hashes.";
  setAgent(task, "Coder", "Active", "Rolling back the applied edit proposal.");
  setAgent(task, "Reviewer", "Active", "Watching the guarded rollback step.");
  upsertPlanStep(task, {
    id: "rollback-edit-proposal",
    title: "Rollback edit proposal",
    status: "Active",
    summary: "Verifying apply hashes and restoring rollback snapshots."
  });

  const started = event("edit.proposal.rollback.started", "Rolling back applied edit proposal.");
  started.createdAt = new Date().toISOString();
  saveAndBroadcast(task, started);

  try {
    const rollbackOperations = [];
    for (const appliedChange of appliedFileChanges) {
      rollbackOperations.push(await prepareAppliedFileRollback(appliedChange));
    }

    for (const operation of rollbackOperations) {
      await operation.rollback();
    }

    const now = new Date().toISOString();
    for (const appliedChange of appliedFileChanges) {
      appliedChange.rolledBackAt = now;
    }

    const rolledBackFiles = [...new Set(rollbackOperations.map((operation) => operation.relativePath))];
    task.editProposal.status = "RolledBack";
    task.editProposal.rolledBackAt = now;
    task.editProposal.rollbackNote = input.note?.trim() || undefined;
    task.status = "Human Review";
    task.currentPhase = "Rollback Applied";
    task.changedFiles = rolledBackFiles;
    task.approvals.push({
      id: randomUUID(),
      action: "Rollback Edit Proposal",
      decision: "Approved",
      summary: `Rolled back ${rolledBackFiles.length} applied file change(s).`,
      targetID: task.editProposal.id,
      decidedAt: now,
      userNote: input.note?.trim() || undefined
    });
    task.reviewSummary = `Rollback applied for ${rolledBackFiles.join(", ")}. Review the working tree before continuing.`;
    setAgent(task, "Coder", "Done", "Rolled back the applied edit proposal.");
    setAgent(task, "Tester", "Idle", "Waiting for a validation request after rollback.");
    setAgent(task, "Reviewer", "Active", "Review the rolled-back working tree.");
    upsertPlanStep(task, {
      id: "rollback-edit-proposal",
      title: "Rollback edit proposal",
      status: "Done",
      summary: `Rolled back ${rolledBackFiles.join(", ")}.`
    });

    const rolledBack = event("edit.proposal.rolled_back", "Applied edit proposal was rolled back.");
    rolledBack.createdAt = now;
    saveAndBroadcast(task, rolledBack);
    return task;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    task.status = "Failed";
    task.currentPhase = "Rollback Failed";
    task.reviewSummary = message;
    setAgent(task, "Coder", "Blocked", "Could not roll back the applied edit proposal.");
    setAgent(task, "Reviewer", "Active", "Review the rollback failure before retrying.");
    upsertPlanStep(task, {
      id: "rollback-edit-proposal",
      title: "Rollback edit proposal",
      status: "Blocked",
      summary: message
    });

    const failed = event("edit.proposal.rollback.failed", message);
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

async function runTaskCommand(taskID: string, input: RunTaskCommandRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const commandID = input.commandID?.trim();
  if (!commandID) {
    throw new HttpError(400, "Task command requires a commandID.");
  }

  const command = validationCommandCatalog.get(commandID);
  if (!command) {
    throw new HttpError(404, `Task command not found: ${commandID}`);
  }

  if (hasRunningTaskCommandRun(task)) {
    throw new HttpError(409, "Another task command is already active.");
  }

  if (hasRunningValidationRun(task)) {
    throw new HttpError(409, "A validation run is already active.");
  }

  const preset = await findTaskCommandExecutionPreset(task, command);
  if (command.kind === "ProjectCommand") {
    resolvePresetCommandCwd(command.cwd);
  }

  const startedAt = new Date().toISOString();
  const commandRun: TaskCommandRun = {
    id: randomUUID(),
    commandID: command.id,
    name: command.name,
    command: command.command,
    kind: command.kind,
    riskLevel: command.riskLevel,
    cwd: command.cwd,
    presetID: preset.id,
    presetName: preset.name,
    status: "Running",
    outputSummary: "Running",
    outputChunks: [],
    startedAt
  };

  task.taskCommandRuns.push(commandRun);
  task.status = "Testing";
  task.currentPhase = "Command Running";
  task.reviewSummary = `Running task command: ${command.name}.`;
  setAgent(task, "Tester", "Active", `Running ${command.command}.`);
  setAgent(task, "Reviewer", "Idle", "Waiting for command output.");
  upsertPlanStep(task, {
    id: `run-task-command-${command.id}`,
    title: "Run task command",
    status: "Active",
    summary: `Running ${command.name} through approved preset ${preset.name}.`
  });

  const started = event("task.command.started", `Task command started: ${command.name}.`);
  started.createdAt = startedAt;
  saveAndBroadcast(task, started);

  try {
    const output = command.kind === "BuiltIn"
      ? await runBuiltInTaskCommand(command, task, commandRun)
      : await runProjectTaskCommand(command, task, commandRun);
    commandRun.exitCode = output.exitCode;
    commandRun.outputSummary = output.outputSummary;
    commandRun.status = output.cancelled ? "Cancelled" : output.exitCode === 0 ? "Passed" : "Failed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    commandRun.status = "Failed";
    commandRun.outputSummary = message;
    appendTaskCommandOutputChunk(task, commandRun, "system", `${message}\n`);
  }

  const endedAt = new Date().toISOString();
  commandRun.endedAt = endedAt;
  const passed = commandRun.status === "Passed";
  const cancelled = commandRun.status === "Cancelled";
  task.status = passed || cancelled ? "Human Review" : "Failed";
  task.currentPhase = passed ? "Command Passed" : cancelled ? "Command Cancelled" : "Command Failed";
  task.reviewSummary = commandRun.outputSummary;
  setAgent(
    task,
    "Tester",
    passed ? "Done" : "Blocked",
    passed ? `${command.name} passed.` : cancelled ? `${command.name} was cancelled.` : `${command.name} failed.`
  );
  setAgent(
    task,
    "Reviewer",
    "Active",
    passed
      ? "Command output is ready for review."
      : cancelled
        ? "Command was cancelled; review output before rerunning."
        : "Review failed command output before continuing."
  );
  upsertPlanStep(task, {
    id: `run-task-command-${command.id}`,
    title: "Run task command",
    status: passed ? "Done" : "Blocked",
    summary: commandRun.outputSummary
  });

  const finished = event(
    passed ? "task.command.passed" : cancelled ? "task.command.cancelled" : "task.command.failed",
    passed
      ? `Task command passed: ${command.name}.`
      : cancelled
        ? `Task command cancelled: ${command.name}.`
        : `Task command failed: ${command.name}.`
  );
  finished.createdAt = endedAt;
  saveAndBroadcast(task, finished);
  emit("task.command.completed", {
    taskID: task.id,
    taskCommandRunID: commandRun.id,
    commandRun,
    task
  });
  if (!passed && !cancelled) {
    await createValidationRepairBriefForTaskCommandRun(task, commandRun);
  }
  return task;
}

async function cancelTaskCommand(taskID: string, input: CancelTaskCommandRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const requestedRunID = input.taskCommandRunID?.trim();
  const commandRun = requestedRunID
    ? task.taskCommandRuns.find((run) => run.id === requestedRunID)
    : [...task.taskCommandRuns].reverse().find((run) => run.status === "Running");
  if (!commandRun) {
    throw new HttpError(404, requestedRunID ? `Task command run not found: ${requestedRunID}` : "No task command run found.");
  }

  if (commandRun.status !== "Running") {
    throw new HttpError(409, `Task command is not running: ${commandRun.status}.`);
  }

  const active = activeTaskCommands.get(commandRun.id);
  if (!active || active.taskID !== task.id) {
    throw new HttpError(409, "Task command is not cancellable by this runtime process.");
  }

  if (active.cancelled) {
    return task;
  }

  const now = new Date().toISOString();
  const note = input.note?.trim();
  active.cancelled = true;
  active.cancelledAt = now;
  active.cancellationNote = note || undefined;

  commandRun.outputSummary = "Cancellation requested. Waiting for process to exit.";
  task.status = "Testing";
  task.currentPhase = "Command Cancelling";
  task.reviewSummary = `Stopping task command: ${commandRun.name}.`;
  setAgent(task, "Tester", "Active", `Stopping ${commandRun.command}.`);
  setAgent(task, "Reviewer", "Idle", "Waiting for command to stop.");
  upsertPlanStep(task, {
    id: `run-task-command-${commandRun.commandID}`,
    title: "Run task command",
    status: "Active",
    summary: "Cancellation requested; waiting for the process to exit."
  });

  appendTaskCommandOutputChunk(task, commandRun, "system", "Cancellation requested by user. Sending SIGTERM.\n");
  active.cancelTimeout = setTimeout(() => {
    appendTaskCommandOutputChunk(
      task,
      commandRun,
      "system",
      `Command did not stop after ${taskCommandCancellationGraceMs / 1000}s. Sending SIGKILL.\n`
    );
    active.child.kill("SIGKILL");
  }, taskCommandCancellationGraceMs);
  const signalSent = active.child.kill("SIGTERM");
  if (!signalSent) {
    appendTaskCommandOutputChunk(task, commandRun, "system", "Process was already exiting when cancellation was requested.\n");
  }

  task.approvals.push({
    id: randomUUID(),
    action: "Cancel Task Command",
    decision: "Approved",
    summary: `Cancel requested for task command: ${commandRun.name}.`,
    decidedAt: now,
    targetID: commandRun.id,
    userNote: note || undefined
  });

  const requested = event("task.command.cancel.requested", `Task command cancellation requested: ${commandRun.name}.`);
  requested.createdAt = now;
  saveAndBroadcast(task, requested);
  return task;
}

async function findTaskCommandExecutionPreset(
  task: ForgeTask,
  command: InternalValidationCommand
): Promise<InternalValidationPreset> {
  const registry = await loadValidationPresetRegistry();
  const matchingPresets = registry.presets.filter((preset) =>
    preset.commands.some((candidate) => candidate.id === command.id)
  );

  const noApprovalPreset = matchingPresets.find((preset) => !preset.requiresApproval);
  if (noApprovalPreset) {
    return noApprovalPreset;
  }

  const approvedPreset = matchingPresets.find((preset) => hasValidationPresetApproval(task, preset.id));
  if (approvedPreset) {
    return approvedPreset;
  }

  if (matchingPresets.length === 0) {
    throw new HttpError(409, `Task command is not exposed through a validation preset: ${command.id}`);
  }

  const presetNames = matchingPresets.map((preset) => preset.name).join(", ");
  throw new HttpError(409, `Task command requires approval through one of these presets before execution: ${presetNames}`);
}

async function runBuiltInTaskCommand(
  command: InternalValidationCommand,
  task: ForgeTask,
  commandRun: TaskCommandRun
): Promise<TaskCommandExecutionResult> {
  const outputSummary = await runBuiltInValidationCommand(command, task);
  appendTaskCommandOutputChunk(task, commandRun, "system", `${outputSummary.outputSummary}\n`);
  return {
    outputSummary: outputSummary.outputSummary,
    exitCode: outputSummary.exitCode ?? 0
  };
}

async function runProjectTaskCommand(
  command: InternalValidationCommand,
  task: ForgeTask,
  commandRun: TaskCommandRun
): Promise<TaskCommandExecutionResult> {
  if (!command.executable || !command.args) {
    throw new Error(`Project task command is missing executable metadata: ${command.command}`);
  }

  const cwd = resolvePresetCommandCwd(command.cwd);
  const result = await runSpawnedTaskCommand(command, cwd, task, commandRun);
  return {
    outputSummary: result.cancelled
      ? `${command.command} cancelled by user.`
      : summarizeCommandOutput(command.command, result.exitCode, result.output),
    exitCode: result.exitCode,
    cancelled: result.cancelled
  };
}

function runSpawnedTaskCommand(
  command: InternalValidationCommand,
  cwd: string,
  task: ForgeTask,
  commandRun: TaskCommandRun
): Promise<SpawnedTaskCommandResult> {
  const executable = command.executable;
  const args = command.args;
  if (!executable || !args) {
    return Promise.reject(new Error(`Task command is missing executable metadata: ${command.command}`));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      env: { ...process.env, CI: "1" }
    });
    const active: ActiveTaskCommand = {
      taskID: task.id,
      taskCommandRunID: commandRun.id,
      child,
      cancelled: false
    };
    activeTaskCommands.set(commandRun.id, active);

    let output = "";
    let timedOut = false;
    let timeoutMessage = "";
    let settled = false;
    const appendOutput = (stream: TaskCommandOutputChunk["stream"], chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      if (output.length > 12_000) {
        output = output.slice(output.length - 12_000);
      }
      appendTaskCommandOutputChunk(task, commandRun, stream, text);
    };

    const timeout = setTimeout(() => {
      timeoutMessage = `Command timed out after ${validationCommandTimeoutMs / 1000}s.\n`;
      timedOut = true;
      child.kill("SIGTERM");
      appendTaskCommandOutputChunk(task, commandRun, "system", timeoutMessage);
    }, validationCommandTimeoutMs);
    active.timeout = timeout;

    const clearActiveCommand = () => {
      clearTimeout(timeout);
      if (active.cancelTimeout) {
        clearTimeout(active.cancelTimeout);
      }
      activeTaskCommands.delete(commandRun.id);
    };

    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.on("error", (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearActiveCommand();
      reject(error);
    });
    child.on("close", (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearActiveCommand();
      const cancelled = active.cancelled;
      resolve({
        exitCode: cancelled ? 130 : timedOut ? 124 : code ?? 1,
        output: cancelled ? output : timedOut ? `${output}${timeoutMessage}` : output,
        timedOut,
        cancelled
      });
    });
  });
}

function appendTaskCommandOutputChunk(
  task: ForgeTask,
  commandRun: TaskCommandRun,
  stream: TaskCommandOutputChunk["stream"],
  text: string
): void {
  if (!text) {
    return;
  }

  const createdAt = new Date().toISOString();
  const chunk: TaskCommandOutputChunk = {
    id: randomUUID(),
    stream,
    text: text.length > taskCommandChunkTextLimit ? text.slice(text.length - taskCommandChunkTextLimit) : text,
    createdAt
  };

  commandRun.outputChunks.push(chunk);
  trimTaskCommandOutputChunks(commandRun);
  task.updatedAt = createdAt;
  tasks.set(task.id, task);
  saveTask(task);
  emit("task.command.output", {
    taskID: task.id,
    taskCommandRunID: commandRun.id,
    chunk,
    task
  });
  emit("task.updated", { taskID: task.id, task });
}

function trimTaskCommandOutputChunks(commandRun: TaskCommandRun): void {
  while (commandRun.outputChunks.length > taskCommandOutputChunkLimit) {
    commandRun.outputChunks.shift();
  }

  let totalLength = commandRun.outputChunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  while (totalLength > taskCommandOutputTextLimit && commandRun.outputChunks.length > 1) {
    const removed = commandRun.outputChunks.shift();
    totalLength -= removed?.text.length ?? 0;
  }

  if (totalLength > taskCommandOutputTextLimit) {
    const onlyChunk = commandRun.outputChunks[0];
    if (onlyChunk) {
      onlyChunk.text = onlyChunk.text.slice(onlyChunk.text.length - taskCommandOutputTextLimit);
    }
  }
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
  if (validationRun.status === "Failed") {
    await createValidationRepairBriefForRun(task, validationRun);
  }
  return task;
}

async function createValidationRepairBriefForRun(
  task: ForgeTask,
  validationRun: ValidationRun
): Promise<void> {
  const startedAt = new Date().toISOString();
  upsertPlanStep(task, {
    id: "analyze-validation-failure",
    title: "Analyze validation failure",
    status: "Active",
    summary: `Asking ${modelProvider.info.name} for a repair brief from failed validation output.`
  });

  const started = event(
    "validation.repair_brief.started",
    `Generating repair brief for failed validation run: ${validationRun.presetName}.`
  );
  started.createdAt = startedAt;
  saveAndBroadcast(task, started);

  try {
    const brief = await modelProvider.createValidationRepairBrief({ task, validationRun });
    task.validationRepairBriefs.push(brief);
    task.reviewSummary = `${validationRun.summary} Repair brief: ${brief.summary}`;
    setAgent(task, "Planner", "Done", "Prepared a repair brief from validation failure output.");
    setAgent(task, "Coder", "Ready", "Ready to turn the repair brief into a revised proposal after human review.");
    setAgent(task, "Reviewer", "Active", "Review the validation failure and repair brief before continuing.");
    upsertPlanStep(task, {
      id: "analyze-validation-failure",
      title: "Analyze validation failure",
      status: "Done",
      summary: brief.summary
    });
    upsertPlanStep(task, {
      id: "plan-validation-repair",
      title: "Plan validation repair",
      status: "Active",
      summary: brief.followUpPrompt
    });

    const ready = event("validation.repair_brief.ready", brief.summary);
    ready.createdAt = brief.generatedAt;
    saveAndBroadcast(task, ready);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    upsertPlanStep(task, {
      id: "analyze-validation-failure",
      title: "Analyze validation failure",
      status: "Blocked",
      summary: message
    });

    const failed = event("validation.repair_brief.failed", message);
    failed.createdAt = new Date().toISOString();
    saveAndBroadcast(task, failed);
  }
}

async function createValidationRepairBriefForTaskCommandRun(
  task: ForgeTask,
  taskCommandRun: TaskCommandRun
): Promise<void> {
  const startedAt = new Date().toISOString();
  upsertPlanStep(task, {
    id: "analyze-task-command-failure",
    title: "Analyze command failure",
    status: "Active",
    summary: `Asking ${modelProvider.info.name} for a repair brief from failed command output.`
  });

  const started = event(
    "task.command.repair_brief.started",
    `Generating repair brief for failed task command: ${taskCommandRun.name}.`
  );
  started.createdAt = startedAt;
  saveAndBroadcast(task, started);

  try {
    const brief = await modelProvider.createValidationRepairBrief({ task, taskCommandRun });
    task.validationRepairBriefs.push(brief);
    task.reviewSummary = `${taskCommandRun.name} failed. Repair brief: ${brief.summary}`;
    setAgent(task, "Planner", "Done", "Prepared a repair brief from task command output.");
    setAgent(task, "Coder", "Ready", "Ready to turn the command failure brief into a reviewed proposal.");
    setAgent(task, "Reviewer", "Active", "Review the failed command and repair brief before continuing.");
    upsertPlanStep(task, {
      id: "analyze-task-command-failure",
      title: "Analyze command failure",
      status: "Done",
      summary: brief.summary
    });
    upsertPlanStep(task, {
      id: "plan-validation-repair",
      title: "Plan command repair",
      status: "Active",
      summary: brief.followUpPrompt
    });

    const ready = event("task.command.repair_brief.ready", brief.summary);
    ready.createdAt = brief.generatedAt;
    saveAndBroadcast(task, ready);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    upsertPlanStep(task, {
      id: "analyze-task-command-failure",
      title: "Analyze command failure",
      status: "Blocked",
      summary: message
    });

    const failed = event("task.command.repair_brief.failed", message);
    failed.createdAt = new Date().toISOString();
    saveAndBroadcast(task, failed);
  }
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
    const { absolutePath, relativePath } = resolveEditableWorkspacePath(changedFile);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error(`Changed file is no longer an editable text file: ${relativePath}`);
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
    const operation = change.applyOperation;
    if (!operation) {
      return blockedValidation(change, `No apply operation was provided: ${change.path}`, checks);
    }

    if (change.changeType === "Create") {
      checks.push("Change type is create.");

      if (operation.kind !== "CreateFile") {
        return blockedValidation(change, `Create changes require a CreateFile operation in v0: ${change.path}`, checks);
      }

      const { absolutePath, relativePath } = resolveMarkdownWorkspacePath(change.path);
      if (!relativePath.startsWith("docs/")) {
        return blockedValidation(change, `CreateFile can only create docs/*.md files in v0: ${relativePath}`, checks);
      }
      checks.push("Path is inside the createable docs Markdown boundary.");

      if (operation.content.length === 0) {
        return blockedValidation(change, `CreateFile content is empty: ${relativePath}`, checks);
      }

      if (operation.content.length > editProposalCreateFileMaxChars) {
        return blockedValidation(change, `CreateFile content is too large for v0 apply: ${relativePath}`, checks);
      }

      if (operation.content.includes("\0")) {
        return blockedValidation(change, `CreateFile content contains a null byte: ${relativePath}`, checks);
      }
      checks.push("CreateFile content is within the v0 limit.");

      try {
        const fileStat = await stat(absolutePath);
        if (fileStat.isFile()) {
          return blockedValidation(change, `CreateFile target already exists: ${relativePath}`, checks);
        }

        return blockedValidation(change, `CreateFile target exists but is not a file: ${relativePath}`, checks);
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }
      checks.push("CreateFile target does not already exist.");

      return {
        id: change.id,
        path: relativePath,
        status: "Ready",
        summary: `${relativePath} is ready for restricted Markdown file creation.`,
        checks
      };
    }

    if (change.changeType !== "Modify") {
      return blockedValidation(change, `Only create and modify changes can be applied in v0: ${change.path}`, checks);
    }
    checks.push("Change type is modify.");

    const { absolutePath, relativePath } = resolveEditableWorkspacePath(change.path);
    checks.push("Path is inside the editable source/text workspace boundary.");

    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return blockedValidation(change, `Can only modify existing files in v0: ${relativePath}`, checks);
    }
    checks.push("Target file exists.");

    if (fileStat.size > editProposalEditableFileMaxBytes) {
      return blockedValidation(change, `Target file is too large for restricted source apply: ${relativePath}`, checks);
    }
    checks.push("Target file is within the restricted source apply size limit.");

    const currentContent = await readFile(absolutePath, "utf8");
    if (currentContent.includes("\0")) {
      return blockedValidation(change, `Target file appears to be binary: ${relativePath}`, checks);
    }
    checks.push("Target file is readable as text.");

    if (operation.kind === "AppendText") {
      checks.push("Apply operation is append-text.");

      if (!isEditableMarkdownWorkspacePath(relativePath)) {
        return blockedValidation(change, `AppendText can only modify README.md or docs/*.md in v0: ${relativePath}`, checks);
      }
      checks.push("AppendText target is inside the editable Markdown boundary.");

      if (operation.text.length === 0) {
        return blockedValidation(change, `Append text is empty: ${change.path}`, checks);
      }

      if (operation.text.length > editProposalTextOperationMaxChars) {
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

      if (
        operation.findText.length > editProposalTextOperationMaxChars ||
        operation.replaceWith.length > editProposalTextOperationMaxChars
      ) {
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

    if (operation.kind === "PatchText") {
      checks.push("Apply operation is patch-text.");
      const nextContent = validatePatchTextOperation(operation, currentContent, relativePath, checks);
      if (nextContent === currentContent) {
        return blockedValidation(change, `Patch operation would not change ${relativePath}.`, checks);
      }

      return {
        id: change.id,
        path: relativePath,
        status: "Ready",
        summary: `${relativePath} is ready for ${operation.hunks.length} restricted patch-text hunk(s).`,
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

function hasRunningTaskCommandRun(task: ForgeTask): boolean {
  return task.taskCommandRuns.some((run) => run.status === "Running");
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

function findLastTaskCommandRun(task: ForgeTask, commandID: string): TaskCommandPermission["lastRun"] {
  const run = [...task.taskCommandRuns].reverse().find((candidate) => candidate.commandID === commandID);
  if (!run) {
    return undefined;
  }

  return {
    id: run.id,
    status: run.status,
    summary: run.outputSummary,
    startedAt: run.startedAt,
    endedAt: run.endedAt
  };
}

function latestFailedValidationRun(task: ForgeTask): ValidationRun | undefined {
  return [...task.validationRuns].reverse().find((run) => run.status === "Failed");
}

function latestFailedTaskCommandRun(task: ForgeTask): TaskCommandRun | undefined {
  return [...task.taskCommandRuns].reverse().find((run) => run.status === "Failed");
}

function latestValidationRepairBriefForRun(
  task: ForgeTask,
  validationRunID: string
): ValidationRepairBrief | undefined {
  return [...task.validationRepairBriefs].reverse().find((brief) => brief.validationRunID === validationRunID);
}

function latestValidationRepairBriefForTaskCommandRun(
  task: ForgeTask,
  taskCommandRunID: string
): ValidationRepairBrief | undefined {
  return [...task.validationRepairBriefs].reverse().find((brief) => brief.taskCommandRunID === taskCommandRunID);
}

function latestRepairProposalSource(
  task: ForgeTask
): { kind: "ValidationRun"; brief: ValidationRepairBrief; validationRun: ValidationRun } |
  { kind: "TaskCommandRun"; brief: ValidationRepairBrief; taskCommandRun: TaskCommandRun } |
  undefined {
  const failedValidationRun = latestFailedValidationRun(task);
  const validationBrief = failedValidationRun
    ? latestValidationRepairBriefForRun(task, failedValidationRun.id)
    : undefined;
  const failedTaskCommandRun = latestFailedTaskCommandRun(task);
  const taskCommandBrief = failedTaskCommandRun
    ? latestValidationRepairBriefForTaskCommandRun(task, failedTaskCommandRun.id)
    : undefined;

  if (failedTaskCommandRun && taskCommandBrief) {
    if (!failedValidationRun || compareTaskCommandAndValidationFailureTime(failedTaskCommandRun, failedValidationRun) >= 0) {
      return {
        kind: "TaskCommandRun",
        brief: taskCommandBrief,
        taskCommandRun: failedTaskCommandRun
      };
    }
  }

  if (failedValidationRun && validationBrief) {
    return {
      kind: "ValidationRun",
      brief: validationBrief,
      validationRun: failedValidationRun
    };
  }

  if (failedTaskCommandRun && taskCommandBrief) {
    return {
      kind: "TaskCommandRun",
      brief: taskCommandBrief,
      taskCommandRun: failedTaskCommandRun
    };
  }

  return undefined;
}

function compareTaskCommandAndValidationFailureTime(
  taskCommandRun: TaskCommandRun,
  validationRun: ValidationRun
): number {
  const commandTime = taskCommandRun.endedAt ?? taskCommandRun.startedAt;
  const validationTime = validationRun.endedAt ?? validationRun.startedAt;
  return commandTime.localeCompare(validationTime);
}

async function applyProposedFileChange(
  proposalID: string,
  change: ProposedFileChange
): Promise<AppliedFileChange> {
  const operation = change.applyOperation;
  if (!operation) {
    throw new HttpError(409, `No apply operation was provided: ${change.path}`);
  }

  const appliedAt = new Date().toISOString();

  if (change.changeType === "Create") {
    if (operation.kind !== "CreateFile") {
      throw new HttpError(409, `Create changes require a CreateFile operation in v0: ${change.path}`);
    }

    const { absolutePath, relativePath } = resolveMarkdownWorkspacePath(change.path);
    if (!relativePath.startsWith("docs/")) {
      throw new HttpError(409, `CreateFile can only create docs/*.md files in v0: ${relativePath}`);
    }

    if (operation.content.length === 0) {
      throw new HttpError(409, `CreateFile content is empty: ${relativePath}`);
    }

    if (operation.content.length > editProposalCreateFileMaxChars) {
      throw new HttpError(409, `CreateFile content is too large for v0 apply: ${relativePath}`);
    }

    if (operation.content.includes("\0")) {
      throw new HttpError(409, `CreateFile content contains a null byte: ${relativePath}`);
    }

    try {
      const fileStat = await stat(absolutePath);
      if (fileStat.isFile()) {
        throw new HttpError(409, `CreateFile target already exists: ${relativePath}`);
      }

      throw new HttpError(409, `CreateFile target exists but is not a file: ${relativePath}`);
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, operation.content, { encoding: "utf8", flag: "wx" });
    const afterContent = await readFile(absolutePath, "utf8");
    return buildAppliedFileChange({
      relativePath,
      proposalFileChangeID: change.id,
      operationKind: operation.kind,
      appliedAt,
      afterContent,
      rollbackKind: "DeleteCreatedFile",
      rollbackSummary: `Delete ${relativePath} to undo the created file.`
    });
  }

  if (change.changeType !== "Modify") {
    throw new HttpError(409, `Only create and modify changes can be applied in v0: ${change.path}`);
  }

  const { absolutePath, relativePath } = resolveEditableWorkspacePath(change.path);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new HttpError(409, `Can only modify existing files in v0: ${relativePath}`);
  }

  if (fileStat.size > editProposalEditableFileMaxBytes) {
    throw new HttpError(409, `Target file is too large for restricted source apply: ${relativePath}`);
  }

  const currentContent = await readFile(absolutePath, "utf8");
  if (currentContent.includes("\0")) {
    throw new HttpError(409, `Target file appears to be binary: ${relativePath}`);
  }

  if (operation.kind === "AppendText") {
    if (!isEditableMarkdownWorkspacePath(relativePath)) {
      throw new HttpError(409, `AppendText can only modify README.md or docs/*.md in v0: ${relativePath}`);
    }

    if (operation.text.length === 0) {
      throw new HttpError(409, `Append text is empty: ${relativePath}`);
    }

    if (operation.text.length > editProposalTextOperationMaxChars) {
      throw new HttpError(409, `Edit operation is too large for v0 apply: ${relativePath}`);
    }

    if (currentContent.endsWith(operation.text)) {
      throw new HttpError(409, `Proposed append text is already present at the end of ${relativePath}.`);
    }

    const rollbackSnapshotPath = await writeRollbackSnapshot(proposalID, change.id, currentContent);
    await appendFile(absolutePath, operation.text, "utf8");
    const afterContent = await readFile(absolutePath, "utf8");
    return buildAppliedFileChange({
      relativePath,
      proposalFileChangeID: change.id,
      operationKind: operation.kind,
      appliedAt,
      beforeContent: currentContent,
      afterContent,
      rollbackSnapshotPath,
      rollbackKind: "RestorePreviousContent",
      rollbackSummary: `Restore the previous full contents of ${relativePath}.`
    });
  }

  if (operation.kind === "ReplaceText") {
    if (operation.findText.length === 0 || operation.replaceWith.length === 0) {
      throw new HttpError(409, `Replace operation requires non-empty find and replacement text: ${relativePath}`);
    }

    if (
      operation.findText.length > editProposalTextOperationMaxChars ||
      operation.replaceWith.length > editProposalTextOperationMaxChars
    ) {
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

    const nextContent = currentContent.replace(operation.findText, operation.replaceWith);
    const rollbackSnapshotPath = await writeRollbackSnapshot(proposalID, change.id, currentContent);
    await writeFile(absolutePath, nextContent, "utf8");
    const afterContent = await readFile(absolutePath, "utf8");
    return buildAppliedFileChange({
      relativePath,
      proposalFileChangeID: change.id,
      operationKind: operation.kind,
      appliedAt,
      beforeContent: currentContent,
      afterContent,
      rollbackSnapshotPath,
      rollbackKind: "RestorePreviousContent",
      rollbackSummary: `Restore the previous full contents of ${relativePath}.`
    });
  }

  if (operation.kind === "PatchText") {
    const nextContent = validatePatchTextOperation(operation, currentContent, relativePath);
    if (nextContent === currentContent) {
      throw new HttpError(409, `Patch operation would not change ${relativePath}.`);
    }

    const rollbackSnapshotPath = await writeRollbackSnapshot(proposalID, change.id, currentContent);
    await writeFile(absolutePath, nextContent, "utf8");
    const afterContent = await readFile(absolutePath, "utf8");
    return buildAppliedFileChange({
      relativePath,
      proposalFileChangeID: change.id,
      operationKind: operation.kind,
      appliedAt,
      beforeContent: currentContent,
      afterContent,
      rollbackSnapshotPath,
      rollbackKind: "RestorePreviousContent",
      rollbackSummary: `Restore the previous full contents of ${relativePath}.`
    });
  }

  throw new HttpError(409, `Unsupported apply operation for ${relativePath}.`);
}

type PreparedRollbackOperation = {
  relativePath: string;
  rollback: () => Promise<void>;
};

async function prepareAppliedFileRollback(appliedChange: AppliedFileChange): Promise<PreparedRollbackOperation> {
  if (appliedChange.rolledBackAt) {
    throw new HttpError(409, `Applied file change has already been rolled back: ${appliedChange.path}`);
  }

  if (appliedChange.rollbackKind === "DeleteCreatedFile") {
    const { absolutePath, relativePath } = resolveMarkdownWorkspacePath(appliedChange.path);
    const currentContent = await readFile(absolutePath, "utf8");
    verifyCurrentContentForRollback(appliedChange, currentContent, relativePath);

    return {
      relativePath,
      rollback: async () => {
        await unlink(absolutePath);
      }
    };
  }

  if (appliedChange.rollbackKind === "RestorePreviousContent") {
    const { absolutePath, relativePath } = resolveEditableWorkspacePath(appliedChange.path);
    const snapshotPath = appliedChange.rollbackSnapshotPath;
    if (!snapshotPath) {
      throw new HttpError(409, `Rollback snapshot is missing for ${relativePath}.`);
    }

    const currentContent = await readFile(absolutePath, "utf8");
    verifyCurrentContentForRollback(appliedChange, currentContent, relativePath);

    const snapshot = await readFile(resolveRollbackSnapshotPath(snapshotPath), "utf8");
    if (appliedChange.beforeSha256 && sha256Text(snapshot) !== appliedChange.beforeSha256) {
      throw new HttpError(409, `Rollback snapshot hash does not match recorded before hash for ${relativePath}.`);
    }

    return {
      relativePath,
      rollback: async () => {
        await writeFile(absolutePath, snapshot, "utf8");
      }
    };
  }

  throw new HttpError(409, `Unsupported rollback kind for ${appliedChange.path}: ${appliedChange.rollbackKind}`);
}

function verifyCurrentContentForRollback(
  appliedChange: AppliedFileChange,
  currentContent: string,
  relativePath: string
): void {
  if (!appliedChange.afterSha256) {
    throw new HttpError(409, `Applied change is missing after hash: ${relativePath}`);
  }

  const currentSha = sha256Text(currentContent);
  if (currentSha !== appliedChange.afterSha256) {
    throw new HttpError(
      409,
      `Current file hash for ${relativePath} no longer matches the applied proposal; rollback would overwrite later changes.`
    );
  }
}

async function writeRollbackSnapshot(
  proposalID: string,
  fileChangeID: string,
  content: string
): Promise<string> {
  const directory = path.join(rollbackSnapshotRoot, safeSnapshotSegment(proposalID));
  await mkdir(directory, { recursive: true });

  const absolutePath = path.join(directory, `${safeSnapshotSegment(fileChangeID)}.before`);
  await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
  return repoRelativePath(absolutePath);
}

function resolveRollbackSnapshotPath(inputPath: string): string {
  if (inputPath.includes("\0") || path.isAbsolute(inputPath)) {
    throw new HttpError(409, `Unsafe rollback snapshot path: ${inputPath}`);
  }

  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    !normalized.startsWith(".forge/rollback-snapshots/")
  ) {
    throw new HttpError(409, `Unsafe rollback snapshot path: ${inputPath}`);
  }

  const absolutePath = path.resolve(repoRoot, normalized);
  if (!absolutePath.startsWith(`${rollbackSnapshotRoot}${path.sep}`)) {
    throw new HttpError(409, `Unsafe rollback snapshot path: ${inputPath}`);
  }

  return absolutePath;
}

function safeSnapshotSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  if (!safe) {
    throw new HttpError(409, "Rollback snapshot id is empty.");
  }

  return safe;
}

function repoRelativePath(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function buildAppliedFileChange(input: {
  relativePath: string;
  proposalFileChangeID: string;
  operationKind: AppliedFileChange["operationKind"];
  appliedAt: string;
  beforeContent?: string;
  afterContent?: string;
  rollbackSnapshotPath?: string;
  rollbackKind: AppliedFileChange["rollbackKind"];
  rollbackSummary: string;
}): AppliedFileChange {
  return {
    path: input.relativePath,
    operationKind: input.operationKind,
    rollbackKind: input.rollbackKind,
    rollbackSummary: input.rollbackSummary,
    appliedAt: input.appliedAt,
    proposalFileChangeID: input.proposalFileChangeID,
    beforeSha256: input.beforeContent === undefined ? undefined : sha256Text(input.beforeContent),
    afterSha256: input.afterContent === undefined ? undefined : sha256Text(input.afterContent),
    beforeByteLength: input.beforeContent === undefined ? undefined : Buffer.byteLength(input.beforeContent, "utf8"),
    afterByteLength: input.afterContent === undefined ? undefined : Buffer.byteLength(input.afterContent, "utf8"),
    rollbackSnapshotPath: input.rollbackSnapshotPath
  };
}

function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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

function validatePatchTextOperation(
  operation: Extract<NonNullable<ProposedFileChange["applyOperation"]>, { kind: "PatchText" }>,
  currentContent: string,
  relativePath: string,
  checks?: string[]
): string {
  if (operation.hunks.length === 0) {
    throw new HttpError(409, `PatchText requires at least one hunk: ${relativePath}`);
  }

  if (operation.hunks.length > editProposalPatchMaxHunks) {
    throw new HttpError(409, `PatchText has too many hunks for v0 apply: ${relativePath}`);
  }
  checks?.push(`Patch hunk count is within the v0 limit (${operation.hunks.length}/${editProposalPatchMaxHunks}).`);

  const seenFindTexts = new Set<string>();
  const totalChars = operation.hunks.reduce((total, hunk) => total + hunk.findText.length + hunk.replaceWith.length, 0);
  if (totalChars > editProposalPatchMaxTotalChars) {
    throw new HttpError(409, `PatchText operation is too large for v0 apply: ${relativePath}`);
  }
  checks?.push("Patch total text size is within the v0 limit.");

  for (const [index, hunk] of operation.hunks.entries()) {
    const hunkLabel = `Patch hunk ${index + 1}`;
    if (hunk.findText.length === 0) {
      throw new HttpError(409, `${hunkLabel} find text is empty: ${relativePath}`);
    }

    if (hunk.replaceWith.length === 0) {
      throw new HttpError(409, `${hunkLabel} replacement text is empty: ${relativePath}`);
    }

    if (
      hunk.findText.length > editProposalTextOperationMaxChars ||
      hunk.replaceWith.length > editProposalTextOperationMaxChars
    ) {
      throw new HttpError(409, `${hunkLabel} is too large for v0 apply: ${relativePath}`);
    }

    if (hunk.findText === hunk.replaceWith) {
      throw new HttpError(409, `${hunkLabel} find text and replacement text are identical: ${relativePath}`);
    }

    if (seenFindTexts.has(hunk.findText)) {
      throw new HttpError(409, `${hunkLabel} duplicates an earlier find text: ${relativePath}`);
    }
    seenFindTexts.add(hunk.findText);

    const originalOccurrenceCount = countTextOccurrences(currentContent, hunk.findText);
    if (originalOccurrenceCount === 0) {
      throw new HttpError(409, `${hunkLabel} find text was not found in ${relativePath}.`);
    }

    if (originalOccurrenceCount > 1) {
      throw new HttpError(
        409,
        `${hunkLabel} find text appears ${originalOccurrenceCount} times in ${relativePath}; patch hunks require one original match.`
      );
    }
  }
  checks?.push("Every patch hunk find text appears exactly once in the original target file.");

  let nextContent = currentContent;
  for (const [index, hunk] of operation.hunks.entries()) {
    const occurrenceCount = countTextOccurrences(nextContent, hunk.findText);
    if (occurrenceCount !== 1) {
      throw new HttpError(
        409,
        `Patch hunk ${index + 1} requires exactly one sequential match in ${relativePath}; found ${occurrenceCount}.`
      );
    }

    nextContent = nextContent.replace(hunk.findText, hunk.replaceWith);
  }
  checks?.push("Patch hunks apply cleanly in order.");

  return nextContent;
}

function resolveMarkdownWorkspacePath(inputPath: string): { absolutePath: string; relativePath: string } {
  const resolved = resolveWorkspaceEditPath(inputPath);
  if (!isEditableMarkdownWorkspacePath(resolved.relativePath)) {
    throw new HttpError(409, `Only README.md and docs/*.md paths can be edited with Markdown operations in v0: ${inputPath}`);
  }

  return resolved;
}

function resolveEditableWorkspacePath(inputPath: string): { absolutePath: string; relativePath: string } {
  const resolved = resolveWorkspaceEditPath(inputPath);
  if (!isEditableWorkspaceTextPath(resolved.relativePath)) {
    throw new HttpError(409, `Only allowlisted source/text files can be edited in v0: ${inputPath}`);
  }

  return resolved;
}

function resolveWorkspaceEditPath(inputPath: string): { absolutePath: string; relativePath: string } {
  if (inputPath.includes("\0") || path.isAbsolute(inputPath)) {
    throw new HttpError(409, `Unsafe edit path: ${inputPath}`);
  }

  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw new HttpError(409, `Unsafe edit path: ${inputPath}`);
  }

  if (hasUnsafeEditPathSegment(normalized)) {
    throw new HttpError(409, `Unsafe edit path segment: ${inputPath}`);
  }

  const absolutePath = path.resolve(repoRoot, normalized);
  if (!absolutePath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new HttpError(409, `Unsafe edit path: ${inputPath}`);
  }

  return { absolutePath, relativePath: normalized };
}

function isEditableMarkdownWorkspacePath(normalized: string): boolean {
  return normalized === "README.md" || (normalized.startsWith("docs/") && normalized.endsWith(".md"));
}

function isEditableWorkspaceTextPath(normalized: string): boolean {
  if (isEditableMarkdownWorkspacePath(normalized)) {
    return true;
  }

  const fileName = path.posix.basename(normalized);
  if (
    editProposalBlockedFileNames.has(fileName) ||
    fileName.startsWith(".env") ||
    hasIgnoredEditDirectory(normalized)
  ) {
    return false;
  }

  return editProposalEditableFileNames.has(fileName) || editProposalEditableExtensions.has(path.posix.extname(fileName));
}

function hasUnsafeEditPathSegment(normalized: string): boolean {
  return normalized.split("/").some((segment) => segment === ".git" || segment === ".forge");
}

function hasIgnoredEditDirectory(normalized: string): boolean {
  return normalized
    .split("/")
    .slice(0, -1)
    .some((segment) => repositoryIgnoredDirectories.has(segment) || segment.endsWith(".xcodeproj"));
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
  matches: RepositorySearchMatch[],
  preferredPaths: string[] = []
): Promise<ContextFile[]> {
  const selected = selectRepositoryContextPaths(task, files, matches, preferredPaths);
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

function mergeContextFiles(existing: ContextFile[], incoming: ContextFile[]): ContextFile[] {
  const byPath = new Map(existing.map((file) => [file.path, file]));

  for (const file of incoming) {
    byPath.set(file.path, file);
  }

  return [...byPath.values()].slice(0, modelGuidedContextMaxStoredFiles);
}

function selectRepositoryContextPaths(
  task: ForgeTask,
  files: string[],
  matches: RepositorySearchMatch[],
  preferredPaths: string[] = []
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

  for (const preferredPath of preferredPaths) {
    add(preferredPath);
  }

  for (const match of matches) {
    add(match.path);
  }

  for (const importantPath of repositoryImportantFiles) {
    add(importantPath);
  }

  return selected.slice(0, repositoryContextMaxFiles);
}

function normalizeProviderSearchTerms(
  contextRequest: PlanContextRequestResult,
  task: ForgeTask
): string[] {
  const terms = new Set<string>();
  const addTerm = (term: string) => {
    const normalized = term
      .toLowerCase()
      .replace(/[^a-z0-9._/-]+/g, " ")
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2 && !repositorySearchStopWords.has(part));

    for (const part of normalized) {
      terms.add(part.slice(0, 64));
    }
  };

  for (const term of contextRequest.searchTerms) {
    addTerm(term);
  }

  if (terms.size === 0) {
    for (const fallbackTerm of deriveRepositorySearchTerms(task)) {
      addTerm(fallbackTerm);
    }
  }

  return [...terms].slice(0, 10);
}

function normalizeProviderReadPaths(readPaths: string[], files: string[]): string[] {
  const fileSet = new Set(files);
  const normalizedPaths: string[] = [];

  for (const readPath of readPaths) {
    const normalized = path.posix.normalize(readPath.replaceAll("\\", "/").replace(/^@/, "").replace(/^\.\/+/, ""));
    if (
      !normalized ||
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.startsWith("/") ||
      normalized.startsWith(".git/") ||
      normalized.startsWith(".forge/") ||
      normalized.includes("/.git/") ||
      normalized.includes("/.forge/") ||
      normalized.includes("\0")
    ) {
      continue;
    }

    if (fileSet.has(normalized) && !normalizedPaths.includes(normalized)) {
      normalizedPaths.push(normalized);
    }
  }

  return normalizedPaths.slice(0, repositoryContextMaxFiles);
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

function deriveExecutionSearchTerms(task: ForgeTask): string[] {
  const executionTerms = new Set(deriveRepositorySearchTerms(task));
  for (const step of task.planSteps) {
    for (const part of `${step.title} ${step.summary}`.toLowerCase().split(/[^a-z0-9_-]+/)) {
      const term = part.replaceAll("_", "-");
      if (term.length >= 3 && !repositorySearchStopWords.has(term)) {
        executionTerms.add(term);
      }
    }
  }

  for (const file of task.contextFiles) {
    for (const part of file.path.toLowerCase().split(/[^a-z0-9_-]+/)) {
      if (part.length >= 3 && !repositorySearchStopWords.has(part)) {
        executionTerms.add(part);
      }
    }
  }

  return [...executionTerms].slice(0, 12);
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
      <li><a href="/git/status">GET /git/status</a></li>
      <li><code>GET /git/diff?path=README.md</code></li>
      <li><a href="/git/branch-preview">GET /git/branch-preview</a></li>
      <li><code>POST /git/branch</code></li>
      <li><a href="/git/branch-publish-preview">GET /git/branch-publish-preview</a></li>
      <li><code>POST /git/branch-publish</code></li>
      <li><a href="/git/commit-preview">GET /git/commit-preview</a></li>
      <li><code>POST /git/commit</code></li>
      <li><a href="/git/push-preview">GET /git/push-preview</a></li>
      <li><code>POST /git/push</code></li>
      <li><a href="/git/pr-preview">GET /git/pr-preview</a></li>
      <li><a href="/validation-presets">GET /validation-presets</a></li>
      <li><a href="/settings/model-provider">GET /settings/model-provider</a></li>
      <li><code>POST /settings/model-provider</code></li>
      <li><code>POST /tasks</code></li>
      <li><code>POST /tasks/:taskID/messages</code></li>
      <li><code>POST /tasks/:taskID/generate-plan-revision</code></li>
      <li><code>POST /tasks/:taskID/approve-plan</code></li>
      <li><code>POST /tasks/:taskID/generate-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/revise-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/generate-validation-repair-proposal</code></li>
      <li><code>POST /tasks/:taskID/validate-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/apply-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/rollback-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/reject-edit-proposal</code></li>
      <li><code>POST /tasks/:taskID/approve-validation-preset</code></li>
      <li><code>POST /tasks/:taskID/run-validation</code></li>
      <li><code>POST /tasks/:taskID/run-task-command</code></li>
      <li><code>POST /tasks/:taskID/cancel-task-command</code></li>
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
