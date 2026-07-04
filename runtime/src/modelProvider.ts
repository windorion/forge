import { randomUUID } from "node:crypto";
import type { EditProposal, ExecutionProposal, ForgeTask, ModelProviderInfo } from "./types.js";

export interface ExecutionProposalRequest {
  task: ForgeTask;
}

export interface EditProposalRequest {
  task: ForgeTask;
}

export interface ModelProvider {
  readonly info: ModelProviderInfo;
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

  async createExecutionProposal(request: ExecutionProposalRequest): Promise<ExecutionProposal> {
    const contextPaths = request.task.contextFiles.map((file) => file.path);
    const contextSummary =
      contextPaths.length > 0 ? `using ${contextPaths.join(", ")}` : "using the task objective only";

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
    const appendText = buildAppendText(request.task);
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
      summary: `Propose a small reviewable update touching ${targetPath}.`,
      fileChanges: [
        {
          id: randomUUID(),
          path: targetPath,
          changeType: "Modify",
          rationale: "Keep the first edit proposal narrow, visible, and reversible before any workspace mutation.",
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
  const preferred = ["docs/v0_scope.md", "docs/development.md", "README.md"];
  const contextPaths = new Set(task.contextFiles.map((file) => file.path));
  return preferred.find((candidate) => contextPaths.has(candidate)) ?? task.contextFiles[0]?.path ?? "README.md";
}

function buildAppendText(task: ForgeTask): string {
  const title = singleLine(task.title);
  const objective = singleLine(task.objective);

  return [
    "",
    "## Forge Implementation Note",
    "",
    `- Task: ${title}`,
    `- Objective: ${objective}`,
    "- Safety: generated as an edit proposal first, then applied only after explicit human approval.",
    ""
  ].join("\n");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
