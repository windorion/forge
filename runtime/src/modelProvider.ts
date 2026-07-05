import { randomUUID } from "node:crypto";
import type {
  EditProposal,
  ExecutionProposal,
  ForgeTask,
  IntentBrief,
  ModelProviderInfo,
  PlanRevision,
  TaskFileReference,
  TaskMessage
} from "./types.js";

export interface ExecutionProposalRequest {
  task: ForgeTask;
}

export interface PlanRevisionRequest {
  task: ForgeTask;
  sourceMessage?: TaskMessage;
}

export interface EditProposalRequest {
  task: ForgeTask;
  previousProposal?: EditProposal;
  sourceMessage?: TaskMessage;
  revisionNumber: number;
}

export interface IntentBriefRequest {
  task: ForgeTask;
  latestUserMessage: TaskMessage;
}

export interface ModelProvider {
  readonly info: ModelProviderInfo;
  createIntentBrief(request: IntentBriefRequest): Promise<IntentBrief>;
  createPlanRevision(request: PlanRevisionRequest): Promise<PlanRevision>;
  createExecutionProposal(request: ExecutionProposalRequest): Promise<ExecutionProposal>;
  createEditProposal(request: EditProposalRequest): Promise<EditProposal>;
}

export function createModelProviderFromEnv(): ModelProvider {
  const providerID = process.env.FORGE_MODEL_PROVIDER?.trim() || "local";
  const model = process.env.FORGE_MODEL_NAME?.trim() || "local-deterministic-v0";

  if (providerID !== "local") {
    return new LocalDeterministicModelProvider({
      id: "local",
      name: "Local Deterministic",
      model,
      mode: "local"
    });
  }

  return new LocalDeterministicModelProvider({
    id: "local",
    name: "Local Deterministic",
    model,
    mode: "local"
  });
}

class LocalDeterministicModelProvider implements ModelProvider {
  constructor(readonly info: ModelProviderInfo) {}

  async createIntentBrief(request: IntentBriefRequest): Promise<IntentBrief> {
    const objective = singleLine(request.task.objective);
    const latestMessage = singleLine(request.latestUserMessage.content);
    const contextCount = request.task.contextFiles.length;
    const changedFileCount = request.task.changedFiles.length;
    const resolvedReferences = resolvedFileReferencesForMessage(request.latestUserMessage);
    const referenceSummary = formatFileReferenceList(resolvedReferences);

    return {
      summary: latestMessage || objective || "Clarify the software task and keep it reviewable.",
      constraints: [
        "Keep the work task-centered, not editor-centered.",
        "Do not apply file changes before human review.",
        "Preserve local-first behavior and visible audit trails.",
        resolvedReferences.length > 0
          ? `Use referenced file context: ${referenceSummary}.`
          : "Preserve any explicit file references in future planning.",
        contextCount > 0
          ? `Reuse inspected context from ${contextCount} file(s) before proposing changes.`
          : "Inspect project context before proposing changes."
      ],
      acceptanceCriteria: [
        "Forge can restate the user intent in the task conversation.",
        "The next plan or proposal references the clarified intent.",
        resolvedReferences.length > 0
          ? `Referenced file context is preserved for ${resolvedReferences.length} file(s).`
          : "The user can add file mentions for more specific task context.",
        changedFileCount > 0
          ? `Any follow-up work accounts for ${changedFileCount} changed file(s).`
          : "No workspace mutation happens until an explicit approval gate."
      ],
      openQuestions: buildOpenQuestions(latestMessage, resolvedReferences.length > 0),
      nextAction: "Review the intent brief, answer any open question, then continue to planning or proposal generation."
    };
  }

  async createPlanRevision(request: PlanRevisionRequest): Promise<PlanRevision> {
    const latestIntentBrief = latestIntentBriefForTask(request.task);
    const intentSummary = latestIntentBrief?.summary ?? singleLine(request.task.objective);
    const resolvedReferences = latestResolvedFileReferencesForTask(request.task);
    const contextSummary = request.task.contextFiles.length > 0
      ? `Use ${request.task.contextFiles.length} inspected context file(s).`
      : resolvedReferences.length > 0
        ? `Use referenced file context: ${formatFileReferenceList(resolvedReferences)}.`
        : "Build repository context before proposing implementation.";
    const acceptanceSummary = latestIntentBrief?.acceptanceCriteria[0]
      ?? "Keep the work reviewable and stop at approval gates.";

    return {
      id: randomUUID(),
      provider: this.info,
      sourceMessageID: request.sourceMessage?.id,
      intentSummary,
      summary: `Plan revision for "${singleLine(request.task.title)}": ${intentSummary}`,
      rationale: "Generated from the current task conversation and latest intent brief without changing files.",
      riskLevel: "Low",
      steps: [
        {
          id: "review-intent",
          title: "Review clarified intent",
          status: "Done",
          summary: intentSummary
        },
        {
          id: "build-context",
          title: "Build repository context",
          status: "Pending",
          summary: contextSummary
        },
        {
          id: "draft-implementation",
          title: "Draft implementation proposal",
          status: "Pending",
          summary: acceptanceSummary
        },
        {
          id: "validate-result",
          title: "Validate result",
          status: "Pending",
          summary: "Run approved validation presets and preserve command output."
        },
        {
          id: "request-human-review",
          title: "Request human review",
          status: "Active",
          summary: "Plan revision is ready for approval before execution."
        }
      ],
      generatedAt: new Date().toISOString()
    };
  }

