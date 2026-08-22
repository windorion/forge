import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const requiredProfiles = [
  "development-unsigned",
  "development-ad-hoc",
  "developer-id-release",
];

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

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function validatePolicy(policy) {
  const findings = [];
  if (policy.schemaVersion !== 1) {
    findings.push(finding("policy.schema", "schemaVersion must be 1."));
  }
  if (policy.policyID !== "forge-macos-signing") {
    findings.push(finding("policy.id", "policyID must be forge-macos-signing."));
  }
  if (!policy.bundle?.identifier || !policy.bundle?.executable) {
    findings.push(finding("policy.bundle", "The main bundle identifier and executable are required."));
  }
  for (const profileName of requiredProfiles) {
    if (!policy.profiles?.[profileName]) {
      findings.push(finding("policy.profile", `Missing required profile ${profileName}.`));
    }
  }

  const release = policy.profiles?.["developer-id-release"];
  if (release) {
    const releaseRequirements = [
      [release.signatureClass === "developer-id", "Developer ID signature class"],
      [release.hardenedRuntime === true, "hardened runtime"],
      [release.notarization === "required", "notarization"],
      [release.stapling === "required", "ticket stapling"],
      [release.updateSignature === "required", "update signature"],
      [release.bundledRuntime === "required", "bundled runtime"],
      [release.nestedCodeSameTeam === true, "same-team nested code"],
      [release.distributionReady === true, "distribution-ready marker"],
    ];
    for (const [satisfied, label] of releaseRequirements) {
      if (!satisfied) {
        findings.push(finding("policy.release", `Release profile must require ${label}.`));
      }
    }
  }

  for (const profileName of ["development-unsigned", "development-ad-hoc"]) {
    const profile = policy.profiles?.[profileName];
    if (profile?.distributionReady !== false) {
      findings.push(finding("policy.development", `${profileName} must never be distribution-ready.`));
    }
    if (profile?.notarization !== "not-applicable") {
      findings.push(finding("policy.development", `${profileName} must not claim notarization.`));
    }
  }

  if (policy.components?.updater?.notarizationInferredFromFeed !== false) {
    findings.push(finding("policy.updater", "An appcast signature must not be treated as notarization evidence."));
  }
  if (policy.components?.keychain?.accessGroups?.length !== 0) {
    findings.push(finding("policy.keychain", "Current generic-password storage must not invent a shared Keychain access group."));
  }
  if (policy.components?.widget?.packagedExtension !== false) {
    findings.push(finding("policy.widget", "The current SwiftPM widget experiment must not claim to be a packaged extension."));
  }
  const runtime = policy.components?.runtime;
  if (runtime?.supplyChainManifest !== "distribution/macos-release-manifest.json") {
    findings.push(finding("policy.runtime-supply-chain", "Runtime must reference the versioned macOS release supply-chain manifest."));
  }
  if (runtime?.bundledNodeExecutable !== null &&
      (!Array.isArray(runtime?.bundledExecutableEntitlements) ||
       typeof runtime?.bundledExecutableHardenedRuntime !== "boolean")) {
    findings.push(finding("policy.runtime-entitlements", "A bundled Runtime executable requires an exact entitlement list and hardened-runtime decision."));
  }

  return findings;
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(candidate));
    } else if (entry.isFile()) {
      files.push(candidate);
    }
  }
  return files;
}

