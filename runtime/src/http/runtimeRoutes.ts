import { createRequestHandler } from "./createRequestHandler.js";
import { HttpError } from "./httpError.js";
import { readJson } from "./request.js";
import { writeHtml, writeJson } from "./response.js";
import { taskIDFromActionPath } from "./taskPath.js";
import type { createAgentOrchestrationService } from "../agent/agentOrchestrationService.js";
import type { createLegacyAgentLoopService } from "../agent/legacyAgentLoopService.js";
import type { createEditProposalService } from "../edits/editProposalService.js";
import type { RuntimeEventBus } from "../events/runtimeEventBus.js";
import type { createGitConflictService } from "../git/gitConflictService.js";
import type { createGitDiffService } from "../git/gitDiffService.js";
import type { createGitStatusService } from "../git/gitStatusService.js";
import type { createGitWorkflowService } from "../git/gitWorkflowService.js";
import type { ModelProvider } from "../modelProvider.js";
import type { createRepositoryContextService } from "../repository/repositoryContextService.js";
import type { createModelProviderSettingsService } from "../runtime/modelProviderSettingsService.js";
import type { SqliteTaskStore } from "../taskStore.js";
import type { createTaskService } from "../tasks/taskService.js";
import type { createTaskState } from "../tasks/taskState.js";
import type { createValidationCatalogService } from "../validation/validationCatalogService.js";
import type { createValidationService } from "../validation/validationService.js";
import type {
  AgentRunLoopControlRequest,
  ApprovePlanAndRunRequest,
  ApprovePlanRequest,
  ApproveValidationPresetRequest,
  CancelTaskCommandRequest,
  CreateTaskMessageRequest,
  CreateTaskRequest,
  EditProposalDecisionRequest,
  EditProposalFileReviewRequest,
  GitBranchPublishRequest,
  GitBranchRequest,
  GitConflictResolutionRequest,
  GitCreateCommitRequest,
  GitPullRequestPublishRequest,
  GitPullRequestStatusRequest,
  GitPushRequest,
  ModelProviderSettingsUpdateRequest,
  RerunRepairCommandRequest,
  RunAgentLoopRequest,
  RunAgentStepRequest,
  RunTaskCommandRequest,
  RunValidationRequest,
  TaskQueueReorderRequest,
  TaskQueueSettingsRequest
} from "../types.js";

type RuntimeRouteOptions =
  ReturnType<typeof createGitStatusService> &
  ReturnType<typeof createGitDiffService> &
  ReturnType<typeof createGitConflictService> &
  ReturnType<typeof createGitWorkflowService> &
  ReturnType<typeof createTaskService> &
  ReturnType<typeof createAgentOrchestrationService> &
  ReturnType<typeof createLegacyAgentLoopService> &
  ReturnType<typeof createEditProposalService> &
  ReturnType<typeof createValidationService> &
  ReturnType<typeof createValidationCatalogService> &
  ReturnType<typeof createRepositoryContextService> &
  ReturnType<typeof createModelProviderSettingsService> &
  ReturnType<typeof createTaskState> & {
    observerMode: boolean;
    runtimeAuthorizationID?: string;
    runtimeAuthorizedAt?: string;
    startedAt: number;
    runtimeDir: string;
    repoRoot: string;
    repoRootSource: string;
    taskStore: SqliteTaskStore;
    tasks: Map<string, import("../types.js").ForgeTask>;
    eventBus: RuntimeEventBus;
    currentModelProvider: () => ModelProvider;
    currentModelProviderSettings: () => import("../types.js").ModelProviderRuntimeSettings;
    renderRuntimeHome: () => string;
    getModelProviderConfiguration: (settings: import("../types.js").ModelProviderRuntimeSettings) => unknown;
  };

