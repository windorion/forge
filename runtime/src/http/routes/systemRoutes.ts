import { HttpError } from "../httpError.js";
import { readJson } from "../request.js";
import { writeHtml, writeJson } from "../response.js";
import { taskIDFromActionPath } from "../taskPath.js";
import type { AgentRunLoopControlRequest, ApprovePlanAndRunRequest, ApprovePlanRequest, ApproveValidationPresetRequest, CancelTaskCommandRequest, CreateTaskMessageRequest, CreateTaskRequest, EditProposalDecisionRequest, EditProposalFileReviewRequest, GitBranchPublishRequest, GitBranchRequest, GitConflictResolutionRequest, GitCreateCommitRequest, GitPullRequestPublishRequest, GitPullRequestStatusRequest, GitPushRequest, ModelProviderSettingsUpdateRequest, RerunRepairCommandRequest, RunAgentLoopRequest, RunAgentStepRequest, RunTaskCommandRequest, RunValidationRequest, TaskQueueReorderRequest, TaskQueueSettingsRequest } from "../../types.js";
import type { RuntimeRouteGroup, RuntimeRouteOptions } from "../runtimeRoutes.js";

export function createSystemRoutes(options: RuntimeRouteOptions): RuntimeRouteGroup {
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
  emit
} = options;
  return async (request, response, url) => {
    if (request.method === "GET" && url.pathname === "/") {
          writeHtml(response, 200, renderRuntimeHome());
          return true;
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
          return true;
        }

    if (request.method === "GET" && url.pathname === "/index") {
          writeJson(response, 200, readRepositoryIndexStatus());
          return true;
        }

    if (request.method === "POST" && url.pathname === "/index/rebuild") {
          const result = await indexRepository();
          writeJson(response, 200, result);
          return true;
        }

    if (request.method === "GET" && url.pathname === "/index/symbols") {
          const query = url.searchParams.get("q") ?? "";
          const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
          writeJson(response, 200, { query, symbols: taskStore.searchSymbols(query, limit) });
          return true;
        }

    if (request.method === "GET" && url.pathname === "/events") {
          eventBus.openEventStream(response);
          return true;
        }
    return false;
  };
}
