export const RELIABILITY_STAGE_IDS = [
  "fixture",
  "runtime",
  "index",
  "intake",
  "plan",
  "approval",
  "proposal",
  "proposal-validation",
  "file-review",
  "apply",
  "git-evidence",
  "oracle",
  "audit-export"
] as const;

export type ReliabilityStageID = typeof RELIABILITY_STAGE_IDS[number];
export type ReliabilityStageStatus = "Passed" | "Failed" | "Skipped";
export type ReliabilityExpectedOutcome = "Applied" | "Guarded";
export type ReliabilityCaseStatus = "Passed" | "Guarded" | "Failed";

export interface ReliabilityStageResult {
  id: ReliabilityStageID;
  status: ReliabilityStageStatus;
  durationMs: number;
  summary: string;
  evidence?: string[];
}

export interface ReliabilityCaseResult {
  id: string;
  title: string;
  category: string;
  language: string;
  expectedOutcome: ReliabilityExpectedOutcome;
  status: ReliabilityCaseStatus;
  durationMs: number;
  operationKind?: string;
  changedFiles: string[];
  failureStage?: ReliabilityStageID;
  failure?: string;
  stages: ReliabilityStageResult[];
}

export interface ReliabilityCampaignReport {
  schemaVersion: 1;
  campaign: string;
  generatedAt: string;
  runtimeProvider: string;
  durationMs: number;
  caseCount: number;
  passedCount: number;
  guardedCount: number;
  failedCount: number;
  stagePassRate: number;
  status: "Passed" | "Failed";
  cases: ReliabilityCaseResult[];
}

export function buildReliabilityCampaignReport(
  cases: ReliabilityCaseResult[],
  options: {
    generatedAt?: string;
    durationMs?: number;
    campaign?: string;
    runtimeProvider?: string;
  } = {}
): ReliabilityCampaignReport {
  const passedCount = cases.filter((result) => result.status === "Passed").length;
  const guardedCount = cases.filter((result) => result.status === "Guarded").length;
  const failedCount = cases.filter((result) => result.status === "Failed").length;
  const scoredStages = cases.flatMap((result) => result.stages).filter((stage) => stage.status !== "Skipped");
  const passedStages = scoredStages.filter((stage) => stage.status === "Passed").length;

  return {
    schemaVersion: 1,
    campaign: options.campaign ?? "Forge Alpha repository reliability campaign",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    runtimeProvider: options.runtimeProvider ?? "local-deterministic",
    durationMs: options.durationMs ?? cases.reduce((total, result) => total + result.durationMs, 0),
    caseCount: cases.length,
    passedCount,
    guardedCount,
    failedCount,
    stagePassRate: scoredStages.length === 0 ? 0 : passedStages / scoredStages.length,
    status: failedCount === 0 && cases.length > 0 ? "Passed" : "Failed",
    cases
  };
}

export function renderReliabilityCampaignMarkdown(report: ReliabilityCampaignReport): string {
  const lines = [
    "# Forge Alpha Repository Reliability Baseline",
    "",
    `Generated: ${report.generatedAt}`,
    `Provider: ${report.runtimeProvider}`,
    `Campaign status: ${report.status}`,
    "",
    "## Scorecard",
    "",
    `- Cases: ${report.caseCount}`,
    `- Applied cases passed: ${report.passedCount}`,
    `- Negative controls guarded: ${report.guardedCount}`,
    `- Unexpected failures: ${report.failedCount}`,
    `- Stage pass rate: ${(report.stagePassRate * 100).toFixed(1)}%`,
    `- Duration: ${formatDuration(report.durationMs)}`,
    "",
    "## Cases",
    "",
    "| Case | Category | Language | Expected | Result | Operation | Changed files | Duration |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"
  ];

  for (const result of report.cases) {
    lines.push(
      `| ${escapeTable(result.title)} | ${escapeTable(result.category)} | ${escapeTable(result.language)} | ${result.expectedOutcome} | ${result.status} | ${result.operationKind ?? "—"} | ${escapeTable(result.changedFiles.join(", ") || "—")} | ${formatDuration(result.durationMs)} |`
    );
  }

  for (const result of report.cases) {
    lines.push("", `### ${result.title}`, "");
    lines.push(`Outcome: ${result.status}${result.failureStage ? ` at ${result.failureStage}` : ""}.`);
    if (result.failure) lines.push(`Failure: ${result.failure}`);
    lines.push("", "| Stage | Status | Duration | Evidence |", "| --- | --- | --- | --- |");
    for (const stage of result.stages) {
      const evidence = stage.evidence?.join("; ") ?? stage.summary;
      lines.push(`| ${stage.id} | ${stage.status} | ${formatDuration(stage.durationMs)} | ${escapeTable(evidence)} |`);
    }
  }

  lines.push(
    "",
    "## Interpretation",
    "",
    "An applied case passes only when the reviewed edit is applied, Git reports exactly the expected file set, the external content oracle passes, and both JSON and Markdown audit exports contain the task evidence. A guarded negative control passes only when proposal validation blocks the unsafe edit and the repository remains unchanged.",
    ""
  );
  return lines.join("\n");
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
