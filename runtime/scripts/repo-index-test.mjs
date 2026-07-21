import { classifyLanguage, fileMetadata, summarizeIndex } from "../dist/repositoryIndex.js";
import assert from "node:assert";
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };

// classifyLanguage
ok(classifyLanguage("src/server.ts") === "TypeScript", "ts");
ok(classifyLanguage("App.swift") === "Swift", "swift");
ok(classifyLanguage("main.py") === "Python", "py");
ok(classifyLanguage("README.md") === "Markdown", "md");
ok(classifyLanguage("Makefile") === "Other", "no-ext → Other");
ok(classifyLanguage("weird.xyz") === "Other", "unknown ext → Other");
ok(classifyLanguage("UPPER.TS") === "TypeScript", "case-insensitive ext");

// fileMetadata: deterministic hash, line count, byte size
const a = fileMetadata("a.ts", "line1\nline2\nline3", "2026-01-01T00:00:00Z");
ok(a.lineCount === 3 && a.byteSize === 17 && a.language === "TypeScript", "metadata basic");
const a2 = fileMetadata("a.ts", "line1\nline2\nline3", "2026-01-02T00:00:00Z");
ok(a.contentHash === a2.contentHash, "hash is content-only (time-independent)");
const b = fileMetadata("a.ts", "line1\nline2\nCHANGED", "2026-01-01T00:00:00Z");
ok(a.contentHash !== b.contentHash, "changed content → different hash");
const empty = fileMetadata("e.ts", "", "2026-01-01T00:00:00Z");
ok(empty.lineCount === 0 && empty.byteSize === 0, "empty file → 0 lines/bytes");

// summarizeIndex: counts, language distribution sorted, totals
const files = [
  fileMetadata("a.ts", "x", "t"), fileMetadata("b.ts", "y", "t"),
  fileMetadata("c.swift", "z", "t"), fileMetadata("d.md", "w", "t")
];
const s = summarizeIndex(files, "2026-01-01T00:00:00Z", true);
ok(s.fileCount === 4 && s.totalBytes === 4, "summary counts");
ok(s.languages[0].language === "TypeScript" && s.languages[0].files === 2, "top language by count");
ok(s.inSync === true && s.lastIndexedAt === "2026-01-01T00:00:00Z", "summary meta");
const emptyS = summarizeIndex([], null, false);
ok(emptyS.fileCount === 0 && emptyS.inSync === false && emptyS.lastIndexedAt === null, "empty summary");

console.log(`Repo index pure test passed: ${passed} assertions.`);
