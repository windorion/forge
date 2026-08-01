import { randomUUID } from "node:crypto";

import { HttpError } from "../runtime/runtimeError.js";
import type { ModelProvider } from "../modelProvider.js";
import type {
  AgentState,
  AppliedFileChange,
  CommandRerunEvidence,
  EditProposal,
  EditProposalDecisionRequest,
  EditProposalFileReviewRequest,
  EditProposalValidation,
  ForgeTask,
  PlanStep,
  RuntimeEvent,
  RerunRepairCommandRequest,
  TaskCommandRun,
  TaskMessage,
  ValidationRepairBrief
} from "../types.js";
import type { PreparedRollbackOperation } from "./editTransactionService.js";

export function createEditProposalService(options: {
  tasks: Map<string, ForgeTask>;
  modelProvider: () => ModelProvider;
  saveTask: (task: ForgeTask) => void;
  saveAndBroadcast: (task: ForgeTask, event: RuntimeEvent) => void;
  event: (type: string, message: string) => RuntimeEvent;
  setAgent: (task: ForgeTask, role: AgentState["role"], status: AgentState["status"], summary: string) => void;
  upsertPlanStep: (task: ForgeTask, planStep: PlanStep) => void;
  latestTaskMessage: (task: ForgeTask, role?: TaskMessage["role"]) => TaskMessage | undefined;
  buildEditProposalValidation: (fileChanges: EditProposal["fileChanges"]) => Promise<EditProposalValidation>;
  applyProposedFileChange: (
    proposalID: string,
    change: EditProposal["fileChanges"][number],
    onPrepared: (change: AppliedFileChange) => void
  ) => Promise<AppliedFileChange>;
  verifyAppliedFileChange: (change: AppliedFileChange) => Promise<string>;
  recoverPartialApply: (changes: AppliedFileChange[]) => Promise<{ succeeded: boolean; summary: string }>;
  recoverPartialRollback: (operations: PreparedRollbackOperation[]) => Promise<{ succeeded: boolean; summary: string }>;
  prepareAppliedFileRollback: (change: AppliedFileChange) => Promise<PreparedRollbackOperation>;
  latestRepairProposalSource: (task: ForgeTask) => {
    kind: "ValidationRun" | "TaskCommandRun";
    brief: ValidationRepairBrief;
  } | undefined;
  runValidation: (taskID: string, mode: "PostApply") => Promise<ForgeTask>;
}) {
const {
  tasks,
  saveTask,
  saveAndBroadcast,
  event,
  setAgent,
  upsertPlanStep,
  latestTaskMessage,
  buildEditProposalValidation,
  applyProposedFileChange,
  verifyAppliedFileChange,
  recoverPartialApply,
  recoverPartialRollback,
  prepareAppliedFileRollback,
  latestRepairProposalSource,
  runValidation
} = options;
const currentModelProvider = options.modelProvider;
const editProposalRepairMaxAttempts = 2;

async function generateEditProposal(taskID: string): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (!task.executionProposal) {
    throw new HttpError(409, "An execution proposal is required before generating edit proposals.");
  }

  if (task.editProposal?.status === "Proposed") {
    throw new HttpError(409, "This task already has a proposed edit awaiting review.");
  }

  if (task.editProposal?.status === "Applied") {
    throw new HttpError(409, "Applied edit proposals cannot be regenerated.");
  }

  if (task.editProposal?.status === "Rejected") {
    return createEditProposalForTask(task, "Revision", task.editProposal);
  }

  return createEditProposalForTask(task, "Initial");
}

async function reviseEditProposal(taskID: string): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (!task.executionProposal) {
    throw new HttpError(409, "An execution proposal is required before revising edit proposals.");
  }

  if (task.editProposal?.status !== "Rejected") {
    throw new HttpError(409, "A rejected edit proposal is required before revision.");
  }

  return createEditProposalForTask(task, "Revision", task.editProposal);
}

async function generateValidationRepairProposal(taskID: string): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (!task.executionProposal) {
    throw new HttpError(409, "An execution proposal is required before generating validation repair proposals.");
  }

  if (task.editProposal?.status === "Proposed") {
    throw new HttpError(409, "This task already has a proposed edit awaiting review.");
  }

  const repairSource = latestRepairProposalSource(task);
  if (!repairSource) {
    throw new HttpError(409, "A failed validation run or task command repair brief is required before generating a repair proposal.");
  }

  if (repairSource.kind === "ValidationRun" && task.editProposal?.status !== "Applied") {
    throw new HttpError(409, "An applied edit proposal is required before generating a validation repair proposal.");
  }

  const previousProposal = task.editProposal?.status === "Applied" ? task.editProposal : undefined;
  return createEditProposalForTask(task, "ValidationRepair", previousProposal, {
    validationRepairBrief: repairSource.brief,
    preserveChangedFiles: Boolean(previousProposal)
  });
}