export function inspectSourceTree(repoRoot, policy) {
  const findings = [...validatePolicy(policy)];
  const warnings = [];
  const buildScript = fs.readFileSync(path.join(repoRoot, "script/build_and_run.sh"), "utf8");
  const releaseBuildScript = fs.readFileSync(path.join(repoRoot, "script/build_macos_release.mjs"), "utf8");
  const releaseManifest = readJSON(path.join(repoRoot, "distribution/macos-release-manifest.json"));
  const stagingScript = fs.readFileSync(path.join(repoRoot, "script/stage_macos_distribution.sh"), "utf8");
  const updater = fs.readFileSync(path.join(repoRoot, "apps/macos/Sources/ForgeApp/ForgeUpdater.swift"), "utf8");
  const appcast = fs.readFileSync(path.join(repoRoot, "apps/macos/Resources/appcast.xml"), "utf8");
  const workspaceModel = fs.readFileSync(path.join(repoRoot, "apps/macos/Sources/ForgeApp/WorkspaceModel.swift"), "utf8");
  const missionControl = fs.readFileSync(path.join(repoRoot, "apps/macos/Sources/ForgeApp/MissionControlRuntimeSupervisor.swift"), "utf8");
  const packageSwift = fs.readFileSync(path.join(repoRoot, "Package.swift"), "utf8");
  const xcodeProject = fs.readFileSync(path.join(repoRoot, "ForgeApp.xcodeproj/project.pbxproj"), "utf8");

  const buildOnlyIndex = buildScript.indexOf("--build-only");
  const processStopIndex = buildScript.indexOf("pkill -x");
  if (buildOnlyIndex < 0 || !buildScript.includes('[[ "$MODE" == "build"')) {
    findings.push(finding("source.build-only", "Build script must provide a non-launching build-only mode."));
  }
  if (processStopIndex >= 0 && processStopIndex < buildScript.indexOf("exit 0")) {
    findings.push(finding("source.desktop-side-effect", "Build-only assembly must complete before any running app is stopped."));
  }
  if (/codesign\s+[^\n]*--sign(?:\s|=)/.test(buildScript)) {
    findings.push(finding("source.implicit-signing", "Development bundle assembly must not silently choose a signing identity."));
  }
  if (!buildScript.includes('codesign --remove-signature "$APP_BINARY"')) {
    findings.push(finding("source.compiler-signature", "Assembly must remove SwiftPM's compiler ad-hoc signature before claiming an unsigned artifact."));
  }
  if (!buildScript.includes('rm -rf "$ROOT_DIR/runtime/dist"')) {
    findings.push(finding("source.clean-runtime", "Runtime dist must be removed before compiling resources for the app bundle."));
  }
  if (!buildScript.includes('xattr -cr "$APP_BUNDLE"')) {
    findings.push(finding("source.extended-attributes", "Assembled bundle must clear inherited extended attributes before signing."));
  }
  if (!stagingScript.includes("ditto --norsrc --noextattr") || !stagingScript.includes("refusing to overwrite")) {
    findings.push(finding("source.signing-stage", "Signing staging must omit extended attributes and refuse to overwrite an existing destination."));
  }

  const releaseFoundationPresent = releaseManifest.manifestID === "forge-macos-release" &&
    releaseManifest.build?.swiftConfiguration === "release" &&
    releaseManifest.build?.signingState === "unsigned" &&
    releaseManifest.runtime?.packagingState === "manifest-only" &&
    Array.isArray(releaseManifest.runtime?.artifacts) &&
    releaseManifest.runtime.artifacts.length === 2 &&
    releaseBuildScript.includes('"--product", manifest.application.swiftProduct') &&
    releaseBuildScript.includes('"--product", manifest.cli.swiftProduct') &&
    releaseBuildScript.includes("writeReleaseMetadata") &&
    releaseBuildScript.includes("createDeterministicArchive");
  if (releaseFoundationPresent !== policy.sourceAssertions.releaseFoundationPresent) {
    findings.push(finding("source.release-foundation", "Release-shaped optimized build, manifest, SBOM, or deterministic archive state contradicts sourceAssertions."));
  }
  if (/\/usr\/bin\/open|pkill\s+-x/.test(releaseBuildScript)) {
    findings.push(finding("source.release-desktop-side-effect", "Release assembly must never launch or stop the desktop application."));
  }
  if (/--sign(?:\s|=)/.test(releaseBuildScript)) {
    findings.push(finding("source.release-implicit-signing", "Release-shaped code-only assembly must not choose a signing identity."));
  }

  const feedHasSignature = /sparkle:edSignature\s*=/.test(appcast);
  if (feedHasSignature !== policy.sourceAssertions.placeholderFeedSigned) {
    findings.push(finding("source.appcast", "Placeholder appcast signature state contradicts sourceAssertions."));
  }
  if (/signed\s*&\s*notarized/i.test(updater)) {
    findings.push(finding("source.notarization-claim", "Updater UI must not claim notarization from feed metadata."));
  }
  if (!updater.includes("notarization not verified here") || !updater.includes("unsigned placeholder feed · install disabled")) {
    findings.push(finding("source.update-trust-copy", "Updater must distinguish update signatures from notarization and unsigned placeholder feeds."));
  }
  if (!updater.includes("installEnabled: false") || !updater.includes("guard available.installEnabled")) {
    findings.push(finding("source.update-install-gate", "Placeholder appcast parsing must keep download/install disabled and fail closed at the model boundary."));
  }

  const externalNodeRequired = [workspaceModel, missionControl].every((source) =>
    source.includes('executableURL = URL(fileURLWithPath: "/usr/bin/env")') && source.includes('"node"')
  );
  if (externalNodeRequired !== policy.sourceAssertions.externalNodeRequired) {
    findings.push(finding("source.runtime-launcher", "Runtime launcher state contradicts the signing inventory."));
  }
  if (externalNodeRequired) {
    warnings.push(finding("release.external-node", "The current app requires node from the user's PATH; a clean-machine release needs a pinned bundled runtime.", "warning"));
  }

  const widgetIsExecutable = packageSwift.includes('.executable(name: "ForgeWidgets"') &&
    packageSwift.includes('.executableTarget(\n            name: "ForgeWidgets"');
  if (!widgetIsExecutable || policy.components.widget.packagedExtension !== false) {
    findings.push(finding("source.widget-shape", "Widget inventory must describe the current SwiftPM executable rather than an app extension."));
  }
  warnings.push(finding("release.widget", "The WidgetKit source is not a packaged .appex and cannot be release-signed or discovered.", "warning"));

  if (!xcodeProject.includes("com.windorion.forge.uitest-host") ||
      !xcodeProject.includes("ENABLE_HARDENED_RUNTIME = NO") ||
      !xcodeProject.includes('CODE_SIGN_IDENTITY = "-"')) {
    findings.push(finding("source.xcode-host", "Committed Xcode project must remain explicitly classified as an ad-hoc, non-hardened UI-test host."));
  }
  if (policy.sourceAssertions.productionXcodeProjectPresent !== false) {
    findings.push(finding("source.production-project", "Policy must not claim that the UI-test-host project is a production packaging project."));
  }
  if (/CODE_SIGN_ENTITLEMENTS\s*=/.test(xcodeProject) && policy.bundle.entitlementsFile === null) {
    findings.push(finding("source.xcode-entitlements", "Xcode project references an entitlement file that the policy does not declare."));
  }
  if ((/ForgeHelper/.test(packageSwift) || /com\.windorion\.forge\.helper/.test(xcodeProject)) &&
      policy.components.loginItem.separateHelper === false) {
    findings.push(finding("source.helper-target", "A helper target exists but the component inventory still claims there is no separate helper."));
  }
  warnings.push(finding("release.production-project", "No production Xcode archive/export configuration exists yet.", "warning"));

  const entitlementFiles = walkFiles(path.join(repoRoot, "apps"))
    .filter((file) => file.endsWith(".entitlements"))
    .map((file) => path.relative(repoRoot, file));
  if (policy.bundle.entitlementsFile === null && entitlementFiles.length > 0) {
    findings.push(finding("source.entitlements", `Undeclared entitlement files found: ${entitlementFiles.join(", ")}.`));
  }

  if (policy.components.keychain.accessGroups.length !== 0 || policy.bundle.expectedEntitlements.length !== 0) {
    findings.push(finding("source.entitlement-invention", "Current targets use no declared entitlements or Keychain access groups; policy changes require an explicit architecture update."));
  }

  return {
    kind: "source",
    policyID: policy.policyID,
    passed: findings.length === 0,
    findings,
    warnings,
    observed: {
      buildOnlyMode: buildOnlyIndex >= 0,
      placeholderFeedSigned: feedHasSignature,
      updaterClaimsNotarization: /signed\s*&\s*notarized/i.test(updater),
      externalNodeRequired,
      productionXcodeProjectPresent: false,
      xcodeProjectPurpose: "ui-test-host-only",
      widgetExtensionPresent: false,
      releaseFoundationPresent,
      entitlementFiles,
    },
  };
}

