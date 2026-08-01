#!/usr/bin/env node
import assert from "node:assert/strict";

import { countTextOccurrences, validatePatchTextOperation } from "../dist/edits/textOperations.js";

assert.equal(countTextOccurrences("one two one", "one"), 2);
assert.equal(countTextOccurrences("aaaa", "aa"), 2);
assert.equal(countTextOccurrences("text", ""), 0);
assert.equal(countTextOccurrences("text", "missing"), 0);

const checks = [];
const result = validatePatchTextOperation({
  kind: "PatchText",
  hunks: [
    { findText: "const one = 1;", replaceWith: "const one = 11;" },
    { findText: "const two = 2;", replaceWith: "const two = 22;" }
  ]
}, "const one = 1;\nconst two = 2;\n", "example.ts", checks);
assert.equal(result, "const one = 11;\nconst two = 22;\n");
assert.equal(checks.length, 4);

assert.throws(
  () => validatePatchTextOperation({ kind: "PatchText", hunks: [] }, "", "example.ts"),
  /at least one hunk/
);
assert.throws(
  () => validatePatchTextOperation({
    kind: "PatchText",
    hunks: [{ findText: "same", replaceWith: "same" }]
  }, "same", "example.ts"),
  /identical/
);
assert.throws(
  () => validatePatchTextOperation({
    kind: "PatchText",
    hunks: [{ findText: "repeat", replaceWith: "changed" }]
  }, "repeat repeat", "example.ts"),
  /appears 2 times/
);
assert.throws(
  () => validatePatchTextOperation({
    kind: "PatchText",
    hunks: [
      { findText: "one", replaceWith: "two" },
      { findText: "one", replaceWith: "three" }
    ]
  }, "one", "example.ts"),
  /duplicates an earlier/
);
assert.throws(
  () => validatePatchTextOperation({
    kind: "PatchText",
    hunks: [{ findText: "missing", replaceWith: "new" }]
  }, "one", "example.ts"),
  /was not found/
);

console.log("Text operations test passed: 11 assertions.");