async function createEditProposalForTask(
  task: ForgeTask,
  mode: "Initial" | "Revision" | "ValidationRepair",
  previousProposal?: EditProposal,
  options: {
    validationRepairBrief?: ValidationRepairBrief;
    preserveChangedFiles?: boolean;
  } = {}
): Promise<ForgeTask> {
  const isRevision = mode === "Revision";
  const isValidationRepair = mode === "ValidationRepair";
  const sourceMessage = latestTaskMessage(task, "User");
  const revisionNumber = previousProposal ? (previousProposal.revisionNumber ?? 1) + 1 : 1;
  const stepID = isValidationRepair
    ? "generate-validation-repair-proposal"
    : isRevision
      ? "revise-edit-proposal"
      : "generate-safe-edit-proposal";
  const stepTitle = isValidationRepair
    ? "Generate validation repair proposal"
    : isRevision
      ? "Revise edit proposal"
      : "Generate safe edit proposal";

  task.status = "Running";
  task.currentPhase = isValidationRepair
    ? "Validation Repair Proposal Generation"
    : isRevision
      ? "Edit Proposal Revision"
      : "Edit Proposal Generation";
  task.reviewSummary = isValidationRepair
    ? "Generating a follow-up repair proposal from the validation repair brief. No files will be changed."
    : isRevision
      ? "Revising the rejected edit proposal from the latest task conversation. No files will be changed."
      : "Generating a safe edit proposal. No files will be changed.";
  setAgent(
    task,
    "Coder",
    "Active",
    isValidationRepair
      ? `Generating a validation repair proposal with ${currentModelProvider().info.name}.`
      : isRevision
      ? `Revising a safe edit proposal with ${currentModelProvider().info.name}.`
      : `Generating a safe edit proposal with ${currentModelProvider().info.name}.`
  );
  setAgent(task, "Reviewer", "Idle", "Waiting for a proposed diff to review.");
  upsertPlanStep(task, {
    id: stepID,
    title: stepTitle,
    status: "Active",
    summary: isValidationRepair
      ? "Using the validation repair brief to draft a follow-up proposal without touching files."
      : isRevision
      ? "Using the latest task conversation to revise the rejected proposal without touching files."
      : "Drafting a proposed diff without touching the working tree."
  });

  const started = event(
    isValidationRepair
      ? "edit.proposal.validation_repair.started"
      : isRevision ? "edit.proposal.revision.started" : "edit.proposal.started",
    isValidationRepair
      ? "Generating a validation repair proposal without applying file changes."
      : isRevision
      ? "Revising a rejected edit proposal without applying file changes."
      : "Generating a safe edit proposal without applying file changes."
  );
  started.createdAt = new Date().toISOString();
  saveAndBroadcast(task, started);

  const proposalResult = await createValidatedEditProposalWithRepair({
    task,
    previousProposal,
    sourceMessage,
    revisionNumber,
    validationRepairBrief: options.validationRepairBrief
  });
  const { proposal, repairAttempts } = proposalResult;
  proposal.requiresFileReview = true;
  proposal.fileDecisions = [];
  const validation = proposal.validation;
  if (!validation) {
    throw new Error("Generated edit proposal is missing runtime validation.");
  }
  if (previousProposal) {
    archiveEditProposalRevision(task, previousProposal);
  }
  task.editProposal = proposal;
  task.status = "Human Review";
  task.currentPhase =
    validation.status === "Ready" ? "Edit Proposal Review" : "Edit Proposal Validation Blocked";
  if (!options.preserveChangedFiles) {
    task.changedFiles = [];
  }
  task.reviewSummary =
    validation.status === "Ready"
      ? "Edit proposal ready and validated for review. No file changes have been applied."
      : validation.summary;
  setAgent(
    task,
    "Coder",
    validation.status === "Ready" ? "Done" : "Blocked",
    validation.status === "Ready"
      ? "Prepared a proposed diff without modifying files."
      : "Could not repair the proposal into an apply-ready shape."
  );
  setAgent(
    task,
    "Reviewer",
    validation.status === "Ready" ? "Active" : "Blocked",
    validation.status === "Ready"
      ? "Review the proposed file changes and validation result before applying."
      : "Review failed proposal validation checks before requesting another revision."
  );
  upsertPlanStep(task, {
    id: stepID,
    title: stepTitle,
    status: "Done",
    summary: isValidationRepair
      ? `Proposed validation repair revision ${proposal.revisionNumber} from repair brief ${options.validationRepairBrief?.id ?? "unknown"} with ${proposal.fileChanges.length} file change(s). ${repairSummary(repairAttempts)} No files changed.`
      : isRevision
      ? `Proposed revision ${proposal.revisionNumber} with ${proposal.fileChanges.length} file change(s). ${repairSummary(repairAttempts)} No files changed.`
      : `Proposed ${proposal.fileChanges.length} file change(s). ${repairSummary(repairAttempts)} No files changed.`
  });
  upsertPlanStep(task, {
    id: "validate-edit-proposal",
    title: "Validate edit proposal",
    status: validation.status === "Ready" ? "Done" : "Blocked",
    summary: validation.summary
  });
  if (repairAttempts > 0) {
    upsertPlanStep(task, {
      id: "repair-edit-proposal",
      title: "Repair edit proposal",
      status: validation.status === "Ready" ? "Done" : "Blocked",
      summary: validation.status === "Ready"
        ? `Used validation feedback to repair the proposal after ${repairAttempts} attempt(s).`
        : `Stopped after ${repairAttempts} automatic repair attempt(s): ${validation.summary}`
    });
  }
  upsertPlanStep(task, {
    id: "review-edit-proposal",
    title: "Review edit proposal",
    status: validation.status === "Ready" ? "Active" : "Blocked",
    summary: validation.status === "Ready"
      ? "Human review required before applying proposed file changes."
      : "Proposal is blocked; request changes before applying."
  });

  const ready = event(
    validation.status === "Ready"
      ? isValidationRepair
        ? "edit.proposal.validation_repair.ready"
        : isRevision ? "edit.proposal.revision.ready" : "edit.proposal.ready"
      : "edit.proposal.validation.blocked",
    validation.status === "Ready"
      ? isValidationRepair
        ? "Validation repair proposal is validated and ready for human review. No files changed."
        : isRevision
        ? "Revised edit proposal is validated and ready for human review. No files changed."
        : "Safe edit proposal is validated and ready for human review. No files changed."
      : validation.summary
  );
  ready.createdAt = proposal.generatedAt;
  saveAndBroadcast(task, ready);
  return task;
}

