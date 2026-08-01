import { parseGitHubRemote } from "../githubRemote.js";
import type { GitStatusSnapshot } from "../types.js";
import type { GitCommand } from "./gitCommand.js";
import {
  isSafeGitChange,
  parseGitBranchLine,
  parseGitNumstatValue,
  parseGitStatusChanges
} from "./gitParsers.js";

export function createGitStatusService(options: {
  repoRoot: string;
  runGitCommand: GitCommand;
}): { getGitStatusSnapshot(): Promise<GitStatusSnapshot> } {
  const { repoRoot, runGitCommand } = options;

  async function getGitStatusSnapshot(): Promise<GitStatusSnapshot> {
    const generatedAt = new Date().toISOString();
    try {
      const inside = await runGitCommand(["rev-parse", "--is-inside-work-tree"], repoRoot);
      if (inside.exitCode !== 0 || inside.output.trim() !== "true") {
        return {
          isRepository: false,
          isDirty: false,
          summary: "Workspace is not inside a git repository.",
          generatedAt,
          changedFiles: [],
          error: inside.output.trim() || "git rev-parse did not report a repository."
        };
      }

      const rootResult = await runGitCommand(["rev-parse", "--show-toplevel"], repoRoot);
      const gitRoot = rootResult.output.trim() || repoRoot;
      const statusResult = await runGitCommand(["status", "--porcelain=v1", "-b"], gitRoot, 64_000);
      if (statusResult.exitCode !== 0) throw new Error(statusResult.output.trim() || "git status failed.");

      const branch = parseGitBranchLine(statusResult.output.split(/\r?\n/).find((line) => line.startsWith("## ")));
      const changes = parseGitStatusChanges(statusResult.output).filter(isSafeGitChange);
      const stats = await collectGitNumstat(gitRoot);
      const changedFiles = changes.map((change) => ({ ...change, ...stats.get(change.path) }));
      const [headResult, repositoryWebURL] = await Promise.all([
        runGitCommand(["rev-parse", "--short", "HEAD"], gitRoot),
        getGitHubRepositoryWebURL(gitRoot)
      ]);
      const head = headResult.exitCode === 0 ? headResult.output.trim() : undefined;
      const isDirty = changedFiles.length > 0;
      return {
        isRepository: true,
        root: gitRoot,
        branch: branch.branch,
        upstream: branch.upstream,
        repositoryWebURL,
        head,
        ahead: branch.ahead,
        behind: branch.behind,
        isDirty,
        summary: isDirty
          ? `${changedFiles.length} changed file(s) in ${branch.branch ?? "current checkout"}.`
          : `Working tree clean on ${branch.branch ?? "current checkout"}.`,
        generatedAt,
        changedFiles
      };
    } catch (error) {
      return {
        isRepository: false,
        isDirty: false,
        summary: "Git status could not be read.",
        generatedAt,
        changedFiles: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function getGitHubRepositoryWebURL(gitRoot: string): Promise<string | undefined> {
    const origin = await runGitCommand(["remote", "get-url", "origin"], gitRoot, 8_000);
    let remoteURL = origin.exitCode === 0 ? origin.output.trim() : "";
    if (!remoteURL) {
      const remotes = await runGitCommand(["remote"], gitRoot, 8_000);
      const firstRemote = remotes.output.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
      if (!firstRemote) return undefined;
      const fallback = await runGitCommand(["remote", "get-url", firstRemote], gitRoot, 8_000);
      remoteURL = fallback.exitCode === 0 ? fallback.output.trim() : "";
    }
    const remote = parseGitHubRemote(remoteURL);
    return remote ? `https://github.com/${remote.owner}/${remote.repo}` : undefined;
  }

  async function collectGitNumstat(gitRoot: string): Promise<Map<string, { additions?: number; deletions?: number }>> {
    const stats = new Map<string, { additions?: number; deletions?: number }>();
    const outputs = await Promise.all([
      runGitCommand(["diff", "--numstat", "--"], gitRoot),
      runGitCommand(["diff", "--cached", "--numstat", "--"], gitRoot)
    ]);
    for (const output of outputs) {
      if (output.exitCode !== 0) continue;
      for (const line of output.output.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const [additionsText, deletionsText, ...pathParts] = line.split("\t");
        const filePath = pathParts.join("\t");
        if (!filePath) continue;
        const current = stats.get(filePath) ?? {};
        const additions = parseGitNumstatValue(additionsText);
        const deletions = parseGitNumstatValue(deletionsText);
        stats.set(filePath, {
          additions: additions === undefined ? current.additions : (current.additions ?? 0) + additions,
          deletions: deletions === undefined ? current.deletions : (current.deletions ?? 0) + deletions
        });
      }
    }
    return stats;
  }

  return { getGitStatusSnapshot };
}
