// Index-backed text search glue: turns durable trigram-index lookups into a
// narrowed candidate file set for the agent's Text inspection. Pure and
// dependency-injected (the trigram lookup is passed in) so it is unit-testable
// without a live SQLite store.

import { termTrigrams } from "./textIndex.js";

export interface TextIndexCandidates {
  /**
   * True when every search term could be resolved through the index (all terms
   * are at least a trigram long). When false, the caller must scan the full
   * file set — the index cannot safely narrow, because a sub-trigram term has
   * no postings and would be dropped (a false negative).
   */
  usable: boolean;
  /** Candidate file paths (subset of allowedFiles) that may contain a term. */
  candidates: string[];
}

/**
 * Resolve the candidate file set for a Text search from the trigram index,
 * restricted to the safe bounded file set (`allowedFiles`). A file is a
 * candidate if it may contain ANY term (Text search is OR across terms). The
 * result is a superset of the files that actually contain a term, so a real
 * scan over the candidates loses no true matches (given the index covers the
 * allowed files); verification removes the false positives.
 */
export function textIndexCandidates(
  searchTerms: string[],
  allowedFiles: string[],
  lookup: (trigrams: string[]) => string[]
): TextIndexCandidates {
  if (searchTerms.length === 0) {
    return { usable: true, candidates: [] };
  }
  const allowed = new Set(allowedFiles);
  const candidates = new Set<string>();
  for (const term of searchTerms) {
    const trigrams = termTrigrams(term);
    if (trigrams.length === 0) {
      // Term too short to index — cannot narrow without risking a false negative.
      return { usable: false, candidates: [] };
    }
    for (const path of lookup(trigrams)) {
      if (allowed.has(path)) {
        candidates.add(path);
      }
    }
  }
  return { usable: true, candidates: [...candidates] };
}
