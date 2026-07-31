#!/usr/bin/env node
// Pure unit test for durable trigram extraction and index-backed text candidates.
import { extractTrigrams, termTrigrams, maxTrigramsPerTerm } from "../dist/textIndex.js";
import { textIndexCandidates } from "../dist/textSearch.js";

let count = 0;
function assert(condition, message) {
  count += 1;
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// 1. extractTrigrams: distinct, case-folded, within-line.
const tris = extractTrigrams("Auth\nauth");
assert(tris.includes("aut") && tris.includes("uth"), `expected aut/uth, got ${JSON.stringify(tris)}`);
assert(new Set(tris).size === tris.length, "trigrams must be distinct");
assert(!tris.some((t) => t.includes("\n")), "trigrams must not span newlines");
// "Auth" and "auth" fold to the same two trigrams.
assert(tris.length === 2, `expected 2 distinct trigrams, got ${tris.length}`);

// 2. Short content yields nothing.
assert(extractTrigrams("ab").length === 0, "content shorter than a trigram → none");

// 3. Per-file cap is honored.
const big = "abcdefghijklmnopqrstuvwxyz".repeat(50);
assert(extractTrigrams(big, 10).length === 10, "extractTrigrams must honor the cap");

// 4. termTrigrams: [] for sub-trigram terms, correct otherwise.
assert(termTrigrams("ab").length === 0, "2-char term → no trigrams");
assert(JSON.stringify(termTrigrams("auth")) === JSON.stringify(["aut", "uth"]), `unexpected term trigrams: ${JSON.stringify(termTrigrams("auth"))}`);
const longTerm = "a".repeat(200);
assert(termTrigrams(longTerm).length <= maxTrigramsPerTerm, "term trigrams must honor the cap");
const variedLongTerm = Array.from({ length: 100 }, (_, index) => String.fromCodePoint(0x100 + index)).join("");
assert(termTrigrams(variedLongTerm).length === maxTrigramsPerTerm, "distinct long term should stop exactly at the term cap");

// A fake inverted index: trigram -> files containing it.
const postings = {
  aut: ["src/auth.ts", "src/user.ts"],
  uth: ["src/auth.ts"],
  ser: ["src/user.ts", "vendor/lib.ts"],
  vic: ["src/service.ts"]
};
// Lookup returns files containing ALL provided trigrams (intersection).
const lookup = (trigrams) => {
  let acc = null;
  for (const t of trigrams) {
    const files = new Set(postings[t] ?? []);
    acc = acc === null ? files : new Set([...acc].filter((f) => files.has(f)));
  }
  return acc ? [...acc] : [];
};
const allowed = ["src/auth.ts", "src/user.ts", "src/service.ts"]; // vendor/lib.ts excluded

// 5. Candidate = files containing all trigrams of the term, within allowed set.
const authRes = textIndexCandidates(["auth"], allowed, lookup);
assert(authRes.usable === true, "auth should be usable");
assert(authRes.candidates.length === 1 && authRes.candidates[0] === "src/auth.ts", `auth → src/auth.ts, got ${JSON.stringify(authRes.candidates)}`);

// 6. OR across terms: union of per-term candidates.
const multi = textIndexCandidates(["auth", "ser"], allowed, lookup);
assert(multi.usable === true, "multi usable");
assert(multi.candidates.includes("src/auth.ts") && multi.candidates.includes("src/user.ts"), `union expected, got ${JSON.stringify(multi.candidates)}`);
assert(!multi.candidates.includes("vendor/lib.ts"), "candidates outside allowed set must be excluded");

// 7. A sub-trigram term makes narrowing unusable (avoids a false negative).
const short = textIndexCandidates(["auth", "io"], allowed, lookup);
assert(short.usable === false, "a <3-char term must make the result unusable");
assert(short.candidates.length === 0, "unusable result carries no candidates");

// 8. Empty terms are trivially usable with no candidates.
const none = textIndexCandidates([], allowed, lookup);
assert(none.usable === true && none.candidates.length === 0, "empty terms → usable, empty");

// 9. A term with no postings yields an empty (but usable) candidate set —
//    meaning the term is absent from every indexed file.
const absent = textIndexCandidates(["zzz"], allowed, lookup);
assert(absent.usable === true && absent.candidates.length === 0, "absent term → usable, empty candidates");

console.log(`Text search test passed: ${count} assertions.`);
