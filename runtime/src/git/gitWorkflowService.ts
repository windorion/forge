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

export function createGitWorkflowService(options: {
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

async function getGitBranchPublishPreview(
  rawTaskID: string | null,
  rawRemote: string | null,
  rawRemoteBranch: string | null
): Promise<GitBranchPublishPreview> {
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();
  const task = rawTaskID ? tasks.get(rawTaskID) : undefined;
  const taskMissing = Boolean(rawTaskID && !task);
  const operationBoundary = "Review artifact only. Forge has not pushed, set upstream, force-pushed, or published a PR.";
  const fallbackBaseBranch = "main";

  if (!status.isRepository || !status.root) {
    const preflight = unavailableGitBranchPublishPreflight(status, fallbackBaseBranch);
    return {
      generatedAt,
      readiness: "Blocked",
      summary: "Branch publish is blocked because git status is unavailable.",
      preflight,
      expectedHead: status.head,
      branch: status.branch,
      baseBranch: fallbackBaseBranch,
      upstream: status.upstream,
      isDirty: status.isDirty,
      commitsToPublish: [],
      changedFiles: [],
      relatedTask: undefined,
      riskNotes: taskMissing ? [`Task ${rawTaskID} was not found.`] : [],
      blockers: [status.error ?? "Workspace is not inside a git repository."],
      operationBoundary
    };
  }

  const remotes = await listGitRemotes(status.root);
  const requestedRemote = normalizeOptionalGitRemoteName(rawRemote);
  const remote = requestedRemote ?? remotes[0];
  const baseBranch = await getGitDefaultBaseBranch(status.root, remote ?? "origin");
  const remoteBranch = normalizeGitBranchTarget(rawRemoteBranch, status.branch ?? suggestPullRequestBranchName(task, status.branch, baseBranch));
  const baseRef = remote
    ? await resolveGitBaseRef(status.root, remote, baseBranch)
    : await resolveGitBaseRef(status.root, "origin", baseBranch);
  const commitsToPublish = baseRef ? await collectGitCommitsInRange(status.root, `${baseRef}..HEAD`) : [];
  const remoteBranchExists = remote ? await remoteGitBranchExists(status.root, remote, remoteBranch) : false;
  const blockers = gitBranchPublishBlockers(
    status,
    baseBranch,
    remote,
    remotes,
    requestedRemote,
    remoteBranch,
    remoteBranchExists,
    commitsToPublish,
    baseRef
  );
  const preflight = gitBranchPublishPreflight(
    status,
    baseBranch,
    remote,
    remotes,
    requestedRemote,
    remoteBranch,
    remoteBranchExists,
    commitsToPublish,
    baseRef,
    blockers
  );
  const riskNotes = gitBranchPublishRiskNotes(status, task, taskMissing, baseRef, commitsToPublish);
  const readiness: GitBranchPublishPreview["readiness"] = blockers.length > 0
    ? "Blocked"
    : riskNotes.length > 0
      ? "NeedsReview"
      : "Ready";

  return {
    generatedAt,
    readiness,
    summary: gitBranchPublishPreviewSummary(status, remote, remoteBranch, commitsToPublish, readiness),
    preflight,
    expectedHead: status.head,
    branch: status.branch,
    baseBranch,
    remote,
    remoteBranch,
    upstream: status.upstream,
    isDirty: status.isDirty,
    commitsToPublish,
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

async function publishGitBranch(input: GitBranchPublishRequest): Promise<GitBranchPublishResult> {
  const request = normalizeGitBranchPublishRequest(input);
  const preview = await getGitBranchPublishPreview(request.taskID || null, request.remote, request.remoteBranch);
  const generatedAt = new Date().toISOString();

  if (!preview.expectedHead || preview.expectedHead !== request.expectedHead) {
    throw new HttpError(409, `Git HEAD changed since branch publish review. Expected ${request.expectedHead}, current ${preview.expectedHead ?? "unknown"}.`);
  }

  if (!preview.branch || preview.branch !== request.expectedBranch) {
    throw new HttpError(409, `Git branch changed since branch publish review. Expected ${request.expectedBranch}, current ${preview.branch ?? "unknown"}.`);
  }

  if (!preview.remote || preview.remote !== request.remote) {
    throw new HttpError(409, `Git remote changed since branch publish review. Expected ${request.remote}, current ${preview.remote ?? "none"}.`);
  }

  if (!preview.remoteBranch || preview.remoteBranch !== request.remoteBranch) {
    throw new HttpError(409, `Remote branch changed since branch publish review. Expected ${request.remoteBranch}, current ${preview.remoteBranch ?? "none"}.`);
  }

  if (preview.blockers.length > 0) {
    throw new HttpError(409, `Branch publish is blocked: ${preview.blockers.join(" ")}`);
  }

  const status = await getGitStatusSnapshot();
  if (!status.isRepository || !status.root) {
    throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
  }

  const pushResult = await runGitCommand([
    "push",
    "--set-upstream",
    request.remote,
    `HEAD:${request.remoteBranch}`
  ], status.root, 96_000);
  if (pushResult.exitCode !== 0) {
    throw new HttpError(409, gitPushFailureMessage(pushResult.output, "Branch publish failed"));
  }

  const upstream = `${request.remote}/${request.remoteBranch}`;
  const relatedTask = recordGitBranchPublishOnTask(
    request.taskID,
    request.expectedBranch,
    upstream,
    preview.commitsToPublish
  );

  return {
    generatedAt,
    branch: request.expectedBranch,
    remote: request.remote,
    remoteBranch: request.remoteBranch,
    upstream,
    pushedCommits: preview.commitsToPublish,
    summary: `Published ${request.expectedBranch} to ${upstream} and set upstream.`,
    outputSummary: summarizeGitCommandOutput(pushResult.output),
    relatedTask,
    operationBoundary: "Published current branch and set upstream. Forge did not force push, merge, reset, delete branches, or publish a PR."
  };
}

function normalizeGitBranchPublishRequest(input: GitBranchPublishRequest): Required<GitBranchPublishRequest> {
  if (!isRecord(input)) {
    throw new HttpError(400, "Git branch publish request must be an object.");
  }

  if (input.confirmation !== "PublishCurrentBranch") {
    throw new HttpError(400, "Git branch publish requires explicit confirmation: PublishCurrentBranch.");
  }

  return {
    taskID: typeof input.taskID === "string" ? input.taskID.trim() : "",
    expectedHead: normalizeSingleLineField(input.expectedHead, "expectedHead", 4, 64),
    expectedBranch: normalizeSingleLineField(input.expectedBranch, "expectedBranch", 1, 200),
    remote: normalizeGitRemoteName(input.remote),
    remoteBranch: normalizeGitBranchTarget(input.remoteBranch, ""),
    confirmation: "PublishCurrentBranch"
  };
}

async function listGitRemotes(gitRoot: string): Promise<string[]> {
  const result = await runGitCommand(["remote"], gitRoot, 8_000);
  if (result.exitCode !== 0) {
    return [];
  }

  return result.output
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean);
}

function normalizeGitRemoteName(rawRemote: unknown): string {
  const remote = normalizeSingleLineField(rawRemote, "remote", 1, 120);
  if (remote.startsWith("-") || remote.includes("/") || remote.includes("\\")) {
    throw new HttpError(400, "remote must be an existing simple git remote name.");
  }

  return remote;
}

function normalizeOptionalGitRemoteName(rawRemote: unknown): string | undefined {
  if (rawRemote === undefined || rawRemote === null || rawRemote === "") {
    return undefined;
  }

  return normalizeGitRemoteName(rawRemote);
}

function unavailableGitBranchPublishPreflight(
  status: GitStatusSnapshot,
  baseBranch: string
): NonNullable<GitBranchPublishPreview["preflight"]> {
  return {
    branchStatus: status.branch && !status.branch.startsWith("HEAD")
      ? status.branch === baseBranch ? "DefaultBranch" : "Ready"
      : "Missing",
    branchSummary: status.branch
      ? `Current checkout reports ${status.branch}.`
      : "Current branch could not be resolved.",
    remoteStatus: "Missing",
    remoteSummary: "No configured remote could be inspected for branch publish.",
    baseStatus: "Missing",
    baseSummary: "Default base branch could not be inspected.",
    commitStatus: "Empty",
    commitSummary: "No publish commit range could be inspected.",
    worktreeStatus: status.isDirty ? "Dirty" : "Clean",
    worktreeSummary: status.isDirty
      ? "Local changes were reported but could not be inspected safely."
      : "Working tree did not report local changes.",
    actionReadiness: "Blocked",
    actionReadinessSummary: "Resolve git repository access before publishing a branch.",
    failureRiskSummary: "Publish failure details will be classified after an approved push attempt can run."
  };
}

function gitBranchPublishPreflight(
  status: GitStatusSnapshot,
  baseBranch: string,
  remote: string | undefined,
  remotes: string[],
  requestedRemote: string | undefined,
  remoteBranch: string,
  remoteBranchExists: boolean,
  commitsToPublish: GitCommitToPush[],
  baseRef: string | undefined,
  blockers: string[]
): NonNullable<GitBranchPublishPreview["preflight"]> {
  const branchStatus = branchPublishBranchStatus(status, baseBranch);
  const remoteStatus = branchPublishRemoteStatus(remote, remotes, requestedRemote, remoteBranchExists);
  const commitStatus = gitCommitRangeStatus(commitsToPublish);
  const worktreeStatus: NonNullable<GitBranchPublishPreview["preflight"]>["worktreeStatus"] = status.isDirty ? "Dirty" : "Clean";
  const actionReadiness: NonNullable<GitBranchPublishPreview["preflight"]>["actionReadiness"] = blockers.length > 0
    ? "Blocked"
    : status.isDirty || commitStatus === "Truncated"
      ? "NeedsReview"
      : "Ready";

  return {
    branchStatus,
    branchSummary: branchPublishBranchSummary(status, baseBranch, branchStatus),
    remoteStatus,
    remoteSummary: branchPublishRemoteSummary(remote, remotes, requestedRemote, remoteBranch, remoteStatus),
    baseStatus: baseRef ? "Resolved" : "Missing",
    baseSummary: baseRef
      ? `Publish comparison will use ${baseRef}.`
      : `Default base branch ${baseBranch} could not be resolved locally.`,
    commitStatus,
    commitSummary: gitCommitRangeSummary(commitsToPublish, "publish"),
    worktreeStatus,
    worktreeSummary: worktreeStatus === "Clean"
      ? "Working tree is clean for branch publish."
      : `${status.changedFiles.length} local change(s) will remain local and will not be published.`,
    actionReadiness,
    actionReadinessSummary: gitTransportActionReadinessSummary(blockers, actionReadiness, "publish this branch"),
    failureRiskSummary: gitPushFailureRiskSummary(remote)
  };
}

function branchPublishBranchStatus(
  status: GitStatusSnapshot,
  baseBranch: string
): NonNullable<GitBranchPublishPreview["preflight"]>["branchStatus"] {
  if (!status.branch) {
    return "Missing";
  }

  if (status.branch.startsWith("HEAD")) {
    return "Detached";
  }

  if (status.branch === baseBranch) {
    return "DefaultBranch";
  }

  if (status.upstream) {
    return "AlreadyTracking";
  }

  return "Ready";
}

function branchPublishBranchSummary(
  status: GitStatusSnapshot,
  baseBranch: string,
  branchStatus: NonNullable<GitBranchPublishPreview["preflight"]>["branchStatus"]
): string {
  switch (branchStatus) {
  case "Detached":
    return "Current checkout is detached; branch publish requires a named local branch.";
  case "DefaultBranch":
    return `Current branch is the default base branch ${baseBranch}; publish a task branch instead.`;
  case "AlreadyTracking":
    return `Current branch already tracks ${status.upstream}; use Push Review instead.`;
  case "Ready":
    return `Current branch ${status.branch} is ready for first publish review.`;
  default:
    return "Current branch could not be resolved.";
  }
}

function branchPublishRemoteStatus(
  remote: string | undefined,
  remotes: string[],
  requestedRemote: string | undefined,
  remoteBranchExists: boolean
): NonNullable<GitBranchPublishPreview["preflight"]>["remoteStatus"] {
  if (!remote) {
    return "Missing";
  }

  if (!remotes.includes(remote) || (requestedRemote && !remotes.includes(requestedRemote))) {
    return "Unknown";
  }

  if (remoteBranchExists) {
    return "RemoteCollision";
  }

  return "Ready";
}

function branchPublishRemoteSummary(
  remote: string | undefined,
  remotes: string[],
  requestedRemote: string | undefined,
  remoteBranch: string,
  remoteStatus: NonNullable<GitBranchPublishPreview["preflight"]>["remoteStatus"]
): string {
  switch (remoteStatus) {
  case "Missing":
    return "No git remote is configured for branch publish.";
  case "Unknown":
    return `Requested remote ${requestedRemote ?? remote ?? "unknown"} is not in the configured remote list (${remotes.join(", ") || "none"}).`;
  case "RemoteCollision":
    return `Remote branch already exists: ${remote}/${remoteBranch}.`;
  default:
    return `Remote ${remote} is configured and ${remoteBranch} is available for first publish.`;
  }
}

function gitBranchPublishBlockers(
  status: GitStatusSnapshot,
  baseBranch: string,
  remote: string | undefined,
  remotes: string[],
  requestedRemote: string | undefined,
  remoteBranch: string,
  remoteBranchExists: boolean,
  commitsToPublish: GitCommitToPush[],
  baseRef: string | undefined
): string[] {
  const blockers: string[] = [];

  if (!status.branch || status.branch.startsWith("HEAD")) {
    blockers.push("Current checkout is detached; branch publish requires a named branch.");
  } else if (status.branch === baseBranch) {
    blockers.push(`Current branch is the default base branch (${baseBranch}); create or switch to a task branch before publishing.`);
  }

  if (!status.head) {
    blockers.push("Current HEAD could not be read.");
  }

  if (!remote) {
    blockers.push("No git remote is configured for branch publish.");
  } else if (!remotes.includes(remote)) {
    blockers.push(`Git remote is not configured: ${remote}.`);
  }

  if (requestedRemote && !remotes.includes(requestedRemote)) {
    blockers.push(`Requested git remote is not configured: ${requestedRemote}.`);
  }

  if (status.upstream) {
    blockers.push(`Current branch already has upstream ${status.upstream}; use Push Review instead.`);
  }

  const unmerged = status.changedFiles.filter((change) => change.status === "Unmerged");
  if (unmerged.length > 0) {
    blockers.push(`Resolve ${unmerged.length} unmerged file(s) before publishing the branch.`);
  }

  if (remoteBranch !== status.branch) {
    blockers.push("Publishing to a differently named remote branch is not supported yet.");
  }

  if (remoteBranchExists) {
    blockers.push(`Remote branch already exists: ${remote}/${remoteBranch}.`);
  }

  if (!baseRef) {
    blockers.push(`Default base branch ${baseBranch} could not be resolved locally.`);
  }

  if (commitsToPublish.length === 0) {
    blockers.push("No commits were found between the base branch and HEAD to publish.");
  }

  return blockers;
}

function gitBranchPublishRiskNotes(
  status: GitStatusSnapshot,
  task: ForgeTask | undefined,
  taskMissing: boolean,
  baseRef: string | undefined,
  commitsToPublish: GitCommitToPush[]
): string[] {
  const notes: string[] = [];

  if (taskMissing) {
    notes.push("The requested task was not found, so this branch publish preview is based on repository state only.");
  }

  if (!task) {
    notes.push("No task context is linked to this branch publish preview.");
  }

  if (status.isDirty) {
    notes.push(`${status.changedFiles.length} uncommitted file(s) will remain local and will not be included in this publish.`);
  }

  if (!baseRef) {
    notes.push("Forge could not compare this branch against the default base branch.");
  }

  if (commitsToPublish.length >= 20) {
    notes.push("Only the first 20 commits are shown in this branch publish preview.");
  }

  return notes;
}

function gitBranchPublishPreviewSummary(
  status: GitStatusSnapshot,
  remote: string | undefined,
  remoteBranch: string,
  commitsToPublish: GitCommitToPush[],
  readiness: GitBranchPublishPreview["readiness"]
): string {
  if (readiness === "Blocked") {
    return `Branch publish is blocked for ${status.branch ?? "current checkout"}.`;
  }

  return `${commitsToPublish.length} commit(s) ready to publish from ${status.branch ?? "current checkout"} to ${remote ?? "remote"}/${remoteBranch}.`;
}

function recordGitBranchPublishOnTask(
  taskID: string,
  branch: string,
  upstream: string,
  commits: GitCommitToPush[]
): GitBranchPublishResult["relatedTask"] {
  if (!taskID) {
    return undefined;
  }

  const task = tasks.get(taskID);
  if (!task) {
    return undefined;
  }

  const now = new Date().toISOString();
  const updatedTask = {
    ...task,
    updatedAt: now,
    approvals: [
      ...task.approvals,
      {
        id: randomUUID(),
        action: "Publish Git Branch" as ApprovalRecord["action"],
        decision: "Approved" as const,
        summary: `Published ${commits.length} commit(s) from ${branch} to ${upstream}`,
        decidedAt: now,
        targetID: upstream
      }
    ],
    events: [
      ...task.events,
      {
        type: "git.branch.published",
        message: `Published ${commits.length} commit(s) from ${branch} to ${upstream}`,
        createdAt: now
      }
    ]
  };

  tasks.set(task.id, updatedTask);
  taskStore.saveTask(updatedTask);
  emit("git.branch.published", { taskID: task.id, branch, upstream, commits, task: updatedTask });

  return {
    id: updatedTask.id,
    title: updatedTask.title,
    status: updatedTask.status,
    currentPhase: updatedTask.currentPhase,
    summary: updatedTask.reviewSummary ?? updatedTask.objective
  };
}

async function getGitCommitPreview(rawTaskID: string | null): Promise<GitCommitPreview> {
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();
  const task = rawTaskID ? tasks.get(rawTaskID) : undefined;
  const taskMissing = Boolean(rawTaskID && !task);
  const operationBoundary = "Review artifact only. Forge has not staged, committed, pushed, or mutated the repository.";

  if (!status.isRepository) {
    return {
      generatedAt,
      readiness: "Blocked",
      summary: "Commit preparation is blocked because git status is unavailable.",
      expectedHead: undefined,
      suggestedTitle: "Update workspace",
      suggestedBody: [],
      includedFiles: [],
      relatedTask: undefined,
      validationSummary: "Validation was not inspected because this workspace is not a git repository.",
      validationCommands: [],
      riskNotes: taskMissing ? [`Task ${rawTaskID} was not found.`] : [],
      blockers: [status.error ?? "Workspace is not inside a git repository."],
      operationBoundary
    };
  }

  const includedFiles = status.changedFiles;
  const validationSummary = commitValidationSummary(task);
  const preflight = await collectGitCommitPreflight(status, includedFiles, validationSummary);
  const blockers = commitPreviewBlockers(status, includedFiles, preflight);
  const validationCommands = suggestedCommitValidationCommands(includedFiles);
  const riskNotes = commitPreviewRiskNotes(status, includedFiles, task, taskMissing, validationSummary, preflight);
  const readiness: GitCommitPreview["readiness"] = blockers.length > 0
    ? "Blocked"
    : riskNotes.length > 0
      ? "NeedsReview"
      : "Ready";
  const suggestedTitle = suggestCommitTitle(task, includedFiles);

  return {
    generatedAt,
    readiness,
    summary: commitPreviewSummary(status, includedFiles, readiness),
    expectedHead: status.head,
    suggestedTitle,
    suggestedBody: buildSuggestedCommitBody(status, task, includedFiles, validationSummary),
    includedFiles,
    relatedTask: task ? {
      id: task.id,
      title: task.title,
      status: task.status,
      currentPhase: task.currentPhase,
      summary: task.reviewSummary ?? task.objective
    } : undefined,
    validationSummary,
    validationCommands,
    preflight,
    riskNotes,
    blockers,
    operationBoundary
  };
}

async function createGitCommit(input: GitCreateCommitRequest): Promise<GitCreateCommitResult> {
  const request = normalizeGitCreateCommitRequest(input);
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();

  if (!status.isRepository || !status.root) {
    throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
  }

  if (!status.isDirty || status.changedFiles.length === 0) {
    throw new HttpError(409, "Working tree is clean; there are no file changes to commit.");
  }

  if (!status.head || status.head !== request.expectedHead) {
    throw new HttpError(409, `Git HEAD changed since commit review. Expected ${request.expectedHead}, current ${status.head ?? "unknown"}.`);
  }

  const changedByPath = new Map(status.changedFiles.map((change) => [change.path, change]));
  const selectedChanges = request.paths.map((filePath) => {
    const change = changedByPath.get(filePath);
    if (!change) {
      throw new HttpError(409, `Selected commit path is no longer changed: ${filePath}`);
    }
    return change;
  });

  const unmerged = selectedChanges.filter((change) => change.status === "Unmerged");
  if (unmerged.length > 0) {
    throw new HttpError(409, `Resolve unmerged file(s) before committing: ${unmerged.map((change) => change.path).join(", ")}`);
  }

  const stagedOutsideSelection = status.changedFiles.filter((change) => change.staged && !request.paths.includes(change.path));
  if (stagedOutsideSelection.length > 0) {
    throw new HttpError(
      409,
      `Existing staged file(s) are outside this commit review: ${stagedOutsideSelection.map((change) => change.path).join(", ")}`
    );
  }

  const identityResult = await runGitCommand(["var", "GIT_AUTHOR_IDENT"], status.root, 8_000);
  if (identityResult.exitCode !== 0) {
    throw new HttpError(409, identityResult.output.trim() || "Git author identity is not configured.");
  }

  const addResult = await runGitCommand(["add", "--", ...request.paths], status.root, 64_000);
  if (addResult.exitCode !== 0) {
    throw new HttpError(409, addResult.output.trim() || "git add failed.");
  }

  const stagedStatus = await getGitStatusSnapshot();
  if (!stagedStatus.isRepository || !stagedStatus.root) {
    throw new HttpError(409, stagedStatus.error ?? "Git status could not be read after staging.");
  }

  const stagedSelectedChanges = stagedStatus.changedFiles.filter((change) => request.paths.includes(change.path) && change.staged);
  if (stagedSelectedChanges.length === 0) {
    throw new HttpError(409, "No selected changes were staged for commit.");
  }

  const commitArgs = ["commit", "-m", request.title];
  for (const line of request.body) {
    commitArgs.push("-m", line);
  }

  const commitResult = await runGitCommand(commitArgs, status.root, 96_000);
  if (commitResult.exitCode !== 0) {
    throw new HttpError(409, commitResult.output.trim() || "git commit failed.");
  }

  const hashResult = await runGitCommand(["rev-parse", "HEAD"], status.root);
  if (hashResult.exitCode !== 0) {
    throw new HttpError(409, hashResult.output.trim() || "Commit was created, but HEAD could not be read.");
  }

  const commitHash = hashResult.output.trim();
  const shortHash = commitHash.slice(0, 7);
  const relatedTask = recordGitCommitOnTask(request.taskID, shortHash, request.title, commitHash);

  return {
    generatedAt,
    commitHash,
    shortHash,
    branch: status.branch,
    summary: `Created local commit ${shortHash} on ${status.branch ?? "current checkout"}.`,
    messageTitle: request.title,
    messageBody: request.body,
    committedFiles: selectedChanges,
    relatedTask,
    operationBoundary: "Local git commit created. Forge did not push, merge, delete branches, reset, or publish anything."
  };
}

function normalizeGitCreateCommitRequest(input: GitCreateCommitRequest): Required<GitCreateCommitRequest> {
  if (!isRecord(input)) {
    throw new HttpError(400, "Git commit request must be an object.");
  }

  if (input.confirmation !== "CreateLocalCommit") {
    throw new HttpError(400, "Git commit requires explicit confirmation: CreateLocalCommit.");
  }

  const expectedHead = stringFieldFromUnknown(input.expectedHead, "expectedHead", 4, 64);
  const title = normalizeCommitMessageTitle(input.title);
  const body = normalizeCommitMessageBody(input.body);
  const paths = normalizeGitCommitPaths(input.paths);
  const taskID = typeof input.taskID === "string" ? input.taskID.trim() : "";

  return {
    taskID,
    expectedHead,
    title,
    body,
    paths,
    confirmation: "CreateLocalCommit"
  };
}

function normalizeCommitMessageTitle(title: unknown): string {
  const normalized = stringFieldFromUnknown(title, "title", 3, 120)
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.includes("\n") || normalized.includes("\r")) {
    throw new HttpError(400, "Commit title must be a single line.");
  }

  return normalized;
}

function normalizeCommitMessageBody(body: unknown): string[] {
  if (body === undefined) {
    return [];
  }

  if (!Array.isArray(body)) {
    throw new HttpError(400, "Commit body must be an array of strings.");
  }

  return body
    .slice(0, 20)
    .map((line, index) => stringFieldFromUnknown(line, `body[${index}]`, 0, 220).trim())
    .filter(Boolean);
}

function normalizeGitCommitPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) {
    throw new HttpError(400, "Commit paths must be an array.");
  }

  const normalized = [...new Set(paths.map((filePath, index) =>
    normalizeGitDiffPath(stringFieldFromUnknown(filePath, `paths[${index}]`, 1, 500))
  ))];

  if (normalized.length === 0) {
    throw new HttpError(400, "At least one commit path is required.");
  }

  if (normalized.length > 100) {
    throw new HttpError(413, "Too many commit paths.");
  }

  return normalized;
}

