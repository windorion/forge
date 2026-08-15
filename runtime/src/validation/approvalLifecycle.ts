import type {
  ApprovalRecord,
  ApprovalScope,
  ForgeTask,
  ValidationApprovalPolicy,
  ValidationPermissionApproval,
  ValidationPresetApprovalState
} from "../types.js";

export const validationApprovalDefaultDurationSeconds = 60 * 60;
export const validationApprovalMaxDurationSeconds = 24 * 60 * 60;
export const validationApprovalSupportedDurationSeconds = [15 * 60, 60 * 60, 4 * 60 * 60, 8 * 60 * 60, 24 * 60 * 60];

export const validationApprovalPolicy: ValidationApprovalPolicy = {
  defaultDurationSeconds: validationApprovalDefaultDurationSeconds,
  maxDurationSeconds: validationApprovalMaxDurationSeconds,
  supportedDurationSeconds: validationApprovalSupportedDurationSeconds,
  scopes: [
    {
      scope: "Task",
      grantable: true,
      persistence: "TaskRecord",
      summary: "Bound to one task, persisted with its audit trail, and invalid after expiry or revocation."
    },
    {
      scope: "Repository",
      grantable: false,
      persistence: "RepositoryRecord",
      summary: "Reserved for a future repository policy store; task approvals never widen into repository grants."
    },
    {
      scope: "Session",
      grantable: false,
      persistence: "RuntimeMemory",
      summary: "Reserved for process-memory grants that must disappear on runtime restart."
    }
  ]
};

export interface ValidationApprovalResolution {
  state: Exclude<ValidationPresetApprovalState, "NotRequired">;
  approval?: ApprovalRecord;
  revocation?: ApprovalRecord;
  reason?: string;
}

export function resolveValidationPresetApproval(
  task: Pick<ForgeTask, "approvals">,
  presetID: string,
  now = new Date()
): ValidationApprovalResolution {
  const approvals = task.approvals.filter(
    (approval) =>
      approval.action === "Approve Validation Preset" &&
      approval.decision === "Approved" &&
      approval.targetID === presetID
  );
  const approval = approvals.at(-1);
  if (!approval) {
    return { state: "NeedsApproval" };
  }

  const revocation = task.approvals.find(
    (candidate) =>
      candidate.action === "Revoke Validation Preset Approval" &&
      candidate.decision === "Revoked" &&
      candidate.revokedApprovalID === approval.id
  );
  if (revocation) {
    return {
      state: "Revoked",
      approval,
      revocation,
      reason: `Approval was revoked at ${revocation.decidedAt}.`
    };
  }

  if (approval.scope !== "Task") {
    return {
      state: "Expired",
      approval,
      reason: approval.scope
        ? `Validation presets do not accept ${approval.scope.toLowerCase()}-scoped grants.`
        : "Legacy approval has no bounded task scope and must be approved again."
    };
  }

  const expiresAtMs = approval.expiresAt ? Date.parse(approval.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAtMs)) {
    return {
      state: "Expired",
      approval,
      reason: "Approval has no valid expiry and must be approved again."
    };
  }
  if (now.getTime() >= expiresAtMs) {
    return {
      state: "Expired",
      approval,
      reason: `Approval expired at ${approval.expiresAt}.`
    };
  }

  return { state: "Approved", approval };
}

export function findValidationPresetApproval(
  task: Pick<ForgeTask, "approvals">,
  presetID: string,
  now = new Date()
): ApprovalRecord | undefined {
  const resolution = resolveValidationPresetApproval(task, presetID, now);
  return resolution.state === "Approved" ? resolution.approval : undefined;
}

export function hasValidationPresetApproval(
  task: Pick<ForgeTask, "approvals">,
  presetID: string,
  now = new Date()
): boolean {
  return findValidationPresetApproval(task, presetID, now) !== undefined;
}

export function resolveValidationApprovalDuration(durationSeconds: number | undefined): number {
  if (durationSeconds === undefined) {
    return validationApprovalDefaultDurationSeconds;
  }
  if (!Number.isInteger(durationSeconds) || !validationApprovalSupportedDurationSeconds.includes(durationSeconds)) {
    throw new Error(
      `Approval duration must be one of: ${validationApprovalSupportedDurationSeconds.join(", ")} seconds.`
    );
  }
  return durationSeconds;
}

export function resolveValidationApprovalScope(scope: ApprovalScope | undefined): "Task" {
  if (scope === undefined || scope === "Task") {
    return "Task";
  }
  throw new Error(`${scope}-scoped validation approvals are not grantable in this runtime.`);
}

export function publicValidationPermissionApproval(
  resolution: ValidationApprovalResolution
): ValidationPermissionApproval | undefined {
  const approval = resolution.approval;
  if (!approval) return undefined;
  return {
    id: approval.id,
    decidedAt: approval.decidedAt,
    summary: approval.summary,
    scope: approval.scope,
    expiresAt: approval.expiresAt,
    state: resolution.state === "Approved"
      ? "Approved"
      : resolution.state === "Revoked"
        ? "Revoked"
        : "Expired",
    revokedAt: resolution.revocation?.decidedAt,
    revocationID: resolution.revocation?.id,
    revocationNote: resolution.revocation?.userNote
  };
}
