import { HttpError } from "../httpError.js";
import { readJson } from "../request.js";
import { writeHtml, writeJson } from "../response.js";
import { taskIDFromActionPath } from "../taskPath.js";
import type { AgentRunLoopControlRequest, ApprovePlanAndRunRequest, ApprovePlanRequest, ApproveValidationPresetRequest, CancelTaskCommandRequest, CreateTaskMessageRequest, CreateTaskRequest, EditProposalDecisionRequest, EditProposalFileReviewRequest, GitBranchPublishRequest, GitBranchRequest, GitConflictResolutionRequest, GitCreateCommitRequest, GitPullRequestPublishRequest, GitPullRequestStatusRequest, GitPushRequest, ModelProviderSettingsUpdateRequest, RerunRepairCommandRequest, RunAgentLoopRequest, RunAgentStepRequest, RunTaskCommandRequest, RunValidationRequest, TaskQueueReorderRequest, TaskQueueSettingsRequest } from "../../types.js";
import type { RuntimeRouteGroup, RuntimeRouteOptions } from "../runtimeRoutes.js";

export function createEditRoutes(options: RuntimeRouteOptions): RuntimeRouteGroup {
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
    const generateEditProposalTaskID = taskIDFromActionPath(url.pathname, "generate-edit-proposal");
    if (request.method === "POST" && generateEditProposalTaskID) {
          const task = await generateEditProposal(generateEditProposalTaskID);
          writeJson(response, 200, task);
          return true;
        }

    const reviseEditProposalTaskID = taskIDFromActionPath(url.pathname, "revise-edit-proposal");
    if (request.method === "POST" && reviseEditProposalTaskID) {
          const task = await reviseEditProposal(reviseEditProposalTaskID);
          writeJson(response, 200, task);
          return true;
        }

    const generateValidationRepairProposalTaskID = taskIDFromActionPath(url.pathname, "generate-validation-repair-proposal");
    if (request.method === "POST" && generateValidationRepairProposalTaskID) {
          const task = await generateValidationRepairProposal(generateValidationRepairProposalTaskID);
          writeJson(response, 200, task);
          return true;
        }

    const validateEditProposalTaskID = taskIDFromActionPath(url.pathname, "validate-edit-proposal");
    if (request.method === "POST" && validateEditProposalTaskID) {
          const task = await validateEditProposal(validateEditProposalTaskID);
          writeJson(response, 200, task);
          return true;
        }

    const reviewEditProposalFileTaskID = taskIDFromActionPath(url.pathname, "review-edit-proposal-file");
    if (request.method === "POST" && reviewEditProposalFileTaskID) {
          const input = await readJson<EditProposalFileReviewRequest>(request);
          const task = await reviewEditProposalFile(reviewEditProposalFileTaskID, input);
          writeJson(response, 200, task);
          return true;
        }

    const applyEditProposalTaskID = taskIDFromActionPath(url.pathname, "apply-edit-proposal");
    if (request.method === "POST" && applyEditProposalTaskID) {
          const input = await readJson<EditProposalDecisionRequest>(request);
          const task = await applyEditProposal(applyEditProposalTaskID, input);
          writeJson(response, 200, task);
          return true;
        }

    const rollbackEditProposalTaskID = taskIDFromActionPath(url.pathname, "rollback-edit-proposal");
    if (request.method === "POST" && rollbackEditProposalTaskID) {
          const input = await readJson<EditProposalDecisionRequest>(request);
          const task = await rollbackEditProposal(rollbackEditProposalTaskID, input);
          writeJson(response, 200, task);
          return true;
        }

    const rejectEditProposalTaskID = taskIDFromActionPath(url.pathname, "reject-edit-proposal");
    if (request.method === "POST" && rejectEditProposalTaskID) {
          const input = await readJson<EditProposalDecisionRequest>(request);
          const task = rejectEditProposal(rejectEditProposalTaskID, input);
          writeJson(response, 200, task);
          return true;
        }
    return false;
  };
}
