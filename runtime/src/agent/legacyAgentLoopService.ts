import type { ModelProvider } from "../modelProvider.js";
import type { RepositorySearchMatch } from "../repository/repositoryContextService.js";
import type { AgentState, ContextFile, ForgeTask, PlanRevision, PlanStep, RuntimeEvent, TaskMessage } from "../types.js";

export function createLegacyAgentLoopService(options: {
  tasks: Map<string, ForgeTask>;
  modelProvider: () => ModelProvider;
  setAgent: (task: ForgeTask, role: AgentState["role"], status: AgentState["status"], summary: string) => void;
  setPlanStep: (task: ForgeTask, stepID: string, status: PlanStep["status"], summary: string) => void;
  event: (type: string, message: string) => RuntimeEvent;
  runTool: <T>(task: ForgeTask, name: string, input: string, execute: () => Promise<T>) => Promise<T>;
  listRepositoryFiles: () => Promise<string[]>;
  deriveRepositorySearchTerms: (task: ForgeTask) => string[];
  searchRepositoryContext: (files: string[], terms: string[], paths: string[]) => Promise<RepositorySearchMatch[]>;
  explicitContextPathsForTask: (task: ForgeTask) => string[];
  buildContextFiles: (task: ForgeTask, files: string[], matches: RepositorySearchMatch[]) => Promise<ContextFile[]>;
  formatPathList: (paths: string[]) => string;
  latestTaskMessage: (task: ForgeTask, role: TaskMessage["role"]) => TaskMessage | undefined;
  enrichPlanRevisionEvidence: (task: ForgeTask, revision: PlanRevision) => PlanRevision;
  saveTask: (task: ForgeTask) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
}) {
const {
  tasks, modelProvider: currentModelProvider, setAgent, setPlanStep, event,
  runTool, listRepositoryFiles, deriveRepositorySearchTerms,
  searchRepositoryContext, explicitContextPathsForTask, buildContextFiles,
  formatPathList, latestTaskMessage, enrichPlanRevisionEvidence, saveTask, emit
} = options;

function runAgentLoopV0(taskID: string): void {
  const updates: Array<[number, (task: ForgeTask) => Promise<RuntimeEvent> | RuntimeEvent]> = [
    [
      500,
      (task) => {
        setAgent(task, "Manager", "Active", "Accepted task and started the planner handoff.");
        setAgent(task, "Planner", "Active", "Reading objective and preparing context requests.");
        setPlanStep(task, "understand-objective", "Done", "Objective captured and converted into a task frame.");
        setPlanStep(task, "build-context", "Active", "Looking for useful project memory and repo context.");
        task.status = "Planning";
        task.currentPhase = "Context Building";
        return event("agent.manager.started", "Manager accepted the task and activated Planner.");
      }
    ],
    [
      1300,
      async (task) => {
        setAgent(task, "Planner", "Active", "Scanning local repository context from the task intent.");
        const projectFiles = await runTool(
          task,
          "list_repo_files",
          "Bounded repo scan excluding private and generated directories",
          listRepositoryFiles
        );
        const searchTerms = deriveRepositorySearchTerms(task);
        const contextMatches = await runTool(
          task,
          "search_repo_context",
          searchTerms.join(", "),
          () => searchRepositoryContext(projectFiles, searchTerms, explicitContextPathsForTask(task))
        );
        const contextFiles = await buildContextFiles(task, projectFiles, contextMatches);
        task.contextFiles = contextFiles;
        setAgent(
          task,
          "Planner",
          "Active",
          `Read ${contextFiles.length} context file(s) selected from ${projectFiles.length} repo file(s).`
        );
        setPlanStep(
          task,
          "build-context",
          "Done",
          `Searched for ${searchTerms.join(", ")} and inspected ${formatPathList(contextFiles.map((file) => file.path))}.`
        );
        setPlanStep(task, "draft-plan", "Active", "Drafting the safest next implementation slice.");
        return event(
          "tool.context.completed",
          `Planner searched repo context and inspected ${contextFiles.length} local context file(s).`
        );
      }
    ],
    [
      2300,
      async (task) => {
        const sourceMessage = latestTaskMessage(task, "User");
        const revision = enrichPlanRevisionEvidence(
          task,
          await currentModelProvider().createPlanRevision({ task, sourceMessage })
        );
        task.planRevisions.push(revision);
        task.planSteps = revision.steps.map((step) => ({ ...step }));
        setAgent(task, "Planner", "Done", "Prepared a reviewable implementation plan.");
        setAgent(task, "Coder", "Ready", "Waiting for human approval before file changes.");
        setAgent(task, "Reviewer", "Ready", "Ready to review plan risk before execution.");
        task.status = "Human Review";
        task.currentPhase = "Plan Review";
        task.reviewSummary = revision.summary;
        return event("plan.ready", "Planner prepared a plan and is waiting for human review.");
      }
    ],
    [
      3200,
      (task) => {
        setAgent(task, "Manager", "Active", "Holding at review gate.");
        setAgent(task, "Reviewer", "Active", "Summarizing plan risk and next approval.");
        setPlanStep(task, "request-review", "Done", "Plan is ready for review. No files changed.");
        task.changedFiles = [];
        task.reviewSummary = "Ready for approval: no files changed yet; next step would allow Coder to execute the plan.";
        return event("review.required", "Human review gate reached. No code changes have been applied.");
      }
    ]
  ];

  for (const [delay, update] of updates) {
    setTimeout(() => {
      const task = tasks.get(taskID);
      if (!task) {
        return;
      }

      if (!shouldContinueAgentLoopV0(task)) {
        return;
      }

      void Promise.resolve(update(task))
        .then((stamped) => {
          stamped.createdAt = new Date().toISOString();
          task.events.push(stamped);
          task.updatedAt = stamped.createdAt;
          tasks.set(taskID, task);
          saveTask(task);
          emit(stamped.type, { taskID, message: stamped.message, task });
          emit("task.updated", { taskID, task });
        })
        .catch((error) => {
          const failed = event("tool.failed", error instanceof Error ? error.message : String(error));
          failed.createdAt = new Date().toISOString();
          task.events.push(failed);
          task.updatedAt = failed.createdAt;
          setAgent(task, "Planner", "Blocked", "A local read-only tool failed.");
          setPlanStep(task, "build-context", "Blocked", failed.message);
          tasks.set(taskID, task);
          saveTask(task);
          emit(failed.type, { taskID, message: failed.message, task });
          emit("task.updated", { taskID, task });
        });
    }, delay);
  }
}

function shouldContinueAgentLoopV0(task: ForgeTask): boolean {
  const planApproved = task.approvals.some((approval) => approval.action === "Approve Plan");
  const hasOpenClarification = (latestTaskMessage(task, "Assistant")?.intentBrief?.openQuestions.length ?? 0) > 0;
  return (
    task.planRevisions.length === 0 &&
    !planApproved &&
    !hasOpenClarification &&
    !task.executionProposal &&
    !task.editProposal
  );
}

return { runAgentLoopV0 };
}
