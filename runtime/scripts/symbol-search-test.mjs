#!/usr/bin/env node
// Pure unit test for the index-backed symbol-search glue.
import { symbolIndexMatches, mergeRepositoryMatches } from "../dist/symbolSearch.js";

let count = 0;
function assert(condition, message) {
  count += 1;
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// A fake durable-index lookup keyed by term substring (case-insensitive).
const catalog = [
  { path: "src/todos.js", kind: "function", name: "addTodo", line: 1 },
  { path: "src/todos.js", kind: "function", name: "removeTodo", line: 8 },
  { path: "src/view.swift", kind: "struct", name: "TodoView", line: 3 },
  { path: "vendor/lib.js", kind: "function", name: "addTodo", line: 42 } // outside allowed set
];
const lookup = (term, limit) =>
  catalog.filter((s) => s.name.toLowerCase().includes(term.toLowerCase())).slice(0, limit);

const allowed = ["src/todos.js", "src/view.swift"]; // vendor/lib.js intentionally excluded

// 1. Declaration sites are surfaced with exact kind/name/line.
const hits = symbolIndexMatches(["addTodo"], allowed, [], lookup, 6);
assert(hits.length === 1, `expected 1 file for addTodo, got ${hits.length}`);
assert(hits[0].path === "src/todos.js", `expected src/todos.js, got ${hits[0].path}`);
assert(hits[0].matchedLines.some((l) => l === "1: function addTodo"), `expected declaration line, got ${JSON.stringify(hits[0].matchedLines)}`);
assert(hits[0].reasons.some((r) => r === "declares function addTodo (symbol index)"), `expected declaration reason, got ${JSON.stringify(hits[0].reasons)}`);

// 2. Symbols outside the allowed file set are ignored (read-safety preserved).
assert(!hits.some((m) => m.path === "vendor/lib.js"), "vendor/lib.js must be excluded from allowed set");

// 3. Multiple terms accumulate across files; scoring orders results.
const multi = symbolIndexMatches(["Todo"], allowed, [], lookup, 6);
assert(multi.length === 2, `expected 2 files for Todo, got ${multi.length}`);
const todosFile = multi.find((m) => m.path === "src/todos.js");
assert(todosFile.matchedLines.length >= 2, "src/todos.js should carry both addTodo and removeTodo");
assert(todosFile.score > multi.find((m) => m.path === "src/view.swift").score, "file with more symbol hits should score higher");

// 4. Explicitly referenced paths get a large confidence boost.
const withExplicit = symbolIndexMatches(["TodoView"], allowed, ["src/view.swift"], lookup, 6);
assert(withExplicit[0].path === "src/view.swift", "explicit path should be present");
assert(withExplicit[0].score >= 118, `explicit boost expected (>=118), got ${withExplicit[0].score}`);
assert(withExplicit[0].reasons[0] === "explicitly referenced by task conversation", "explicit reason should lead");

// 5. Empty terms yield nothing.
assert(symbolIndexMatches([], allowed, [], lookup, 6).length === 0, "no terms → no matches");

// 6. mergeRepositoryMatches unions by path, sums scores, dedups reasons/lines.
const primary = [
  { path: "src/todos.js", score: 18, reasons: ["declares function addTodo (symbol index)"], matchedLines: ["1: function addTodo"] }
];
const secondary = [
  { path: "src/todos.js", score: 6, reasons: ["whole-symbol match"], matchedLines: ["1: function addTodo", "8: function removeTodo"] },
  { path: "src/other.js", score: 4, reasons: ["fixed-text match"], matchedLines: ["3: usage"] }
];
const merged = mergeRepositoryMatches(primary, secondary, 12);
const mergedTodos = merged.find((m) => m.path === "src/todos.js");
assert(mergedTodos.score === 24, `expected summed score 24, got ${mergedTodos.score}`);
assert(mergedTodos.reasons.length === 2, `expected 2 deduped reasons, got ${mergedTodos.reasons.length}`);
assert(mergedTodos.matchedLines.filter((l) => l === "1: function addTodo").length === 1, "duplicate matched line should be deduped");
assert(merged[0].path === "src/todos.js", "higher score should sort first");

// 7. Merge respects the cap.
const many = Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.js`, score: 20 - i, reasons: [], matchedLines: [] }));
assert(mergeRepositoryMatches(many, [], 12).length === 12, "merge cap should limit to 12");

console.log(`Symbol search test passed: ${count} assertions.`);
