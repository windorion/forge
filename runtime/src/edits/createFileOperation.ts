import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import type { AppliedFileChange, ProposedFileChange } from "../types.js";
import type { CreateFileOperation, EditOperationDependencies, PreparedChangeCallback } from "./editOperationTypes.js";

const createFileMaxChars = 20_000;

export async function applyCreateFileOperation(input: {
  change: ProposedFileChange;
  operation: CreateFileOperation;
  appliedAt: string;
  onPrepared: PreparedChangeCallback;
  dependencies: EditOperationDependencies;
}): Promise<AppliedFileChange> {
  const { change, operation, appliedAt, onPrepared, dependencies } = input;
  const { absolutePath, relativePath } = dependencies.resolveEditableWorkspacePath(change.path);

  if (operation.content.length === 0) throw new HttpError(409, `CreateFile content is empty: ${relativePath}`);
  if (operation.content.length > createFileMaxChars) {
    throw new HttpError(409, `CreateFile content is too large for v0 apply: ${relativePath}`);
  }
  if (operation.content.includes("\0")) throw new HttpError(409, `CreateFile content contains a null byte: ${relativePath}`);

  try {
    const fileStat = await stat(absolutePath);
    throw new HttpError(409, fileStat.isFile()
      ? `CreateFile target already exists: ${relativePath}`
      : `CreateFile target exists but is not a file: ${relativePath}`);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  const appliedChange = dependencies.buildAppliedFileChange({
    relativePath,
    proposalFileChangeID: change.id,
    operationKind: operation.kind,
    appliedAt,
    afterContent: operation.content,
    rollbackKind: "DeleteCreatedFile",
    rollbackSummary: `Delete ${relativePath} to undo the created file.`
  });
  onPrepared(appliedChange);
  await writeFile(absolutePath, operation.content, { encoding: "utf8", flag: "wx" });
  return appliedChange;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
