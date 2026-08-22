import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateArtifact,
  inspectSourceTree,
  loadPolicy,
  validatePolicy,
} from "./lib/macos_distribution_policy.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const policy = loadPolicy(path.join(repoRoot, "distribution/macos-signing-policy.json"));

function evidence(overrides = {}) {
  const base = {
    bundleIdentifier: "com.windorion.forge",
    executable: "ForgeApp",
    packageType: "APPL",
    minimumSystemVersion: "14.0",
    signature: {
      class: "unsigned",
      authority: null,
      teamIdentifier: null,
      hardenedRuntime: false,
      entitlements: {},
    },
    nestedCode: [],
    runtime: {
      serverJavaScriptPresent: true,
      nodeExecutablePresent: false,
      unexpectedGeneratedFixtures: [],
    },
    updater: {
      feedPresent: true,
      edSignaturePresent: false,
    },
    notarization: {
      stapled: false,
      gatekeeperAccepted: false,
    },
  };
  return {
    ...base,
    ...overrides,
    signature: { ...base.signature, ...(overrides.signature ?? {}) },
    runtime: { ...base.runtime, ...(overrides.runtime ?? {}) },
    updater: { ...base.updater, ...(overrides.updater ?? {}) },
    notarization: { ...base.notarization, ...(overrides.notarization ?? {}) },
  };
}

test("versioned policy is internally fail-closed", () => {
  assert.deepEqual(validatePolicy(policy), []);
  const weakened = structuredClone(policy);
  weakened.profiles["developer-id-release"].hardenedRuntime = false;
  weakened.profiles["development-ad-hoc"].distributionReady = true;
  const codes = validatePolicy(weakened).map((item) => item.code);
  assert.ok(codes.includes("policy.release"));
  assert.ok(codes.includes("policy.development"));
});

test("source inventory matches checked-in implementation without claiming release readiness", () => {
  const report = inspectSourceTree(repoRoot, policy);
  assert.equal(report.passed, true, JSON.stringify(report.findings, null, 2));
  assert.equal(report.observed.buildOnlyMode, true);
  assert.equal(report.observed.externalNodeRequired, true);
  assert.equal(report.observed.placeholderFeedSigned, false);
  assert.equal(report.observed.widgetExtensionPresent, false);
  assert.equal(report.observed.releaseFoundationPresent, true);
  assert.ok(report.warnings.some((item) => item.code === "release.external-node"));
});

test("unsigned and ad-hoc development profiles never satisfy each other or release", () => {
  assert.equal(evaluateArtifact(policy, "development-unsigned", evidence()).passed, true);
  assert.equal(evaluateArtifact(policy, "development-ad-hoc", evidence()).passed, false);
  assert.equal(evaluateArtifact(policy, "developer-id-release", evidence()).passed, false);

  const adHoc = evidence({ signature: { class: "ad-hoc" } });
  assert.equal(evaluateArtifact(policy, "development-ad-hoc", adHoc).passed, true);
  assert.equal(evaluateArtifact(policy, "development-unsigned", adHoc).passed, false);
  assert.equal(evaluateArtifact(policy, "developer-id-release", adHoc).passed, false);
});