interface EditProposalGenerationOptions {
  task: ForgeTask;
  previousProposal?: EditProposal;
  sourceMessage?: TaskMessage;
  revisionNumber: number;
  validationRepairBrief?: ValidationRepairBrief;
}

interface EditProposalGenerationResult {
  proposal: EditProposal;
  repairAttempts: number;
}

async function createValidatedEditProposalWithRepair(
  options: EditProposalGenerationOptions
): Promise<EditProposalGenerationResult> {
  let previousProposal = options.previousProposal;
  let validationFeedback: EditProposalValidation | undefined;
  let revisionNumber = options.revisionNumber;
  let repairAttempts = 0;

  while (true) {
    const proposal = await currentModelProvider().createEditProposal({
      task: options.task,
      previousProposal,
      sourceMessage: options.sourceMessage,
      revisionNumber,
      repairAttempt: repairAttempts,
      validationFeedback,
      validationRepairBrief: options.validationRepairBrief
    });
    if (options.validationRepairBrief && !proposal.validationRepairBriefID) {
      proposal.validationRepairBriefID = options.validationRepairBrief.id;
    }
    proposal.validation = await buildEditProposalValidation(proposal.fileChanges);

    if (proposal.validation.status === "Ready" || repairAttempts >= editProposalRepairMaxAttempts) {
      return { proposal, repairAttempts };
    }

    const nextAttempt = repairAttempts + 1;
    const repairStarted = event(
      "edit.proposal.repair.started",
      `Proposal revision ${proposal.revisionNumber} failed validation; requesting repair ${nextAttempt}/${editProposalRepairMaxAttempts}. ${proposal.validation.summary}`
    );
    repairStarted.createdAt = proposal.validation.checkedAt;
    saveAndBroadcast(options.task, repairStarted);

    proposal.status = "Superseded";
    proposal.decidedAt = new Date().toISOString();
    proposal.decisionNote = `Superseded by automatic repair attempt ${nextAttempt}/${editProposalRepairMaxAttempts}.`;
    archiveEditProposalRevision(options.task, proposal);

    previousProposal = proposal;
    validationFeedback = proposal.validation;
    revisionNumber = proposal.revisionNumber + 1;
    repairAttempts = nextAttempt;

    upsertPlanStep(options.task, {
      id: "repair-edit-proposal",
      title: "Repair edit proposal",
      status: "Active",
      summary: `Using runtime validation feedback to request repair ${repairAttempts}/${editProposalRepairMaxAttempts}.`
    });
  }
}