function recordGitCommitOnTask(
  taskID: string,
  shortHash: string,
  title: string,
  commitHash: string
): GitCreateCommitResult["relatedTask"] {
  if (!taskID) {
    return undefined;
  }

  const task = tasks.get(taskID);
  if (!task) {
    return undefined;
  }

  const updatedTask = {
    ...task,
    updatedAt: new Date().toISOString(),
    approvals: [
      ...task.approvals,
      {
        id: randomUUID(),
        action: "Create Git Commit" as ApprovalRecord["action"],
        decision: "Approved" as const,
        summary: `Created local git commit ${shortHash}: ${title}`,
        decidedAt: new Date().toISOString(),
        targetID: commitHash
      }
    ],
    events: [
      ...task.events,
      {
        type: "git.commit.created",
        message: `Created local git commit ${shortHash}: ${title}`,
        createdAt: new Date().toISOString()
      }
    ]
  };

  tasks.set(task.id, updatedTask);
  taskStore.saveTask(updatedTask);
  emit("git.commit.created", { taskID: task.id, commitHash, shortHash, task: updatedTask });

  return {
    id: updatedTask.id,
    title: updatedTask.title,
    status: updatedTask.status,
    currentPhase: updatedTask.currentPhase,
    summary: updatedTask.reviewSummary ?? updatedTask.objective
  };
}

