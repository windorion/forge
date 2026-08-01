import { HttpError } from "../httpError.js";
import { readJson } from "../request.js";
import { writeHtml, writeJson } from "../response.js";
import { taskIDFromActionPath } from "../taskPath.js";
import type { AgentRunLoopControlRequest, ApprovePlanAndRunRequest, ApprovePlanRequest, ApproveValidationPresetRequest, CancelTaskCommandRequest, CreateTaskMessageRequest, CreateTaskRequest, EditProposalDecisionRequest, EditProposalFileReviewRequest, GitBranchPublishRequest, GitBranchRequest, GitConflictResolutionRequest, GitCreateCommitRequest, GitPullRequestPublishRequest, GitPullRequestStatusRequest, GitPushRequest, ModelProviderSettingsUpdateRequest, RerunRepairCommandRequest, RunAgentLoopRequest, RunAgentStepRequest, RunTaskCommandRequest, RunValidationRequest, TaskQueueReorderRequest, TaskQueueSettingsRequest } from "../../types.js";
import type { RuntimeRouteGroup, RuntimeRouteOptions } from "../runtimeRoutes.js";

export function createSettingsRoutes(options: RuntimeRouteOptions): RuntimeRouteGroup {
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
    if (request.method === "GET" && url.pathname === "/settings/model-provider") {
          writeJson(response, 200, {
            configuration: getModelProviderConfiguration(currentModelProviderSettings()),
            editableSettings: publicModelProviderRuntimeSettings(currentModelProviderSettings())
          });
          return true;
        }

    if (request.method === "POST" && url.pathname === "/settings/model-provider") {
          const input = await readJson<ModelProviderSettingsUpdateRequest>(request);
          const configuration = await updateModelProviderSettings(input);
          writeJson(response, 200, {
            configuration,
            editableSettings: publicModelProviderRuntimeSettings(currentModelProviderSettings())
          });
          return true;
        }
    return false;
  };
}