function repairSummary(repairAttempts: number): string {
  if (repairAttempts === 0) {
    return "No automatic repair was needed.";
  }

  return `Automatic repair attempts: ${repairAttempts}.`;
}

function archiveEditProposalRevision(task: ForgeTask, proposal: EditProposal): void {
  if (!task.editProposalRevisions.some((candidate) => candidate.id === proposal.id)) {
    task.editProposalRevisions.push(structuredClone(proposal));
  }
}

async function validateEditProposal(taskID: string): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status !== "Proposed") {
    throw new HttpError(409, "A proposed edit is required before validation.");
  }

  const validation = await buildEditProposalValidation(task.editProposal.fileChanges);
  task.editProposal.validation = validation;
  task.status = "Human Review";
  task.currentPhase =
    validation.status === "Ready" ? "Edit Proposal Review" : "Edit Proposal Validation Blocked";
  task.reviewSummary = validation.summary;
  setAgent(
    task,
    "Reviewer",
    validation.status === "Ready" ? "Active" : "Blocked",
    validation.status === "Ready"
      ? "Proposal validation passed; ready for human review."
      : "Proposal validation is blocked; review the failed checks."
  );
  upsertPlanStep(task, {
    id: "validate-edit-proposal",
    title: "Validate edit proposal",
    status: validation.status === "Ready" ? "Done" : "Blocked",
    summary: validation.summary
  });

  const validated = event(
    validation.status === "Ready" ? "edit.proposal.validated" : "edit.proposal.validation.blocked",
    validation.summary
  );
  validated.createdAt = validation.checkedAt;
  saveAndBroadcast(task, validated);
  return task;
}

