export type PerformanceMetricUnit = "ms" | "MiB" | "%";
export type PerformanceStatistic = "p50" | "p95" | "max" | "mean";
export type PerformanceBudgetSeverity = "hard" | "advisory";

export interface PerformanceMetricSamples {
  id: string;
  title: string;
  unit: PerformanceMetricUnit;
  samples: number[];
  context?: Record<string, string | number | boolean>;
}

export interface PerformanceMetricSummary {
  id: string;
  title: string;
  unit: PerformanceMetricUnit;
  sampleCount: number;
  samples: number[];
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  context?: Record<string, string | number | boolean>;
}

export interface PerformanceBudget {
  metricID: string;
  statistic: PerformanceStatistic;
  max: number;
  severity: PerformanceBudgetSeverity;
  rationale: string;
}

export interface PerformanceBudgetEvaluation {
  metricID: string;
  statistic: PerformanceStatistic;
  severity: PerformanceBudgetSeverity;
  status: "Passed" | "Failed" | "Missing";
  observed?: number;
  limit: number;
  headroomPercent?: number;
  rationale: string;
}

export interface PerformanceBaselineComparison {
  metricID: string;
  statistic: PerformanceStatistic;
  status: "Improved" | "Stable" | "Regressed" | "Missing";
  baseline?: number;
  observed?: number;
  delta?: number;
  deltaPercent?: number;
  allowedRegressionPercent: number;
  noiseFloor: number;
}

export interface PerformanceReport {
  schemaVersion: 1;
  campaign: "Forge runtime performance budget campaign";
  generatedAt: string;
  profile: string;
  status: "Passed" | "Failed";
  durationMs: number;
  environment: {
    platform: string;
    architecture: string;
    nodeVersion: string;
    cpuCount: number;
    totalMemoryMiB: number;
    ci: boolean;
    gitCommit?: string;
  };
  fixture: Record<string, string | number | boolean>;
  metrics: PerformanceMetricSummary[];
  evaluations: PerformanceBudgetEvaluation[];
  baselineComparisons: PerformanceBaselineComparison[];
}

export function summarizePerformanceMetric(metric: PerformanceMetricSamples): PerformanceMetricSummary {
  if (metric.samples.length === 0) {
    throw new Error(`Performance metric ${metric.id} has no samples.`);
  }
  if (metric.samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new Error(`Performance metric ${metric.id} contains an invalid sample.`);
  }
  const sorted = [...metric.samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, sample) => sum + sample, 0);
  return {
    id: metric.id,
    title: metric.title,
    unit: metric.unit,
    sampleCount: sorted.length,
    samples: metric.samples.map(roundMetric),
    min: roundMetric(sorted[0]),
    max: roundMetric(sorted.at(-1)!),
    mean: roundMetric(total / sorted.length),
    p50: roundMetric(percentile(sorted, 0.50)),
    p95: roundMetric(percentile(sorted, 0.95)),
    context: metric.context
  };
}

export function evaluatePerformanceBudgets(
  metrics: PerformanceMetricSummary[],
  budgets: PerformanceBudget[]
): PerformanceBudgetEvaluation[] {
  const summaries = new Map(metrics.map((metric) => [metric.id, metric]));
  return budgets.map((budget) => {
    const summary = summaries.get(budget.metricID);
    if (!summary) {
      return {
        metricID: budget.metricID,
        statistic: budget.statistic,
        severity: budget.severity,
        status: "Missing",
        limit: budget.max,
        rationale: budget.rationale
      };
    }
    const observed = summary[budget.statistic];
    const headroomPercent = budget.max === 0 ? 0 : ((budget.max - observed) / budget.max) * 100;
    return {
      metricID: budget.metricID,
      statistic: budget.statistic,
      severity: budget.severity,
      status: observed <= budget.max ? "Passed" : "Failed",
      observed,
      limit: budget.max,
      headroomPercent: roundMetric(headroomPercent),
      rationale: budget.rationale
    };
  });
}

export function comparePerformanceBaseline(
  current: PerformanceMetricSummary[],
  baseline: PerformanceMetricSummary[],
  options: { statistic?: PerformanceStatistic; allowedRegressionPercent: number; noiseFloor: number }
): PerformanceBaselineComparison[] {
  const statistic = options.statistic ?? "p95";
  const baselineByID = new Map(baseline.map((metric) => [metric.id, metric]));
  return current.map((metric) => {
    const previous = baselineByID.get(metric.id);
    if (!previous || previous.unit !== metric.unit) {
      return {
        metricID: metric.id,
        statistic,
        status: "Missing",
        observed: metric[statistic],
        allowedRegressionPercent: options.allowedRegressionPercent,
        noiseFloor: options.noiseFloor
      };
    }
    const observed = metric[statistic];
    const baselineValue = previous[statistic];
    const delta = observed - baselineValue;
    const deltaPercent = baselineValue === 0 ? (delta === 0 ? 0 : 100) : (delta / baselineValue) * 100;
    const regressed = delta > options.noiseFloor && deltaPercent > options.allowedRegressionPercent;
    const improved = delta < -options.noiseFloor;
    return {
      metricID: metric.id,
      statistic,
      status: regressed ? "Regressed" : improved ? "Improved" : "Stable",
      baseline: baselineValue,
      observed,
      delta: roundMetric(delta),
      deltaPercent: roundMetric(deltaPercent),
      allowedRegressionPercent: options.allowedRegressionPercent,
      noiseFloor: options.noiseFloor
    };
  });
}

