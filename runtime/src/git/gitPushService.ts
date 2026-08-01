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

export function createGitPushService(options: {
  runGitCommand: GitCommand;
  getGitStatusSnapshot: () => Promise<GitStatusSnapshot>;
  tasks: Map<string, ForgeTask>;
  saveTask: (task: ForgeTask) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
  githubApiBase: string;
}) {
const { runGitCommand, getGitStatusSnapshot, tasks, emit, githubApiBase } = options;
const taskStore = { saveTask: options.saveTask };

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
  getGitPushPreview,
  pushGitBranch
};
}
