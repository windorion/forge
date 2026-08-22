import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function finding(code, message, severity = "error") {
  return { code, message, severity };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null,
  };
}

function assertSafeRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value) || value.split("/").includes("..")) {
    throw new Error(`${label} must be a safe repository-relative path.`);
  }
}

function stableJSON(value) {
  if (Array.isArray(value)) return value.map(stableJSON);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJSON(value[key])]))
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function writeJSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  fs.chmodSync(filePath, 0o644);
}

export function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export function sha256JSON(value) {
  return crypto.createHash("sha256").update(`${JSON.stringify(stableJSON(value))}\n`).digest("hex");
}

export function normalizeArchitecture(value) {
  if (value === "arm64" || value === "aarch64") return "arm64";
  if (value === "x86_64" || value === "x64" || value === "amd64") return "x86_64";
  throw new Error(`Unsupported macOS architecture: ${value}.`);
}

export function loadReleaseManifest(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function validateReleaseManifest(manifest) {
  const findings = [];
  if (manifest.schemaVersion !== 1) findings.push(finding("manifest.schema", "schemaVersion must be 1."));
  if (manifest.manifestID !== "forge-macos-release") findings.push(finding("manifest.id", "manifestID must be forge-macos-release."));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.release?.version ?? "")) findings.push(finding("manifest.version", "Release version must be an exact semantic version."));
  if (!/^\d+$/.test(manifest.release?.buildNumber ?? "")) findings.push(finding("manifest.build", "Build number must be a decimal string."));
  if (!Number.isInteger(manifest.release?.sourceDateEpoch) || manifest.release.sourceDateEpoch <= 0) {
    findings.push(finding("manifest.epoch", "sourceDateEpoch must be a positive integer."));
  }
  if (manifest.build?.swiftConfiguration !== "release") findings.push(finding("manifest.optimization", "Swift production configuration must be release."));
  if (manifest.build?.signingState !== "unsigned") findings.push(finding("manifest.signing", "Code-only signing input must remain explicitly unsigned."));
  if (manifest.build?.archiveFormat !== "ustar+gzip" || manifest.build?.archiveCompression !== "gzip-9-no-name") {
    findings.push(finding("manifest.archive", "Archive format must be deterministic ustar plus gzip without name/time headers."));
  }
  if (manifest.cli?.packaging !== "standalone" || manifest.cli?.bundlePath !== null) {
    findings.push(finding("manifest.cli", "The current CLI must remain a standalone signing boundary."));
  }

  const architectures = manifest.build?.supportedArchitectures ?? [];
  if (JSON.stringify(architectures) !== JSON.stringify(["arm64", "x86_64"])) {
    findings.push(finding("manifest.architectures", "Release inputs must pin arm64 and x86_64 in canonical order."));
  }
  const runtime = manifest.runtime ?? {};
  if (!/^\d+\.\d+\.\d+$/.test(runtime.version ?? "") || runtime.name !== "Node.js") {
    findings.push(finding("manifest.runtime-version", "Runtime must name one exact Node.js version."));
  }
  if (runtime.downloadPolicy !== "explicit-local-archive-only" || runtime.packagingState !== "manifest-only") {
    findings.push(finding("manifest.runtime-policy", "Runtime must stay manifest-only and accept only an explicit local archive in this slice."));
  }
  if (runtime.releaseSigningReview?.bundledExecutableSelected !== false ||
      runtime.releaseSigningReview?.entitlements !== null ||
      runtime.releaseSigningReview?.hardenedRuntime !== null ||
      runtime.releaseSigningReview?.sameTeamAsApplication !== true) {
    findings.push(finding("manifest.runtime-signing", "Bundled Node signing decisions must remain unresolved until the selected executable is reviewed."));
  }
  if (runtime.license !== "MIT" || runtime.licensePathInArchive !== "LICENSE" || runtime.expectedExecutablePathInArchive !== "bin/node") {
    findings.push(finding("manifest.runtime-license", "Runtime license and executable paths must be explicit."));
  }
  if (/latest/i.test(runtime.signedChecksumsURL ?? "")) {
    findings.push(finding("manifest.runtime-latest", "Runtime checksum sources must never use a latest alias."));
  }

  const artifacts = runtime.artifacts ?? [];
  if (artifacts.length !== architectures.length) findings.push(finding("manifest.runtime-artifacts", "Runtime must pin one artifact per supported architecture."));
  for (const architecture of architectures) {
    const matches = artifacts.filter((item) => item.architecture === architecture);
    if (matches.length !== 1) {
      findings.push(finding("manifest.runtime-architecture", `Runtime must contain exactly one ${architecture} artifact.`));
      continue;
    }
    const artifact = matches[0];
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) findings.push(finding("manifest.runtime-sha", `${architecture} Runtime SHA-256 is invalid.`));
    if (!artifact.fileName?.includes(`v${runtime.version}`) || !artifact.sourceURL?.endsWith(`/${artifact.fileName}`)) {
      findings.push(finding("manifest.runtime-source", `${architecture} Runtime URL, filename, and version must agree.`));
    }
    if (/latest/i.test(artifact.sourceURL ?? "") || !artifact.sourceURL?.startsWith("https://nodejs.org/download/release/")) {
      findings.push(finding("manifest.runtime-origin", `${architecture} Runtime must use a versioned official Node.js release URL.`));
    }
    if (!artifact.archiveRoot?.startsWith(`node-v${runtime.version}-darwin-`)) {
      findings.push(finding("manifest.runtime-root", `${architecture} Runtime archive root is not pinned to the selected version.`));
    }
  }

  const layoutValues = Object.values(manifest.layout ?? {});
  try {
    for (const [key, value] of Object.entries(manifest.layout ?? {})) assertSafeRelativePath(value, `layout.${key}`);
    assertSafeRelativePath(runtime.expectedBundlePath, "runtime.expectedBundlePath");
  } catch (error) {
    findings.push(finding("manifest.layout", error.message));
  }
  if (new Set(layoutValues).size !== layoutValues.length) findings.push(finding("manifest.layout-unique", "Release layout paths must be unique."));

  try {
    for (const pattern of manifest.build?.excludedPathPatterns ?? []) new RegExp(pattern);
  } catch (error) {
    findings.push(finding("manifest.exclusion", `Invalid exclusion expression: ${error.message}`));
  }
  if ((manifest.build?.excludedPathPatterns ?? []).length < 8) findings.push(finding("manifest.exclusion", "Release exclusion policy is unexpectedly incomplete."));
  if (manifest.sbom?.spdxVersion !== "SPDX-2.3" || manifest.sbom?.dataLicense !== "CC0-1.0") {
    findings.push(finding("manifest.sbom", "SBOM policy must declare SPDX 2.3 and CC0-1.0 data licensing."));
  }
  return findings;
}

