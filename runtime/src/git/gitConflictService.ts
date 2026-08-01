import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import type {
  ForgeTask,
  GitConflictFile,
  GitConflictResolutionRequest,
  GitConflictResolutionResult,
  GitConflictSnapshot,
  GitConflictStage,
  GitFileChange,
  GitStatusSnapshot
} from "../types.js";
import type { GitCommand } from "./gitCommand.js";
import { assertPathInside, normalizeGitDiffPath } from "./gitParsers.js";

const gitConflictTextMaxBytes = 220_000;

export function createGitConflictService(options: {
  runGitCommand: GitCommand;
  getGitStatusSnapshot: () => Promise<GitStatusSnapshot>;
  tasks: Map<string, ForgeTask>;
  saveTask: (task: ForgeTask) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
}): {
  getGitConflictSnapshot(): Promise<GitConflictSnapshot>;
  resolveGitConflict(input: GitConflictResolutionRequest): Promise<GitConflictResolutionResult>;
} {
  const { runGitCommand, getGitStatusSnapshot, tasks, saveTask, emit } = options;

  async function getGitConflictSnapshot(): Promise<GitConflictSnapshot> {
    const status = await getGitStatusSnapshot();
    if (!status.isRepository || !status.root) {
      throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
    }
    const operation = await detectGitConflictOperation(status.root);
    const labels = conflictStageLabels(operation, status.branch);
    const changes = status.changedFiles.filter((change) => change.status === "Unmerged");
    const files = await Promise.all(changes.map((change) => readGitConflictFile(status.root!, change)));
    const count = files.length;
    return {
      generatedAt: new Date().toISOString(),
      gitRoot: status.root,
      branch: status.branch,
      head: status.head,
      operation,
      oursLabel: labels.ours,
      theirsLabel: labels.theirs,
      files,
      summary: count === 0
        ? "No unresolved git conflicts were found."
        : `${count} unresolved git conflict${count === 1 ? "" : "s"} require human review.`,
      operationBoundary: "Resolving writes and stages only the selected file. Forge will not continue, abort, commit, merge, rebase, or push automatically."
    };
  }

  async function readGitConflictFile(gitRoot: string, change: GitFileChange): Promise<GitConflictFile> {
    const relativePath = normalizeGitDiffPath(change.path);
    const [base, ours, theirs, working, unmergedEntries, workingObject] = await Promise.all([
      readGitConflictIndexStage(gitRoot, relativePath, 1, "Base"),
      readGitConflictIndexStage(gitRoot, relativePath, 2, "Ours"),
      readGitConflictIndexStage(gitRoot, relativePath, 3, "Theirs"),
      readGitConflictWorkingStage(gitRoot, relativePath),
      runGitCommand(["ls-files", "-u", "--", relativePath], gitRoot, 24_000),
      runGitCommand(["hash-object", "--", relativePath], gitRoot, 4_000)
    ]);
    const fingerprint = JSON.stringify({
      path: relativePath,
      indexStatus: change.indexStatus,
      worktreeStatus: change.worktreeStatus,
      entries: unmergedEntries.output,
      workingObject: workingObject.exitCode === 0 ? workingObject.output.trim() : working.summary
    });
    return {
      path: relativePath,
      indexStatus: change.indexStatus,
      worktreeStatus: change.worktreeStatus,
      conflictHash: createHash("sha256").update(fingerprint).digest("hex"),
      base,
      ours,
      theirs,
      working
    };
  }

  async function readGitConflictIndexStage(
    gitRoot: string,
    relativePath: string,
    stageNumber: 1 | 2 | 3,
    stage: GitConflictStage["stage"]
  ): Promise<GitConflictStage> {
    const object = `:${stageNumber}:${relativePath}`;
    const sizeResult = await runGitCommand(["cat-file", "-s", object], gitRoot, 4_000);
    if (sizeResult.exitCode !== 0) {
      return unavailableConflictStage(stage, "Missing", `${stage} version does not exist; selecting it will resolve this file as deleted.`);
    }
    const byteCount = Number(sizeResult.output.trim());
    if (!Number.isFinite(byteCount) || byteCount < 0) {
      return unavailableConflictStage(stage, "CommandFailed", `${stage} version size could not be read.`);
    }
    if (byteCount > gitConflictTextMaxBytes) {
      return unavailableConflictStage(stage, "TooLarge", `${stage} version is too large for safe inline conflict review.`, byteCount);
    }
    const contentResult = await runGitCommand(["show", object], gitRoot, gitConflictTextMaxBytes + 8_000);
    if (contentResult.exitCode !== 0) {
      return unavailableConflictStage(stage, "CommandFailed", `${stage} version could not be read.`, byteCount);
    }
    if (contentResult.output.includes("\0")) {
      return unavailableConflictStage(stage, "Binary", `${stage} version is binary and cannot be resolved in the text editor.`, byteCount);
    }
    return availableConflictStage(stage, contentResult.output, byteCount);
  }

  async function readGitConflictWorkingStage(gitRoot: string, relativePath: string): Promise<GitConflictStage> {
    const absolutePath = path.resolve(gitRoot, relativePath);
    assertPathInside(gitRoot, absolutePath);
    try {
      const fileStat = await lstat(absolutePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
        return unavailableConflictStage("Working", "NotRegularFile", "Working version is not a regular file.", fileStat.size);
      }
      if (fileStat.size > gitConflictTextMaxBytes) {
        return unavailableConflictStage("Working", "TooLarge", "Working version is too large for safe inline conflict review.", fileStat.size);
      }
      const content = await readFile(absolutePath);
      if (content.includes(0)) {
        return unavailableConflictStage("Working", "Binary", "Working version is binary and cannot be edited here.", content.byteLength);
      }
      return availableConflictStage("Working", content.toString("utf8"), content.byteLength);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return unavailableConflictStage("Working", "Missing", "Working version is deleted.");
      }
      throw error;
    }
  }

  async function detectGitConflictOperation(gitRoot: string): Promise<GitConflictSnapshot["operation"]> {
    const candidates: Array<[GitConflictSnapshot["operation"], string]> = [
      ["Rebase", "rebase-merge"], ["Rebase", "rebase-apply"], ["Merge", "MERGE_HEAD"], ["CherryPick", "CHERRY_PICK_HEAD"]
    ];
    for (const [operation, gitPath] of candidates) {
      const result = await runGitCommand(["rev-parse", "--git-path", gitPath], gitRoot, 4_000);
      if (result.exitCode !== 0 || !result.output.trim()) continue;
      const resolved = path.resolve(gitRoot, result.output.trim());
      try {
        await stat(resolved);
        return operation;
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      }
    }
    return "Unknown";
  }

  async function resolveGitConflict(input: GitConflictResolutionRequest): Promise<GitConflictResolutionResult> {
    if (input.confirmation !== "RESOLVE_GIT_CONFLICT") {
      throw new HttpError(409, "Conflict resolution requires the exact RESOLVE_GIT_CONFLICT confirmation.");
    }
    if (!["Ours", "Theirs", "Manual"].includes(input.strategy)) {
      throw new HttpError(400, "Conflict strategy must be Ours, Theirs, or Manual.");
    }
    const relativePath = normalizeGitDiffPath(input.path);
    const snapshot = await getGitConflictSnapshot();
    if (input.expectedHead && snapshot.head !== input.expectedHead) {
      throw new HttpError(409, `HEAD changed from ${input.expectedHead} to ${snapshot.head ?? "unknown"}; refresh conflict review.`);
    }
    const conflict = snapshot.files.find((file) => file.path === relativePath);
    if (!conflict) throw new HttpError(409, `${relativePath} is no longer an unresolved conflict; refresh conflict review.`);
    if (!input.expectedConflictHash || input.expectedConflictHash !== conflict.conflictHash) {
      throw new HttpError(409, `${relativePath} changed after review; refresh before resolving it.`);
    }

    if (input.strategy === "Manual") {
      await writeManualConflictResolution(snapshot.gitRoot, relativePath, input.content);
    } else {
      const selected = input.strategy === "Ours" ? conflict.ours : conflict.theirs;
      if (["Binary", "TooLarge", "NotRegularFile", "CommandFailed"].includes(selected.unavailableReason ?? "")) {
        throw new HttpError(409, selected.summary);
      }
      const checkoutFlag = input.strategy === "Ours" ? "--ours" : "--theirs";
      const command = selected.available
        ? await runGitCommand(["checkout", checkoutFlag, "--", relativePath], snapshot.gitRoot, 24_000)
        : await runGitCommand(["rm", "--force", "--", relativePath], snapshot.gitRoot, 24_000);
      if (command.exitCode !== 0) {
        throw new HttpError(409, command.output.trim() || `Git could not select ${input.strategy} for ${relativePath}.`);
      }
    }

    if (input.strategy === "Manual" || (input.strategy === "Ours" ? conflict.ours.available : conflict.theirs.available)) {
      const staged = await runGitCommand(["add", "--", relativePath], snapshot.gitRoot, 24_000);
      if (staged.exitCode !== 0) throw new HttpError(409, staged.output.trim() || `Git could not stage ${relativePath}.`);
    }
    const refreshed = await getGitConflictSnapshot();
    const remainingConflicts = refreshed.files.length;
    const summary = `Resolved and staged ${relativePath} using ${input.strategy}; ${remainingConflicts} conflict${remainingConflicts === 1 ? " remains" : "s remain"}.`;
    recordGitConflictResolution(input.taskID, relativePath, input.strategy, summary);
    emit("git.conflict.resolved", { path: relativePath, strategy: input.strategy, remainingConflicts });
    return {
      generatedAt: new Date().toISOString(),
      path: relativePath,
      strategy: input.strategy,
      status: "ResolvedAndStaged",
      staged: true,
      remainingConflicts,
      summary,
      operationBoundary: refreshed.operationBoundary
    };
  }

  async function writeManualConflictResolution(gitRoot: string, relativePath: string, content: string | undefined): Promise<void> {
    if (typeof content !== "string") throw new HttpError(400, "Manual conflict resolution requires text content.");
    const byteCount = Buffer.byteLength(content, "utf8");
    if (byteCount > gitConflictTextMaxBytes || content.includes("\0")) {
      throw new HttpError(409, `Manual conflict resolution must be UTF-8 text no larger than ${gitConflictTextMaxBytes} bytes.`);
    }
    if (/^(<{7}|={7}|>{7})/m.test(content)) throw new HttpError(409, "Manual conflict resolution still contains conflict markers.");

    const absolutePath = path.resolve(gitRoot, relativePath);
    assertPathInside(gitRoot, absolutePath);
    const canonicalRoot = await realpath(gitRoot);
    const canonicalParent = await realpath(path.dirname(absolutePath));
    assertPathInside(canonicalRoot, canonicalParent);
    let fileMode = 0o644;
    try {
      const existing = await lstat(absolutePath);
      if (existing.isSymbolicLink() || !existing.isFile()) throw new HttpError(409, "Manual conflict resolution only supports regular files.");
      fileMode = existing.mode & 0o777;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
    const temporaryPath = path.join(canonicalParent, `.forge-conflict-${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: fileMode });
      await rename(temporaryPath, absolutePath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  function recordGitConflictResolution(
    taskID: string | undefined,
    relativePath: string,
    strategy: GitConflictResolutionRequest["strategy"],
    summary: string
  ): void {
    if (!taskID) return;
    const task = tasks.get(taskID);
    if (!task) return;
    const now = new Date().toISOString();
    const updatedTask: ForgeTask = {
      ...task,
      updatedAt: now,
      events: [...task.events, { type: "git.conflict.resolved", message: `${summary} (${strategy}: ${relativePath})`, createdAt: now }]
    };
    tasks.set(taskID, updatedTask);
    saveTask(updatedTask);
    emit("task.updated", { taskID, task: updatedTask });
  }

  return { getGitConflictSnapshot, resolveGitConflict };
}

function availableConflictStage(stage: GitConflictStage["stage"], content: string, byteCount: number): GitConflictStage {
  return { stage, available: true, content, byteCount, lineCount: content ? content.split(/\r?\n/).length : 0, summary: `${stage} version is available (${byteCount} bytes).` };
}

function unavailableConflictStage(
  stage: GitConflictStage["stage"],
  unavailableReason: NonNullable<GitConflictStage["unavailableReason"]>,
  summary: string,
  byteCount = 0
): GitConflictStage {
  return { stage, available: false, byteCount, lineCount: 0, unavailableReason, summary };
}

function conflictStageLabels(
  operation: GitConflictSnapshot["operation"],
  branch: string | undefined
): { ours: string; theirs: string } {
  switch (operation) {
  case "Rebase": return { ours: "REBASE TARGET", theirs: "COMMIT BEING REPLAYED" };
  case "CherryPick": return { ours: branch?.toUpperCase() ?? "CURRENT BRANCH", theirs: "CHERRY-PICKED COMMIT" };
  case "Merge": return { ours: branch?.toUpperCase() ?? "CURRENT BRANCH", theirs: "INCOMING BRANCH" };
  default: return { ours: "OURS (INDEX STAGE 2)", theirs: "THEIRS (INDEX STAGE 3)" };
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
