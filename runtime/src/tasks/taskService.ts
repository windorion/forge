import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import { repositoryInspectionSubsumedBy } from "../inspectionGuard.js";
import type { ModelProvider, PlanContextRequestResult } from "../modelProvider.js";
import type {
  AgentState,
  ApprovalRecord,
  ApprovePlanRequest,
  ContextFile,
  CreateTaskMessageRequest,
  CreateTaskRequest,
  ForgeTask,
  PlanRevision,
  PlanStep,
  RuntimeEvent,
  TaskFileReference,
  TaskMessage
} from "../types.js";

interface RepositorySearchMatch {
  path: string;
  score: number;
  reasons: string[];
  matchedLines: string[];
}

export function createTaskService(options: {
  tasks: Map<string, ForgeTask>;
  modelProvider: () => ModelProvider;
  repoRoot: string;
  defaultAgents: AgentState[];
  defaultPlanSteps: PlanStep[];
  modelGuidedContextMaxRounds: number;
  cloneAgents: (agents: AgentState[]) => AgentState[];
  clonePlanSteps: (steps: PlanStep[]) => PlanStep[];
  saveAndBroadcast: (task: ForgeTask, runtimeEvent: RuntimeEvent) => void;
  event: (type: string, message: string) => RuntimeEvent;
  setAgent: (task: ForgeTask, role: AgentState["role"], status: AgentState["status"], summary: string) => void;
  upsertPlanStep: (task: ForgeTask, planStep: PlanStep) => void;
  latestTaskMessage: (task: ForgeTask, role: TaskMessage["role"]) => TaskMessage | undefined;
  latestPlanRevision: (task: ForgeTask) => PlanRevision | undefined;
  hasPlanApproval: (task: ForgeTask, revisionID?: string) => boolean;
  listRepositoryFiles: () => Promise<string[]>;
  normalizeProviderSearchTerms: (request: PlanContextRequestResult, task: ForgeTask) => string[];
  normalizeProviderReadPaths: (readPaths: string[], files: string[]) => string[];
  searchRepositoryContext: (files: string[], searchTerms: string[], explicitPaths: string[]) => Promise<RepositorySearchMatch[]>;
  explicitContextPathsForTask: (task: ForgeTask) => string[];
  buildContextFiles: (task: ForgeTask, files: string[], matches: RepositorySearchMatch[], preferredPaths?: string[]) => Promise<ContextFile[]>;
  mergeContextFiles: (existing: ContextFile[], incoming: ContextFile[]) => ContextFile[];
  deriveExecutionSearchTerms: (task: ForgeTask) => string[];
  runTool: <T>(task: ForgeTask, name: string, inputSummary: string, operation: () => Promise<T>) => Promise<T>;
  summarizeMarkdown: (content: string) => string;
  formatPathList: (paths: string[]) => string;
}) {
const {
  tasks,
  modelProvider: currentModelProvider,
  repoRoot,
  defaultAgents,
  defaultPlanSteps,
  modelGuidedContextMaxRounds,
  cloneAgents,
  clonePlanSteps,
  saveAndBroadcast,
  event,
  setAgent,
  upsertPlanStep,
  latestTaskMessage,
  latestPlanRevision,
  hasPlanApproval,
  listRepositoryFiles,
  normalizeProviderSearchTerms,
  normalizeProviderReadPaths,
  searchRepositoryContext,
  explicitContextPathsForTask,
  buildContextFiles,
  mergeContextFiles,
  deriveExecutionSearchTerms,
  runTool,
  summarizeMarkdown,
  formatPathList
} = options;

async function createTask(input: CreateTaskRequest): Promise<ForgeTask> {
  const now = new Date().toISOString();
  const title = input.title?.trim() || "Untitled Forge task";
  const objective = input.objective?.trim() || "No objective provided.";
  const createdEvent: RuntimeEvent = {
    type: "task.created",
    message: "Task created and queued for planning.",
    createdAt: now
  };
  const userMessage = await createUserTaskMessage(objective, now);

  const task: ForgeTask = {
    id: randomUUID(),
    title,
    objective,
    status: "Planning",
    currentPhase: "Planning",
    createdAt: now,
    updatedAt: now,
    agentStates: cloneAgents(defaultAgents),
    planSteps: clonePlanSteps(defaultPlanSteps),
    events: [createdEvent],
    approvals: [],
    toolCalls: [],
    agentRunLoops: [],
    agentRunSteps: [],
    taskCommandRuns: [],
    historyPurges: [],
    commandRerunEvidence: [],
    validationRuns: [],
    validationRepairBriefs: [],
    messages: [userMessage],
    planRevisions: [],
    editProposalRevisions: [],
    contextFiles: [],
    changedFiles: [],
    executionProposal: undefined,
    editProposal: undefined,
    reviewSummary: "No review yet. The planner is preparing a first plan."
  };

  if (userMessage.fileReferences.length > 0) {
    const resolvedCount = userMessage.fileReferences.filter((reference) => reference.status === "Resolved").length;
    task.events.push({
      type: "conversation.file_references.detected",
      message: `Detected ${userMessage.fileReferences.length} file reference(s), ${resolvedCount} resolved.`,
      createdAt: now
    });
  }

  const assistantMessage = await createAssistantIntentBriefMessage(task, userMessage);
  task.messages.push(assistantMessage);
  task.updatedAt = assistantMessage.createdAt;
  task.events.push({
    type: "conversation.intent_brief.created",
    message: "Initial task intent brief created from the user objective.",
    createdAt: assistantMessage.createdAt
  });
  task.reviewSummary = "Intent brief created. The planner is preparing the first implementation plan.";
  setAgent(task, "Manager", "Active", "Captured the task objective and opened a task conversation.");
  setAgent(task, "Planner", "Active", "Created an initial intent brief before planning.");
  upsertPlanStep(task, {
    id: "clarify-intent",
    title: "Clarify task intent",
    status: assistantMessage.intentBrief?.openQuestions.length ? "Blocked" : "Done",
    summary: assistantMessage.intentBrief?.openQuestions.length
      ? `Waiting for clarification: ${assistantMessage.intentBrief.openQuestions.join(" ")}`
      : assistantMessage.intentBrief?.summary ?? "Task intent captured from the initial objective."
  });

  if (assistantMessage.intentBrief?.openQuestions.length) {
    task.status = "Human Review";
    task.currentPhase = "Clarification";
    task.reviewSummary = `Forge needs ${assistantMessage.intentBrief.openQuestions.length} clarification answer(s) before planning.`;
    setAgent(task, "Planner", "Blocked", "Waiting for the user to answer the explicit clarification questions.");
  }

  return task;
}

async function createTaskMessage(taskID: string, input: CreateTaskMessageRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const content = input.content?.trim() ?? "";
  if (!content) {
    throw new HttpError(400, "Task message content is required.");
  }

  if (content.length > 8_000) {
    throw new HttpError(413, "Task message content is too large.");
  }

  const wasClarifying = (latestTaskMessage(task, "Assistant")?.intentBrief?.openQuestions.length ?? 0) > 0;
  const now = new Date().toISOString();
  const userMessage = await createUserTaskMessage(content, now);
  task.messages.push(userMessage);

  setAgent(task, "Manager", "Active", "Received a task conversation update from the user.");
  setAgent(task, "Planner", "Active", `Updating intent brief with ${currentModelProvider().info.name}.`);
  upsertPlanStep(task, {
    id: "clarify-intent",
    title: "Clarify task intent",
    status: "Active",
    summary: "Reading the latest task message and updating the structured brief."
  });

  const received = event("conversation.user_message.created", "User added a task conversation message.");
  received.createdAt = now;
  saveAndBroadcast(task, received);

  if (userMessage.fileReferences.length > 0) {
    const resolvedCount = userMessage.fileReferences.filter((reference) => reference.status === "Resolved").length;
    const referenced = event(
      "conversation.file_references.detected",
      `Detected ${userMessage.fileReferences.length} file reference(s), ${resolvedCount} resolved.`
    );
    referenced.createdAt = new Date().toISOString();
    saveAndBroadcast(task, referenced);
  }

  const assistantMessage = await createAssistantIntentBriefMessage(task, userMessage);
  task.messages.push(assistantMessage);
  const openQuestions = assistantMessage.intentBrief?.openQuestions ?? [];
  task.reviewSummary = openQuestions.length
    ? `Forge still needs ${openQuestions.length} clarification answer(s) before planning.`
    : wasClarifying
      ? "Clarification resolved. Forge is generating a reviewable plan."
      : "Intent brief updated from the latest task conversation message.";
  if (openQuestions.length) {
    task.status = "Human Review";
    task.currentPhase = "Clarification";
  } else if (wasClarifying) {
    task.status = "Planning";
    task.currentPhase = "Plan Revision";
  }
  setAgent(
    task,
    "Planner",
    openQuestions.length ? "Blocked" : wasClarifying ? "Active" : "Ready",
    openQuestions.length
      ? "Waiting for the remaining clarification answers."
      : wasClarifying
        ? "Clarification resolved; generating the implementation plan."
        : "Updated the task intent brief; waiting for the next planning action."
  );
  upsertPlanStep(task, {
    id: "clarify-intent",
    title: "Clarify task intent",
    status: openQuestions.length ? "Blocked" : "Done",
    summary: openQuestions.length
      ? `Waiting for clarification: ${openQuestions.join(" ")}`
      : assistantMessage.intentBrief?.summary ?? "Task intent updated."
  });

  const briefCreated = event("conversation.intent_brief.created", "Assistant created an updated task intent brief.");
  briefCreated.createdAt = assistantMessage.createdAt;
  saveAndBroadcast(task, briefCreated);
  if (openQuestions.length > 0 || !wasClarifying) {
    return task;
  }

  return generatePlanRevision(taskID);
}

async function generatePlanRevision(taskID: string): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status === "Proposed" || task.editProposal?.status === "Applied") {
    throw new HttpError(409, "Resolve the current edit proposal before generating a new plan revision.");
  }

  const sourceMessage = latestTaskMessage(task, "User");
  task.status = "Planning";
  task.currentPhase = "Plan Revision";
  task.reviewSummary = "Generating a plan revision from the task conversation.";
  task.executionProposal = undefined;
  setAgent(task, "Manager", "Active", "Routing the latest task conversation into planning.");
  setAgent(task, "Planner", "Active", `Generating a plan revision with ${currentModelProvider().info.name}.`);
  setAgent(task, "Coder", "Idle", "Waiting for an approved revised plan.");
  setAgent(task, "Reviewer", "Idle", "Waiting for the revised plan.");
  upsertPlanStep(task, {
    id: "generate-plan-revision",
    title: "Generate plan revision",
    status: "Active",
    summary: "Using the latest task conversation and intent brief to revise the plan."
  });

  const started = event("plan.revision.started", "Generating a plan revision from the task conversation.");
  started.createdAt = new Date().toISOString();
  saveAndBroadcast(task, started);

  await buildProviderGuidedPlanContext(task, sourceMessage);

  const revision = enrichPlanRevisionEvidence(
    task,
    await currentModelProvider().createPlanRevision({ task, sourceMessage })
  );
  task.planRevisions.push(revision);
  task.planSteps = revision.steps.map((step) => ({ ...step }));
  task.status = "Human Review";
  task.currentPhase = "Plan Review";
  task.reviewSummary = revision.summary;
  setAgent(task, "Manager", "Active", "Holding revised plan at the review gate.");
  setAgent(task, "Planner", "Done", "Generated a revised plan from the task conversation.");
  setAgent(task, "Reviewer", "Active", "Review the plan revision before approving execution.");

  const ready = event("plan.revision.ready", "Plan revision is ready for human review.");
  ready.createdAt = revision.generatedAt;
  saveAndBroadcast(task, ready);
  return task;
}