export function buildPerformanceReport(options: {
  generatedAt?: string;
  profile: string;
  durationMs: number;
  environment: PerformanceReport["environment"];
  fixture: PerformanceReport["fixture"];
  samples: PerformanceMetricSamples[];
  budgets: PerformanceBudget[];
  baselineMetrics?: PerformanceMetricSummary[];
  baselinePolicy?: { statistic?: PerformanceStatistic; allowedRegressionPercent: number; noiseFloor: number };
}): PerformanceReport {
  const metrics = options.samples.map(summarizePerformanceMetric);
  const evaluations = evaluatePerformanceBudgets(metrics, options.budgets);
  const baselineComparisons = options.baselineMetrics && options.baselinePolicy
    ? comparePerformanceBaseline(metrics, options.baselineMetrics, options.baselinePolicy)
    : [];
  const hardFailure = evaluations.some((evaluation) =>
    evaluation.severity === "hard" && evaluation.status !== "Passed"
  );
  const baselineFailure = baselineComparisons.some((comparison) => comparison.status === "Regressed");
  return {
    schemaVersion: 1,
    campaign: "Forge runtime performance budget campaign",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    profile: options.profile,
    status: hardFailure || baselineFailure ? "Failed" : "Passed",
    durationMs: Math.max(0, Math.round(options.durationMs)),
    environment: options.environment,
    fixture: options.fixture,
    metrics,
    evaluations,
    baselineComparisons
  };
}

export function renderPerformanceReportMarkdown(report: PerformanceReport): string {
  const lines = [
    "# Forge Runtime Performance Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Profile: ${report.profile}`,
    `Status: ${report.status}`,
    `Duration: ${formatValue(report.durationMs, "ms")}`,
    "",
    "## Environment",
    "",
    `- Platform: ${report.environment.platform}/${report.environment.architecture}`,
    `- Node: ${report.environment.nodeVersion}`,
    `- CPUs: ${report.environment.cpuCount}`,
    `- Memory: ${report.environment.totalMemoryMiB} MiB`,
    `- CI: ${report.environment.ci ? "yes" : "no"}`,
    `- Git commit: ${report.environment.gitCommit ?? "unknown"}`,
    "",
    "## Fixture",
    ""
  ];
  for (const [key, value] of Object.entries(report.fixture)) lines.push(`- ${key}: ${value}`);
  lines.push(
    "",
    "## Metrics",
    "",
    "| Metric | Samples | p50 | p95 | Max | Mean |",
    "| --- | ---: | ---: | ---: | ---: | ---: |"
  );
  for (const metric of report.metrics) {
    lines.push(`| ${escapeTable(metric.title)} | ${metric.sampleCount} | ${formatValue(metric.p50, metric.unit)} | ${formatValue(metric.p95, metric.unit)} | ${formatValue(metric.max, metric.unit)} | ${formatValue(metric.mean, metric.unit)} |`);
  }
  lines.push(
    "",
    "## Budget Evaluation",
    "",
    "| Metric | Gate | Observed | Limit | Headroom | Result |",
    "| --- | --- | ---: | ---: | ---: | --- |"
  );
  const units = new Map(report.metrics.map((metric) => [metric.id, metric.unit]));
  for (const evaluation of report.evaluations) {
    const unit = units.get(evaluation.metricID) ?? "ms";
    lines.push(`| ${evaluation.metricID} | ${evaluation.severity}/${evaluation.statistic} | ${evaluation.observed === undefined ? "—" : formatValue(evaluation.observed, unit)} | ${formatValue(evaluation.limit, unit)} | ${evaluation.headroomPercent === undefined ? "—" : `${evaluation.headroomPercent.toFixed(1)}%`} | ${evaluation.status} |`);
  }
  if (report.baselineComparisons.length > 0) {
    lines.push(
      "",
      "## Baseline Comparison",
      "",
      "| Metric | Statistic | Baseline | Current | Delta | Result |",
      "| --- | --- | ---: | ---: | ---: | --- |"
    );
    for (const comparison of report.baselineComparisons) {
      const unit = units.get(comparison.metricID) ?? "ms";
      lines.push(`| ${comparison.metricID} | ${comparison.statistic} | ${comparison.baseline === undefined ? "—" : formatValue(comparison.baseline, unit)} | ${comparison.observed === undefined ? "—" : formatValue(comparison.observed, unit)} | ${comparison.deltaPercent === undefined ? "—" : `${comparison.deltaPercent.toFixed(1)}%`} | ${comparison.status} |`);
    }
  }
  lines.push(
    "",
    "Hard budgets are deliberately broad cross-machine safety ceilings. Advisory budgets expose optimization targets without making heterogeneous CI hosts flaky. Baseline regression checks require both a percentage increase and an absolute noise-floor increase.",
    ""
  );
  return lines.join("\n");
}

function percentile(sorted: number[], quantile: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatValue(value: number, unit: PerformanceMetricUnit): string {
  return `${value.toFixed(value >= 100 ? 0 : 2)} ${unit}`;
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
