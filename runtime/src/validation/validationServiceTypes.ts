import type { ModelProvider } from "../modelProvider.js";
import type {
  AgentState,
  CommandRerunEvidence,
  EditProposal,
  ForgeTask,
  PlanStep,
  RerunRepairCommandRequest,
  RuntimeEvent,
  ValidationCommandDefinition,
  ValidationPreset
} from "../types.js";

export type InternalValidationCommand = Omit<ValidationCommandDefinition, "executionMode" | "boundary"> & {
  executable?: string;
  args?: string[];
  executeBuiltIn?: (task: ForgeTask) => Promise<string>;
};

export type InternalValidationPreset = Omit<ValidationPreset, "commands"> & {
  commands: InternalValidationCommand[];
};

export interface ValidationServiceOptions {
  tasks: Map<string, ForgeTask>;
  modelProvider: () => ModelProvider;
  runtimeEnvironment: NodeJS.ProcessEnv;
  validationCommandCatalog: Map<string, InternalValidationCommand>;
  loadValidationPresetRegistry: () => Promise<{ presets: InternalValidationPreset[] }>;
  resolvePresetCommandCwd: (inputPath: string | undefined) => string;
  saveTask: (task: ForgeTask) => void;
  saveAndBroadcast: (task: ForgeTask, event: RuntimeEvent) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
  event: (type: string, message: string) => RuntimeEvent;
  setAgent: (task: ForgeTask, role: AgentState["role"], status: AgentState["status"], summary: string) => void;
  upsertPlanStep: (task: ForgeTask, planStep: PlanStep) => void;
  findCommandRerunEvidenceForRequest: (
    task: ForgeTask,
    input: RerunRepairCommandRequest
  ) => CommandRerunEvidence | undefined;
  findEditProposalByID: (task: ForgeTask, proposalID: string) => EditProposal | undefined;
  summarizeCommandRerunEvidence: (run: import("../types.js").TaskCommandRun) => string;
  resolveEditableWorkspacePath: (inputPath: string) => { absolutePath: string; relativePath: string };
}