async function getGitPushPreview(rawTaskID: string | null): Promise<GitPushPreview> {
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();
  const task = rawTaskID ? tasks.get(rawTaskID) : undefined;
  const taskMissing = Boolean(rawTaskID && !task);
  const operationBoundary = "Review artifact only. Forge has not pushed, force-pushed, merged, or published anything.";

  if (!status.isRepository || !status.root) {
    const preflight = unavailableGitPushPreflight(status);
    return {
      generatedAt,
      readiness: "Blocked",
      summary: "Push preparation is blocked because git status is unavailable.",
      preflight,
      expectedHead: status.head,
      branch: status.branch,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      isDirty: status.isDirty,
      commitsToPush: [],
      changedFiles: [],
      relatedTask: undefined,
      riskNotes: taskMissing ? [`Task ${rawTaskID} was not found.`] : [],
      blockers: [status.error ?? "Workspace is not inside a git repository."],
      operationBoundary
    };
  }

  const upstreamParts = parseGitUpstream(status.upstream);
  const remotes = await listGitRemotes(status.root);
  const commitsToPush = upstreamParts && (status.ahead ?? 0) > 0
    ? await collectGitCommitsToPush(status.root, status.upstream)
    : [];
  const blockers = gitPushBlockers(status, upstreamParts, remotes);
  const preflight = gitPushPreflight(status, upstreamParts, remotes, commitsToPush, blockers);
  const riskNotes = gitPushRiskNotes(status, task, taskMissing, commitsToPush);
  const readiness: GitPushPreview["readiness"] = blockers.length > 0
    ? "Blocked"
    : riskNotes.length > 0
      ? "NeedsReview"
      : "Ready";

  return {
    generatedAt,
    readiness,
    summary: gitPushPreviewSummary(status, commitsToPush, readiness),
    preflight,
    expectedHead: status.head,
    branch: status.branch,
    upstream: status.upstream,
    remote: upstreamParts?.remote,
    remoteBranch: upstreamParts?.remoteBranch,
    ahead: status.ahead,
    behind: status.behind,
    isDirty: status.isDirty,
    commitsToPush,
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

async function pushGitBranch(input: GitPushRequest): Promise<GitPushResult> {
  const request = normalizeGitPushRequest(input);
  const preview = await getGitPushPreview(request.taskID || null);
  const generatedAt = new Date().toISOString();

  if (!preview.expectedHead || preview.expectedHead !== request.expectedHead) {
    throw new HttpError(409, `Git HEAD changed since push review. Expected ${request.expectedHead}, current ${preview.expectedHead ?? "unknown"}.`);
  }

  if (!preview.branch || preview.branch !== request.expectedBranch) {
    throw new HttpError(409, `Git branch changed since push review. Expected ${request.expectedBranch}, current ${preview.branch ?? "unknown"}.`);
  }

  if (!preview.upstream || preview.upstream !== request.expectedUpstream) {
    throw new HttpError(409, `Git upstream changed since push review. Expected ${request.expectedUpstream}, current ${preview.upstream ?? "none"}.`);
  }

  if (preview.blockers.length > 0) {
    throw new HttpError(409, `Push is blocked: ${preview.blockers.join(" ")}`);
  }

  if (!preview.remote || !preview.remoteBranch) {
    throw new HttpError(409, "Push requires a configured upstream remote and branch.");
  }

  const status = await getGitStatusSnapshot();
  if (!status.isRepository || !status.root) {
    throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
  }

  const pushResult = await runGitCommand(
    ["push", preview.remote, `HEAD:${preview.remoteBranch}`],
    status.root,
    96_000
  );
  if (pushResult.exitCode !== 0) {
    throw new HttpError(409, gitPushFailureMessage(pushResult.output, "Push failed"));
  }

  const relatedTask = recordGitPushOnTask(request.taskID, preview.branch, preview.upstream, preview.commitsToPush);

  return {
    generatedAt,
    branch: preview.branch,
    upstream: preview.upstream,
    remote: preview.remote,
    remoteBranch: preview.remoteBranch,
    pushedCommits: preview.commitsToPush,
    summary: `Pushed ${preview.commitsToPush.length} commit(s) from ${preview.branch} to ${preview.upstream}.`,
    outputSummary: summarizeGitCommandOutput(pushResult.output),
    relatedTask,
    operationBoundary: "Pushed current branch to its upstream. Forge did not force push, merge, reset, delete branches, or publish a PR."
  };
}

function normalizeGitPushRequest(input: GitPushRequest): Required<GitPushRequest> {
  if (!isRecord(input)) {
    throw new HttpError(400, "Git push request must be an object.");
  }

  if (input.confirmation !== "PushCurrentBranch") {
    throw new HttpError(400, "Git push requires explicit confirmation: PushCurrentBranch.");
  }

  return {
    taskID: typeof input.taskID === "string" ? input.taskID.trim() : "",
    expectedHead: normalizeSingleLineField(input.expectedHead, "expectedHead", 4, 64),
    expectedBranch: normalizeSingleLineField(input.expectedBranch, "expectedBranch", 1, 200),
    expectedUpstream: normalizeSingleLineField(input.expectedUpstream, "expectedUpstream", 3, 300),
    confirmation: "PushCurrentBranch"
  };
}

async function collectGitCommitsToPush(gitRoot: string, upstream: string | undefined): Promise<GitCommitToPush[]> {
  if (!upstream) {
    return [];
  }

  return collectGitCommitsInRange(gitRoot, `${upstream}..HEAD`);
}

async function collectGitCommitsInRange(gitRoot: string, range: string): Promise<GitCommitToPush[]> {
  const result = await runGitCommand([
    "log",
    "--max-count=20",
    "--format=%H%x1f%h%x1f%ad%x1f%s",
    "--date=iso-strict",
    range
  ], gitRoot, 64_000);
  if (result.exitCode !== 0) {
    return [];
  }

  return result.output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, authorDate, ...titleParts] = line.split("\x1f");
      return {
        hash,
        shortHash,
        authorDate,
        title: titleParts.join("\x1f") || "(no commit title)"
      };
    })
    .filter((commit) => commit.hash && commit.shortHash);
}

