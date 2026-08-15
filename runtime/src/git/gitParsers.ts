import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import { redactSensitiveText } from "../security/secretRedaction.js";
import type { GitFileChange } from "../types.js";

export function parseGitUpstream(
  upstream: string | undefined
): { remote: string; remoteBranch: string } | undefined {
  const separatorIndex = upstream?.indexOf("/") ?? -1;
  if (!upstream || separatorIndex <= 0 || separatorIndex === upstream.length - 1) return undefined;

  return {
    remote: upstream.slice(0, separatorIndex),
    remoteBranch: upstream.slice(separatorIndex + 1)
  };
}

export function summarizeGitCommandOutput(output: string): string {
  return redactSensitiveText(output).text.replace(/\s+/g, " ").trim().slice(0, 800) || "git command completed.";
}

export function classifyGitPushFailure(output: string): { kind: string; summary: string } {
  const text = output.toLowerCase();

  if (
    text.includes("authentication failed") ||
    text.includes("permission denied") ||
    text.includes("could not read username") ||
    text.includes("repository not found") ||
    text.includes("access denied")
  ) {
    return { kind: "Authentication", summary: "authentication or repository access was rejected." };
  }

  if (
    text.includes("protected branch") ||
    text.includes("branch is protected") ||
    text.includes("cannot force-push") ||
    text.includes("pre-receive hook declined") ||
    text.includes("protected branch hook declined")
  ) {
    return { kind: "ProtectedBranch", summary: "remote policy rejected the branch update." };
  }

  if (
    text.includes("non-fast-forward") ||
    text.includes("fetch first") ||
    text.includes("failed to push some refs") && text.includes("rejected")
  ) {
    return {
      kind: "NonFastForward",
      summary: "remote has commits that are not present locally; update before pushing."
    };
  }

  if (
    text.includes("could not resolve host") ||
    text.includes("failed to connect") ||
    text.includes("network is unreachable") ||
    text.includes("operation timed out") ||
    text.includes("connection timed out") ||
    text.includes("couldn't connect")
  ) {
    return { kind: "Network", summary: "network connection to the remote failed." };
  }

  if (text.includes("remote rejected") || text.includes("[remote rejected]")) {
    return { kind: "RemoteRejected", summary: "remote rejected the push." };
  }

  return { kind: "Unknown", summary: "git remote operation failed." };
}

export function gitPushFailureMessage(output: string, prefix: string): string {
  const cleaned = summarizeGitCommandOutput(output);
  const classification = classifyGitPushFailure(output);
  return `${prefix}: ${classification.summary} ${cleaned}`.trim();
}

export function summarizeRemoteURLKind(
  url: string | undefined
): "HTTPS" | "SSH" | "Local" | "Other" | "Unknown" {
  if (!url) return "Unknown";
  if (url.startsWith("http://") || url.startsWith("https://")) return "HTTPS";
  if (url.startsWith("ssh://") || /^[^@\s]+@[^:\s]+:.+/.test(url)) return "SSH";
  if (url.startsWith("file://") || url.startsWith("/") || url.startsWith(".")) return "Local";
  return "Other";
}

export function parseGitRangeNumstat(output: string): Map<string, { additions?: number; deletions?: number }> {
  const stats = new Map<string, { additions?: number; deletions?: number }>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [additionsText, deletionsText, ...pathParts] = line.split("\t");
    const filePath = pathParts.at(-1);
    if (!filePath) continue;
    stats.set(filePath, {
      additions: parseGitNumstatValue(additionsText),
      deletions: parseGitNumstatValue(deletionsText)
    });
  }
  return stats;
}

export function gitFileChangeFromNameStatus(
  line: string,
  stats: Map<string, { additions?: number; deletions?: number }>
): GitFileChange | undefined {
  const [statusCode, ...pathParts] = line.split("\t");
  if (!statusCode || pathParts.length === 0) return undefined;

  const statusLetter = statusCode[0] ?? "M";
  const oldPath = statusLetter === "R" || statusLetter === "C" ? pathParts[0] : undefined;
  const filePath = oldPath ? pathParts[1] : pathParts[0];
  if (!filePath) return undefined;

  const status = statusLetter === "A"
    ? "Added"
    : statusLetter === "D"
      ? "Deleted"
      : statusLetter === "R"
        ? "Renamed"
        : statusLetter === "C"
          ? "Copied"
          : "Modified";
  const lineStats = stats.get(filePath);
  return {
    path: filePath,
    oldPath,
    status,
    indexStatus: statusLetter,
    worktreeStatus: " ",
    staged: false,
    unstaged: false,
    untracked: false,
    additions: lineStats?.additions,
    deletions: lineStats?.deletions
  };
}

