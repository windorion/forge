// Lightweight, dependency-free trigram extraction for a durable text index.
// A file's distinct case-folded 3-grams form an inverted index (trigram → file);
// a search term's trigrams are a subset of any file that contains it, so the
// index yields a candidate set that a real scan then verifies. Pure and
// unit-testable. This is a candidate filter, never a match oracle — trigrams
// can appear scattered, so the caller must verify candidates against content.

export const maxTrigramsPerFile = 4000;
export const maxTrigramsPerTerm = 30;
export const minTrigramTermLength = 3;

/**
 * Distinct, case-folded, within-line trigrams of a file's content, capped at
 * maxTrigramsPerFile. Trigrams never span a newline (a single-line search term
 * cannot either), which keeps the postings useful and bounded.
 */
export function extractTrigrams(content: string, cap: number = maxTrigramsPerFile): string[] {
  if (content.length < minTrigramTermLength) {
    return [];
  }
  const seen = new Set<string>();
  for (const line of content.toLowerCase().split("\n")) {
    for (let i = 0; i + minTrigramTermLength <= line.length; i += 1) {
      seen.add(line.slice(i, i + minTrigramTermLength));
      if (seen.size >= cap) {
        return [...seen];
      }
    }
  }
  return [...seen];
}

/**
 * Distinct, case-folded trigrams of a search term, capped at maxTrigramsPerTerm.
 * Returns [] for terms shorter than a trigram (they cannot be indexed and the
 * caller must fall back to a full scan). Using a capped subset only ever adds
 * false-positive candidates (removed by verification), never false negatives.
 */
export function termTrigrams(term: string): string[] {
  const normalized = term.toLowerCase();
  if (normalized.length < minTrigramTermLength) {
    return [];
  }
  const seen = new Set<string>();
  for (let i = 0; i + minTrigramTermLength <= normalized.length; i += 1) {
    seen.add(normalized.slice(i, i + minTrigramTermLength));
    if (seen.size >= maxTrigramsPerTerm) {
      break;
    }
  }
  return [...seen];
}