function unavailableGitPushPreflight(status: GitStatusSnapshot): NonNullable<GitPushPreview["preflight"]> {
  return {
    branchStatus: status.branch && !status.branch.startsWith("HEAD") ? "Ready" : "Missing",
    branchSummary: status.branch
      ? `Current checkout reports ${status.branch}.`
      : "Current branch could not be resolved.",
    upstreamStatus: "Missing",
    upstreamSummary: "No upstream remote branch could be inspected.",
    remoteStatus: "Missing",
    remoteSummary: "No configured upstream remote could be inspected.",
    commitStatus: "Empty",
    commitSummary: "No push commit range could be inspected.",
    worktreeStatus: status.isDirty ? "Dirty" : "Clean",
    worktreeSummary: status.isDirty
      ? "Local changes were reported but could not be inspected safely."
      : "Working tree did not report local changes.",
    actionReadiness: "Blocked",
    actionReadinessSummary: "Resolve git repository access before pushing.",
    failureRiskSummary: "Push failure details will be classified after an approved push attempt can run."
  };
}

function gitPushPreflight(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  remotes: string[],
  commitsToPush: GitCommitToPush[],
  blockers: string[]
): NonNullable<GitPushPreview["preflight"]> {
  const branchStatus = pushBranchStatus(status);
  const upstreamStatus = pushUpstreamStatus(status, upstreamParts);
  const remoteStatus = pushRemoteStatus(upstreamParts, remotes);
  const commitStatus = gitCommitRangeStatus(commitsToPush);
  const worktreeStatus: NonNullable<GitPushPreview["preflight"]>["worktreeStatus"] = status.isDirty ? "Dirty" : "Clean";
  const actionReadiness: NonNullable<GitPushPreview["preflight"]>["actionReadiness"] = blockers.length > 0
    ? "Blocked"
    : status.isDirty || commitStatus === "Truncated"
      ? "NeedsReview"
      : "Ready";

  return {
    branchStatus,
    branchSummary: pushBranchSummary(status, branchStatus),
    upstreamStatus,
    upstreamSummary: pushUpstreamSummary(status, upstreamParts, upstreamStatus),
    remoteStatus,
    remoteSummary: pushRemoteSummary(upstreamParts, remotes, remoteStatus),
    commitStatus,
    commitSummary: gitCommitRangeSummary(commitsToPush, "push"),
    worktreeStatus,
    worktreeSummary: worktreeStatus === "Clean"
      ? "Working tree is clean for push."
      : `${status.changedFiles.length} local change(s) will remain local after push.`,
    actionReadiness,
    actionReadinessSummary: gitTransportActionReadinessSummary(blockers, actionReadiness, "push this branch"),
    failureRiskSummary: gitPushFailureRiskSummary(upstreamParts?.remote)
  };
}

function pushBranchStatus(status: GitStatusSnapshot): NonNullable<GitPushPreview["preflight"]>["branchStatus"] {
  if (!status.branch) {
    return "Missing";
  }

  if (status.branch.startsWith("HEAD")) {
    return "Detached";
  }

  return "Ready";
}

function pushBranchSummary(
  status: GitStatusSnapshot,
  branchStatus: NonNullable<GitPushPreview["preflight"]>["branchStatus"]
): string {
  switch (branchStatus) {
  case "Detached":
    return "Current checkout is detached; push requires a named branch.";
  case "Ready":
    return `Current branch ${status.branch} is ready for upstream push review.`;
  default:
    return "Current branch could not be resolved.";
  }
}

function pushUpstreamStatus(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined
): NonNullable<GitPushPreview["preflight"]>["upstreamStatus"] {
  if (!upstreamParts) {
    return "Missing";
  }

  if ((status.behind ?? 0) > 0) {
    return "Behind";
  }

  if ((status.ahead ?? 0) <= 0) {
    return "NoAhead";
  }

  return "Unpushed";
}

function pushUpstreamSummary(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  upstreamStatus: NonNullable<GitPushPreview["preflight"]>["upstreamStatus"]
): string {
  if (!upstreamParts) {
    return "Current branch has no upstream remote branch.";
  }

  if (upstreamStatus === "Behind") {
    return `Current branch is behind ${upstreamParts.remote}/${upstreamParts.remoteBranch} by ${status.behind ?? 0} commit(s).`;
  }

  if (upstreamStatus === "NoAhead") {
    return `No local commits are ahead of ${upstreamParts.remote}/${upstreamParts.remoteBranch}.`;
  }

  return `${status.ahead ?? 0} local commit(s) are ready to push to ${upstreamParts.remote}/${upstreamParts.remoteBranch}.`;
}

function pushRemoteStatus(
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  remotes: string[]
): NonNullable<GitPushPreview["preflight"]>["remoteStatus"] {
  if (!upstreamParts) {
    return "Missing";
  }

  return remotes.includes(upstreamParts.remote) ? "Ready" : "Unknown";
}

function pushRemoteSummary(
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  remotes: string[],
  remoteStatus: NonNullable<GitPushPreview["preflight"]>["remoteStatus"]
): string {
  if (!upstreamParts) {
    return "No upstream remote is configured.";
  }

  if (remoteStatus === "Unknown") {
    return `Configured upstream remote ${upstreamParts.remote} is not in the local remote list (${remotes.join(", ") || "none"}).`;
  }

  return `Upstream remote ${upstreamParts.remote} is configured.`;
}

function gitCommitRangeStatus(commits: GitCommitToPush[]): "Ready" | "Empty" | "Truncated" {
  if (commits.length === 0) {
    return "Empty";
  }

  return commits.length >= 20 ? "Truncated" : "Ready";
}

function gitCommitRangeSummary(commits: GitCommitToPush[], action: "push" | "publish"): string {
  if (commits.length === 0) {
    return `No commits are currently ready to ${action}.`;
  }

  if (commits.length >= 20) {
    return `At least ${commits.length} commit(s) are in scope; only the first ${commits.length} are shown.`;
  }

  return `${commits.length} commit(s) are in scope for ${action}.`;
}

function gitTransportActionReadinessSummary(
  blockers: string[],
  actionReadiness: "Ready" | "NeedsReview" | "Blocked",
  actionLabel: string
): string {
  if (actionReadiness === "Blocked") {
    return `Resolve ${blockers.length} blocker(s) before attempting to ${actionLabel}.`;
  }

  if (actionReadiness === "NeedsReview") {
    return `Review local changes and commit range before attempting to ${actionLabel}.`;
  }

  return `Ready to ${actionLabel} after explicit confirmation.`;
}

function gitPushFailureRiskSummary(remote: string | undefined): string {
  return `If ${remote ?? "the remote"} rejects the operation, Forge classifies common authentication, non-fast-forward, network, and protected-branch failures before showing the error.`;
}

function gitPushBlockers(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  remotes: string[]
): string[] {
  const blockers: string[] = [];

  if (!status.branch || status.branch.startsWith("HEAD")) {
    blockers.push("Current checkout is detached; push requires a named branch.");
  }

  if (!upstreamParts) {
    blockers.push("Current branch does not have an upstream remote branch.");
  } else if (!remotes.includes(upstreamParts.remote)) {
    blockers.push(`Configured upstream remote is not present locally: ${upstreamParts.remote}.`);
  }

  if ((status.behind ?? 0) > 0) {
    blockers.push(`Current branch is behind upstream by ${status.behind} commit(s).`);
  }

  if ((status.ahead ?? 0) <= 0) {
    blockers.push("There are no local commits ahead of upstream to push.");
  }

  const unmerged = status.changedFiles.filter((change) => change.status === "Unmerged");
  if (unmerged.length > 0) {
    blockers.push(`Resolve ${unmerged.length} unmerged file(s) before pushing.`);
  }

  return blockers;
}

function gitPushRiskNotes(
  status: GitStatusSnapshot,
  task: ForgeTask | undefined,
  taskMissing: boolean,
  commitsToPush: GitCommitToPush[]
): string[] {
  const notes: string[] = [];

  if (taskMissing) {
    notes.push("The requested task was not found, so this preview is based on branch state only.");
  }

  if (!task) {
    notes.push("No task context is linked to this push preview.");
  }

  if (status.isDirty) {
    notes.push(`${status.changedFiles.length} uncommitted file(s) will remain local after the push.`);
  }

  if (commitsToPush.length >= 20 && (status.ahead ?? 0) > commitsToPush.length) {
    notes.push(`Only the first ${commitsToPush.length} commit(s) are shown; ${status.ahead} commit(s) are ahead.`);
  }

  return notes;
}