export function mergeGitFileChanges(primary: GitFileChange[], secondary: GitFileChange[]): GitFileChange[] {
  const merged = new Map<string, GitFileChange>();
  for (const change of [...primary, ...secondary]) merged.set(change.path, change);
  return [...merged.values()].sort((first, second) =>
    first.path.localeCompare(second.path, undefined, { numeric: true })
  );
}

export function parseGitBranchLine(line: string | undefined): {
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
} {
  if (!line?.startsWith("## ")) return {};

  const content = line.slice(3).trim();
  const bracketMatch = content.match(/\[(.*)\]$/);
  const relation = bracketMatch?.[1];
  let branchContent = bracketMatch ? content.slice(0, bracketMatch.index).trim() : content;
  const unbornMatch = branchContent.match(/^No commits yet on (.+)$/);
  if (unbornMatch) branchContent = unbornMatch[1];
  const [branch, upstream] = branchContent.split("...").map((part) => part.trim()).filter(Boolean);
  const ahead = relation?.match(/ahead (\d+)/)?.[1];
  const behind = relation?.match(/behind (\d+)/)?.[1];
  return {
    branch,
    upstream,
    ahead: ahead ? Number(ahead) : undefined,
    behind: behind ? Number(behind) : undefined
  };
}

export function parseGitStatusChanges(output: string): GitFileChange[] {
  const changes: GitFileChange[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line || line.startsWith("## ")) continue;
    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";
    const rawPath = line.slice(3);
    const renamedParts = rawPath.split(" -> ");
    const oldPath = renamedParts.length > 1 ? renamedParts[0] : undefined;
    const filePath = renamedParts.length > 1 ? renamedParts.slice(1).join(" -> ") : rawPath;
    const untracked = indexStatus === "?" && worktreeStatus === "?";
    const staged = ![" ", "?"].includes(indexStatus);
    const unstaged = ![" ", "?"].includes(worktreeStatus);
    changes.push({
      path: filePath,
      oldPath,
      status: gitChangeStatus(indexStatus, worktreeStatus),
      indexStatus,
      worktreeStatus,
      staged,
      unstaged,
      untracked
    });
  }
  return changes;
}

export function gitChangeStatus(indexStatus: string, worktreeStatus: string): GitFileChange["status"] {
  const combined = `${indexStatus}${worktreeStatus}`;
  if (combined === "??") return "Untracked";
  if (combined.includes("U") || ["AA", "DD"].includes(combined)) return "Unmerged";
  if (combined.includes("R")) return "Renamed";
  if (combined.includes("C")) return "Copied";
  if (combined.includes("A")) return "Added";
  if (combined.includes("D")) return "Deleted";
  if (combined.includes("M")) return "Modified";
  return "Unknown";
}

export function parseGitNumstatValue(value: string): number | undefined {
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

export function isSafeGitChange(change: GitFileChange): boolean {
  return [change.path, change.oldPath].every((candidate) => !candidate || !(
    candidate === ".git" || candidate.startsWith(".git/") ||
    candidate === ".forge" || candidate.startsWith(".forge/")
  ));
}

export function normalizeGitDiffPath(rawPath: string | null): string {
  if (!rawPath?.trim()) throw new HttpError(400, "A repo-relative git diff path is required.");
  if (path.isAbsolute(rawPath)) throw new HttpError(400, "Git diff paths must be repo-relative.");
  const normalized = path.posix.normalize(rawPath.replace(/\\/g, "/"));
  if (
    normalized === "." || normalized.startsWith("../") || normalized === ".." ||
    normalized.startsWith(".git/") || normalized === ".git" ||
    normalized.startsWith(".forge/") || normalized === ".forge"
  ) {
    throw new HttpError(400, `Unsafe git diff path: ${rawPath}`);
  }
  return normalized;
}

export function assertPathInside(root: string, absolutePath: string): void {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HttpError(400, `Path escapes git root: ${absolutePath}`);
  }
}
