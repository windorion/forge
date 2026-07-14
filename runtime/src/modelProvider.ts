import { randomUUID } from "node:crypto";
import type {
  AgentRunStepDecision,
  CommandRerunEvidence,
  EditProposal,
  EditProposalValidation,
  ExecutionProposal,
  ForgeTask,
  IntentBrief,
  ModelProviderConfiguration,
  ModelProviderInfo,
  ModelProviderRuntimeSettings,
  PlanRevision,
  PlanStep,
  ProposedFileOperation,
  TaskCommandPermission,
  TaskCommandRun,
  TaskFileReference,
  TaskMessage,
  ValidationRepairBrief,
  ValidationRun
} from "./types.js";

export interface ExecutionProposalRequest {
  task: ForgeTask;
}

export interface ValidationRepairBriefRequest {
  task: ForgeTask;
  validationRun?: ValidationRun;
  taskCommandRun?: TaskCommandRun;
}

export interface PlanRevisionRequest {
  task: ForgeTask;
  sourceMessage?: TaskMessage;
}

export interface PlanContextRequest {
  task: ForgeTask;
  sourceMessage?: TaskMessage;
  round: number;
  maxRounds: number;
}

export interface PlanContextRequestResult {
  status: "SearchAndRead" | "ReadyForPlan";
  rationale: string;
  searchTerms: string[];
  readPaths: string[];
}

export interface EditProposalRequest {
  task: ForgeTask;
  previousProposal?: EditProposal;
  sourceMessage?: TaskMessage;
  revisionNumber: number;
  repairAttempt?: number;
  validationFeedback?: EditProposalValidation;
  validationRepairBrief?: ValidationRepairBrief;
}

export interface AgentRunStepRequest {
  task: ForgeTask;
  taskCommands: TaskCommandPermission[];
  commandRerunEvidence: CommandRerunEvidence[];
}

export interface IntentBriefRequest {
  task: ForgeTask;
  latestUserMessage: TaskMessage;
}

export interface ModelProvider {
  readonly info: ModelProviderInfo;
  createIntentBrief(request: IntentBriefRequest): Promise<IntentBrief>;
  createPlanContextRequest?(request: PlanContextRequest): Promise<PlanContextRequestResult>;
  createPlanRevision(request: PlanRevisionRequest): Promise<PlanRevision>;
  createExecutionProposal(request: ExecutionProposalRequest): Promise<ExecutionProposal>;
  createAgentRunStep(request: AgentRunStepRequest): Promise<AgentRunStepDecision>;
  createEditProposal(request: EditProposalRequest): Promise<EditProposal>;
  createValidationRepairBrief(request: ValidationRepairBriefRequest): Promise<ValidationRepairBrief>;
}

export class AgentRunStepProviderError extends Error {
  constructor(
    readonly attemptCount: number,
    readonly attemptErrors: string[]
  ) {
    super(`Model provider could not return a valid agent step after ${attemptCount} attempts.`);
    this.name = "AgentRunStepProviderError";
  }
}

class ModelProviderOutputFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelProviderOutputFormatError";
  }
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

interface RichEditProposalOutput {
  summary: string;
  riskLevel: EditProposal["riskLevel"];
  fileChanges: RichEditProposalFileChange[];
}

interface RichEditProposalFileChange {
  path: string;
  changeType: "Create" | "Modify" | "Delete";
  rationale: string;
  diffPreview: string;
  applyOperation?: ProposedFileOperation;
}

interface RestrictedEditDraft {
  targetPath: string;
  diffPreview: string;
  applyOperation: ProposedFileOperation;
}