export function runtimeArtifactForArchitecture(manifest, architecture) {
  const canonical = normalizeArchitecture(architecture);
  const artifact = manifest.runtime.artifacts.find((item) => item.architecture === canonical);
  if (!artifact) throw new Error(`No pinned Runtime artifact for ${canonical}.`);
  return artifact;
}

export function verifyPinnedRuntimeArchive(archivePath, manifest, architecture) {
  const findings = validateReleaseManifest(manifest);
  if (findings.length > 0) throw new Error(`Invalid release manifest: ${findings.map((item) => item.message).join(" ")}`);
  const artifact = runtimeArtifactForArchitecture(manifest, architecture);
  if (path.basename(archivePath) !== artifact.fileName) {
    throw new Error(`Runtime archive must be named ${artifact.fileName}; found ${path.basename(archivePath)}.`);
  }
  const actualSHA256 = sha256File(archivePath);
  if (actualSHA256 !== artifact.sha256) {
    throw new Error(`Runtime archive SHA-256 mismatch for ${artifact.fileName}: expected ${artifact.sha256}, found ${actualSHA256}.`);
  }
  return {
    schemaVersion: 1,
    runtime: manifest.runtime.name,
    version: manifest.runtime.version,
    architecture: artifact.architecture,
    sourceURL: artifact.sourceURL,
    archiveFileName: artifact.fileName,
    archiveSHA256: actualSHA256,
    license: manifest.runtime.license,
    licensePathInArchive: `${artifact.archiveRoot}/${manifest.runtime.licensePathInArchive}`,
    executablePathInArchive: `${artifact.archiveRoot}/${manifest.runtime.expectedExecutablePathInArchive}`,
    verified: true,
  };
}

