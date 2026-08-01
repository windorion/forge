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

export function createGitBranchPublishService(options: {
  runGitCommand: GitCommand;
  getGitStatusSnapshot: () => Promise<GitStatusSnapshot>;
  tasks: Map<string, ForgeTask>;
  saveTask: (task: ForgeTask) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
  githubApiBase: string;
}) {
const { runGitCommand, getGitStatusSnapshot, tasks, emit, githubApiBase } = options;
const taskStore = { saveTask: options.saveTask };

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
  getGitBranchPublishPreview,
  publishGitBranch
};
}
