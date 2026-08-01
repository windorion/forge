import { RuntimeEventBus } from "../events/runtimeEventBus.js";
import { createGitCommand } from "../git/gitCommand.js";
import { createGitConflictService } from "../git/gitConflictService.js";
import { createGitDiffService } from "../git/gitDiffService.js";
import { createGitStatusService } from "../git/gitStatusService.js";
import { createGitWorkflowService } from "../git/gitWorkflowService.js";
import { SqliteTaskStore } from "../taskStore.js";
import type { ForgeTask } from "../types.js";
import { createTaskState } from "../tasks/taskState.js";
import { createValidationCatalogService } from "../validation/validationCatalogService.js";
import { createValidationService } from "../validation/validationService.js";
import type { ValidationServiceOptions } from "../validation/validationServiceTypes.js";
import type { loadRuntimeConfig } from "./config.js";
import { createModelProviderSettingsService } from "./modelProviderSettingsService.js";

type RuntimeConfig = ReturnType<typeof loadRuntimeConfig>;

export function assembleCoreRuntime(config: RuntimeConfig) {
  const eventBus = new RuntimeEventBus();
  const runGitCommand = createGitCommand(config.environment);
  const gitStatusService = createGitStatusService({ repoRoot: config.repoRoot, runGitCommand });
  const gitDiffService = createGitDiffService({
    runGitCommand,
    getGitStatusSnapshot: gitStatusService.getGitStatusSnapshot
  });
  const taskStore = new SqliteTaskStore(config.databasePath, { readOnly: config.observerMode });
  const tasks = new Map<string, ForgeTask>(taskStore.loadTasks().map((task) => [task.id, task]));
  const taskState = createTaskState({ tasks, taskStore, eventBus, observerMode: config.observerMode });
  const gitConflictService = createGitConflictService({
    runGitCommand,
    getGitStatusSnapshot: gitStatusService.getGitStatusSnapshot,
    tasks,
    saveTask: taskState.saveTask,
    emit: taskState.emit
  });
  const gitWorkflowService = createGitWorkflowService({
    runGitCommand,
    getGitStatusSnapshot: gitStatusService.getGitStatusSnapshot,
    tasks,
    saveTask: taskState.saveTask,
    emit: taskState.emit,
    githubApiBase: config.githubApiBase
  });
  const modelProviderSettingsService = createModelProviderSettingsService({
    modelProviderSettingsPath: config.modelProviderSettingsPath,
    modelProviderLock: config.modelProviderLock,
    runtimeEnvironment: config.environment,
    repoRoot: config.repoRoot,
    observerMode: config.observerMode,
    emit: taskState.emit
  });

  return {
    eventBus,
    runGitCommand,
    taskStore,
    tasks,
    taskState,
    gitStatusService,
    gitDiffService,
    gitConflictService,
    gitWorkflowService,
    modelProviderSettingsService
  };
}

type ValidationCatalogOptions = Parameters<typeof createValidationCatalogService>[0];

export function assembleValidationRuntime(options: {
  service: Omit<ValidationServiceOptions, "loadValidationPresetRegistry">;
  catalog: Omit<
    ValidationCatalogOptions,
    | "findValidationPresetApproval"
    | "hasRunningValidationRun"
    | "hasRunningTaskCommandRun"
    | "findLastValidationRun"
    | "findLastTaskCommandRun"
  >;
}) {
  let validationCatalogService: ReturnType<typeof createValidationCatalogService>;
  const validationService = createValidationService({
    ...options.service,
    loadValidationPresetRegistry: () => validationCatalogService.loadValidationPresetRegistry()
  });
  validationCatalogService = createValidationCatalogService({
    ...options.catalog,
    findValidationPresetApproval: validationService.findValidationPresetApproval,
    hasRunningValidationRun: validationService.hasRunningValidationRun,
    hasRunningTaskCommandRun: validationService.hasRunningTaskCommandRun,
    findLastValidationRun: validationService.findLastValidationRun,
    findLastTaskCommandRun: validationService.findLastTaskCommandRun
  });
  return { validationService, validationCatalogService };
}
