import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

import type { AgentState, AppliedFileChange, EditProposal, ForgeTask, PlanStep, ProposedFileChange, RuntimeEvent } from "../types.js";
import { countTextOccurrences, validatePatchTextOperation } from "./textOperations.js";
import { validateUnifiedDiffOperation } from "./unifiedDiff.js";

export function createEditRecoveryService(options: {
  tasks: Map<string, ForgeTask>;
  saveTask: (task: ForgeTask) => void;
  resolveEditableWorkspacePath: (inputPath: string) => { absolutePath: string; relativePath: string };
  resolveRollbackSnapshotPath: (inputPath: string) => string;
  sha256Text: (content: string) => string;
  setAgent: (task: ForgeTask, role: AgentState["role"], status: AgentState["status"], summary: string) => void;
  upsertPlanStep: (task: ForgeTask, planStep: PlanStep) => void;
}) {
const {
  tasks,
  saveTask,
  resolveEditableWorkspacePath,
  resolveRollbackSnapshotPath,
  sha256Text,
  setAgent,
  upsertPlanStep
} = options;
const taskStore = { saveTask };

type PersistedEditFileState = {
  appliedChange: AppliedFileChange;
  state: "Applied" | "RolledBack";
  currentContent?: string;
};

function recoverInterruptedEditProposalTransactionsOnStartup(): void {
  for (const task of tasks.values()) {
    const proposal = task.editProposal;
    if (!proposal) {
      continue;
    }

    if (proposal.rollbackTransaction?.status === "Running") {
      recoverInterruptedRollbackTransaction(task, proposal);
      continue;
    }

    if (proposal.applyTransaction?.status === "Running") {
      recoverInterruptedApplyTransaction(task, proposal);
    }
  }
}

function recoverInterruptedApplyTransaction(task: ForgeTask, proposal: EditProposal): void {
  const transaction = proposal.applyTransaction;
  if (!transaction || transaction.status !== "Running") {
    return;
  }

  const recoveredAt = new Date().toISOString();
  try {
    if (transaction.journalVersion !== 1) {
      throw new Error("Interrupted apply transaction predates the durable write-ahead journal.");
    }

    const appliedFileChanges = proposal.appliedFileChanges ?? [];
    const states = appliedFileChanges.map(inspectPersistedEditFileState);
    for (const entry of [...states].reverse()) {
      if (entry.state === "RolledBack") {
        continue;
      }
      restorePersistedFileToBeforeState(entry.appliedChange);
    }

    for (const appliedChange of appliedFileChanges) {
      const verified = inspectPersistedEditFileState(appliedChange);
      if (verified.state !== "RolledBack") {
        throw new Error(`Startup apply recovery did not restore ${appliedChange.path}.`);
      }
      appliedChange.rolledBackAt = recoveredAt;
      appliedChange.rollbackVerifiedAt = recoveredAt;
    }

    transaction.status = "Recovered";
    transaction.completedAt = recoveredAt;
    transaction.verifiedAt = recoveredAt;
    transaction.recoverySummary = `Runtime restart recovery restored and verified ${appliedFileChanges.length} journaled file change(s).`;
    transaction.summary = "Interrupted apply transaction was returned to its verified pre-apply state.";
    proposal.status = "Proposed";
    delete proposal.decidedAt;
    delete proposal.decisionNote;
    task.status = "Failed";
    task.currentPhase = "Apply Recovered";
    task.changedFiles = [];
    task.reviewSummary = transaction.recoverySummary;
    setAgent(task, "Coder", "Blocked", "Interrupted apply was safely restored after runtime restart.");
    setAgent(task, "Reviewer", "Active", "Review the recovered proposal before retrying apply.");
    upsertPlanStep(task, {
      id: "apply-edit-proposal",
      title: "Apply edit proposal",
      status: "Blocked",
      summary: transaction.recoverySummary
    });
    persistStartupTransactionRecovery(task, "edit.proposal.apply.startup_recovered", transaction.recoverySummary, recoveredAt);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    transaction.status = "RecoveryFailed";
    transaction.completedAt = recoveredAt;
    transaction.recoverySummary = `Startup apply recovery stopped without overwriting unverified content: ${detail}`;
    transaction.summary = "Interrupted apply transaction requires manual recovery.";
    task.status = "Failed";
    task.currentPhase = "Apply Recovery Required";
    task.reviewSummary = transaction.recoverySummary;
    setAgent(task, "Coder", "Blocked", "Startup apply recovery could not prove a safe file state.");
    setAgent(task, "Reviewer", "Active", "Inspect the transaction evidence and working tree before continuing.");
    upsertPlanStep(task, {
      id: "apply-edit-proposal",
      title: "Apply edit proposal",
      status: "Blocked",
      summary: transaction.recoverySummary
    });
    persistStartupTransactionRecovery(task, "edit.proposal.apply.startup_recovery_failed", transaction.recoverySummary, recoveredAt);
  }
}

function recoverInterruptedRollbackTransaction(task: ForgeTask, proposal: EditProposal): void {
  const transaction = proposal.rollbackTransaction;
  if (!transaction || transaction.status !== "Running") {
    return;
  }

  const recoveredAt = new Date().toISOString();
  try {
    const appliedFileChanges = proposal.appliedFileChanges ?? [];
    if (appliedFileChanges.length === 0) {
      throw new Error("Interrupted rollback transaction has no persisted applied-file evidence.");
    }

    const states = appliedFileChanges.map(inspectPersistedEditFileState);
    if (states.every((entry) => entry.state === "RolledBack")) {
      for (const appliedChange of appliedFileChanges) {
        appliedChange.rolledBackAt = recoveredAt;
        appliedChange.rollbackVerifiedAt = recoveredAt;
      }
      transaction.status = "Completed";
      transaction.completedAt = recoveredAt;
      transaction.verifiedAt = recoveredAt;
      transaction.recoverySummary = `Runtime restart verified that all ${states.length} file change(s) had already been rolled back.`;
      transaction.summary = "Interrupted rollback had reached a fully verified rolled-back state.";
      proposal.status = "RolledBack";
      proposal.rolledBackAt = recoveredAt;
      task.status = "Human Review";
      task.currentPhase = "Rollback Applied";
      task.changedFiles = [...new Set(appliedFileChanges.map((change) => change.path))];
      task.reviewSummary = transaction.recoverySummary;
      setAgent(task, "Coder", "Done", "Interrupted rollback completed before runtime restart.");
      setAgent(task, "Reviewer", "Active", "Review the verified rolled-back working tree.");
      upsertPlanStep(task, {
        id: "rollback-edit-proposal",
        title: "Rollback edit proposal",
        status: "Done",
        summary: transaction.recoverySummary
      });
      persistStartupTransactionRecovery(task, "edit.proposal.rollback.startup_completed", transaction.recoverySummary, recoveredAt);
      return;
    }

    for (const entry of states) {
      if (entry.state === "RolledBack") {
        reapplyPersistedFileChange(proposal, entry);
      }
    }
    for (const appliedChange of appliedFileChanges) {
      const verified = inspectPersistedEditFileState(appliedChange);
      if (verified.state !== "Applied") {
        throw new Error(`Startup rollback recovery did not restore the applied state for ${appliedChange.path}.`);
      }
    }

    transaction.status = "Recovered";
    transaction.completedAt = recoveredAt;
    transaction.verifiedAt = recoveredAt;
    transaction.recoverySummary = `Runtime restart recovery restored and verified the applied state for ${states.length} file change(s).`;
    transaction.summary = "Interrupted rollback was compensated back to the verified applied state.";
    proposal.status = "Applied";
    task.status = "Failed";
    task.currentPhase = "Rollback Recovered";
    task.reviewSummary = transaction.recoverySummary;
    setAgent(task, "Coder", "Blocked", "Interrupted rollback was safely returned to the applied state.");
    setAgent(task, "Reviewer", "Active", "Review the recovered applied state before retrying rollback.");
    upsertPlanStep(task, {
      id: "rollback-edit-proposal",
      title: "Rollback edit proposal",
      status: "Blocked",
      summary: transaction.recoverySummary
    });
    persistStartupTransactionRecovery(task, "edit.proposal.rollback.startup_recovered", transaction.recoverySummary, recoveredAt);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    transaction.status = "RecoveryFailed";
    transaction.completedAt = recoveredAt;
    transaction.recoverySummary = `Startup rollback recovery stopped without overwriting unverified content: ${detail}`;
    transaction.summary = "Interrupted rollback transaction requires manual recovery.";
    task.status = "Failed";
    task.currentPhase = "Rollback Recovery Required";
    task.reviewSummary = transaction.recoverySummary;
    setAgent(task, "Coder", "Blocked", "Startup rollback recovery could not prove a safe file state.");
    setAgent(task, "Reviewer", "Active", "Inspect the transaction evidence and working tree before continuing.");
    upsertPlanStep(task, {
      id: "rollback-edit-proposal",
      title: "Rollback edit proposal",
      status: "Blocked",
      summary: transaction.recoverySummary
    });
    persistStartupTransactionRecovery(task, "edit.proposal.rollback.startup_recovery_failed", transaction.recoverySummary, recoveredAt);
  }
}

function inspectPersistedEditFileState(appliedChange: AppliedFileChange): PersistedEditFileState {
  const { absolutePath, relativePath } = resolveEditableWorkspacePath(appliedChange.path);
  const currentContent = readTextFileIfExists(absolutePath);

  if (appliedChange.rollbackKind === "DeleteCreatedFile") {
    if (!appliedChange.afterSha256) {
      throw new Error(`Journal entry is missing the after hash for ${relativePath}.`);
    }
    if (currentContent === undefined) {
      return { appliedChange, state: "RolledBack" };
    }
    if (sha256Text(currentContent) === appliedChange.afterSha256) {
      return { appliedChange, state: "Applied", currentContent };
    }
    throw new Error(`Current file hash for ${relativePath} matches neither the journaled created file nor its absent before state.`);
  }

  if (appliedChange.rollbackKind === "RestoreDeletedFile") {
    if (!appliedChange.beforeSha256) {
      throw new Error(`Deleted-file journal entry is missing the before hash for ${relativePath}.`);
    }
    if (currentContent === undefined) {
      return { appliedChange, state: "Applied" };
    }
    if (sha256Text(currentContent) === appliedChange.beforeSha256) {
      return { appliedChange, state: "RolledBack", currentContent };
    }
    throw new Error(`Current file hash for ${relativePath} matches neither the journaled deleted state nor its before hash.`);
  }

  if (currentContent === undefined) {
    throw new Error(`Journaled modified file is missing: ${relativePath}.`);
  }
  if (!appliedChange.beforeSha256) {
    throw new Error(`Journal entry is missing the before hash for ${relativePath}.`);
  }
  if (!appliedChange.afterSha256) {
    throw new Error(`Journal entry is missing the after hash for ${relativePath}.`);
  }

  const currentSha = sha256Text(currentContent);
  if (currentSha === appliedChange.afterSha256) {
    return { appliedChange, state: "Applied", currentContent };
  }
  if (currentSha === appliedChange.beforeSha256) {
    return { appliedChange, state: "RolledBack", currentContent };
  }
  throw new Error(`Current file hash for ${relativePath} matches neither the journaled before nor after state.`);
}

function restorePersistedFileToBeforeState(appliedChange: AppliedFileChange): void {
  const { absolutePath, relativePath } = resolveEditableWorkspacePath(appliedChange.path);
  if (appliedChange.rollbackKind === "DeleteCreatedFile") {
    unlinkSync(absolutePath);
    return;
  }

  const snapshotPath = appliedChange.rollbackSnapshotPath;
  if (!snapshotPath || !appliedChange.beforeSha256) {
    throw new Error(`Rollback snapshot evidence is incomplete for ${relativePath}.`);
  }
  const snapshot = readFileSync(resolveRollbackSnapshotPath(snapshotPath), "utf8");
  if (sha256Text(snapshot) !== appliedChange.beforeSha256) {
    throw new Error(`Rollback snapshot hash does not match the journaled before hash for ${relativePath}.`);
  }
  if (appliedChange.rollbackKind === "RestoreDeletedFile") {
    writeFileSync(absolutePath, snapshot, { encoding: "utf8", flag: "wx" });
  } else {
    writeFileSync(absolutePath, snapshot, "utf8");
  }
}

function reapplyPersistedFileChange(proposal: EditProposal, entry: PersistedEditFileState): void {
  const appliedChange = entry.appliedChange;
  const change = proposal.fileChanges.find((candidate) =>
    candidate.id === appliedChange.proposalFileChangeID ||
    (!appliedChange.proposalFileChangeID && candidate.path === appliedChange.path)
  );
  if (!change) {
    throw new Error(`Proposal file change is missing for journaled path ${appliedChange.path}.`);
  }

  const { absolutePath, relativePath } = resolveEditableWorkspacePath(appliedChange.path);
  if (appliedChange.rollbackKind === "RestoreDeletedFile") {
    unlinkSync(absolutePath);
    return;
  }
  const nextContent = materializeProposedContentForRecovery(change, entry.currentContent);
  if (!appliedChange.afterSha256 || sha256Text(nextContent) !== appliedChange.afterSha256) {
    throw new Error(`Reconstructed applied content does not match the journaled after hash for ${relativePath}.`);
  }

  if (appliedChange.rollbackKind === "DeleteCreatedFile") {
    writeFileSync(absolutePath, nextContent, { encoding: "utf8", flag: "wx" });
  } else {
    writeFileSync(absolutePath, nextContent, "utf8");
  }
}

function materializeProposedContentForRecovery(change: ProposedFileChange, beforeContent: string | undefined): string {
  const operation = change.applyOperation;
  if (!operation) {
    throw new Error(`Proposal operation is missing for ${change.path}.`);
  }
  if (operation.kind === "CreateFile") {
    if (beforeContent !== undefined) {
      throw new Error(`Created-file recovery expected an absent before state for ${change.path}.`);
    }
    return operation.content;
  }
  if (beforeContent === undefined) {
    throw new Error(`Modified-file recovery expected existing before content for ${change.path}.`);
  }
  if (operation.kind === "AppendText") {
    return `${beforeContent}${operation.text}`;
  }
  if (operation.kind === "ReplaceText") {
    if (countTextOccurrences(beforeContent, operation.findText) !== 1) {
      throw new Error(`Cannot reconstruct the unique replacement for ${change.path}.`);
    }
    return beforeContent.replace(operation.findText, operation.replaceWith);
  }
  if (operation.kind === "PatchText") {
    return validatePatchTextOperation(operation, beforeContent, change.path);
  }
  if (operation.kind === "UnifiedDiff") {
    return validateUnifiedDiffOperation(operation, beforeContent, change.path);
  }
  throw new Error(`Unsupported recovery operation for ${change.path}: ${operation.kind}`);
}

function readTextFileIfExists(absolutePath: string): string | undefined {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function persistStartupTransactionRecovery(task: ForgeTask, type: string, message: string, createdAt: string): void {
  const recoveryEvent = event(type, message);
  recoveryEvent.createdAt = createdAt;
  task.events.push(recoveryEvent);
  task.updatedAt = createdAt;
  tasks.set(task.id, task);
  taskStore.saveTask(task);
}

function event(type: string, message: string): RuntimeEvent {
  return { type, message, createdAt: "" };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

return {
  recoverInterruptedEditProposalTransactionsOnStartup,
  inspectPersistedEditFileState,
  restorePersistedFileToBeforeState
};
}
