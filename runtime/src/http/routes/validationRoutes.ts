import { HttpError } from "../httpError.js";
import { readJson } from "../request.js";
import { writeHtml, writeJson } from "../response.js";
import { taskIDFromActionPath } from "../taskPath.js";
import type { AgentRunLoopControlRequest, ApprovePlanAndRunRequest, ApprovePlanRequest, ApproveValidationPresetRequest, CancelTaskCommandRequest, CreateTaskMessageRequest, CreateTaskRequest, EditProposalDecisionRequest, EditProposalFileReviewRequest, GitBranchPublishRequest, GitBranchRequest, GitConflictResolutionRequest, GitCreateCommitRequest, GitPullRequestPublishRequest, GitPullRequestStatusRequest, GitPushRequest, ModelProviderSettingsUpdateRequest, RerunRepairCommandRequest, RunAgentLoopRequest, RunAgentStepRequest, RunTaskCommandRequest, RunValidationRequest, TaskQueueReorderRequest, TaskQueueSettingsRequest } from "../../types.js";
import type { RuntimeRouteGroup, RuntimeRouteOptions } from "../runtimeRoutes.js";

export function createValidationRoutes(options: RuntimeRouteOptions): RuntimeRouteGroup {
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
    if (request.method === "GET" && url.pathname === "/validation-presets") {
          const registry = await loadValidationPresetRegistry();
          writeJson(response, 200, {
            presets: listValidationPresets(registry),
            workspaceConfig: registry.workspaceConfig
          });
          return true;
        }

    const validationPermissionsTaskID = taskIDFromActionPath(url.pathname, "validation-permissions");
    if (request.method === "GET" && validationPermissionsTaskID) {
          writeJson(response, 200, await listValidationPermissions(validationPermissionsTaskID));
          return true;
        }

    const approveValidationPresetTaskID = taskIDFromActionPath(url.pathname, "approve-validation-preset");
    if (request.method === "POST" && approveValidationPresetTaskID) {
          const input = await readJson<ApproveValidationPresetRequest>(request);
          const task = await approveValidationPreset(approveValidationPresetTaskID, input);
          writeJson(response, 200, task);
          return true;
        }

    const runValidationTaskID = taskIDFromActionPath(url.pathname, "run-validation");
    if (request.method === "POST" && runValidationTaskID) {
          const input = await readJson<RunValidationRequest>(request);
          const task = await runValidation(runValidationTaskID, "Manual", input.presetID);
          writeJson(response, 200, task);
          return true;
        }

    const runTaskCommandTaskID = taskIDFromActionPath(url.pathname, "run-task-command");
    if (request.method === "POST" && runTaskCommandTaskID) {
          const input = await readJson<RunTaskCommandRequest>(request);
          const task = await runTaskCommand(runTaskCommandTaskID, input);
          writeJson(response, 200, task);
          return true;
        }

    const rerunRepairCommandTaskID = taskIDFromActionPath(url.pathname, "rerun-repair-command");
    if (request.method === "POST" && rerunRepairCommandTaskID) {
          const input = await readJson<RerunRepairCommandRequest>(request);
          const task = await rerunRepairCommand(rerunRepairCommandTaskID, input);
          writeJson(response, 200, task);
          return true;
        }

    const cancelTaskCommandTaskID = taskIDFromActionPath(url.pathname, "cancel-task-command");
    if (request.method === "POST" && cancelTaskCommandTaskID) {
          const input = await readJson<CancelTaskCommandRequest>(request);
          const task = await cancelTaskCommand(cancelTaskCommandTaskID, input);
          writeJson(response, 200, task);
          return true;
        }
    return false;
  };
}