async function applyEditProposal(
  taskID: string,
  input: EditProposalDecisionRequest
): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status !== "Proposed") {
    throw new HttpError(409, "A proposed edit is required before applying changes.");
  }

  if (task.editProposal.requiresFileReview) {
    const approvedIDs = new Set(
      (task.editProposal.fileDecisions ?? [])
        .filter((decision) => decision.decision === "Approved")
        .map((decision) => decision.fileChangeID)
    );
    const pendingPaths = task.editProposal.fileChanges
      .filter((change) => !approvedIDs.has(change.id))
      .map((change) => change.path);
    if (pendingPaths.length > 0) {
      throw new HttpError(409, `Every proposed file must be approved before apply: ${pendingPaths.join(", ")}`);
    }
  }

  const validation = await buildEditProposalValidation(task.editProposal.fileChanges);
  task.editProposal.validation = validation;
  if (validation.status !== "Ready") {
    task.status = "Human Review";
    task.currentPhase = "Edit Proposal Validation Blocked";
    task.reviewSummary = validation.summary;
    setAgent(task, "Coder", "Blocked", "Cannot apply until proposal validation passes.");
    setAgent(task, "Reviewer", "Blocked", "Review failed proposal validation checks.");
    upsertPlanStep(task, {
      id: "validate-edit-proposal",
      title: "Validate edit proposal",
      status: "Blocked",
      summary: validation.summary
    });

    const blocked = event("edit.proposal.validation.blocked", validation.summary);
    blocked.createdAt = validation.checkedAt;
    saveAndBroadcast(task, blocked);
    return task;
  }

  task.status = "Running";
  task.currentPhase = "Applying Edit Proposal";
  task.reviewSummary = "Applying the approved edit proposal with restricted file operations.";
  setAgent(task, "Coder", "Active", "Applying the approved restricted edit proposal.");
  setAgent(task, "Reviewer", "Active", "Watching the controlled apply step.");
  upsertPlanStep(task, {
    id: "apply-edit-proposal",
    title: "Apply edit proposal",
    status: "Active",
    summary: "Applying reviewed file changes with repo-local path checks."
  });
  upsertPlanStep(task, {
    id: "validate-edit-proposal",
    title: "Validate edit proposal",
    status: "Done",
    summary: validation.summary
  });

  const started = event("edit.proposal.apply.started", "Applying approved edit proposal.");
  started.createdAt = new Date().toISOString();
  task.editProposal.applyTransaction = {
    id: randomUUID(),
    kind: "Apply",
    status: "Running",
    journalVersion: 1,
    paths: task.editProposal.fileChanges.map((change) => change.path),
    summary: "Preflight passed; applying the reviewed cross-file change set.",
    startedAt: started.createdAt
  };
  task.editProposal.appliedFileChanges = [];
  saveAndBroadcast(task, started);

  const appliedFileChanges: AppliedFileChange[] = [];
  try {
    for (const change of task.editProposal.fileChanges) {
      const appliedChange = await applyProposedFileChange(task.editProposal.id, change, (preparedChange) => {
        appliedFileChanges.push(preparedChange);
        task.editProposal!.appliedFileChanges = appliedFileChanges;
        task.editProposal!.applyTransaction!.summary =
          `Write-ahead journal persisted ${appliedFileChanges.length}/${task.editProposal!.fileChanges.length} file change(s).`;
        saveTask(task);
      });
      appliedChange.applyVerifiedAt = await verifyAppliedFileChange(appliedChange);
      task.editProposal.appliedFileChanges = appliedFileChanges;
      saveTask(task);
    }

    const now = new Date().toISOString();
    task.editProposal.applyTransaction.status = "Completed";
    task.editProposal.applyTransaction.summary = `Applied and hash-verified ${appliedFileChanges.length} file change(s).`;
    task.editProposal.applyTransaction.completedAt = now;
    task.editProposal.applyTransaction.verifiedAt = now;
    task.editProposal.status = "Applied";
    task.editProposal.decidedAt = now;
    task.editProposal.decisionNote = input.note?.trim() || undefined;
    task.editProposal.appliedFileChanges = appliedFileChanges;
    const rerunEvidence = createOrUpdateCommandRerunEvidenceForAppliedProposal(task, task.editProposal, now);
    task.status = "Testing";
    task.currentPhase = "Awaiting Validation";
    task.changedFiles = [...new Set(appliedFileChanges.map((change) => change.path))];
    task.approvals.push({
      id: randomUUID(),
      action: "Apply Edit Proposal",
      decision: "Approved",
      summary: `Applied ${task.changedFiles.length} reviewed file change(s).`,
      decidedAt: now,
      userNote: input.note?.trim() || undefined
    });
    task.reviewSummary = "Approved edit proposal applied. Running controlled validation.";
    setAgent(task, "Coder", "Done", "Applied the reviewed edit proposal.");
    setAgent(task, "Tester", "Active", "Running controlled post-apply validation.");
    setAgent(task, "Reviewer", "Idle", "Waiting for validation results.");
    upsertPlanStep(task, {
      id: "review-edit-proposal",
      title: "Review edit proposal",
      status: "Done",
      summary: "Human review completed by applying the proposal."
    });
    upsertPlanStep(task, {
      id: "apply-edit-proposal",
      title: "Apply edit proposal",
      status: "Done",
      summary: `Applied ${task.changedFiles.join(", ")}.`
    });

    const applied = event("edit.proposal.applied", "Approved edit proposal was applied to the workspace.");
    applied.createdAt = now;
    saveAndBroadcast(task, applied);
    if (rerunEvidence) {
      const ready = event(
        "task.command.rerun_evidence.ready",
        `Self-fix applied. Rerun ${rerunEvidence.commandName} to verify the repair.`
      );
      ready.createdAt = now;
      saveAndBroadcast(task, ready);
    }
    return runValidation(task.id, "PostApply");
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error);
    const recovery = await recoverPartialApply(appliedFileChanges);
    const now = new Date().toISOString();
    task.editProposal.applyTransaction.status = recovery.succeeded ? "Recovered" : "RecoveryFailed";
    task.editProposal.applyTransaction.completedAt = now;
    task.editProposal.applyTransaction.recoverySummary = recovery.summary;
    task.editProposal.applyTransaction.summary = recovery.succeeded
      ? "Cross-file apply failed; already-written files were restored and verified."
      : "Cross-file apply failed and automatic recovery could not restore every written file.";
    if (recovery.succeeded) {
      task.editProposal.applyTransaction.verifiedAt = now;
      task.editProposal.status = "Proposed";
      task.editProposal.decidedAt = undefined;
      task.editProposal.decisionNote = undefined;
      task.changedFiles = [];
      const applyApproval = [...task.approvals].reverse().find((approval) => approval.action === "Apply Edit Proposal");
      if (applyApproval) {
        applyApproval.summary = `Apply was approved but automatically recovered after a cross-file failure: ${recovery.summary}`;
      }
    }
    task.editProposal.appliedFileChanges = appliedFileChanges;
    const message = `${originalMessage} ${recovery.summary}`.trim();
    task.status = "Failed";
    task.currentPhase = recovery.succeeded ? "Apply Recovered" : "Apply Recovery Required";
    task.reviewSummary = message;
    setAgent(task, "Coder", "Blocked", "Could not apply the approved edit proposal.");
    setAgent(task, "Reviewer", "Active", "Review the apply failure before retrying.");
    upsertPlanStep(task, {
      id: "apply-edit-proposal",
      title: "Apply edit proposal",
      status: "Blocked",
      summary: message
    });

    const failed = event(recovery.succeeded ? "edit.proposal.apply.recovered" : "edit.proposal.apply.recovery_failed", message);
    failed.createdAt = now;
    saveAndBroadcast(task, failed);
    throw new HttpError(error instanceof HttpError ? error.status : 500, message);
  }
}

