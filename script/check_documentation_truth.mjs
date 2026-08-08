#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const read = async (path) => readFile(resolve(repoRoot, path), "utf8");
const [
  readme,
  projectStatus,
  todo,
  coverage,
  development,
  reliabilityGuide,
  documentationIndex,
  roadmap,
  gitWorkflow,
  ciWorkflow,
  taskTypes,
  swiftModels,
  runtimePackageSource,
  routeManifest,
  repositoryBaselineSource,
  providerBaselineSource
] = await Promise.all([
  read("README.md"),
  read("docs/project_status.md"),
  read("docs/todo.md"),
  read("docs/design_handoff_coverage.md"),
  read("docs/development.md"),
  read("docs/reliability/README.md"),
  read("docs/README.md"),
  read("docs/roadmap.md"),
  read("docs/git_workflow.md"),
  read(".github/workflows/swift-tests.yml"),
  read("runtime/src/types.ts"),
  read("apps/macos/Sources/ForgeApp/Models.swift"),
  read("runtime/package.json"),
  read("runtime/src/http/routeManifest.ts"),
  read("docs/reliability/alpha-repository-baseline.json"),
  read("docs/reliability/alpha-provider-baseline.json")
]);

const runtimePackage = JSON.parse(runtimePackageSource);
const repositoryBaseline = JSON.parse(repositoryBaselineSource);
const providerBaseline = JSON.parse(providerBaselineSource);
const failures = [];

check("critical project documents share the current status date", () => {
  const dates = [readme, projectStatus, todo, coverage, roadmap].map(lastUpdatedDate);
  assert.equal(new Set(dates).size, 1, `status dates differ: ${dates.join(", ")}`);
});

const estimateRows = [
  ["Trust/runtime foundation", /Trust\/runtime foundation/],
  ["Coding-agent demo V0 behavior", /Coding-agent demo V0 behavior/],
  ["Primary V0 handoff UI", /Primary V0 handoff UI/],
  ["Full handoff UI", /Full(?: 43-screen)? handoff UI/],
  ["Useful developer alpha", /Useful developer alpha/],
  ["Commercial beta", /Commercial beta/],
  ["Polished v1", /Polished v1(?: product)?/]
];

check("README and project status readiness estimates agree", () => {
  for (const [label, matcher] of estimateRows) {
    assert.equal(
      estimateFor(readme, matcher),
      estimateFor(projectStatus, matcher),
      `${label} estimate differs`
    );
  }
});

const handoffCounts = handoffStatusCounts(coverage);
check("design handoff table contains the documented 43 states", () => {
  assert.deepEqual(handoffCounts, { Verified: 41, Partial: 1, Missing: 1, Implemented: 0 });
});

check("primary V0 handoff truth is synchronized", () => {
  assert.equal(estimateFor(readme, /Primary V0 handoff UI/), "100%");
  assert.equal(estimateFor(projectStatus, /Primary V0 handoff UI/), "100%");
  assert.match(coverage, /all 5 primary targets[\s\S]{0,180}are now `Verified`/);
});

check("full handoff counts are reflected in top-level status", () => {
  for (const source of [readme, projectStatus]) {
    assert.match(source, /41 of 43/);
    assert.match(source, /`?6a`?[^\n]{0,220}Partial/);
    assert.match(source, /`?35a`?[^\n]{0,220}(?:Missing|Widget|blocked)/i);
  }
});

checkBaseline("repository", repositoryBaseline, { providerRequests: undefined });
checkBaseline("provider", providerBaseline, { providerRequests: 37 });

check("baseline scorecards are reflected in current docs", () => {
  for (const source of [readme, todo, reliabilityGuide]) {
    assert.match(source, /(?:3|three) (?:passed|applied|通过)|passes all three/i);
    assert.match(source, /1 guarded|one(?: correctly)? guarded|the guarded negative|1 安全阻断/i);
    assert.match(source, /0 (?:unexpected )?failures?|zero unexpected failures?/i);
  }
  assert.match(readme, /37 provider requests/);
  assert.match(reliabilityGuide, /37 strict-schema[\s\S]{0,40}provider requests/);
});

const smokeCount = Object.keys(runtimePackage.scripts)
  .filter((name) => name.startsWith("smoke:") && name !== "smoke:all").length;
check("documented smoke count matches package scripts", () => {
  assert.match(development, new RegExp(`full suite is\\n?${smokeCount} scripts`));
});

