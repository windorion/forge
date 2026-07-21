import { repositoryInspectionSubsumedBy } from "../dist/inspectionGuard.js";
import assert from "node:assert";

let passed = 0;
function check(name, actual, expected) {
  assert.strictEqual(actual, expected, `${name}: expected ${expected}, got ${actual}`);
  passed++;
}

const prior = [{ id: "s1", searchMode: "Text", searchTerms: ["rate", "limit"], readPaths: ["api/routes.ts"] }];

// exact same terms (reordered) + same path → subsumed
check("reordered terms subsumed",
  repositoryInspectionSubsumedBy({ searchMode: "Text", searchTerms: ["limit", "rate"], readPaths: ["api/routes.ts"] }, prior), "s1");
// strict subset of terms, no paths → subsumed
check("subset terms subsumed",
  repositoryInspectionSubsumedBy({ searchMode: "Text", searchTerms: ["rate"], readPaths: [] }, prior), "s1");
// case-insensitive → subsumed
check("case-folded subsumed",
  repositoryInspectionSubsumedBy({ searchMode: "Text", searchTerms: ["RATE", "Limit"], readPaths: ["API/ROUTES.TS"] }, prior), "s1");
// adds a new term → NOT subsumed
check("new term not subsumed",
  repositoryInspectionSubsumedBy({ searchMode: "Text", searchTerms: ["rate", "limit", "burst"], readPaths: [] }, prior), undefined);
// adds a new read path → NOT subsumed
check("new path not subsumed",
  repositoryInspectionSubsumedBy({ searchMode: "Text", searchTerms: ["rate"], readPaths: ["api/other.ts"] }, prior), undefined);
// different search mode → NOT subsumed
check("different mode not subsumed",
  repositoryInspectionSubsumedBy({ searchMode: "Symbol", searchTerms: ["rate"], readPaths: [] }, prior), undefined);
// empty request → never subsumed
check("empty not subsumed",
  repositoryInspectionSubsumedBy({ searchMode: "Text", searchTerms: [], readPaths: [] }, prior), undefined);
// no prior → not subsumed
check("no prior not subsumed",
  repositoryInspectionSubsumedBy({ searchMode: "Text", searchTerms: ["rate"], readPaths: [] }, []), undefined);
// whitespace-only terms ignored → empty → not subsumed
check("whitespace terms ignored",
  repositoryInspectionSubsumedBy({ searchMode: "Text", searchTerms: ["  ", ""], readPaths: [] }, prior), undefined);

console.log(`Inspection guard test passed: ${passed} assertions.`);
