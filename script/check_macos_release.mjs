#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  inspectReleaseRoot,
  loadReleaseManifest,
  sha256File,
} from "./lib/macos_release_foundation.mjs";

function usage(message = null) {
  if (message) console.error(message);
  console.error("usage: node script/check_macos_release.mjs --root PATH [--manifest PATH] [--json-output PATH]");
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let manifestPath = path.join(repoRoot, "distribution/macos-release-manifest.json");
let releaseRoot = null;
let jsonOutput = null;
for (let index = 2; index < process.argv.length; index += 1) {
  switch (process.argv[index]) {
    case "--root": releaseRoot = process.argv[++index] ?? usage("--root requires a path."); break;
    case "--manifest": manifestPath = process.argv[++index] ?? usage("--manifest requires a path."); break;
    case "--json-output": jsonOutput = process.argv[++index] ?? usage("--json-output requires a path."); break;
    case "--help": usage(); break;
    default: usage(`Unknown argument: ${process.argv[index]}`);
  }
}
if (!releaseRoot) usage("--root is required.");

manifestPath = path.resolve(manifestPath);
const manifest = loadReleaseManifest(manifestPath);
const report = inspectReleaseRoot(path.resolve(releaseRoot), manifest, sha256File(manifestPath));
console.log(`${report.passed ? "PASS" : "FAIL"} release-shaped unsigned signing input`);
for (const warning of report.warnings) console.log(`  WARN ${warning.code}: ${warning.message}`);
for (const item of report.findings) console.log(`  ERROR ${item.code}: ${item.message}`);
console.log(`  ${report.evidence.fileCount} files, ${report.evidence.payloadBytes} bytes, ${report.evidence.architecture ?? "unknown architecture"}`);

if (jsonOutput) {
  const outputPath = path.resolve(jsonOutput);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({
    schemaVersion: 1,
    manifestID: manifest.manifestID,
    generatedAt: new Date().toISOString(),
    ...report,
  }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(outputPath, 0o600);
  console.log(`Report: ${outputPath}`);
}
process.exit(report.passed ? 0 : 1);
