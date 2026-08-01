import { randomUUID } from "node:crypto";

import { HttpError } from "../runtime/runtimeError.js";
import { parseGitHubRemote } from "../githubRemote.js";
import type {
  ApprovalRecord,
  ForgeTask,
  GitBranchPreview,
  GitBranchPublishPreview,
  GitBranchPublishRequest,
  GitBranchPublishResult,
  GitBranchRequest,
  GitBranchResult,
  GitCommitPreview,
  GitCommitToPush,
  GitCreateCommitRequest,
  GitCreateCommitResult,
  GitFileChange,
  GitPullRequestPreview,
  GitPullRequestPublishRequest,
  GitPullRequestResult,
  GitPullRequestStatusRequest,
  GitPushPreview,
  GitPushRequest,
  GitPushResult,
  GitStatusSnapshot,
  RuntimeEvent,
  TaskPullRequest
} from "../types.js";
import type { GitCommand } from "./gitCommand.js";
import {
  gitFileChangeFromNameStatus,
  gitPushFailureMessage,
  isSafeGitChange,
  mergeGitFileChanges,
  normalizeGitDiffPath,
  parseGitRangeNumstat,
  parseGitUpstream,
  summarizeGitCommandOutput,
  summarizeRemoteURLKind
} from "./gitParsers.js";

