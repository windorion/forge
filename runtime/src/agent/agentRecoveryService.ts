import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import { repositoryInspectionSubsumedBy } from "../inspectionGuard.js";
import {
  AgentRunStepProviderError,
  type ModelProvider,
  type PlanContextRequestResult
} from "../modelProvider.js";
import { detectStuckWork, type StuckFinding, type StuckThresholds } from "../stuckDetection.js";
import type {
  AgentRunLoop,
  AgentRunLoopControlRequest,
  AgentRunStep,
  AgentRunStepDecision,
  AgentState,
  CommandRerunEvidence,
  ContextFile,
  ForgeTask,
  PlanStep,
  RunAgentLoopRequest,
  RunAgentStepRequest,
  RuntimeEvent,
  TaskCommandPermission,
  TaskQueueReorderRequest,
  TaskQueueSettingsRequest,
  TaskQueueSnapshot,
  ValidationRepairBrief
} from "../types.js";
import type { InternalValidationPreset } from "../validation/validationCatalogService.js";

interface RepositorySearchMatch {
  path: string;
  score: number;
  reasons: string[];
  matchedLines: string[];
}


import type { AgentOrchestrationOptions, RunAgentStepOptions } from "./agentOrchestrationTypes.js";
import type { AgentRuntimeState } from "./agentRuntimeState.js";

