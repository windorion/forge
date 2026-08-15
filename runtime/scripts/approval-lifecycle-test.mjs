import assert from "node:assert/strict";
import test from "node:test";

import {
  findValidationPresetApproval,
  hasValidationPresetApproval,
  publicValidationPermissionApproval,
  resolveValidationApprovalDuration,
  resolveValidationApprovalScope,
  resolveValidationPresetApproval,
  validationApprovalDefaultDurationSeconds,
  validationApprovalPolicy
} from "../dist/validation/approvalLifecycle.js";

const presetID = "runtime-typescript";
const decidedAt = "2026-08-15T10:00:00.000Z";
const expiresAt = "2026-08-15T11:00:00.000Z";

function approval(overrides = {}) {
  return {
    id: "approval-1",
    action: "Approve Validation Preset",
    decision: "Approved",
    summary: "Approved validation preset.",
    targetID: presetID,
    decidedAt,
    scope: "Task",
    expiresAt,
    ...overrides
  };
}

test("task approval is active before expiry and expires at the exact boundary", () => {
  const task = { approvals: [approval()] };
  const beforeExpiry = new Date("2026-08-15T10:59:59.999Z");
  assert.equal(resolveValidationPresetApproval(task, presetID, beforeExpiry).state, "Approved");
  assert.equal(hasValidationPresetApproval(task, presetID, beforeExpiry), true);
  assert.equal(findValidationPresetApproval(task, presetID, beforeExpiry)?.id, "approval-1");

  const boundary = resolveValidationPresetApproval(task, presetID, new Date(expiresAt));
  assert.equal(boundary.state, "Expired");
  assert.match(boundary.reason, /expired at/);
  assert.equal(hasValidationPresetApproval(task, presetID, new Date(expiresAt)), false);
  assert.equal(findValidationPresetApproval(task, presetID, new Date(expiresAt)), undefined);
});

test("legacy, malformed, and unsupported-scope approvals fail closed", () => {
  const legacy = resolveValidationPresetApproval(
    { approvals: [approval({ scope: undefined, expiresAt: undefined })] },
    presetID
  );
  assert.equal(legacy.state, "Expired");
  assert.equal(publicValidationPermissionApproval(legacy)?.scope, undefined);
  assert.equal(publicValidationPermissionApproval(legacy)?.expiresAt, undefined);
  assert.equal(
    resolveValidationPresetApproval({ approvals: [approval({ expiresAt: "not-a-date" })] }, presetID).state,
    "Expired"
  );
  assert.equal(
    resolveValidationPresetApproval({ approvals: [approval({ scope: "Repository" })] }, presetID).state,
    "Expired"
  );
});

test("revocation is append-only and a later bounded reapproval becomes active", () => {
  const revoked = {
    id: "revocation-1",
    action: "Revoke Validation Preset Approval",
    decision: "Revoked",
    summary: "Revoked.",
    targetID: presetID,
    revokedApprovalID: "approval-1",
    decidedAt: "2026-08-15T10:15:00.000Z",
    scope: "Task"
  };
  const resolution = resolveValidationPresetApproval(
    { approvals: [approval(), revoked] },
    presetID,
    new Date("2026-08-15T10:20:00.000Z")
  );
  assert.equal(resolution.state, "Revoked");
  assert.equal(resolution.revocation?.id, revoked.id);
  assert.equal(publicValidationPermissionApproval(resolution)?.revocationID, revoked.id);

  const reapproval = approval({
    id: "approval-2",
    decidedAt: "2026-08-15T10:30:00.000Z",
    expiresAt: "2026-08-15T12:30:00.000Z"
  });
  assert.equal(
    resolveValidationPresetApproval(
      { approvals: [approval(), revoked, reapproval] },
      presetID,
      new Date("2026-08-15T11:00:00.000Z")
    ).approval?.id,
    reapproval.id
  );
});

test("duration and scope policy accepts only explicit bounded task grants", () => {
  assert.equal(resolveValidationApprovalDuration(undefined), validationApprovalDefaultDurationSeconds);
  assert.equal(resolveValidationApprovalDuration(900), 900);
  assert.throws(() => resolveValidationApprovalDuration(901), /must be one of/);
  assert.throws(() => resolveValidationApprovalDuration(0), /must be one of/);
  assert.equal(resolveValidationApprovalScope(undefined), "Task");
  assert.equal(resolveValidationApprovalScope("Task"), "Task");
  assert.throws(() => resolveValidationApprovalScope("Repository"), /not grantable/);
  assert.throws(() => resolveValidationApprovalScope("Session"), /not grantable/);
  assert.deepEqual(validationApprovalPolicy.scopes.map((scope) => scope.scope), ["Task", "Repository", "Session"]);
  assert.deepEqual(validationApprovalPolicy.scopes.map((scope) => scope.grantable), [true, false, false]);
});
