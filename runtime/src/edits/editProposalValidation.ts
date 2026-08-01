import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { EditProposalValidation, FileChangeValidation, ProposedFileChange } from "../types.js";
import {
  countTextOccurrences,
  EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS,
  validatePatchTextOperation
} from "./textOperations.js";
import { validateUnifiedDiffOperation } from "./unifiedDiff.js";

const editProposalCreateFileMaxChars = 20_000;
const editProposalEditableFileMaxBytes = 220_000;

export function createEditProposalValidation(options: {
  resolveEditableWorkspacePath: (inputPath: string) => { absolutePath: string; relativePath: string };
  isEditableMarkdownWorkspacePath: (normalized: string) => boolean;
}) {
const { resolveEditableWorkspacePath, isEditableMarkdownWorkspacePath } = options;
const editProposalTextOperationMaxChars = EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS;

async function buildEditProposalValidation(fileChanges: ProposedFileChange[]): Promise<EditProposalValidation> {
  const fileResults = await Promise.all(fileChanges.map(validateProposedFileChange));
  const pathCounts = new Map<string, number>();
  for (const result of fileResults) {
    const normalizedPath = path.posix.normalize(result.path.replaceAll("\\", "/").replace(/^\.\/+/, ""));
    pathCounts.set(normalizedPath, (pathCounts.get(normalizedPath) ?? 0) + 1);
  }

  for (const result of fileResults) {
    const normalizedPath = path.posix.normalize(result.path.replaceAll("\\", "/").replace(/^\.\/+/, ""));
    if ((pathCounts.get(normalizedPath) ?? 0) > 1) {
      result.status = "Blocked";
      result.summary = `Proposal contains more than one change for ${normalizedPath}; cross-file apply requires one operation per path.`;
      result.checks.push("Duplicate target paths are blocked before cross-file apply.");
    }
  }
  const blockedCount = fileResults.filter((result) => result.status === "Blocked").length;
  const status: EditProposalValidation["status"] = blockedCount > 0 ? "Blocked" : "Ready";
  const summary =
    fileChanges.length === 0
      ? "Validation blocked: proposal contains no file changes."
      : blockedCount === 0
        ? `Validation passed for ${fileResults.length} proposed file change(s).`
        : `Validation blocked ${blockedCount} of ${fileResults.length} proposed file change(s).`;

  return {
    status: fileChanges.length === 0 ? "Blocked" : status,
    summary,
    checkedAt: new Date().toISOString(),
    fileResults
  };
}

async function validateProposedFileChange(change: ProposedFileChange): Promise<FileChangeValidation> {
  const checks: string[] = [];

  try {
    const operation = change.applyOperation;
    if (!operation) {
      return blockedValidation(change, `No apply operation was provided: ${change.path}`, checks);
    }

    if (change.changeType === "Create") {
      checks.push("Change type is create.");

      if (operation.kind !== "CreateFile") {
        return blockedValidation(change, `Create changes require a CreateFile operation in v0: ${change.path}`, checks);
      }

      const { absolutePath, relativePath } = resolveEditableWorkspacePath(change.path);
      checks.push("Path is inside the createable source/text workspace boundary.");

      if (operation.content.length === 0) {
        return blockedValidation(change, `CreateFile content is empty: ${relativePath}`, checks);
      }

      if (operation.content.length > editProposalCreateFileMaxChars) {
        return blockedValidation(change, `CreateFile content is too large for v0 apply: ${relativePath}`, checks);
      }

      if (operation.content.includes("\0")) {
        return blockedValidation(change, `CreateFile content contains a null byte: ${relativePath}`, checks);
      }
      checks.push("CreateFile content is within the v0 limit.");

      try {
        const fileStat = await stat(absolutePath);
        if (fileStat.isFile()) {
          return blockedValidation(change, `CreateFile target already exists: ${relativePath}`, checks);
        }

        return blockedValidation(change, `CreateFile target exists but is not a file: ${relativePath}`, checks);
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }
      checks.push("CreateFile target does not already exist.");

      return {
        id: change.id,
        path: relativePath,
        status: "Ready",
        summary: `${relativePath} is ready for restricted source/text file creation.`,
        checks
      };
    }

    if (change.changeType === "Delete") {
      checks.push("Change type is delete.");
      if (operation.kind !== "DeleteFile") {
        return blockedValidation(change, `Delete changes require a DeleteFile operation: ${change.path}`, checks);
      }

      const { absolutePath, relativePath } = resolveEditableWorkspacePath(change.path);
      checks.push("Path is inside the deletable source/text workspace boundary.");
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        return blockedValidation(change, `Can only delete an existing regular file: ${relativePath}`, checks);
      }
      if (fileStat.size > editProposalEditableFileMaxBytes) {
        return blockedValidation(change, `Delete target is too large for restricted source apply: ${relativePath}`, checks);
      }
      const currentContent = await readFile(absolutePath, "utf8");
      if (currentContent.includes("\0")) {
        return blockedValidation(change, `Delete target appears to be binary: ${relativePath}`, checks);
      }
      checks.push("Delete target is an existing bounded text file.");
      return {
        id: change.id,
        path: relativePath,
        status: "Ready",
        summary: `${relativePath} is ready for explicit reviewed deletion with rollback snapshot.`,
        checks
      };
    }

    if (change.changeType !== "Modify") {
      return blockedValidation(change, `Unsupported change type: ${change.path}`, checks);
    }
    checks.push("Change type is modify.");

    const { absolutePath, relativePath } = resolveEditableWorkspacePath(change.path);
    checks.push("Path is inside the editable source/text workspace boundary.");

    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return blockedValidation(change, `Can only modify existing files in v0: ${relativePath}`, checks);
    }
    checks.push("Target file exists.");

    if (fileStat.size > editProposalEditableFileMaxBytes) {
      return blockedValidation(change, `Target file is too large for restricted source apply: ${relativePath}`, checks);
    }
    checks.push("Target file is within the restricted source apply size limit.");

    const currentContent = await readFile(absolutePath, "utf8");
    if (currentContent.includes("\0")) {
      return blockedValidation(change, `Target file appears to be binary: ${relativePath}`, checks);
    }
    checks.push("Target file is readable as text.");

    if (operation.kind === "AppendText") {
      checks.push("Apply operation is append-text.");

      if (!isEditableMarkdownWorkspacePath(relativePath)) {
        return blockedValidation(change, `AppendText can only modify README.md or docs/*.md in v0: ${relativePath}`, checks);
      }
      checks.push("AppendText target is inside the editable Markdown boundary.");

      if (operation.text.length === 0) {
        return blockedValidation(change, `Append text is empty: ${change.path}`, checks);
      }

      if (operation.text.length > editProposalTextOperationMaxChars) {
        return blockedValidation(change, `Edit operation is too large for v0 apply: ${change.path}`, checks);
      }
      checks.push("Append text size is within the v0 limit.");

      if (currentContent.endsWith(operation.text)) {
        return blockedValidation(change, `Proposed append text is already present at the end of ${relativePath}.`, checks);
      }
      checks.push("Proposed append text is not already present at the file end.");

      return {
        id: change.id,
        path: relativePath,
        status: "Ready",
        summary: `${relativePath} is ready for the restricted append-text operation.`,
        checks
      };
    }

    if (operation.kind === "ReplaceText") {
      checks.push("Apply operation is replace-text.");

      if (operation.findText.length === 0) {
        return blockedValidation(change, `Find text is empty: ${change.path}`, checks);
      }

      if (operation.replaceWith.length === 0) {
        return blockedValidation(change, `Replacement text is empty: ${change.path}`, checks);
      }

      if (
        operation.findText.length > editProposalTextOperationMaxChars ||
        operation.replaceWith.length > editProposalTextOperationMaxChars
      ) {
        return blockedValidation(change, `Replace operation is too large for v0 apply: ${change.path}`, checks);
      }
      checks.push("Replace text size is within the v0 limit.");

      if (operation.findText === operation.replaceWith) {
        return blockedValidation(change, `Find text and replacement text are identical: ${change.path}`, checks);
      }

      const occurrenceCount = countTextOccurrences(currentContent, operation.findText);
      if (occurrenceCount === 0) {
        return blockedValidation(change, `Find text was not found in ${relativePath}.`, checks);
      }

      if (occurrenceCount > 1) {
        return blockedValidation(
          change,
          `Find text appears ${occurrenceCount} times in ${relativePath}; exact replace requires one match.`,
          checks
        );
      }
      checks.push("Find text appears exactly once in the target file.");

      return {
        id: change.id,
        path: relativePath,
        status: "Ready",
        summary: `${relativePath} is ready for the restricted replace-text operation.`,
        checks
      };
    }

    if (operation.kind === "PatchText") {
      checks.push("Apply operation is patch-text.");
      const nextContent = validatePatchTextOperation(operation, currentContent, relativePath, checks);
      if (nextContent === currentContent) {
        return blockedValidation(change, `Patch operation would not change ${relativePath}.`, checks);
      }

      return {
        id: change.id,
        path: relativePath,
        status: "Ready",
        summary: `${relativePath} is ready for ${operation.hunks.length} restricted patch-text hunk(s).`,
        checks
      };
    }

    if (operation.kind === "UnifiedDiff") {
      checks.push("Apply operation is unified-diff.");
      const nextContent = validateUnifiedDiffOperation(operation, currentContent, relativePath, checks);
      if (nextContent === currentContent) {
        return blockedValidation(change, `Unified diff would not change ${relativePath}.`, checks);
      }

      return {
        id: change.id,
        path: relativePath,
        status: "Ready",
        summary: `${relativePath} is ready for a context-anchored unified diff apply.`,
        checks
      };
    }

    return {
      id: change.id,
      path: relativePath,
      status: "Blocked",
      summary: `Unsupported apply operation for ${relativePath}.`,
      checks
    };
  } catch (error) {
    return blockedValidation(change, error instanceof Error ? error.message : String(error), checks);
  }
}

function blockedValidation(
  change: ProposedFileChange,
  summary: string,
  checks: string[]
): FileChangeValidation {
  return {
    id: change.id,
    path: change.path,
    status: "Blocked",
    summary,
    checks
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

return { buildEditProposalValidation };
}