function gitPushPreviewSummary(
  status: GitStatusSnapshot,
  commitsToPush: GitCommitToPush[],
  readiness: GitPushPreview["readiness"]
): string {
  if (readiness === "Blocked") {
    return `Push preparation is blocked on ${status.branch ?? "current checkout"}.`;
  }

  return `${commitsToPush.length} commit(s) ready to push from ${status.branch ?? "current checkout"} to ${status.upstream ?? "upstream"}.`;
}

function recordGitPushOnTask(
  taskID: string,
  branch: string,
  upstream: string,
  commits: GitCommitToPush[]
): GitPushResult["relatedTask"] {
  if (!taskID) {
    return undefined;
  }

  const task = tasks.get(taskID);
  if (!task) {
    return undefined;
  }

  const now = new Date().toISOString();
  const updatedTask = {
    ...task,
    updatedAt: now,
    approvals: [
      ...task.approvals,
      {
        id: randomUUID(),
        action: "Push Git Branch" as ApprovalRecord["action"],
        decision: "Approved" as const,
        summary: `Pushed ${commits.length} commit(s) from ${branch} to ${upstream}`,
        decidedAt: now,
        targetID: upstream
      }
    ],
    events: [
      ...task.events,
      {
        type: "git.push.completed",
        message: `Pushed ${commits.length} commit(s) from ${branch} to ${upstream}`,
        createdAt: now
      }
    ]
  };

  tasks.set(task.id, updatedTask);
  taskStore.saveTask(updatedTask);
  emit("git.push.completed", { taskID: task.id, branch, upstream, commits, task: updatedTask });

  return {
    id: updatedTask.id,
    title: updatedTask.title,
    status: updatedTask.status,
    currentPhase: updatedTask.currentPhase,
    summary: updatedTask.reviewSummary ?? updatedTask.objective
  };
}

async function getGitPullRequestPreview(rawTaskID: string | null): Promise<GitPullRequestPreview> {
  const status = await getGitStatusSnapshot();
  const generatedAt = new Date().toISOString();
  const task = rawTaskID ? tasks.get(rawTaskID) : undefined;
  const taskMissing = Boolean(rawTaskID && !task);
  const operationBoundary = "Review artifact only. Forge has not created, published, pushed, or modified a pull request.";
  const fallbackBaseBranch = "main";

  if (!status.isRepository || !status.root) {
    const riskNotes = taskMissing ? [`Task ${rawTaskID} was not found.`] : [];
    const preflight = unavailableGitPullRequestPreflight(status, fallbackBaseBranch, task);
    return {
      generatedAt,
      readiness: "Blocked",
      summary: "PR handoff is blocked because git status is unavailable.",
      preflight,
      baseBranch: fallbackBaseBranch,
      headBranch: status.branch,
      head: status.head,
      upstream: status.upstream,
      suggestedBranchName: suggestPullRequestBranchName(task, status.branch, fallbackBaseBranch),
      title: suggestPullRequestTitle(task, []),
      body: [],
      testPlan: pullRequestTestPlan(task, []),
      commits: [],
      changedFiles: [],
      relatedTask: undefined,
      riskNotes,
      blockers: [status.error ?? "Workspace is not inside a git repository."],
      operationBoundary
    };
  }

  const upstreamParts = parseGitUpstream(status.upstream);
  const remoteSummaries = await listGitRemoteSummaries(status.root);
  const remote = upstreamParts?.remote ?? remoteSummaries[0]?.name ?? await getFirstGitRemote(status.root);
  const baseBranch = await getGitDefaultBaseBranch(status.root, remote ?? "origin");
  const baseRef = remote
    ? await resolveGitBaseRef(status.root, remote, baseBranch)
    : await resolveGitBaseRef(status.root, "origin", baseBranch);
  const rangeFiles = baseRef ? await collectGitChangedFilesInRange(status.root, `${baseRef}...HEAD`) : [];
  const changedFiles = mergeGitFileChanges(rangeFiles, status.changedFiles);
  const commits = baseRef ? await collectGitCommitsInRange(status.root, `${baseRef}..HEAD`) : [];
  const blockers = gitPullRequestBlockers(status, baseBranch, upstreamParts, commits, baseRef);
  const preflight = gitPullRequestPreflight(
    status,
    baseBranch,
    baseRef,
    upstreamParts,
    remote,
    remoteSummaries,
    task,
    changedFiles,
    blockers
  );
  const riskNotes = gitPullRequestRiskNotes(status, task, taskMissing, commits, preflight);
  const readiness: GitPullRequestPreview["readiness"] = blockers.length > 0
    ? "Blocked"
    : riskNotes.length > 0
      ? "NeedsReview"
      : "Ready";
  const suggestedBranchName = suggestPullRequestBranchName(task, status.branch, baseBranch);
  const title = suggestPullRequestTitle(task, commits);

  return {
    generatedAt,
    readiness,
    summary: gitPullRequestPreviewSummary(status, baseBranch, commits, readiness),
    preflight,
    baseBranch,
    headBranch: status.branch,
    head: status.head,
    upstream: status.upstream,
    remote: upstreamParts?.remote ?? remote,
    remoteBranch: upstreamParts?.remoteBranch,
    suggestedBranchName,
    title,
    body: buildPullRequestBody(status, baseBranch, title, task, commits, changedFiles, blockers, riskNotes, preflight),
    testPlan: pullRequestTestPlan(task, changedFiles),
    commits,
    changedFiles,
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

function normalizeGitPullRequestPublishRequest(input: GitPullRequestPublishRequest): GitPullRequestPublishRequest {
  if (!isRecord(input)) {
    throw new HttpError(400, "Pull request publish request must be an object.");
  }
  if (input.confirmation !== "PublishPullRequest") {
    throw new HttpError(400, "Publishing a pull request requires explicit confirmation: PublishPullRequest.");
  }
  const githubToken = typeof input.githubToken === "string" ? input.githubToken.trim() : "";
  if (!githubToken) {
    throw new HttpError(400, "Publishing a pull request requires a GitHub token.");
  }
  return {
    taskID: typeof input.taskID === "string" ? input.taskID.trim() : "",
    expectedHead: normalizeSingleLineField(input.expectedHead, "expectedHead", 4, 64),
    expectedHeadBranch: normalizeSingleLineField(input.expectedHeadBranch, "expectedHeadBranch", 1, 200),
    baseBranch: normalizeSingleLineField(input.baseBranch, "baseBranch", 1, 200),
    headBranch: normalizeSingleLineField(input.headBranch, "headBranch", 1, 200),
    title: normalizeSingleLineField(input.title, "title", 1, 300),
    body: typeof input.body === "string" ? input.body.slice(0, 60_000) : "",
    draft: input.draft === true,
    headOwner: typeof input.headOwner === "string" && input.headOwner.trim()
      ? normalizeSingleLineField(input.headOwner, "headOwner", 1, 100)
      : undefined,
    githubToken,
    confirmation: "PublishPullRequest"
  };
}

async function publishGitPullRequest(input: GitPullRequestPublishRequest): Promise<GitPullRequestResult> {
  const request = normalizeGitPullRequestPublishRequest(input);
  const generatedAt = new Date().toISOString();

  const status = await getGitStatusSnapshot();
  if (!status.isRepository || !status.root) {
    throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
  }

  // Re-derive the preview and enforce optimistic concurrency against the review.
  const preview = await getGitPullRequestPreview(request.taskID || null);
  if (preview.blockers.length > 0) {
    throw new HttpError(409, `Pull request is blocked: ${preview.blockers.join(" ")}`);
  }
  if (status.head !== request.expectedHead) {
    throw new HttpError(409, `Git HEAD changed since PR review. Expected ${request.expectedHead}, current ${status.head ?? "unknown"}.`);
  }
  if (!status.branch || status.branch !== request.expectedHeadBranch || status.branch !== request.headBranch) {
    throw new HttpError(409, `Git branch changed since PR review. Expected ${request.expectedHeadBranch}, current ${status.branch ?? "unknown"}.`);
  }
  if (preview.baseBranch !== request.baseBranch) {
    throw new HttpError(409, `PR base branch changed since review. Expected ${request.baseBranch}, current ${preview.baseBranch}.`);
  }
  if (request.baseBranch === request.headBranch) {
    throw new HttpError(409, "Pull request head and base branches must differ.");
  }

  const remote = preview.remote ?? await getFirstGitRemote(status.root);
  if (!remote) {
    throw new HttpError(409, "Publishing a pull request requires a configured git remote.");
  }
  const remoteUrlResult = await runGitCommand(["remote", "get-url", remote], status.root, 8_000);
  if (remoteUrlResult.exitCode !== 0) {
    throw new HttpError(409, `Could not resolve URL for remote "${remote}".`);
  }
  const githubRemote = parseGitHubRemote(remoteUrlResult.output.trim());
  if (!githubRemote) {
    throw new HttpError(409, `Remote "${remote}" is not a recognizable GitHub repository URL.`);
  }

  // Push the head branch so the PR has a remote head to open against.
  const pushResult = await runGitCommand(
    ["push", remote, `HEAD:refs/heads/${request.headBranch}`],
    status.root,
    96_000
  );
  if (pushResult.exitCode !== 0) {
    throw new HttpError(409, gitPushFailureMessage(pushResult.output, "Push before PR failed"));
  }

  const created = await createGitHubPullRequest(githubRemote, request);

  const relatedTask = recordGitPullRequestOnTask(request.taskID, created, request, githubRemote);

  return {
    generatedAt,
    number: created.number,
    url: created.htmlUrl,
    state: created.state,
    draft: created.draft,
    baseBranch: request.baseBranch,
    headBranch: request.headBranch,
    title: request.title,
    remote,
    owner: githubRemote.owner,
    repo: githubRemote.repo,
    pushedCommits: preview.commits,
    relatedTask,
    summary: `Opened ${created.draft ? "draft " : ""}pull request #${created.number} (${request.headBranch} → ${request.baseBranch}) on ${githubRemote.owner}/${githubRemote.repo}.`,
    outputSummary: summarizeGitCommandOutput(pushResult.output),
    operationBoundary: "Pushed the head branch and opened a pull request. Forge did not merge, force push, reset, or delete branches."
  };
}

interface CreatedGitHubPullRequest {
  number: number;
  htmlUrl: string;
  state: string;
  draft: boolean;
}

async function createGitHubPullRequest(
  remote: { owner: string; repo: string },
  request: GitPullRequestPublishRequest
): Promise<CreatedGitHubPullRequest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(`${githubApiBase}/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Forge",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: request.title,
        // Fork heads are addressed as `owner:branch`; same-repo heads are bare.
        head: request.headOwner ? `${request.headOwner}:${request.headBranch}` : request.headBranch,
        base: request.baseBranch,
        body: request.body,
        draft: request.draft === true
      }),
      signal: controller.signal
    });
  } catch (error) {
    throw new HttpError(502, `GitHub pull request request failed: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    // GitHub error bodies do not echo the Authorization header; surface the
    // status and GitHub's own message without leaking the token.
    throw new HttpError(response.status === 401 || response.status === 403 ? 401 : 409, gitHubApiErrorMessage(response.status, text));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(502, "GitHub returned an unparseable pull request response.");
  }
  if (!isRecord(parsed) || typeof parsed.number !== "number" || typeof parsed.html_url !== "string") {
    throw new HttpError(502, "GitHub pull request response was missing required fields.");
  }
  return {
    number: parsed.number,
    htmlUrl: parsed.html_url,
    state: typeof parsed.state === "string" ? parsed.state : "open",
    draft: parsed.draft === true
  };
}

function gitHubApiErrorMessage(statusCode: number, body: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(body);
    if (isRecord(parsed) && typeof parsed.message === "string") {
      detail = parsed.message;
      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        const first = parsed.errors[0];
        if (isRecord(first) && typeof first.message === "string") {
          detail += ` (${first.message})`;
        }
      }
    }
  } catch {
    detail = "";
  }
  const base = statusCode === 401 || statusCode === 403
    ? "GitHub rejected the token (check its scopes and repository access)"
    : statusCode === 422
      ? "GitHub could not create the pull request"
      : `GitHub responded with status ${statusCode}`;
  return detail ? `${base}: ${detail}` : `${base}.`;
}