async function rollbackEditProposal(
  taskID: string,
  input: EditProposalDecisionRequest
): Promise<ForgeTask> {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status !== "Applied") {
    throw new HttpError(409, "An applied edit proposal is required before rollback.");
  }

  const appliedFileChanges = task.editProposal.appliedFileChanges ?? [];
  if (appliedFileChanges.length === 0) {
    throw new HttpError(409, "Applied proposal does not include rollback metadata.");
  }

  task.status = "Running";
  task.currentPhase = "Rolling Back Edit Proposal";
  task.reviewSummary = "Rolling back the applied edit proposal after verifying current file hashes.";
  setAgent(task, "Coder", "Active", "Rolling back the applied edit proposal.");
  setAgent(task, "Reviewer", "Active", "Watching the guarded rollback step.");
  upsertPlanStep(task, {
    id: "rollback-edit-proposal",
    title: "Rollback edit proposal",
    status: "Active",
    summary: "Verifying apply hashes and restoring rollback snapshots."
  });

  const started = event("edit.proposal.rollback.started", "Rolling back applied edit proposal.");
  started.createdAt = new Date().toISOString();
  task.editProposal.rollbackTransaction = {
    id: randomUUID(),
    kind: "Rollback",
    status: "Running",
    paths: appliedFileChanges.map((change) => change.path),
    summary: "Verifying applied hashes before restoring the reviewed change set.",
    startedAt: started.createdAt
  };
  saveAndBroadcast(task, started);

  let attemptedRollbackOperations: PreparedRollbackOperation[] = [];
  try {
    const rollbackOperations: PreparedRollbackOperation[] = [];
    for (const appliedChange of appliedFileChanges) {
      rollbackOperations.push(await prepareAppliedFileRollback(appliedChange));
    }

    for (const operation of rollbackOperations) {
      attemptedRollbackOperations.push(operation);
      await operation.rollback();
      await operation.verifyRolledBack();
    }

    const now = new Date().toISOString();
    for (const appliedChange of appliedFileChanges) {
      appliedChange.rolledBackAt = now;
      appliedChange.rollbackVerifiedAt = now;
    }

    const rolledBackFiles = [...new Set(rollbackOperations.map((operation) => operation.relativePath))];
    task.editProposal.status = "RolledBack";
    task.editProposal.rollbackTransaction.status = "Completed";
    task.editProposal.rollbackTransaction.summary = `Restored and hash-verified ${rollbackOperations.length} file change(s).`;
    task.editProposal.rollbackTransaction.completedAt = now;
    task.editProposal.rollbackTransaction.verifiedAt = now;
    task.editProposal.rolledBackAt = now;
    task.editProposal.rollbackNote = input.note?.trim() || undefined;
    task.status = "Human Review";
    task.currentPhase = "Rollback Applied";
    task.changedFiles = rolledBackFiles;
    task.approvals.push({
      id: randomUUID(),
      action: "Rollback Edit Proposal",
      decision: "Approved",
      summary: `Rolled back ${rolledBackFiles.length} applied file change(s).`,
      targetID: task.editProposal.id,
      decidedAt: now,
      userNote: input.note?.trim() || undefined
    });
    task.reviewSummary = `Rollback applied for ${rolledBackFiles.join(", ")}. Review the working tree before continuing.`;
    setAgent(task, "Coder", "Done", "Rolled back the applied edit proposal.");
    setAgent(task, "Tester", "Idle", "Waiting for a validation request after rollback.");
    setAgent(task, "Reviewer", "Active", "Review the rolled-back working tree.");
    upsertPlanStep(task, {
      id: "rollback-edit-proposal",
      title: "Rollback edit proposal",
      status: "Done",
      summary: `Rolled back ${rolledBackFiles.join(", ")}.`
    });

    const rolledBack = event("edit.proposal.rolled_back", "Applied edit proposal was rolled back.");
    rolledBack.createdAt = now;
    saveAndBroadcast(task, rolledBack);
    return task;
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error);
    const recovery = await recoverPartialRollback(attemptedRollbackOperations);
    const now = new Date().toISOString();
    task.editProposal.rollbackTransaction.status = recovery.succeeded ? "Recovered" : "RecoveryFailed";
    task.editProposal.rollbackTransaction.completedAt = now;
    task.editProposal.rollbackTransaction.recoverySummary = recovery.summary;
    task.editProposal.rollbackTransaction.summary = recovery.succeeded
      ? "Rollback failed; the already-restored files were returned to the verified applied state."
      : "Rollback failed and automatic recovery could not restore the applied state.";
    if (recovery.succeeded) {
      task.editProposal.rollbackTransaction.verifiedAt = now;
    }
    const message = `${originalMessage} ${recovery.summary}`.trim();
    task.status = "Failed";
    task.currentPhase = recovery.succeeded ? "Rollback Recovered" : "Rollback Recovery Required";
    task.reviewSummary = message;
    setAgent(task, "Coder", "Blocked", "Could not roll back the applied edit proposal.");
    setAgent(task, "Reviewer", "Active", "Review the rollback failure before retrying.");
    upsertPlanStep(task, {
      id: "rollback-edit-proposal",
      title: "Rollback edit proposal",
      status: "Blocked",
      summary: message
    });

    const failed = event(recovery.succeeded ? "edit.proposal.rollback.recovered" : "edit.proposal.rollback.recovery_failed", message);
    failed.createdAt = now;
    saveAndBroadcast(task, failed);
    throw new HttpError(error instanceof HttpError ? error.status : 500, message);
  }
}

