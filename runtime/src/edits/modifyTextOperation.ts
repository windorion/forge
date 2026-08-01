import { appendFile, writeFile } from "node:fs/promises";

import { HttpError } from "../runtime/runtimeError.js";
import type { AppliedFileChange, ProposedFileChange } from "../types.js";
import { countTextOccurrences, EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS } from "./textOperations.js";
import type {
  AppendTextOperation,
  EditableFileContext,
  EditOperationDependencies,
  PreparedChangeCallback,
  ReplaceTextOperation
} from "./editOperationTypes.js";

export async function applyModifyTextOperation(input: {
  proposalID: string;
  change: ProposedFileChange;
  operation: AppendTextOperation | ReplaceTextOperation;
  context: EditableFileContext;
  appliedAt: string;
  onPrepared: PreparedChangeCallback;
  dependencies: EditOperationDependencies;
}): Promise<AppliedFileChange> {
  return input.operation.kind === "AppendText" ? applyAppend(input) : applyReplace(input);
}

async function applyAppend(input: Parameters<typeof applyModifyTextOperation>[0]): Promise<AppliedFileChange> {
  const { proposalID, change, context, appliedAt, onPrepared, dependencies } = input;
  const operation = input.operation as AppendTextOperation;
  if (!dependencies.isEditableMarkdownWorkspacePath(context.relativePath)) {
    throw new HttpError(409, `AppendText can only modify README.md or docs/*.md in v0: ${context.relativePath}`);
  }
  if (!operation.text) throw new HttpError(409, `Append text is empty: ${context.relativePath}`);
  if (operation.text.length > EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS) {
    throw new HttpError(409, `Edit operation is too large for v0 apply: ${context.relativePath}`);
  }
  if (context.currentContent.endsWith(operation.text)) {
    throw new HttpError(409, `Proposed append text is already present at the end of ${context.relativePath}.`);
  }

  const afterContent = `${context.currentContent}${operation.text}`;
  const appliedChange = await prepareModifiedChange(input, afterContent);
  onPrepared(appliedChange);
  await appendFile(context.absolutePath, operation.text, "utf8");
  return appliedChange;
}

async function applyReplace(input: Parameters<typeof applyModifyTextOperation>[0]): Promise<AppliedFileChange> {
  const { context, onPrepared } = input;
  const operation = input.operation as ReplaceTextOperation;
  if (!operation.findText || !operation.replaceWith) {
    throw new HttpError(409, `Replace operation requires non-empty find and replacement text: ${context.relativePath}`);
  }
  if (operation.findText.length > EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS ||
      operation.replaceWith.length > EDIT_PROPOSAL_TEXT_OPERATION_MAX_CHARS) {
    throw new HttpError(409, `Replace operation is too large for v0 apply: ${context.relativePath}`);
  }
  if (operation.findText === operation.replaceWith) {
    throw new HttpError(409, `Find text and replacement text are identical: ${context.relativePath}`);
  }
  const occurrenceCount = countTextOccurrences(context.currentContent, operation.findText);
  if (occurrenceCount !== 1) {
    throw new HttpError(409, `Replace operation requires exactly one match in ${context.relativePath}; found ${occurrenceCount}.`);
  }

  const nextContent = context.currentContent.replace(operation.findText, operation.replaceWith);
  const appliedChange = await prepareModifiedChange(input, nextContent);
  onPrepared(appliedChange);
  await writeFile(context.absolutePath, nextContent, "utf8");
  return appliedChange;
}

async function prepareModifiedChange(
  input: Parameters<typeof applyModifyTextOperation>[0],
  afterContent: string
): Promise<AppliedFileChange> {
  const { proposalID, change, operation, context, appliedAt, dependencies } = input;
  const rollbackSnapshotPath = await dependencies.writeRollbackSnapshot(proposalID, change.id, context.currentContent);
  return dependencies.buildAppliedFileChange({
    relativePath: context.relativePath,
    proposalFileChangeID: change.id,
    operationKind: operation.kind,
    appliedAt,
    beforeContent: context.currentContent,
    afterContent,
    rollbackSnapshotPath,
    rollbackKind: "RestorePreviousContent",
    rollbackSummary: `Restore the previous full contents of ${context.relativePath}.`
  });
}
