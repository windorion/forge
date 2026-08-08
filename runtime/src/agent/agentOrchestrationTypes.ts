import type { ModelProvider, PlanContextRequestResult } from "../modelProvider.js";
import type { RepositorySearchMatch } from "../repository/repositoryContextService.js";
import type { StuckThresholds } from "../stuckDetection.js";
import type {
  AgentState,
  CommandRerunEvidence,
  ContextFile,
  ForgeTask,
  PlanStep,
  RuntimeEvent,
  TaskCommandPermission
} from "../types.js";
import type { InternalValidationPreset } from "../validation/validationCatalogService.js";

export interface AgentOrchestrationOptions {
  tasks: Map<string, ForgeTask>;
  modelProvider: () => ModelProvider;
  taskQueueSettingsPath: string;
  taskQueueSmokeDelayMs: number;
  supervisedQueueDispatch: boolean;
  runtimeAuthorizationID?: string;
  stuckThresholds: StuckThresholds;
  repositoryScanMaxFiles: number;
  repositorySearchMaxFiles: number;
  repositoryContextMaxFiles: number;
  saveTask: (task: ForgeTask) => void;
  saveAndBroadcast: (task: ForgeTask, runtimeEvent: RuntimeEvent) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
  event: (type: string, message: string) => RuntimeEvent;
  setAgent: (task: ForgeTask, role: AgentState["role"], status: AgentState["status"], summary: string) => void;
  upsertPlanStep: (task: ForgeTask, planStep: PlanStep) => void;
  hasRunningValidationRun: (task: ForgeTask) => boolean;
  hasRunningTaskCommandRun: (task: ForgeTask) => boolean;
  loadValidationPresetRegistry: () => Promise<{ presets: InternalValidationPreset[] }>;
  buildTaskCommandPermissions: (task: ForgeTask, presets: InternalValidationPreset[]) => TaskCommandPermission[];
  generateEditProposal: (taskID: string) => Promise<ForgeTask>;
  generateValidationRepairProposal: (taskID: string) => Promise<ForgeTask>;
  runTaskCommand: (taskID: string, input: { commandID: string }) => Promise<ForgeTask>;
  rerunRepairCommand: (taskID: string, input: { commandRerunEvidenceID: string }) => Promise<ForgeTask>;
  latestRunnableCommandRerunEvidence: (task: ForgeTask) => CommandRerunEvidence | undefined;
  listRepositoryFiles: () => Promise<string[]>;
  normalizeProviderSearchTerms: (request: Pick<PlanContextRequestResult, "searchTerms">, task: ForgeTask) => string[];
  normalizeProviderReadPaths: (readPaths: string[], files: string[]) => string[];
  searchRepositoryWithRipgrep: (
    files: string[], searchTerms: string[], explicitPaths: string[], searchMode: "Text" | "Symbol"
  ) => Promise<{ engine: string; matches: RepositorySearchMatch[] }>;
  explicitContextPathsForTask: (task: ForgeTask) => string[];
  buildContextFiles: (
    task: ForgeTask, files: string[], matches: RepositorySearchMatch[], preferredPaths?: string[]
  ) => Promise<ContextFile[]>;
  mergeContextFiles: (existing: ContextFile[], incoming: ContextFile[]) => ContextFile[];
  runTool: <T>(task: ForgeTask, name: string, inputSummary: string, operation: () => Promise<T>) => Promise<T>;
  formatPathList: (paths: string[]) => string;
}

export interface RunAgentStepOptions {
  loopID?: string;
}
