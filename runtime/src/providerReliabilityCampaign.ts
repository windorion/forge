export const PROVIDER_RELIABILITY_STAGE_IDS = [
  "fixture",
  "mock-provider",
  "runtime",
  "index",
  "intake",
  "provider-contract",
  "context-evidence",
  "plan-approval",
  "proposal",
  "proposal-validation",
  "file-review",
  "apply",
  "command-approval",
  "command-run",
  "repair-brief",
  "repair-proposal",
  "repair-apply",
  "repair-rerun",
  "git-evidence",
  "oracle",
  "audit-export"
] as const;

export type ProviderReliabilityStageID = typeof PROVIDER_RELIABILITY_STAGE_IDS[number];
export type ProviderReliabilityStageStatus = "Passed" | "Failed" | "Skipped";
export type ProviderReliabilityExpectedOutcome = "Applied" | "CommandPassed" | "RepairVerified" | "Guarded";
export type ProviderReliabilityCaseStatus = "Passed" | "Guarded" | "Failed";

export interface ProviderReliabilityStageResult {
  id: ProviderReliabilityStageID;
  status: ProviderReliabilityStageStatus;
  durationMs: number;
  summary: string;
  evidence?: string[];
}

export interface ProviderReliabilityCaseResult {
  id: string;
  title: string;
  category: string;
  expectedOutcome: ProviderReliabilityExpectedOutcome;
  status: ProviderReliabilityCaseStatus;
  durationMs: number;
  providerRequestCount: number;
  providerRequestNames: Record<string, number>;
  operationKinds: string[];
  changedFiles: string[];
  commandStatuses: string[];
  failureStage?: ProviderReliabilityStageID;
  failure?: string;
  stages: ProviderReliabilityStageResult[];
}

export interface ProviderReliabilityCampaignReport {
  schemaVersion: 1;
  campaign: string;
  generatedAt: string;
  provider: string;
  providerMode: "mock-remote";
  durationMs: number;
  caseCount: number;
  passedCount: number;
  guardedCount: number;
  failedCount: number;
  providerRequestCount: number;
  stagePassRate: number;
  status: "Passed" | "Failed";
  cases: ProviderReliabilityCaseResult[];
}

export function buildProviderReliabilityCampaignReport(
  cases: ProviderReliabilityCaseResult[],
  options: { generatedAt?: string; durationMs?: number; campaign?: string; provider?: string } = {}
): ProviderReliabilityCampaignReport {
  const scoredStages = cases.flatMap((result) => result.stages).filter((stage) => stage.status !== "Skipped");
  const passedStages = scoredStages.filter((stage) => stage.status === "Passed").length;
  const failedCount = cases.filter((result) => result.status === "Failed").length;
  return {
    schemaVersion: 1,
    campaign: options.campaign ?? "Forge Alpha mock-OpenAI provider reliability campaign",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    provider: options.provider ?? "OpenAI Responses compatible mock",
    providerMode: "mock-remote",
    durationMs: options.durationMs ?? cases.reduce((total, result) => total + result.durationMs, 0),
    caseCount: cases.length,
    passedCount: cases.filter((result) => result.status === "Passed").length,
    guardedCount: cases.filter((result) => result.status === "Guarded").length,
    failedCount,
    providerRequestCount: cases.reduce((total, result) => total + result.providerRequestCount, 0),
    stagePassRate: scoredStages.length === 0 ? 0 : passedStages / scoredStages.length,
    status: failedCount === 0 && cases.length > 0 ? "Passed" : "Failed",
    cases
  };
}

export function renderProviderReliabilityCampaignMarkdown(report: ProviderReliabilityCampaignReport): string {
  const lines = [
    "# Forge Alpha Mock-OpenAI Provider Reliability Baseline",
    "",
    `Generated: ${report.generatedAt}`,
    `Provider: ${report.provider}`,
    `Provider mode: ${report.providerMode}`,
    `Campaign status: ${report.status}`,
    "",
    "## Scorecard",
    "",
    `- Cases: ${report.caseCount}`,
    `- Cases passed: ${report.passedCount}`,
    `- Negative controls guarded: ${report.guardedCount}`,
    `- Unexpected failures: ${report.failedCount}`,
    `- Provider requests: ${report.providerRequestCount}`,
    `- Scored-stage pass rate: ${(report.stagePassRate * 100).toFixed(1)}%`,
    `- Duration: ${formatDuration(report.durationMs)}`,
    "",
    "## Cases",
    "",
    "| Case | Category | Expected | Result | Provider calls | Operations | Commands | Changed files | Duration |",
    "| --- | --- | --- | --- | ---: | --- | --- | --- | --- |"
  ];

  for (const result of report.cases) {
    lines.push(
      `| ${escapeTable(result.title)} | ${escapeTable(result.category)} | ${result.expectedOutcome} | ${result.status} | ${result.providerRequestCount} | ${escapeTable(result.operationKinds.join(", ") || "—")} | ${escapeTable(result.commandStatuses.join(", ") || "—")} | ${escapeTable(result.changedFiles.join(", ") || "—")} | ${formatDuration(result.durationMs)} |`
    );
  }

  for (const result of report.cases) {
    lines.push("", `### ${result.title}`, "");
    lines.push(`Outcome: ${result.status}${result.failureStage ? ` at ${result.failureStage}` : ""}.`);
    if (result.failure) lines.push(`Failure: ${result.failure}`);
    lines.push(`Provider calls: ${formatRequestNames(result.providerRequestNames)}.`);
    lines.push("", "| Stage | Status | Duration | Evidence |", "| --- | --- | --- | --- |");
    for (const stage of result.stages) {
      lines.push(
        `| ${stage.id} | ${stage.status} | ${formatDuration(stage.durationMs)} | ${escapeTable(stage.evidence?.join("; ") ?? stage.summary)} |`
      );
    }
  }

  lines.push(
    "",
    "## Interpretation",
    "",
    "This baseline exercises the production OpenAI Responses adapter against a loopback mock that returns strict-schema artifacts. It proves request shaping, context/tool mediation, provider-output normalization, review gates, no-shell command policy, repair lineage, and audit persistence without sending repository data to an external service or incurring API cost. It does not measure real-model coding quality.",
    ""
  );
  return lines.join("\n");
}

function formatRequestNames(names: Record<string, number>): string {
  return Object.entries(names)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}=${count}`)
    .join(", ") || "none";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
