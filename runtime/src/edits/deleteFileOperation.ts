import { readFile, stat, unlink } from "node:fs/promises";

import { HttpError } from "../runtime/runtimeError.js";
import type { AppliedFileChange, ProposedFileChange } from "../types.js";
import type { DeleteFileOperation, EditOperationDependencies, PreparedChangeCallback } from "./editOperationTypes.js";

const editableFileMaxBytes = 220_000;

export async function applyDeleteFileOperation(input: {
  proposalID: string;
  change: ProposedFileChange;
  operation: DeleteFileOperation;
  appliedAt: string;
  onPrepared: PreparedChangeCallback;
  dependencies: EditOperationDependencies;
}): Promise<AppliedFileChange> {
  const { proposalID, change, operation, appliedAt, onPrepared, dependencies } = input;
  const { absolutePath, relativePath } = dependencies.resolveEditableWorkspacePath(change.path);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) throw new HttpError(409, `Can only delete an existing regular file: ${relativePath}`);
  if (fileStat.size > editableFileMaxBytes) {
    throw new HttpError(409, `Delete target is too large for restricted source apply: ${relativePath}`);
  }

  const currentContent = await readFile(absolutePath, "utf8");
  if (currentContent.includes("\0")) throw new HttpError(409, `Delete target appears to be binary: ${relativePath}`);

  const rollbackSnapshotPath = await dependencies.writeRollbackSnapshot(proposalID, change.id, currentContent);
  const appliedChange = dependencies.buildAppliedFileChange({
    relativePath,
    proposalFileChangeID: change.id,
    operationKind: operation.kind,
    appliedAt,
    beforeContent: currentContent,
    rollbackSnapshotPath,
    rollbackKind: "RestoreDeletedFile",
    rollbackSummary: `Restore the deleted file ${relativePath}.`
  });
  onPrepared(appliedChange);
  await unlink(absolutePath);
  return appliedChange;
}
