#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  evaluateArtifact,
  inspectAppBundle,
  inspectSourceTree,
  loadPolicy,
} from "./lib/macos_distribution_policy.mjs";

function usage(message) {
  if (message) console.error(message);
  console.error("usage: node script/check_macos_distribution.mjs [--source] [--app PATH --profile PROFILE] [--policy PATH] [--json-output PATH]");
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let policyPath = path.join(repoRoot, "distribution/macos-signing-policy.json");
let appPath = null;
let profile = null;
let source = false;
let jsonOutput = null;

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  switch (argument) {
    case "--source": source = true; break;
    case "--app": appPath = process.argv[++index] ?? usage("--app requires a path."); break;
    case "--profile": profile = process.argv[++index] ?? usage("--profile requires a name."); break;
    case "--policy": policyPath = process.argv[++index] ?? usage("--policy requires a path."); break;
    case "--json-output": jsonOutput = process.argv[++index] ?? usage("--json-output requires a path."); break;
    case "--help": usage(); break;
    default: usage(`Unknown argument: ${argument}`);
  }
}

if (!source && !appPath) source = true;
if ((appPath && !profile) || (!appPath && profile)) {
  usage("--app and --profile must be supplied together.");
}

const policy = loadPolicy(path.resolve(policyPath));
const reports = [];
if (source) reports.push(inspectSourceTree(repoRoot, policy));
if (appPath) {
  const evidence = inspectAppBundle(path.resolve(appPath), policy);
  reports.push(evaluateArtifact(policy, profile, evidence));
}

for (const report of reports) {
  const label = report.kind === "source" ? "source posture" : `${report.profile} artifact`;
  console.log(`${report.passed ? "PASS" : "FAIL"} ${label}`);
  for (const warning of report.warnings ?? []) {
    console.log(`  WARN ${warning.code}: ${warning.message}`);
  }
  for (const item of report.findings) {
    console.log(`  ${item.severity === "warning" ? "WARN" : "ERROR"} ${item.code}: ${item.message}`);
  }
}

const envelope = {
  schemaVersion: 1,
  policyID: policy.policyID,
  generatedAt: new Date().toISOString(),
  passed: reports.every((report) => report.passed),
  reports,
};
if (jsonOutput) {
  const outputPath = path.resolve(jsonOutput);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(outputPath, 0o600);
  console.log(`Report: ${outputPath}`);
}

process.exit(envelope.passed ? 0 : 1);
