import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import type { ProposedFileChange } from "../types.js";

type UnifiedDiffOperation = Extract<
  NonNullable<ProposedFileChange["applyOperation"]>,
  { kind: "UnifiedDiff" }
>;

export interface UnifiedDiffLimits {
  maxHunks: number;
  maxChars: number;
}

const defaultLimits: UnifiedDiffLimits = { maxHunks: 16, maxChars: 60_000 };

export type UnifiedDiffLine = { kind: "Context" | "Add" | "Delete"; text: string };

export type UnifiedDiffHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: UnifiedDiffLine[];
};

export interface ParsedUnifiedDiff {
  oldPath: string;
  newPath: string;
  hunks: UnifiedDiffHunk[];
  oldNoNewline: boolean;
  newNoNewline: boolean;
  hasNewlineMarker: boolean;
}

export function validateUnifiedDiffOperation(
  operation: UnifiedDiffOperation,
  currentContent: string,
  relativePath: string,
  checks?: string[],
  limits: UnifiedDiffLimits = defaultLimits
): string {
  if (operation.patch.length === 0) {
    throw new HttpError(409, `UnifiedDiff patch is empty: ${relativePath}`);
  }

  if (operation.patch.length > limits.maxChars) {
    throw new HttpError(409, `UnifiedDiff patch is too large for restricted apply: ${relativePath}`);
  }
  checks?.push("Unified diff size is within the restricted apply limit.");

  const { oldPath, newPath, hunks, oldNoNewline, newNoNewline, hasNewlineMarker } =
    parseUnifiedDiff(operation.patch, relativePath);
  if (oldPath !== relativePath || newPath !== relativePath) {
    throw new HttpError(
      409,
      `UnifiedDiff headers must both target ${relativePath}; received ${oldPath} and ${newPath}.`
    );
  }
  checks?.push("Unified diff headers match the proposed file path.");

  if (hunks.length === 0) {
    throw new HttpError(409, `UnifiedDiff requires at least one hunk: ${relativePath}`);
  }

  if (hunks.length > limits.maxHunks) {
    throw new HttpError(409, `UnifiedDiff has too many hunks for restricted apply: ${relativePath}`);
  }
  checks?.push(`Unified diff hunk count is within the limit (${hunks.length}/${limits.maxHunks}).`);

  const lineEnding = currentContent.includes("\r\n") ? "\r\n" : "\n";
  const normalizedContent = lineEnding === "\r\n" ? currentContent.replaceAll("\r\n", "\n") : currentContent;
  const trailingNewline = normalizedContent.endsWith("\n");
  if (oldNoNewline && trailingNewline) {
    throw new HttpError(409, `UnifiedDiff old-side no-newline marker does not match current file: ${relativePath}`);
  }
  const sourceLines = normalizedContent.length === 0 ? [] : normalizedContent.split("\n");
  if (trailingNewline && sourceLines.length > 0) sourceLines.pop();

  const outputLines: string[] = [];
  let sourceCursor = 0;
  for (const [hunkIndex, hunk] of hunks.entries()) {
    const sourceStart = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    const outputStart = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
    if (sourceStart < sourceCursor || sourceStart > sourceLines.length) {
      throw new HttpError(409, `UnifiedDiff hunk ${hunkIndex + 1} has an invalid or overlapping old range: ${relativePath}`);
    }

    outputLines.push(...sourceLines.slice(sourceCursor, sourceStart));
    if (outputLines.length !== outputStart) {
      throw new HttpError(409, `UnifiedDiff hunk ${hunkIndex + 1} new range does not follow prior hunks: ${relativePath}`);
    }

    let hunkSourceCursor = sourceStart;
    for (const line of hunk.lines) {
      if (line.kind === "Add") {
        outputLines.push(line.text);
        continue;
      }

      const currentLine = sourceLines[hunkSourceCursor];
      if (currentLine !== line.text) {
        throw new HttpError(
          409,
          `UnifiedDiff hunk ${hunkIndex + 1} context mismatch at source line ${hunkSourceCursor + 1}: ${relativePath}`
        );
      }

      if (line.kind === "Context") outputLines.push(currentLine);
      hunkSourceCursor += 1;
    }
    sourceCursor = hunkSourceCursor;
  }

  outputLines.push(...sourceLines.slice(sourceCursor));
  checks?.push("Every unified diff context and deletion line matches the current file at its declared range.");
  const nextTrailingNewline = hasNewlineMarker ? !newNoNewline : trailingNewline;
  checks?.push(hasNewlineMarker
    ? "Unified diff no-newline markers were validated and applied."
    : "Unified diff preserves the target file's existing trailing-newline state.");
  const normalizedNextContent = `${outputLines.join("\n")}${nextTrailingNewline ? "\n" : ""}`;
  return lineEnding === "\r\n" ? normalizedNextContent.replaceAll("\n", "\r\n") : normalizedNextContent;
}