function recordGitPullRequestOnTask(
  taskID: string | undefined,
  created: CreatedGitHubPullRequest,
  request: GitPullRequestPublishRequest,
  remote: { owner: string; repo: string }
): GitPullRequestResult["relatedTask"] {
  if (!taskID) {
    return undefined;
  }
  const task = tasks.get(taskID);
  if (!task) {
    return undefined;
  }
  const now = new Date().toISOString();
  const summary = `Opened pull request #${created.number} on ${remote.owner}/${remote.repo} (${request.headBranch} → ${request.baseBranch}).`;
  const updatedTask: ForgeTask = {
    ...task,
    updatedAt: now,
    pullRequest: {
      number: created.number,
      url: created.htmlUrl,
      state: created.state,
      merged: false,
      draft: created.draft,
      owner: remote.owner,
      repo: remote.repo,
      baseBranch: request.baseBranch,
      headBranch: request.headBranch,
      openedAt: now,
      lastCheckedAt: now
    },
    approvals: [
      ...task.approvals,
      {
        id: randomUUID(),
        action: "Publish Pull Request" as ApprovalRecord["action"],
        decision: "Approved" as const,
        summary,
        decidedAt: now,
        targetID: created.htmlUrl
      }
    ],
    events: [
      ...task.events,
      event("git.pull_request.published", `${summary} ${created.htmlUrl}`)
    ]
  };
  tasks.set(updatedTask.id, updatedTask);
  taskStore.saveTask(updatedTask);
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    currentPhase: task.currentPhase,
    summary
  };
}

/**
 * Refresh the persisted PR's real state from GitHub (open / closed / merged).
 * Read-only against GitHub; the token is per-request and never stored.
 */
async function refreshGitPullRequestStatus(
  input: GitPullRequestStatusRequest
): Promise<{ generatedAt: string; pullRequest: TaskPullRequest; summary: string; relatedTask?: GitPullRequestResult["relatedTask"] }> {
  if (!isRecord(input)) {
    throw new HttpError(400, "Pull request status request must be an object.");
  }
  const taskID = typeof input.taskID === "string" ? input.taskID.trim() : "";
  if (!taskID) {
    throw new HttpError(400, "Pull request status requires a taskID.");
  }
  const githubToken = typeof input.githubToken === "string" ? input.githubToken.trim() : "";
  if (!githubToken) {
    throw new HttpError(400, "Pull request status requires a GitHub token.");
  }
  const task = tasks.get(taskID);
  if (!task) {
    throw new HttpError(404, `Task ${taskID} was not found.`);
  }
  const existing = task.pullRequest;
  if (!existing) {
    throw new HttpError(409, "This task has no published pull request to refresh.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(
      `${githubApiBase}/repos/${encodeURIComponent(existing.owner)}/${encodeURIComponent(existing.repo)}/pulls/${existing.number}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Forge"
        },
        signal: controller.signal
      }
    );
  } catch (error) {
    throw new HttpError(502, `GitHub pull request status request failed: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status === 401 || response.status === 403 ? 401 : 409, gitHubApiErrorMessage(response.status, text));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(502, "GitHub returned an unparseable pull request status response.");
  }
  if (!isRecord(parsed)) {
    throw new HttpError(502, "GitHub pull request status response was not an object.");
  }

  const now = new Date().toISOString();
  const merged = parsed.merged === true || typeof parsed.merged_at === "string";
  const refreshed: TaskPullRequest = {
    ...existing,
    state: typeof parsed.state === "string" ? parsed.state : existing.state,
    merged,
    draft: parsed.draft === true,
    lastCheckedAt: now
  };

  const stateChanged = refreshed.state !== existing.state || refreshed.merged !== existing.merged || refreshed.draft !== existing.draft;
  const summary = merged
    ? `Pull request #${refreshed.number} is merged.`
    : refreshed.state === "closed"
      ? `Pull request #${refreshed.number} was closed without merging.`
      : `Pull request #${refreshed.number} is ${refreshed.draft ? "an open draft" : "open"}.`;

  const updatedTask: ForgeTask = {
    ...task,
    updatedAt: stateChanged ? now : task.updatedAt,
    pullRequest: refreshed,
    events: stateChanged
      ? [...task.events, event("git.pull_request.state_changed", summary)]
      : task.events
  };
  tasks.set(updatedTask.id, updatedTask);
  taskStore.saveTask(updatedTask);

  return {
    generatedAt: now,
    pullRequest: refreshed,
    summary,
    relatedTask: {
      id: task.id,
      title: task.title,
      status: task.status,
      currentPhase: task.currentPhase,
      summary
    }
  };
}

type GitRemoteSummary = {
  name: string;
  urlKind: "HTTPS" | "SSH" | "Local" | "Other" | "Unknown";
};

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

async function listGitRemoteSummaries(gitRoot: string): Promise<GitRemoteSummary[]> {
  const result = await runGitCommand(["remote"], gitRoot, 8_000);
  if (result.exitCode !== 0) {
    return [];
  }

  const remotes = result.output
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean);

  return Promise.all(remotes.map(async (name) => {
    const urlResult = await runGitCommand(["remote", "get-url", name], gitRoot, 8_000);
    return {
      name,
      urlKind: summarizeRemoteURLKind(urlResult.exitCode === 0 ? urlResult.output.trim() : undefined)
    };
  }));
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

async function resolveGitBaseRef(gitRoot: string, remote: string, baseBranch: string): Promise<string | undefined> {
  const remoteRef = `${remote}/${baseBranch}`;
  const remoteResult = await runGitCommand([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/remotes/${remoteRef}`
  ], gitRoot, 8_000);
  if (remoteResult.exitCode === 0) {
    return remoteRef;
  }

  const localResult = await runGitCommand([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${baseBranch}`
  ], gitRoot, 8_000);
  if (localResult.exitCode === 0) {
    return baseBranch;
  }

  return undefined;
}

async function collectGitChangedFilesInRange(gitRoot: string, range: string): Promise<GitFileChange[]> {
  const [nameStatusResult, numstatResult] = await Promise.all([
    runGitCommand(["diff", "--name-status", "--find-renames", range, "--"], gitRoot, 64_000),
    runGitCommand(["diff", "--numstat", range, "--"], gitRoot, 64_000)
  ]);
  if (nameStatusResult.exitCode !== 0) {
    return [];
  }

  const stats = parseGitRangeNumstat(numstatResult.exitCode === 0 ? numstatResult.output : "");
  return nameStatusResult.output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => gitFileChangeFromNameStatus(line, stats))
    .filter((change): change is GitFileChange => Boolean(change))
    .filter(isSafeGitChange);
}

function unavailableGitPullRequestPreflight(
  status: GitStatusSnapshot,
  baseBranch: string,
  task: ForgeTask | undefined
): NonNullable<GitPullRequestPreview["preflight"]> {
  const validationSummary = commitValidationSummary(task);
  return {
    baseRefStatus: "Missing",
    baseRefSummary: "Base branch could not be inspected because git status is unavailable.",
    headBranchStatus: status.branch && !status.branch.startsWith("HEAD") ? "Ready" : "Detached",
    headBranchSummary: status.branch
      ? `Current checkout reports ${status.branch}.`
      : "Current checkout could not be resolved to a branch.",
    upstreamStatus: "Missing",
    upstreamSummary: "No upstream remote branch could be inspected.",
    remoteStatus: "Missing",
    remoteSummary: "No git remote could be inspected.",
    validationState: commitValidationState(validationSummary),
    validationSummary,
    testEvidence: pullRequestValidationEvidence(task),
    publishReadinessSummary: `Resolve git repository access before preparing a PR into ${baseBranch}.`
  };
}

function gitPullRequestPreflight(
  status: GitStatusSnapshot,
  baseBranch: string,
  baseRef: string | undefined,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  remote: string | undefined,
  remoteSummaries: GitRemoteSummary[],
  task: ForgeTask | undefined,
  changedFiles: GitFileChange[],
  blockers: string[]
): NonNullable<GitPullRequestPreview["preflight"]> {
  const validationSummary = commitValidationSummary(task);
  const headBranchStatus = pullRequestHeadBranchStatus(status, baseBranch);
  const upstreamStatus = pullRequestUpstreamStatus(status, upstreamParts);
  const remoteState = pullRequestRemoteState(remote, remoteSummaries);
  const validationState = commitValidationState(validationSummary);

  return {
    baseRefStatus: baseRef ? "Resolved" : "Missing",
    baseRefSummary: baseRef
      ? `Base comparison will use ${baseRef}.`
      : `Default base branch ${baseBranch} could not be resolved locally.`,
    headBranchStatus,
    headBranchSummary: pullRequestHeadBranchSummary(status, baseBranch, headBranchStatus),
    upstreamStatus,
    upstreamSummary: pullRequestUpstreamSummary(status, upstreamParts, upstreamStatus),
    remoteStatus: remoteState.status,
    remoteSummary: remoteState.summary,
    validationState,
    validationSummary,
    testEvidence: pullRequestValidationEvidence(task, changedFiles),
    publishReadinessSummary: pullRequestPublishReadinessSummary(blockers, validationState, remoteState.status)
  };
}

