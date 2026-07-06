import { randomUUID } from "node:crypto";
import type {
  EditProposal,
  ExecutionProposal,
  ForgeTask,
  IntentBrief,
  ModelProviderConfiguration,
  ModelProviderInfo,
  ModelProviderRuntimeSettings,
  PlanRevision,
  PlanStep,
  ProposedFileOperation,
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

type JsonSchema = Record<string, unknown>;

interface OpenAIProviderConfig {
  apiKey?: string;
  baseURL: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

interface EditProposalGuidance {
  summary: string;
  targetPath: string;
  rationale: string;
  appendNote: string;
  riskLevel: EditProposal["riskLevel"];
}

interface RestrictedEditDraft {
  targetPath: string;
  diffPreview: string;
  applyOperation: ProposedFileOperation;
}

export function createModelProviderFromEnv(): ModelProvider {
  return createModelProvider(defaultModelProviderRuntimeSettings());
}

export function createModelProvider(settings: ModelProviderRuntimeSettings): ModelProvider {
  const providerID = normalizeProviderID(settings.providerID);

  if (providerID === "local") {
    return new LocalDeterministicModelProvider({
      id: "local",
      name: "Local Deterministic",
      model: settings.modelName?.trim() || "local-deterministic-v0",
      mode: "local"
    });
  }

  if (providerID === "openai") {
    return new OpenAIResponsesModelProvider(
      {
        id: "openai",
        name: "OpenAI Responses",
        model: settings.modelName?.trim() || "gpt-5.5",
        mode: "remote"
      },
      {
        apiKey: settings.openAIAPIKey?.trim() || undefined,
        baseURL: (settings.openAIBaseURL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
        timeoutMs: positiveNumber(settings.openAITimeoutMs, 30_000),
        maxOutputTokens: positiveNumber(settings.openAIMaxOutputTokens, 1800)
      }
    );
  }

  return new UnavailableModelProvider(
    {
      id: providerID,
      name: "Unavailable Model Provider",
      model: settings.modelName?.trim() || "unknown",
      mode: "remote"
    },
    `Unsupported model provider "${providerID}". Use FORGE_MODEL_PROVIDER=local or FORGE_MODEL_PROVIDER=openai.`
  );
}

export function getModelProviderConfigurationFromEnv(): ModelProviderConfiguration {
  return getModelProviderConfiguration(defaultModelProviderRuntimeSettings());
}

export function getModelProviderConfiguration(settings: ModelProviderRuntimeSettings): ModelProviderConfiguration {
  const providerID = normalizeProviderID(settings.providerID);

  if (providerID === "local") {
    const provider = {
      id: "local",
      name: "Local Deterministic",
      model: settings.modelName?.trim() || "local-deterministic-v0",
      mode: "local" as const
    };

    return {
      provider,
      configuredProviderID: providerID,
      status: "Ready",
      summary: "Local deterministic provider is ready. No remote model calls will be made.",
      issues: [],
      sendsRemoteContext: false,
      settings: [
        modelProviderConfigItem("provider", "Provider", provider.id),
        modelProviderConfigItem("model", "Model", provider.model),
        modelProviderConfigItem("mode", "Mode", provider.mode)
      ]
    };
  }

  if (providerID === "openai") {
    const provider = {
      id: "openai",
      name: "OpenAI Responses",
      model: settings.modelName?.trim() || "gpt-5.5",
      mode: "remote" as const
    };
    const baseURL = (settings.openAIBaseURL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    const hasAPIKey = Boolean(settings.openAIAPIKey?.trim());
    const issues = hasAPIKey
      ? []
      : ["OPENAI_API_KEY is missing. OpenAI provider calls will fail until it is configured."];

    return {
      provider,
      configuredProviderID: providerID,
      status: hasAPIKey ? "Ready" : "NeedsConfiguration",
      summary: hasAPIKey
        ? "OpenAI Responses provider is configured for structured model outputs."
        : "OpenAI Responses provider is selected but missing its API key.",
      issues,
      sendsRemoteContext: true,
      remoteContextSummary:
        "Sends compact task state, recent messages, file reference summaries, and selected context summaries. It does not upload whole repositories.",
      settings: [
        modelProviderConfigItem("provider", "Provider", provider.id),
        modelProviderConfigItem("model", "Model", provider.model),
        modelProviderConfigItem("mode", "Mode", provider.mode),
        modelProviderConfigItem("base-url", "Base URL", baseURL),
        modelProviderConfigItem("api-key", "API Key", hasAPIKey ? "Configured" : "Missing", true),
        modelProviderConfigItem("timeout", "Timeout", `${positiveNumber(settings.openAITimeoutMs, 30_000)} ms`),
        modelProviderConfigItem("max-output", "Max Output", `${positiveNumber(settings.openAIMaxOutputTokens, 1800)} tokens`)
      ]
    };
  }

  return {
    provider: {
      id: providerID,
      name: "Unavailable Model Provider",
      model: settings.modelName?.trim() || "unknown",
      mode: "remote"
    },
    configuredProviderID: providerID,
    status: "Unsupported",
    summary: `Unsupported model provider "${providerID}".`,
    issues: [`Unsupported model provider "${providerID}". Use local or openai.`],
    sendsRemoteContext: false,
    settings: [
      modelProviderConfigItem("provider", "Provider", providerID),
      modelProviderConfigItem("model", "Model", settings.modelName?.trim() || "unknown")
    ]
  };
}

export function defaultModelProviderRuntimeSettings(): ModelProviderRuntimeSettings {
  return {
    providerID: normalizeProviderID(process.env.FORGE_MODEL_PROVIDER?.trim() || "local"),
    modelName: process.env.FORGE_MODEL_NAME?.trim() || undefined,
    openAIBaseURL: process.env.FORGE_OPENAI_BASE_URL?.trim() || undefined,
    openAITimeoutMs: numberFromEnv("FORGE_OPENAI_TIMEOUT_MS", undefined),
    openAIMaxOutputTokens: numberFromEnv("FORGE_OPENAI_MAX_OUTPUT_TOKENS", undefined),
    openAIAPIKey: process.env.OPENAI_API_KEY?.trim() || undefined
  };
}

function normalizeProviderID(providerID: string | undefined): string {
  return (providerID?.trim() || "local").toLowerCase();
}

function modelProviderConfigItem(
  id: string,
  label: string,
  value: string,
  isSecret = false
): ModelProviderConfiguration["settings"][number] {
  return { id, label, value, isSecret };
}

class UnavailableModelProvider implements ModelProvider {
  constructor(
    readonly info: ModelProviderInfo,
    private readonly message: string
  ) {}

  async createIntentBrief(): Promise<IntentBrief> {
    throw new Error(this.message);
  }

  async createPlanRevision(): Promise<PlanRevision> {
    throw new Error(this.message);
  }

  async createExecutionProposal(): Promise<ExecutionProposal> {
    throw new Error(this.message);
  }

  async createEditProposal(): Promise<EditProposal> {
    throw new Error(this.message);
  }
}

class OpenAIResponsesModelProvider implements ModelProvider {
  constructor(
    readonly info: ModelProviderInfo,
    private readonly config: OpenAIProviderConfig
  ) {}

  async createIntentBrief(request: IntentBriefRequest): Promise<IntentBrief> {
    const output = await this.createStructuredOutput(
      "forge_intent_brief",
      intentBriefSchema,
      [
        "Create a concise task intent brief for Forge.",
        "Return constraints, acceptance criteria, open questions, and the next action.",
        "If the task is unclear, use openQuestions instead of inventing details.",
        taskProviderContext(request.task, request.latestUserMessage)
      ].join("\n\n")
    );

    return normalizeIntentBrief(output);
  }

  async createPlanRevision(request: PlanRevisionRequest): Promise<PlanRevision> {
    const output = await this.createStructuredOutput(
      "forge_plan_revision",
      planRevisionSchema,
      [
        "Create a reviewable Forge plan revision from the current task context.",
        "Do not claim files were changed or commands were run.",
        "Keep the plan task-centered and stop at human review before side effects.",
        taskProviderContext(request.task, request.sourceMessage)
      ].join("\n\n")
    );

    const normalized = normalizePlanRevisionOutput(output, request.task);
    return {
      id: randomUUID(),
      provider: this.info,
      sourceMessageID: request.sourceMessage?.id,
      intentSummary: normalized.intentSummary,
      summary: normalized.summary,
      rationale: normalized.rationale,
      riskLevel: normalized.riskLevel,
      steps: normalized.steps,
      generatedAt: new Date().toISOString()
    };
  }

  async createExecutionProposal(request: ExecutionProposalRequest): Promise<ExecutionProposal> {
    const output = await this.createStructuredOutput(
      "forge_execution_proposal",
      executionProposalSchema,
      [
        "Create a safe execution proposal for Forge after plan approval.",
        "Only propose actions. Do not claim to have changed files, run commands, committed, pushed, or used tools.",
        "Prefer the smallest reviewable change that preserves human approval.",
        taskProviderContext(request.task)
      ].join("\n\n")
    );

    const normalized = normalizeExecutionProposalOutput(output);
    return {
      id: randomUUID(),
      provider: this.info,
      summary: normalized.summary,
      proposedActions: normalized.proposedActions,
      riskLevel: normalized.riskLevel,
      generatedAt: new Date().toISOString()
    };
  }

  async createEditProposal(request: EditProposalRequest): Promise<EditProposal> {
    const output = await this.createStructuredOutput(
      "forge_edit_proposal_guidance",
      editProposalGuidanceSchema,
      [
        "Create guidance for a safe Forge edit proposal.",
        "The runtime will validate and apply only restricted append-text operations or explicit quoted replace-text operations to README.md or docs/*.md.",
        "Choose a targetPath only if it is README.md or a docs/*.md file from the provided context.",
        "Do not include raw code patches. Return concise proposal guidance.",
        taskProviderContext(request.task, request.sourceMessage)
      ].join("\n\n")
    );
    const guidance = normalizeEditProposalGuidanceOutput(output);
    const draft = buildRestrictedEditDraft(request, guidance);

    return {
      id: randomUUID(),
      provider: this.info,
      sourceMessageID: request.sourceMessage?.id,
      revisionOfID: request.previousProposal?.id,
      revisionNumber: request.revisionNumber,
      summary: guidance.summary,
      fileChanges: [
        {
          id: randomUUID(),
          path: draft.targetPath,
          changeType: "Modify",
          rationale: guidance.rationale,
          diffPreview: draft.diffPreview,
          applyOperation: draft.applyOperation
        }
      ],
      riskLevel: guidance.riskLevel,
      status: "Proposed",
      generatedAt: new Date().toISOString()
    };
  }

  private async createStructuredOutput(name: string, schema: JsonSchema, prompt: string): Promise<unknown> {
    if (!this.config.apiKey) {
      throw new Error("OPENAI_API_KEY is required when FORGE_MODEL_PROVIDER=openai.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseURL}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.info.model,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: forgeProviderSystemPrompt()
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: prompt
                }
              ]
            }
          ],
          max_output_tokens: this.config.maxOutputTokens,
          store: false,
          text: {
            format: {
              type: "json_schema",
              name,
              strict: true,
              schema
            }
          }
        }),
        signal: controller.signal
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI Responses request failed (${response.status}): ${raw.slice(0, 500)}`);
      }

      const parsed = JSON.parse(raw) as unknown;
      return JSON.parse(extractOpenAIOutputText(parsed));
    } finally {
      clearTimeout(timeout);
    }
  }
}

const intentBriefSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    constraints: { type: "array", items: { type: "string" } },
    acceptanceCriteria: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
    nextAction: { type: "string" }
  },
  required: ["summary", "constraints", "acceptanceCriteria", "openQuestions", "nextAction"]
};

const planStepSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    status: { type: "string", enum: ["Pending", "Active", "Done", "Blocked"] },
    summary: { type: "string" }
  },
  required: ["id", "title", "status", "summary"]
};

const planRevisionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intentSummary: { type: "string" },
    summary: { type: "string" },
    rationale: { type: "string" },
    riskLevel: { type: "string", enum: ["Low", "Medium", "High"] },
    steps: { type: "array", items: planStepSchema }
  },
  required: ["intentSummary", "summary", "rationale", "riskLevel", "steps"]
};

const executionProposalSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    proposedActions: { type: "array", items: { type: "string" } },
    riskLevel: { type: "string", enum: ["Low", "Medium", "High"] }
  },
  required: ["summary", "proposedActions", "riskLevel"]
};

const editProposalGuidanceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    targetPath: { type: "string" },
    rationale: { type: "string" },
    appendNote: { type: "string" },
    riskLevel: { type: "string", enum: ["Low", "Medium", "High"] }
  },
  required: ["summary", "targetPath", "rationale", "appendNote", "riskLevel"]
};

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
    const draft = buildRestrictedEditDraft(request);
    const operationLabel = draft.applyOperation.kind === "ReplaceText"
      ? "an exact text replacement"
      : "a small append-only note";

    return {
      id: randomUUID(),
      provider: this.info,
      sourceMessageID: request.sourceMessage?.id,
      revisionOfID: request.previousProposal?.id,
      revisionNumber: request.revisionNumber,
      summary: request.previousProposal
        ? `Revise proposal ${request.previousProposal.revisionNumber} with ${operationLabel} in ${draft.targetPath}.`
        : `Propose ${operationLabel} touching ${draft.targetPath}.`,
      fileChanges: [
        {
          id: randomUUID(),
          path: draft.targetPath,
          changeType: "Modify",
          rationale: request.previousProposal
            ? "Revise the rejected proposal using the latest task conversation while preserving the review boundary."
            : "Keep the first edit proposal narrow, visible, and reversible before any workspace mutation.",
          diffPreview: draft.diffPreview,
          applyOperation: draft.applyOperation
        }
      ],
      riskLevel: "Low",
      status: "Proposed",
      generatedAt: new Date().toISOString()
    };
  }
}

function normalizeIntentBrief(output: unknown): IntentBrief {
  if (!isRecord(output)) {
    throw new Error("OpenAI intent brief output was not an object.");
  }

  return {
    summary: requiredString(output.summary, "summary"),
    constraints: boundedStringArray(output.constraints, "constraints", 6),
    acceptanceCriteria: boundedStringArray(output.acceptanceCriteria, "acceptanceCriteria", 6),
    openQuestions: boundedStringArray(output.openQuestions, "openQuestions", 4),
    nextAction: requiredString(output.nextAction, "nextAction")
  };
}

function normalizePlanRevisionOutput(
  output: unknown,
  task: ForgeTask
): Pick<PlanRevision, "intentSummary" | "summary" | "rationale" | "riskLevel" | "steps"> {
  if (!isRecord(output)) {
    throw new Error("OpenAI plan revision output was not an object.");
  }

  const rawSteps = Array.isArray(output.steps) ? output.steps : [];
  const steps = rawSteps
    .slice(0, 6)
    .map((step, index) => normalizePlanStep(step, index))
    .filter((step): step is PlanStep => step !== undefined);

  if (steps.length === 0) {
    steps.push(
      {
        id: "review-intent",
        title: "Review task intent",
        status: "Done",
        summary: latestIntentBriefForTask(task)?.summary ?? singleLine(task.objective)
      },
      {
        id: "request-human-review",
        title: "Request human review",
        status: "Active",
        summary: "Hold at the review gate before file or command side effects."
      }
    );
  }

  return {
    intentSummary: requiredString(output.intentSummary, "intentSummary"),
    summary: requiredString(output.summary, "summary"),
    rationale: requiredString(output.rationale, "rationale"),
    riskLevel: normalizeRiskLevel(output.riskLevel),
    steps
  };
}

function normalizeExecutionProposalOutput(
  output: unknown
): Pick<ExecutionProposal, "summary" | "proposedActions" | "riskLevel"> {
  if (!isRecord(output)) {
    throw new Error("OpenAI execution proposal output was not an object.");
  }

  return {
    summary: requiredString(output.summary, "summary"),
    proposedActions: boundedStringArray(output.proposedActions, "proposedActions", 8),
    riskLevel: normalizeRiskLevel(output.riskLevel)
  };
}

function normalizeEditProposalGuidanceOutput(
  output: unknown
): { summary: string; targetPath: string; rationale: string; appendNote: string; riskLevel: EditProposal["riskLevel"] } {
  if (!isRecord(output)) {
    throw new Error("OpenAI edit proposal guidance output was not an object.");
  }

  return {
    summary: requiredString(output.summary, "summary"),
    targetPath: optionalString(output.targetPath),
    rationale: requiredString(output.rationale, "rationale"),
    appendNote: optionalString(output.appendNote),
    riskLevel: normalizeRiskLevel(output.riskLevel)
  };
}

function normalizePlanStep(output: unknown, index: number): PlanStep | undefined {
  if (!isRecord(output)) {
    return undefined;
  }

  const title = optionalString(output.title);
  const summary = optionalString(output.summary);
  if (!title || !summary) {
    return undefined;
  }

  return {
    id: sanitizeStepID(optionalString(output.id) || title || `step-${index + 1}`),
    title,
    status: normalizePlanStepStatus(output.status),
    summary
  };
}

function normalizePlanStepStatus(value: unknown): PlanStep["status"] {
  return value === "Active" || value === "Done" || value === "Blocked" || value === "Pending"
    ? value
    : "Pending";
}

function normalizeRiskLevel(value: unknown): "Low" | "Medium" | "High" {
  return value === "Medium" || value === "High" || value === "Low" ? value : "Low";
}

function sanitizeStepID(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || randomUUID();
}

function requiredString(value: unknown, fieldName: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(`OpenAI structured output is missing required string field: ${fieldName}`);
  }

  return normalized;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? singleLine(value).slice(0, 1200) : "";
}

function boundedStringArray(value: unknown, fieldName: string, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`OpenAI structured output is missing array field: ${fieldName}`);
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => singleLine(item).slice(0, 500))
    .filter(Boolean)
    .slice(0, maxItems);
}

function extractOpenAIOutputText(response: unknown): string {
  if (!isRecord(response)) {
    throw new Error("OpenAI Responses payload was not an object.");
  }

  if (isRecord(response.error)) {
    throw new Error(`OpenAI Responses error: ${JSON.stringify(response.error).slice(0, 500)}`);
  }

  if (response.status && response.status !== "completed") {
    throw new Error(`OpenAI Responses request did not complete: ${String(response.status)}`);
  }

  const outputTexts: string[] = [];
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }

    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }

      if (part.type === "refusal" || typeof part.refusal === "string") {
        throw new Error(`OpenAI model refused the request: ${String(part.refusal ?? "refusal")}`);
      }

      if (part.type === "output_text" && typeof part.text === "string") {
        outputTexts.push(part.text);
      }
    }
  }

  if (typeof response.output_text === "string") {
    outputTexts.push(response.output_text);
  }

  const text = outputTexts.join("\n").trim();
  if (!text) {
    throw new Error("OpenAI Responses payload did not include output_text content.");
  }

  return text;
}

function forgeProviderSystemPrompt(): string {
  return [
    "You are Forge's model-provider adapter for a macOS-native, local-first software engineering workspace.",
    "Return only JSON that matches the supplied schema.",
    "Do not claim to have changed files, run commands, committed code, pushed branches, or used tools.",
    "Treat all file changes, commands, git actions, and external effects as proposals that require runtime validation and human approval.",
    "Use provided repository context summaries when helpful, but ask explicit open questions when information is missing."
  ].join(" ");
}

function taskProviderContext(task: ForgeTask, sourceMessage?: TaskMessage): string {
  return JSON.stringify({
    task: {
      title: task.title,
      objective: task.objective,
      status: task.status,
      currentPhase: task.currentPhase,
      reviewSummary: task.reviewSummary
    },
    sourceMessage: sourceMessage ? compactTaskMessage(sourceMessage) : undefined,
    latestIntentBrief: latestIntentBriefForTask(task),
    recentMessages: task.messages.slice(-6).map(compactTaskMessage),
    contextFiles: task.contextFiles.slice(0, 8).map((file) => ({
      path: file.path,
      summary: file.summary
    })),
    planSteps: task.planSteps.map((step) => ({
      title: step.title,
      status: step.status,
      summary: step.summary
    })),
    changedFiles: task.changedFiles,
    existingEditProposal: task.editProposal
      ? {
          status: task.editProposal.status,
          summary: task.editProposal.summary,
          fileChanges: task.editProposal.fileChanges.map((change) => ({
            path: change.path,
            changeType: change.changeType,
            rationale: change.rationale
          }))
        }
      : undefined
  }, null, 2);
}

function compactTaskMessage(message: TaskMessage): Record<string, unknown> {
  return {
    role: message.role,
    kind: message.kind,
    content: message.content.slice(0, 1600),
    fileReferences: message.fileReferences.map((reference) => ({
      requestedPath: reference.requestedPath,
      path: reference.path,
      status: reference.status,
      summary: reference.summary
    }))
  };
}

function numberFromEnv(name: string, fallback: number): number;
function numberFromEnv(name: string, fallback: undefined): number | undefined;
function numberFromEnv(name: string, fallback: number | undefined): number | undefined {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chooseTargetPath(task: ForgeTask, preferredPath?: string): string {
  if (preferredPath && isEditableMarkdownPath(preferredPath)) {
    return preferredPath;
  }

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

function buildRestrictedEditDraft(
  request: EditProposalRequest,
  guidance?: EditProposalGuidance
): RestrictedEditDraft {
  const targetPath = chooseTargetPath(request.task, guidance?.targetPath);
  const replaceInstruction = parseExactReplaceInstruction(request.sourceMessage?.content ?? request.task.objective);
  if (replaceInstruction) {
    const applyOperation: ProposedFileOperation = {
      kind: "ReplaceText",
      findText: replaceInstruction.findText,
      replaceWith: replaceInstruction.replaceWith
    };

    return {
      targetPath,
      applyOperation,
      diffPreview: buildReplaceTextDiffPreview(targetPath, applyOperation)
    };
  }

  const appendText = buildAppendText(request, guidance);
  const applyOperation: ProposedFileOperation = {
    kind: "AppendText",
    text: appendText
  };

  return {
    targetPath,
    applyOperation,
    diffPreview: buildAppendTextDiffPreview(targetPath, appendText)
  };
}

function parseExactReplaceInstruction(content: string): { findText: string; replaceWith: string } | undefined {
  const patterns = [
    /\breplace\s+["“]([\s\S]+?)["”]\s+(?:with|to)\s+["“]([\s\S]+?)["”]/i,
    /(?:把|将)\s*[“"]([\s\S]+?)[”"]\s*替换(?:成|为)\s*[“"]([\s\S]+?)[”"]/
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(content);
    const findText = match?.[1]?.trim();
    const replaceWith = match?.[2]?.trim();
    if (findText && replaceWith && findText !== replaceWith) {
      return {
        findText: findText.slice(0, 10_000),
        replaceWith: replaceWith.slice(0, 10_000)
      };
    }
  }

  return undefined;
}

function buildAppendTextDiffPreview(targetPath: string, appendText: string): string {
  return [
    `--- a/${targetPath}`,
    `+++ b/${targetPath}`,
    "@@ proposed safe append @@",
    ...diffLines(appendText.trimEnd(), "+")
  ].join("\n");
}

function buildReplaceTextDiffPreview(
  targetPath: string,
  operation: Extract<ProposedFileOperation, { kind: "ReplaceText" }>
): string {
  return [
    `--- a/${targetPath}`,
    `+++ b/${targetPath}`,
    "@@ proposed exact replacement @@",
    ...diffLines(operation.findText, "-"),
    ...diffLines(operation.replaceWith, "+")
  ].join("\n");
}

function diffLines(text: string, prefix: "-" | "+"): string[] {
  return text.split("\n").map((line) => `${prefix}${line}`);
}

function buildAppendText(
  request: EditProposalRequest,
  guidance?: { summary: string; rationale: string; appendNote: string }
): string {
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

  if (guidance) {
    lines.push(`- Provider proposal: ${singleLine(guidance.summary)}`);
    lines.push(`- Provider rationale: ${singleLine(guidance.rationale)}`);
    if (guidance.appendNote.trim()) {
      lines.push(`- Provider note: ${singleLine(guidance.appendNote)}`);
    }
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
