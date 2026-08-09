#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  MISSION_CONTROL_SOAK_REPORT_SCHEMA_VERSION,
  buildMissionControlSoakReport,
  renderMissionControlSoakMarkdown
} from "./mission-control-soak-report.mjs";

const report = buildMissionControlSoakReport({
  startedAt: "2026-08-09T08:00:00.000Z",
  endedAt: "2026-08-09T14:00:07.250Z",
  requestedSoakSeconds: 21_600,
  actualSoakSeconds: 21_600.125,
  tasksPerRepository: 3,
  repositoryCount: 2,
  queue: { heldBeforeFirstGrant: 6, finalRunning: 0, finalQueued: 0 },
  grants: { total: 6, order: ["alpha", "beta", "alpha", "beta", "alpha", "beta"] },
  restarts: { everyGrants: 2, duringGrantDrain: 2, duringSoak: 120 },
  negativeControls: {
    staleAuthorizationRejected: true,
    startupAutoDispatchPrevented: true,
    starvationPrevented: true
  },
  environment: {
    node: "v24.1.0",
    platform: "darwin",
    release: "25.6.0",
    architecture: "arm64",
    hostname: "forge-mac",
    powerConditions: "AC power; sleep disabled for the run"
  },
  command: "script/run_mission_control_soak.sh 21600",
  fixtureRoot: "/tmp/forge-fair-queue-fixture",
  failureArtifactsPreserved: false,
  runtimeOutputTails: {}
});

assert.equal(report.schemaVersion, MISSION_CONTROL_SOAK_REPORT_SCHEMA_VERSION);
assert.equal(report.status, "Passed");
assert.equal(report.actualElapsedSeconds, 21_607.25);
assert.equal(report.actualSoakSeconds, 21_600.125);
assert.equal(report.grants.total, 6);
assert.equal(report.restarts.duringSoak, 120);

const markdown = renderMissionControlSoakMarkdown(report);
assert(markdown.includes("# Mission Control Supervision Soak Report"));
assert(markdown.includes("| Soak restarts | 120 |"));
assert(markdown.includes("alpha → beta → alpha"));
assert(markdown.includes("AC power; sleep disabled for the run"));

const failed = buildMissionControlSoakReport({
  ...report,
  failure: { name: "Error", message: "queue resurrected", stack: "Error: queue resurrected" },
  failureArtifactsPreserved: true,
  runtimeOutputTails: { alpha: "runtime tail" }
});
assert.equal(failed.status, "Failed");
assert(renderMissionControlSoakMarkdown(failed).includes("queue resurrected"));
assert(renderMissionControlSoakMarkdown(failed).includes("runtime tail"));

assert.throws(() => buildMissionControlSoakReport({ ...report, requestedSoakSeconds: -1 }), /non-negative/);
console.log("Mission Control soak report test passed: scorecard, environment, failure artifacts, and Markdown rendering.");
