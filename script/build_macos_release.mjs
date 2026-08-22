#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createDeterministicArchive,
  findExcludedPaths,
  inspectReleaseRoot,
  loadReleaseManifest,
  normalizeArchitecture,
  normalizeTreeTimestamps,
  sha256File,
  validateReleaseManifest,
  writeReleaseMetadata,
} from "./lib/macos_release_foundation.mjs";

function usage(message = null) {
  if (message) console.error(message);
  console.error("usage: node script/build_macos_release.mjs --output PATH [--archive PATH] [--manifest PATH]");
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: buildEnvironment,
    ...options,
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message || "no diagnostic output";
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}.\n${detail}`);
  }
  return (result.stdout ?? "").trim();
}

function copyFile(source, destination, mode = null) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (mode !== null) fs.chmodSync(destination, mode);
}

function removeCompilerSignature(executablePath) {
  const probe = spawnSync("/usr/bin/codesign", ["-d", executablePath], { encoding: "utf8" });
  if (probe.status === 0) run("/usr/bin/codesign", ["--remove-signature", executablePath]);
  const verification = spawnSync("/usr/bin/codesign", ["-d", executablePath], { encoding: "utf8" });
  if (verification.status === 0) throw new Error(`Failed to produce unsigned executable: ${executablePath}.`);
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function infoPlist(manifest) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${xml(manifest.application.executable)}</string>
  <key>CFBundleIdentifier</key>
  <string>${xml(manifest.application.bundleIdentifier)}</string>
  <key>CFBundleName</key>
  <string>${xml(manifest.application.bundleName)}</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>com.windorion.forge.deeplink</string>
      <key>CFBundleURLSchemes</key>
      <array><string>forge</string></array>
    </dict>
  </array>
  <key>CFBundleShortVersionString</key>
  <string>${xml(manifest.release.version)}</string>
  <key>CFBundleVersion</key>
  <string>${xml(manifest.release.buildNumber)}</string>
  <key>CFBundlePackageType</key>
  <string>${xml(manifest.application.packageType)}</string>
  <key>LSMinimumSystemVersion</key>
  <string>${xml(manifest.release.minimumSystemVersion)}</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
`;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
let manifestPath = path.join(repoRoot, "distribution/macos-release-manifest.json");
let outputPath = null;
let archivePath = null;

for (let index = 2; index < process.argv.length; index += 1) {
  switch (process.argv[index]) {
    case "--output": outputPath = process.argv[++index] ?? usage("--output requires a path."); break;
    case "--archive": archivePath = process.argv[++index] ?? usage("--archive requires a path."); break;
    case "--manifest": manifestPath = process.argv[++index] ?? usage("--manifest requires a path."); break;
    case "--help": usage(); break;
    default: usage(`Unknown argument: ${process.argv[index]}`);
  }
}
if (!outputPath) usage("--output is required so the script never guesses a destructive destination.");
if (process.platform !== "darwin") throw new Error("The macOS release foundation must run on macOS.");

