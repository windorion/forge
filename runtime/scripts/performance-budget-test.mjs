#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPerformanceReport,
  comparePerformanceBaseline,
  evaluatePerformanceBudgets,
  renderPerformanceReportMarkdown,
  summarizePerformanceMetric
} from "../dist/performanceBudget.js";

const metric = (id, samples, unit = "ms") => ({
  id,
  title: id,
  unit,
  samples
});

test("summarizes samples with deterministic nearest-rank percentiles", () => {
  const summary = summarizePerformanceMetric(metric("runtime.start", [10, 30, 20, 50, 40]));
  assert.deepEqual(
    { min: summary.min, p50: summary.p50, p95: summary.p95, max: summary.max, mean: summary.mean },
    { min: 10, p50: 30, p95: 50, max: 50, mean: 30 }
  );
});

test("rejects empty, negative, and non-finite samples", () => {
  assert.throws(() => summarizePerformanceMetric(metric("empty", [])), /has no samples/);
  assert.throws(() => summarizePerformanceMetric(metric("negative", [-1])), /invalid sample/);
  assert.throws(() => summarizePerformanceMetric(metric("infinite", [Infinity])), /invalid sample/);
});

test("evaluates hard and advisory budgets without hiding missing metrics", () => {
  const summaries = [summarizePerformanceMetric(metric("runtime.start", [90, 110]))];
  const evaluations = evaluatePerformanceBudgets(summaries, [
    { metricID: "runtime.start", statistic: "p95", max: 100, severity: "hard", rationale: "startup ceiling" },
    { metricID: "runtime.memory", statistic: "max", max: 256, severity: "advisory", rationale: "memory target" }
  ]);
  assert.equal(evaluations[0].status, "Failed");
  assert.equal(evaluations[0].headroomPercent, -10);
  assert.equal(evaluations[1].status, "Missing");
});

test("baseline comparison requires both percentage and absolute regression", () => {
  const baseline = [summarizePerformanceMetric(metric("git.status", [100]))];
  const smallNoise = [summarizePerformanceMetric(metric("git.status", [106]))];
  const realRegression = [summarizePerformanceMetric(metric("git.status", [130]))];
  const policy = { allowedRegressionPercent: 10, noiseFloor: 10 };
  assert.equal(comparePerformanceBaseline(smallNoise, baseline, policy)[0].status, "Stable");
  assert.equal(comparePerformanceBaseline(realRegression, baseline, policy)[0].status, "Regressed");
});

test("report fails hard gates and baseline regressions but not advisory misses", () => {
  const environment = {
    platform: "test",
    architecture: "test",
    nodeVersion: "test",
    cpuCount: 1,
    totalMemoryMiB: 1024,
    ci: false
  };
  const advisoryOnly = buildPerformanceReport({
    generatedAt: "2026-08-11T00:00:00.000Z",
    profile: "test",
    durationMs: 12,
    environment,
    fixture: { files: 1 },
    samples: [metric("runtime.start", [50])],
    budgets: [
      { metricID: "runtime.missing", statistic: "p95", max: 1, severity: "advisory", rationale: "target" }
    ]
  });
  assert.equal(advisoryOnly.status, "Passed");

  const failed = buildPerformanceReport({
    generatedAt: "2026-08-11T00:00:00.000Z",
    profile: "test",
    durationMs: 12,
    environment,
    fixture: { files: 1 },
    samples: [metric("runtime.start", [150])],
    budgets: [
      { metricID: "runtime.start", statistic: "p95", max: 100, severity: "hard", rationale: "ceiling" }
    ]
  });
  assert.equal(failed.status, "Failed");
  assert.match(renderPerformanceReportMarkdown(failed), /runtime\.start/);
  assert.match(renderPerformanceReportMarkdown(failed), /Hard budgets/);
});