function createOrUpdateCommandRerunEvidenceForAppliedProposal(
  task: ForgeTask,
  proposal: EditProposal,
  appliedAt: string
): CommandRerunEvidence | undefined {
  if (!proposal.validationRepairBriefID) {
    return undefined;
  }

  const repairBrief = task.validationRepairBriefs.find((brief) => brief.id === proposal.validationRepairBriefID);
  if (!repairBrief?.taskCommandRunID) {
    return undefined;
  }

  const failedRun = task.taskCommandRuns.find((run) => run.id === repairBrief.taskCommandRunID);
  if (!failedRun || failedRun.status !== "Failed") {
    return undefined;
  }

  const summary = `Repair proposal applied. Rerun ${failedRun.name} to verify the self-fix.`;
  let evidence = task.commandRerunEvidence.find((candidate) => candidate.repairProposalID === proposal.id);
  if (!evidence) {
    evidence = {
      id: randomUUID(),
      sourceTaskCommandRunID: failedRun.id,
      validationRepairBriefID: repairBrief.id,
      repairProposalID: proposal.id,
      repairAppliedAt: appliedAt,
      commandID: failedRun.commandID,
      commandName: failedRun.name,
      status: "Ready",
      summary,
      createdAt: appliedAt,
      updatedAt: appliedAt
    };
    task.commandRerunEvidence.push(evidence);
  } else {
    evidence.repairAppliedAt = appliedAt;
    evidence.status = "Ready";
    evidence.summary = summary;
    evidence.updatedAt = appliedAt;
  }

  upsertPlanStep(task, {
    id: `rerun-repair-command-${failedRun.commandID}`,
    title: "Rerun repaired command",
    status: "Active",
    summary
  });
  setAgent(task, "Tester", "Ready", `Ready to rerun ${failedRun.command}.`);
  return evidence;
}

function findCommandRerunEvidenceForRequest(
  task: ForgeTask,
  input: RerunRepairCommandRequest
): CommandRerunEvidence | undefined {
  const requestedID = input.commandRerunEvidenceID?.trim();
  if (requestedID) {
    const evidence = task.commandRerunEvidence.find((candidate) => candidate.id === requestedID);
    if (!evidence) {
      throw new HttpError(404, `Repair command rerun evidence not found: ${requestedID}`);
    }
    return evidence;
  }

  return latestRunnableCommandRerunEvidence(task);
}

function latestRunnableCommandRerunEvidence(task: ForgeTask): CommandRerunEvidence | undefined {
  return [...task.commandRerunEvidence]
    .reverse()
    .find((candidate) => candidate.status === "Ready" || candidate.status === "Failed");
}

function findEditProposalByID(task: ForgeTask, proposalID: string): EditProposal | undefined {
  if (task.editProposal?.id === proposalID) {
    return task.editProposal;
  }

  return [...task.editProposalRevisions].reverse().find((proposal) => proposal.id === proposalID);
}

function summarizeCommandRerunEvidence(rerun: TaskCommandRun): string {
  switch (rerun.status) {
  case "Passed":
    return `Self-fix verified: ${rerun.name} passed after applying the repair proposal.`;
  case "Cancelled":
    return `Self-fix rerun cancelled: ${rerun.outputSummary}`;
  case "Failed":
    return `Self-fix rerun failed: ${rerun.outputSummary}`;
  case "Running":
    return `Self-fix rerun is still running: ${rerun.name}.`;
  }
}

