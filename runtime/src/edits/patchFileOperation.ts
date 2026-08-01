import { writeFile } from "node:fs/promises";

import { HttpError } from "../runtime/runtimeError.js";
import type { AppliedFileChange, ProposedFileChange } from "../types.js";
import type {
  EditableFileContext,
  EditOperationDependencies,
  PatchTextOperation,
  PreparedChangeCallback,
  UnifiedDiffOperation
} from "./editOperationTypes.js";
import { validatePatchTextOperation } from "./textOperations.js";
import { validateUnifiedDiffOperation } from "./unifiedDiff.js";

export async function applyPatchFileOperation(input: {
  proposalID: string;
  change: ProposedFileChange;
  operation: PatchTextOperation | UnifiedDiffOperation;
  context: EditableFileContext;
  appliedAt: string;
  onPrepared: PreparedChangeCallback;
  dependencies: EditOperationDependencies;
}): Promise<AppliedFileChange> {
  const { proposalID, change, operation, context, appliedAt, onPrepared, dependencies } = input;
  const nextContent = operation.kind === "PatchText"
    ? validatePatchTextOperation(operation, context.currentContent, context.relativePath)
    : validateUnifiedDiffOperation(operation, context.currentContent, context.relativePath);
  if (nextContent === context.currentContent) {
    const label = operation.kind === "PatchText" ? "Patch operation" : "Unified diff";
    throw new HttpError(409, `${label} would not change ${context.relativePath}.`);
  }

  const rollbackSnapshotPath = await dependencies.writeRollbackSnapshot(proposalID, change.id, context.currentContent);
  const appliedChange = dependencies.buildAppliedFileChange({
    relativePath: context.relativePath,
    proposalFileChangeID: change.id,
    operationKind: operation.kind,
    appliedAt,
    beforeContent: context.currentContent,
    afterContent: nextContent,
    rollbackSnapshotPath,
    rollbackKind: "RestorePreviousContent",
    rollbackSummary: `Restore the previous full contents of ${context.relativePath}.`
  });
  onPrepared(appliedChange);
  await writeFile(context.absolutePath, nextContent, "utf8");
  return appliedChange;
}
