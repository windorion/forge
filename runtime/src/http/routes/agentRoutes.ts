import { HttpError } from "../httpError.js";
import { readJson } from "../request.js";
import { writeHtml, writeJson } from "../response.js";
import { taskIDFromActionPath } from "../taskPath.js";
import type { AgentRunLoopControlRequest, ApprovePlanAndRunRequest, ApprovePlanRequest, ApproveValidationPresetRequest, CancelTaskCommandRequest, CreateTaskMessageRequest, CreateTaskRequest, EditProposalDecisionRequest, EditProposalFileReviewRequest, GitBranchPublishRequest, GitBranchRequest, GitConflictResolutionRequest, GitCreateCommitRequest, GitPullRequestPublishRequest, GitPullRequestStatusRequest, GitPushRequest, ModelProviderSettingsUpdateRequest, RerunRepairCommandRequest, RunAgentLoopRequest, RunAgentStepRequest, RunTaskCommandRequest, RunValidationRequest, SupervisedQueueDispatchRequest, TaskQueueReorderRequest, TaskQueueSettingsRequest } from "../../types.js";
import type { RuntimeRouteGroup, RuntimeRouteOptions } from "../runtimeRoutes.js";

export function createAgentRoutes(options: RuntimeRouteOptions): RuntimeRouteGroup {
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
  dispatchNextSupervisedAgentRun,
  runAgentLoopV0, requestAgentRunLoopControl, resumeAgentRunLoop,
  generateEditProposal, reviseEditProposal, generateValidationRepairProposal,
  validateEditProposal, applyEditProposal, rollbackEditProposal,
  reviewEditProposalFile, rejectEditProposal, approveValidationPreset,
  runValidation, runTaskCommand, rerunRepairCommand, cancelTaskCommand,
  emit
} = options;
  return async (request, response, url) => {
    if (request.method === "GET" && url.pathname === "/queue") {
          reloadObserverTasks();
          writeJson(response, 200, getTaskQueueSnapshot());
          return true;
        }

    if (request.method === "POST" && url.pathname === "/queue/settings") {
          const input = await readJson<TaskQueueSettingsRequest>(request);
          writeJson(response, 200, updateTaskQueueSettings(input));
          void dispatchQueuedAgentRuns();
          return true;
        }

    if (request.method === "POST" && url.pathname === "/queue/reorder") {
          const input = await readJson<TaskQueueReorderRequest>(request);
          writeJson(response, 200, reorderTaskQueue(input));
          return true;
    }

    if (request.method === "POST" && url.pathname === "/queue/dispatch-next") {
          const input = await readJson<SupervisedQueueDispatchRequest>(request);
          writeJson(response, 202, dispatchNextSupervisedAgentRun(input.authorizationID));
          return true;
        }

    const removeQueuedTaskID = taskIDFromActionPath(url.pathname, "remove-from-queue");
    if (request.method === "POST" && removeQueuedTaskID) {
          writeJson(response, 200, removeTaskFromQueue(removeQueuedTaskID));
          return true;
        }

    if (request.method === "POST" && url.pathname === "/maintenance/recover-stuck") {
          if (observerMode) {
            throw new HttpError(409, "Observer runtimes do not recover stalled work.");
          }
          writeJson(response, 200, recoverStuckAgentWork());
          return true;
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
          return true;
        }

    const runAgentStepTaskID = taskIDFromActionPath(url.pathname, "run-agent-step");
    if (request.method === "POST" && runAgentStepTaskID) {
          const input = await readJson<RunAgentStepRequest>(request);
          const task = await runAgentStep(runAgentStepTaskID, input);
          writeJson(response, 200, task);
          return true;
        }

    const runAgentLoopTaskID = taskIDFromActionPath(url.pathname, "run-agent-loop");
    if (request.method === "POST" && runAgentLoopTaskID) {
          const input = await readJson<RunAgentLoopRequest>(request);
          const task = await scheduleAgentRunLoop(runAgentLoopTaskID, input);
          writeJson(response, 200, task);
          return true;
        }

    const pauseAgentLoopTaskID = taskIDFromActionPath(url.pathname, "pause-agent-loop");
    if (request.method === "POST" && pauseAgentLoopTaskID) {
          const input = await readJson<AgentRunLoopControlRequest>(request);
          const task = requestAgentRunLoopControl(pauseAgentLoopTaskID, input, "Pause");
          writeJson(response, 200, task);
          return true;
        }

    const abortAgentLoopTaskID = taskIDFromActionPath(url.pathname, "abort-agent-loop");
    if (request.method === "POST" && abortAgentLoopTaskID) {
          const input = await readJson<AgentRunLoopControlRequest>(request);
          const task = requestAgentRunLoopControl(abortAgentLoopTaskID, input, "Abort");
          writeJson(response, 200, task);
          return true;
        }

    const resumeAgentLoopTaskID = taskIDFromActionPath(url.pathname, "resume-agent-loop");
    if (request.method === "POST" && resumeAgentLoopTaskID) {
          const input = await readJson<RunAgentLoopRequest>(request);
          const task = await resumeAgentRunLoop(resumeAgentLoopTaskID, input);
          writeJson(response, 200, task);
          return true;
        }
    return false;
  };
}
