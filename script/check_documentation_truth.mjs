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
  performanceGuide,
  performanceWorkflow,
  performanceBudgetSource,
  runtimeSecurityWorkflow,
  approvalLifecycleSource,
  secretRedactionSource,
  auditExportSource,
  validationGuide,
  securityGuide,
  taskTypes,
  swiftModels,
  swiftWorkspaceModel,
  swiftSecretRedaction,
  xcodeProject,
  pullRequestRefreshPolicy,
  swiftTestSources,
  swiftUITestSources,
  runtimePackageSource,
  routeManifest,
  repositoryBaselineSource,
  providerBaselineSource,
  workspaceRetentionSource,
  distributionGuide,
  distributionWorkflow,
  signingPolicySource,
  signingCheckerSource,
  bundleBuildScript,
  signingStageScript,
  releaseManifestSource,
  releaseBuildScript,
  releaseCheckerSource,
  releaseFoundationSource,
  updaterSource,
  appcastSource
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
  read("docs/performance_budgets.md"),
  read(".github/workflows/runtime-performance.yml"),
  read("runtime/performance-budgets.json"),
  read(".github/workflows/runtime-security.yml"),
  read("runtime/src/validation/approvalLifecycle.ts"),
  read("runtime/src/security/secretRedaction.ts"),
  read("runtime/src/tasks/taskAuditExport.ts"),
  read("docs/validation_presets.md"),
  read("docs/security_permissions.md"),
  read("runtime/src/types.ts"),
  read("apps/macos/Sources/ForgeApp/Models.swift"),
  read("apps/macos/Sources/ForgeApp/WorkspaceModel.swift"),
  read("apps/macos/Sources/ForgeApp/SecretRedaction.swift"),
  read("ForgeApp.xcodeproj/project.pbxproj"),
  read("apps/macos/Sources/ForgeApp/PullRequestRefreshPolicy.swift"),
  readSwiftTestSources(),
  readSwiftUITestSources(),
  read("runtime/package.json"),
  read("runtime/src/http/routeManifest.ts"),
  read("docs/reliability/alpha-repository-baseline.json"),
  read("docs/reliability/alpha-provider-baseline.json"),
  read("runtime/src/tasks/workspaceHistoryRetention.ts"),
  read("docs/macos_distribution_security.md"),
  read(".github/workflows/macos-distribution.yml"),
  read("distribution/macos-signing-policy.json"),
  read("script/check_macos_distribution.mjs"),
  read("script/build_and_run.sh"),
  read("script/stage_macos_distribution.sh"),
  read("distribution/macos-release-manifest.json"),
  read("script/build_macos_release.mjs"),
  read("script/check_macos_release.mjs"),
  read("script/lib/macos_release_foundation.mjs"),
  read("apps/macos/Sources/ForgeApp/ForgeUpdater.swift"),
  read("apps/macos/Resources/appcast.xml")
]);

const runtimePackage = JSON.parse(runtimePackageSource);
const performanceBudget = JSON.parse(performanceBudgetSource);
const repositoryBaseline = JSON.parse(repositoryBaselineSource);
const providerBaseline = JSON.parse(providerBaselineSource);
const signingPolicy = JSON.parse(signingPolicySource);
const releaseManifest = JSON.parse(releaseManifestSource);
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
  assert.equal(routeCount, 65);
});

check("validation approval lifecycle is bounded, documented, and enforced in CI", () => {
  assert.equal(runtimePackage.scripts["smoke:approval-lifecycle"], "npm run build && node scripts/approval-lifecycle-fixtures.mjs");
  assert.match(routeManifest, /revoke-validation-preset-approval/);
  assert.match(approvalLifecycleSource, /validationApprovalDefaultDurationSeconds = 60 \* 60/);
  assert.match(approvalLifecycleSource, /validationApprovalMaxDurationSeconds = 24 \* 60 \* 60/);
  assert.match(approvalLifecycleSource, /candidate\.revokedApprovalID === approval\.id/);
  assert.match(taskTypes, /"Expired" \| "Revoked"/);
  assert.match(swiftModels, /revokedApprovalID/);
  assert.match(swiftWorkspaceModel, /revokeValidationPresetApproval/);
  assert.match(validationGuide, /Legacy approval records without/);
  assert.match(runtimeSecurityWorkflow, /npm run smoke:approval-lifecycle/);
  assert.match(runtimeSecurityWorkflow, /npm run test:unit/);
});