export function createRuntimeRoutes(options: RuntimeRouteOptions) {
const {
  observerMode, runtimeAuthorizationID, runtimeAuthorizedAt, startedAt,
  runtimeDir, repoRoot, repoRootSource, taskStore, tasks, eventBus,
  currentModelProvider, currentModelProviderSettings,
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
  scheduleAgentRunLoop, dispatchQueuedAgentRuns, runAgentStep,
  runAgentLoopV0, requestAgentRunLoopControl, resumeAgentRunLoop,
  generateEditProposal, reviseEditProposal, generateValidationRepairProposal,
  validateEditProposal, applyEditProposal, rollbackEditProposal,
  reviewEditProposalFile, rejectEditProposal, approveValidationPreset,
  runValidation, runTaskCommand, rerunRepairCommand, cancelTaskCommand,
  saveTask, emit
} = options;

return createRequestHandler({
  observerMode,
  handle: async (request, response, url) => {
    if (request.method === "GET" && url.pathname === "/") {
      writeHtml(response, 200, renderRuntimeHome());
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        ok: true,
        service: "forge-runtime",
        version: "0.1.0",
        runtimeMode: observerMode ? "observer" : "primary",
        readOnly: observerMode,
        runtimeAuthorization: runtimeAuthorizationID && runtimeAuthorizedAt
          ? { id: runtimeAuthorizationID, authorizedAt: runtimeAuthorizedAt, scope: "repository-active" }
          : undefined,
        uptimeSeconds: (Date.now() - startedAt) / 1000,
        modelProvider: currentModelProvider().info,
        modelProviderConfiguration: getModelProviderConfiguration(currentModelProviderSettings()),
        workspace: {
          runtimeDir,
          repoRoot,
          repoRootSource
        },
        persistence: {
          databasePath: taskStore.dbPath,
          taskCount: tasks.size
        },
        index: observerMode ? undefined : (() => {
          const status = readRepositoryIndexStatus();
          return { fileCount: status.fileCount, lastIndexedAt: status.lastIndexedAt, inSync: status.inSync };
        })()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/tasks") {
      reloadObserverTasks();
      writeJson(response, 200, { tasks: listTasks() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/index") {
      writeJson(response, 200, readRepositoryIndexStatus());
      return;
    }

    if (request.method === "POST" && url.pathname === "/index/rebuild") {
      const result = await indexRepository();
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/index/symbols") {
      const query = url.searchParams.get("q") ?? "";
      const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
      writeJson(response, 200, { query, symbols: taskStore.searchSymbols(query, limit) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/queue") {
      reloadObserverTasks();
      writeJson(response, 200, getTaskQueueSnapshot());
      return;
    }

    if (request.method === "POST" && url.pathname === "/queue/settings") {
      const input = await readJson<TaskQueueSettingsRequest>(request);
      writeJson(response, 200, updateTaskQueueSettings(input));
      void dispatchQueuedAgentRuns();
      return;
    }

    if (request.method === "POST" && url.pathname === "/queue/reorder") {
      const input = await readJson<TaskQueueReorderRequest>(request);
      writeJson(response, 200, reorderTaskQueue(input));
      return;
    }

    const removeQueuedTaskID = taskIDFromActionPath(url.pathname, "remove-from-queue");
    if (request.method === "POST" && removeQueuedTaskID) {
      writeJson(response, 200, removeTaskFromQueue(removeQueuedTaskID));
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

    if (request.method === "GET" && url.pathname === "/git/conflicts") {
      writeJson(response, 200, await getGitConflictSnapshot());
      return;
    }

    if (request.method === "POST" && url.pathname === "/git/conflicts/resolve") {
      const input = await readJson<GitConflictResolutionRequest>(request);
      writeJson(response, 200, await resolveGitConflict(input));
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

    if (request.method === "POST" && url.pathname === "/git/pr-publish") {
      const input = await readJson<GitPullRequestPublishRequest>(request);
      writeJson(response, 200, await publishGitPullRequest(input));
      return;
    }

    // Run the stalled-work sweep on demand. The same sweep runs periodically;
    // this exposes it for operators and makes it deterministically testable.
    if (request.method === "POST" && url.pathname === "/maintenance/recover-stuck") {
      if (observerMode) {
        throw new HttpError(409, "Observer runtimes do not recover stalled work.");
      }
      writeJson(response, 200, recoverStuckAgentWork());
      return;
    }

    // POST (not GET) so the token stays out of the URL/query string.
    if (request.method === "POST" && url.pathname === "/git/pr-status") {
      const input = await readJson<GitPullRequestStatusRequest>(request);
      writeJson(response, 200, await refreshGitPullRequestStatus(input));
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
        configuration: getModelProviderConfiguration(currentModelProviderSettings()),
        editableSettings: publicModelProviderRuntimeSettings(currentModelProviderSettings())
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/settings/model-provider") {
      const input = await readJson<ModelProviderSettingsUpdateRequest>(request);
      const configuration = await updateModelProviderSettings(input);
      writeJson(response, 200, {
        configuration,
        editableSettings: publicModelProviderRuntimeSettings(currentModelProviderSettings())
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

    const approvePlanAndRunTaskID = taskIDFromActionPath(url.pathname, "approve-plan-and-run");
    if (request.method === "POST" && approvePlanAndRunTaskID) {
      const input = await readJson<ApprovePlanAndRunRequest>(request);
      await approvePlan(approvePlanAndRunTaskID, input);
      const task = await scheduleAgentRunLoop(approvePlanAndRunTaskID, {
        preferredCommandID: input.preferredCommandID,
        maxSteps: input.maxSteps ?? 6
      });
      writeJson(response, 200, task);
      return;
    }

    const runAgentStepTaskID = taskIDFromActionPath(url.pathname, "run-agent-step");
    if (request.method === "POST" && runAgentStepTaskID) {
      const input = await readJson<RunAgentStepRequest>(request);
      const task = await runAgentStep(runAgentStepTaskID, input);
      writeJson(response, 200, task);
      return;
    }

    const runAgentLoopTaskID = taskIDFromActionPath(url.pathname, "run-agent-loop");
    if (request.method === "POST" && runAgentLoopTaskID) {
      const input = await readJson<RunAgentLoopRequest>(request);
      const task = await scheduleAgentRunLoop(runAgentLoopTaskID, input);
      writeJson(response, 200, task);
      return;
    }

    const pauseAgentLoopTaskID = taskIDFromActionPath(url.pathname, "pause-agent-loop");
    if (request.method === "POST" && pauseAgentLoopTaskID) {
      const input = await readJson<AgentRunLoopControlRequest>(request);
      const task = requestAgentRunLoopControl(pauseAgentLoopTaskID, input, "Pause");
      writeJson(response, 200, task);
      return;
    }

    const abortAgentLoopTaskID = taskIDFromActionPath(url.pathname, "abort-agent-loop");
    if (request.method === "POST" && abortAgentLoopTaskID) {
      const input = await readJson<AgentRunLoopControlRequest>(request);
      const task = requestAgentRunLoopControl(abortAgentLoopTaskID, input, "Abort");
      writeJson(response, 200, task);
      return;
    }

    const resumeAgentLoopTaskID = taskIDFromActionPath(url.pathname, "resume-agent-loop");
    if (request.method === "POST" && resumeAgentLoopTaskID) {
      const input = await readJson<RunAgentLoopRequest>(request);
      const task = await resumeAgentRunLoop(resumeAgentLoopTaskID, input);
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

    const reviewEditProposalFileTaskID = taskIDFromActionPath(url.pathname, "review-edit-proposal-file");
    if (request.method === "POST" && reviewEditProposalFileTaskID) {
      const input = await readJson<EditProposalFileReviewRequest>(request);
      const task = await reviewEditProposalFile(reviewEditProposalFileTaskID, input);
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

    const rerunRepairCommandTaskID = taskIDFromActionPath(url.pathname, "rerun-repair-command");
    if (request.method === "POST" && rerunRepairCommandTaskID) {
      const input = await readJson<RerunRepairCommandRequest>(request);
      const task = await rerunRepairCommand(rerunRepairCommandTaskID, input);
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
      eventBus.openEventStream(response);
      return;
    }

    writeJson(response, 404, { error: "not_found" });
  }
});

}
