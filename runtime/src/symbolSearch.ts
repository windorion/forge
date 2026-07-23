// Index-backed symbol search glue: turns durable symbol-index lookups into
// repository-inspection matches, and merges two match lists. Pure and
// dependency-injected (the symbol lookup is passed in) so it is unit-testable
// without a live SQLite store or ripgrep.

export interface RepositorySearchMatch {
  path: string;
  score: number;
  reasons: string[];
  matchedLines: string[];
}

export interface LookedUpSymbol {
  path: string;
  kind: string;
  name: string;
  line: number;
}

export type SymbolLookup = (term: string, limit: number) => LookedUpSymbol[];

/**
 * Build repository-inspection matches for each search term from the durable
 * symbol index, restricted to the safe bounded file set (`allowedFiles`).
 * Each match points at the exact `kind name` declaration line. Symbols whose
 * file is outside the allowed set are ignored, so the read-only file safety of
 * the inspection step is preserved.
 */
export function symbolIndexMatches(
  searchTerms: string[],
  allowedFiles: string[],
  explicitPaths: string[],
  lookup: SymbolLookup,
  maxFiles: number
): RepositorySearchMatch[] {
  if (searchTerms.length === 0) {
    return [];
  }
  const allowed = new Set(allowedFiles);
  const explicitSet = new Set(explicitPaths);
  const byPath = new Map<string, RepositorySearchMatch>();
  const ensure = (file: string): RepositorySearchMatch => {
    let match = byPath.get(file);
    if (!match) {
      match = { path: file, score: 0, reasons: [], matchedLines: [] };
      byPath.set(file, match);
    }
    return match;
  };
  for (const term of searchTerms) {
    for (const symbol of lookup(term, 20)) {
      if (!allowed.has(symbol.path)) {
        continue;
      }
      const match = ensure(symbol.path);
      match.score += 18;
      const reason = `declares ${symbol.kind} ${symbol.name} (symbol index)`;
      if (!match.reasons.includes(reason)) {
        match.reasons.push(reason);
      }
      if (match.matchedLines.length < 4) {
        match.matchedLines.push(`${symbol.line}: ${symbol.kind} ${symbol.name}`);
      }
    }
  }
  for (const match of byPath.values()) {
    if (explicitSet.has(match.path)) {
      match.score += 100;
      match.reasons.unshift("explicitly referenced by task conversation");
    }
  }
  return [...byPath.values()]
    .filter((match) => match.score > 0)
    .map((match) => ({ ...match, reasons: match.reasons.slice(0, 4), matchedLines: match.matchedLines.slice(0, 3) }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, maxFiles);
}

/** Union two match lists by path, summing scores and combining reasons/lines. */
export function mergeRepositoryMatches(
  primary: RepositorySearchMatch[],
  secondary: RepositorySearchMatch[],
  cap: number
): RepositorySearchMatch[] {
  const byPath = new Map<string, RepositorySearchMatch>();
  for (const source of [primary, secondary]) {
    for (const match of source) {
      const existing = byPath.get(match.path);
      if (!existing) {
        byPath.set(match.path, {
          path: match.path,
          score: match.score,
          reasons: [...match.reasons],
          matchedLines: [...match.matchedLines]
        });
        continue;
      }
      existing.score += match.score;
      for (const reason of match.reasons) {
        if (!existing.reasons.includes(reason)) {
          existing.reasons.push(reason);
        }
      }
      for (const line of match.matchedLines) {
        if (!existing.matchedLines.includes(line)) {
          existing.matchedLines.push(line);
        }
      }
    }
  }
  return [...byPath.values()]
    .map((match) => ({ ...match, reasons: match.reasons.slice(0, 4), matchedLines: match.matchedLines.slice(0, 3) }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, cap);
}
