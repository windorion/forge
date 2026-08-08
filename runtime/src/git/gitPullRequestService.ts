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

export function createGitPullRequestService(options: {
  runGitCommand: GitCommand;
  getGitStatusSnapshot: () => Promise<GitStatusSnapshot>;
  tasks: Map<string, ForgeTask>;
  saveTask: (task: ForgeTask) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
  githubApiBase: string;
}) {
const { runGitCommand, getGitStatusSnapshot, tasks, emit, githubApiBase } = options;
const taskStore = { saveTask: options.saveTask };
const activePullRequestRefreshTaskIDs = new Set<string>();

interface CreatedGitHubPullRequest {
  number: number;
  htmlUrl: string;
  state: string;
  draft: boolean;
}

interface GitHubReadResult {
  ok: boolean;
  status: number;
  value?: unknown;
  error?: string;
}

interface PullRequestReviewEvidence {
  status: NonNullable<TaskPullRequest["reviewStatus"]>;
  approvals: number;
  changesRequested: number;
  requestedReviewers: number;
  summary: string;
}

interface PullRequestCheckEvidence {
  status: NonNullable<TaskPullRequest["checksStatus"]>;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  skipped: number;
  summary: string;
}

type GitRemoteSummary = {
  name: string;
  urlKind: "HTTPS" | "SSH" | "Local" | "Other" | "Unknown";
  github?: { owner: string; repo: string };
};

type PullRequestRemoteTopology = {
  baseRemote?: GitRemoteSummary;
  headRemote?: GitRemoteSummary;
  forkDetected: boolean;
  headOwner?: string;
  summary: string;
};

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
  const remoteTopology = resolvePullRequestRemoteTopology(remoteSummaries, upstreamParts?.remote);
  const remote = remoteTopology.baseRemote?.name ?? upstreamParts?.remote ?? remoteSummaries[0]?.name ?? await getFirstGitRemote(status.root);
  const headRemote = remoteTopology.headRemote?.name ?? upstreamParts?.remote ?? remote;
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
    remote,
    headRemote,
    remoteBranch: upstreamParts?.remoteBranch,
    baseOwner: remoteTopology.baseRemote?.github?.owner,
    baseRepository: remoteTopology.baseRemote?.github?.repo,
    headOwner: remoteTopology.headOwner,
    forkDetected: remoteTopology.forkDetected,
    forkSummary: remoteTopology.summary,
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
  const headRemote = preview.headRemote ?? remote;
  const remoteUrlResult = await runGitCommand(["remote", "get-url", remote], status.root, 8_000);
  if (remoteUrlResult.exitCode !== 0) {
    throw new HttpError(409, `Could not resolve URL for remote "${remote}".`);
  }
  const githubRemote = parseGitHubRemote(remoteUrlResult.output.trim());
  if (!githubRemote) {
    throw new HttpError(409, `Remote "${remote}" is not a recognizable GitHub repository URL.`);
  }

  if (request.headOwner && preview.headOwner && request.headOwner !== preview.headOwner) {
    throw new HttpError(409, `Fork head owner changed since PR review. Expected ${request.headOwner}, current ${preview.headOwner}.`);
  }
  const headOwner = preview.headOwner ?? request.headOwner;

  // Push the head branch so the PR has a remote head to open against.
  const pushResult = await runGitCommand(
    ["push", headRemote, `HEAD:refs/heads/${request.headBranch}`],
    status.root,
    96_000
  );
  if (pushResult.exitCode !== 0) {
    throw new HttpError(409, gitPushFailureMessage(pushResult.output, "Push before PR failed"));
  }

  const created = await createGitHubPullRequest(githubRemote, request, headOwner);

  const relatedTask = recordGitPullRequestOnTask(request.taskID, created, request, githubRemote, {
    baseRemote: remote,
    headRemote,
    headOwner,
    forkDetected: preview.forkDetected === true
  });

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
    headRemote,
    headOwner,
    forkDetected: preview.forkDetected === true,
    owner: githubRemote.owner,
    repo: githubRemote.repo,
    pushedCommits: preview.commits,
    relatedTask,
    summary: `Opened ${created.draft ? "draft " : ""}pull request #${created.number} (${request.headBranch} → ${request.baseBranch}) on ${githubRemote.owner}/${githubRemote.repo}.`,
    outputSummary: summarizeGitCommandOutput(pushResult.output),
    operationBoundary: "Pushed the head branch and opened a pull request. Forge did not merge, force push, reset, or delete branches."
  };
}


