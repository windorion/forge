import { readFile } from "node:fs/promises";

import { HttpError } from "../runtime/runtimeError.js";
import { safeErrorMessage } from "../security/secretRedaction.js";
import type {
  ForgeTask,
  TaskCommandPermission,
  ValidationCommandDefinition,
  ValidationPermissionEnvelope,
  ValidationPermissionLastRun,
  ValidationPreset,
  ValidationPresetPermission
} from "../types.js";
import {
  publicValidationPermissionApproval,
  resolveValidationPresetApproval,
  validationApprovalPolicy
} from "./approvalLifecycle.js";
import {
  compareTaskCommandPermissionDisplay,
  compareTaskCommandPermissionPriority,
  maxRiskLevel,
  publicValidationCommand as stripInternalCommandFields
} from "./validationPolicy.js";

export type InternalValidationCommand = Omit<ValidationCommandDefinition, "executionMode" | "boundary"> & {
  executable?: string;
  args?: string[];
  executeBuiltIn?: (task: ForgeTask) => Promise<string>;
};

export type InternalValidationPreset = Omit<ValidationPreset, "commands"> & {
  commands: InternalValidationCommand[];
};

interface WorkspacePresetConfigStatus {
  path: string;
  exists: boolean;
  issues: string[];
}

export interface ValidationPresetRegistry {
  presets: InternalValidationPreset[];
  workspaceConfig: WorkspacePresetConfigStatus;
}

export function createValidationCatalogService(options: {
  tasks: Map<string, ForgeTask>;
  builtInValidationPresets: InternalValidationPreset[];
  validationCommandCatalog: Map<string, InternalValidationCommand>;
  validationPresetConfigPath: string;
  hasRunningValidationRun: (task: ForgeTask) => boolean;
  hasRunningTaskCommandRun: (task: ForgeTask) => boolean;
  findLastValidationRun: (task: ForgeTask, presetID: string) => ValidationPermissionLastRun | undefined;
  findLastTaskCommandRun: (task: ForgeTask, commandID: string) => TaskCommandPermission["lastRun"];
}) {
const {
  tasks,
  builtInValidationPresets,
  validationCommandCatalog,
  validationPresetConfigPath,
  hasRunningValidationRun,
  hasRunningTaskCommandRun,
  findLastValidationRun,
  findLastTaskCommandRun
} = options;

function listValidationPresets(registry: ValidationPresetRegistry): ValidationPreset[] {
  return registry.presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    source: preset.source,
    riskLevel: preset.riskLevel,
    requiresApproval: preset.requiresApproval,
    commands: preset.commands.map(stripInternalCommandFields)
  }));
}

async function listValidationPermissions(taskID: string): Promise<ValidationPermissionEnvelope> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  const registry = await loadValidationPresetRegistry();
  const now = new Date();
  return {
    taskID: task.id,
    taskStatus: task.status,
    currentPhase: task.currentPhase,
    permissions: registry.presets.map((preset) => buildValidationPermission(task, preset, now)),
    taskCommands: buildTaskCommandPermissions(task, registry.presets, now),
    approvalPolicy: validationApprovalPolicy
  };
}

function buildValidationPermission(
  task: ForgeTask,
  preset: InternalValidationPreset,
  now = new Date()
): ValidationPresetPermission {
  const resolution = resolveValidationPresetApproval(task, preset.id, now);
  const approval = resolution.state === "Approved" ? resolution.approval : undefined;
  const approvalState: ValidationPresetPermission["approvalState"] = !preset.requiresApproval
    ? "NotRequired"
    : resolution.state;
  const blockedReasons: string[] = [];

  if (task.editProposal?.status !== "Applied") {
    blockedReasons.push("Validation requires an applied edit proposal.");
  }

  if (hasRunningValidationRun(task)) {
    blockedReasons.push("Another validation run is already active.");
  }

  if (preset.requiresApproval && !approval) {
    blockedReasons.push(resolution.reason ?? "Preset requires task-level approval before execution.");
  }

  const executionState: ValidationPresetPermission["executionState"] = hasRunningValidationRun(task)
    ? "Running"
    : preset.requiresApproval && !approval
      ? "NeedsApproval"
      : task.editProposal?.status !== "Applied"
        ? "Blocked"
        : "Ready";

  return {
    preset: {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      source: preset.source,
      riskLevel: preset.riskLevel,
      requiresApproval: preset.requiresApproval,
      commands: preset.commands.map(stripInternalCommandFields)
    },
    approvalState,
    executionState,
    canApprove: preset.requiresApproval && !approval,
    canRevoke: preset.requiresApproval && resolution.state === "Approved",
    canRun: executionState === "Ready",
    blockedReasons,
    approval: preset.requiresApproval ? publicValidationPermissionApproval(resolution) : undefined,
    lastRun: findLastValidationRun(task, preset.id)
  };
}

function buildTaskCommandPermissions(
  task: ForgeTask,
  presets: InternalValidationPreset[],
  now = new Date()
): TaskCommandPermission[] {
  const byCommandID = new Map<string, TaskCommandPermission>();

  for (const preset of presets) {
    for (const command of preset.commands) {
      if (command.kind !== "ProjectCommand") {
        continue;
      }

      const permission = buildTaskCommandPermission(task, preset, command, now);
      const existing = byCommandID.get(command.id);
      if (!existing || compareTaskCommandPermissionPriority(permission, existing) < 0) {
        byCommandID.set(command.id, permission);
      }
    }
  }

  return [...byCommandID.values()].sort(compareTaskCommandPermissionDisplay);
}

