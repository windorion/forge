// Pure repository-inspection redundancy guards, isolated so they can be unit
// tested without starting the runtime server. These only prevent redundant
// read-only work — they never relax an approval gate.

export type InspectionRequestShape = {
  searchMode: "Text" | "Symbol";
  searchTerms: string[];
  readPaths: string[];
};

export type PriorInspection = {
  id: string;
  searchMode: "Text" | "Symbol";
  searchTerms: string[];
  readPaths: string[];
};

/** Order-insensitive, case-folded set view of an inspection request. */
export function inspectionRequestSets(request: InspectionRequestShape): {
  terms: Set<string>;
  paths: Set<string>;
} {
  return {
    terms: new Set(request.searchTerms.map((term) => term.trim().toLowerCase()).filter(Boolean)),
    paths: new Set(request.readPaths.map((path) => path.trim().toLowerCase()).filter(Boolean))
  };
}

export function isSubset(candidate: Set<string>, cover: Set<string>): boolean {
  for (const item of candidate) {
    if (!cover.has(item)) {
      return false;
    }
  }
  return true;
}

/**
 * Returns the id of a prior inspection that already covers this request's
 * terms and read paths (same search mode), or undefined. A request that adds
 * no new term or path relative to a superset inspection produces nothing new,
 * so it is safe to block before spending search/read tools. A request that
 * adds any term or path is never subsumed (it may surface new context). A
 * fully empty request is never subsumed (handled elsewhere).
 */
export function repositoryInspectionSubsumedBy(
  request: InspectionRequestShape,
  priorSteps: PriorInspection[]
): string | undefined {
  const current = inspectionRequestSets(request);
  if (current.terms.size === 0 && current.paths.size === 0) {
    return undefined;
  }
  for (const prior of priorSteps) {
    if (prior.searchMode !== request.searchMode) {
      continue;
    }
    const priorSets = inspectionRequestSets(prior);
    if (isSubset(current.terms, priorSets.terms) && isSubset(current.paths, priorSets.paths)) {
      return prior.id;
    }
  }
  return undefined;
}
