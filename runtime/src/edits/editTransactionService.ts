import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import type { AppliedFileChange, ProposedFileChange } from "../types.js";
import {
  countTextOccurrences,
  EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS,
  validatePatchTextOperation
} from "./textOperations.js";
import { validateUnifiedDiffOperation } from "./unifiedDiff.js";

const editProposalCreateFileMaxChars = 20_000;
const editProposalEditableFileMaxBytes = 220_000;

export type PreparedRollbackOperation = {
  relativePath: string;
  rollback: () => Promise<void>;
  reapply: () => Promise<void>;
  verifyRolledBack: () => Promise<void>;
  verifyApplied: () => Promise<void>;
};

export function createEditTransactionService(options: {
  repoRoot: string;
  rollbackSnapshotRoot: string;
  resolveEditableWorkspacePath: (inputPath: string) => { absolutePath: string; relativePath: string };
  isEditableMarkdownWorkspacePath: (normalized: string) => boolean;
  inspectPersistedEditFileState: (change: AppliedFileChange) => {
    appliedChange: AppliedFileChange;
    state: "Applied" | "RolledBack" | "Missing" | "Diverged";
  };
  restorePersistedFileToBeforeState: (change: AppliedFileChange) => void;
}) {
const {
  repoRoot,
  rollbackSnapshotRoot,
  resolveEditableWorkspacePath,
  isEditableMarkdownWorkspacePath,
  inspectPersistedEditFileState,
  restorePersistedFileToBeforeState
} = options;
const editProposalTextOperationMaxChars = EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS;

async function applyProposedFileChange(
  proposalID: string,
  change: ProposedFileChange,
  onPrepared: (appliedChange: AppliedFileChange) => void
): Promise<AppliedFileChange> {
  const operation = change.applyOperation;
  if (!operation) {
    throw new HttpError(409, `No apply operation was provided: ${change.path}`);
  }

  const appliedAt = new Date().toISOString();

  if (change.changeType === "Create") {
    if (operation.kind !== "CreateFile") {
      throw new HttpError(409, `Create changes require a CreateFile operation in v0: ${change.path}`);
    }

    const { absolutePath, relativePath } = resolveEditableWorkspacePath(change.path);

    if (operation.content.length === 0) {
      throw new HttpError(409, `CreateFile content is empty: ${relativePath}`);
    }

    if (operation.content.length > editProposalCreateFileMaxChars) {
      throw new HttpError(409, `CreateFile content is too large for v0 apply: ${relativePath}`);
    }

    if (operation.content.includes("\0")) {
      throw new HttpError(409, `CreateFile content contains a null byte: ${relativePath}`);
    }

    try {
      const fileStat = await stat(absolutePath);
      if (fileStat.isFile()) {
        throw new HttpError(409, `CreateFile target already exists: ${relativePath}`);
      }

      throw new HttpError(409, `CreateFile target exists but is not a file: ${relativePath}`);
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    const appliedChange = buildAppliedFileChange({
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

  if (change.changeType === "Delete") {
    if (operation.kind !== "DeleteFile") {
      throw new HttpError(409, `Delete changes require a DeleteFile operation: ${change.path}`);
    }

    const { absolutePath, relativePath } = resolveEditableWorkspacePath(change.path);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new HttpError(409, `Can only delete an existing regular file: ${relativePath}`);
    }
    if (fileStat.size > editProposalEditableFileMaxBytes) {
      throw new HttpError(409, `Delete target is too large for restricted source apply: ${relativePath}`);
    }
    const currentContent = await readFile(absolutePath, "utf8");
    if (currentContent.includes("\0")) {
      throw new HttpError(409, `Delete target appears to be binary: ${relativePath}`);
    }

    const rollbackSnapshotPath = await writeRollbackSnapshot(proposalID, change.id, currentContent);
    const appliedChange = buildAppliedFileChange({
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

  if (change.changeType !== "Modify") {
    throw new HttpError(409, `Unsupported change type: ${change.path}`);
  }

  const { absolutePath, relativePath } = resolveEditableWorkspacePath(change.path);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new HttpError(409, `Can only modify existing files in v0: ${relativePath}`);
  }

  if (fileStat.size > editProposalEditableFileMaxBytes) {
    throw new HttpError(409, `Target file is too large for restricted source apply: ${relativePath}`);
  }

  const currentContent = await readFile(absolutePath, "utf8");
  if (currentContent.includes("\0")) {
    throw new HttpError(409, `Target file appears to be binary: ${relativePath}`);
  }

  if (operation.kind === "AppendText") {
    if (!isEditableMarkdownWorkspacePath(relativePath)) {
      throw new HttpError(409, `AppendText can only modify README.md or docs/*.md in v0: ${relativePath}`);
    }

    if (operation.text.length === 0) {
      throw new HttpError(409, `Append text is empty: ${relativePath}`);
    }

    if (operation.text.length > editProposalTextOperationMaxChars) {
      throw new HttpError(409, `Edit operation is too large for v0 apply: ${relativePath}`);
    }

    if (currentContent.endsWith(operation.text)) {
      throw new HttpError(409, `Proposed append text is already present at the end of ${relativePath}.`);
    }

    const afterContent = `${currentContent}${operation.text}`;
    const rollbackSnapshotPath = await writeRollbackSnapshot(proposalID, change.id, currentContent);
    const appliedChange = buildAppliedFileChange({
      relativePath,
      proposalFileChangeID: change.id,
      operationKind: operation.kind,
      appliedAt,
      beforeContent: currentContent,
      afterContent,
      rollbackSnapshotPath,
      rollbackKind: "RestorePreviousContent",
      rollbackSummary: `Restore the previous full contents of ${relativePath}.`
    });
    onPrepared(appliedChange);
    await appendFile(absolutePath, operation.text, "utf8");
    return appliedChange;
  }

  if (operation.kind === "ReplaceText") {
    if (operation.findText.length === 0 || operation.replaceWith.length === 0) {
      throw new HttpError(409, `Replace operation requires non-empty find and replacement text: ${relativePath}`);
    }

    if (
      operation.findText.length > editProposalTextOperationMaxChars ||
      operation.replaceWith.length > editProposalTextOperationMaxChars
    ) {
      throw new HttpError(409, `Replace operation is too large for v0 apply: ${relativePath}`);
    }

    if (operation.findText === operation.replaceWith) {
      throw new HttpError(409, `Find text and replacement text are identical: ${relativePath}`);
    }

    const occurrenceCount = countTextOccurrences(currentContent, operation.findText);
    if (occurrenceCount !== 1) {
      throw new HttpError(
        409,
        `Replace operation requires exactly one match in ${relativePath}; found ${occurrenceCount}.`
      );
    }

    const nextContent = currentContent.replace(operation.findText, operation.replaceWith);
    const rollbackSnapshotPath = await writeRollbackSnapshot(proposalID, change.id, currentContent);
    const appliedChange = buildAppliedFileChange({
      relativePath,
      proposalFileChangeID: change.id,
      operationKind: operation.kind,
      appliedAt,
      beforeContent: currentContent,
      afterContent: nextContent,
      rollbackSnapshotPath,
      rollbackKind: "RestorePreviousContent",
      rollbackSummary: `Restore the previous full contents of ${relativePath}.`
    });
    onPrepared(appliedChange);
    await writeFile(absolutePath, nextContent, "utf8");
    return appliedChange;
  }

  if (operation.kind === "PatchText") {
    const nextContent = validatePatchTextOperation(operation, currentContent, relativePath);
    if (nextContent === currentContent) {
      throw new HttpError(409, `Patch operation would not change ${relativePath}.`);
    }

    const rollbackSnapshotPath = await writeRollbackSnapshot(proposalID, change.id, currentContent);
    const appliedChange = buildAppliedFileChange({
      relativePath,
      proposalFileChangeID: change.id,
      operationKind: operation.kind,
      appliedAt,
      beforeContent: currentContent,
      afterContent: nextContent,
      rollbackSnapshotPath,
      rollbackKind: "RestorePreviousContent",
      rollbackSummary: `Restore the previous full contents of ${relativePath}.`
    });
    onPrepared(appliedChange);
    await writeFile(absolutePath, nextContent, "utf8");
    return appliedChange;
  }

  if (operation.kind === "UnifiedDiff") {
    const nextContent = validateUnifiedDiffOperation(operation, currentContent, relativePath);
    if (nextContent === currentContent) {
      throw new HttpError(409, `Unified diff would not change ${relativePath}.`);
    }

    const rollbackSnapshotPath = await writeRollbackSnapshot(proposalID, change.id, currentContent);
    const appliedChange = buildAppliedFileChange({
      relativePath,
      proposalFileChangeID: change.id,
      operationKind: operation.kind,
      appliedAt,
      beforeContent: currentContent,
      afterContent: nextContent,
      rollbackSnapshotPath,
      rollbackKind: "RestorePreviousContent",
      rollbackSummary: `Restore the previous full contents of ${relativePath}.`
    });
    onPrepared(appliedChange);
    await writeFile(absolutePath, nextContent, "utf8");
    return appliedChange;
  }

  throw new HttpError(409, `Unsupported apply operation for ${relativePath}.`);
}

async function verifyAppliedFileChange(appliedChange: AppliedFileChange): Promise<string> {
  const { absolutePath, relativePath } = resolveEditableWorkspacePath(appliedChange.path);
  if (appliedChange.rollbackKind === "RestoreDeletedFile") {
    try {
      await stat(absolutePath);
      throw new HttpError(409, `Apply verification expected deleted file ${relativePath} to be absent.`);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
    return new Date().toISOString();
  }
  const currentContent = await readFile(absolutePath, "utf8");
  verifyCurrentContentForRollback(appliedChange, currentContent, relativePath);
  return new Date().toISOString();
}

async function recoverPartialApply(
  appliedFileChanges: AppliedFileChange[]
): Promise<{ succeeded: boolean; summary: string }> {
  if (appliedFileChanges.length === 0) {
    return { succeeded: true, summary: "No file write completed before the failure." };
  }

  try {
    const states = appliedFileChanges.map(inspectPersistedEditFileState);
    const writtenStates = states.filter((entry) => entry.state === "Applied");
    const recoveredAt = new Date().toISOString();
    for (const entry of [...writtenStates].reverse()) {
      restorePersistedFileToBeforeState(entry.appliedChange);
    }
    for (const appliedChange of appliedFileChanges) {
      const verified = inspectPersistedEditFileState(appliedChange);
      if (verified.state !== "RolledBack") {
        throw new Error(`Automatic apply recovery did not restore ${appliedChange.path}.`);
      }
      appliedChange.rolledBackAt = recoveredAt;
      appliedChange.rollbackVerifiedAt = recoveredAt;
    }
    return {
      succeeded: true,
      summary: `Automatic recovery restored and verified ${writtenStates.length} previously written file(s); ${appliedFileChanges.length} journaled file state(s) are back at their before hashes.`
    };
  } catch (recoveryError) {
    const detail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
    return {
      succeeded: false,
      summary: `Automatic apply recovery failed: ${detail}`
    };
  }
}

async function recoverPartialRollback(
  attemptedOperations: PreparedRollbackOperation[]
): Promise<{ succeeded: boolean; summary: string }> {
  if (attemptedOperations.length === 0) {
    return { succeeded: true, summary: "Rollback stopped before any file restore was attempted." };
  }

  try {
    for (const operation of [...attemptedOperations].reverse()) {
      await operation.reapply();
      await operation.verifyApplied();
    }
    return {
      succeeded: true,
      summary: `Automatic rollback recovery restored and verified the applied state for ${attemptedOperations.length} file(s).`
    };
  } catch (recoveryError) {
    const detail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
    return {
      succeeded: false,
      summary: `Automatic rollback recovery failed: ${detail}`
    };
  }
}

async function prepareAppliedFileRollback(appliedChange: AppliedFileChange): Promise<PreparedRollbackOperation> {
  if (appliedChange.rolledBackAt) {
    throw new HttpError(409, `Applied file change has already been rolled back: ${appliedChange.path}`);
  }

  if (appliedChange.rollbackKind === "DeleteCreatedFile") {
    const { absolutePath, relativePath } = resolveEditableWorkspacePath(appliedChange.path);
    const currentContent = await readFile(absolutePath, "utf8");
    verifyCurrentContentForRollback(appliedChange, currentContent, relativePath);

    return {
      relativePath,
      rollback: async () => {
        await unlink(absolutePath);
      },
      reapply: async () => {
        await writeFile(absolutePath, currentContent, { encoding: "utf8", flag: "wx" });
      },
      verifyRolledBack: async () => {
        try {
          await stat(absolutePath);
          throw new HttpError(409, `Rollback verification expected ${relativePath} to be absent.`);
        } catch (error) {
          if (error instanceof HttpError) {
            throw error;
          }
          if (!isNodeError(error) || error.code !== "ENOENT") {
            throw error;
          }
        }
      },
      verifyApplied: async () => {
        const content = await readFile(absolutePath, "utf8");
        verifyCurrentContentForRollback(appliedChange, content, relativePath);
      }
    };
  }

  if (appliedChange.rollbackKind === "RestoreDeletedFile") {
    const { absolutePath, relativePath } = resolveEditableWorkspacePath(appliedChange.path);
    const snapshotPath = appliedChange.rollbackSnapshotPath;
    if (!snapshotPath || !appliedChange.beforeSha256) {
      throw new HttpError(409, `Deleted-file rollback snapshot is missing for ${relativePath}.`);
    }
    try {
      await stat(absolutePath);
      throw new HttpError(409, `Deleted-file rollback expected ${relativePath} to remain absent.`);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }

    const snapshot = await readFile(resolveRollbackSnapshotPath(snapshotPath), "utf8");
    if (sha256Text(snapshot) !== appliedChange.beforeSha256) {
      throw new HttpError(409, `Deleted-file rollback snapshot hash mismatch for ${relativePath}.`);
    }

    return {
      relativePath,
      rollback: async () => {
        await writeFile(absolutePath, snapshot, { encoding: "utf8", flag: "wx" });
      },
      reapply: async () => {
        await unlink(absolutePath);
      },
      verifyRolledBack: async () => {
        const restored = await readFile(absolutePath, "utf8");
        if (sha256Text(restored) !== appliedChange.beforeSha256) {
          throw new HttpError(409, `Deleted-file rollback verification failed for ${relativePath}.`);
        }
      },
      verifyApplied: async () => {
        try {
          await stat(absolutePath);
          throw new HttpError(409, `Deleted-file applied-state verification expected ${relativePath} to be absent.`);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          if (!isNodeError(error) || error.code !== "ENOENT") throw error;
        }
      }
    };
  }

  if (appliedChange.rollbackKind === "RestorePreviousContent") {
    const { absolutePath, relativePath } = resolveEditableWorkspacePath(appliedChange.path);
    const snapshotPath = appliedChange.rollbackSnapshotPath;
    if (!snapshotPath) {
      throw new HttpError(409, `Rollback snapshot is missing for ${relativePath}.`);
    }

    const currentContent = await readFile(absolutePath, "utf8");
    verifyCurrentContentForRollback(appliedChange, currentContent, relativePath);

    const snapshot = await readFile(resolveRollbackSnapshotPath(snapshotPath), "utf8");
    if (appliedChange.beforeSha256 && sha256Text(snapshot) !== appliedChange.beforeSha256) {
      throw new HttpError(409, `Rollback snapshot hash does not match recorded before hash for ${relativePath}.`);
    }

    return {
      relativePath,
      rollback: async () => {
        await writeFile(absolutePath, snapshot, "utf8");
      },
      reapply: async () => {
        await writeFile(absolutePath, currentContent, "utf8");
      },
      verifyRolledBack: async () => {
        const restoredContent = await readFile(absolutePath, "utf8");
        if (!appliedChange.beforeSha256 || sha256Text(restoredContent) !== appliedChange.beforeSha256) {
          throw new HttpError(409, `Rollback verification failed for restored file ${relativePath}.`);
        }
      },
      verifyApplied: async () => {
        const reappliedContent = await readFile(absolutePath, "utf8");
        verifyCurrentContentForRollback(appliedChange, reappliedContent, relativePath);
      }
    };
  }

  throw new HttpError(409, `Unsupported rollback kind for ${appliedChange.path}: ${appliedChange.rollbackKind}`);
}

function verifyCurrentContentForRollback(
  appliedChange: AppliedFileChange,
  currentContent: string,
  relativePath: string
): void {
  if (!appliedChange.afterSha256) {
    throw new HttpError(409, `Applied change is missing after hash: ${relativePath}`);
  }

  const currentSha = sha256Text(currentContent);
  if (currentSha !== appliedChange.afterSha256) {
    throw new HttpError(
      409,
      `Current file hash for ${relativePath} no longer matches the applied proposal; rollback would overwrite later changes.`
    );
  }
}

async function writeRollbackSnapshot(
  proposalID: string,
  fileChangeID: string,
  content: string
): Promise<string> {
  const directory = path.join(rollbackSnapshotRoot, safeSnapshotSegment(proposalID));
  await mkdir(directory, { recursive: true });

  const absolutePath = path.join(directory, `${safeSnapshotSegment(fileChangeID)}-${randomUUID()}.before`);
  await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
  return repoRelativePath(absolutePath);
}

function resolveRollbackSnapshotPath(inputPath: string): string {
  if (inputPath.includes("\0") || path.isAbsolute(inputPath)) {
    throw new HttpError(409, `Unsafe rollback snapshot path: ${inputPath}`);
  }

  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    !normalized.startsWith(".forge/rollback-snapshots/")
  ) {
    throw new HttpError(409, `Unsafe rollback snapshot path: ${inputPath}`);
  }

  const absolutePath = path.resolve(repoRoot, normalized);
  if (!absolutePath.startsWith(`${rollbackSnapshotRoot}${path.sep}`)) {
    throw new HttpError(409, `Unsafe rollback snapshot path: ${inputPath}`);
  }

  return absolutePath;
}

function safeSnapshotSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  if (!safe) {
    throw new HttpError(409, "Rollback snapshot id is empty.");
  }

  return safe;
}

function repoRelativePath(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function buildAppliedFileChange(input: {
  relativePath: string;
  proposalFileChangeID: string;
  operationKind: AppliedFileChange["operationKind"];
  appliedAt: string;
  beforeContent?: string;
  afterContent?: string;
  rollbackSnapshotPath?: string;
  rollbackKind: AppliedFileChange["rollbackKind"];
  rollbackSummary: string;
}): AppliedFileChange {
  return {
    path: input.relativePath,
    operationKind: input.operationKind,
    rollbackKind: input.rollbackKind,
    rollbackSummary: input.rollbackSummary,
    appliedAt: input.appliedAt,
    proposalFileChangeID: input.proposalFileChangeID,
    beforeSha256: input.beforeContent === undefined ? undefined : sha256Text(input.beforeContent),
    afterSha256: input.afterContent === undefined ? undefined : sha256Text(input.afterContent),
    beforeByteLength: input.beforeContent === undefined ? undefined : Buffer.byteLength(input.beforeContent, "utf8"),
    afterByteLength: input.afterContent === undefined ? undefined : Buffer.byteLength(input.afterContent, "utf8"),
    rollbackSnapshotPath: input.rollbackSnapshotPath
  };
}

function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

return {
  applyProposedFileChange,
  verifyAppliedFileChange,
  recoverPartialApply,
  recoverPartialRollback,
  prepareAppliedFileRollback,
  resolveRollbackSnapshotPath,
  sha256Text
};
}