  async createExecutionProposal(request: ExecutionProposalRequest): Promise<ExecutionProposal> {
    const contextPaths = request.task.contextFiles.map((file) => file.path);
    const referencedPaths = latestResolvedFileReferencesForTask(request.task).map((reference) => reference.path);
    const allContextPaths = [...new Set([...contextPaths, ...referencedPaths].filter(Boolean))];
    const contextSummary =
      allContextPaths.length > 0 ? `using ${allContextPaths.join(", ")}` : "using the task objective only";

    return {
      id: randomUUID(),
      provider: this.info,
      summary: `Prepare a safe edit proposal for "${request.task.title}" ${contextSummary}.`,
      proposedActions: [
        "Re-read the approved objective and current context files.",
        "Identify the smallest file set required for a reviewable diff.",
        "Draft proposed file changes without applying them automatically.",
        "Return the proposal to human review before any workspace mutation."
      ],
      riskLevel: "Low",
      generatedAt: new Date().toISOString()
    };
  }

  async createEditProposal(request: EditProposalRequest): Promise<EditProposal> {
    const targetPath = chooseTargetPath(request.task);
    const appendText = buildAppendText(request);
    const diffPreview = [
      `--- a/${targetPath}`,
      `+++ b/${targetPath}`,
      "@@ proposed safe edit @@",
      ...appendText
        .trimEnd()
        .split("\n")
        .map((line) => `+${line}`)
    ].join("\n");

    return {
      id: randomUUID(),
      provider: this.info,
      sourceMessageID: request.sourceMessage?.id,
      revisionOfID: request.previousProposal?.id,
      revisionNumber: request.revisionNumber,
      summary: request.previousProposal
        ? `Revise proposal ${request.previousProposal.revisionNumber} with the latest task conversation, touching ${targetPath}.`
        : `Propose a small reviewable update touching ${targetPath}.`,
      fileChanges: [
        {
          id: randomUUID(),
          path: targetPath,
          changeType: "Modify",
          rationale: request.previousProposal
            ? "Revise the rejected proposal using the latest task conversation while preserving the review boundary."
            : "Keep the first edit proposal narrow, visible, and reversible before any workspace mutation.",
          diffPreview,
          applyOperation: {
            kind: "AppendText",
            text: appendText
          }
        }
      ],
      riskLevel: "Low",
      status: "Proposed",
      generatedAt: new Date().toISOString()
    };
  }
}

function chooseTargetPath(task: ForgeTask): string {
  const mentionedMarkdownPath = latestResolvedFileReferencesForTask(task)
    .flatMap((reference) => reference.path ? [reference.path] : [])
    .find(isEditableMarkdownPath);
  if (mentionedMarkdownPath) {
    return mentionedMarkdownPath;
  }

  const preferred = ["docs/v0_scope.md", "docs/development.md", "README.md"];
  const contextPaths = new Set(task.contextFiles.map((file) => file.path));
  return preferred.find((candidate) => contextPaths.has(candidate)) ?? task.contextFiles[0]?.path ?? "README.md";
}

function buildAppendText(request: EditProposalRequest): string {
  const title = singleLine(request.task.title);
  const objective = singleLine(request.task.objective);
  const latestIntentBrief = latestIntentBriefForTask(request.task);
  const latestInstruction = singleLine(request.sourceMessage?.content ?? latestIntentBrief?.summary ?? "");
  const revisionLabel = request.revisionNumber > 1
    ? `- Proposal revision: ${request.revisionNumber} (revises ${request.previousProposal?.id ?? "previous proposal"})`
    : "- Proposal revision: 1";

  const lines = [
    "",
    "## Forge Implementation Note",
    "",
    `- Task: ${title}`,
    `- Objective: ${objective}`,
    revisionLabel
  ];

  if (latestInstruction) {
    lines.push(`- Latest instruction: ${latestInstruction}`);
  }

  lines.push("- Safety: generated as an edit proposal first, then applied only after explicit human approval.");
  lines.push("");

  return lines.join("\n");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildOpenQuestions(message: string, hasFileReferences = false): string[] {
  const lower = message.toLowerCase();
  const questions: string[] = [];

  if (!lower.includes("test") && !lower.includes("验收") && !lower.includes("验证")) {
    questions.push("What should count as done or validated for this task?");
  }

  if (!hasFileReferences && !lower.includes("file") && !lower.includes("docs/") && !lower.includes("文件")) {
    questions.push("Are there specific files, modules, or docs that should be treated as primary context?");
  }

  return questions.slice(0, 2);
}

function latestIntentBriefForTask(task: ForgeTask): IntentBrief | undefined {
  return [...task.messages].reverse().find((message) => message.intentBrief)?.intentBrief;
}

function latestResolvedFileReferencesForTask(task: ForgeTask): TaskFileReference[] {
  const latestMessageWithReferences = [...task.messages]
    .reverse()
    .find((message) => resolvedFileReferencesForMessage(message).length > 0);
  return latestMessageWithReferences ? resolvedFileReferencesForMessage(latestMessageWithReferences) : [];
}

function resolvedFileReferencesForMessage(message: TaskMessage): TaskFileReference[] {
  return message.fileReferences.filter((reference) => reference.status === "Resolved" && reference.path);
}

function formatFileReferenceList(references: TaskFileReference[]): string {
  return references.map((reference) => reference.path).filter(Boolean).slice(0, 4).join(", ");
}

function isEditableMarkdownPath(candidate: string): boolean {
  return candidate === "README.md" || (candidate.startsWith("docs/") && candidate.endsWith(".md"));
}
