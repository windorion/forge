import { createServer } from "node:http";
import path from "node:path";
import { URL } from "node:url";

import { createAgentOrchestrationService } from "../agent/agentOrchestrationService.js";
import { createLegacyAgentLoopService } from "../agent/legacyAgentLoopService.js";
import { createEditProposalService } from "../edits/editProposalService.js";
import { createEditProposalValidation } from "../edits/editProposalValidation.js";
import { createEditRecoveryService } from "../edits/editRecoveryService.js";
import { createEditTransactionService } from "../edits/editTransactionService.js";
import { createWorkspacePathPolicy } from "../edits/workspacePathPolicy.js";
import { createRuntimeRoutes } from "../http/runtimeRoutes.js";
import { renderRuntimeHome } from "../http/runtimeHome.js";
import { getModelProviderConfiguration } from "../modelProvider.js";
import { createRepositoryContextService } from "../repository/repositoryContextService.js";
import { createTaskService } from "../tasks/taskService.js";
import { createTaskCancellationService } from "../tasks/taskCancellationService.js";
import type { ForgeTask } from "../types.js";
import { createValidationCatalogService } from "../validation/validationCatalogService.js";
import { createValidationService } from "../validation/validationService.js";
import { loadRuntimeConfig } from "./config.js";
import { startRuntimeLifecycle } from "./lifecycle.js";
import { assembleCoreRuntime, assembleValidationRuntime } from "./runtimeDomainAssembly.js";
import {
  createRepositoryDomainDefaults,
  createTaskDomainDefaults,
  createValidationDomainDefaults
} from "./runtimeDomainDefaults.js";

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
  supervisedQueueDispatch,
  stuckThresholds,
  stuckSweepIntervalMs,
  environment: runtimeEnvironment
} = runtimeConfig;
const coreRuntime = assembleCoreRuntime(runtimeConfig);
const {
  eventBus, runGitCommand, taskStore, tasks, taskState,
  gitStatusService, gitDiffService, gitConflictService, gitWorkflowService,
  modelProviderSettingsService
} = coreRuntime;
const {
  emit, reloadObserverTasks, listTasks, saveTask, saveAndBroadcast, event,
  cloneAgents, clonePlanSteps, setAgent, setPlanStep, upsertPlanStep
} = taskState;
const { getGitStatusSnapshot } = gitStatusService;
const { getGitFileDiff } = gitDiffService;
const { getGitConflictSnapshot, resolveGitConflict } = gitConflictService;
const {
  getGitBranchPreview, createOrSwitchGitBranch, getGitBranchPublishPreview, publishGitBranch,
  getGitCommitPreview, createGitCommit, getGitPushPreview, pushGitBranch,
  getGitPullRequestPreview, publishGitPullRequest, refreshGitPullRequestStatus
} = gitWorkflowService;
const currentModelProvider = modelProviderSettingsService.getModelProvider;
const currentModelProviderSettings = modelProviderSettingsService.getSettings;
const { updateModelProviderSettings, publicModelProviderRuntimeSettings } = modelProviderSettingsService;

const repositoryScanMaxFiles = 400;
const repositorySearchMaxFiles = 240;
const repositoryContextMaxFiles = 6;
const modelGuidedContextMaxRounds = 3;
const modelGuidedContextMaxStoredFiles = 8;
const repositoryContextMaxFileBytes = 220_000;
const {
  repositoryIgnoredDirectories, repositoryIgnoredFileNames, editProposalBlockedFileNames,
  repositoryContextExtensions, editProposalEditableExtensions, editProposalEditableFileNames,
  repositoryImportantFiles, repositorySearchStopWords, chineseIntentSearchTerms
} = createRepositoryDomainDefaults();
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
const { validationCommandCatalog, builtInValidationPresets } = createValidationDomainDefaults({
  enableSmokeCommands,
  validateChangedFiles: validateChangedFilesBridge,
  validateAppliedProposalRecorded: validateAppliedProposalRecordedBridge,
  validateReadyProposalValidation: validateReadyProposalValidationBridge
});

const validationRuntime = assembleValidationRuntime({
  service: {
    tasks,
    modelProvider: currentModelProvider,
    runtimeEnvironment,
    validationCommandCatalog,
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
  },
  catalog: { tasks, builtInValidationPresets, validationCommandCatalog, validationPresetConfigPath }
});
validationService = validationRuntime.validationService;
validationCatalogService = validationRuntime.validationCatalogService;
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

const { defaultAgents, defaultPlanSteps } = createTaskDomainDefaults();

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
  supervisedQueueDispatch,
  runtimeAuthorizationID,
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
  dispatchNextSupervisedAgentRun,
  requestAgentRunLoopControl,
  resumeAgentRunLoop,
  recoverInterruptedAgentRunLoopsOnStartup,
  recoverStuckAgentWork,
  runAgentStep
} = agentOrchestrationService;

const taskCancellationService = createTaskCancellationService({
  tasks,
  saveAndBroadcast,
  event,
  setAgent,
  upsertPlanStep,
  removeTaskFromQueue,
  requestAgentRunLoopControl,
  cancelTaskCommand,
  requestValidationCancellation: validationService.requestValidationCancellation
});
const { cancelTask, recoverRequestedTaskCancellationsOnStartup } = taskCancellationService;

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
  ...taskCancellationService,
  ...repositoryContextService,
  ...agentOrchestrationService,
  ...modelProviderSettingsService,
  observerMode, runtimeAuthorizationID, runtimeAuthorizedAt, startedAt,
  supervisedQueueDispatch,
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
  scheduleAgentRunLoop, dispatchQueuedAgentRuns, dispatchNextSupervisedAgentRun, runAgentStep, runAgentLoopV0,
  requestAgentRunLoopControl, resumeAgentRunLoop, generateEditProposal,
  reviseEditProposal, generateValidationRepairProposal, validateEditProposal,
  applyEditProposal, rollbackEditProposal, reviewEditProposalFile, rejectEditProposal,
  approveValidationPreset, runValidation, runTaskCommand, rerunRepairCommand,
  cancelTaskCommand, cancelTask, saveTask, emit
}));

startRuntimeLifecycle({
  server,
  port,
  observerMode,
  stuckSweepIntervalMs,
  beforeListenPrimary() {
    recoverInterruptedAgentRunLoopsOnStartup();
    recoverRequestedTaskCancellationsOnStartup();
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