function parsePlistFile(filePath) {
  const result = run("/usr/bin/plutil", ["-convert", "json", "-o", "-", filePath]);
  if (result.status !== 0) {
    throw new Error(`plutil failed for ${filePath}: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

function parseEntitlements(appPath) {
  const result = run("/usr/bin/codesign", ["-d", "--entitlements", ":-", appPath]);
  const output = `${result.stdout}\n${result.stderr}`;
  const start = output.indexOf("<?xml");
  const end = output.lastIndexOf("</plist>");
  if (start < 0 || end < start) return {};
  const xml = output.slice(start, end + "</plist>".length);
  const converted = run("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], { input: xml });
  if (converted.status !== 0) return {};
  return JSON.parse(converted.stdout);
}

function inspectSignature(codePath) {
  const result = run("/usr/bin/codesign", ["-d", "--verbose=4", codePath]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0) {
    return {
      class: "unsigned",
      authority: null,
      teamIdentifier: null,
      hardenedRuntime: false,
      entitlements: {},
      diagnostic: output.trim(),
    };
  }
  const authority = output.match(/^Authority=(.+)$/m)?.[1]?.trim() ?? null;
  const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? null;
  const adHoc = /Signature=adhoc/.test(output) || /flags=0x2\(adhoc\)/.test(output);
  return {
    class: adHoc ? "ad-hoc" : authority?.startsWith("Developer ID Application:") ? "developer-id" : "other",
    authority,
    teamIdentifier: teamIdentifier === "not set" ? null : teamIdentifier,
    hardenedRuntime: /flags=.*\bruntime\b/.test(output),
    entitlements: parseEntitlements(codePath),
    diagnostic: output.trim(),
  };
}

function inspectNestedCode(appPath, mainExecutablePath) {
  const nested = [];
  for (const filePath of walkFiles(appPath)) {
    if (filePath === mainExecutablePath) continue;
    const stat = fs.statSync(filePath);
    if ((stat.mode & 0o111) === 0 && !/\.(dylib|so)$/.test(filePath)) continue;
    const identified = run("/usr/bin/file", ["-b", filePath]);
    if (!identified.stdout.includes("Mach-O")) continue;
    nested.push({
      path: path.relative(appPath, filePath),
      ...inspectSignature(filePath),
    });
  }
  return nested;
}

function appcastHasEdSignature(appcastPath) {
  return fs.existsSync(appcastPath) && /sparkle:edSignature\s*=/.test(fs.readFileSync(appcastPath, "utf8"));
}

export function inspectAppBundle(appPath, policy) {
  const infoPath = path.join(appPath, "Contents/Info.plist");
  if (!fs.existsSync(infoPath)) {
    throw new Error(`Missing application Info.plist at ${infoPath}.`);
  }
  const info = parsePlistFile(infoPath);
  const executablePath = path.join(appPath, "Contents/MacOS", info.CFBundleExecutable ?? "");
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Missing application executable at ${executablePath}.`);
  }
  const signature = inspectSignature(appPath);
  const runtimeServerPath = path.join(appPath, policy.components.runtime.serverPath);
  const runtimeDistPath = path.dirname(runtimeServerPath);
  const bundledNode = policy.components.runtime.bundledNodeExecutable
    ? path.join(appPath, policy.components.runtime.bundledNodeExecutable)
    : null;
  const appcastPath = path.join(appPath, policy.components.updater.feedPath);
  const stapler = run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
  const gatekeeper = run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", appPath]);

  return {
    appPath: path.resolve(appPath),
    bundleIdentifier: info.CFBundleIdentifier ?? null,
    executable: info.CFBundleExecutable ?? null,
    packageType: info.CFBundlePackageType ?? null,
    minimumSystemVersion: info.LSMinimumSystemVersion ?? null,
    signature,
    nestedCode: inspectNestedCode(appPath, executablePath),
    runtime: {
      serverJavaScriptPresent: fs.existsSync(runtimeServerPath),
      nodeExecutablePresent: bundledNode ? fs.existsSync(bundledNode) : false,
      nodeExecutablePath: bundledNode,
      unexpectedGeneratedFixtures: walkFiles(runtimeDistPath)
        .filter((file) => /^forge-core-smoke-/.test(path.basename(file)))
        .map((file) => path.relative(appPath, file)),
    },
    updater: {
      feedPresent: fs.existsSync(appcastPath),
      edSignaturePresent: appcastHasEdSignature(appcastPath),
    },
    notarization: {
      stapled: stapler.status === 0,
      staplerDiagnostic: `${stapler.stdout}\n${stapler.stderr}`.trim(),
      gatekeeperAccepted: gatekeeper.status === 0,
      gatekeeperDiagnostic: `${gatekeeper.stdout}\n${gatekeeper.stderr}`.trim(),
    },
  };
}