manifestPath = path.resolve(manifestPath);
outputPath = path.resolve(outputPath);
archivePath = archivePath ? path.resolve(archivePath) : `${outputPath}.tar.gz`;
if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite existing release root: ${outputPath}.`);
if (fs.existsSync(archivePath)) throw new Error(`Refusing to overwrite existing release archive: ${archivePath}.`);

const manifest = loadReleaseManifest(manifestPath);
const manifestFindings = validateReleaseManifest(manifest);
if (manifestFindings.length > 0) throw new Error(`Invalid release manifest:\n${manifestFindings.map((item) => `- ${item.code}: ${item.message}`).join("\n")}`);

const architecture = normalizeArchitecture(os.arch());
if (!manifest.build.supportedArchitectures.includes(architecture)) throw new Error(`Host architecture ${architecture} is not supported by the release manifest.`);
const buildEnvironment = {
  ...process.env,
  SWIFTPM_MODULECACHE_OVERRIDE: process.env.SWIFTPM_MODULECACHE_OVERRIDE ?? path.join(repoRoot, ".build/module-cache"),
  CLANG_MODULE_CACHE_PATH: process.env.CLANG_MODULE_CACHE_PATH ?? path.join(repoRoot, ".build/clang-module-cache"),
  SOURCE_DATE_EPOCH: String(manifest.release.sourceDateEpoch),
};
fs.mkdirSync(buildEnvironment.SWIFTPM_MODULECACHE_OVERRIDE, { recursive: true });
fs.mkdirSync(buildEnvironment.CLANG_MODULE_CACHE_PATH, { recursive: true });

let completed = false;
try {
  console.log(`Building Forge ${manifest.release.version} (${manifest.release.buildNumber}) for ${architecture}...`);
  run("/usr/bin/swift", ["build", "-c", manifest.build.swiftConfiguration, "--product", manifest.application.swiftProduct]);
  run("/usr/bin/swift", ["build", "-c", manifest.build.swiftConfiguration, "--product", manifest.cli.swiftProduct]);
  const swiftBinaryDirectory = run("/usr/bin/swift", ["build", "-c", manifest.build.swiftConfiguration, "--show-bin-path"], { capture: true });

  fs.rmSync(path.join(repoRoot, "runtime/dist"), { recursive: true, force: true });
  run("npm", ["run", "check"], { cwd: path.join(repoRoot, "runtime") });
  run(manifest.build.runtimeCommand[0], manifest.build.runtimeCommand.slice(1), { cwd: path.join(repoRoot, "runtime") });

  const appPath = path.join(outputPath, manifest.layout.application);
  const contentsPath = path.join(appPath, "Contents");
  const resourcesPath = path.join(contentsPath, "Resources");
  const appExecutablePath = path.join(contentsPath, "MacOS", manifest.application.executable);
  const cliPath = path.join(outputPath, manifest.layout.cli);
  const runtimeResourcePath = path.join(resourcesPath, "runtime");
  fs.mkdirSync(path.dirname(appExecutablePath), { recursive: true });
  fs.mkdirSync(path.join(resourcesPath, "Fonts"), { recursive: true });

  copyFile(path.join(swiftBinaryDirectory, manifest.application.executable), appExecutablePath, 0o755);
  copyFile(path.join(swiftBinaryDirectory, manifest.cli.executable), cliPath, 0o755);
  removeCompilerSignature(appExecutablePath);
  removeCompilerSignature(cliPath);

  copyFile(path.join(repoRoot, "runtime/package.json"), path.join(runtimeResourcePath, "package.json"), 0o644);
  fs.cpSync(path.join(repoRoot, "runtime/dist"), path.join(runtimeResourcePath, "dist"), { recursive: true, force: false });
  copyFile(path.join(repoRoot, "design_handoff_forge/assets/forge-logo.png"), path.join(resourcesPath, "forge-logo.png"), 0o644);
  copyFile(path.join(repoRoot, "apps/macos/Resources/appcast.xml"), path.join(resourcesPath, "appcast.xml"), 0o644);
  for (const name of ["JetBrainsMono-Regular.ttf", "JetBrainsMono-Bold.ttf", "OFL.txt"]) {
    copyFile(path.join(repoRoot, "apps/macos/Resources/Fonts", name), path.join(resourcesPath, "Fonts", name), 0o644);
  }
  fs.writeFileSync(path.join(contentsPath, "Info.plist"), infoPlist(manifest), { mode: 0o644 });
  run("/usr/bin/xattr", ["-cr", outputPath]);

  const sourceRevision = run("/usr/bin/git", ["rev-parse", "HEAD"], { capture: true });
  const sourceDirty = run("/usr/bin/git", ["status", "--porcelain"], { capture: true }).length > 0;
  const runtimePackageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "runtime/package.json"), "utf8")).version;
  const releaseManifestSHA256 = sha256File(manifestPath);
  writeReleaseMetadata(outputPath, manifest, {
    architecture,
    sourceRevision,
    sourceDirty,
    runtimePackageVersion,
    releaseManifestSHA256,
  });

  const excluded = findExcludedPaths(outputPath, manifest);
  if (excluded.length > 0) throw new Error(`Excluded debug/test paths entered the release root:\n${excluded.join("\n")}`);
  run("/usr/bin/xattr", ["-cr", outputPath]);
  normalizeTreeTimestamps(outputPath, manifest.release.sourceDateEpoch);
  const report = inspectReleaseRoot(outputPath, manifest, releaseManifestSHA256);
  if (!report.passed) throw new Error(`Release root verification failed:\n${report.findings.map((item) => `- ${item.code}: ${item.message}`).join("\n")}`);
  const archive = createDeterministicArchive(outputPath, archivePath, manifest.release.sourceDateEpoch);
  completed = true;
  console.log(JSON.stringify({
    releaseRoot: outputPath,
    archive,
    architecture,
    signingState: "unsigned",
    runtimeBundled: false,
    warnings: report.warnings,
  }, null, 2));
} finally {
  if (!completed && fs.existsSync(outputPath)) fs.rmSync(outputPath, { recursive: true, force: true });
}