const routeCount = [...routeManifest.matchAll(/^\s*(?:get|post|options)\("/gm)].length;
check("route manifest count remains explicit", () => {
  assert.equal(routeCount, 57);
});

const unitTestCount = (await readdir(resolve(repoRoot, "runtime", "scripts")))
  .filter((name) => name.endsWith("-test.mjs")).length;

check("known completed capabilities are not listed as future README work", () => {
  const beyondV0 = range(readme, "Beyond V0:", "## Completion Estimate");
  assert.doesNotMatch(beyondV0, /Actual PR creation\/publication/);
  assert.doesNotMatch(beyondV0, /Durable repository index/);
  assert.doesNotMatch(beyondV0, /Pull-request review\/check visibility/);
});

check("P0 TODO does not reopen verified handoff work", () => {
  const p0 = section(todo, "P0: Close The Two Remaining Handoff Boundaries", "Coding-Agent Demo V0");
  assert.doesNotMatch(p0, /Finish exact line-by-line verification of `1a`/);
  assert.doesNotMatch(p0, /Render-verify the implemented compact task states/);
  assert.doesNotMatch(p0, /until all 43 named HTML/);
});

check("documentation truth check is discoverable and runs in CI", () => {
  assert.match(documentationIndex, /`documentation_truth\.md`/);
  assert.match(development, /`npm run check:docs`/);
  assert.match(ciWorkflow, /node script\/check_documentation_truth\.mjs/);
  assert.equal(runtimePackage.scripts["check:docs"], "node ../script/check_documentation_truth.mjs");
});

check("PR review and check evidence is synchronized across code and current docs", () => {
  for (const source of [readme, projectStatus, todo, gitWorkflow]) {
    assert.match(source, /review/i);
    assert.match(source, /check/i);
    assert.match(source, /mergeab/i);
  }
  for (const source of [taskTypes, swiftModels]) {
    assert.match(source, /reviewStatus/);
    assert.match(source, /checksStatus/);
    assert.match(source, /mergeableState/);
  }
  assert.doesNotMatch(todo, /surface PR review\/check status[\s\S]{0,80}Follow-on/i);
  assert.doesNotMatch(roadmap, /Add PR review\/check\/fork visibility/);
});

if (failures.length > 0) {
  console.error(`Documentation truth check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Documentation truth check passed.");
}

console.log(`- Handoff: ${handoffCounts.Verified} Verified, ${handoffCounts.Partial} Partial, ${handoffCounts.Missing} Missing`);
console.log(`- Reliability: ${repositoryBaseline.passedCount} local + ${providerBaseline.passedCount} provider cases passed; ${repositoryBaseline.guardedCount + providerBaseline.guardedCount} guarded`);
console.log(`- Runtime: ${routeCount} routes, ${smokeCount} smoke scripts, ${unitTestCount} unit-test files`);

function check(label, action) {
  try {
    action();
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function lastUpdatedDate(source) {
  const match = source.match(/^Last updated: (\d{4}-\d{2}-\d{2})$/m);
  assert(match, "missing Last updated date");
  return match[1];
}

function estimateFor(source, horizonMatcher) {
  for (const line of source.split("\n")) {
    if (!line.startsWith("|") || !horizonMatcher.test(line)) continue;
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    assert(cells.length >= 2, `malformed readiness row: ${line}`);
    return cells[1];
  }
  assert.fail(`missing readiness row ${horizonMatcher}`);
}

function handoffStatusCounts(source) {
  const counts = { Verified: 0, Partial: 0, Missing: 0, Implemented: 0 };
  for (const match of source.matchAll(/^\| [^|]+ \| `[^`]+`[^|]* \| (Verified|Partial|Missing|Implemented) \|/gm)) {
    counts[match[1]] += 1;
  }
  return counts;
}

function checkBaseline(label, baseline, { providerRequests }) {
  check(`${label} reliability baseline is passing`, () => {
    assert.equal(baseline.schemaVersion, 1);
    assert.equal(baseline.status, "Passed");
    assert.equal(baseline.caseCount, 4);
    assert.equal(baseline.passedCount, 3);
    assert.equal(baseline.guardedCount, 1);
    assert.equal(baseline.failedCount, 0);
    assert.equal(baseline.stagePassRate, 1);
    if (providerRequests !== undefined) assert.equal(baseline.providerRequestCount, providerRequests);
  });
}

function section(source, startHeading, endHeading) {
  const start = source.indexOf(`## ${startHeading}`);
  assert(start >= 0, `missing section ${startHeading}`);
  const end = source.indexOf(`## ${endHeading}`, start + 3);
  assert(end >= 0, `missing section ${endHeading}`);
  return source.slice(start, end);
}

function range(source, startText, endText) {
  const start = source.indexOf(startText);
  assert(start >= 0, `missing range start ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert(end >= 0, `missing range end ${endText}`);
  return source.slice(start, end);
}
