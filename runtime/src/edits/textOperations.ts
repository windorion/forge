import { HttpError } from "../runtime/runtimeError.js";
import type { ProposedFileChange } from "../types.js";

export const EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS = 10_000;
export const EDIT_PROPOSAL_PATCH_MAX_HUNKS = 8;
export const EDIT_PROPOSAL_PATCH_MAX_TOTAL_CHARS = 40_000;

type PatchTextOperation = Extract<
  NonNullable<ProposedFileChange["applyOperation"]>,
  { kind: "PatchText" }
>;

export function countTextOccurrences(content: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

export function validatePatchTextOperation(
  operation: PatchTextOperation,
  currentContent: string,
  relativePath: string,
  checks?: string[]
): string {
  if (operation.hunks.length === 0) {
    throw new HttpError(409, `PatchText requires at least one hunk: ${relativePath}`);
  }
  if (operation.hunks.length > EDIT_PROPOSAL_PATCH_MAX_HUNKS) {
    throw new HttpError(409, `PatchText has too many hunks for v0 apply: ${relativePath}`);
  }
  checks?.push(
    `Patch hunk count is within the v0 limit (${operation.hunks.length}/${EDIT_PROPOSAL_PATCH_MAX_HUNKS}).`
  );

  const seenFindTexts = new Set<string>();
  const totalChars = operation.hunks.reduce(
    (total, hunk) => total + hunk.findText.length + hunk.replaceWith.length,
    0
  );
  if (totalChars > EDIT_PROPOSAL_PATCH_MAX_TOTAL_CHARS) {
    throw new HttpError(409, `PatchText operation is too large for v0 apply: ${relativePath}`);
  }
  checks?.push("Patch total text size is within the v0 limit.");

  for (const [index, hunk] of operation.hunks.entries()) {
    const hunkLabel = `Patch hunk ${index + 1}`;
    if (hunk.findText.length === 0) {
      throw new HttpError(409, `${hunkLabel} find text is empty: ${relativePath}`);
    }
    if (hunk.replaceWith.length === 0) {
      throw new HttpError(409, `${hunkLabel} replacement text is empty: ${relativePath}`);
    }
    if (
      hunk.findText.length > EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS ||
      hunk.replaceWith.length > EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS
    ) {
      throw new HttpError(409, `${hunkLabel} is too large for v0 apply: ${relativePath}`);
    }
    if (hunk.findText === hunk.replaceWith) {
      throw new HttpError(409, `${hunkLabel} find text and replacement text are identical: ${relativePath}`);
    }
    if (seenFindTexts.has(hunk.findText)) {
      throw new HttpError(409, `${hunkLabel} duplicates an earlier find text: ${relativePath}`);
    }
    seenFindTexts.add(hunk.findText);

    const originalOccurrenceCount = countTextOccurrences(currentContent, hunk.findText);
    if (originalOccurrenceCount === 0) {
      throw new HttpError(409, `${hunkLabel} find text was not found in ${relativePath}.`);
    }
    if (originalOccurrenceCount > 1) {
      throw new HttpError(
        409,
        `${hunkLabel} find text appears ${originalOccurrenceCount} times in ${relativePath}; patch hunks require one original match.`
      );
    }
  }
  checks?.push("Every patch hunk find text appears exactly once in the original target file.");

  let nextContent = currentContent;
  for (const [index, hunk] of operation.hunks.entries()) {
    const occurrenceCount = countTextOccurrences(nextContent, hunk.findText);
    if (occurrenceCount !== 1) {
      throw new HttpError(
        409,
        `Patch hunk ${index + 1} requires exactly one sequential match in ${relativePath}; found ${occurrenceCount}.`
      );
    }
    nextContent = nextContent.replace(hunk.findText, hunk.replaceWith);
  }
  checks?.push("Patch hunks apply cleanly in order.");
  return nextContent;
}
