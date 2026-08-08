import { HttpError } from "../httpError.js";
import { readJson } from "../request.js";
import { writeHtml, writeJson } from "../response.js";
import { taskIDFromActionPath } from "../taskPath.js";
import type { AgentRunLoopControlRequest, ApprovePlanAndRunRequest, ApprovePlanRequest, ApproveValidationPresetRequest, CancelTaskCommandRequest, CancelTaskRequest, CreateTaskMessageRequest, CreateTaskRequest, EditProposalDecisionRequest, EditProposalFileReviewRequest, GitBranchPublishRequest, GitBranchRequest, GitConflictResolutionRequest, GitCreateCommitRequest, GitPullRequestPublishRequest, GitPullRequestStatusRequest, GitPushRequest, ModelProviderSettingsUpdateRequest, RerunRepairCommandRequest, RunAgentLoopRequest, RunAgentStepRequest, RunTaskCommandRequest, RunValidationRequest, TaskQueueReorderRequest, TaskQueueSettingsRequest } from "../../types.js";
import type { RuntimeRouteGroup, RuntimeRouteOptions } from "../runtimeRoutes.js";
import { buildTaskAuditExport, type TaskAuditExportFormat } from "../../tasks/taskAuditExport.js";

export function createTaskRoutes(options: RuntimeRouteOptions): RuntimeRouteGroup {
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
  runValidation, runTaskCommand, rerunRepairCommand, cancelTaskCommand, cancelTask,
  emit
} = options;
  return async (request, response, url) => {
    if (request.method === "GET" && url.pathname === "/tasks") {
          reloadObserverTasks();
          writeJson(response, 200, { tasks: listTasks() });
          return true;
        }

    const auditExportTaskID = taskIDFromActionPath(url.pathname, "audit-export");
    if (request.method === "GET" && auditExportTaskID) {
          reloadObserverTasks();
          const task = tasks.get(auditExportTaskID);
          if (!task) throw new HttpError(404, `Task not found: ${auditExportTaskID}`);
          const rawFormat = url.searchParams.get("format") ?? "markdown";
          if (rawFormat !== "json" && rawFormat !== "markdown") {
            throw new HttpError(400, "Audit export format must be json or markdown.");
          }
          writeJson(response, 200, buildTaskAuditExport(task, rawFormat as TaskAuditExportFormat));
          return true;
        }

    const createMessageTaskID = taskIDFromActionPath(url.pathname, "messages");
    if (request.method === "POST" && createMessageTaskID) {
          const input = await readJson<CreateTaskMessageRequest>(request);
          const task = await createTaskMessage(createMessageTaskID, input);
          writeJson(response, 201, task);
          return true;
        }

    const generatePlanRevisionTaskID = taskIDFromActionPath(url.pathname, "generate-plan-revision");
    if (request.method === "POST" && generatePlanRevisionTaskID) {
          const task = await generatePlanRevision(generatePlanRevisionTaskID);
          writeJson(response, 200, task);
          return true;
        }

    if (request.method === "POST" && url.pathname === "/tasks") {
          const input = await readJson<CreateTaskRequest>(request);
          const task = await createTask(input);
          tasks.set(task.id, task);
          taskStore.saveTask(task);
          emit("task.created", { taskID: task.id, title: task.title, task });
          runAgentLoopV0(task.id);
          writeJson(response, 201, task);
          return true;
        }

    const approvePlanTaskID = taskIDFromActionPath(url.pathname, "approve-plan");
    if (request.method === "POST" && approvePlanTaskID) {
          const input = await readJson<ApprovePlanRequest>(request);
          const task = await approvePlan(approvePlanTaskID, input);
          writeJson(response, 200, task);
          return true;
        }

    const cancelTaskID = taskIDFromActionPath(url.pathname, "cancel");
    if (request.method === "POST" && cancelTaskID) {
          const input = await readJson<CancelTaskRequest>(request);
          const task = await cancelTask(cancelTaskID, input);
          writeJson(response, 200, task);
          return true;
        }
    return false;
  };
}
