#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createDeterministicArchive,
  inspectReleaseRoot,
  loadReleaseManifest,
  sha256File,
} from "./lib/macos_release_foundation.mjs";

function usage(message = null) {
  if (message) console.error(message);
  console.error("usage: node script/archive_macos_release.mjs --root PATH --output PATH [--manifest PATH]");
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let manifestPath = path.join(repoRoot, "distribution/macos-release-manifest.json");
let releaseRoot = null;
let outputPath = null;
for (let index = 2; index < process.argv.length; index += 1) {
  switch (process.argv[index]) {
    case "--root": releaseRoot = process.argv[++index] ?? usage("--root requires a path."); break;
    case "--output": outputPath = process.argv[++index] ?? usage("--output requires a path."); break;
    case "--manifest": manifestPath = process.argv[++index] ?? usage("--manifest requires a path."); break;
    case "--help": usage(); break;
    default: usage(`Unknown argument: ${process.argv[index]}`);
  }
}
if (!releaseRoot || !outputPath) usage("--root and --output are required.");

manifestPath = path.resolve(manifestPath);
const manifest = loadReleaseManifest(manifestPath);
const root = path.resolve(releaseRoot);
const report = inspectReleaseRoot(root, manifest, sha256File(manifestPath));
if (!report.passed) {
  throw new Error(`Refusing to archive an invalid release root:\n${report.findings.map((item) => `- ${item.code}: ${item.message}`).join("\n")}`);
}
const archive = createDeterministicArchive(root, path.resolve(outputPath), manifest.release.sourceDateEpoch);
console.log(JSON.stringify(archive, null, 2));