export function createAgentRecoveryService(options: AgentOrchestrationOptions) {
const {
  tasks,
  modelProvider: currentModelProvider,
  taskQueueSettingsPath,
  taskQueueSmokeDelayMs,
  stuckThresholds,
  repositoryScanMaxFiles,
  repositorySearchMaxFiles,
  repositoryContextMaxFiles,
  saveTask,
  saveAndBroadcast,
  emit,
  event,
  setAgent,
  upsertPlanStep,
  hasRunningValidationRun,
  hasRunningTaskCommandRun,
  loadValidationPresetRegistry,
  buildTaskCommandPermissions,
  generateEditProposal,
  generateValidationRepairProposal,
  runTaskCommand,
  rerunRepairCommand,
  latestRunnableCommandRerunEvidence,
  listRepositoryFiles,
  normalizeProviderSearchTerms,
  normalizeProviderReadPaths,
  searchRepositoryWithRipgrep,
  explicitContextPathsForTask,
  buildContextFiles,
  mergeContextFiles,
  runTool,
  formatPathList
} = options;


function recoverInterruptedAgentRunLoopsOnStartup(): void {
  const recoveredAt = new Date().toISOString();
  for (const task of tasks.values()) {
    const interruptedLoops = task.agentRunLoops.filter((loop) => loop.status === "Running");
    if (interruptedLoops.length === 0) {
      continue;
    }

    for (const loop of interruptedLoops) {
      loop.status = "Paused";
      loop.stopReason = "RuntimeRestarted";
      loop.completedAt = recoveredAt;
      loop.summary = `Runtime restarted while agent loop ${loop.id} was running. Forge recovered it as a resumable safe checkpoint.`;
      delete loop.controlState;
      delete loop.controlRequestedAt;

      for (const stepID of loop.stepIDs) {
        const step = task.agentRunSteps.find((candidate) => candidate.id === stepID);
        if (step?.status === "Running") {
          step.status = "Failed";
          step.completedAt = recoveredAt;
          step.error = "Runtime restarted before this agent step reached a terminal state.";
          step.resultSummary = step.error;
        }
      }
    }

    for (const run of task.taskCommandRuns) {
      if (run.status === "Running") {
        run.status = "Failed";
        run.endedAt = recoveredAt;
        run.outputSummary = "Runtime restarted before the task command reached a terminal state.";
        run.outputChunks.push({
          id: randomUUID(),
          stream: "system",
          text: `${run.outputSummary}\n`,
          createdAt: recoveredAt
        });
      }
    }
    for (const run of task.validationRuns) {
      if (run.status === "Running") {
        run.status = "Failed";
        run.endedAt = recoveredAt;
        run.summary = "Runtime restarted before validation reached a terminal state.";
        for (const command of run.commands) {
          if (command.status === "Running") {
            command.status = "Failed";
            command.endedAt = recoveredAt;
            command.outputSummary = run.summary;
          }
        }
      }
    }
    for (const evidence of task.commandRerunEvidence) {
      if (evidence.status === "Running") {
        evidence.status = "Failed";
        evidence.updatedAt = recoveredAt;
        evidence.summary = "Runtime restarted before repaired-command verification completed.";
      }
    }
    for (const toolCall of task.toolCalls) {
      if (toolCall.status === "Started") {
        toolCall.status = "Failed";
        toolCall.endedAt = recoveredAt;
        toolCall.outputSummary = "Runtime restarted before the tool call reached a terminal state.";
      }
    }

    const latestLoop = interruptedLoops.at(-1) as AgentRunLoop;
    task.status = "Human Review";
    task.currentPhase = "Agent Loop Interrupted";
    task.reviewSummary = latestLoop.summary;
    setAgent(task, "Manager", "Ready", "Recovered interrupted agent loop at startup.");
    setAgent(task, "Coder", "Idle", "No in-flight process was resumed after runtime restart.");
    setAgent(task, "Reviewer", "Active", "Review the interrupted checkpoint before resuming.");
    upsertPlanStep(task, {
      id: "run-agent-loop",
      title: "Run agent loop",
      status: "Blocked",
      summary: latestLoop.summary
    });
    const recoveredEvent = event("agent.run_loop.interrupted", latestLoop.summary);
    recoveredEvent.createdAt = recoveredAt;
    task.events.push(recoveredEvent);
    task.updatedAt = recoveredAt;
    tasks.set(task.id, task);
    saveTask(task);
  }
}


/**
 * Live watchdog for wedged agent work. Per-command timeouts cover a command
 * that runs too long, and startup recovery covers a crash — but a running
 * runtime whose step never settles (a stalled provider socket, a tool that
 * never returns) had nothing watching it. This finalizes such work at a safe,
 * resumable checkpoint: it only rewrites task state, never files, and always
 * lands in Human Review rather than continuing autonomously.
 */
function recoverStuckAgentWork(nowISO: string = new Date().toISOString()): {
  generatedAt: string;
  recovered: { taskID: string; findings: StuckFinding[] }[];
} {
  const recovered: { taskID: string; findings: StuckFinding[] }[] = [];

  for (const task of tasks.values()) {
    const findings = detectStuckWork(task, nowISO, stuckThresholds);
    if (findings.length === 0) {
      continue;
    }

    const byKind = (kind: StuckFinding["kind"]) => new Map(
      findings.filter((finding) => finding.kind === kind).map((finding) => [finding.id, finding])
    );
    const stuckSteps = byKind("AgentRunStep");
    const stuckLoops = byKind("AgentRunLoop");
    const stuckCommandRuns = byKind("TaskCommandRun");
    const stuckValidationRuns = byKind("ValidationRun");
    const stuckToolCalls = byKind("ToolCall");

    for (const step of task.agentRunSteps) {
      const finding = stuckSteps.get(step.id);
      if (finding && step.status === "Running") {
        step.status = "Failed";
        step.completedAt = nowISO;
        step.error = finding.reason;
        step.resultSummary = finding.reason;
      }
    }
    for (const loop of task.agentRunLoops) {
      const finding = stuckLoops.get(loop.id);
      if (finding && loop.status === "Running") {
        loop.status = "Paused";
        loop.stopReason = "StepTimedOut";
        loop.completedAt = nowISO;
        loop.summary = `Agent loop ${loop.id} was paused because a step exceeded its deadline. Forge left it as a resumable safe checkpoint.`;
        delete loop.controlState;
        delete loop.controlRequestedAt;
      }
    }
    for (const run of task.taskCommandRuns) {
      const finding = stuckCommandRuns.get(run.id);
      if (finding && run.status === "Running") {
        run.status = "Failed";
        run.endedAt = nowISO;
        run.outputSummary = finding.reason;
        run.outputChunks.push({
          id: randomUUID(),
          stream: "system",
          text: `${finding.reason}\n`,
          createdAt: nowISO
        });
      }
    }
    for (const run of task.validationRuns) {
      const finding = stuckValidationRuns.get(run.id);
      if (finding && run.status === "Running") {
        run.status = "Failed";
        run.endedAt = nowISO;
        run.summary = finding.reason;
        for (const command of run.commands) {
          if (command.status === "Running") {
            command.status = "Failed";
            command.endedAt = nowISO;
            command.outputSummary = finding.reason;
          }
        }
      }
    }
    for (const toolCall of task.toolCalls) {
      const finding = stuckToolCalls.get(toolCall.id);
      if (finding && toolCall.status === "Started") {
        toolCall.status = "Failed";
        toolCall.endedAt = nowISO;
        toolCall.outputSummary = finding.reason;
      }
    }

    const summary = `Forge recovered ${findings.length} stalled item(s) on this task: ${findings
      .map((finding) => `${finding.kind} stalled ${finding.stalledMinutes}m`)
      .join(", ")}.`;
    task.status = "Human Review";
    task.currentPhase = "Stalled Work Recovered";
    task.reviewSummary = summary;
    setAgent(task, "Manager", "Ready", "Recovered stalled agent work at a safe checkpoint.");
    setAgent(task, "Coder", "Idle", "No in-flight process was resumed after the stall.");
    setAgent(task, "Reviewer", "Active", "Review the recovered checkpoint before resuming.");
    const recoveredEvent = event("agent.stalled_work.recovered", summary);
    recoveredEvent.createdAt = nowISO;
    task.events.push(recoveredEvent);
    task.updatedAt = nowISO;
    tasks.set(task.id, task);
    saveTask(task);
    recovered.push({ taskID: task.id, findings });
  }

  return { generatedAt: nowISO, recovered };
}

return {
  recoverInterruptedAgentRunLoopsOnStartup,
  recoverStuckAgentWork
};
}