test("Developer ID release requires every independent trust proof", () => {
  const releasePolicy = structuredClone(policy);
  releasePolicy.components.runtime.bundledNodeExecutable = "Contents/Resources/runtime/bin/node";
  releasePolicy.components.runtime.bundledExecutableEntitlements = [];
  releasePolicy.components.runtime.bundledExecutableHardenedRuntime = true;
  const release = evidence({
    signature: {
      class: "developer-id",
      authority: "Developer ID Application: Windorion GmbH (TEAM123456)",
      teamIdentifier: "TEAM123456",
      hardenedRuntime: true,
    },
    runtime: { nodeExecutablePresent: true },
    updater: { edSignaturePresent: true },
    notarization: { stapled: true, gatekeeperAccepted: true },
    nestedCode: [{
      path: "Contents/Resources/runtime/bin/node",
      class: "developer-id",
      teamIdentifier: "TEAM123456",
      hardenedRuntime: true,
      entitlements: {},
    }],
  });
  assert.equal(evaluateArtifact(releasePolicy, "developer-id-release", release).passed, true);

  for (const mutation of [
    { runtime: { nodeExecutablePresent: false } },
    { updater: { edSignaturePresent: false } },
    { notarization: { stapled: false } },
    { notarization: { gatekeeperAccepted: false } },
    { signature: { hardenedRuntime: false } },
  ]) {
    const candidate = evidence({
      ...release,
      ...mutation,
      signature: { ...release.signature, ...(mutation.signature ?? {}) },
      runtime: { ...release.runtime, ...(mutation.runtime ?? {}) },
      updater: { ...release.updater, ...(mutation.updater ?? {}) },
      notarization: { ...release.notarization, ...(mutation.notarization ?? {}) },
    });
    assert.equal(evaluateArtifact(releasePolicy, "developer-id-release", candidate).passed, false);
  }
});

test("release cannot pass while bundled Runtime signing requirements are unresolved", () => {
  const report = evaluateArtifact(policy, "developer-id-release", evidence({
    signature: {
      class: "developer-id",
      authority: "Developer ID Application: Windorion GmbH (TEAM123456)",
      teamIdentifier: "TEAM123456",
      hardenedRuntime: true,
    },
    runtime: { nodeExecutablePresent: true },
    updater: { edSignaturePresent: true },
    notarization: { stapled: true, gatekeeperAccepted: true },
  }));
  assert.equal(report.passed, false);
  assert.ok(report.findings.some((item) => item.code === "release.runtime-policy"));
});

test("unexpected or security-relaxing entitlements fail every profile", () => {
  const candidate = evidence({
    signature: {
      entitlements: {
        "com.apple.security.get-task-allow": true,
        "com.apple.security.cs.disable-library-validation": true,
      },
    },
  });
  const report = evaluateArtifact(policy, "development-unsigned", candidate);
  assert.equal(report.passed, false);
  assert.ok(report.findings.some((item) => item.code === "artifact.forbidden-entitlements"));
  assert.ok(report.findings.some((item) => item.code === "artifact.unexpected-entitlements"));
});

test("generated smoke fixtures can never ship in an application profile", () => {
  const candidate = evidence({
    runtime: { unexpectedGeneratedFixtures: ["Contents/Resources/runtime/dist/forge-core-smoke-1-broken.js"] },
  });
  const report = evaluateArtifact(policy, "development-unsigned", candidate);
  assert.equal(report.passed, false);
  assert.ok(report.findings.some((item) => item.code === "artifact.runtime-fixtures"));
});

test("nested release code must use the main app team", () => {
  const releasePolicy = structuredClone(policy);
  releasePolicy.components.runtime.bundledNodeExecutable = "Contents/Resources/runtime/bin/node";
  releasePolicy.components.runtime.bundledExecutableEntitlements = [];
  releasePolicy.components.runtime.bundledExecutableHardenedRuntime = true;
  const candidate = evidence({
    signature: {
      class: "developer-id",
      authority: "Developer ID Application: Windorion GmbH (TEAM123456)",
      teamIdentifier: "TEAM123456",
      hardenedRuntime: true,
    },
    runtime: { nodeExecutablePresent: true },
    updater: { edSignaturePresent: true },
    notarization: { stapled: true, gatekeeperAccepted: true },
    nestedCode: [
      {
        path: "Contents/Resources/runtime/bin/node",
        class: "developer-id",
        teamIdentifier: "TEAM123456",
        hardenedRuntime: true,
        entitlements: {},
      },
      { path: "Contents/Helpers/helper", class: "developer-id", teamIdentifier: "OTHERTEAM" },
    ],
  });
  const report = evaluateArtifact(releasePolicy, "developer-id-release", candidate);
  assert.equal(report.passed, false);
  assert.ok(report.findings.some((item) => item.code === "release.nested-code"));
});
