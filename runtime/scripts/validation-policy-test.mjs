#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  compareTaskCommandPermissionDisplay,
  compareTaskCommandPermissionPriority,
  maxRiskLevel,
  publicValidationCommand,
  taskCommandPermissionRank
} from "../dist/validation/validationPolicy.js";

const builtIn = publicValidationCommand({
  id: "built-in",
  name: "Built in",
  command: "forge:check",
  kind: "BuiltIn",
  riskLevel: "Low"
});
assert.equal(builtIn.executionMode, "BuiltIn");
assert.match(builtIn.boundary, /without spawning/);

const project = publicValidationCommand({
  id: "npm-check",
  name: "NPM check",
  command: "npm run check",
  kind: "ProjectCommand",
  riskLevel: "Medium",
  cwd: "runtime"
});
assert.equal(project.executionMode, "SpawnNoShell");
assert.match(project.boundary, /shell disabled from runtime/);

assert.equal(maxRiskLevel([]), "Low");
assert.equal(maxRiskLevel(["Low", "Medium"]), "Medium");
assert.equal(maxRiskLevel(["Low", "High", "Medium"]), "High");

const readyMedium = permission({
  command: project,
  presetName: "Runtime",
  canRun: true,
  approvalState: "Approved",
  executionState: "Ready"
});
const readyLow = permission({
  command: builtIn,
  presetName: "Built in",
  canRun: true,
  approvalState: "NotRequired",
  executionState: "Ready"
});
const approvedBlocked = permission({
  command: project,
  presetName: "Approved",
  canRun: false,
  approvalState: "Approved",
  executionState: "Running"
});
const needsApproval = permission({
  command: project,
  presetName: "Needs approval",
  canRun: false,
  approvalState: "NeedsApproval",
  executionState: "NeedsApproval"
});
const blocked = permission({
  command: project,
  presetName: "Blocked",
  canRun: false,
  approvalState: "NeedsApproval",
  executionState: "Blocked"
});

assert.equal(taskCommandPermissionRank(readyMedium), 4);
assert.equal(taskCommandPermissionRank(approvedBlocked), 3);
assert.equal(taskCommandPermissionRank(needsApproval), 2);
assert.equal(taskCommandPermissionRank(blocked), 1);

const selected = [needsApproval, approvedBlocked, readyMedium].sort(compareTaskCommandPermissionPriority);
assert.equal(selected[0], readyMedium);
assert.equal(selected[1], approvedBlocked);

const displayed = [blocked, readyMedium, readyLow].sort(compareTaskCommandPermissionDisplay);
assert.equal(displayed[0], readyLow);
assert.equal(displayed[1], readyMedium);
assert.equal(displayed[2], blocked);

console.log("Validation policy test passed: 16 assertions.");

function permission(overrides) {
  return {
    command: project,
    presetID: "preset",
    presetName: "Preset",
    presetSource: "BuiltIn",
    presetRiskLevel: "Medium",
    approvalState: "NeedsApproval",
    executionState: "Blocked",
    canRun: false,
    blockedReasons: [],
    ...overrides
  };
}