export function createGitBranchService(options: {
  runGitCommand: GitCommand;
  getGitStatusSnapshot: () => Promise<GitStatusSnapshot>;
  tasks: Map<string, ForgeTask>;
  saveTask: (task: ForgeTask) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
  githubApiBase: string;
}) {
const { runGitCommand, getGitStatusSnapshot, tasks, emit, githubApiBase } = options;
const taskStore = { saveTask: options.saveTask };

async function getGitBranchPreview(
  rawTaskID: string | null,
  rawTargetBranch: string | null
): Promise<GitBranchPreview> {
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();
  const task = rawTaskID ? tasks.get(rawTaskID) : undefined;
  const taskMissing = Boolean(rawTaskID && !task);
  const operationBoundary = "Review artifact only. Forge has not created, switched, deleted, pushed, or reset branches.";
  const fallbackBaseBranch = "main";
  const fallbackTargetBranch = normalizeGitBranchTarget(rawTargetBranch, suggestPullRequestBranchName(task, status.branch, fallbackBaseBranch));

  if (!status.isRepository || !status.root) {
    const preflight = unavailableGitBranchPreflight(status, fallbackBaseBranch, fallbackTargetBranch);
    return {
      generatedAt,
      readiness: "Blocked",
      summary: "Branch preparation is blocked because git status is unavailable.",
      preflight,
      expectedHead: status.head,
      currentBranch: status.branch,
      baseBranch: fallbackBaseBranch,
      targetBranch: fallbackTargetBranch,
      mode: "CreateBranch",
      branchExists: false,
      isDirty: status.isDirty,
      changedFiles: [],
      relatedTask: undefined,
      riskNotes: taskMissing ? [`Task ${rawTaskID} was not found.`] : [],
      blockers: [status.error ?? "Workspace is not inside a git repository."],
      operationBoundary
    };
  }

  const upstreamParts = parseGitUpstream(status.upstream);
  const remote = upstreamParts?.remote ?? await getFirstGitRemote(status.root);
  const baseBranch = await getGitDefaultBaseBranch(status.root, remote ?? "origin");
  const targetBranch = normalizeGitBranchTarget(rawTargetBranch, suggestPullRequestBranchName(task, status.branch, baseBranch));
  const branchNameIssue = await gitBranchNameIssue(status.root, targetBranch);
  const branchExists = branchNameIssue ? false : await localGitBranchExists(status.root, targetBranch);
  const remoteBranchExists = branchNameIssue || !remote ? false : await remoteGitBranchExists(status.root, remote, targetBranch);
  const mode = status.branch === targetBranch
    ? "AlreadyOnBranch"
    : branchExists
      ? "SwitchBranch"
      : "CreateBranch";
  const blockers = gitBranchPreviewBlockers(status, targetBranch, baseBranch, mode, branchNameIssue);
  const preflight = gitBranchPreflight(
    status,
    targetBranch,
    baseBranch,
    mode,
    branchNameIssue,
    branchExists,
    remoteBranchExists,
    remote,
    blockers
  );
  const riskNotes = gitBranchRiskNotes(status, task, taskMissing, mode, remoteBranchExists, remote);
  const readiness: GitBranchPreview["readiness"] = blockers.length > 0
    ? "Blocked"
    : riskNotes.length > 0
      ? "NeedsReview"
      : "Ready";

  return {
    generatedAt,
    readiness,
    summary: gitBranchPreviewSummary(status, targetBranch, mode, readiness),
    preflight,
    expectedHead: status.head,
    currentBranch: status.branch,
    baseBranch,
    targetBranch,
    mode,
    branchExists,
    isDirty: status.isDirty,
    changedFiles: status.changedFiles,
    relatedTask: task ? {
      id: task.id,
      title: task.title,
      status: task.status,
      currentPhase: task.currentPhase,
      summary: task.reviewSummary ?? task.objective
    } : undefined,
    riskNotes,
    blockers,
    operationBoundary
  };
}


async function createOrSwitchGitBranch(input: GitBranchRequest): Promise<GitBranchResult> {
  const request = normalizeGitBranchRequest(input);
  const preview = await getGitBranchPreview(request.taskID || null, request.targetBranch);
  const generatedAt = new Date().toISOString();

  if (!preview.expectedHead || preview.expectedHead !== request.expectedHead) {
    throw new HttpError(409, `Git HEAD changed since branch review. Expected ${request.expectedHead}, current ${preview.expectedHead ?? "unknown"}.`);
  }

  if (!preview.currentBranch || preview.currentBranch !== request.expectedCurrentBranch) {
    throw new HttpError(409, `Git branch changed since branch review. Expected ${request.expectedCurrentBranch}, current ${preview.currentBranch ?? "unknown"}.`);
  }

  if (preview.targetBranch !== request.targetBranch) {
    throw new HttpError(409, `Target branch changed since branch review. Expected ${request.targetBranch}, current ${preview.targetBranch}.`);
  }

  if (preview.mode !== request.mode) {
    throw new HttpError(409, `Branch action changed since review. Expected ${request.mode}, current ${preview.mode}.`);
  }

  if (preview.blockers.length > 0) {
    throw new HttpError(409, `Branch action is blocked: ${preview.blockers.join(" ")}`);
  }

  const status = await getGitStatusSnapshot();
  if (!status.isRepository || !status.root) {
    throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
  }

  const args = request.mode === "CreateBranch"
    ? ["switch", "--create", request.targetBranch]
    : ["switch", request.targetBranch];
  const branchResult = await runGitCommand(args, status.root, 96_000);
  if (branchResult.exitCode !== 0) {
    throw new HttpError(409, branchResult.output.trim() || "git branch action failed.");
  }

  const relatedTask = recordGitBranchOnTask(request.taskID, request.mode, preview.currentBranch, request.targetBranch);
  const actionLabel = request.mode === "CreateBranch" ? "Created" : "Switched to";

  return {
    generatedAt,
    previousBranch: preview.currentBranch,
    branch: request.targetBranch,
    mode: request.mode,
    summary: `${actionLabel} branch ${request.targetBranch}.`,
    outputSummary: summarizeGitCommandOutput(branchResult.output),
    relatedTask,
    operationBoundary: "Branch action completed. Forge did not commit, push, merge, reset, delete branches, or publish a PR."
  };
}


function normalizeGitBranchRequest(input: GitBranchRequest): Required<GitBranchRequest> {
  if (!isRecord(input)) {
    throw new HttpError(400, "Git branch request must be an object.");
  }

  if (input.mode !== "CreateBranch" && input.mode !== "SwitchBranch") {
    throw new HttpError(400, "Git branch mode must be CreateBranch or SwitchBranch.");
  }

  if (input.confirmation !== input.mode) {
    throw new HttpError(400, `Git branch action requires explicit confirmation: ${input.mode}.`);
  }

  return {
    taskID: typeof input.taskID === "string" ? input.taskID.trim() : "",
    expectedHead: normalizeSingleLineField(input.expectedHead, "expectedHead", 4, 64),
    expectedCurrentBranch: normalizeSingleLineField(input.expectedCurrentBranch, "expectedCurrentBranch", 1, 200),
    targetBranch: normalizeGitBranchTarget(input.targetBranch, ""),
    mode: input.mode,
    confirmation: input.confirmation
  };
}


function normalizeGitBranchTarget(rawTargetBranch: unknown, fallback: string): string {
  const source = typeof rawTargetBranch === "string" && rawTargetBranch.trim()
    ? rawTargetBranch
    : fallback;
  const targetBranch = normalizeSingleLineField(source, "targetBranch", 1, 120)
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");

  if (!targetBranch) {
    throw new HttpError(400, "targetBranch is required.");
  }

  if (targetBranch.startsWith("-")) {
    throw new HttpError(400, "targetBranch must not start with a dash.");
  }

  return targetBranch;
}


async function gitBranchNameIssue(gitRoot: string, targetBranch: string): Promise<string | undefined> {
  const result = await runGitCommand(["check-ref-format", "--branch", targetBranch], gitRoot, 8_000);
  if (result.exitCode === 0) {
    return undefined;
  }

  return result.output.trim() || `Invalid git branch name: ${targetBranch}`;
}


async function localGitBranchExists(gitRoot: string, targetBranch: string): Promise<boolean> {
  const result = await runGitCommand([
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${targetBranch}`
  ], gitRoot, 8_000);
  return result.exitCode === 0;
}


async function remoteGitBranchExists(gitRoot: string, remote: string, targetBranch: string): Promise<boolean> {
  const localTrackingResult = await runGitCommand([
    "show-ref",
    "--verify",
    "--quiet",
    `refs/remotes/${remote}/${targetBranch}`
  ], gitRoot, 8_000);
  if (localTrackingResult.exitCode === 0) {
    return true;
  }

  const remoteResult = await runGitCommand([
    "ls-remote",
    "--heads",
    remote,
    targetBranch
  ], gitRoot, 16_000);
  return remoteResult.exitCode === 0 && remoteResult.output.trim().length > 0;
}


function unavailableGitBranchPreflight(
  status: GitStatusSnapshot,
  baseBranch: string,
  targetBranch: string
): NonNullable<GitBranchPreview["preflight"]> {
  return {
    targetStatus: targetBranch === baseBranch ? "DefaultBranch" : "Valid",
    targetSummary: "Target branch could not be fully inspected because git status is unavailable.",
    currentBranchStatus: status.branch && !status.branch.startsWith("HEAD") ? "Ready" : "Unknown",
    currentBranchSummary: status.branch
      ? `Current checkout reports ${status.branch}.`
      : "Current branch could not be resolved.",
    worktreeStatus: status.isDirty ? "DirtyBlocked" : "Clean",
    worktreeSummary: status.isDirty
      ? "Working tree state could not be safely inspected for branch changes."
      : "Working tree did not report local changes.",
    existingBranchStatus: "Invalid",
    existingBranchSummary: "Existing local and remote branch state could not be inspected.",
    actionReadiness: "Blocked",
    actionReadinessSummary: "Resolve git repository access before creating or switching branches."
  };
}


function gitBranchPreflight(
  status: GitStatusSnapshot,
  targetBranch: string,
  baseBranch: string,
  mode: GitBranchPreview["mode"],
  branchNameIssue: string | undefined,
  branchExists: boolean,
  remoteBranchExists: boolean,
  remote: string | undefined,
  blockers: string[]
): NonNullable<GitBranchPreview["preflight"]> {
  const targetStatus = branchNameIssue
    ? "Invalid"
    : targetBranch === baseBranch
      ? "DefaultBranch"
      : mode === "AlreadyOnBranch"
        ? "CurrentBranch"
        : "Valid";
  const currentBranchStatus = branchCurrentBranchStatus(status, baseBranch);
  const worktreeStatus = branchWorktreeStatus(status, mode);
  const existingBranchStatus = branchExistingBranchStatus(mode, branchNameIssue, branchExists, remoteBranchExists);
  const actionReadiness: NonNullable<GitBranchPreview["preflight"]>["actionReadiness"] = blockers.length > 0
    ? "Blocked"
    : mode === "CreateBranch" && (status.isDirty || remoteBranchExists)
      ? "NeedsReview"
      : "Ready";

  return {
    targetStatus,
    targetSummary: branchTargetSummary(targetBranch, baseBranch, targetStatus, branchNameIssue),
    currentBranchStatus,
    currentBranchSummary: branchCurrentBranchSummary(status, baseBranch, currentBranchStatus),
    worktreeStatus,
    worktreeSummary: branchWorktreeSummary(status, mode, worktreeStatus),
    existingBranchStatus,
    existingBranchSummary: branchExistingBranchSummary(targetBranch, remote, existingBranchStatus),
    actionReadiness,
    actionReadinessSummary: branchActionReadinessSummary(blockers, mode, actionReadiness)
  };
}


function branchCurrentBranchStatus(
  status: GitStatusSnapshot,
  baseBranch: string
): NonNullable<GitBranchPreview["preflight"]>["currentBranchStatus"] {
  if (!status.branch) {
    return "Unknown";
  }

  if (status.branch.startsWith("HEAD")) {
    return "Detached";
  }

  if (status.branch === baseBranch) {
    return "DefaultBranch";
  }

  return "Ready";
}


function branchCurrentBranchSummary(
  status: GitStatusSnapshot,
  baseBranch: string,
  currentBranchStatus: NonNullable<GitBranchPreview["preflight"]>["currentBranchStatus"]
): string {
  switch (currentBranchStatus) {
  case "DefaultBranch":
    return `Current branch is the default base branch ${baseBranch}; creating a task branch is the expected next step.`;
  case "Detached":
    return "Current checkout is detached; branch creation can attach work to a named branch.";
  case "Ready":
    return `Current branch ${status.branch} is available as the source for this branch action.`;
  default:
    return "Current branch could not be resolved.";
  }
}


function branchWorktreeStatus(
  status: GitStatusSnapshot,
  mode: GitBranchPreview["mode"]
): NonNullable<GitBranchPreview["preflight"]>["worktreeStatus"] {
  if (!status.isDirty) {
    return "Clean";
  }

  return mode === "CreateBranch" ? "DirtyAllowed" : "DirtyBlocked";
}


function branchWorktreeSummary(
  status: GitStatusSnapshot,
  mode: GitBranchPreview["mode"],
  worktreeStatus: NonNullable<GitBranchPreview["preflight"]>["worktreeStatus"]
): string {
  if (worktreeStatus === "Clean") {
    return "Working tree is clean for this branch action.";
  }

  if (worktreeStatus === "DirtyAllowed") {
    return `${status.changedFiles.length} local change(s) will carry onto the new branch.`;
  }

  if (mode === "AlreadyOnBranch") {
    return "No branch switch is needed while local changes are present.";
  }

  return "Switching to an existing branch is blocked until local changes are committed, stashed, or otherwise resolved.";
}


function branchExistingBranchStatus(
  mode: GitBranchPreview["mode"],
  branchNameIssue: string | undefined,
  branchExists: boolean,
  remoteBranchExists: boolean
): NonNullable<GitBranchPreview["preflight"]>["existingBranchStatus"] {
  if (branchNameIssue) {
    return "Invalid";
  }

  if (mode === "AlreadyOnBranch") {
    return "CurrentBranch";
  }

  if (branchExists) {
    return "ExistingLocal";
  }

  if (remoteBranchExists) {
    return "RemoteCollision";
  }

  return "NewLocal";
}


function branchTargetSummary(
  targetBranch: string,
  baseBranch: string,
  targetStatus: NonNullable<GitBranchPreview["preflight"]>["targetStatus"],
  branchNameIssue: string | undefined
): string {
  switch (targetStatus) {
  case "Invalid":
    return branchNameIssue ?? `Target branch ${targetBranch} is not a valid git branch name.`;
  case "DefaultBranch":
    return `Target branch ${targetBranch} is the default base branch ${baseBranch}; choose a task branch instead.`;
  case "CurrentBranch":
    return `Target branch ${targetBranch} is already checked out.`;
  default:
    return `Target branch ${targetBranch} passed local branch-name validation.`;
  }
}


function branchExistingBranchSummary(
  targetBranch: string,
  remote: string | undefined,
  existingBranchStatus: NonNullable<GitBranchPreview["preflight"]>["existingBranchStatus"]
): string {
  switch (existingBranchStatus) {
  case "ExistingLocal":
    return `A local branch named ${targetBranch} already exists; this review is for switching.`;
  case "CurrentBranch":
    return `Already on local branch ${targetBranch}.`;
  case "RemoteCollision":
    return `A remote branch named ${targetBranch} exists on ${remote ?? "the configured remote"}; this action will not set upstream.`;
  case "Invalid":
    return "Existing branch state was not inspected because the target branch name is invalid.";
  default:
    return `No local branch named ${targetBranch} exists; this review is for creating it.`;
  }
}


function branchActionReadinessSummary(
  blockers: string[],
  mode: GitBranchPreview["mode"],
  actionReadiness: NonNullable<GitBranchPreview["preflight"]>["actionReadiness"]
): string {
  if (actionReadiness === "Blocked") {
    return `Resolve ${blockers.length} blocker(s) before changing branches.`;
  }

  if (actionReadiness === "NeedsReview") {
    return "Branch action can proceed after review, but local or remote branch context needs attention.";
  }

  if (mode === "SwitchBranch") {
    return "Ready to switch to the existing local branch after explicit confirmation.";
  }

  return "Ready to create and switch to the new local branch after explicit confirmation.";
}


function gitBranchPreviewBlockers(
  status: GitStatusSnapshot,
  targetBranch: string,
  baseBranch: string,
  mode: GitBranchPreview["mode"],
  branchNameIssue: string | undefined
): string[] {
  const blockers: string[] = [];

  if (branchNameIssue) {
    blockers.push(branchNameIssue);
  }

  if (targetBranch === baseBranch) {
    blockers.push(`Target branch ${targetBranch} is the default base branch; choose a task branch before changing branches.`);
  }

  if (!status.head) {
    blockers.push("Current HEAD could not be read.");
  }

  const unmerged = status.changedFiles.filter((change) => change.status === "Unmerged");
  if (unmerged.length > 0) {
    blockers.push(`Resolve ${unmerged.length} unmerged file(s) before changing branches.`);
  }

  if (mode === "SwitchBranch" && status.isDirty) {
    blockers.push("Switching to an existing branch is blocked while the working tree has uncommitted changes.");
  }

  if (mode === "AlreadyOnBranch") {
    blockers.push(`Already on branch ${targetBranch}; no branch action is needed.`);
  }

  return blockers;
}


function gitBranchRiskNotes(
  status: GitStatusSnapshot,
  task: ForgeTask | undefined,
  taskMissing: boolean,
  mode: GitBranchPreview["mode"],
  remoteBranchExists: boolean,
  remote: string | undefined
): string[] {
  const notes: string[] = [];

  if (taskMissing) {
    notes.push("The requested task was not found, so this branch preview is based on repository state only.");
  }

  if (!task) {
    notes.push("No task context is linked to this branch preview.");
  }

  if (mode === "CreateBranch" && status.isDirty) {
    notes.push(`${status.changedFiles.length} uncommitted file(s) will remain in the working tree after branch creation.`);
  }

  if (mode === "CreateBranch" && remoteBranchExists) {
    notes.push(`A remote branch with this name already exists on ${remote}; this action creates a local branch only and does not set upstream.`);
  }

  if (mode === "SwitchBranch") {
    notes.push("Switching branches can change the visible working tree; Forge blocks this when local changes are present.");
  }

  return notes;
}


function gitBranchPreviewSummary(
  status: GitStatusSnapshot,
  targetBranch: string,
  mode: GitBranchPreview["mode"],
  readiness: GitBranchPreview["readiness"]
): string {
  if (readiness === "Blocked") {
    return `Branch preparation is blocked for ${targetBranch}.`;
  }

  if (mode === "SwitchBranch") {
    return `Ready to switch from ${status.branch ?? "current checkout"} to existing branch ${targetBranch}.`;
  }

  if (mode === "AlreadyOnBranch") {
    return `Already on ${targetBranch}.`;
  }

  return `Ready to create branch ${targetBranch} from ${status.branch ?? "current checkout"}.`;
}


function recordGitBranchOnTask(
  taskID: string,
  mode: GitBranchResult["mode"],
  previousBranch: string | undefined,
  branch: string
): GitBranchResult["relatedTask"] {
  if (!taskID) {
    return undefined;
  }

  const task = tasks.get(taskID);
  if (!task) {
    return undefined;
  }

  const now = new Date().toISOString();
  const action = mode === "CreateBranch" ? "Create Git Branch" : "Switch Git Branch";
  const summary = mode === "CreateBranch"
    ? `Created git branch ${branch}`
    : `Switched git branch from ${previousBranch ?? "unknown"} to ${branch}`;
  const updatedTask = {
    ...task,
    updatedAt: now,
    approvals: [
      ...task.approvals,
      {
        id: randomUUID(),
        action: action as ApprovalRecord["action"],
        decision: "Approved" as const,
        summary,
        decidedAt: now,
        targetID: branch
      }
    ],
    events: [
      ...task.events,
      {
        type: mode === "CreateBranch" ? "git.branch.created" : "git.branch.switched",
        message: summary,
        createdAt: now
      }
    ]
  };

  tasks.set(task.id, updatedTask);
  taskStore.saveTask(updatedTask);
  emit(mode === "CreateBranch" ? "git.branch.created" : "git.branch.switched", {
    taskID: task.id,
    previousBranch,
    branch,
    task: updatedTask
  });

  return {
    id: updatedTask.id,
    title: updatedTask.title,
    status: updatedTask.status,
    currentPhase: updatedTask.currentPhase,
    summary: updatedTask.reviewSummary ?? updatedTask.objective
  };
}


async function getFirstGitRemote(gitRoot: string): Promise<string | undefined> {
  const result = await runGitCommand(["remote"], gitRoot, 8_000);
  if (result.exitCode !== 0) {
    return undefined;
  }

  return result.output
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .find(Boolean);
}


async function getGitDefaultBaseBranch(gitRoot: string, remote: string): Promise<string> {
  const remoteHead = await runGitCommand([
    "symbolic-ref",
    "--quiet",
    "--short",
    `refs/remotes/${remote}/HEAD`
  ], gitRoot, 8_000);
  const remoteHeadBranch = remoteHead.output.trim();
  if (remoteHead.exitCode === 0 && remoteHeadBranch.startsWith(`${remote}/`)) {
    return remoteHeadBranch.slice(remote.length + 1);
  }

  for (const candidate of ["main", "master", "trunk"]) {
    const remoteCandidate = await runGitCommand([
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/remotes/${remote}/${candidate}`
    ], gitRoot, 8_000);
    if (remoteCandidate.exitCode === 0) {
      return candidate;
    }

    const localCandidate = await runGitCommand([
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${candidate}`
    ], gitRoot, 8_000);
    if (localCandidate.exitCode === 0) {
      return candidate;
    }
  }

  return "main";
}


function suggestPullRequestBranchName(
  task: ForgeTask | undefined,
  currentBranch: string | undefined,
  baseBranch: string
): string {
  if (currentBranch && !currentBranch.startsWith("HEAD") && currentBranch !== baseBranch) {
    return currentBranch;
  }

  const source = task?.title ?? task?.objective ?? "forge task";
  return `forge/${slugText(source, "task")}`;
}


function slugText(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/g, "");

  return slug || fallback;
}


function stringFieldFromUnknown(value: unknown, fieldName: string, minLength: number, maxLength: number): string {
  if (typeof value !== "string") throw new HttpError(400, `${fieldName} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < minLength) throw new HttpError(400, `${fieldName} is too short.`);
  if (trimmed.length > maxLength) throw new HttpError(413, `${fieldName} is too large.`);
  return trimmed;
}


function normalizeSingleLineField(value: unknown, fieldName: string, minLength: number, maxLength: number): string {
  const trimmed = stringFieldFromUnknown(value, fieldName, minLength, maxLength);
  if (trimmed.includes("\n") || trimmed.includes("\r")) {
    throw new HttpError(400, `${fieldName} must be a single line.`);
  }
  return trimmed;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

return {
  getGitBranchPreview,
  createOrSwitchGitBranch
};
}
