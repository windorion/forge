import { createAgentLoopService } from "./agentLoopService.js";
import type { AgentOrchestrationOptions } from "./agentOrchestrationTypes.js";
import { createAgentRecoveryService } from "./agentRecoveryService.js";
import { createAgentRuntimeState } from "./agentRuntimeState.js";
import { createAgentStepService } from "./agentStepService.js";
import { createQueueService } from "./queueService.js";
import { createRepositoryInspectionService } from "./repositoryInspectionService.js";

export function createAgentOrchestrationService(options: AgentOrchestrationOptions) {
  const state = createAgentRuntimeState();
  let loopService: ReturnType<typeof createAgentLoopService>;
  let stepService: ReturnType<typeof createAgentStepService>;

  const queueService = createQueueService({
    ...options,
    state,
    runAgentLoop: (taskID, input) => loopService.runAgentLoop(taskID, input),
    normalizeAgentRunLoopMaxSteps: (value) => loopService.normalizeAgentRunLoopMaxSteps(value),
    withCreatedAt: (runtimeEvent, createdAt) => loopService.withCreatedAt(runtimeEvent, createdAt)
  });

  const inspectionService = createRepositoryInspectionService({
    ...options,
    blockAgentRunStep: (task, step, summary) => stepService.blockAgentRunStep(task, step, summary),
    completeAgentRunStepAfterAction: (task, stepID, summary, targetID) =>
      stepService.completeAgentRunStepAfterAction(task, stepID, summary, targetID)
  });

  stepService = createAgentStepService({
    ...options,
    state,
    executeRepositoryInspectionStep: inspectionService.executeRepositoryInspectionStep
  });

  loopService = createAgentLoopService({
    ...options,
    state,
    runAgentStep: stepService.runAgentStep,
    dispatchQueuedAgentRuns: queueService.dispatchQueuedAgentRuns,
    scheduleAgentRunLoop: queueService.scheduleAgentRunLoop
  });

  const recoveryService = createAgentRecoveryService(options);

  return {
    ...queueService,
    requestAgentRunLoopControl: loopService.requestAgentRunLoopControl,
    resumeAgentRunLoop: loopService.resumeAgentRunLoop,
    ...recoveryService,
    runAgentStep: stepService.runAgentStep
  };
}