check("secret redaction policy is versioned, cross-layer, and enforced in CI", () => {
  assert.equal(
    runtimePackage.scripts["smoke:secret-redaction"],
    "npm run build && node scripts/secret-redaction-fixtures.mjs"
  );
  assert.match(secretRedactionSource, /id: "forge-secret-redaction"/);
  assert.match(secretRedactionSource, /version: 1/);
  assert.match(secretRedactionSource, /encoded_secret/);
  assert.match(secretRedactionSource, /redactTaskPersistenceSurfaces/);
  assert.match(auditExportSource, /redactionPolicy/);
  assert.match(swiftSecretRedaction, /policyID = "forge-secret-redaction"/);
  assert.match(swiftWorkspaceModel, /Secret redaction policy:/);
  assert.match(xcodeProject, /SecretRedaction\.swift in Sources/);
  assert.match(securityGuide, /classification evidence contains only kind and count/);
  assert.match(runtimeSecurityWorkflow, /npm run smoke:secret-redaction/);
});

check("workspace retention is versioned, export-gated, terminal-safe, and enforced in CI", () => {
  assert.equal(
    runtimePackage.scripts["smoke:workspace-retention"],
    "npm run build && node scripts/workspace-history-retention-fixtures.mjs"
  );
  assert.match(workspaceRetentionSource, /id: "forge-workspace-retention"/);
  assert.match(workspaceRetentionSource, /version: 1/);
  assert.match(workspaceRetentionSource, /automaticPurge: false/);
  assert.match(workspaceRetentionSource, /terminalTaskDataOnly: true/);
  assert.match(workspaceRetentionSource, /ManifestWithRebuildableTrigramDigest/);
  assert.match(workspaceRetentionSource, /confirmation !== "PurgeWorkspaceHistory"/);
  assert.match(swiftWorkspaceModel, /exportWorkspaceHistory/);
  assert.match(swiftWorkspaceModel, /purgeExportedWorkspaceHistory/);
  assert.match(securityGuide, /forge-workspace-retention/);
  assert.match(runtimeSecurityWorkflow, /npm run smoke:workspace-retention/);
});

check("macOS signing policy is versioned, fail-closed, documented, and enforced in CI", () => {
  assert.equal(signingPolicy.schemaVersion, 1);
  assert.equal(signingPolicy.policyID, "forge-macos-signing");
  assert.deepEqual(Object.keys(signingPolicy.profiles), [
    "development-unsigned",
    "development-ad-hoc",
    "developer-id-release"
  ]);
  assert.deepEqual(signingPolicy.bundle.expectedEntitlements, []);
  assert.equal(signingPolicy.components.runtime.bundledNodeExecutable, null);
  assert.deepEqual(signingPolicy.components.keychain.accessGroups, []);
  assert.equal(signingPolicy.components.widget.packagedExtension, false);
  assert.equal(signingPolicy.components.updater.downloadInstallEnabled, false);
  assert.equal(signingPolicy.profiles["developer-id-release"].hardenedRuntime, true);
  assert.equal(signingPolicy.profiles["developer-id-release"].notarization, "required");
  assert.match(distributionGuide, /signed-build threat review is implemented/i);
  assert.match(distributionGuide, /development-unsigned/);
  assert.match(distributionGuide, /developer-id-release/);
  assert.match(signingCheckerSource, /inspectAppBundle/);
  assert.match(bundleBuildScript, /--build-only/);
  assert.match(bundleBuildScript, /codesign --remove-signature/);
  assert.match(bundleBuildScript, /rm -rf "\$ROOT_DIR\/runtime\/dist"/);
  assert.match(signingStageScript, /ditto --norsrc --noextattr/);
  assert.match(signingStageScript, /refusing to overwrite/);
  assert.match(updaterSource, /installEnabled: false/);
  assert.match(updaterSource, /guard available\.installEnabled/);
  assert.doesNotMatch(updaterSource, /signed\s*&\s*notarized/i);
  assert.doesNotMatch(appcastSource, /sparkle:edSignature\s*=/);
  assert.match(distributionWorkflow, /macos_distribution_policy_test\.mjs/);
  assert.match(distributionWorkflow, /npm ci --prefix runtime/);
  assert.match(distributionWorkflow, /--profile development-unsigned/);
  assert.match(distributionWorkflow, /--profile development-ad-hoc/);
  assert.match(distributionWorkflow, /--profile developer-id-release/);
  assert.match(distributionWorkflow, /upload-artifact/);
});