function buildTaskCommandPermission(
  task: ForgeTask,
  preset: InternalValidationPreset,
  command: InternalValidationCommand,
  now = new Date()
): TaskCommandPermission {
  const resolution = resolveValidationPresetApproval(task, preset.id, now);
  const approval = resolution.state === "Approved" ? resolution.approval : undefined;
  const approvalState: TaskCommandPermission["approvalState"] = !preset.requiresApproval
    ? "NotRequired"
    : resolution.state;
  const blockedReasons: string[] = [];

  if (hasRunningTaskCommandRun(task)) {
    blockedReasons.push("Another task command is already active.");
  }

  if (hasRunningValidationRun(task)) {
    blockedReasons.push("A validation run is already active.");
  }

  if (preset.requiresApproval && !approval) {
    blockedReasons.push(resolution.reason ?? "Preset requires task-level approval before execution.");
  }

  const executionState: TaskCommandPermission["executionState"] = hasRunningTaskCommandRun(task) || hasRunningValidationRun(task)
    ? "Running"
    : preset.requiresApproval && !approval
      ? "NeedsApproval"
      : "Ready";

  return {
    command: stripInternalCommandFields(command),
    presetID: preset.id,
    presetName: preset.name,
    presetSource: preset.source,
    presetRiskLevel: preset.riskLevel,
    approvalState,
    executionState,
    canRun: executionState === "Ready",
    canRevoke: preset.requiresApproval && resolution.state === "Approved",
    blockedReasons,
    approval: preset.requiresApproval ? publicValidationPermissionApproval(resolution) : undefined,
    lastRun: findLastTaskCommandRun(task, command.id)
  };
}

async function loadValidationPresetRegistry(): Promise<ValidationPresetRegistry> {
  const workspaceConfig = await loadWorkspaceValidationPresets();
  const usedIDs = new Set(builtInValidationPresets.map((preset) => preset.id));
  const workspacePresets: InternalValidationPreset[] = [];

  for (const preset of workspaceConfig.presets) {
    if (usedIDs.has(preset.id)) {
      workspaceConfig.status.issues.push(`Skipped duplicate preset id: ${preset.id}`);
      continue;
    }

    usedIDs.add(preset.id);
    workspacePresets.push(preset);
  }

  return {
    presets: [...builtInValidationPresets, ...workspacePresets],
    workspaceConfig: workspaceConfig.status
  };
}

async function loadWorkspaceValidationPresets(): Promise<{
  status: WorkspacePresetConfigStatus;
  presets: InternalValidationPreset[];
}> {
  const configPath = validationPresetConfigPath;
  const status: WorkspacePresetConfigStatus = {
    path: configPath,
    exists: false,
    issues: []
  };

  let rawConfig: string;
  try {
    rawConfig = await readFile(configPath, "utf8");
    status.exists = true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status, presets: [] };
    }

    status.issues.push(safeErrorMessage(error));
    return { status, presets: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch (error) {
    status.issues.push(`Invalid JSON: ${safeErrorMessage(error)}`);
    return { status, presets: [] };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.presets)) {
    status.issues.push("Config must be an object with a presets array.");
    return { status, presets: [] };
  }

  const presets: InternalValidationPreset[] = [];
  for (const candidate of parsed.presets) {
    const preset = parseWorkspacePreset(candidate, status.issues);
    if (preset) {
      presets.push(preset);
    }
  }

  return { status, presets };
}

function parseWorkspacePreset(
  candidate: unknown,
  issues: string[]
): InternalValidationPreset | undefined {
  if (!isRecord(candidate)) {
    issues.push("Skipped workspace preset because it is not an object.");
    return undefined;
  }

  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) {
    issues.push(`Skipped workspace preset with invalid id: ${id || "<missing>"}`);
    return undefined;
  }

  const name = typeof candidate.name === "string" && candidate.name.trim()
    ? candidate.name.trim()
    : id;
  const description = typeof candidate.description === "string"
    ? candidate.description.trim()
    : "Workspace validation preset.";
  const commandIDs = Array.isArray(candidate.commandIDs) ? candidate.commandIDs : [];
  if (commandIDs.length === 0) {
    issues.push(`Skipped workspace preset ${id}: commandIDs must be a non-empty array.`);
    return undefined;
  }

  const commands: InternalValidationCommand[] = [];
  for (const commandID of commandIDs) {
    if (typeof commandID !== "string") {
      issues.push(`Skipped non-string command id in workspace preset ${id}.`);
      continue;
    }

    const command = validationCommandCatalog.get(commandID);
    if (!command) {
      issues.push(`Skipped unknown command id in workspace preset ${id}: ${commandID}`);
      continue;
    }

    commands.push(command);
  }

  if (commands.length === 0) {
    issues.push(`Skipped workspace preset ${id}: no valid commands remained.`);
    return undefined;
  }

  const riskLevel = maxRiskLevel(commands.map((command) => command.riskLevel));
  return {
    id,
    name,
    description,
    source: "Workspace",
    riskLevel,
    requiresApproval: riskLevel !== "Low",
    commands
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

return {
  listValidationPresets,
  listValidationPermissions,
  loadValidationPresetRegistry,
  buildTaskCommandPermissions
};
}
