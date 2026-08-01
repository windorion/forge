import type {
  TaskCommandPermission,
  ValidationCommandDefinition,
  ValidationPreset
} from "../types.js";

export type InternalCommandShape = Omit<ValidationCommandDefinition, "executionMode" | "boundary">;

export function publicValidationCommand(command: InternalCommandShape): ValidationCommandDefinition {
  return {
    id: command.id,
    name: command.name,
    command: command.command,
    kind: command.kind,
    riskLevel: command.riskLevel,
    cwd: command.cwd,
    executionMode: command.kind === "BuiltIn" ? "BuiltIn" : "SpawnNoShell",
    boundary: command.kind === "BuiltIn"
      ? "Runs inside the Forge runtime without spawning a project process."
      : `Runs with shell disabled from ${command.cwd ?? "the repository root"}.`
  };
}

export function maxRiskLevel(
  riskLevels: Array<ValidationPreset["riskLevel"]>
): ValidationPreset["riskLevel"] {
  if (riskLevels.includes("High")) return "High";
  if (riskLevels.includes("Medium")) return "Medium";
  return "Low";
}

export function compareTaskCommandPermissionPriority(
  left: TaskCommandPermission,
  right: TaskCommandPermission
): number {
  const leftRank = taskCommandPermissionRank(left);
  const rightRank = taskCommandPermissionRank(right);
  if (leftRank !== rightRank) return rightRank - leftRank;
  return left.presetName.localeCompare(right.presetName);
}

export function compareTaskCommandPermissionDisplay(
  left: TaskCommandPermission,
  right: TaskCommandPermission
): number {
  if (left.canRun !== right.canRun) return left.canRun ? -1 : 1;
  const riskOrder = new Map<ValidationCommandDefinition["riskLevel"], number>([
    ["Low", 0],
    ["Medium", 1],
    ["High", 2]
  ]);
  const riskDiff = (riskOrder.get(left.command.riskLevel) ?? 99) -
    (riskOrder.get(right.command.riskLevel) ?? 99);
  if (riskDiff !== 0) return riskDiff;
  return left.command.name.localeCompare(right.command.name);
}

export function taskCommandPermissionRank(permission: TaskCommandPermission): number {
  if (permission.canRun) return 4;
  if (permission.approvalState === "Approved" || permission.approvalState === "NotRequired") return 3;
  if (permission.executionState === "NeedsApproval") return 2;
  return 1;
}