export function walkReleaseTree(root) {
  const entries = [];
  function visit(relativeDirectory) {
    const absoluteDirectory = path.join(root, relativeDirectory);
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name))) {
      const relativePath = path.posix.join(relativeDirectory.split(path.sep).join("/"), entry.name).replace(/^\.\//, "");
      const absolutePath = path.join(root, ...relativePath.split("/"));
      const stat = fs.lstatSync(absolutePath);
      entries.push({ relativePath, absolutePath, stat, kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other" });
      if (entry.isDirectory()) visit(relativePath);
    }
  }
  visit("");
  return entries;
}

export function findExcludedPaths(root, manifest) {
  const patterns = manifest.build.excludedPathPatterns.map((pattern) => new RegExp(pattern));
  return walkReleaseTree(root)
    .filter((entry) => patterns.some((pattern) => pattern.test(entry.relativePath)))
    .map((entry) => entry.relativePath);
}

export function collectPayloadFiles(root) {
  return walkReleaseTree(root)
    .filter((entry) => entry.kind === "file" && !entry.relativePath.startsWith("manifests/"))
    .map((entry) => ({
      path: entry.relativePath,
      sha256: sha256File(entry.absolutePath),
      bytes: entry.stat.size,
      mode: (entry.stat.mode & 0o777).toString(8).padStart(4, "0"),
    }));
}

function spdxID(prefix, value) {
  const normalized = value.replace(/[^A-Za-z0-9.-]+/g, "-");
  const suffix = crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `SPDXRef-${prefix}-${normalized}-${suffix}`;
}

export function createComponentManifest(root, manifest, buildEvidence) {
  const files = collectPayloadFiles(root);
  const appPrefix = `${manifest.layout.application}/`;
  const runtimePrefix = `${manifest.layout.application}/Contents/Resources/runtime/`;
  const fontPrefix = `${manifest.layout.application}/Contents/Resources/Fonts/`;
  const filePaths = files.map((file) => file.path);
  return {
    schemaVersion: 1,
    manifestID: "forge-release-components",
    releaseManifestID: manifest.manifestID,
    releaseManifestSHA256: buildEvidence.releaseManifestSHA256,
    release: manifest.release,
    architecture: buildEvidence.architecture,
    sourceRevision: buildEvidence.sourceRevision,
    sourceDirty: buildEvidence.sourceDirty,
    build: {
      swiftConfiguration: manifest.build.swiftConfiguration,
      signingState: manifest.build.signingState,
      sourceDateEpoch: manifest.release.sourceDateEpoch,
    },
    components: [
      {
        id: "forge-app",
        kind: "macos-application",
        version: manifest.release.version,
        path: manifest.layout.application,
        signingBoundary: "outer-application",
        optimized: true,
        fileCount: filePaths.filter((value) => value.startsWith(appPrefix)).length,
      },
      {
        id: "forge-cli",
        kind: "standalone-executable",
        version: manifest.release.version,
        path: manifest.layout.cli,
        signingBoundary: "standalone",
        optimized: true,
        fileCount: filePaths.filter((value) => value === manifest.layout.cli).length,
      },
      {
        id: "forge-runtime-js",
        kind: "javascript-resource",
        version: buildEvidence.runtimePackageVersion,
        path: runtimePrefix.slice(0, -1),
        signingBoundary: "sealed-by-application",
        executableLauncher: "/usr/bin/env node",
        fileCount: filePaths.filter((value) => value.startsWith(runtimePrefix)).length,
      },
      {
        id: "node-runtime-requirement",
        kind: "external-runtime-requirement",
        version: manifest.runtime.version,
        path: manifest.runtime.expectedBundlePath,
        signingBoundary: "unresolved-nested-code",
        bundled: false,
        supplyChainPinned: true,
        fileCount: 0,
      },
      {
        id: "jetbrains-mono",
        kind: "font-resource",
        version: "NOASSERTION",
        path: fontPrefix.slice(0, -1),
        signingBoundary: "sealed-by-application",
        license: manifest.sbom.fontPackage.license,
        fileCount: filePaths.filter((value) => value.startsWith(fontPrefix)).length,
      },
    ],
    files,
  };
}

export function createSPDXDocument(componentManifest, manifest) {
  const created = new Date(manifest.release.sourceDateEpoch * 1000).toISOString().replace(".000Z", "Z");
  const payloadFingerprint = sha256JSON({
    files: componentManifest.files,
    sourceDirty: componentManifest.sourceDirty,
  });
  const namespace = `${manifest.sbom.documentNamespaceBase}/${manifest.release.version}/${componentManifest.architecture}/${componentManifest.sourceRevision}-${payloadFingerprint.slice(0, 16)}`;
  const packages = componentManifest.components.map((component) => ({
    name: component.id,
    SPDXID: spdxID("Package", component.id),
    versionInfo: component.version,
    downloadLocation: component.id === "node-runtime-requirement"
      ? runtimeArtifactForArchitecture(manifest, componentManifest.architecture).sourceURL
      : "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: component.license ?? (component.id === "node-runtime-requirement" ? manifest.runtime.license : manifest.sbom.projectLicense),
    licenseDeclared: component.license ?? (component.id === "node-runtime-requirement" ? manifest.runtime.license : manifest.sbom.projectLicense),
    copyrightText: "NOASSERTION",
    externalRefs: component.id === "node-runtime-requirement" ? [{
      referenceCategory: "SECURITY",
      referenceType: "cpe23Type",
      referenceLocator: `cpe:2.3:a:nodejs:node.js:${manifest.runtime.version}:*:*:*:*:*:*:*`,
    }] : undefined,
  }));
  const files = componentManifest.files.map((file) => ({
    fileName: `./${file.path}`,
    SPDXID: spdxID("File", file.path),
    checksums: [{ algorithm: "SHA256", checksumValue: file.sha256 }],
    licenseConcluded: "NOASSERTION",
    copyrightText: "NOASSERTION",
  }));
  return {
    spdxVersion: manifest.sbom.spdxVersion,
    dataLicense: manifest.sbom.dataLicense,
    SPDXID: "SPDXRef-DOCUMENT",
    name: `Forge-${manifest.release.version}-${componentManifest.architecture}`,
    documentNamespace: namespace,
    creationInfo: {
      created,
      creators: ["Tool: Forge macOS release foundation v1"],
      licenseListVersion: "3.25",
    },
    documentDescribes: packages.map((item) => item.SPDXID),
    packages,
    files,
  };
}

function runtimeSupplyChainDocument(manifest, releaseManifestSHA256) {
  return {
    schemaVersion: 1,
    manifestID: "forge-runtime-supply-chain",
    releaseManifestID: manifest.manifestID,
    releaseManifestSHA256,
    runtime: manifest.runtime,
  };
}

function checksumLines(root, checksumRelativePath) {
  return walkReleaseTree(root)
    .filter((entry) => entry.kind === "file" && entry.relativePath !== checksumRelativePath)
    .map((entry) => `${sha256File(entry.absolutePath)}  ${entry.relativePath}`)
    .join("\n") + "\n";
}

export function writeReleaseMetadata(root, manifest, buildEvidence) {
  const releaseManifestSHA256 = buildEvidence.releaseManifestSHA256;
  writeJSON(path.join(root, manifest.layout.runtimeSupplyChain), runtimeSupplyChainDocument(manifest, releaseManifestSHA256));
  const componentManifest = createComponentManifest(root, manifest, { ...buildEvidence, releaseManifestSHA256 });
  writeJSON(path.join(root, manifest.layout.componentManifest), componentManifest);
  const sbom = createSPDXDocument(componentManifest, manifest);
  writeJSON(path.join(root, manifest.layout.sbom), sbom);
  const checksumPath = path.join(root, manifest.layout.checksums);
  fs.writeFileSync(checksumPath, checksumLines(root, manifest.layout.checksums), { mode: 0o644 });
  fs.chmodSync(checksumPath, 0o644);
  return { componentManifest, sbom };
}

function readPlist(filePath) {
  const result = run("/usr/bin/plutil", ["-convert", "json", "-o", "-", filePath]);
  if (result.status !== 0) throw new Error(`plutil failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

function signatureClass(filePath) {
  const result = run("/usr/bin/codesign", ["-d", "--verbose=2", filePath]);
  if (result.status !== 0) return "unsigned";
  const output = `${result.stdout}\n${result.stderr}`;
  return /Signature=adhoc/.test(output) ? "ad-hoc" : "signed";
}

function executableArchitecture(filePath) {
  const result = run("/usr/bin/file", ["-b", filePath]);
  if (result.status !== 0) return null;
  if (/\barm64\b/.test(result.stdout)) return "arm64";
  if (/\bx86_64\b/.test(result.stdout)) return "x86_64";
  return null;
}

function verifyChecksums(root, checksumRelativePath) {
  const checksumPath = path.join(root, checksumRelativePath);
  if (!fs.existsSync(checksumPath)) return [finding("release.checksums", "SHA256SUMS is missing.")];
  const expected = checksumLines(root, checksumRelativePath);
  const actual = fs.readFileSync(checksumPath, "utf8");
  return actual === expected ? [] : [finding("release.checksums", "SHA256SUMS does not match the release tree.")];
}

export function inspectReleaseRoot(root, manifest, expectedReleaseManifestSHA256 = null) {
  const findings = [...validateReleaseManifest(manifest)];
  const warnings = [];
  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot)) throw new Error(`Release root does not exist: ${absoluteRoot}.`);
  const tree = walkReleaseTree(absoluteRoot);
  for (const entry of tree.filter((item) => item.kind === "symlink" || item.kind === "other")) {
    findings.push(finding("release.non-regular", `Release tree contains unsupported ${entry.kind}: ${entry.relativePath}.`));
  }
  for (const excluded of findExcludedPaths(absoluteRoot, manifest)) {
    findings.push(finding("release.excluded-path", `Release tree contains excluded path: ${excluded}.`));
  }

  const appPath = path.join(absoluteRoot, manifest.layout.application);
  const appExecutable = path.join(appPath, "Contents/MacOS", manifest.application.executable);
  const cliPath = path.join(absoluteRoot, manifest.layout.cli);
  const runtimeServer = path.join(appPath, "Contents/Resources/runtime/dist/server.js");
  const runtimePackage = path.join(appPath, "Contents/Resources/runtime/package.json");
  const appcast = path.join(appPath, "Contents/Resources/appcast.xml");
  const required = [appPath, appExecutable, cliPath, runtimeServer, runtimePackage, appcast];
  for (const requiredPath of required) {
    if (!fs.existsSync(requiredPath)) findings.push(finding("release.required-path", `Missing required release path: ${path.relative(absoluteRoot, requiredPath)}.`));
  }

  let architecture = null;
  let info = null;
  if (fs.existsSync(path.join(appPath, "Contents/Info.plist"))) {
    info = readPlist(path.join(appPath, "Contents/Info.plist"));
    const expectedInfo = {
      CFBundleIdentifier: manifest.application.bundleIdentifier,
      CFBundleExecutable: manifest.application.executable,
      CFBundlePackageType: manifest.application.packageType,
      CFBundleShortVersionString: manifest.release.version,
      CFBundleVersion: manifest.release.buildNumber,
      LSMinimumSystemVersion: manifest.release.minimumSystemVersion,
    };
    for (const [key, value] of Object.entries(expectedInfo)) {
      if (info[key] !== value) findings.push(finding("release.info-plist", `${key} expected ${value}, found ${info[key] ?? "missing"}.`));
    }
  } else {
    findings.push(finding("release.info-plist", "Application Info.plist is missing."));
  }
  if (fs.existsSync(appExecutable)) {
    architecture = executableArchitecture(appExecutable);
    if (!manifest.build.supportedArchitectures.includes(architecture)) findings.push(finding("release.app-architecture", `Unsupported application architecture: ${architecture ?? "unknown"}.`));
    if (signatureClass(appPath) !== "unsigned") findings.push(finding("release.app-signature", "Signing input application must be unsigned."));
  }
  if (fs.existsSync(cliPath)) {
    const cliArchitecture = executableArchitecture(cliPath);
    if (cliArchitecture !== architecture) findings.push(finding("release.cli-architecture", `CLI architecture ${cliArchitecture ?? "unknown"} does not match application ${architecture ?? "unknown"}.`));
    if (signatureClass(cliPath) !== "unsigned") findings.push(finding("release.cli-signature", "Signing input CLI must be unsigned."));
    if ((fs.statSync(cliPath).mode & 0o111) === 0) findings.push(finding("release.cli-mode", "Standalone CLI is not executable."));
  }

  const bundledNodePath = path.join(absoluteRoot, manifest.runtime.expectedBundlePath);
  if (fs.existsSync(bundledNodePath)) {
    findings.push(finding("release.runtime-unreviewed", "A bundled Node executable is present even though its signing review remains unresolved."));
  } else {
    warnings.push(finding("release.runtime-not-bundled", "Pinned Node supply-chain inputs exist, but this signing input still requires external node and is not clean-machine ready.", "warning"));
  }

  const runtimeSupplyPath = path.join(absoluteRoot, manifest.layout.runtimeSupplyChain);
  const componentPath = path.join(absoluteRoot, manifest.layout.componentManifest);
  const sbomPath = path.join(absoluteRoot, manifest.layout.sbom);
  const releaseManifestSHA256 = expectedReleaseManifestSHA256 ?? (fs.existsSync(runtimeSupplyPath)
    ? JSON.parse(fs.readFileSync(runtimeSupplyPath, "utf8")).releaseManifestSHA256
    : null);
  if (expectedReleaseManifestSHA256 && releaseManifestSHA256 !== expectedReleaseManifestSHA256) {
    findings.push(finding("release.manifest-hash", "Runtime supply-chain document references a different release manifest hash."));
  }
  if (!fs.existsSync(runtimeSupplyPath) || !fs.existsSync(componentPath) || !fs.existsSync(sbomPath)) {
    findings.push(finding("release.metadata", "Release component, SBOM, or Runtime supply-chain metadata is missing."));
  } else {
    const runtimeSupply = JSON.parse(fs.readFileSync(runtimeSupplyPath, "utf8"));
    if (JSON.stringify(runtimeSupply.runtime) !== JSON.stringify(manifest.runtime)) findings.push(finding("release.runtime-manifest", "Staged Runtime supply-chain data differs from the checked-in manifest."));
    const components = JSON.parse(fs.readFileSync(componentPath, "utf8"));
    const expectedComponents = createComponentManifest(absoluteRoot, manifest, {
      architecture,
      sourceRevision: components.sourceRevision,
      sourceDirty: components.sourceDirty,
      runtimePackageVersion: fs.existsSync(runtimePackage) ? JSON.parse(fs.readFileSync(runtimePackage, "utf8")).version : null,
      releaseManifestSHA256,
    });
    if (JSON.stringify(components) !== JSON.stringify(expectedComponents)) findings.push(finding("release.components", "Component manifest does not match staged payload bytes or build evidence."));
    const sbom = JSON.parse(fs.readFileSync(sbomPath, "utf8"));
    const expectedSBOM = createSPDXDocument(expectedComponents, manifest);
    if (JSON.stringify(sbom) !== JSON.stringify(expectedSBOM)) findings.push(finding("release.sbom", "SPDX SBOM does not match the component manifest."));
  }
  findings.push(...verifyChecksums(absoluteRoot, manifest.layout.checksums));

  const xattrs = run("/usr/bin/xattr", ["-lr", absoluteRoot]);
  const xattrNames = xattrs.status === 0
    ? [...new Set(xattrs.stdout.split("\n").map((line) => line.match(/:\s+(com\.apple\.[^:]+):/)?.[1]).filter(Boolean))].sort(compareText)
    : [];
  const signingIncompatibleXattrs = xattrNames.filter((name) => name === "com.apple.FinderInfo" || name === "com.apple.ResourceFork");
  if (signingIncompatibleXattrs.length > 0) {
    findings.push(finding("release.extended-attributes", `Release tree contains signing-incompatible attributes: ${signingIncompatibleXattrs.join(", ")}.`));
  }
  const ignoredXattrs = xattrNames.filter((name) => !signingIncompatibleXattrs.includes(name));
  if (ignoredXattrs.length > 0) {
    warnings.push(finding("release.omitted-extended-attributes", `Filesystem attributes omitted from the deterministic archive: ${ignoredXattrs.join(", ")}.`, "warning"));
  }

  return {
    kind: "release-root",
    manifestID: manifest.manifestID,
    passed: findings.length === 0,
    findings,
    warnings,
    evidence: {
      root: absoluteRoot,
      version: info?.CFBundleShortVersionString ?? null,
      buildNumber: info?.CFBundleVersion ?? null,
      architecture,
      fileCount: tree.filter((entry) => entry.kind === "file").length,
      payloadBytes: tree.filter((entry) => entry.kind === "file").reduce((sum, entry) => sum + entry.stat.size, 0),
      applicationSignature: fs.existsSync(appPath) ? signatureClass(appPath) : "missing",
      cliSignature: fs.existsSync(cliPath) ? signatureClass(cliPath) : "missing",
      runtimeBundled: fs.existsSync(bundledNodePath),
      omittedExtendedAttributes: ignoredXattrs,
    },
  };
}

export function normalizeTreeTimestamps(root, sourceDateEpoch) {
  const timestamp = new Date(sourceDateEpoch * 1000);
  const entries = walkReleaseTree(root).sort((a, b) => b.relativePath.split("/").length - a.relativePath.split("/").length);
  for (const entry of entries) fs.utimesSync(entry.absolutePath, timestamp, timestamp);
  fs.utimesSync(root, timestamp, timestamp);
}

export function createDeterministicArchive(root, archivePath, sourceDateEpoch) {
  const absoluteRoot = path.resolve(root);
  const absoluteArchive = path.resolve(archivePath);
  if (fs.existsSync(absoluteArchive)) throw new Error(`Refusing to overwrite existing archive: ${absoluteArchive}.`);
  fs.mkdirSync(path.dirname(absoluteArchive), { recursive: true });
  const expectedMilliseconds = sourceDateEpoch * 1000;
  const entries = walkReleaseTree(absoluteRoot);
  for (const entry of [{ absolutePath: absoluteRoot, stat: fs.statSync(absoluteRoot), relativePath: "." }, ...entries]) {
    if (Math.abs(entry.stat.mtimeMs - expectedMilliseconds) > 1000) {
      throw new Error(`Release timestamp is not normalized: ${entry.relativePath}.`);
    }
  }
  const archiveEntries = entries.map((entry) => entry.relativePath).sort(compareText);
  const temporaryTar = `${absoluteArchive}.${process.pid}.tar`;
  const temporaryGzip = `${temporaryTar}.gz`;
  try {
    const tar = run("/usr/bin/tar", [
      "-c", "-n", "--format", "ustar", "--no-xattrs", "--no-mac-metadata", "--no-acls", "--no-fflags",
      "--uid", "0", "--gid", "0", "--uname", "root", "--gname", "wheel",
      "-f", temporaryTar, "-C", absoluteRoot, ...archiveEntries,
    ]);
    if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr.trim() || tar.error}`);
    const gzip = run("/usr/bin/gzip", ["-n", "-9", temporaryTar]);
    if (gzip.status !== 0) throw new Error(`gzip failed: ${gzip.stderr.trim() || gzip.error}`);
    fs.renameSync(temporaryGzip, absoluteArchive);
    fs.chmodSync(absoluteArchive, 0o644);
    return { path: absoluteArchive, sha256: sha256File(absoluteArchive), bytes: fs.statSync(absoluteArchive).size, entries: archiveEntries.length };
  } finally {
    fs.rmSync(temporaryTar, { force: true });
    fs.rmSync(temporaryGzip, { force: true });
  }
}
