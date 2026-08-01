import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { appendFile, lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { RuntimeEventBus } from "../events/runtimeEventBus.js";
import { createAgentOrchestrationService } from "../agent/agentOrchestrationService.js";
import { createLegacyAgentLoopService } from "../agent/legacyAgentLoopService.js";
import { validateUnifiedDiffOperation } from "../edits/unifiedDiff.js";
import {
  countTextOccurrences,
  EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS as editProposalTextOperationMaxChars,
  validatePatchTextOperation
} from "../edits/textOperations.js";
import {
  createEditTransactionService,
  type PreparedRollbackOperation
} from "../edits/editTransactionService.js";
import { createEditRecoveryService } from "../edits/editRecoveryService.js";
import { createEditProposalValidation } from "../edits/editProposalValidation.js";
import { createEditProposalService } from "../edits/editProposalService.js";
import { createWorkspacePathPolicy } from "../edits/workspacePathPolicy.js";
import { createRequestHandler } from "../http/createRequestHandler.js";
import { createRuntimeRoutes } from "../http/runtimeRoutes.js";
import { renderRuntimeHome } from "../http/runtimeHome.js";
import { HttpError } from "../http/httpError.js";
import { readJson } from "../http/request.js";
import { writeHtml, writeJson } from "../http/response.js";
import { taskIDFromActionPath } from "../http/taskPath.js";
import {
  classifyGitPushFailure,
  assertPathInside,
  gitFileChangeFromNameStatus,
  gitPushFailureMessage,
  isSafeGitChange,
  mergeGitFileChanges,
  parseGitBranchLine,
  parseGitNumstatValue,
  parseGitRangeNumstat,
  parseGitStatusChanges,
  parseGitUpstream,
  normalizeGitDiffPath,
  summarizeGitCommandOutput,
  summarizeRemoteURLKind
} from "../git/gitParsers.js";
import { createGitCommand } from "../git/gitCommand.js";
import { createGitStatusService } from "../git/gitStatusService.js";
import { createGitDiffService } from "../git/gitDiffService.js";
import { createGitConflictService } from "../git/gitConflictService.js";
import { createGitWorkflowService } from "../git/gitWorkflowService.js";
import { loadRuntimeConfig } from "../runtime/config.js";
import { startRuntimeLifecycle } from "../runtime/lifecycle.js";
import { createModelProviderSettingsService } from "../runtime/modelProviderSettingsService.js";
import { createRepositoryContextService } from "../repository/repositoryContextService.js";
import { createTaskService } from "../tasks/taskService.js";
import { createTaskState } from "../tasks/taskState.js";
import {
  createValidationCatalogService,
  type InternalValidationCommand,
  type InternalValidationPreset
} from "../validation/validationCatalogService.js";
import { createValidationService } from "../validation/validationService.js";
import { repositoryInspectionSubsumedBy } from "../inspectionGuard.js";
import { fileMetadata, summarizeIndex, type IndexStatus } from "../repositoryIndex.js";
import { extractSymbols } from "../symbolExtract.js";
import { symbolIndexMatches, mergeRepositoryMatches } from "../symbolSearch.js";
import { extractTrigrams } from "../textIndex.js";
import { textIndexCandidates } from "../textSearch.js";
import { parseGitHubRemote } from "../githubRemote.js";
import { detectStuckWork, type StuckFinding } from "../stuckDetection.js";
import {
  AgentRunStepProviderError,
  createModelProvider,
  defaultModelProviderRuntimeSettings,
  getModelProviderConfiguration
} from "../modelProvider.js";
import { SqliteTaskStore } from "../taskStore.js";
import type {
  AgentRunLoop,
  AgentRunLoopControlRequest,
  AgentRunStep,
  AgentRunStepDecision,
  AgentState,
  AppliedFileChange,
  ApprovalRecord,
  ApprovePlanAndRunRequest,
  ApprovePlanRequest,
  ApproveValidationPresetRequest,
  CancelTaskCommandRequest,
  ContextFile,
  CreateTaskMessageRequest,
  CreateTaskRequest,
  EditProposal,
  EditProposalDecisionRequest,
  EditProposalFileReviewRequest,
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
  GitConflictFile,
  GitConflictResolutionRequest,
  GitConflictResolutionResult,
  GitConflictSnapshot,
  GitConflictStage,
  GitFileChange,
  GitFileDiff,
  GitPullRequestPreview,
  GitPullRequestPublishRequest,
  GitPullRequestResult,
  GitPullRequestStatusRequest,
  TaskPullRequest,
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
  RerunRepairCommandRequest,
  RunAgentLoopRequest,
  RunAgentStepRequest,
  RunTaskCommandRequest,
  RunValidationRequest,
  TaskCommandOutputChunk,
  TaskCommandPermission,
  TaskCommandRun,
  TaskQueueReorderRequest,
  TaskQueueSettingsRequest,
  TaskQueueSnapshot,
  CommandRerunEvidence,
  TaskFileReference,
  TaskMessage,
  ToolCall,
  ValidationCommandDefinition,
  ValidationCommandResult,
  ValidationRepairBrief,
  ValidationRun
} from "../types.js";

// Preserve the packaged entrypoint as the path-resolution anchor even though
// runtime composition now lives one directory below dist/server.js.
const runtimeConfig = loadRuntimeConfig(new URL("../server.js", import.meta.url).href);
const {
  startedAt,
  port,
  observerMode,
  runtimeAuthorizationID,
  runtimeAuthorizedAt,
  modelProviderLock,
  runtimeDir,
  repoRoot,
  repoRootSource,
  databasePath,
  modelProviderSettingsPath,
  rollbackSnapshotRoot,
  validationPresetConfigPath,
  taskQueueSettingsPath,
  githubApiBase,
  enableSmokeCommands,
  taskQueueSmokeDelayMs,
  stuckThresholds,
  stuckSweepIntervalMs,
  environment: runtimeEnvironment
} = runtimeConfig;
const eventBus = new RuntimeEventBus();
const runGitCommand = createGitCommand(runtimeEnvironment);
const { getGitStatusSnapshot } = createGitStatusService({ repoRoot, runGitCommand });
const { getGitFileDiff } = createGitDiffService({ runGitCommand, getGitStatusSnapshot });
const taskStore = new SqliteTaskStore(databasePath, { readOnly: observerMode });
const tasks = new Map<string, ForgeTask>(taskStore.loadTasks().map((task) => [task.id, task]));
const taskState = createTaskState({ tasks, taskStore, eventBus, observerMode });
const {
  emit,
  reloadObserverTasks,
  listTasks,
  saveTask,
  saveAndBroadcast,
  event,
  cloneAgents,
  clonePlanSteps,
  setAgent,
  setPlanStep,
  upsertPlanStep
} = taskState;
const { getGitConflictSnapshot, resolveGitConflict } = createGitConflictService({
  runGitCommand,
  getGitStatusSnapshot,
  tasks,
  saveTask,
  emit
});
const gitWorkflowService = createGitWorkflowService({
  runGitCommand,
  getGitStatusSnapshot,
  tasks,
  saveTask,
  emit,
  githubApiBase
});
const {
  getGitBranchPreview,
  createOrSwitchGitBranch,
  getGitBranchPublishPreview,
  publishGitBranch,
  getGitCommitPreview,
  createGitCommit,
  getGitPushPreview,
  pushGitBranch,
  getGitPullRequestPreview,
  publishGitPullRequest,
  refreshGitPullRequestStatus
} = gitWorkflowService;
const modelProviderSettingsService = createModelProviderSettingsService({
  modelProviderSettingsPath,
  modelProviderLock,
  runtimeEnvironment,
  repoRoot,
  observerMode,
  emit
});
const currentModelProvider = modelProviderSettingsService.getModelProvider;
const currentModelProviderSettings = modelProviderSettingsService.getSettings;
const {
  updateModelProviderSettings,
  publicModelProviderRuntimeSettings
} = modelProviderSettingsService;
const repositoryScanMaxFiles = 400;
const repositorySearchMaxFiles = 240;
const repositoryContextMaxFiles = 6;
const modelGuidedContextMaxRounds = 3;
const modelGuidedContextMaxStoredFiles = 8;
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
const workspacePathPolicy = createWorkspacePathPolicy({
  repoRoot,
  ignoredDirectories: repositoryIgnoredDirectories,
  blockedFileNames: editProposalBlockedFileNames,
  editableExtensions: editProposalEditableExtensions,
  editableFileNames: editProposalEditableFileNames
});
const {
  resolveEditableWorkspacePath,
  isEditableMarkdownWorkspacePath
} = workspacePathPolicy;
const { buildEditProposalValidation } = createEditProposalValidation({
  resolveEditableWorkspacePath,
  isEditableMarkdownWorkspacePath
});
let editRecoveryService: ReturnType<typeof createEditRecoveryService>;
const editTransactionService = createEditTransactionService({
  repoRoot,
  rollbackSnapshotRoot,
  resolveEditableWorkspacePath,
  isEditableMarkdownWorkspacePath,
  inspectPersistedEditFileState: (change) => editRecoveryService.inspectPersistedEditFileState(change),
  restorePersistedFileToBeforeState: (change) => editRecoveryService.restorePersistedFileToBeforeState(change)
});
const {
  applyProposedFileChange,
  verifyAppliedFileChange,
  recoverPartialApply,
  recoverPartialRollback,
  prepareAppliedFileRollback,
  resolveRollbackSnapshotPath,
  sha256Text
} = editTransactionService;
editRecoveryService = createEditRecoveryService({
  tasks,
  saveTask: (task) => taskStore.saveTask(task),
  resolveEditableWorkspacePath,
  resolveRollbackSnapshotPath,
  sha256Text,
  setAgent,
  upsertPlanStep
});
const {
  recoverInterruptedEditProposalTransactionsOnStartup,
  inspectPersistedEditFileState,
  restorePersistedFileToBeforeState
} = editRecoveryService;
let validationService: ReturnType<typeof createValidationService>;
let validationCatalogService: ReturnType<typeof createValidationCatalogService>;
const editProposalService = createEditProposalService({
  tasks,
  modelProvider: currentModelProvider,
  saveTask,
  saveAndBroadcast,
  event,
  setAgent,
  upsertPlanStep,
  latestTaskMessage: (task, role) => validationService.latestTaskMessage(task, role),
  buildEditProposalValidation,
  applyProposedFileChange,
  verifyAppliedFileChange,
  recoverPartialApply,
  recoverPartialRollback,
  prepareAppliedFileRollback,
  latestRepairProposalSource: (task) => validationService.latestRepairProposalSource(task),
  runValidation: (taskID, mode) => validationService.runValidation(taskID, mode)
});
const {
  generateEditProposal,
  reviseEditProposal,
  generateValidationRepairProposal,
  validateEditProposal,
  applyEditProposal,
  rollbackEditProposal,
  reviewEditProposalFile,
  rejectEditProposal,
  findCommandRerunEvidenceForRequest,
  latestRunnableCommandRerunEvidence,
  findEditProposalByID,
  summarizeCommandRerunEvidence
} = editProposalService;
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
    executeBuiltIn: validateChangedFilesBridge
  },
  {
    id: "applied-proposal-recorded",
    name: "Applied proposal recorded",
    command: "forge:applied-proposal-recorded",
    kind: "BuiltIn",
    riskLevel: "Low",
    executeBuiltIn: validateAppliedProposalRecordedBridge
  },
  {
    id: "ready-validation-retained",
    name: "Ready validation retained",
    command: "forge:ready-validation-retained",
    kind: "BuiltIn",
    riskLevel: "Low",
    executeBuiltIn: validateReadyProposalValidationBridge
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

validationService = createValidationService({
  tasks,
  modelProvider: currentModelProvider,
  runtimeEnvironment,
  validationCommandCatalog,
  loadValidationPresetRegistry: () => validationCatalogService.loadValidationPresetRegistry(),
  resolvePresetCommandCwd,
  saveTask,
  saveAndBroadcast,
  emit,
  event,
  setAgent,
  upsertPlanStep,
  findCommandRerunEvidenceForRequest,
  findEditProposalByID,
  summarizeCommandRerunEvidence,
  resolveEditableWorkspacePath
});
const {
  approveValidationPreset,
  rerunRepairCommand,
  runTaskCommand,
  cancelTaskCommand,
  runValidation,
  latestTaskMessage,
  latestPlanRevision,
  hasPlanApproval,
  hasValidationPresetApproval,
  findValidationPresetApproval,
  hasRunningValidationRun,
  hasRunningTaskCommandRun,
  findLastValidationRun,
  findLastTaskCommandRun,
  latestFailedValidationRun,
  latestFailedTaskCommandRun,
  latestValidationRepairBriefForRun,
  latestValidationRepairBriefForTaskCommandRun,
  latestRepairProposalSource
} = validationService;

validationCatalogService = createValidationCatalogService({
  tasks,
  builtInValidationPresets,
  validationCommandCatalog,
  validationPresetConfigPath,
  findValidationPresetApproval,
  hasRunningValidationRun,
  hasRunningTaskCommandRun,
  findLastValidationRun,
  findLastTaskCommandRun
});
const {
  listValidationPresets,
  listValidationPermissions,
  loadValidationPresetRegistry,
  buildTaskCommandPermissions
} = validationCatalogService;

function validateChangedFilesBridge(task: ForgeTask): Promise<string> {
  return validationService.validateChangedFiles(task);
}

function validateAppliedProposalRecordedBridge(task: ForgeTask): Promise<string> {
  return validationService.validateAppliedProposalRecorded(task);
}

function validateReadyProposalValidationBridge(task: ForgeTask): Promise<string> {
  return validationService.validateReadyProposalValidation(task);
}

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

let repositoryContextService: ReturnType<typeof createRepositoryContextService>;
const taskService = createTaskService({
  tasks,
  modelProvider: currentModelProvider,
  repoRoot,
  defaultAgents,
  defaultPlanSteps,
  modelGuidedContextMaxRounds,
  cloneAgents,
  clonePlanSteps,
  saveAndBroadcast,
  event,
  setAgent,
  upsertPlanStep,
  latestTaskMessage,
  latestPlanRevision,
  hasPlanApproval,
  listRepositoryFiles: () => repositoryContextService.listRepositoryFiles(),
  normalizeProviderSearchTerms: (request, task) => repositoryContextService.normalizeProviderSearchTerms(request, task),
  normalizeProviderReadPaths: (readPaths, files) => repositoryContextService.normalizeProviderReadPaths(readPaths, files),
  searchRepositoryContext: (files, terms, paths) => repositoryContextService.searchRepositoryContext(files, terms, paths),
  explicitContextPathsForTask: (task) => repositoryContextService.explicitContextPathsForTask(task),
  buildContextFiles: (task, files, matches, paths) => repositoryContextService.buildContextFiles(task, files, matches, paths),
  mergeContextFiles: (existing, incoming) => repositoryContextService.mergeContextFiles(existing, incoming),
  deriveExecutionSearchTerms: (task) => repositoryContextService.deriveExecutionSearchTerms(task),
  runTool: (task, name, input, operation) => repositoryContextService.runTool(task, name, input, operation),
  summarizeMarkdown: (content) => repositoryContextService.summarizeMarkdown(content),
  formatPathList: (paths) => repositoryContextService.formatPathList(paths)
});
const {
  createTask,
  createTaskMessage,
  generatePlanRevision,
  approvePlan,
  enrichPlanRevisionEvidence,
  resolveReadOnlyWorkspacePath
} = taskService;

repositoryContextService = createRepositoryContextService({
  observerMode,
  repoRoot,
  taskStore,
  runtimeEnvironment,
  runGitCommand,
  repositoryContextExtensions,
  editProposalEditableExtensions,
  repositoryIgnoredDirectories,
  repositoryIgnoredFileNames,
  repositoryImportantFiles,
  repositorySearchStopWords,
  chineseIntentSearchTerms,
  repositoryScanMaxFiles,
  repositorySearchMaxFiles,
  repositoryContextMaxFiles,
  modelGuidedContextMaxStoredFiles,
  repositoryContextMaxFileBytes,
  resolveReadOnlyWorkspacePath,
  sha256Text,
  saveTask,
  emit,
  saveAndBroadcast,
  event
});
const {
  indexRepository,
  readRepositoryIndexStatus,
  listRepositoryFiles,
  searchRepositoryContext,
  searchRepositoryWithRipgrep,
  buildContextFiles,
  mergeContextFiles,
  normalizeProviderSearchTerms,
  normalizeProviderReadPaths,
  explicitContextPathsForTask,
  deriveRepositorySearchTerms,
  deriveExecutionSearchTerms,
  summarizeMarkdown,
  formatPathList,
  runTool
} = repositoryContextService;

const agentOrchestrationService = createAgentOrchestrationService({
  tasks,
  modelProvider: currentModelProvider,
  taskQueueSettingsPath,
  taskQueueSmokeDelayMs,
  stuckThresholds,
  repositoryScanMaxFiles,
  repositorySearchMaxFiles,
  repositoryContextMaxFiles,
  saveTask,
  saveAndBroadcast,
  emit,
  event,
  setAgent,
  upsertPlanStep,
  hasRunningValidationRun,
  hasRunningTaskCommandRun,
  loadValidationPresetRegistry,
  buildTaskCommandPermissions,
  generateEditProposal,
  generateValidationRepairProposal,
  runTaskCommand,
  rerunRepairCommand,
  latestRunnableCommandRerunEvidence,
  listRepositoryFiles,
  normalizeProviderSearchTerms,
  normalizeProviderReadPaths,
  searchRepositoryWithRipgrep,
  explicitContextPathsForTask,
  buildContextFiles,
  mergeContextFiles,
  runTool,
  formatPathList
});
const {
  getTaskQueueSnapshot,
  updateTaskQueueSettings,
  reorderTaskQueue,
  removeTaskFromQueue,
  scheduleAgentRunLoop,
  dispatchQueuedAgentRuns,
  requestAgentRunLoopControl,
  resumeAgentRunLoop,
  recoverInterruptedAgentRunLoopsOnStartup,
  recoverStuckAgentWork,
  runAgentStep
} = agentOrchestrationService;

const { runAgentLoopV0 } = createLegacyAgentLoopService({
  tasks,
  modelProvider: currentModelProvider,
  setAgent,
  setPlanStep,
  event,
  runTool,
  listRepositoryFiles,
  deriveRepositorySearchTerms,
  searchRepositoryContext,
  explicitContextPathsForTask,
  buildContextFiles,
  formatPathList,
  latestTaskMessage,
  enrichPlanRevisionEvidence,
  saveTask,
  emit
});

const server = createServer(createRuntimeRoutes({
  ...taskState,
  ...gitWorkflowService,
  ...editProposalService,
  ...validationService,
  ...validationCatalogService,
  ...taskService,
  ...repositoryContextService,
  ...agentOrchestrationService,
  ...modelProviderSettingsService,
  observerMode, runtimeAuthorizationID, runtimeAuthorizedAt, startedAt,
  runtimeDir, repoRoot, repoRootSource, taskStore, tasks, eventBus,
  currentModelProvider,
  currentModelProviderSettings,
  renderRuntimeHome, getModelProviderConfiguration, readRepositoryIndexStatus,
  reloadObserverTasks, listTasks, indexRepository, getGitStatusSnapshot,
  getGitFileDiff, getGitConflictSnapshot, resolveGitConflict,
  getGitBranchPreview, createOrSwitchGitBranch, getGitBranchPublishPreview,
  publishGitBranch, getGitCommitPreview, createGitCommit, getGitPushPreview,
  pushGitBranch, getGitPullRequestPreview, publishGitPullRequest,
  refreshGitPullRequestStatus, recoverStuckAgentWork, getTaskQueueSnapshot,
  updateTaskQueueSettings, reorderTaskQueue, removeTaskFromQueue,
  loadValidationPresetRegistry, listValidationPresets, listValidationPermissions,
  publicModelProviderRuntimeSettings, updateModelProviderSettings,
  createTaskMessage, generatePlanRevision, createTask, approvePlan,
  scheduleAgentRunLoop, dispatchQueuedAgentRuns, runAgentStep, runAgentLoopV0,
  requestAgentRunLoopControl, resumeAgentRunLoop, generateEditProposal,
  reviseEditProposal, generateValidationRepairProposal, validateEditProposal,
  applyEditProposal, rollbackEditProposal, reviewEditProposalFile, rejectEditProposal,
  approveValidationPreset, runValidation, runTaskCommand, rerunRepairCommand,
  cancelTaskCommand, saveTask, emit
}));

startRuntimeLifecycle({
  server,
  port,
  observerMode,
  stuckSweepIntervalMs,
  beforeListenPrimary() {
    recoverInterruptedAgentRunLoopsOnStartup();
    recoverInterruptedEditProposalTransactionsOnStartup();
  },
  onListening() {
    console.log(`Forge runtime listening on http://127.0.0.1:${port}`);
    console.log(`Forge task store: ${taskStore.dbPath}`);
    const provider = currentModelProvider();
    console.log(`Forge model provider: ${provider.info.name} (${provider.info.model})`);
    console.log(`Forge runtime mode: ${observerMode ? "observer (read-only)" : "primary"}`);
  },
  onListeningPrimary() {
    void dispatchQueuedAgentRuns();
  },
  sweepStuckWork() {
    recoverStuckAgentWork();
  },
  onShutdown() {
    eventBus.close();
    taskStore.close();
  }
});

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
