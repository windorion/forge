#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PROVIDER_RELIABILITY_STAGE_IDS,
  buildProviderReliabilityCampaignReport,
  renderProviderReliabilityCampaignMarkdown
} from "../dist/providerReliabilityCampaign.js";

const campaignSource = await readFile(new URL("./provider-reliability-campaign.mjs", import.meta.url), "utf8");
assert.match(campaignSource, /check: \"node scripts\/check\.mjs\"/);
assert.doesNotMatch(campaignSource, /check: \"tsc /);

const stages = PROVIDER_RELIABILITY_STAGE_IDS.map((id) => ({
  id,
  status: ["repair-brief", "repair-proposal", "repair-apply", "repair-rerun"].includes(id) ? "Skipped" : "Passed",
  durationMs: 5,
  summary: `${id} evidence.`
}));
const report = buildProviderReliabilityCampaignReport([{
  id: "unified-diff",
  title: "Mock OpenAI unified diff",
  category: "provider-edit",
  expectedOutcome: "Applied",
  status: "Passed",
  durationMs: 100,
  providerRequestCount: 6,
  providerRequestNames: { forge_intent_brief: 1, forge_edit_proposal: 1 },
  operationKinds: ["UnifiedDiff"],
  changedFiles: ["src/greeting.ts"],
  commandStatuses: [],
  stages
}], { generatedAt: "2026-08-08T20:00:00.000Z", durationMs: 100 });

assert.equal(report.status, "Passed");
assert.equal(report.providerMode, "mock-remote");
assert.equal(report.providerRequestCount, 6);
assert.equal(report.stagePassRate, 1);
const markdown = renderProviderReliabilityCampaignMarkdown(report);
assert(markdown.includes("# Forge Alpha Mock-OpenAI Provider Reliability Baseline"));
assert(markdown.includes("| Mock OpenAI unified diff | provider-edit | Applied | Passed | 6 | UnifiedDiff |"));
assert(markdown.includes("forge_edit_proposal=1"));

const failed = buildProviderReliabilityCampaignReport([{ ...report.cases[0], status: "Failed", failureStage: "command-run" }]);
assert.equal(failed.status, "Failed");
assert.equal(failed.failedCount, 1);

console.log("Provider reliability campaign report test passed.");