function enrichPlanRevisionEvidence(task: ForgeTask, revision: PlanRevision): PlanRevision {
  const contextAreas = [
    ...latestResolvedTaskFilePaths(task),
    ...task.contextFiles.map((file) => file.path)
  ].filter((value, index, values) => values.indexOf(value) === index).slice(0, 8);
  const validationSteps = revision.steps
    .filter((step) => /test|validat|check|lint|build|verify/i.test(`${step.title} ${step.summary}`))
    .map((step) => `${step.title}: ${step.summary}`)
    .slice(0, 4);
  const pendingStepCount = Math.max(1, revision.steps.filter((step) => step.status !== "Done").length);
  const estimatedMinutes = Math.min(90, Math.max(5, 4 + pendingStepCount * 3 + Math.min(task.contextFiles.length, 8)));
  const estimatedCostUSD = revision.provider.mode === "local"
    ? 0
    : Math.round((0.08 + pendingStepCount * 0.05 + Math.min(task.contextFiles.length, 8) * 0.01) * 100) / 100;

  return {
    ...revision,
    expectedFileAreas: contextAreas.length > 0
      ? contextAreas
      : ["Repository areas will be confirmed by bounded read-only inspection before edits."],
    validationPlan: validationSteps.length > 0
      ? validationSteps
      : ["Run the approved project check that covers the changed area and retain its output."],
    riskNotes: [
      `${revision.riskLevel} implementation risk; every proposed file still requires review before Apply.`,
      "Commands run only through approved runtime-known presets; commit and push remain separate approvals."
    ],
    estimatedMinutes,
    estimatedCostUSD
  };
}