check("release-shaped macOS signing input is pinned, reproducible, documented, and enforced in CI", () => {
  assert.equal(releaseManifest.schemaVersion, 1);
  assert.equal(releaseManifest.manifestID, "forge-macos-release");
  assert.equal(releaseManifest.build.swiftConfiguration, "release");
  assert.equal(releaseManifest.build.signingState, "unsigned");
  assert.deepEqual(releaseManifest.build.supportedArchitectures, ["arm64", "x86_64"]);
  assert.equal(releaseManifest.runtime.name, "Node.js");
  assert.equal(releaseManifest.runtime.version, "22.18.0");
  assert.equal(releaseManifest.runtime.license, "MIT");
  assert.equal(releaseManifest.runtime.packagingState, "manifest-only");
  assert.equal(releaseManifest.runtime.downloadPolicy, "explicit-local-archive-only");
  assert.deepEqual(
    releaseManifest.runtime.artifacts.map((artifact) => artifact.architecture),
    ["arm64", "x86_64"]
  );
  for (const artifact of releaseManifest.runtime.artifacts) {
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.match(artifact.sourceURL, /nodejs\.org\/download\/release\/v22\.18\.0/);
    assert.doesNotMatch(artifact.sourceURL, /latest/i);
  }
  assert.equal(releaseManifest.sbom.spdxVersion, "SPDX-2.3");
  assert.match(releaseBuildScript, /"build", "-c", manifest\.build\.swiftConfiguration/);
  assert.match(releaseBuildScript, /removeCompilerSignature\(appExecutablePath\)/);
  assert.match(releaseBuildScript, /removeCompilerSignature\(cliPath\)/);
  assert.match(releaseBuildScript, /writeReleaseMetadata/);
  assert.match(releaseBuildScript, /createDeterministicArchive/);
  assert.doesNotMatch(releaseBuildScript, /\/usr\/bin\/open|pkill -x/);
  assert.match(releaseCheckerSource, /inspectReleaseRoot/);
  assert.match(releaseFoundationSource, /--no-xattrs/);
  assert.match(releaseFoundationSource, /"-n", "-9"/);
  assert.match(distributionWorkflow, /macos_release_foundation_test\.mjs/);
  assert.match(distributionWorkflow, /build_macos_release\.mjs/);
  assert.match(distributionWorkflow, /archive_macos_release\.mjs/);
  assert.match(distributionWorkflow, /cmp/);
  for (const source of [readme, projectStatus, todo, roadmap, development, distributionGuide]) {
    assert.match(source, /Node\.js `?22\.18\.0`?/);
    assert.match(source, /SPDX 2\.3/);
    assert.match(source, /deterministic|byte-identical|byte-deterministic|reproduce byte-for-byte/i);
  }
  assert.doesNotMatch(todo, /Next code-only distribution task — release-shaped bundle foundation/);
  assert.match(todo, /Next code-only distribution task — pinned Runtime ingestion boundary/);
});

const unitTestCount = (await readdir(resolve(repoRoot, "runtime", "scripts")))
  .filter((name) => name.endsWith("-test.mjs")).length;
