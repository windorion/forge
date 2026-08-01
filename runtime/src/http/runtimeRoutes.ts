import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { createRequestHandler } from "./createRequestHandler.js";
import { writeJson } from "./response.js";
import { createAgentRoutes } from "./routes/agentRoutes.js";
import { createEditRoutes } from "./routes/editRoutes.js";
import { createGitRoutes } from "./routes/gitRoutes.js";
import { createSettingsRoutes } from "./routes/settingsRoutes.js";
import { createSystemRoutes } from "./routes/systemRoutes.js";
import { createTaskRoutes } from "./routes/taskRoutes.js";
import { createValidationRoutes } from "./routes/validationRoutes.js";
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
export type RuntimeRouteOptions =
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

export type RuntimeRouteGroup = (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<boolean>;

export function createRuntimeRoutes(options: RuntimeRouteOptions) {
  const routeGroups = [
    createSystemRoutes(options),
    createTaskRoutes(options),
    createAgentRoutes(options),
    createEditRoutes(options),
    createValidationRoutes(options),
    createGitRoutes(options),
    createSettingsRoutes(options)
  ];

  return createRequestHandler({
    observerMode: options.observerMode,
    handle: async (request, response, url) => {
      for (const routeGroup of routeGroups) {
        if (await routeGroup(request, response, url)) return;
      }
      writeJson(response, 404, { error: "not_found" });
    }
  });
}