function latestResolvedTaskFilePaths(task: ForgeTask): string[] {
  return [...task.messages]
    .reverse()
    .flatMap((message) => message.fileReferences)
    .filter((reference) => reference.status === "Resolved" && reference.path)
    .map((reference) => reference.path as string);
}

async function buildProviderGuidedPlanContext(
  task: ForgeTask,
  sourceMessage?: TaskMessage
): Promise<void> {
  const provider = currentModelProvider();
  if (!provider.createPlanContextRequest) {
    return;
  }

  setAgent(task, "Planner", "Active", `Asking ${provider.info.name} which repo context to inspect.`);
  upsertPlanStep(task, {
    id: "build-model-guided-context",
    title: "Build model-guided context",
    status: "Active",
    summary: `The model provider can request up to ${modelGuidedContextMaxRounds} bounded read-only context round(s).`
  });

  let projectFiles: string[] | undefined;
  const executedSearchKeys = new Set<string>();
  const inspectedPaths = new Set(task.contextFiles.map((file) => file.path));
  // Prior context requests this loop, for the subset-aware redundancy guard
  // (same order-insensitive/case-folded logic as InspectRepository).
  const priorContextRequests: { id: string; searchMode: "Text"; searchTerms: string[]; readPaths: string[] }[] = [];
  const roundSummaries: string[] = [];
  let stopReason = "Reached the bounded context round limit.";

  for (let round = 1; round <= modelGuidedContextMaxRounds; round += 1) {
    const requestStarted = event(
      "model.context_request.started",
      `Model provider is selecting bounded read-only repository context (round ${round}/${modelGuidedContextMaxRounds}).`
    );
    requestStarted.createdAt = new Date().toISOString();
    saveAndBroadcast(task, requestStarted);

    const contextRequest = await provider.createPlanContextRequest({
      task,
      sourceMessage,
      round,
      maxRounds: modelGuidedContextMaxRounds
    });

    if (contextRequest.status === "ReadyForPlan") {
      stopReason = `Provider reported enough context: ${contextRequest.rationale}`;
      roundSummaries.push(`Round ${round}: ready for plan.`);
      break;
    }

    if (!projectFiles) {
      projectFiles = await runTool(
        task,
        "list_repo_files",
        "Model-guided bounded repo scan excluding private and generated directories",
        listRepositoryFiles
      );
    }

    const searchTerms = normalizeProviderSearchTerms(contextRequest, task);
    const requestedReadPaths = normalizeProviderReadPaths(contextRequest.readPaths, projectFiles);
    const searchKey = searchTerms.join("\0");
    const hasNewSearch = !executedSearchKeys.has(searchKey);
    const newReadPaths = requestedReadPaths.filter((readPath) => !inspectedPaths.has(readPath));

    if (!hasNewSearch && newReadPaths.length === 0) {
      stopReason = `Provider repeated context that was already inspected: ${contextRequest.rationale}`;
      roundSummaries.push(`Round ${round}: stopped because no new safe context was requested.`);
      break;
    }

    // Subset-aware guard: also stop when this round's terms and read paths add
    // nothing beyond an earlier round even if reordered or narrowed (the exact
    // searchKey check above is order-sensitive and misses those).
    const subsumedBy = repositoryInspectionSubsumedBy(
      { searchMode: "Text", searchTerms, readPaths: requestedReadPaths },
      priorContextRequests
    );
    if (subsumedBy) {
      stopReason = `Provider requested context already covered by round ${subsumedBy}: ${contextRequest.rationale}`;
      roundSummaries.push(`Round ${round}: stopped because the request added no new safe context.`);
      break;
    }
    priorContextRequests.push({ id: `round ${round}`, searchMode: "Text", searchTerms, readPaths: requestedReadPaths });

    executedSearchKeys.add(searchKey);
    const contextMatches = await runTool(
      task,
      "search_repo_context",
      searchTerms.join(", "),
      () => searchRepositoryContext(
        projectFiles as string[],
        searchTerms,
        [...explicitContextPathsForTask(task), ...requestedReadPaths]
      )
    );
    const contextFiles = await buildContextFiles(task, projectFiles, contextMatches, requestedReadPaths);
    task.contextFiles = mergeContextFiles(task.contextFiles, contextFiles);
    for (const contextFile of contextFiles) {
      inspectedPaths.add(contextFile.path);
    }

    const roundSummary = [
      `Round ${round}: ${contextRequest.rationale}`,
      `Search: ${searchTerms.join(", ")}`,
      requestedReadPaths.length > 0 ? `Requested reads: ${requestedReadPaths.join(", ")}` : undefined,
      `Stored ${task.contextFiles.length} context file(s).`
    ].filter(Boolean).join(" ");
    roundSummaries.push(roundSummary);

    const completed = event(
      "model.context_request.completed",
      `Model-guided context round ${round} inspected ${contextFiles.length} file(s).`
    );
    completed.createdAt = new Date().toISOString();
    saveAndBroadcast(task, completed);
  }

  setAgent(task, "Planner", "Active", `Inspected ${task.contextFiles.length} model-guided context file(s).`);
  upsertPlanStep(task, {
    id: "build-model-guided-context",
    title: "Build model-guided context",
    status: "Done",
    summary: [stopReason, ...roundSummaries].join(" ").slice(0, 500)
  });

  const loopCompleted = event(
    "model.context_loop.completed",
    `Model-guided context loop completed before plan revision: ${stopReason.slice(0, 180)}`
  );
  loopCompleted.createdAt = new Date().toISOString();
  saveAndBroadcast(task, loopCompleted);
}