async function reviewEditProposalFile(
  taskID: string,
  input: EditProposalFileReviewRequest
): Promise<ForgeTask> {
  const task = requireTask(taskID);
  const proposal = task.editProposal;
  if (proposal?.status !== "Proposed") {
    throw new HttpError(409, "A proposed edit is required before reviewing a file.");
  }
  const fileChange = proposal.fileChanges.find((change) => change.id === input.fileChangeID?.trim());
  if (!fileChange) {
    throw new HttpError(404, `Proposed file change not found: ${input.fileChangeID}`);
  }
  if (input.decision !== "Approved" && input.decision !== "ChangesRequested") {
    throw new HttpError(400, "File review decision must be Approved or ChangesRequested.");
  }

  const decidedAt = new Date().toISOString();
  const note = input.note?.trim() || undefined;
  const decisions = proposal.fileDecisions ?? [];
  const nextDecision = {
    fileChangeID: fileChange.id,
    path: fileChange.path,
    decision: input.decision,
    note,
    decidedAt
  };
  const existingIndex = decisions.findIndex((decision) => decision.fileChangeID === fileChange.id);
  if (existingIndex >= 0) {
    decisions[existingIndex] = nextDecision;
  } else {
    decisions.push(nextDecision);
  }
  proposal.requiresFileReview = true;
  proposal.fileDecisions = decisions;
  task.approvals.push({
    id: randomUUID(),
    action: "Review Edit Proposal File",
    decision: input.decision === "Approved" ? "Approved" : "Rejected",
    summary: `${input.decision === "Approved" ? "Approved" : "Requested changes for"} ${fileChange.path}.`,
    targetID: fileChange.id,
    decidedAt,
    userNote: note
  });

  if (input.decision === "ChangesRequested") {
    const previousProposal = proposal;
    rejectEditProposal(taskID, { note: note ?? `Revise the proposed change for ${fileChange.path}.` });
    return createEditProposalForTask(task, "Revision", previousProposal);
  }

  const approvedCount = decisions.filter((decision) => decision.decision === "Approved").length;
  task.reviewSummary = `Approved ${fileChange.path} (${approvedCount}/${proposal.fileChanges.length} proposed files).`;
  task.status = "Human Review";
  task.currentPhase = "Edit Proposal Review";
  const reviewed = event("edit.proposal.file.approved", task.reviewSummary);
  reviewed.createdAt = decidedAt;
  saveAndBroadcast(task, reviewed);
  return task;
}

function rejectEditProposal(taskID: string, input: EditProposalDecisionRequest): ForgeTask {
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task not found: ${taskID}`);
  }

  if (task.editProposal?.status !== "Proposed") {
    throw new HttpError(409, "A proposed edit is required before requesting changes.");
  }

  const now = new Date().toISOString();
  task.editProposal.status = "Rejected";
  task.editProposal.decidedAt = now;
  task.editProposal.decisionNote = input.note?.trim() || undefined;
  task.status = "Human Review";
  task.currentPhase = "Edit Proposal Rejected";
  task.changedFiles = [];
  task.approvals.push({
    id: randomUUID(),
    action: "Reject Edit Proposal",
    decision: "Rejected",
    summary: "Rejected the proposed edit without changing files.",
    decidedAt: now,
    userNote: input.note?.trim() || undefined
  });
  task.reviewSummary = "Edit proposal rejected. No file changes were applied; another proposal can be generated.";
  setAgent(task, "Coder", "Ready", "Waiting to generate a revised edit proposal.");
  setAgent(task, "Reviewer", "Done", "Rejected the current proposed diff.");
  upsertPlanStep(task, {
    id: "review-edit-proposal",
    title: "Review edit proposal",
    status: "Done",
    summary: "Human review rejected the proposal without applying changes."
  });
  upsertPlanStep(task, {
    id: "revise-edit-proposal",
    title: "Revise edit proposal",
    status: "Active",
    summary: "A new edit proposal can be generated after rejection."
  });

  const rejected = event("edit.proposal.rejected", "Edit proposal rejected. No files changed.");
  rejected.createdAt = now;
  saveAndBroadcast(task, rejected);
  return task;
}

function requireTask(taskID: string): ForgeTask {
  const task = tasks.get(taskID);
  if (!task) throw new HttpError(404, `Task not found: ${taskID}`);
  return task;
}

return {
  generateEditProposal,
  reviseEditProposal,
  generateValidationRepairProposal,
  validateEditProposal,
  applyEditProposal,
  rollbackEditProposal,
  reviewEditProposalFile,
  rejectEditProposal,
  findCommandRerunEvidenceForRequest,
  latestRunnableCommandRerunEvidence,
  findEditProposalByID,
  summarizeCommandRerunEvidence
};
}
