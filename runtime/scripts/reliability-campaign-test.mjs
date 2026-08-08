#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  RELIABILITY_STAGE_IDS,
  buildReliabilityCampaignReport,
  renderReliabilityCampaignMarkdown
} from "../dist/reliabilityCampaign.js";

const passedStages = RELIABILITY_STAGE_IDS.map((id) => ({
  id,
  status: "Passed",
  durationMs: 10,
  summary: `${id} passed.`
}));
const report = buildReliabilityCampaignReport([
  {
    id: "applied",
    title: "Applied fixture",
    category: "bugfix",
    language: "TypeScript",
    expectedOutcome: "Applied",
    status: "Passed",
    durationMs: 130,
    operationKind: "ReplaceText",
    changedFiles: ["src/example.ts"],
    stages: passedStages
  },
  {
    id: "guarded",
    title: "Guard fixture",
    category: "negative-control",
    language: "Text",
    expectedOutcome: "Guarded",
    status: "Guarded",
    durationMs: 30,
    changedFiles: [],
    stages: [
      { id: "fixture", status: "Passed", durationMs: 10, summary: "Fixture ready." },
      { id: "proposal-validation", status: "Passed", durationMs: 20, summary: "Unsafe proposal blocked." },
      { id: "apply", status: "Skipped", durationMs: 0, summary: "Apply intentionally skipped." }
    ]
  }
], { generatedAt: "2026-08-08T20:00:00.000Z", durationMs: 160 });

assert.equal(report.status, "Passed");
assert.equal(report.passedCount, 1);
assert.equal(report.guardedCount, 1);
assert.equal(report.failedCount, 0);
assert.equal(report.stagePassRate, 1);

const markdown = renderReliabilityCampaignMarkdown(report);
assert(markdown.includes("# Forge Alpha Repository Reliability Baseline"));
assert(markdown.includes("| Applied fixture | bugfix | TypeScript | Applied | Passed |"));
assert(markdown.includes("Negative controls guarded: 1"));
assert(markdown.includes("Unsafe proposal blocked."));

const failed = buildReliabilityCampaignReport([{ ...report.cases[0], status: "Failed", failureStage: "oracle" }]);
assert.equal(failed.status, "Failed");
assert.equal(failed.failedCount, 1);

console.log("Reliability campaign report test passed: scorecard + guarded controls + Markdown rendering.");
