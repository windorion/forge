#!/usr/bin/env node
import assert from "node:assert/strict";

import { HttpError } from "../dist/http/httpError.js";
import {
  normalizeUnifiedDiffHeaderPath,
  parseUnifiedDiff,
  validateUnifiedDiffOperation
} from "../dist/edits/unifiedDiff.js";

const patch = [
  "--- a/runtime/src/example.ts",
  "+++ b/runtime/src/example.ts",
  "@@ -1,3 +1,3 @@",
  " export const one = 1;",
  "-export const two = 2;",
  "+export const two = 22;",
  " export const three = 3;"
].join("\n");
const current = "export const one = 1;\nexport const two = 2;\nexport const three = 3;\n";
const checks = [];
const next = validateUnifiedDiffOperation(
  { kind: "UnifiedDiff", patch },
  current,
  "runtime/src/example.ts",
  checks
);
assert.equal(next, "export const one = 1;\nexport const two = 22;\nexport const three = 3;\n");
assert.equal(checks.length, 5);

const parsed = parseUnifiedDiff(patch, "runtime/src/example.ts");
assert.equal(parsed.oldPath, "runtime/src/example.ts");
assert.equal(parsed.newPath, "runtime/src/example.ts");
assert.equal(parsed.hunks.length, 1);
assert.equal(parsed.hunks[0].oldCount, 3);
assert.equal(parsed.hunks[0].newCount, 3);

const crlfNext = validateUnifiedDiffOperation(
  { kind: "UnifiedDiff", patch },
  current.replaceAll("\n", "\r\n"),
  "runtime/src/example.ts"
);
assert.ok(crlfNext.includes("22;\r\n"));
assert.equal(crlfNext.includes("22;\nexport"), false);

const noNewlinePatch = [
  "--- note.txt",
  "+++ note.txt",
  "@@ -1 +1 @@",
  "-before",
  "\\ No newline at end of file",
  "+after",
  "\\ No newline at end of file"
].join("\n");
assert.equal(
  validateUnifiedDiffOperation({ kind: "UnifiedDiff", patch: noNewlinePatch }, "before", "note.txt"),
  "after"
);

assert.equal(normalizeUnifiedDiffHeaderPath("a/docs/note.md\tstamp", "docs/note.md"), "docs/note.md");
assert.throws(() => normalizeUnifiedDiffHeaderPath("/dev/null", "note.txt"), HttpError);
assert.throws(() => normalizeUnifiedDiffHeaderPath("../../secret", "note.txt"), /unsafe file header/);
assert.throws(
  () => validateUnifiedDiffOperation({ kind: "UnifiedDiff", patch }, current, "wrong.ts"),
  /headers must both target/
);
assert.throws(
  () => validateUnifiedDiffOperation({ kind: "UnifiedDiff", patch }, current.replace("two = 2", "two = 9"), "runtime/src/example.ts"),
  /context mismatch/
);
assert.throws(
  () => parseUnifiedDiff("--- note.txt\n+++ note.txt\n@@ -1 +1,2 @@\n-old\n+new", "note.txt"),
  /line counts do not match/
);
assert.throws(
  () => validateUnifiedDiffOperation({ kind: "UnifiedDiff", patch }, current, "runtime/src/example.ts", undefined, { maxHunks: 0, maxChars: 60_000 }),
  /too many hunks/
);
assert.throws(
  () => validateUnifiedDiffOperation({ kind: "UnifiedDiff", patch }, current, "runtime/src/example.ts", undefined, { maxHunks: 16, maxChars: 10 }),
  /too large/
);

console.log("Unified diff test passed: 18 assertions.");