export function parseUnifiedDiff(patchText: string, relativePath: string): ParsedUnifiedDiff {
  const lines = patchText.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();

  if (!lines[0]?.startsWith("--- ") || !lines[1]?.startsWith("+++ ")) {
    throw new HttpError(409, `UnifiedDiff requires --- and +++ file headers: ${relativePath}`);
  }

  const oldPath = normalizeUnifiedDiffHeaderPath(lines[0].slice(4), relativePath);
  const newPath = normalizeUnifiedDiffHeaderPath(lines[1].slice(4), relativePath);
  const hunks: UnifiedDiffHunk[] = [];
  let oldNoNewline = false;
  let newNoNewline = false;
  let hasNewlineMarker = false;
  let index = 2;
  while (index < lines.length) {
    const header = lines[index];
    if (!header) {
      index += 1;
      continue;
    }

    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(header);
    if (!match) {
      throw new HttpError(409, `UnifiedDiff contains unsupported content outside a hunk: ${relativePath}`);
    }

    const oldStart = Number(match[1]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);
    index += 1;
    const hunkLines: UnifiedDiffLine[] = [];
    while (index < lines.length && !lines[index].startsWith("@@ ")) {
      const line = lines[index];
      if (line === "\\ No newline at end of file") {
        const previous = hunkLines.at(-1);
        if (!previous) {
          throw new HttpError(409, `UnifiedDiff no-newline marker has no preceding hunk line: ${relativePath}`);
        }
        hasNewlineMarker = true;
        if (previous.kind !== "Add") oldNoNewline = true;
        if (previous.kind !== "Delete") newNoNewline = true;
        index += 1;
        continue;
      }

      const prefix = line[0];
      if (prefix !== " " && prefix !== "+" && prefix !== "-") {
        throw new HttpError(409, `UnifiedDiff hunk contains an invalid line prefix: ${relativePath}`);
      }

      hunkLines.push({
        kind: prefix === " " ? "Context" : prefix === "+" ? "Add" : "Delete",
        text: line.slice(1)
      });
      index += 1;
    }

    const actualOldCount = hunkLines.filter((line) => line.kind !== "Add").length;
    const actualNewCount = hunkLines.filter((line) => line.kind !== "Delete").length;
    if (actualOldCount !== oldCount || actualNewCount !== newCount) {
      throw new HttpError(
        409,
        `UnifiedDiff hunk line counts do not match its header (${actualOldCount}/${oldCount} old, ${actualNewCount}/${newCount} new): ${relativePath}`
      );
    }

    if (hunkLines.length === 0) {
      throw new HttpError(409, `UnifiedDiff hunk is empty: ${relativePath}`);
    }
    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }

  return { oldPath, newPath, hunks, oldNoNewline, newNoNewline, hasNewlineMarker };
}

export function normalizeUnifiedDiffHeaderPath(value: string, relativePath: string): string {
  const rawPath = value.split("\t", 1)[0].trim();
  if (rawPath === "/dev/null") {
    throw new HttpError(409, `UnifiedDiff cannot create or delete files: ${relativePath}`);
  }

  const withoutPrefix = rawPath.startsWith("a/") || rawPath.startsWith("b/") ? rawPath.slice(2) : rawPath;
  const normalized = path.posix.normalize(withoutPrefix.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw new HttpError(409, `UnifiedDiff contains an unsafe file header: ${relativePath}`);
  }
  return normalized;
}
