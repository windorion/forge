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

export function createGitCommitService(options: {
  runGitCommand: GitCommand;
  getGitStatusSnapshot: () => Promise<GitStatusSnapshot>;
  tasks: Map<string, ForgeTask>;
  saveTask: (task: ForgeTask) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
  githubApiBase: string;
}) {
const { runGitCommand, getGitStatusSnapshot, tasks, emit, githubApiBase } = options;
const taskStore = { saveTask: options.saveTask };

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


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

return {
  getGitCommitPreview,
  createGitCommit
};
}