function pullRequestHeadBranchStatus(
  status: GitStatusSnapshot,
  baseBranch: string
): NonNullable<GitPullRequestPreview["preflight"]>["headBranchStatus"] {
  if (!status.branch || status.branch.startsWith("HEAD")) {
    return "Detached";
  }

  if (status.branch === baseBranch) {
    return "DefaultBranch";
  }

  return "Ready";
}

function pullRequestHeadBranchSummary(
  status: GitStatusSnapshot,
  baseBranch: string,
  headBranchStatus: NonNullable<GitPullRequestPreview["preflight"]>["headBranchStatus"]
): string {
  if (headBranchStatus === "Detached") {
    return "Current checkout is detached; switch to a task branch before PR publication.";
  }

  if (headBranchStatus === "DefaultBranch") {
    return `Current branch is ${baseBranch}; create or switch to a task branch before PR publication.`;
  }

  return `Current branch ${status.branch} can be used as the PR head.`;
}

function pullRequestUpstreamStatus(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined
): NonNullable<GitPullRequestPreview["preflight"]>["upstreamStatus"] {
  if (!upstreamParts) {
    return "Missing";
  }

  if ((status.ahead ?? 0) > 0) {
    return "Unpushed";
  }

  if ((status.behind ?? 0) > 0) {
    return "Behind";
  }

  return "Ready";
}

function pullRequestUpstreamSummary(
  status: GitStatusSnapshot,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  upstreamStatus: NonNullable<GitPullRequestPreview["preflight"]>["upstreamStatus"]
): string {
  if (!upstreamParts) {
    return "No upstream remote branch is configured for the current branch.";
  }

  if (upstreamStatus === "Unpushed") {
    return `Push ${status.ahead ?? 0} local commit(s) to ${upstreamParts.remote}/${upstreamParts.remoteBranch} before PR publication.`;
  }

  if (upstreamStatus === "Behind") {
    return `Update from ${upstreamParts.remote}/${upstreamParts.remoteBranch}; branch is behind by ${status.behind ?? 0} commit(s).`;
  }

  return `Current branch is synced with ${upstreamParts.remote}/${upstreamParts.remoteBranch}.`;
}

function pullRequestRemoteState(
  remote: string | undefined,
  remoteSummaries: GitRemoteSummary[]
): {
  status: NonNullable<GitPullRequestPreview["preflight"]>["remoteStatus"];
  summary: string;
} {
  if (!remote) {
    return {
      status: "Missing",
      summary: "No configured git remote was found for PR handoff."
    };
  }

  const selectedRemote = remoteSummaries.find((candidate) => candidate.name === remote);
  const remoteNames = remoteSummaries.map((candidate) => candidate.name).join(", ");

  if (!selectedRemote) {
    return {
      status: "Unknown",
      summary: `Selected remote ${remote} was not found in the local remote list.`
    };
  }

  if (remoteSummaries.length > 1 || remote !== "origin") {
    return {
      status: "ForkLike",
      summary: `Multiple or non-origin remotes are configured (${remoteNames}); verify the base repository before PR publication.`
    };
  }

  return {
    status: "Ready",
    summary: `Remote ${remote} is configured (${selectedRemote.urlKind}).`
  };
}

function pullRequestValidationEvidence(task: ForgeTask | undefined, changedFiles: GitFileChange[] = []): string[] {
  if (!task) {
    return ["No task context is linked, so Forge cannot attach task validation evidence."];
  }

  const runs = task.validationRuns.slice(-3);
  if (runs.length === 0) {
    return ["No Forge validation run is linked yet."];
  }

  const evidence = runs.map((run) => `${run.presetName}: ${run.status} - ${run.summary}`);
  for (const command of suggestedCommitValidationCommands(changedFiles)) {
    if (!evidence.some((line) => line.includes(command))) {
      evidence.push(`Suggested: ${command}`);
    }
  }

  return evidence.slice(0, 8);
}

function pullRequestPublishReadinessSummary(
  blockers: string[],
  validationState: NonNullable<GitPullRequestPreview["preflight"]>["validationState"],
  remoteStatus: NonNullable<GitPullRequestPreview["preflight"]>["remoteStatus"]
): string {
  if (blockers.length > 0) {
    return `Resolve ${blockers.length} blocker(s) before creating or publishing a PR.`;
  }

  if (validationState !== "Passed") {
    return "Branch metadata is ready, but validation evidence needs review before publication.";
  }

  if (remoteStatus === "ForkLike" || remoteStatus === "Unknown") {
    return "Branch metadata is ready, but the target base repository should be verified before publication.";
  }

  return "PR handoff is ready for a future approved publication step.";
}

function gitPullRequestBlockers(
  status: GitStatusSnapshot,
  baseBranch: string,
  upstreamParts: { remote: string; remoteBranch: string } | undefined,
  commits: GitCommitToPush[],
  baseRef: string | undefined
): string[] {
  const blockers: string[] = [];

  if (!status.branch || status.branch.startsWith("HEAD")) {
    blockers.push("Current checkout is detached; PR handoff requires a named branch.");
  } else if (status.branch === baseBranch) {
    blockers.push(`Current branch is the default base branch (${baseBranch}); create or switch to a task branch before PR handoff.`);
  }

  if (!baseRef) {
    blockers.push(`Default base branch ${baseBranch} could not be resolved locally.`);
  }

  if (!upstreamParts) {
    blockers.push("Current branch has no upstream remote branch; push the branch before PR handoff.");
  }

  if ((status.ahead ?? 0) > 0) {
    blockers.push(`Current branch still has ${status.ahead} unpushed commit(s); push before PR handoff.`);
  }

  if ((status.behind ?? 0) > 0) {
    blockers.push(`Current branch is behind upstream by ${status.behind} commit(s); update before PR handoff.`);
  }

  const unmerged = status.changedFiles.filter((change) => change.status === "Unmerged");
  if (unmerged.length > 0) {
    blockers.push(`Resolve ${unmerged.length} unmerged file(s) before PR handoff.`);
  }

  if (commits.length === 0) {
    blockers.push("No commits were found between the base branch and HEAD for a PR.");
  }

  return blockers;
}

function gitPullRequestRiskNotes(
  status: GitStatusSnapshot,
  task: ForgeTask | undefined,
  taskMissing: boolean,
  commits: GitCommitToPush[],
  preflight?: NonNullable<GitPullRequestPreview["preflight"]>
): string[] {
  const notes: string[] = [];

  if (taskMissing) {
    notes.push("The requested task was not found, so this preview is based on branch state only.");
  }

  if (!task) {
    notes.push("No task context is linked to this PR preview.");
  }

  if (status.isDirty) {
    notes.push(`${status.changedFiles.length} uncommitted file(s) are not part of the pushed branch yet.`);
  }

  const latestRun = task?.validationRuns.at(-1);
  if (!latestRun) {
    notes.push("No Forge validation run is linked to this PR preview.");
  } else if (latestRun.status !== "Passed") {
    notes.push(`Latest Forge validation is ${latestRun.status}: ${latestRun.summary}`);
  }

  if (commits.length >= 20) {
    notes.push("Only the first 20 commits are shown in this PR preview.");
  }

  if (preflight?.remoteStatus === "ForkLike" || preflight?.remoteStatus === "Unknown") {
    notes.push(preflight.remoteSummary);
  }

  return notes;
}

