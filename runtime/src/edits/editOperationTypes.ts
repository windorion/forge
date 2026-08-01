import type { AppliedFileChange, ProposedFileChange } from "../types.js";

export type ProposedFileOperation = NonNullable<ProposedFileChange["applyOperation"]>;
export type CreateFileOperation = Extract<ProposedFileOperation, { kind: "CreateFile" }>;
export type DeleteFileOperation = Extract<ProposedFileOperation, { kind: "DeleteFile" }>;
export type AppendTextOperation = Extract<ProposedFileOperation, { kind: "AppendText" }>;
export type ReplaceTextOperation = Extract<ProposedFileOperation, { kind: "ReplaceText" }>;
export type PatchTextOperation = Extract<ProposedFileOperation, { kind: "PatchText" }>;
export type UnifiedDiffOperation = Extract<ProposedFileOperation, { kind: "UnifiedDiff" }>;

export interface EditableFileContext {
  absolutePath: string;
  relativePath: string;
  currentContent: string;
}

export interface AppliedFileChangeInput {
  relativePath: string;
  proposalFileChangeID: string;
  operationKind: AppliedFileChange["operationKind"];
  appliedAt: string;
  beforeContent?: string;
  afterContent?: string;
  rollbackSnapshotPath?: string;
  rollbackKind: AppliedFileChange["rollbackKind"];
  rollbackSummary: string;
}

export interface EditOperationDependencies {
  resolveEditableWorkspacePath: (inputPath: string) => { absolutePath: string; relativePath: string };
  isEditableMarkdownWorkspacePath: (normalized: string) => boolean;
  writeRollbackSnapshot: (proposalID: string, fileChangeID: string, content: string) => Promise<string>;
  buildAppliedFileChange: (input: AppliedFileChangeInput) => AppliedFileChange;
}

export type PreparedChangeCallback = (appliedChange: AppliedFileChange) => void;