async function createUserTaskMessage(content: string, createdAt: string): Promise<TaskMessage> {
  return {
    id: randomUUID(),
    role: "User",
    kind: "UserMessage",
    content,
    fileReferences: await resolveTaskFileReferences(content, createdAt),
    createdAt
  };
}

async function createAssistantIntentBriefMessage(
  task: ForgeTask,
  latestUserMessage: TaskMessage
): Promise<TaskMessage> {
  const intentBrief = await currentModelProvider().createIntentBrief({ task, latestUserMessage });
  return {
    id: randomUUID(),
    role: "Assistant",
    kind: "IntentBrief",
    content: formatIntentBrief(intentBrief),
    createdAt: new Date().toISOString(),
    fileReferences: [],
    provider: currentModelProvider().info,
    intentBrief
  };
}

function formatIntentBrief(intentBrief: NonNullable<TaskMessage["intentBrief"]>): string {
  return [
    `Intent: ${intentBrief.summary}`,
    formatBriefList("Constraints", intentBrief.constraints),
    formatBriefList("Acceptance", intentBrief.acceptanceCriteria),
    formatBriefList("Open questions", intentBrief.openQuestions),
    `Next: ${intentBrief.nextAction}`
  ].filter(Boolean).join("\n");
}

function formatBriefList(title: string, values: string[]): string {
  if (values.length === 0) {
    return "";
  }

  return `${title}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

async function resolveTaskFileReferences(content: string, detectedAt: string): Promise<TaskFileReference[]> {
  const mentions = extractFileMentionCandidates(content).slice(0, 6);
  const references: TaskFileReference[] = [];

  for (const mention of mentions) {
    references.push(await resolveTaskFileReference(mention, detectedAt));
  }

  return references;
}

function extractFileMentionCandidates(content: string): string[] {
  const candidates = new Set<string>();
  const add = (raw: string | undefined) => {
    const candidate = cleanFileMention(raw ?? "");
    if (candidate && looksLikeFileMention(candidate)) {
      candidates.add(candidate);
    }
  };

  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    add(match[1]);
  }

  for (const match of content.matchAll(/(?:^|[\s(])@([A-Za-z0-9._/-]+(?::\d+(?:-\d+)?)?)/g)) {
    add(match[1]);
  }

  for (const match of content.matchAll(
    /(?:^|[\s(])((?:\.\/)?(?:README\.md|AGENTS\.md|docs\/[A-Za-z0-9._/-]+|runtime\/[A-Za-z0-9._/-]+|apps\/[A-Za-z0-9._/-]+|script\/[A-Za-z0-9._/-]+|\.forge\/[A-Za-z0-9._/-]+)(?::\d+(?:-\d+)?)?)/g
  )) {
    add(match[1]);
  }

  return [...candidates];
}

function cleanFileMention(raw: string): string {
  return raw
    .trim()
    .replace(/^@/, "")
    .replace(/^\.\/+/, "")
    .replace(/[),.;\]]+$/g, "");
}

function looksLikeFileMention(candidate: string): boolean {
  const pathOnly = candidate.replace(/:\d+(?:-\d+)?$/, "");
  return (
    pathOnly === "README.md" ||
    pathOnly === "AGENTS.md" ||
    pathOnly.includes("/") ||
    /\.[A-Za-z0-9]{1,8}$/.test(pathOnly)
  );
}

async function resolveTaskFileReference(mention: string, detectedAt: string): Promise<TaskFileReference> {
  const parsed = parseMentionPathAndLine(mention);
  const baseReference = {
    id: randomUUID(),
    requestedPath: mention,
    lineStart: parsed.lineStart,
    lineEnd: parsed.lineEnd,
    detectedAt
  };

  try {
    const { absolutePath, relativePath } = resolveReadOnlyWorkspacePath(parsed.path);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return {
        ...baseReference,
        path: relativePath,
        status: "Missing",
        summary: `Referenced path is not a file: ${relativePath}.`
      };
    }

    if (fileStat.size > 200_000) {
      return {
        ...baseReference,
        path: relativePath,
        status: "Blocked",
        byteSize: fileStat.size,
        summary: `File is too large for conversation context: ${relativePath}.`
      };
    }

    const content = await readFile(absolutePath, "utf8");
    if (content.includes("\0")) {
      return {
        ...baseReference,
        path: relativePath,
        status: "Blocked",
        byteSize: fileStat.size,
        summary: `File appears to be binary and was not added as conversation context: ${relativePath}.`
      };
    }

    const lineCount = content.split("\n").length;
    return {
      ...baseReference,
      path: relativePath,
      status: "Resolved",
      byteSize: fileStat.size,
      lineCount,
      summary: summarizeReferencedFile(relativePath, content, parsed.lineStart, parsed.lineEnd)
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        ...baseReference,
        path: parsed.path,
        status: "Missing",
        summary: `Referenced file does not exist: ${parsed.path}.`
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      ...baseReference,
      status: "Blocked",
      summary: message
    };
  }
}

function parseMentionPathAndLine(mention: string): { path: string; lineStart?: number; lineEnd?: number } {
  const match = mention.match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!match) {
    return { path: mention };
  }

  const lineStart = Number(match[2]);
  const lineEnd = match[3] ? Number(match[3]) : lineStart;
  return {
    path: match[1],
    lineStart,
    lineEnd: Math.max(lineStart, lineEnd)
  };
}

function resolveReadOnlyWorkspacePath(inputPath: string): { absolutePath: string; relativePath: string } {
  if (inputPath.includes("\0") || path.isAbsolute(inputPath)) {
    throw new HttpError(409, `Unsafe file reference path: ${inputPath}`);
  }

  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/").replace(/^\.\/+/, ""));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.startsWith(".git/") ||
    normalized.startsWith(".forge/") ||
    normalized.includes("/.git/") ||
    normalized.includes("/.forge/")
  ) {
    throw new HttpError(409, `Unsafe file reference path: ${inputPath}`);
  }

  const absolutePath = path.resolve(repoRoot, normalized);
  if (!absolutePath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new HttpError(409, `Unsafe file reference path: ${inputPath}`);
  }

  return { absolutePath, relativePath: normalized };
}

function summarizeReferencedFile(
  relativePath: string,
  content: string,
  lineStart?: number,
  lineEnd?: number
): string {
  if (relativePath.endsWith(".md")) {
    return summarizeMarkdown(content) || `${relativePath} resolved as Markdown context.`;
  }

  const lines = content.split("\n");
  const selectedLine = lineStart
    ? lines.slice(Math.max(0, lineStart - 1), Math.min(lines.length, lineEnd ?? lineStart))
    : lines;
  const firstMeaningfulLine = selectedLine
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("#!"));
  const location = lineStart ? ` lines ${lineStart}${lineEnd && lineEnd !== lineStart ? `-${lineEnd}` : ""}` : "";
  return [
    `${relativePath}${location}`,
    `${lines.length} line(s)`,
    firstMeaningfulLine
  ].filter(Boolean).join(" - ").slice(0, 220);
}

async function approvePlan(taskID: string, input: ApprovePlanRequest): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.status !== "Human Review") {
    throw new HttpError(409, "Only tasks waiting for human review can have their plan approved.");
  }

  const now = new Date().toISOString();
  const planRevision = latestPlanRevision(task);
  const openQuestions = latestTaskMessage(task, "Assistant")?.intentBrief?.openQuestions ?? [];
  if (openQuestions.length > 0) {
    throw new HttpError(409, "Answer the active clarification questions before approving a plan.");
  }
  if (!planRevision) {
    throw new HttpError(409, "Generate a reviewable plan revision before approval.");
  }
  if (hasPlanApproval(task, planRevision?.id)) {
    throw new HttpError(409, "The current plan is already approved.");
  }

  const approval: ApprovalRecord = {
    id: randomUUID(),
    action: "Approve Plan",
    decision: "Approved",
    summary: "Approved the current plan and opened controlled execution preparation.",
    decidedAt: now,
    targetID: planRevision?.id,
    userNote: input.note?.trim() || undefined
  };

  task.approvals.push(approval);
  task.status = "Running";
  task.currentPhase = "Execution Preparation";
  task.changedFiles = [];
  task.reviewSummary = "Plan approved. The model provider is preparing a safe execution proposal.";
  setAgent(task, "Manager", "Active", "Recorded plan approval and opened the execution phase.");
  setAgent(task, "Planner", "Done", "Plan approved by the user.");
  setAgent(task, "Coder", "Active", `Preparing an execution proposal with ${currentModelProvider().info.name}.`);
  setAgent(task, "Tester", "Idle", "Waiting for code changes or validation commands.");
  setAgent(task, "Reviewer", "Idle", "No diff to review yet.");
  upsertPlanStep(task, {
    id: "prepare-execution",
    title: "Prepare controlled execution",
    status: "Done",
    summary: "Plan approved and execution phase opened. No files changed in v0."
  });
  upsertPlanStep(task, {
    id: "generate-execution-proposal",
    title: "Generate execution proposal",
    status: "Active",
    summary: `Using ${currentModelProvider().info.name} to draft a safe next-step proposal.`
  });

  const approved = event("approval.plan.approved", "User approved the plan. Controlled execution preparation is open.");
  approved.createdAt = now;
  saveAndBroadcast(task, approved);

  const executionContext = await prepareExecutionContext(task);
  const proposal = await currentModelProvider().createExecutionProposal({ task });
  proposal.contextFiles = executionContext.contextFiles;
  proposal.toolEvidence = executionContext.toolEvidence;
  task.executionProposal = proposal;
  task.reviewSummary = "Execution proposal generated. No files changed; the next slice will turn this into a reviewable diff.";
  setAgent(task, "Coder", "Ready", "Execution proposal generated; waiting for safe edit proposal tooling.");
  upsertPlanStep(task, {
    id: "generate-execution-proposal",
    title: "Generate execution proposal",
    status: "Done",
    summary: `Generated by ${proposal.provider.name} (${proposal.provider.model}).`
  });
  upsertPlanStep(task, {
    id: "await-safe-diff",
    title: "Await safe diff proposal",
    status: "Active",
    summary: "Next runtime slice will create a reviewable diff before any file mutation."
  });

  const proposed = event("model.execution.proposed", "Model provider generated a safe execution proposal after plan approval.");
  proposed.createdAt = proposal.generatedAt;
  saveAndBroadcast(task, proposed);
  return task;
}

async function prepareExecutionContext(
  task: ForgeTask
): Promise<{ contextFiles: ContextFile[]; toolEvidence: string[] }> {
  upsertPlanStep(task, {
    id: "build-execution-context",
    title: "Build execution context",
    status: "Active",
    summary: "Running bounded read-only repository tools before drafting the execution proposal."
  });
  setAgent(task, "Coder", "Active", "Gathering execution context through read-only repository tools.");

  const started = event(
    "agent.execution_context.started",
    "Preparing execution proposal context with bounded read-only repository tools."
  );
  started.createdAt = new Date().toISOString();
  saveAndBroadcast(task, started);

  const projectFiles = await runTool(
    task,
    "list_repo_files",
    "Execution proposal bounded repo scan excluding private and generated directories",
    listRepositoryFiles
  );
  const searchTerms = deriveExecutionSearchTerms(task);
  const contextMatches = await runTool(
    task,
    "search_repo_context",
    searchTerms.join(", "),
    () => searchRepositoryContext(projectFiles, searchTerms, explicitContextPathsForTask(task))
  );
  const contextFiles = await buildContextFiles(task, projectFiles, contextMatches);
  task.contextFiles = mergeContextFiles(task.contextFiles, contextFiles);

  const toolEvidence = [
    `Scanned ${projectFiles.length} repo file(s).`,
    `Searched for ${searchTerms.slice(0, 8).join(", ")}.`,
    `Read ${contextFiles.length} execution context file(s).`
  ];

  upsertPlanStep(task, {
    id: "build-execution-context",
    title: "Build execution context",
    status: "Done",
    summary: `Prepared execution proposal context from ${contextFiles.length} read-only file(s): ${formatPathList(contextFiles.map((file) => file.path))}.`
  });

  const completed = event(
    "agent.execution_context.completed",
    `Execution context prepared from ${contextFiles.length} read-only file(s).`
  );
  completed.createdAt = new Date().toISOString();
  saveAndBroadcast(task, completed);

  return {
    contextFiles,
    toolEvidence
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

return {
  createTask,
  createTaskMessage,
  generatePlanRevision,
  approvePlan,
  prepareExecutionContext,
  enrichPlanRevisionEvidence,
  resolveReadOnlyWorkspacePath
};
}