async function createGitHubPullRequest(
  remote: { owner: string; repo: string },
  request: GitPullRequestPublishRequest,
  headOwner?: string
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
        head: headOwner ? `${headOwner}:${request.headBranch}` : request.headBranch,
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
  const boundedDetail = detail.replace(/\s+/g, " ").trim().slice(0, 1_000);
  return boundedDetail ? `${base}: ${boundedDetail}` : `${base}.`;
}


function recordGitPullRequestOnTask(
  taskID: string | undefined,
  created: CreatedGitHubPullRequest,
  request: GitPullRequestPublishRequest,
  remote: { owner: string; repo: string },
  topology: { baseRemote: string; headRemote: string; headOwner?: string; forkDetected: boolean }
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
      headOwner: topology.headOwner,
      baseRemote: topology.baseRemote,
      headRemote: topology.headRemote,
      forkDetected: topology.forkDetected,
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
 * Refresh the persisted PR's state, review decision, and check runs from
 * GitHub. Read-only against GitHub; the token is per-request and never stored.
 */
async function refreshGitPullRequestStatus(input: GitPullRequestStatusRequest) {
  const taskID = isRecord(input) && typeof input.taskID === "string" ? input.taskID.trim() : "";
  if (!taskID) {
    return executeGitPullRequestStatusRefresh(input);
  }
  if (activePullRequestRefreshTaskIDs.has(taskID)) {
    throw new HttpError(409, `Pull request status refresh is already active for task ${taskID}.`);
  }
  activePullRequestRefreshTaskIDs.add(taskID);
  try {
    return await executeGitPullRequestStatusRefresh(input);
  } finally {
    activePullRequestRefreshTaskIDs.delete(taskID);
  }
}

async function executeGitPullRequestStatusRefresh(
  input: GitPullRequestStatusRequest
): Promise<{
  generatedAt: string;
  pullRequest: TaskPullRequest;
  summary: string;
  source: "Manual" | "Background";
  requestCount: number;
  changed: boolean;
  relatedTask?: GitPullRequestResult["relatedTask"];
}> {
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

  const source = input.source === "Background" ? "Background" : "Manual";
  const startedAt = new Date().toISOString();
  let requestCount = 0;
  const trackedRead = async (path: string, label: string) => {
    requestCount += 1;
    return readGitHubJSON(path, githubToken, label);
  };
  const repoPath = `/repos/${encodeURIComponent(existing.owner)}/${encodeURIComponent(existing.repo)}`;
  const pullResult = await trackedRead(`${repoPath}/pulls/${existing.number}`, "pull request status");
  if (!pullResult.ok) {
    const error = new HttpError(
      pullResult.status === 401 || pullResult.status === 403 ? 401 : pullResult.status === 0 ? 502 : 409,
      pullResult.error ?? "GitHub pull request status request failed."
    );
    recordPullRequestRefreshFailure(task, existing, source, startedAt, requestCount, error.message);
    throw error;
  }
  const parsed = pullResult.value;
  if (!isRecord(parsed)) {
    const error = new HttpError(502, "GitHub pull request status response was not an object.");
    recordPullRequestRefreshFailure(task, existing, source, startedAt, requestCount, error.message);
    throw error;
  }

  const head = isRecord(parsed.head) ? parsed.head : undefined;
  const headSha = typeof head?.sha === "string" && head.sha.trim() ? head.sha.trim() : existing.headSha;
  const requestedReviewerCount =
    (Array.isArray(parsed.requested_reviewers) ? parsed.requested_reviewers.length : 0)
    + (Array.isArray(parsed.requested_teams) ? parsed.requested_teams.length : 0);
  const [reviewsResult, checksResult] = await Promise.all([
    trackedRead(`${repoPath}/pulls/${existing.number}/reviews?per_page=100`, "pull request reviews"),
    headSha
      ? trackedRead(`${repoPath}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100`, "pull request checks")
      : Promise.resolve<GitHubReadResult>({ ok: false, status: 0, error: "GitHub did not return the PR head SHA." })
  ]);
  for (const auxiliary of [reviewsResult, checksResult]) {
    if (!auxiliary.ok && (auxiliary.status === 401 || auxiliary.status === 403)) {
      const error = new HttpError(401, auxiliary.error ?? "GitHub rejected access to pull request evidence.");
      recordPullRequestRefreshFailure(task, existing, source, startedAt, requestCount, error.message);
      throw error;
    }
  }
  const reviewEvidence = reviewsResult.ok
    ? summarizePullRequestReviews(reviewsResult.value, requestedReviewerCount)
    : unavailableReviewEvidence(requestedReviewerCount, reviewsResult.error);
  const checkEvidence = checksResult.ok
    ? summarizePullRequestChecks(checksResult.value)
    : unavailableCheckEvidence(checksResult.error);

  const now = new Date().toISOString();
  const merged = parsed.merged === true || typeof parsed.merged_at === "string";
  const refreshedEvidence: TaskPullRequest = {
    ...existing,
    state: typeof parsed.state === "string" ? parsed.state : existing.state,
    merged,
    draft: parsed.draft === true,
    lastCheckedAt: now,
    mergeable: typeof parsed.mergeable === "boolean" ? parsed.mergeable : parsed.mergeable === null ? null : existing.mergeable,
    mergeableState: typeof parsed.mergeable_state === "string" ? parsed.mergeable_state : existing.mergeableState,
    reviewStatus: reviewEvidence.status,
    approvalCount: reviewEvidence.approvals,
    changesRequestedCount: reviewEvidence.changesRequested,
    requestedReviewerCount: reviewEvidence.requestedReviewers,
    checksStatus: checkEvidence.status,
    checkRunCount: checkEvidence.total,
    passedCheckCount: checkEvidence.passed,
    failedCheckCount: checkEvidence.failed,
    pendingCheckCount: checkEvidence.pending,
    skippedCheckCount: checkEvidence.skipped,
    headSha,
    reviewSummary: reviewEvidence.summary,
    checksSummary: checkEvidence.summary
  };

  const stateChanged = refreshedEvidence.state !== existing.state || refreshedEvidence.merged !== existing.merged || refreshedEvidence.draft !== existing.draft;
  const evidenceChanged = pullRequestEvidenceFingerprint(refreshedEvidence) !== pullRequestEvidenceFingerprint(existing);
  const changed = stateChanged || evidenceChanged;
  const stateSummary = merged
    ? `Pull request #${refreshedEvidence.number} is merged.`
    : refreshedEvidence.state === "closed"
      ? `Pull request #${refreshedEvidence.number} was closed without merging.`
      : `Pull request #${refreshedEvidence.number} is ${refreshedEvidence.draft ? "an open draft" : "open"}.`;
  const summary = `${stateSummary} ${reviewEvidence.summary} ${checkEvidence.summary}`;
  const refreshed: TaskPullRequest = {
    ...refreshedEvidence,
    refreshAttempts: appendPullRequestRefreshAttempt(existing.refreshAttempts, {
      id: randomUUID(),
      source,
      status: "Succeeded",
      startedAt,
      completedAt: now,
      requestCount,
      changed,
      summary
    })
  };

  const nextEvents = [...task.events];
  if (stateChanged) nextEvents.push(event("git.pull_request.state_changed", stateSummary));
  if (evidenceChanged) nextEvents.push(event("git.pull_request.review_checks_changed", `${reviewEvidence.summary} ${checkEvidence.summary}`));

  const updatedTask: ForgeTask = {
    ...task,
    updatedAt: now,
    pullRequest: refreshed,
    events: nextEvents
  };
  tasks.set(updatedTask.id, updatedTask);
  taskStore.saveTask(updatedTask);

  return {
    generatedAt: now,
    pullRequest: refreshed,
    summary,
    source,
    requestCount,
    changed,
    relatedTask: {
      id: task.id,
      title: task.title,
      status: task.status,
      currentPhase: task.currentPhase,
      summary
    }
  };
}

function recordPullRequestRefreshFailure(
  task: ForgeTask,
  existing: TaskPullRequest,
  source: "Manual" | "Background",
  startedAt: string,
  requestCount: number,
  summary: string
): void {
  const completedAt = new Date().toISOString();
  const refreshed: TaskPullRequest = {
    ...existing,
    refreshAttempts: appendPullRequestRefreshAttempt(existing.refreshAttempts, {
      id: randomUUID(),
      source,
      status: "Failed",
      startedAt,
      completedAt,
      requestCount,
      changed: false,
      summary
    })
  };
  const updatedTask: ForgeTask = {
    ...task,
    updatedAt: completedAt,
    pullRequest: refreshed,
    events: [...task.events, event("git.pull_request.refresh_failed", `${source} PR refresh failed after ${requestCount} GitHub request(s): ${summary}`)]
  };
  tasks.set(updatedTask.id, updatedTask);
  taskStore.saveTask(updatedTask);
}

function appendPullRequestRefreshAttempt(
  attempts: TaskPullRequest["refreshAttempts"],
  attempt: NonNullable<TaskPullRequest["refreshAttempts"]>[number]
): NonNullable<TaskPullRequest["refreshAttempts"]> {
  return [...(attempts ?? []), attempt].slice(-20);
}

async function readGitHubJSON(path: string, githubToken: string, label: string): Promise<GitHubReadResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(`${githubApiBase}${path}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Forge"
      },
      signal: controller.signal
    });
  } catch (error) {
    return { ok: false, status: 0, error: `GitHub ${label} request failed: ${(error as Error).message}` };
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, error: gitHubApiErrorMessage(response.status, text) };
  }
  try {
    return { ok: true, status: response.status, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 0, error: `GitHub returned an unparseable ${label} response.` };
  }
}

function summarizePullRequestReviews(value: unknown, requestedReviewers: number): PullRequestReviewEvidence {
  if (!Array.isArray(value)) return unavailableReviewEvidence(requestedReviewers, "GitHub review response was not an array.");
  if (value.length >= 100) return unavailableReviewEvidence(requestedReviewers, "Review history reached the 100-item safety cap.");
  const latestByReviewer = new Map<string, { state: string; submittedAt?: number; index: number }>();
  for (const [index, review] of value.entries()) {
    if (!isRecord(review) || !isRecord(review.user) || typeof review.user.login !== "string" || typeof review.state !== "string") continue;
    const state = review.state.toUpperCase();
    if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(state)) continue;
    const submittedAt = typeof review.submitted_at === "string" ? Date.parse(review.submitted_at) : Number.NaN;
    const candidate = { state, submittedAt: Number.isFinite(submittedAt) ? submittedAt : undefined, index };
    const current = latestByReviewer.get(review.user.login);
    let candidateIsLater = !current;
    if (current && candidate.submittedAt !== undefined && current.submittedAt !== undefined) {
      candidateIsLater = candidate.submittedAt > current.submittedAt
        || candidate.submittedAt === current.submittedAt && candidate.index > current.index;
    } else if (current) {
      candidateIsLater = candidate.index > current.index;
    }
    if (candidateIsLater) {
      latestByReviewer.set(review.user.login, candidate);
    }
  }
  const states = [...latestByReviewer.values()].map((review) => review.state);
  const approvals = states.filter((state) => state === "APPROVED").length;
  const changesRequested = states.filter((state) => state === "CHANGES_REQUESTED").length;
  const status: PullRequestReviewEvidence["status"] = changesRequested > 0
    ? "ChangesRequested"
    : requestedReviewers > 0 || approvals === 0
      ? "ReviewRequired"
      : "Approved";
  const summary = status === "ChangesRequested"
    ? `Review: ${changesRequested} change request${changesRequested === 1 ? "" : "s"} blocks merge; ${approvals} approval${approvals === 1 ? "" : "s"}.`
    : status === "Approved"
      ? `Review: approved by ${approvals} reviewer${approvals === 1 ? "" : "s"}.`
      : `Review: ${requestedReviewers > 0 ? `${requestedReviewers} requested reviewer${requestedReviewers === 1 ? "" : "s"} pending` : "approval required"}; ${approvals} approval${approvals === 1 ? "" : "s"}.`;
  return { status, approvals, changesRequested, requestedReviewers, summary };
}

function unavailableReviewEvidence(requestedReviewers: number, reason?: string): PullRequestReviewEvidence {
  return {
    status: "Unknown",
    approvals: 0,
    changesRequested: 0,
    requestedReviewers,
    summary: `Review: unavailable${reason ? ` (${reason})` : ""}.`
  };
}

function summarizePullRequestChecks(value: unknown): PullRequestCheckEvidence {
  if (!isRecord(value) || !Array.isArray(value.check_runs)) return unavailableCheckEvidence("GitHub check-runs response was not an object.");
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let skipped = 0;
  for (const check of value.check_runs) {
    if (!isRecord(check)) continue;
    if (check.status !== "completed") {
      pending += 1;
      continue;
    }
    const conclusion = typeof check.conclusion === "string" ? check.conclusion : "";
    if (!conclusion) pending += 1;
    else if (conclusion === "success") passed += 1;
    else if (["neutral", "skipped", "stale"].includes(conclusion)) skipped += 1;
    else failed += 1;
  }
  const parsedTotal = passed + failed + pending + skipped;
  const reportedTotal = typeof value.total_count === "number" && Number.isFinite(value.total_count)
    ? Math.max(0, Math.floor(value.total_count))
    : parsedTotal;
  pending += Math.max(0, reportedTotal - parsedTotal);
  const total = passed + failed + pending + skipped;
  const status: PullRequestCheckEvidence["status"] = total === 0
    ? "None"
    : failed > 0
      ? "Failing"
      : pending > 0
        ? "Pending"
        : "Passing";
  const summary = status === "None"
    ? "Checks: no check runs reported."
    : status === "Failing"
      ? `Checks: ${failed} failed, ${passed} passed, ${pending} pending, ${skipped} skipped.`
      : status === "Pending"
        ? `Checks: ${pending} pending, ${passed} passed, ${skipped} skipped.`
        : `Checks: ${passed} passed${skipped > 0 ? `, ${skipped} skipped` : ""}.`;
  return { status, total, passed, failed, pending, skipped, summary };
}

function unavailableCheckEvidence(reason?: string): PullRequestCheckEvidence {
  return {
    status: "Unknown",
    total: 0,
    passed: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
    summary: `Checks: unavailable${reason ? ` (${reason})` : ""}.`
  };
}

function pullRequestEvidenceFingerprint(pullRequest: TaskPullRequest): string {
  return JSON.stringify([
    pullRequest.reviewStatus,
    pullRequest.approvalCount,
    pullRequest.changesRequestedCount,
    pullRequest.requestedReviewerCount,
    pullRequest.checksStatus,
    pullRequest.checkRunCount,
    pullRequest.passedCheckCount,
    pullRequest.failedCheckCount,
    pullRequest.pendingCheckCount,
    pullRequest.skippedCheckCount,
    pullRequest.headSha,
    pullRequest.mergeable,
    pullRequest.mergeableState
  ]);
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
    const url = urlResult.exitCode === 0 ? urlResult.output.trim() : undefined;
    const github = url ? parseGitHubRemote(url) ?? undefined : undefined;
    return {
      name,
      urlKind: summarizeRemoteURLKind(url),
      github: github ? { owner: github.owner, repo: github.repo } : undefined
    };
  }));
}

function resolvePullRequestRemoteTopology(
  remotes: GitRemoteSummary[],
  upstreamRemote: string | undefined
): PullRequestRemoteTopology {
  const headRemote = remotes.find((remote) => remote.name === upstreamRemote) ?? remotes[0];
  const namedUpstream = remotes.find((remote) => remote.name === "upstream" && remote.github);
  const baseRemote = namedUpstream && namedUpstream.name !== headRemote?.name ? namedUpstream : headRemote;
  const forkDetected = Boolean(
    baseRemote?.github && headRemote?.github &&
    (baseRemote.github.owner !== headRemote.github.owner || baseRemote.github.repo !== headRemote.github.repo)
  );
  const headOwner = forkDetected ? headRemote?.github?.owner : undefined;
  const summary = !baseRemote
    ? "No GitHub remote topology could be resolved."
    : forkDetected
      ? `Detected fork topology: push ${headRemote?.name ?? "head remote"} (${headRemote?.github?.owner}/${headRemote?.github?.repo}) and open against ${baseRemote.name} (${baseRemote.github?.owner}/${baseRemote.github?.repo}).`
      : `Same-repository topology uses ${baseRemote.name}${baseRemote.github ? ` (${baseRemote.github.owner}/${baseRemote.github.repo})` : ""}.`;
  return { baseRemote, headRemote, forkDetected, headOwner, summary };
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


function normalizeCommitTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
  if (!normalized) {
    return "Update Forge workspace";
  }

  const capitalized = `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
  return capitalized.length > 72 ? `${capitalized.slice(0, 69).trimEnd()}...` : capitalized;
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
  getGitPullRequestPreview,
  publishGitPullRequest,
  refreshGitPullRequestStatus
};
}
