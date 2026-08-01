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

export function createRepositoryInspectionService(options: AgentOrchestrationOptions & { blockAgentRunStep: (task: ForgeTask, step: AgentRunStep, summary: string) => ForgeTask; completeAgentRunStepAfterAction: (task: ForgeTask, stepID: string, resultSummary: string, targetID: (task: ForgeTask) => string | undefined) => ForgeTask; }) {
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
const { blockAgentRunStep, completeAgentRunStepAfterAction } = options;


async function executeRepositoryInspectionStep(task: ForgeTask, step: AgentRunStep): Promise<ForgeTask> {
  const existingPaths = new Set(task.contextFiles.map((file) => file.path));
  const projectFiles = await runTool(
    task,
    "list_repo_files",
    "Agent step bounded repo scan excluding private and generated directories",
    listRepositoryFiles
  );
  const searchTerms = normalizeProviderSearchTerms({ searchTerms: step.searchTerms ?? [] }, task);
  const requestedReadPaths = normalizeProviderReadPaths(step.readPaths ?? [], projectFiles);
  const searchMode = step.inspectionSearchMode === "Symbol" ? "Symbol" : "Text";
  const requestFingerprint = repositoryInspectionRequestFingerprint(searchMode, searchTerms, requestedReadPaths);
  const budgetSummary = `scan<=${repositoryScanMaxFiles} search<=${repositorySearchMaxFiles} context<=${repositoryContextMaxFiles} terms=${searchTerms.length} reads=${requestedReadPaths.length}`;
  step.searchTerms = searchTerms;
  step.readPaths = requestedReadPaths;
  step.inspectionRequestFingerprint = requestFingerprint;
  step.inspectionBudgetSummary = budgetSummary;
  step.inspectionSearchMode = searchMode;
  const repeatedStep = task.agentRunSteps.find((candidate) =>
    candidate.id !== step.id &&
    candidate.action === "InspectRepository" &&
    candidate.inspectionRequestFingerprint === requestFingerprint
  );
  if (repeatedStep) {
    return blockAgentRunStep(
      task,
      step,
      `Repeated repository inspection request ${requestFingerprint} was blocked before search/read tools; first recorded by step ${repeatedStep.id}.`
    );
  }

  const priorInspections = task.agentRunSteps
    .filter((candidate) => candidate.id !== step.id && candidate.action === "InspectRepository")
    .map((candidate) => ({
      id: candidate.id,
      searchMode: candidate.inspectionSearchMode === "Symbol" ? "Symbol" as const : "Text" as const,
      searchTerms: candidate.searchTerms ?? [],
      readPaths: candidate.readPaths ?? []
    }));
  const subsumedBy = repositoryInspectionSubsumedBy(
    { searchMode, searchTerms, readPaths: requestedReadPaths },
    priorInspections
  );
  if (subsumedBy) {
    return blockAgentRunStep(
      task,
      step,
      `Repository inspection adds no new terms or paths beyond step ${subsumedBy}; blocked before search/read tools to avoid redundant work.`
    );
  }

  const searchResult = await runTool(
    task,
    searchMode === "Symbol" ? "search_repository_symbols" : "search_repository_text",
    `${searchMode}: ${searchTerms.join(", ")}`,
    () => searchRepositoryWithRipgrep(
      projectFiles,
      searchTerms,
      [...explicitContextPathsForTask(task), ...requestedReadPaths],
      searchMode
    )
  );
  step.inspectionSearchEngine = searchResult.engine;
  const matches = searchResult.matches;
  const inspectedFiles = await buildContextFiles(task, projectFiles, matches, requestedReadPaths);
  const newFiles = inspectedFiles.filter((file) => !existingPaths.has(file.path));
  step.contextFilePaths = inspectedFiles.map((file) => file.path);
  const matchCount = matches.reduce((total, match) => total + match.matchedLines.length, 0);
  const matchedFileCount = matches.filter((match) =>
    match.matchedLines.length > 0 || match.reasons.some((reason) =>
      reason.includes("match") || reason.includes("referenced")
    )
  ).length;
  const coveredTermCount = repositoryInspectionCoveredTerms(searchTerms, matches).length;
  const queryCoverage = searchTerms.length === 0 ? 1 : coveredTermCount / searchTerms.length;
  const contextByteCount = inspectedFiles.reduce((total, file) => total + (file.byteLength ?? 0), 0);
  const quality = newFiles.length === 0
    ? "NoNewContext"
    : queryCoverage >= 0.75 && matchedFileCount >= 2
      ? "Strong"
      : queryCoverage >= 0.4 || requestedReadPaths.length > 0
        ? "Partial"
        : "Weak";
  const qualitySummary = `${quality} inspection: ${matchCount} matched line(s) across ${matchedFileCount} file(s), ${coveredTermCount}/${searchTerms.length} query term(s) covered, ${newFiles.length} new context file(s), ${contextByteCount} byte(s) read.`;
  step.inspectionQuality = quality;
  step.inspectionQualitySummary = qualitySummary;
  step.inspectionMatchCount = matchCount;
  step.inspectionMatchedFileCount = matchedFileCount;
  step.inspectionNewContextFileCount = newFiles.length;
  step.inspectionContextByteCount = contextByteCount;
  step.inspectionQueryCoverage = queryCoverage;

  if (newFiles.length === 0) {
    return blockAgentRunStep(
      task,
      step,
      `Repository inspection found no new safe context for ${searchTerms.join(", ") || "the task"}. ${qualitySummary}`
    );
  }

  task.contextFiles = mergeContextFiles(task.contextFiles, inspectedFiles);
  const resultSummary = `Inspected ${inspectedFiles.length} file(s) and added ${newFiles.length} new context file(s): ${formatPathList(newFiles.map((file) => file.path))}. ${qualitySummary}`;
  if (!step.loopID) {
    task.status = "Human Review";
    task.currentPhase = "Repository Context Ready";
    task.reviewSummary = resultSummary;
    setAgent(task, "Manager", "Ready", "Repository inspection completed at a safe read-only checkpoint.");
    setAgent(task, "Coder", "Ready", resultSummary);
    setAgent(task, "Reviewer", "Active", "Review inspected context before the next agent step.");
  } else {
    setAgent(task, "Coder", "Active", resultSummary);
  }

  const updatedTask = completeAgentRunStepAfterAction(
    task,
    step.id,
    resultSummary,
    () => newFiles.at(-1)?.path
  );
  const inspected = event("agent.repository_inspection.completed", resultSummary);
  inspected.createdAt = step.completedAt ?? new Date().toISOString();
  saveAndBroadcast(updatedTask, inspected);
  return updatedTask;
}


function repositoryInspectionRequestFingerprint(searchMode: "Text" | "Symbol", searchTerms: string[], readPaths: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ searchMode, searchTerms, readPaths }))
    .digest("hex")
    .slice(0, 16);
}


function repositoryInspectionCoveredTerms(searchTerms: string[], matches: RepositorySearchMatch[]): string[] {
  return searchTerms.filter((term) => {
    const normalized = term.toLowerCase();
    return matches.some((match) =>
      match.path.toLowerCase().includes(normalized) ||
      match.reasons.some((reason) => reason.toLowerCase().includes(normalized)) ||
      match.matchedLines.some((line) => line.toLowerCase().includes(normalized))
    );
  });
}

return {
  executeRepositoryInspectionStep
};
}