export function evaluateArtifact(policy, profileName, evidence) {
  const profile = policy.profiles?.[profileName];
  if (!profile) {
    return {
      kind: "artifact",
      profile: profileName,
      passed: false,
      findings: [finding("artifact.profile", `Unknown signing profile ${profileName}.`)],
      evidence,
    };
  }

  const findings = [];
  if (evidence.bundleIdentifier !== policy.bundle.identifier) {
    findings.push(finding("artifact.bundle-id", `Expected ${policy.bundle.identifier}, found ${evidence.bundleIdentifier ?? "missing"}.`));
  }
  if (evidence.executable !== policy.bundle.executable) {
    findings.push(finding("artifact.executable", `Expected ${policy.bundle.executable}, found ${evidence.executable ?? "missing"}.`));
  }
  if (evidence.packageType !== policy.bundle.packageType) {
    findings.push(finding("artifact.package-type", `Expected ${policy.bundle.packageType}, found ${evidence.packageType ?? "missing"}.`));
  }
  if (evidence.minimumSystemVersion !== policy.bundle.minimumSystemVersion) {
    findings.push(finding("artifact.minimum-system", `Expected minimum macOS ${policy.bundle.minimumSystemVersion}, found ${evidence.minimumSystemVersion ?? "missing"}.`));
  }
  if (!evidence.runtime.serverJavaScriptPresent) {
    findings.push(finding("artifact.runtime-server", "Bundled runtime server.js is missing."));
  }
  if ((evidence.runtime.unexpectedGeneratedFixtures ?? []).length > 0) {
    findings.push(finding("artifact.runtime-fixtures", `Bundled runtime contains ${evidence.runtime.unexpectedGeneratedFixtures.length} generated smoke fixtures.`));
  }
  if (!evidence.updater.feedPresent) {
    findings.push(finding("artifact.appcast", "Bundled update feed is missing."));
  }
  if (evidence.signature.class !== profile.signatureClass) {
    findings.push(finding("artifact.signature", `Profile ${profileName} requires ${profile.signatureClass}; found ${evidence.signature.class}.`));
  }
  if (evidence.signature.hardenedRuntime !== profile.hardenedRuntime) {
    findings.push(finding("artifact.hardened-runtime", `Profile ${profileName} requires hardenedRuntime=${profile.hardenedRuntime}; found ${evidence.signature.hardenedRuntime}.`));
  }

  const entitlementKeys = Object.keys(evidence.signature.entitlements ?? {}).sort();
  const expected = [...policy.bundle.expectedEntitlements].sort();
  const unexpected = entitlementKeys.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !entitlementKeys.includes(key));
  const forbidden = entitlementKeys.filter((key) => policy.bundle.forbiddenEntitlements.includes(key));
  if (unexpected.length > 0) {
    findings.push(finding("artifact.unexpected-entitlements", `Unexpected entitlements: ${unexpected.join(", ")}.`));
  }
  if (missing.length > 0) {
    findings.push(finding("artifact.missing-entitlements", `Missing expected entitlements: ${missing.join(", ")}.`));
  }
  if (forbidden.length > 0) {
    findings.push(finding("artifact.forbidden-entitlements", `Forbidden entitlements: ${forbidden.join(", ")}.`));
  }

  if (profileName === "developer-id-release") {
    if (!evidence.signature.authority?.startsWith(profile.identityPrefix)) {
      findings.push(finding("release.identity", "Release authority is not a Developer ID Application identity."));
    }
    if (!evidence.signature.teamIdentifier) {
      findings.push(finding("release.team", "Release signature has no TeamIdentifier."));
    }
    if (!evidence.runtime.nodeExecutablePresent) {
      findings.push(finding("release.runtime", "Release artifact has no pinned bundled Node executable."));
    }
    if (policy.components.runtime.bundledNodeExecutable === null ||
        !Array.isArray(policy.components.runtime.bundledExecutableEntitlements) ||
        typeof policy.components.runtime.bundledExecutableHardenedRuntime !== "boolean") {
      findings.push(finding("release.runtime-policy", "Policy has not selected and reviewed a bundled Runtime executable, its entitlements, and hardened-runtime behavior."));
    }
    if (!evidence.updater.edSignaturePresent) {
      findings.push(finding("release.update-signature", "Release appcast enclosure has no EdDSA signature."));
    }
    if (!evidence.notarization.stapled) {
      findings.push(finding("release.stapling", "No valid stapled notarization ticket was found."));
    }
    if (!evidence.notarization.gatekeeperAccepted) {
      findings.push(finding("release.gatekeeper", "Gatekeeper did not accept the application."));
    }
    for (const nested of evidence.nestedCode) {
      if (nested.class !== "developer-id" || nested.teamIdentifier !== evidence.signature.teamIdentifier) {
        findings.push(finding("release.nested-code", `${nested.path} is not signed with the main app's Developer ID team.`));
      }
    }
    if (policy.components.runtime.bundledNodeExecutable !== null) {
      const runtimePath = policy.components.runtime.bundledNodeExecutable.replace(/^Contents\//, "Contents/");
      const runtimeCode = evidence.nestedCode.find((item) => item.path === runtimePath);
      if (!runtimeCode) {
        findings.push(finding("release.runtime-code", `Bundled Runtime executable is not present as nested Mach-O code: ${runtimePath}.`));
      } else {
        const runtimeEntitlements = Object.keys(runtimeCode.entitlements ?? {}).sort();
        const expectedRuntimeEntitlements = [...policy.components.runtime.bundledExecutableEntitlements].sort();
        if (JSON.stringify(runtimeEntitlements) !== JSON.stringify(expectedRuntimeEntitlements)) {
          findings.push(finding("release.runtime-entitlements", `Bundled Runtime entitlements differ from policy: ${runtimeEntitlements.join(", ") || "none"}.`));
        }
        if (runtimeCode.hardenedRuntime !== policy.components.runtime.bundledExecutableHardenedRuntime) {
          findings.push(finding("release.runtime-hardened", "Bundled Runtime hardened-runtime state differs from policy."));
        }
      }
    }
  }

  return {
    kind: "artifact",
    policyID: policy.policyID,
    profile: profileName,
    distributionReady: profile.distributionReady,
    passed: findings.length === 0,
    findings,
    evidence,
  };
}

export function loadPolicy(policyPath) {
  return readJSON(policyPath);
}
