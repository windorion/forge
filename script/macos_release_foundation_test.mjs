import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectPayloadFiles,
  createComponentManifest,
  createDeterministicArchive,
  createSPDXDocument,
  findExcludedPaths,
  loadReleaseManifest,
  normalizeArchitecture,
  normalizeTreeTimestamps,
  runtimeArtifactForArchitecture,
  sha256File,
  validateReleaseManifest,
  verifyPinnedRuntimeArchive,
} from "./lib/macos_release_foundation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = loadReleaseManifest(path.join(repoRoot, "distribution/macos-release-manifest.json"));

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-foundation-"));
}

function fixtureBuildEvidence(overrides = {}) {
  return {
    architecture: "arm64",
    sourceRevision: "a".repeat(40),
    sourceDirty: false,
    runtimePackageVersion: "0.1.0",
    releaseManifestSHA256: "b".repeat(64),
    ...overrides,
  };
}

test("release manifest is exact, versioned, and fail-closed", () => {
  assert.deepEqual(validateReleaseManifest(manifest), []);
  const weakened = structuredClone(manifest);
  weakened.build.swiftConfiguration = "debug";
  weakened.build.signingState = "developer-id";
  weakened.runtime.artifacts[0].sourceURL = "https://nodejs.org/download/release/latest/node-latest.tar.gz";
  weakened.runtime.releaseSigningReview.entitlements = [];
  const codes = validateReleaseManifest(weakened).map((item) => item.code);
  assert.ok(codes.includes("manifest.optimization"));
  assert.ok(codes.includes("manifest.signing"));
  assert.ok(codes.includes("manifest.runtime-origin"));
  assert.ok(codes.includes("manifest.runtime-signing"));
});

test("Runtime artifacts pin both macOS architectures without a latest alias", () => {
  assert.equal(normalizeArchitecture("aarch64"), "arm64");
  assert.equal(normalizeArchitecture("x64"), "x86_64");
  assert.throws(() => normalizeArchitecture("riscv64"), /Unsupported/);
  for (const architecture of ["arm64", "x86_64"]) {
    const artifact = runtimeArtifactForArchitecture(manifest, architecture);
    assert.equal(artifact.architecture, architecture);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.ok(artifact.sourceURL.includes(`/v${manifest.runtime.version}/`));
    assert.doesNotMatch(artifact.sourceURL, /latest/i);
  }
});

test("explicit local Runtime archives require exact filename and SHA-256", () => {
  const root = temporaryDirectory();
  try {
    const fixtureManifest = structuredClone(manifest);
    const artifact = runtimeArtifactForArchitecture(fixtureManifest, "arm64");
    const archivePath = path.join(root, artifact.fileName);
    fs.writeFileSync(archivePath, "verified fixture bytes");
    artifact.sha256 = sha256File(archivePath);
    const receipt = verifyPinnedRuntimeArchive(archivePath, fixtureManifest, "arm64");
    assert.equal(receipt.verified, true);
    assert.equal(receipt.archiveSHA256, artifact.sha256);
    assert.equal(receipt.executablePathInArchive, `${artifact.archiveRoot}/bin/node`);

    fs.appendFileSync(archivePath, "tampered");
    assert.throws(() => verifyPinnedRuntimeArchive(archivePath, fixtureManifest, "arm64"), /SHA-256 mismatch/);
    const wrongName = path.join(root, "node-latest.tar.gz");
    fs.writeFileSync(wrongName, "verified fixture bytes");
    assert.throws(() => verifyPinnedRuntimeArchive(wrongName, fixtureManifest, "arm64"), /must be named/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("release exclusion policy catches debug, test, source-map, database, and smoke output", () => {
  const root = temporaryDirectory();
  try {
    for (const relativePath of [
      "Forge.app/Contents/Resources/runtime/dist/server.js",
      "Forge.app/Contents/Resources/runtime/dist/server.js.map",
      "Forge.app/Contents/Resources/runtime/dist/forge-core-smoke-broken.js",
      "Tests/Fixtures/state.json",
      "debug/Forge.dSYM/symbols",
      "private.sqlite",
    ]) {
      const filePath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, relativePath);
    }
    const excluded = findExcludedPaths(root, manifest);
    assert.ok(excluded.includes("Forge.app/Contents/Resources/runtime/dist/server.js.map"));
    assert.ok(excluded.includes("Forge.app/Contents/Resources/runtime/dist/forge-core-smoke-broken.js"));
    assert.ok(excluded.some((item) => item.startsWith("Tests")));
    assert.ok(excluded.some((item) => item.includes(".dSYM")));
    assert.ok(excluded.includes("private.sqlite"));
    assert.ok(!excluded.includes("Forge.app/Contents/Resources/runtime/dist/server.js"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("component inventory and SPDX output are byte-stable and account for payload files", () => {
  const root = temporaryDirectory();
  try {
    for (const [relativePath, value, mode] of [
      ["Forge.app/Contents/MacOS/ForgeApp", "app", 0o755],
      ["Forge.app/Contents/Resources/runtime/dist/server.js", "runtime", 0o644],
      ["Forge.app/Contents/Resources/Fonts/OFL.txt", "font license", 0o644],
      ["forge-cli", "cli", 0o755],
    ]) {
      const filePath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, value, { mode });
      fs.chmodSync(filePath, mode);
    }
    const first = createComponentManifest(root, manifest, fixtureBuildEvidence());
    const second = createComponentManifest(root, manifest, fixtureBuildEvidence());
    assert.deepEqual(first, second);
    assert.deepEqual(first.files, collectPayloadFiles(root));
    assert.equal(first.components.find((item) => item.id === "node-runtime-requirement").bundled, false);
    const sbom = createSPDXDocument(first, manifest);
    assert.equal(sbom.spdxVersion, "SPDX-2.3");
    assert.equal(sbom.files.length, first.files.length);
    assert.ok(sbom.packages.some((item) => item.name === "forge-cli"));
    assert.ok(sbom.packages.some((item) => item.name === "node-runtime-requirement" && item.licenseDeclared === "MIT"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("normalized ustar+gzip archives are deterministic and refuse overwrite", () => {
  const root = temporaryDirectory();
  const outputRoot = temporaryDirectory();
  try {
    fs.mkdirSync(path.join(root, "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "alpha.txt"), "alpha\n");
    fs.writeFileSync(path.join(root, "nested/beta.txt"), "beta\n");
    normalizeTreeTimestamps(root, manifest.release.sourceDateEpoch);
    const firstPath = path.join(outputRoot, "first.tar.gz");
    const secondPath = path.join(outputRoot, "second.tar.gz");
    const first = createDeterministicArchive(root, firstPath, manifest.release.sourceDateEpoch);
    const second = createDeterministicArchive(root, secondPath, manifest.release.sourceDateEpoch);
    assert.equal(first.sha256, second.sha256);
    assert.deepEqual(fs.readFileSync(firstPath), fs.readFileSync(secondPath));
    assert.throws(() => createDeterministicArchive(root, firstPath, manifest.release.sourceDateEpoch), /Refusing to overwrite/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("archive creation rejects a tree whose timestamps are not normalized", () => {
  const root = temporaryDirectory();
  const outputRoot = temporaryDirectory();
  try {
    fs.writeFileSync(path.join(root, "current.txt"), "current\n");
    assert.throws(
      () => createDeterministicArchive(root, path.join(outputRoot, "invalid.tar.gz"), manifest.release.sourceDateEpoch),
      /timestamp is not normalized/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
