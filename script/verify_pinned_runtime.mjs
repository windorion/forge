#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  loadReleaseManifest,
  verifyPinnedRuntimeArchive,
} from "./lib/macos_release_foundation.mjs";

function usage(message = null) {
  if (message) console.error(message);
  console.error("usage: node script/verify_pinned_runtime.mjs --archive PATH --architecture arm64|x86_64 [--manifest PATH]");
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let manifestPath = path.join(repoRoot, "distribution/macos-release-manifest.json");
let archivePath = null;
let architecture = null;
for (let index = 2; index < process.argv.length; index += 1) {
  switch (process.argv[index]) {
    case "--archive": archivePath = process.argv[++index] ?? usage("--archive requires a path."); break;
    case "--architecture": architecture = process.argv[++index] ?? usage("--architecture requires a value."); break;
    case "--manifest": manifestPath = process.argv[++index] ?? usage("--manifest requires a path."); break;
    case "--help": usage(); break;
    default: usage(`Unknown argument: ${process.argv[index]}`);
  }
}
if (!archivePath || !architecture) usage("--archive and --architecture are required.");
const receipt = verifyPinnedRuntimeArchive(path.resolve(archivePath), loadReleaseManifest(path.resolve(manifestPath)), architecture);
console.log(JSON.stringify(receipt, null, 2));
