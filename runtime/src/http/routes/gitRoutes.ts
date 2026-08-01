import { HttpError } from "../httpError.js";
import { readJson } from "../request.js";
import { writeHtml, writeJson } from "../response.js";
import { taskIDFromActionPath } from "../taskPath.js";
import type { AgentRunLoopControlRequest, ApprovePlanAndRunRequest, ApprovePlanRequest, ApproveValidationPresetRequest, CancelTaskCommandRequest, CreateTaskMessageRequest, CreateTaskRequest, EditProposalDecisionRequest, EditProposalFileReviewRequest, GitBranchPublishRequest, GitBranchRequest, GitConflictResolutionRequest, GitCreateCommitRequest, GitPullRequestPublishRequest, GitPullRequestStatusRequest, GitPushRequest, ModelProviderSettingsUpdateRequest, RerunRepairCommandRequest, RunAgentLoopRequest, RunAgentStepRequest, RunTaskCommandRequest, RunValidationRequest, TaskQueueReorderRequest, TaskQueueSettingsRequest } from "../../types.js";
import type { RuntimeRouteGroup, RuntimeRouteOptions } from "../runtimeRoutes.js";

export function createGitRoutes(options: RuntimeRouteOptions): RuntimeRouteGroup {
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
    if (request.method === "GET" && url.pathname === "/git/status") {
          writeJson(response, 200, await getGitStatusSnapshot());
          return true;
        }

    if (request.method === "GET" && url.pathname === "/git/diff") {
          writeJson(response, 200, await getGitFileDiff(url.searchParams.get("path")));
          return true;
        }

    if (request.method === "GET" && url.pathname === "/git/conflicts") {
          writeJson(response, 200, await getGitConflictSnapshot());
          return true;
        }

    if (request.method === "POST" && url.pathname === "/git/conflicts/resolve") {
          const input = await readJson<GitConflictResolutionRequest>(request);
          writeJson(response, 200, await resolveGitConflict(input));
          return true;
        }

    if (request.method === "GET" && url.pathname === "/git/commit-preview") {
          writeJson(response, 200, await getGitCommitPreview(url.searchParams.get("taskID")));
          return true;
        }

    if (request.method === "GET" && url.pathname === "/git/branch-preview") {
          writeJson(response, 200, await getGitBranchPreview(
            url.searchParams.get("taskID"),
            url.searchParams.get("targetBranch")
          ));
          return true;
        }

    if (request.method === "POST" && url.pathname === "/git/branch") {
          const input = await readJson<GitBranchRequest>(request);
          writeJson(response, 200, await createOrSwitchGitBranch(input));
          return true;
        }

    if (request.method === "GET" && url.pathname === "/git/branch-publish-preview") {
          writeJson(response, 200, await getGitBranchPublishPreview(
            url.searchParams.get("taskID"),
            url.searchParams.get("remote"),
            url.searchParams.get("remoteBranch")
          ));
          return true;
        }

    if (request.method === "POST" && url.pathname === "/git/branch-publish") {
          const input = await readJson<GitBranchPublishRequest>(request);
          writeJson(response, 200, await publishGitBranch(input));
          return true;
        }

    if (request.method === "POST" && url.pathname === "/git/commit") {
          const input = await readJson<GitCreateCommitRequest>(request);
          writeJson(response, 201, await createGitCommit(input));
          return true;
        }

    if (request.method === "GET" && url.pathname === "/git/push-preview") {
          writeJson(response, 200, await getGitPushPreview(url.searchParams.get("taskID")));
          return true;
        }

    if (request.method === "POST" && url.pathname === "/git/push") {
          const input = await readJson<GitPushRequest>(request);
          writeJson(response, 200, await pushGitBranch(input));
          return true;
        }

    if (request.method === "GET" && url.pathname === "/git/pr-preview") {
          writeJson(response, 200, await getGitPullRequestPreview(url.searchParams.get("taskID")));
          return true;
        }

    if (request.method === "POST" && url.pathname === "/git/pr-publish") {
          const input = await readJson<GitPullRequestPublishRequest>(request);
          writeJson(response, 200, await publishGitPullRequest(input));
          return true;
        }

    if (request.method === "POST" && url.pathname === "/git/pr-status") {
          const input = await readJson<GitPullRequestStatusRequest>(request);
          writeJson(response, 200, await refreshGitPullRequestStatus(input));
          return true;
        }
    return false;
  };
}
