import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import type { AppliedFileChange, ProposedFileChange } from "../types.js";
import { applyCreateFileOperation } from "./createFileOperation.js";
import { applyDeleteFileOperation } from "./deleteFileOperation.js";
import type { EditableFileContext, EditOperationDependencies } from "./editOperationTypes.js";
import { applyModifyTextOperation } from "./modifyTextOperation.js";
import { applyPatchFileOperation } from "./patchFileOperation.js";

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

async function applyProposedFileChange(
  proposalID: string,
  change: ProposedFileChange,
  onPrepared: (appliedChange: AppliedFileChange) => void
): Promise<AppliedFileChange> {
  const operation = change.applyOperation;
  if (!operation) {
    throw new HttpError(409, `No apply operation was provided: ${change.path}`);
  }

  const input = {
    proposalID,
    change,
    operation,
    appliedAt: new Date().toISOString(),
    onPrepared,
    dependencies: editOperationDependencies()
  };

  if (change.changeType === "Create") {
    if (operation.kind !== "CreateFile") {
      throw new HttpError(409, `Create changes require a CreateFile operation in v0: ${change.path}`);
    }
    return applyCreateFileOperation({ ...input, operation });
  }

  if (change.changeType === "Delete") {
    if (operation.kind !== "DeleteFile") {
      throw new HttpError(409, `Delete changes require a DeleteFile operation: ${change.path}`);
    }
    return applyDeleteFileOperation({ ...input, operation });
  }

  if (change.changeType !== "Modify") {
    throw new HttpError(409, `Unsupported change type: ${change.path}`);
  }

  const context = await loadEditableFileContext(change.path);
  if (operation.kind === "AppendText" || operation.kind === "ReplaceText") {
    return applyModifyTextOperation({ ...input, operation, context });
  }
  if (operation.kind === "PatchText" || operation.kind === "UnifiedDiff") {
    return applyPatchFileOperation({ ...input, operation, context });
  }
  throw new HttpError(409, `Unsupported apply operation for ${context.relativePath}.`);
}

async function loadEditableFileContext(inputPath: string): Promise<EditableFileContext> {
  const { absolutePath, relativePath } = resolveEditableWorkspacePath(inputPath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) throw new HttpError(409, `Can only modify existing files in v0: ${relativePath}`);
  if (fileStat.size > editProposalEditableFileMaxBytes) {
    throw new HttpError(409, `Target file is too large for restricted source apply: ${relativePath}`);
  }
  const currentContent = await readFile(absolutePath, "utf8");
  if (currentContent.includes("\0")) throw new HttpError(409, `Target file appears to be binary: ${relativePath}`);
  return { absolutePath, relativePath, currentContent };
}

function editOperationDependencies(): EditOperationDependencies {
  return {
    resolveEditableWorkspacePath,
    isEditableMarkdownWorkspacePath,
    writeRollbackSnapshot,
    buildAppliedFileChange
  };
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