const swiftTestCount = [...swiftTestSources.matchAll(/^\s*func test[A-Z]\w*\s*\(/gm)].length;
const swiftUITestCount = [...swiftUITestSources.matchAll(/^\s*func test[A-Z]\w*\s*\(/gm)].length;

check("documented Swift test count matches the native test sources", () => {
  assert.match(development, new RegExp(`\\b${swiftTestCount} current tests\\b`));
  assert.match(projectStatus, new RegExp(`all ${swiftTestCount} Swift tests`));
});

check("current runtime and XCUITest counts are documented", () => {
  assert.match(projectStatus, new RegExp(`\\b${unitTestCount} runtime unit files\\b`));
  assert.match(projectStatus, new RegExp(`\\b${swiftUITestCount} compiled XCUITest methods\\b`));
  assert.match(development, new RegExp(`\\b${swiftUITestCount} test methods\\b`));
});

check("known completed capabilities are not listed as future README work", () => {
  const beyondV0 = range(readme, "Beyond V0:", "## Completion Estimate");
  assert.doesNotMatch(beyondV0, /Actual PR creation\/publication/);
  assert.doesNotMatch(beyondV0, /Durable repository index/);
  assert.doesNotMatch(beyondV0, /Pull-request review\/check visibility/);
  assert.doesNotMatch(beyondV0, /Automatic fork-head detection/);
  const nextTodo = range(readme, "## Next TODO", "## Core Principles");
  assert.doesNotMatch(nextTodo, /return to PR\/GitHub publication/i);
});

check("fork detection and bounded PR refresh are synchronized as completed", () => {
  for (const source of [readme, projectStatus, todo, gitWorkflow]) {
    assert.match(source, /fork/i);
    assert.match(source, /background|scheduler|schedule/i);
    assert.match(source, /refresh/i);
  }
  for (const source of [taskTypes, swiftModels]) {
    assert.match(source, /forkDetected/);
    assert.match(source, /refreshAttempts/);
  }
  assert.match(swiftWorkspaceModel, /source: "Background"/);
  assert.match(swiftWorkspaceModel, /githubTokenLoader/);
  assert.match(pullRequestRefreshPolicy, /allowedIntervalMinutes = \[15, 30, 60\]/);
  assert.match(pullRequestRefreshPolicy, /allowedCycleLimits = \[1, 3, 5\]/);
  assert.doesNotMatch(roadmap, /Add automatic fork-owner discovery/);
  assert.doesNotMatch(projectStatus, /automatic fork-head discovery and optional background PR refresh/);
  assert.doesNotMatch(todo, /today `headOwner` must be supplied/);
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

check("runtime performance budgets are versioned, documented, and enforced in CI", () => {
  assert.equal(performanceBudget.schemaVersion, 1);
  assert.deepEqual(Object.keys(performanceBudget.profiles), ["smoke", "standard", "large"]);
  for (const profile of Object.values(performanceBudget.profiles)) {
    assert(profile.fileCount > 0);
    assert(profile.taskCount > 0);
    assert(profile.budgets.some((budget) => budget.metricID === "runtime.cold_start"));
    assert(profile.budgets.some((budget) => budget.metricID === "repository.index_cold"));
    assert(profile.budgets.some((budget) => budget.metricID === "agent.step"));
  }
  assert.match(performanceGuide, /runtime\.cold_start/);
  assert.match(performanceGuide, /noise floor/i);
  assert.equal(runtimePackage.scripts["performance:smoke"], "npm run build && node scripts/performance-campaign.mjs --profile smoke --enforce");
  assert.match(performanceWorkflow, /npm run performance:smoke/);
  assert.match(performanceWorkflow, /upload-artifact/);
  assert.match(projectStatus, /Versioned runtime performance/);
  assert.match(roadmap, /Versioned smoke\/standard\/large runtime profiles/);
});

check("Mission Control XCUITest has a compile-only hosted gate", () => {
  assert.match(ciWorkflow, /Mission Control XCUITest build/);
  assert.match(ciWorkflow, /-project ForgeApp\.xcodeproj/);
  assert.match(ciWorkflow, /-scheme ForgeAppUI/);
  assert.match(ciWorkflow, /build-for-testing/);
  assert.match(ciWorkflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(development, /hosted toolchain|compiler\/toolchain drift/i);
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
console.log(`- Runtime: ${routeCount} routes, ${smokeCount} smoke scripts, ${unitTestCount} unit-test files, ${swiftTestCount} Swift tests`);

async function readSwiftTestSources() {
  const directory = "Tests/ForgeAppTests";
  const names = (await readdir(resolve(repoRoot, directory)))
    .filter((name) => name.endsWith("Tests.swift"));
  return (await Promise.all(names.map((name) => read(`${directory}/${name}`)))).join("\n");
}

async function readSwiftUITestSources() {
  const directory = "Tests/ForgeAppUITests";
  const names = (await readdir(resolve(repoRoot, directory)))
    .filter((name) => name.endsWith("Tests.swift"));
  return (await Promise.all(names.map((name) => read(`${directory}/${name}`)))).join("\n");
}

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