type PatchTextHunkInput = Extract<ProposedFileOperation, { kind: "PatchText" }>["hunks"][number];

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

  async createAgentRunStep(): Promise<AgentRunStepDecision> {
    throw new Error(this.message);
  }

  async createEditProposal(): Promise<EditProposal> {
    throw new Error(this.message);
  }

  async createValidationRepairBrief(): Promise<ValidationRepairBrief> {
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

  async createPlanContextRequest(request: PlanContextRequest): Promise<PlanContextRequestResult> {
    const output = await this.createStructuredOutput(
      "forge_plan_context_request",
      planContextRequestSchema,
      [
        "Choose read-only repository context requests before Forge revises the plan.",
        `This is context round ${request.round} of ${request.maxRounds}.`,
        "Return search terms and repo-relative paths that would help a planner understand the task.",
        "Use status SearchAndRead only when another bounded read/search pass is needed.",
        "Use status ReadyForPlan when the provided context is enough; leave searchTerms and readPaths empty in that case.",
        "Only request paths that are explicitly mentioned, already present in context, or highly likely from the provided task context.",
        "Do not request secrets, generated files, .git, .forge, node_modules, build output, or absolute paths.",
        "The runtime will validate every request, execute only allowlisted read-only tools, and summarize results before planning.",
        taskProviderContext(request.task, request.sourceMessage)
      ].join("\n\n")
    );

    return normalizePlanContextRequestOutput(output);
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

  async createAgentRunStep(request: AgentRunStepRequest): Promise<AgentRunStepDecision> {
    const promptParts = [
      "Choose exactly one safe next action for Forge's live coding-agent run.",
      "You are selecting the next runtime-owned action; you are not executing tools yourself.",
      "Use InspectRepository when more read-only codebase evidence is needed before proposing or repairing an edit. Provide searchMode Text for fixed substring discovery or Symbol for whole-identifier discovery, plus bounded searchTerms and optional repo-relative readPaths. The runtime validates and executes them.",
      "Do not request repository evidence already present in task context or recent InspectRepository steps; wait for human review when no new safe context is needed.",
      "Use GenerateEditProposal when an execution proposal exists and there is no proposed edit awaiting review.",
      "Use RunTaskCommand only when one of the provided taskCommands has canRun true; commandID must exactly match that command id.",
      "Use GenerateValidationRepairProposal when a failed validation or task command has a repair brief and no repair proposal is currently awaiting review.",
      "Use RerunRepairCommand only when one of the provided commandRerunEvidence items is ready or failed; commandRerunEvidenceID must exactly match that evidence id.",
      "Use WaitForHumanReview when a proposal, plan, command approval, or user decision is needed.",
      "Use RequestPlanApproval when the current plan has not been approved.",
      "Never ask to apply edits, commit, push, install dependencies, or run arbitrary shell text.",
      taskProviderContext(request.task),
      agentRunStepRequestContext(request)
    ];
    const attemptErrors: string[] = [];

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const correction = attemptErrors.length > 0
        ? [
            "Your previous agent-step output could not be validated.",
            `Validation error: ${attemptErrors.at(-1)}`,
            "Return exactly one object matching the supplied schema. Use only an allowed action and include non-empty summary and rationale strings."
          ].join("\n")
        : undefined;
      try {
        const output = await this.createStructuredOutput(
          "forge_agent_run_step",
          agentRunStepDecisionSchema,
          [...promptParts, correction].filter(Boolean).join("\n\n")
        );
        let decision: AgentRunStepDecision;
        try {
          decision = normalizeAgentRunStepDecisionOutput(output, request);
        } catch (error) {
          throw new ModelProviderOutputFormatError(compactProviderError(error));
        }

        return {
          ...decision,
          providerAttemptCount: attempt,
          providerOutputRecovered: attempt > 1,
          providerAttemptErrors: attemptErrors.length > 0 ? attemptErrors : undefined
        };
      } catch (error) {
        if (!(error instanceof ModelProviderOutputFormatError)) {
          throw error;
        }

        attemptErrors.push(compactProviderError(error));
      }
    }

    throw new AgentRunStepProviderError(2, attemptErrors);
  }

  async createEditProposal(request: EditProposalRequest): Promise<EditProposal> {
    const output = await this.createStructuredOutput(
      "forge_edit_proposal",
      editProposalSchema,
      [
        "Create a Forge edit proposal review artifact.",
        "You may propose multiple file changes, but the runtime will validate all of them before any apply.",
        "Use AppendText only for bounded appends to README.md or docs/*.md.",
        "Use ReplaceText only when the task explicitly asks for an exact quoted replacement and you can provide the exact find text. It may target README.md, docs/*.md, or normal allowlisted source/text files such as .ts, .swift, .js, .json, .css, .html, .yml, .toml, .py, .go, .rs, .java, .kt, .c, .cpp, .h, and .hpp.",
        "Use PatchText only when the task explicitly asks for multiple exact quoted replacements in one existing allowlisted Markdown/source/text file. Every patchHunks item must include exact findText and replaceWith text that should appear once in the original target file.",
        "Use UnifiedDiff for normal edits to an existing allowlisted source/text file when exact replacement is too narrow. Provide one standard single-file unified diff with --- a/path and +++ b/path headers, line-numbered @@ hunks, and exact context lines. The header path must match the file change path. Do not use it to create or delete files.",
        "Use CreateFile only for new docs/*.md files with bounded Markdown content.",
        "Use PreviewOnly for deletes, new source files, unsupported paths, overwrite attempts, multi-file content inside one diff, or anything that should be reviewed but not applied by the current engine.",
        request.validationFeedback
          ? "The previous proposal failed runtime validation. Generate a corrected proposal that addresses every blocked check while staying inside the supported operation boundary."
          : request.validationRepairBrief
            ? "This is a follow-up repair proposal after a validation or task command failure. Use the repair brief to propose a narrow, reviewable fix inside the supported operation boundary."
          : "Prefer an apply-ready proposal when the task can be satisfied inside the supported operation boundary.",
        "Never claim files were changed. This proposal is not a workspace mutation.",
        taskProviderContext(request.task, request.sourceMessage),
        editProposalRequestContext(request)
      ].join("\n\n")
    );
    const proposalOutput = normalizeRichEditProposalOutput(output, request);

    return {
      id: randomUUID(),
      provider: this.info,
      sourceMessageID: request.sourceMessage?.id,
      revisionOfID: request.previousProposal?.id,
      validationRepairBriefID: request.validationRepairBrief?.id,
      revisionNumber: request.revisionNumber,
      summary: proposalOutput.summary,
      fileChanges: proposalOutput.fileChanges.map((change) => ({
        id: randomUUID(),
        path: change.path,
        changeType: change.changeType,
        rationale: change.rationale,
        diffPreview: change.diffPreview,
        applyOperation: change.applyOperation
      })),
      riskLevel: proposalOutput.riskLevel,
      status: "Proposed",
      generatedAt: new Date().toISOString()
    };
  }

  async createValidationRepairBrief(request: ValidationRepairBriefRequest): Promise<ValidationRepairBrief> {
    const output = await this.createStructuredOutput(
      "forge_validation_repair_brief",
      validationRepairBriefSchema,
      [
        "Create a Forge validation failure repair brief.",
        "Do not claim files were changed, commands were rerun, commits were made, or tools were executed.",
        "Use only the provided failed validation or task command summaries and task context.",
        "Recommend reviewable next actions that preserve human approval and runtime validation boundaries.",
        "If a new edit is needed, describe the next proposal direction rather than applying it.",
        taskProviderContext(request.task),
        validationRepairRequestContext(request)
      ].join("\n\n")
    );
    const normalized = normalizeValidationRepairBriefOutput(output);

    return {
      id: randomUUID(),
      provider: this.info,
      validationRunID: request.validationRun?.id,
      taskCommandRunID: request.taskCommandRun?.id,
      source: request.taskCommandRun ? "TaskCommandRun" : "ValidationRun",
      sourceSummary: validationRepairSourceSummary(request),
      summary: normalized.summary,
      likelyCause: normalized.likelyCause,
      recommendedActions: normalized.recommendedActions,
      followUpPrompt: normalized.followUpPrompt,
      riskLevel: normalized.riskLevel,
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

      try {
        const parsed = JSON.parse(raw) as unknown;
        return JSON.parse(extractOpenAIOutputText(parsed));
      } catch (error) {
        throw new ModelProviderOutputFormatError(`Structured output could not be decoded: ${compactProviderError(error)}`);
      }
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

const planContextRequestSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["SearchAndRead", "ReadyForPlan"] },
    rationale: { type: "string" },
    searchTerms: { type: "array", items: { type: "string" } },
    readPaths: { type: "array", items: { type: "string" } }
  },
  required: ["status", "rationale", "searchTerms", "readPaths"]
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

const agentRunStepDecisionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [
        "GenerateEditProposal",
        "RunTaskCommand",
        "GenerateValidationRepairProposal",
        "RerunRepairCommand",
        "WaitForHumanReview",
        "RequestPlanApproval",
        "InspectRepository"
      ]
    },
    summary: { type: "string" },
    rationale: { type: "string" },
    commandID: { type: "string" },
    commandRerunEvidenceID: { type: "string" },
    searchTerms: { type: "array", items: { type: "string" } },
    readPaths: { type: "array", items: { type: "string" } },
    searchMode: { type: "string", enum: ["Text", "Symbol"] }
  },
  required: ["action", "summary", "rationale", "commandID", "commandRerunEvidenceID", "searchTerms", "readPaths", "searchMode"]
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

const editProposalFileChangeSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: { type: "string" },
    changeType: { type: "string", enum: ["Create", "Modify", "Delete"] },
    rationale: { type: "string" },
    diffPreview: { type: "string" },
    operationKind: { type: "string", enum: ["AppendText", "ReplaceText", "PatchText", "UnifiedDiff", "CreateFile", "PreviewOnly"] },
    appendText: { type: "string" },
    findText: { type: "string" },
    replaceWith: { type: "string" },
    patchHunks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          findText: { type: "string" },
          replaceWith: { type: "string" }
        },
        required: ["findText", "replaceWith"]
      }
    },
    unifiedDiff: { type: "string" },
    content: { type: "string" }
  },
  required: [
    "path",
    "changeType",
    "rationale",
    "diffPreview",
    "operationKind",
    "appendText",
    "findText",
    "replaceWith",
    "patchHunks",
    "unifiedDiff",
    "content"
  ]
};

const editProposalSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    riskLevel: { type: "string", enum: ["Low", "Medium", "High"] },
    fileChanges: { type: "array", items: editProposalFileChangeSchema }
  },
  required: ["summary", "riskLevel", "fileChanges"]
};

const validationRepairBriefSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    likelyCause: { type: "string" },
    recommendedActions: { type: "array", items: { type: "string" } },
    followUpPrompt: { type: "string" },
    riskLevel: { type: "string", enum: ["Low", "Medium", "High"] }
  },
  required: ["summary", "likelyCause", "recommendedActions", "followUpPrompt", "riskLevel"]
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

  async createAgentRunStep(request: AgentRunStepRequest): Promise<AgentRunStepDecision> {
    return chooseDeterministicAgentRunStep(request);
  }

  async createEditProposal(request: EditProposalRequest): Promise<EditProposal> {
    const draft = buildRestrictedEditDraft(request);
    const operationLabel = editOperationLabel(draft.applyOperation);

    return {
      id: randomUUID(),
      provider: this.info,
      sourceMessageID: request.sourceMessage?.id,
      revisionOfID: request.previousProposal?.id,
      validationRepairBriefID: request.validationRepairBrief?.id,
      revisionNumber: request.revisionNumber,
      summary: request.previousProposal
        ? request.validationRepairBrief
          ? `Propose a follow-up repair for validation brief ${request.validationRepairBrief.id} with ${operationLabel} in ${draft.targetPath}.`
          : request.validationFeedback
          ? `Repair proposal ${request.previousProposal.revisionNumber} after validation feedback with ${operationLabel} in ${draft.targetPath}.`
          : `Revise proposal ${request.previousProposal.revisionNumber} with ${operationLabel} in ${draft.targetPath}.`
        : `Propose ${operationLabel} touching ${draft.targetPath}.`,
      fileChanges: [
        {
          id: randomUUID(),
          path: draft.targetPath,
          changeType: "Modify",
          rationale: request.validationRepairBrief
            ? "Use the validation repair brief to propose a reviewed follow-up edit without mutating files automatically."
            : request.validationFeedback
            ? "Address the runtime validation feedback while preserving the review boundary and avoiding workspace mutation."
            : request.previousProposal
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

  async createValidationRepairBrief(request: ValidationRepairBriefRequest): Promise<ValidationRepairBrief> {
    if (request.taskCommandRun) {
      const commandRun = request.taskCommandRun;
      const likelyCause = commandRun.outputSummary
        ? singleLine(commandRun.outputSummary).slice(0, 700)
        : "The task command failed, but no output summary was retained.";

      return {
        id: randomUUID(),
        provider: this.info,
        taskCommandRunID: commandRun.id,
        source: "TaskCommandRun",
        sourceSummary: `${commandRun.name} / ${commandRun.status}`,
        summary: `Task command repair brief for ${commandRun.name}: command failed.`,
        likelyCause,
        recommendedActions: [
          "Review the failed task command output before changing files.",
          "Add a task message with any intended repair constraint.",
          "Generate a reviewed repair proposal, then rerun the approved command after applying a fix."
        ],
        followUpPrompt: `Repair task command failure from ${commandRun.command}; focus on ${commandRun.name}.`,
        riskLevel: commandRun.riskLevel,
        generatedAt: new Date().toISOString()
      };
    }

    if (!request.validationRun) {
      throw new Error("Validation repair brief requires a validation run or task command run.");
    }

    const failedCommands = request.validationRun.commands.filter((command) => command.status === "Failed");
    const failedNames = failedCommands.map((command) => command.name).join(", ") || request.validationRun.presetName;
    const firstFailure = failedCommands[0];
    const likelyCause = firstFailure
      ? singleLine(firstFailure.outputSummary).slice(0, 700)
      : "The validation preset reported a failure, but no failed command summary was retained.";

    return {
      id: randomUUID(),
      provider: this.info,
      validationRunID: request.validationRun.id,
      source: "ValidationRun",
      sourceSummary: `${request.validationRun.presetName} / ${request.validationRun.status}`,
      summary: `Validation repair brief for ${request.validationRun.presetName}: ${failedNames} failed.`,
      likelyCause,
      recommendedActions: [
        "Review the failed command summary before changing files.",
        "Add a task message with any intended repair constraint.",
        "Generate a revised edit proposal or rerun the approved validation preset after a reviewed fix."
      ],
      followUpPrompt: `Repair validation failure in ${request.validationRun.presetName}; focus on ${failedNames}.`,
      riskLevel: request.validationRun.riskLevel,
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

function normalizePlanContextRequestOutput(output: unknown): PlanContextRequestResult {
  if (!isRecord(output)) {
    throw new Error("OpenAI plan context request output was not an object.");
  }

  return {
    status: output.status === "ReadyForPlan" ? "ReadyForPlan" : "SearchAndRead",
    rationale: requiredString(output.rationale, "rationale").slice(0, 500),
    searchTerms: boundedStringArray(output.searchTerms, "searchTerms", 8)
      .map((term) => term.toLowerCase().replace(/[^a-z0-9._/-]+/g, " ").trim())
      .filter((term) => term.length >= 2)
      .slice(0, 8),
    readPaths: boundedStringArray(output.readPaths, "readPaths", 6)
      .map((path) => path.replace(/^@/, "").replace(/^\.\/+/, "").trim())
      .filter(Boolean)
      .slice(0, 6)
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

function normalizeAgentRunStepDecisionOutput(
  output: unknown,
  request: AgentRunStepRequest
): AgentRunStepDecision {
  if (!isRecord(output)) {
    throw new Error("OpenAI agent run step output was not an object.");
  }

  const action = normalizeAgentRunStepAction(output.action);
  if (!action) {
    throw new Error("OpenAI agent run step action was not in the allowed action enum.");
  }

  const fallback = chooseDeterministicAgentRunStep(request);
  const commandID = optionalString(output.commandID);
  const commandRerunEvidenceID = optionalString(output.commandRerunEvidenceID);
  const searchTerms = normalizeAgentRunStepStringList(output.searchTerms, 10, 64);
  const readPaths = normalizeAgentRunStepStringList(output.readPaths, 6, 240);
  const searchMode = output.searchMode === "Symbol" ? "Symbol" : "Text";
  const runnableCommandIDs = new Set(request.taskCommands.filter((permission) => permission.canRun).map((permission) => permission.command.id));
  const runnableRerunEvidenceIDs = new Set(request.commandRerunEvidence.map((evidence) => evidence.id));

  if (action === "RunTaskCommand" && !runnableCommandIDs.has(commandID)) {
    return {
      ...fallback,
      summary: "Model selected a task command that is not currently runnable, so Forge will wait for review.",
      rationale: "Runtime validation rejected the model-selected command id before execution."
    };
  }

  if (action === "RerunRepairCommand" && !runnableRerunEvidenceIDs.has(commandRerunEvidenceID)) {
    return {
      ...fallback,
      summary: "Model selected rerun evidence that is not currently runnable, so Forge will wait for review.",
      rationale: "Runtime validation rejected the model-selected rerun evidence id before execution."
    };
  }

  return {
    action,
    summary: requiredString(output.summary, "summary"),
    rationale: requiredString(output.rationale, "rationale"),
    commandID: action === "RunTaskCommand" ? commandID : undefined,
    commandRerunEvidenceID: action === "RerunRepairCommand" ? commandRerunEvidenceID : undefined,
    searchTerms: action === "InspectRepository" ? searchTerms : undefined,
    readPaths: action === "InspectRepository" ? readPaths : undefined,
    searchMode: action === "InspectRepository" ? searchMode : undefined
  };
}

function normalizeAgentRunStepStringList(value: unknown, limit: number, itemLimit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => optionalString(item).trim())
    .filter((item, index, values) => item.length > 0 && values.indexOf(item) === index)
    .slice(0, limit)
    .map((item) => item.slice(0, itemLimit));
}

function compactProviderError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Unknown structured output validation error.";
}

function normalizeAgentRunStepAction(value: unknown): AgentRunStepDecision["action"] | undefined {
  switch (value) {
  case "InspectRepository":
  case "GenerateEditProposal":
  case "RunTaskCommand":
  case "GenerateValidationRepairProposal":
  case "RerunRepairCommand":
  case "WaitForHumanReview":
  case "RequestPlanApproval":
    return value;
  default:
    return undefined;
  }
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

function normalizeRichEditProposalOutput(
  output: unknown,
  request: EditProposalRequest
): RichEditProposalOutput {
  if (!isRecord(output)) {
    throw new Error("OpenAI edit proposal output was not an object.");
  }

  const rawChanges = Array.isArray(output.fileChanges) ? output.fileChanges : [];
  const fileChanges = rawChanges
    .slice(0, 4)
    .map(normalizeRichEditProposalFileChange)
    .filter((change): change is RichEditProposalFileChange => change !== undefined);

  if (fileChanges.length === 0) {
    const draft = buildRestrictedEditDraft(request);
    fileChanges.push({
      path: draft.targetPath,
      changeType: "Modify",
      rationale: "Fallback restricted edit proposal generated because the provider returned no usable file changes.",
      diffPreview: draft.diffPreview,
      applyOperation: draft.applyOperation
    });
  }

  return {
    summary: requiredString(output.summary, "summary"),
    riskLevel: normalizeRiskLevel(output.riskLevel),
    fileChanges
  };
}

function normalizeRichEditProposalFileChange(output: unknown): RichEditProposalFileChange | undefined {
  if (!isRecord(output)) {
    return undefined;
  }

  const path = optionalString(output.path).replace(/^@/, "").replace(/^\.\/+/, "").slice(0, 240);
  const diffPreview = optionalMultilineString(output.diffPreview, 20_000);
  if (!path || !diffPreview) {
    return undefined;
  }

  const changeType = output.changeType === "Create" || output.changeType === "Delete" || output.changeType === "Modify"
    ? output.changeType
    : "Modify";
  const operationKind = optionalString(output.operationKind);
  const rationale = requiredString(output.rationale, "rationale");
  let applyOperation: ProposedFileOperation | undefined;

  if (operationKind === "AppendText") {
    const text = optionalMultilineString(output.appendText, 10_000);
    applyOperation = text ? { kind: "AppendText", text } : { kind: "PreviewOnly" };
  } else if (operationKind === "ReplaceText") {
    const findText = optionalMultilineString(output.findText, 10_000);
    const replaceWith = optionalMultilineString(output.replaceWith, 10_000);
    applyOperation = findText && replaceWith
      ? { kind: "ReplaceText", findText, replaceWith }
      : { kind: "PreviewOnly" };
  } else if (operationKind === "PatchText") {
    const hunks = normalizePatchTextHunks(output.patchHunks);
    applyOperation = hunks.length > 0
      ? { kind: "PatchText", hunks }
      : { kind: "PreviewOnly" };
  } else if (operationKind === "UnifiedDiff") {
    const patch = optionalMultilineString(output.unifiedDiff, 60_000);
    applyOperation = patch
      ? { kind: "UnifiedDiff", patch }
      : { kind: "PreviewOnly" };
  } else if (operationKind === "CreateFile") {
    applyOperation = {
      kind: "CreateFile",
      content: optionalMultilineString(output.content, 20_000)
    };
  } else {
    applyOperation = { kind: "PreviewOnly" };
  }

  return {
    path,
    changeType,
    rationale,
    diffPreview,
    applyOperation
  };
}

function normalizePatchTextHunks(value: unknown): PatchTextHunkInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 8)
    .map((item): PatchTextHunkInput | undefined => {
      if (!isRecord(item)) {
        return undefined;
      }

      const findText = optionalMultilineString(item.findText, 10_000);
      const replaceWith = optionalMultilineString(item.replaceWith, 10_000);
      if (!findText || !replaceWith || findText === replaceWith) {
        return undefined;
      }

      return { findText, replaceWith };
    })
    .filter((hunk): hunk is PatchTextHunkInput => hunk !== undefined);
}

function normalizeValidationRepairBriefOutput(
  output: unknown
): Pick<ValidationRepairBrief, "summary" | "likelyCause" | "recommendedActions" | "followUpPrompt" | "riskLevel"> {
  if (!isRecord(output)) {
    throw new Error("OpenAI validation repair brief output was not an object.");
  }

  return {
    summary: requiredString(output.summary, "summary"),
    likelyCause: requiredString(output.likelyCause, "likelyCause"),
    recommendedActions: boundedStringArray(output.recommendedActions, "recommendedActions", 6),
    followUpPrompt: requiredString(output.followUpPrompt, "followUpPrompt"),
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

function optionalMultilineString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\0/g, "").slice(0, maxLength) : "";
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
    "When a schema asks for context requests, you may request read-only repository search or file context; the runtime decides what is safe to execute.",
    "Treat all file changes, commands, git actions, and external effects as proposals that require runtime validation and human approval.",
    "Use provided repository context summaries when helpful, but ask explicit open questions when information is missing."
  ].join(" ");
}

function chooseDeterministicAgentRunStep(request: AgentRunStepRequest): AgentRunStepDecision {
  const task = request.task;
  const runnableRerunEvidence = request.commandRerunEvidence.find((evidence) =>
    evidence.status === "Ready" || evidence.status === "Failed"
  );
  if (runnableRerunEvidence) {
    return {
      action: "RerunRepairCommand",
      summary: `Rerun ${runnableRerunEvidence.commandName} to verify the reviewed self-fix.`,
      rationale: "A command-sourced repair proposal has been applied and has pending rerun evidence.",
      commandRerunEvidenceID: runnableRerunEvidence.id
    };
  }

  const latestRepairBrief = task.validationRepairBriefs.at(-1);
  if (
    latestRepairBrief &&
    task.editProposal?.status !== "Proposed" &&
    task.editProposal?.validationRepairBriefID !== latestRepairBrief.id
  ) {
    return {
      action: "GenerateValidationRepairProposal",
      summary: "Generate a reviewed self-fix proposal from the latest repair brief.",
      rationale: "A failed validation or task command has a repair brief and no current proposal is awaiting review."
    };
  }

  if (task.editProposal?.status === "Proposed") {
    return {
      action: "WaitForHumanReview",
      summary: "Wait for the user to review the proposed diff.",
      rationale: "Forge must not apply or revise a proposed edit without a human decision."
    };
  }

  if (task.executionProposal && (!task.editProposal || task.editProposal.status === "Rejected")) {
    return {
      action: "GenerateEditProposal",
      summary: task.editProposal?.status === "Rejected"
        ? "Revise the rejected edit proposal from the latest task context."
        : "Generate the next reviewed edit proposal from the approved plan.",
      rationale: "The plan has an execution proposal and no proposed diff is currently awaiting review."
    };
  }

  const runnableCommand = request.taskCommands.find((permission) => permission.canRun);
  if (runnableCommand && task.editProposal?.status === "Applied") {
    return {
      action: "RunTaskCommand",
      summary: `Run approved command ${runnableCommand.command.name}.`,
      rationale: "The latest proposal is applied and an approved project command is available for agent-run validation.",
      commandID: runnableCommand.command.id
    };
  }

  if (!task.executionProposal) {
    return {
      action: "RequestPlanApproval",
      summary: "Wait for plan approval before agent execution.",
      rationale: "Forge needs an approved plan and execution proposal before generating implementation work."
    };
  }

  return {
    action: "WaitForHumanReview",
    summary: "Wait for a human decision before continuing.",
    rationale: "No safe autonomous next action is currently available inside the v0 runtime boundaries."
  };
}

function agentRunStepRequestContext(request: AgentRunStepRequest): string {
  const runnableCommands = request.taskCommands.filter((permission) => permission.canRun);
  const commandSummaries = request.taskCommands.slice(0, 8).map((permission) => ({
    commandID: permission.command.id,
    name: permission.command.name,
    command: permission.command.command,
    canRun: permission.canRun,
    executionState: permission.executionState,
    approvalState: permission.approvalState,
    blockedReasons: permission.blockedReasons,
    lastRun: permission.lastRun
      ? {
          status: permission.lastRun.status,
          summary: permission.lastRun.summary
        }
      : undefined
  }));
  const rerunEvidence = request.commandRerunEvidence.map((evidence) => ({
    id: evidence.id,
    commandID: evidence.commandID,
    commandName: evidence.commandName,
    status: evidence.status,
    summary: evidence.summary,
    repairProposalID: evidence.repairProposalID
  }));

  return JSON.stringify({
    allowedActions: [
      "InspectRepository",
      "GenerateEditProposal",
      "RunTaskCommand",
      "GenerateValidationRepairProposal",
      "RerunRepairCommand",
      "WaitForHumanReview",
      "RequestPlanApproval"
    ],
    taskCommandPolicy: "RunTaskCommand can only use commandID values where canRun is true.",
    rerunPolicy: "RerunRepairCommand can only use commandRerunEvidenceID values listed in commandRerunEvidence.",
    repositoryInspectionPolicy: "InspectRepository is read-only; searchMode is Text or Symbol, and searchTerms/readPaths are normalized and executed by runtime-owned bounded tools.",
    runnableCommandIDs: runnableCommands.map((permission) => permission.command.id),
    taskCommands: commandSummaries,
    commandRerunEvidence: rerunEvidence
  });
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
    validationRepairBriefs: task.validationRepairBriefs?.slice(-3).map((brief) => ({
      validationRunID: brief.validationRunID,
      taskCommandRunID: brief.taskCommandRunID,
      source: brief.source,
      sourceSummary: brief.sourceSummary,
      summary: brief.summary,
      likelyCause: brief.likelyCause,
      recommendedActions: brief.recommendedActions
    })) ?? [],
    agentRunSteps: task.agentRunSteps?.slice(-5).map((step) => ({
      action: step.action,
      status: step.status,
      summary: step.summary,
      resultSummary: step.resultSummary,
      error: step.error
    })) ?? [],
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

function editProposalRequestContext(request: EditProposalRequest): string {
  if (!request.previousProposal && !request.validationFeedback) {
    return JSON.stringify({
      editProposalRequest: {
        revisionNumber: request.revisionNumber,
        repairAttempt: request.repairAttempt ?? 0
      }
    }, null, 2);
  }

  return JSON.stringify({
    editProposalRequest: {
      revisionNumber: request.revisionNumber,
      repairAttempt: request.repairAttempt ?? 0,
      previousProposal: request.previousProposal
        ? {
            id: request.previousProposal.id,
            revisionNumber: request.previousProposal.revisionNumber,
            status: request.previousProposal.status,
            summary: request.previousProposal.summary,
            validationStatus: request.previousProposal.validation?.status,
            validationSummary: request.previousProposal.validation?.summary,
            decisionNote: request.previousProposal.decisionNote,
            fileDecisions: request.previousProposal.fileDecisions,
            fileChanges: request.previousProposal.fileChanges.map((change) => ({
              path: change.path,
              changeType: change.changeType,
              rationale: change.rationale,
              operationKind: change.applyOperation?.kind
            }))
          }
        : undefined,
      validationFeedback: request.validationFeedback
        ? {
            status: request.validationFeedback.status,
            summary: request.validationFeedback.summary,
            fileResults: request.validationFeedback.fileResults.map((result) => ({
              path: result.path,
              status: result.status,
              summary: result.summary,
              checks: result.checks
            }))
          }
        : undefined,
      validationRepairBrief: request.validationRepairBrief
        ? {
            id: request.validationRepairBrief.id,
            validationRunID: request.validationRepairBrief.validationRunID,
            taskCommandRunID: request.validationRepairBrief.taskCommandRunID,
            source: request.validationRepairBrief.source,
            sourceSummary: request.validationRepairBrief.sourceSummary,
            summary: request.validationRepairBrief.summary,
            likelyCause: request.validationRepairBrief.likelyCause,
            recommendedActions: request.validationRepairBrief.recommendedActions,
            followUpPrompt: request.validationRepairBrief.followUpPrompt,
            riskLevel: request.validationRepairBrief.riskLevel
          }
        : undefined
    }
  }, null, 2);
}

function validationRepairRequestContext(request: ValidationRepairBriefRequest): string {
  const source = request.validationRun
    ? {
        kind: "ValidationRun",
        validationRun: {
          id: request.validationRun.id,
          trigger: request.validationRun.trigger,
          presetID: request.validationRun.presetID,
          presetName: request.validationRun.presetName,
          riskLevel: request.validationRun.riskLevel,
          status: request.validationRun.status,
          summary: request.validationRun.summary,
          commands: request.validationRun.commands.map((command) => ({
            name: command.name,
            command: command.command,
            kind: command.kind,
            riskLevel: command.riskLevel,
            cwd: command.cwd,
            status: command.status,
            exitCode: command.exitCode,
            outputSummary: command.outputSummary.slice(0, 1800)
          }))
        }
      }
    : request.taskCommandRun
      ? {
          kind: "TaskCommandRun",
          taskCommandRun: {
            id: request.taskCommandRun.id,
            commandID: request.taskCommandRun.commandID,
            name: request.taskCommandRun.name,
            command: request.taskCommandRun.command,
            kind: request.taskCommandRun.kind,
            riskLevel: request.taskCommandRun.riskLevel,
            cwd: request.taskCommandRun.cwd,
            presetID: request.taskCommandRun.presetID,
            presetName: request.taskCommandRun.presetName,
            status: request.taskCommandRun.status,
            exitCode: request.taskCommandRun.exitCode,
            outputSummary: request.taskCommandRun.outputSummary.slice(0, 1800),
            outputChunks: request.taskCommandRun.outputChunks.slice(-12).map((chunk) => ({
              stream: chunk.stream,
              text: chunk.text.slice(0, 1200),
              createdAt: chunk.createdAt
            }))
          }
        }
      : { kind: "Unknown" };

  return JSON.stringify({
    validationRepairRequest: source
  }, null, 2);
}

function validationRepairSourceSummary(request: ValidationRepairBriefRequest): string {
  if (request.validationRun) {
    return `${request.validationRun.presetName} / ${request.validationRun.status}`;
  }

  if (request.taskCommandRun) {
    return `${request.taskCommandRun.name} / ${request.taskCommandRun.status}`;
  }

  return "Unknown repair source";
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

function chooseTargetPath(task: ForgeTask, preferredPath?: string, allowSourceText = false): string {
  if (preferredPath && isEditableTargetPath(preferredPath, allowSourceText)) {
    return preferredPath;
  }

  const mentionedEditablePath = latestResolvedFileReferencesForTask(task)
    .flatMap((reference) => reference.path ? [reference.path] : [])
    .find((candidate) => isEditableTargetPath(candidate, allowSourceText));
  if (mentionedEditablePath) {
    return mentionedEditablePath;
  }

  const preferred = ["docs/v0_scope.md", "docs/development.md", "README.md"];
  const contextPaths = new Set(task.contextFiles.map((file) => file.path));
  return preferred.find((candidate) => contextPaths.has(candidate)) ?? task.contextFiles[0]?.path ?? "README.md";
}

function buildRestrictedEditDraft(
  request: EditProposalRequest,
  guidance?: EditProposalGuidance
): RestrictedEditDraft {
  const replaceInstructions = parseExactReplaceInstructions(request.sourceMessage?.content ?? request.task.objective);
  const allowSourceText = replaceInstructions.length > 0;
  const previousTargetPath = request.previousProposal?.fileChanges.find((change) =>
    isEditableTargetPath(change.path, allowSourceText)
  )?.path;
  const targetPath = chooseTargetPath(request.task, guidance?.targetPath ?? previousTargetPath, allowSourceText);

  if (replaceInstructions.length > 1) {
    const applyOperation: ProposedFileOperation = {
      kind: "PatchText",
      hunks: replaceInstructions
    };

    return {
      targetPath,
      applyOperation,
      diffPreview: buildPatchTextDiffPreview(targetPath, applyOperation)
    };
  }

  if (replaceInstructions.length === 1) {
    const replaceInstruction = replaceInstructions[0];
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

function editOperationLabel(operation: ProposedFileOperation): string {
  if (operation.kind === "ReplaceText") {
    return "an exact text replacement";
  }

  if (operation.kind === "PatchText") {
    return `${operation.hunks.length} exact patch hunks`;
  }

  if (operation.kind === "UnifiedDiff") {
    return "a context-anchored unified diff";
  }

  return "a small append-only note";
}

function parseExactReplaceInstructions(content: string): PatchTextHunkInput[] {
  const patterns = [
    /\breplace\s+["“]([\s\S]+?)["”]\s+(?:with|to)\s+["“]([\s\S]+?)["”]/gi,
    /(?:把|将)\s*[“"]([\s\S]+?)[”"]\s*替换(?:成|为)\s*[“"]([\s\S]+?)[”"]/g
  ];
  const instructions: PatchTextHunkInput[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const findText = match[1]?.trim();
      const replaceWith = match[2]?.trim();
      if (findText && replaceWith && findText !== replaceWith && !seen.has(findText)) {
        instructions.push({
          findText: findText.slice(0, 10_000),
          replaceWith: replaceWith.slice(0, 10_000)
        });
        seen.add(findText);
      }

      if (instructions.length >= 8) {
        return instructions;
      }
    }
  }

  return instructions;
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

function buildPatchTextDiffPreview(
  targetPath: string,
  operation: Extract<ProposedFileOperation, { kind: "PatchText" }>
): string {
  return [
    `--- a/${targetPath}`,
    `+++ b/${targetPath}`,
    "@@ proposed exact patch @@",
    ...operation.hunks.flatMap((hunk, index) => [
      `@@ hunk ${index + 1} @@`,
      ...diffLines(hunk.findText, "-"),
      ...diffLines(hunk.replaceWith, "+")
    ])
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

  if (request.validationFeedback) {
    lines.push(`- Repair attempt: ${request.repairAttempt ?? 0}`);
    lines.push(`- Validation feedback: ${singleLine(request.validationFeedback.summary)}`);
  }

  if (request.validationRepairBrief) {
    lines.push(`- Validation repair brief: ${singleLine(request.validationRepairBrief.summary)}`);
    lines.push(`- Likely cause: ${singleLine(request.validationRepairBrief.likelyCause)}`);
    lines.push(`- Follow-up prompt: ${singleLine(request.validationRepairBrief.followUpPrompt)}`);
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

function isEditableTargetPath(candidate: string, allowSourceText: boolean): boolean {
  return isEditableMarkdownPath(candidate) || (allowSourceText && isEditableSourceTextPath(candidate));
}

function isEditableSourceTextPath(candidate: string): boolean {
  const normalized = candidate.replaceAll("\\", "/").replace(/^@/, "").replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.split("/").some((segment) => [".build", ".forge", ".git", ".swiftpm", "DerivedData", "dist", "node_modules"].includes(segment))
  ) {
    return false;
  }

  const fileName = normalized.split("/").at(-1) ?? "";
  if (
    [".env", ".env.local", ".env.development", ".env.production", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Package.resolved"].includes(fileName) ||
    fileName.startsWith(".env")
  ) {
    return false;
  }

  if (["Dockerfile", "Makefile", "Package.swift", "Podfile", "Rakefile"].includes(fileName)) {
    return true;
  }

  return [
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".css",
    ".cts",
    ".go",
    ".h",
    ".hpp",
    ".html",
    ".java",
    ".js",
    ".jsx",
    ".json",
    ".kt",
    ".kts",
    ".m",
    ".mjs",
    ".mm",
    ".mts",
    ".py",
    ".rb",
    ".rs",
    ".sh",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml"
  ].some((extension) => fileName.endsWith(extension));
}
