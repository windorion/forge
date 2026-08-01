import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import type { GitFileDiff, GitStatusSnapshot } from "../types.js";
import type { GitCommand } from "./gitCommand.js";
import { assertPathInside, normalizeGitDiffPath } from "./gitParsers.js";

const gitDiffMaxBytes = 48_000;
const gitDiffAppPreviewLineLimit = 260;

type GitDiffBuildResult = {
  text: string;
  displayMode: NonNullable<GitFileDiff["displayMode"]>;
  unavailableReason?: GitFileDiff["unavailableReason"];
  byteCount?: number;
  lineCount?: number;
};

export function createGitDiffService(options: {
  runGitCommand: GitCommand;
  getGitStatusSnapshot: () => Promise<GitStatusSnapshot>;
}): { getGitFileDiff(rawPath: string | null): Promise<GitFileDiff> } {
  const { runGitCommand, getGitStatusSnapshot } = options;

  async function getGitFileDiff(rawPath: string | null): Promise<GitFileDiff> {
    const relativePath = normalizeGitDiffPath(rawPath);
    const status = await getGitStatusSnapshot();
    if (!status.isRepository || !status.root) {
      throw new HttpError(409, status.error ?? "Workspace is not inside a git repository.");
    }
    const change = status.changedFiles.find((candidate) =>
      candidate.path === relativePath || candidate.oldPath === relativePath
    );
    if (!change) throw new HttpError(404, `No git change found for ${relativePath}.`);

    const generatedAt = new Date().toISOString();
    const diffResult = change.untracked
      ? await buildUntrackedFileDiff(status.root, change.path)
      : await buildTrackedFileDiff(status.root, change.path);
    const bounded = truncateGitDiff(diffResult.text);
    const displayMode: GitFileDiff["displayMode"] = diffResult.displayMode === "SideBySide" && bounded.text.trim()
      ? "SideBySide"
      : "Message";
    const unavailableReason = diffResult.unavailableReason ?? (bounded.text.trim() ? undefined : "NoTextualDiff");
    return {
      path: change.path,
      oldPath: change.oldPath,
      status: change.status,
      generatedAt,
      diff: bounded.text,
      truncated: bounded.truncated,
      displayMode,
      unavailableReason,
      byteCount: diffResult.byteCount,
      lineCount: diffResult.lineCount,
      appPreviewLineLimit: gitDiffAppPreviewLineLimit,
      summary: summarizeGitFileDiff(change.path, displayMode, unavailableReason, bounded.truncated, diffResult)
    };
  }

  async function buildTrackedFileDiff(gitRoot: string, relativePath: string): Promise<GitDiffBuildResult> {
    const [staged, unstaged] = await Promise.all([
      runGitCommand(["diff", "--cached", "--no-ext-diff", "--", relativePath], gitRoot, gitDiffMaxBytes + 8_000),
      runGitCommand(["diff", "--no-ext-diff", "--", relativePath], gitRoot, gitDiffMaxBytes + 8_000)
    ]);
    const parts: string[] = [];
    const combinedOutput = `${staged.output}\n${unstaged.output}`;
    const commandFailed = staged.exitCode !== 0 || unstaged.exitCode !== 0;
    const binary = combinedOutput.includes("Binary files ") || combinedOutput.includes(" differ\n");
    if (staged.output.trim()) parts.push("# Staged changes", staged.output.trimEnd());
    if (unstaged.output.trim()) parts.push("# Unstaged changes", unstaged.output.trimEnd());
    if (staged.exitCode !== 0 && !staged.output.trim()) parts.push(`# Staged diff failed with exit code ${staged.exitCode}.`);
    if (unstaged.exitCode !== 0 && !unstaged.output.trim()) parts.push(`# Unstaged diff failed with exit code ${unstaged.exitCode}.`);
    const text = parts.join("\n\n");
    return {
      text,
      displayMode: binary || commandFailed || !text.trim() ? "Message" : "SideBySide",
      unavailableReason: binary ? "Binary" : commandFailed ? "CommandFailed" : text.trim() ? undefined : "NoTextualDiff",
      byteCount: Buffer.byteLength(text, "utf8"),
      lineCount: text ? text.split(/\r?\n/).length : 0
    };
  }

  async function buildUntrackedFileDiff(gitRoot: string, relativePath: string): Promise<GitDiffBuildResult> {
    const absolutePath = path.resolve(gitRoot, relativePath);
    assertPathInside(gitRoot, absolutePath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) return { text: `# Untracked path is not a regular file: ${relativePath}`, displayMode: "Message", unavailableReason: "NotRegularFile", byteCount: fileStat.size, lineCount: 1 };
    const content = await readFile(absolutePath);
    if (content.includes(0)) return { text: `# Binary untracked file preview is unavailable: ${relativePath}`, displayMode: "Message", unavailableReason: "Binary", byteCount: content.byteLength, lineCount: 1 };
    if (content.byteLength > gitDiffMaxBytes) return { text: `# Untracked file is too large for an inline diff preview: ${relativePath}`, displayMode: "Message", unavailableReason: "TooLarge", byteCount: content.byteLength, lineCount: content.toString("utf8").split(/\r?\n/).length };

    const text = content.toString("utf8");
    const lines = text.split(/\r?\n/);
    const previewLines = lines.slice(0, 420).map((line) => `+${line}`);
    const truncated = lines.length > previewLines.length;
    const diffText = [
      `diff --git a/${relativePath} b/${relativePath}`,
      "new file mode 100644",
      "index 0000000..0000000",
      "--- /dev/null",
      `+++ b/${relativePath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...previewLines,
      truncated ? `# Diff preview truncated after ${previewLines.length} line(s).` : ""
    ].filter(Boolean).join("\n");
    return { text: diffText, displayMode: "SideBySide", byteCount: content.byteLength, lineCount: lines.length };
  }

  return { getGitFileDiff };
}

function truncateGitDiff(diff: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(diff, "utf8") <= gitDiffMaxBytes) return { text: diff, truncated: false };
  const buffer = Buffer.from(diff, "utf8").subarray(0, gitDiffMaxBytes);
  return { text: `${buffer.toString("utf8")}\n\n# Forge truncated this diff preview at ${gitDiffMaxBytes} bytes.`, truncated: true };
}

function summarizeGitFileDiff(
  relativePath: string,
  displayMode: GitFileDiff["displayMode"],
  unavailableReason: GitFileDiff["unavailableReason"],
  truncated: boolean,
  diffResult: GitDiffBuildResult
): string {
  if (displayMode === "SideBySide") return `Diff for ${relativePath}${truncated ? " was truncated." : "."}`;
  switch (unavailableReason) {
  case "Binary": return `Binary diff preview is unavailable for ${relativePath}.`;
  case "TooLarge": return `Diff preview is unavailable because ${relativePath} is larger than ${gitDiffMaxBytes} bytes.`;
  case "NotRegularFile": return `Diff preview is unavailable because ${relativePath} is not a regular file.`;
  case "CommandFailed": return `Diff preview command failed for ${relativePath}.`;
  case "NoTextualDiff": return `No textual diff is available for ${relativePath}.`;
  default: return diffResult.text.trim() ? `Diff preview for ${relativePath} is shown as a message.` : `No textual diff is available for ${relativePath}.`;
  }
}