function gitPullRequestPreviewSummary(
  status: GitStatusSnapshot,
  baseBranch: string,
  commits: GitCommitToPush[],
  readiness: GitPullRequestPreview["readiness"]
): string {
  if (readiness === "Blocked") {
    return `PR handoff is blocked for ${status.branch ?? "current checkout"} into ${baseBranch}.`;
  }

  return `${commits.length} commit(s) are ready for PR handoff from ${status.branch ?? "current checkout"} into ${baseBranch}.`;
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

function suggestPullRequestTitle(task: ForgeTask | undefined, commits: GitCommitToPush[]): string {
  if (task?.title) {
    return normalizeCommitTitle(task.title);
  }

  if (commits[0]?.title) {
    return normalizeCommitTitle(commits[0].title);
  }

  return "Update Forge workspace";
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

function buildPullRequestBody(
  status: GitStatusSnapshot,
  baseBranch: string,
  title: string,
  task: ForgeTask | undefined,
  commits: GitCommitToPush[],
  changedFiles: GitFileChange[],
  blockers: string[],
  riskNotes: string[],
  preflight?: NonNullable<GitPullRequestPreview["preflight"]>
): string[] {
  const lines = [
    "## Summary",
    `- ${task?.reviewSummary ?? task?.objective ?? title}`,
    "",
    "## Branch",
    `- Head: ${status.branch ?? "detached"}`,
    `- Base: ${baseBranch}`,
    `- Upstream: ${status.upstream ?? "not configured"}`
  ];

  if (preflight) {
    lines.push(
      "",
      "## Preflight",
      `- Base ref: ${preflight.baseRefStatus} - ${preflight.baseRefSummary}`,
      `- Head branch: ${preflight.headBranchStatus} - ${preflight.headBranchSummary}`,
      `- Upstream: ${preflight.upstreamStatus} - ${preflight.upstreamSummary}`,
      `- Remote: ${preflight.remoteStatus} - ${preflight.remoteSummary}`,
      `- Validation: ${preflight.validationState} - ${preflight.validationSummary}`
    );
  }

  if (task) {
    lines.push("", "## Linked Task", `- ${task.title} (${task.id})`, `- Status: ${task.status} / ${task.currentPhase}`);
  }

  if (commits.length > 0) {
    lines.push("", "## Commits");
    for (const commit of commits.slice(0, 10)) {
      lines.push(`- ${commit.shortHash} ${commit.title}`);
    }
    if (commits.length > 10) {
      lines.push(`- ${commits.length - 10} more commit(s)`);
    }
  }

  if (changedFiles.length > 0) {
    lines.push("", "## Changed Files");
    for (const file of changedFiles.slice(0, 12)) {
      lines.push(`- ${commitFileSummary(file)}`);
    }
    if (changedFiles.length > 12) {
      lines.push(`- ${changedFiles.length - 12} more file(s)`);
    }
  }

  if (blockers.length > 0) {
    lines.push("", "## Blockers", ...blockers.map((blocker) => `- ${blocker}`));
  }

  if (riskNotes.length > 0) {
    lines.push("", "## Risk Notes", ...riskNotes.map((note) => `- ${note}`));
  }

  return lines;
}

function pullRequestTestPlan(task: ForgeTask | undefined, changedFiles: GitFileChange[]): string[] {
  const latestRun = task?.validationRuns.at(-1);
  const plan: string[] = [];

  if (latestRun) {
    plan.push(`${latestRun.presetName}: ${latestRun.status} - ${latestRun.summary}`);
    plan.push(...latestRun.commands.slice(0, 5).map((command) =>
      `${command.command}: ${command.status}${command.exitCode === undefined ? "" : ` (${command.exitCode})`}`
    ));
  } else {
    plan.push("No Forge validation run is linked yet.");
  }

  for (const command of suggestedCommitValidationCommands(changedFiles)) {
    if (!plan.some((line) => line.includes(command))) {
      plan.push(`Suggested: ${command}`);
    }
  }

  return plan.slice(0, 8);
}

function commitPreviewBlockers(
  status: GitStatusSnapshot,
  files: GitFileChange[],
  preflight?: GitCommitPreview["preflight"]
): string[] {
  const blockers: string[] = [];

  if (!status.isDirty || files.length === 0) {
    blockers.push("Working tree is clean; there are no file changes to commit.");
  }

  const unmergedFiles = files.filter((file) => file.status === "Unmerged");
  if (unmergedFiles.length > 0) {
    blockers.push(`Resolve ${unmergedFiles.length} unmerged file(s) before preparing a commit.`);
  }

  if (preflight?.identityStatus === "Missing") {
    blockers.push("Git author identity is not configured; set user.name and user.email before committing.");
  }

  return blockers;
}

function commitPreviewRiskNotes(
  status: GitStatusSnapshot,
  files: GitFileChange[],
  task: ForgeTask | undefined,
  taskMissing: boolean,
  validationSummary: string,
  preflight?: GitCommitPreview["preflight"]
): string[] {
  const notes: string[] = [];

  if (taskMissing) {
    notes.push("The requested task was not found, so this preview is based on working tree state only.");
  }

  if (!task) {
    notes.push("No task context is linked to this preview.");
  }

  const unstagedCount = files.filter((file) => file.unstaged || file.untracked).length;
  if (unstagedCount > 0) {
    notes.push(`${unstagedCount} file(s) are unstaged or untracked; review inclusion before committing.`);
  }

  const stagedCount = files.filter((file) => file.staged).length;
  if (stagedCount > 0 && unstagedCount > 0) {
    notes.push("The working tree mixes staged and unstaged changes; the eventual commit boundary needs explicit review.");
  }

  if ((status.behind ?? 0) > 0) {
    notes.push(`Current branch is behind upstream by ${status.behind} commit(s).`);
  }

  if (preflight?.largeChangeSet && preflight.largeChangeSummary) {
    notes.push(preflight.largeChangeSummary);
  }

  if ((preflight?.filesWithoutStats ?? 0) > 0) {
    notes.push(`${preflight?.filesWithoutStats} file(s) do not have line-count stats; review binary or rename-only changes carefully.`);
  }

  if (validationSummary.includes("Failed")) {
    notes.push("Latest task validation failed; repair or explicitly accept the risk before committing.");
  } else if (validationSummary.includes("No validation run")) {
    notes.push("No task validation run is linked yet.");
  }

  return notes;
}

async function collectGitCommitPreflight(
  status: GitStatusSnapshot,
  files: GitFileChange[],
  validationSummary: string
): Promise<GitCommitPreview["preflight"]> {
  const identity = status.root
    ? await getGitAuthorIdentitySummary(status.root)
    : {
        identityStatus: "Unknown" as const,
        identitySummary: "Git author identity could not be inspected because the repository root is unavailable."
      };
  const stagedFileCount = files.filter((file) => file.staged).length;
  const unstagedFileCount = files.filter((file) => file.unstaged).length;
  const untrackedFileCount = files.filter((file) => file.untracked).length;
  const totalAdditions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const totalDeletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const filesWithoutStats = files.filter((file) => file.additions === undefined || file.deletions === undefined).length;
  const totalLineChanges = totalAdditions + totalDeletions;
  const largeChangeReasons = [
    files.length > 30 ? `${files.length} files` : undefined,
    totalLineChanges > 1_000 ? `${totalLineChanges} line changes` : undefined
  ].filter(Boolean);
  const largeChangeSet = largeChangeReasons.length > 0;

  return {
    ...identity,
    stagedFileCount,
    unstagedFileCount,
    untrackedFileCount,
    totalAdditions,
    totalDeletions,
    filesWithoutStats,
    largeChangeSet,
    largeChangeSummary: largeChangeSet
      ? `Large commit candidate: ${largeChangeReasons.join(", ")}. Consider splitting the commit or running targeted validation.`
      : undefined,
    validationState: commitValidationState(validationSummary),
    hookRiskSummary: "Local git commit hooks may still run during commit; Forge will surface git commit output if a hook rejects the commit.",
    pathLimit: 100
  };
}

async function getGitAuthorIdentitySummary(
  gitRoot: string
): Promise<Pick<NonNullable<GitCommitPreview["preflight"]>, "identityStatus" | "identitySummary">> {
  const identityResult = await runGitCommand(["var", "GIT_AUTHOR_IDENT"], gitRoot, 8_000);
  if (identityResult.exitCode === 0) {
    const identity = identityResult.output.trim().replace(/\s+\d+\s+[+-]\d{4}$/, "");
    return {
      identityStatus: "Ready",
      identitySummary: identity ? `Git author identity is configured as ${identity}.` : "Git author identity is configured."
    };
  }

  return {
    identityStatus: "Missing",
    identitySummary: identityResult.output.trim() || "Git author identity is not configured."
  };
}

function commitValidationState(validationSummary: string): NonNullable<GitCommitPreview["preflight"]>["validationState"] {
  if (validationSummary.includes("Passed")) {
    return "Passed";
  }

  if (validationSummary.includes("Failed")) {
    return "Failed";
  }

  if (validationSummary.includes("No validation run")) {
    return "Missing";
  }

  return "Unknown";
}

function suggestedCommitValidationCommands(files: GitFileChange[]): string[] {
  const paths = files.map((file) => file.path);
  const commands = ["git diff --check"];

  if (paths.some((filePath) => filePath.startsWith("runtime/"))) {
    commands.push("cd runtime && npm run check");
    commands.push("cd runtime && npm run build");
  }

  if (paths.some((filePath) => filePath.startsWith("apps/macos/") || filePath === "Package.swift")) {
    commands.push("swift build");
  }

  return [...new Set(commands)];
}

function commitValidationSummary(task: ForgeTask | undefined): string {
  if (!task) {
    return "No validation run is linked to this preview.";
  }

  const latestRun = task.validationRuns.at(-1);
  if (!latestRun) {
    return "No validation run is linked to this task yet.";
  }

  return `${latestRun.status}: ${latestRun.summary}`;
}

function suggestCommitTitle(task: ForgeTask | undefined, files: GitFileChange[]): string {
  if (task?.title) {
    return normalizeCommitTitle(task.title);
  }

  const paths = files.map((file) => file.path);
  const touchesRuntime = paths.some((filePath) => filePath.startsWith("runtime/"));
  const touchesMacApp = paths.some((filePath) => filePath.startsWith("apps/macos/") || filePath === "Package.swift");
  const touchesDocs = paths.some((filePath) => filePath === "README.md" || filePath.startsWith("docs/"));
  const touchesDesign = paths.some((filePath) => filePath.startsWith("design_handoff_forge/"));

  if (touchesRuntime && touchesMacApp) {
    return "Advance Forge agent review workflow";
  }

  if (touchesRuntime) {
    return "Update Forge runtime workflow";
  }

  if (touchesMacApp) {
    return "Update Forge macOS review UI";
  }

  if (touchesDesign) {
    return "Add Forge design handoff assets";
  }

  if (touchesDocs) {
    return "Update Forge documentation";
  }

  return "Update Forge workspace";
}

function normalizeCommitTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
  if (!normalized) {
    return "Update Forge workspace";
  }

  const capitalized = `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
  return capitalized.length > 72 ? `${capitalized.slice(0, 69).trimEnd()}...` : capitalized;
}

function buildSuggestedCommitBody(
  status: GitStatusSnapshot,
  task: ForgeTask | undefined,
  files: GitFileChange[],
  validationSummary: string
): string[] {
  const body = [
    `Branch: ${status.branch ?? "detached"}${status.head ? ` @ ${status.head}` : ""}`,
    `Files: ${files.length} changed`,
    `Validation: ${validationSummary}`
  ];

  if (task) {
    body.splice(1, 0, `Task: ${task.title} (${task.id})`);
  }

  const fileLines = files.slice(0, 8).map((file) => `- ${commitFileSummary(file)}`);
  if (fileLines.length > 0) {
    body.push("Changed files:", ...fileLines);
  }

  if (files.length > fileLines.length) {
    body.push(`- ${files.length - fileLines.length} more file(s)`);
  }

  return body;
}

function commitPreviewSummary(
  status: GitStatusSnapshot,
  files: GitFileChange[],
  readiness: GitCommitPreview["readiness"]
): string {
  if (readiness === "Blocked") {
    return `Commit preparation is blocked on ${status.branch ?? "current checkout"}.`;
  }

  const stagedCount = files.filter((file) => file.staged).length;
  const unstagedCount = files.filter((file) => file.unstaged || file.untracked).length;
  return `${files.length} file(s) on ${status.branch ?? "current checkout"}; ${stagedCount} staged, ${unstagedCount} unstaged or untracked.`;
}

function commitFileSummary(file: GitFileChange): string {
  const stats = file.additions === undefined || file.deletions === undefined
    ? ""
    : ` (+${file.additions} -${file.deletions})`;
  const staged = file.staged ? "staged" : "not staged";
  const working = file.untracked ? "untracked" : file.unstaged ? "unstaged" : "clean index";
  return `${file.status}: ${file.path}${stats} [${staged}, ${working}]`;
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

function event(type: string, message: string): RuntimeEvent {
  return { type, message, createdAt: "" };
}

return {
  getGitBranchPreview,
  createOrSwitchGitBranch,
  getGitBranchPublishPreview,
  publishGitBranch,
  getGitCommitPreview,
  createGitCommit,
  getGitPushPreview,
  pushGitBranch,
  getGitPullRequestPreview,
  publishGitPullRequest,
  refreshGitPullRequestStatus
};
}
