import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";
import type { GitCommand } from "../git/gitCommand.js";
import type { PlanContextRequestResult } from "../modelProvider.js";
import { fileMetadata, summarizeIndex, type IndexStatus } from "../repositoryIndex.js";
import { extractSymbols } from "../symbolExtract.js";
import { mergeRepositoryMatches, symbolIndexMatches } from "../symbolSearch.js";
import type { SqliteTaskStore } from "../taskStore.js";
import { extractTrigrams } from "../textIndex.js";
import { textIndexCandidates } from "../textSearch.js";
import type { ContextFile, ForgeTask, RuntimeEvent, ToolCall } from "../types.js";

export interface RepositorySearchMatch {
  path: string;
  score: number;
  reasons: string[];
  matchedLines: string[];
}

export function createRepositoryContextService(options: {
  observerMode: boolean;
  repoRoot: string;
  taskStore: SqliteTaskStore;
  runtimeEnvironment: NodeJS.ProcessEnv;
  runGitCommand: GitCommand;
  repositoryContextExtensions: Set<string>;
  editProposalEditableExtensions: Set<string>;
  repositoryIgnoredDirectories: Set<string>;
  repositoryIgnoredFileNames: Set<string>;
  repositoryImportantFiles: string[];
  repositorySearchStopWords: Set<string>;
  chineseIntentSearchTerms: Array<[string, string[]]>;
  repositoryScanMaxFiles: number;
  repositorySearchMaxFiles: number;
  repositoryContextMaxFiles: number;
  modelGuidedContextMaxStoredFiles: number;
  repositoryContextMaxFileBytes: number;
  resolveReadOnlyWorkspacePath: (inputPath: string) => { absolutePath: string; relativePath: string };
  sha256Text: (content: string) => string;
  saveTask: (task: ForgeTask) => void;
  emit: (type: string, data: Record<string, unknown>) => void;
  saveAndBroadcast: (task: ForgeTask, runtimeEvent: RuntimeEvent) => void;
  event: (type: string, message: string) => RuntimeEvent;
}) {
const {
  observerMode,
  repoRoot,
  taskStore,
  runtimeEnvironment,
  runGitCommand,
  repositoryContextExtensions,
  editProposalEditableExtensions,
  repositoryIgnoredDirectories,
  repositoryIgnoredFileNames,
  repositoryImportantFiles,
  repositorySearchStopWords,
  chineseIntentSearchTerms,
  repositoryScanMaxFiles,
  repositorySearchMaxFiles,
  repositoryContextMaxFiles,
  modelGuidedContextMaxStoredFiles,
  repositoryContextMaxFileBytes,
  resolveReadOnlyWorkspacePath,
  sha256Text,
  saveTask,
  emit,
  saveAndBroadcast,
  event
} = options;

const repositoryIndexMaxFileBytes = 2_000_000;
// The durable index covers a broader language set than bounded context search
// (which is intentionally narrow); anything editable plus common source types.
const repositoryIndexableExtensions = new Set([
  ...repositoryContextExtensions,
  ...editProposalEditableExtensions,
  ".rb", ".php", ".mjs", ".cjs", ".mts", ".jsx"
]);

/**
 * Durable file-tree index (P3). Walks the same skip-filtered file set as
 * bounded inspection, computes per-file language/size/lines/content-hash, and
 * incrementally upserts into SQLite: unchanged files (same hash) are skipped,
 * deleted files are removed, and index metadata is refreshed. Runtime-owned
 * and read-only over the working tree; never mutates repository content.
 */
async function indexRepository(): Promise<IndexStatus & { symbolCount: number; indexed: number; skipped: number; removed: number }> {
  if (observerMode) {
    throw new HttpError(409, "Repository index is read-only in observer runtime mode.");
  }
  const files = await listRepositoryFiles(repositoryIndexableExtensions);
  const existing = new Map(taskStore.loadIndexedFiles().map((file) => [file.path, file]));
  const seenPaths = new Set<string>();
  const indexedAt = new Date().toISOString();
  let indexed = 0;
  let skipped = 0;

  for (const relativePath of files) {
    seenPaths.add(relativePath);
    let content: string;
    try {
      const stats = await stat(path.join(repoRoot, relativePath));
      if (stats.size > repositoryIndexMaxFileBytes) {
        // Too large to hash cheaply; record size-only metadata without content.
        const meta = fileMetadata(relativePath, "", indexedAt);
        meta.byteSize = stats.size;
        const prior = existing.get(relativePath);
        if (!prior || prior.byteSize !== meta.byteSize) {
          taskStore.upsertIndexedFile(meta);
          indexed += 1;
        } else {
          skipped += 1;
        }
        continue;
      }
      content = await readFile(path.join(repoRoot, relativePath), "utf8");
    } catch {
      continue;
    }
    const meta = fileMetadata(relativePath, content, indexedAt);
    const prior = existing.get(relativePath);
    if (prior && prior.contentHash === meta.contentHash) {
      // Unchanged: backfill symbols/trigrams if this file predates that index
      // (content is already in hand, so this is free).
      if (!taskStore.hasSymbolsForFile(relativePath)) {
        const backfilled = extractSymbols(meta.language, content);
        if (backfilled.length > 0) {
          taskStore.replaceSymbolsForFile(relativePath, backfilled);
        }
      }
      if (!taskStore.hasTrigramsForFile(relativePath)) {
        const trigrams = extractTrigrams(content);
        if (trigrams.length > 0) {
          taskStore.replaceTrigramsForFile(relativePath, trigrams);
        }
      }
      skipped += 1;
      continue;
    }
    taskStore.upsertIndexedFile(meta);
    taskStore.replaceSymbolsForFile(relativePath, extractSymbols(meta.language, content));
    taskStore.replaceTrigramsForFile(relativePath, extractTrigrams(content));
    indexed += 1;
  }

  const removed = taskStore.removeIndexedFilesNotIn(seenPaths);
  let gitRoot: string | null = null;
  try {
    const rootResult = await runGitCommand(["rev-parse", "--show-toplevel"], repoRoot, 8_000);
    gitRoot = rootResult.output.trim() || repoRoot;
  } catch {
    gitRoot = repoRoot;
  }
  taskStore.setIndexMeta({ lastIndexedAt: indexedAt, gitRoot });

  const status = summarizeIndex(taskStore.loadIndexedFiles(), indexedAt, true);
  return { ...status, symbolCount: taskStore.countSymbols(), indexed, skipped, removed };
}

function readRepositoryIndexStatus(): IndexStatus & { symbolCount: number } {
  const meta = taskStore.getIndexMeta();
  const status = summarizeIndex(taskStore.loadIndexedFiles(), meta.lastIndexedAt, meta.lastIndexedAt !== null);
  return { ...status, symbolCount: taskStore.countSymbols() };
}

async function listRepositoryFiles(
  extensionAllowlist: Set<string> = repositoryContextExtensions
): Promise<string[]> {
  const files: string[] = [];

  async function walk(relativeDirectory: string): Promise<void> {
    if (files.length >= repositoryScanMaxFiles) {
      return;
    }

    const absoluteDirectory = path.join(repoRoot, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= repositoryScanMaxFiles) {
        return;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        if (!shouldSkipRepositoryDirectory(entry.name, relativePath)) {
          await walk(relativePath);
        }
        continue;
      }

      if (!entry.isFile() || shouldSkipRepositoryFile(entry.name, relativePath, extensionAllowlist)) {
        continue;
      }

      const absolutePath = path.join(repoRoot, relativePath);
      const fileStat = await stat(absolutePath);
      if (fileStat.size > repositoryContextMaxFileBytes) {
        continue;
      }

      files.push(relativePath);
    }
  }

  await walk("");
  return files.sort();
}

function shouldSkipRepositoryDirectory(name: string, relativePath: string): boolean {
  if (repositoryIgnoredDirectories.has(name) || name.endsWith(".xcodeproj")) {
    return true;
  }

  return relativePath.split("/").some((part) => repositoryIgnoredDirectories.has(part));
}

function shouldSkipRepositoryFile(
  name: string,
  relativePath: string,
  extensionAllowlist: Set<string> = repositoryContextExtensions
): boolean {
  if (repositoryIgnoredFileNames.has(name) || name.endsWith(".sqlite") || name.endsWith(".sqlite-shm") || name.endsWith(".sqlite-wal")) {
    return true;
  }

  if (relativePath.includes("/.git/") || relativePath.includes("/.forge/")) {
    return true;
  }

  if (repositoryImportantFiles.includes(relativePath)) {
    return false;
  }

  return !extensionAllowlist.has(path.extname(name));
}

async function searchRepositoryContext(
  files: string[],
  searchTerms: string[],
  explicitPaths: string[]
): Promise<RepositorySearchMatch[]> {
  const explicitPathSet = new Set(explicitPaths);
  const matches: RepositorySearchMatch[] = [];

  for (const file of files.slice(0, repositorySearchMaxFiles)) {
    const match = await scoreRepositoryFile(file, searchTerms, explicitPathSet);
    if (match && match.score > 0) {
      matches.push(match);
    }
  }

  return matches
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 12);
}

/**
 * For Text search, narrow the scan to durable trigram-index candidates when the
 * index covers every file the scan would read (a superset check on paths). A
 * file is a candidate if it may contain any term, plus any file whose path
 * matches a term (path-name hits are scored by the scan and must be preserved).
 * When the index does not cover the scan set, or a term is too short to index,
 * returns the full file list unchanged so no true match is missed.
 */
function narrowTextSearchFiles(
  files: string[],
  searchTerms: string[],
  searchMode: "Text" | "Symbol"
): { files: string[]; narrowed: boolean } {
  if (searchMode !== "Text" || searchTerms.length === 0) {
    return { files, narrowed: false };
  }
  const indexedSet = new Set(taskStore.indexedFilePaths());
  const indexCoversScan = indexedSet.size > 0 && files.every((file) => indexedSet.has(file));
  if (!indexCoversScan) {
    return { files, narrowed: false };
  }
  const { usable, candidates } = textIndexCandidates(searchTerms, files, (trigrams) =>
    taskStore.filesContainingAllTrigrams(trigrams)
  );
  if (!usable) {
    return { files, narrowed: false };
  }
  const pathHits = files.filter((file) => {
    const lower = file.toLowerCase();
    return searchTerms.some((term) => lower.includes(term.toLowerCase()));
  });
  return { files: [...new Set([...candidates, ...pathHits])], narrowed: true };
}

async function searchRepositoryWithRipgrep(
  files: string[],
  searchTerms: string[],
  explicitPaths: string[],
  searchMode: "Text" | "Symbol"
): Promise<{ engine: string; matches: RepositorySearchMatch[] }> {
  // Symbol mode: the durable symbol index gives exact declaration sites from a
  // fast SQLite lookup, and works with no ripgrep dependency. Consult it first,
  // then merge in whatever the scan engine finds (usages, path hits).
  const indexMatches = searchMode === "Symbol"
    ? symbolIndexMatches(searchTerms, files, explicitPaths, (term, limit) => taskStore.searchSymbols(term, limit), repositoryContextMaxFiles)
    : [];

  // Text mode: narrow the scan to trigram-index candidates when the durable
  // index covers the current file set. The scan still verifies content (no
  // false positives); the coverage gate prevents false negatives.
  const { files: searchFiles, narrowed: textIndexNarrowed } = narrowTextSearchFiles(files, searchTerms, searchMode);

  try {
    const output = await runBoundedRipgrep(searchFiles.slice(0, repositorySearchMaxFiles), searchTerms, searchMode);
    const scanned = parseRipgrepRepositoryMatches(output, searchFiles, searchTerms, explicitPaths, searchMode);
    if (indexMatches.length > 0) {
      return { engine: "symbol-index+ripgrep-word", matches: mergeRepositoryMatches(indexMatches, scanned, 12) };
    }
    return {
      engine: searchMode === "Symbol" ? "ripgrep-word" : textIndexNarrowed ? "trigram-index+ripgrep-fixed" : "ripgrep-fixed",
      matches: scanned
    };
  } catch {
    const fallback = await searchRepositoryContext(searchFiles, searchTerms, explicitPaths);
    if (indexMatches.length > 0) {
      return { engine: "symbol-index", matches: mergeRepositoryMatches(indexMatches, fallback, 12) };
    }
    return { engine: textIndexNarrowed ? "trigram-index+substring" : "fallback-substring", matches: fallback };
  }
}

function runBoundedRipgrep(
  files: string[],
  searchTerms: string[],
  searchMode: "Text" | "Symbol"
): Promise<string> {
  if (files.length === 0 || searchTerms.length === 0) {
    return Promise.resolve("");
  }

  const args = ["--json", "--ignore-case", "--max-count", "6", "--fixed-strings"];
  if (searchMode === "Symbol") {
    args.push("--word-regexp");
  }
  for (const term of searchTerms) {
    args.push("-e", term);
  }
  args.push("--", ...files);

  return new Promise((resolve, reject) => {
    const child = spawn("rg", args, { cwd: repoRoot, shell: false, env: { ...runtimeEnvironment } });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      if (!settled) {
        settled = true;
        reject(new Error("Bounded ripgrep search timed out."));
      }
    }, 5_000);
    const append = (current: string, chunk: Buffer) => (current + chunk.toString("utf8")).slice(-240_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0 || code === 1) {
        resolve(stdout);
      } else {
        reject(new Error(`ripgrep exited with code ${code ?? "unknown"}: ${stderr.slice(-500)}`));
      }
    });
  });
}

function parseRipgrepRepositoryMatches(
  output: string,
  files: string[],
  searchTerms: string[],
  explicitPaths: string[],
  searchMode: "Text" | "Symbol"
): RepositorySearchMatch[] {
  const byPath = new Map<string, RepositorySearchMatch>();
  const explicitSet = new Set(explicitPaths);
  const ensure = (file: string) => {
    let match = byPath.get(file);
    if (!match) {
      match = { path: file, score: 0, reasons: [], matchedLines: [] };
      byPath.set(file, match);
    }
    return match;
  };

  for (const file of files.slice(0, repositorySearchMaxFiles)) {
    const match = ensure(file);
    if (explicitSet.has(file)) {
      match.score += 100;
      match.reasons.push("explicitly referenced by task conversation");
    }
    const lowerPath = file.toLowerCase();
    for (const term of searchTerms) {
      if (lowerPath.includes(term.toLowerCase())) {
        match.score += 12;
        match.reasons.push(`path matches "${term}"`);
      }
    }
  }

  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }
    try {
      const record = JSON.parse(line) as {
        type?: string;
        data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number; submatches?: unknown[] };
      };
      if (record.type !== "match" || !record.data?.path?.text) {
        continue;
      }
      const match = ensure(record.data.path.text);
      const hitCount = Math.max(1, record.data.submatches?.length ?? 1);
      match.score += Math.min(24, hitCount * (searchMode === "Symbol" ? 6 : 4));
      const reason = searchMode === "Symbol" ? "whole-symbol match" : "fixed-text match";
      if (!match.reasons.includes(reason)) {
        match.reasons.push(reason);
      }
      if (match.matchedLines.length < 4 && record.data.lines?.text) {
        match.matchedLines.push(
          `${record.data.line_number ?? 0}: ${record.data.lines.text.trim().replace(/\s+/g, " ").slice(0, 160)}`
        );
      }
    } catch {
      continue;
    }
  }

  return [...byPath.values()]
    .filter((match) => match.score > 0)
    .map((match) => ({ ...match, reasons: match.reasons.slice(0, 4), matchedLines: match.matchedLines.slice(0, 3) }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 12);
}

async function scoreRepositoryFile(
  relativePath: string,
  searchTerms: string[],
  explicitPaths: Set<string>
): Promise<RepositorySearchMatch | undefined> {
  const reasons: string[] = [];
  let score = 0;

  if (explicitPaths.has(relativePath)) {
    score += 100;
    reasons.push("explicitly referenced by task conversation");
  }

  if (repositoryImportantFiles.includes(relativePath)) {
    score += 5;
    reasons.push("important project file");
  }

  const { absolutePath } = resolveReadOnlyWorkspacePath(relativePath);
  const content = await readFile(absolutePath, "utf8");
  if (content.includes("\0")) {
    return undefined;
  }

  const lowerPath = relativePath.toLowerCase();
  const lowerContent = content.toLowerCase();
  for (const term of searchTerms) {
    const lowerTerm = term.toLowerCase();
    if (lowerPath.includes(lowerTerm)) {
      score += 12;
      reasons.push(`path matches "${term}"`);
    }

    const hitCount = countOccurrences(lowerContent, lowerTerm, 6);
    if (hitCount > 0) {
      score += Math.min(24, hitCount * 4);
      reasons.push(`content matches "${term}" ${hitCount} time(s)`);
    }
  }

  if (score === 0) {
    return undefined;
  }

  return {
    path: relativePath,
    score,
    reasons: reasons.slice(0, 4),
    matchedLines: matchedLinesForTerms(content, searchTerms).slice(0, 3)
  };
}

function countOccurrences(content: string, term: string, maxCount: number): number {
  if (!term) {
    return 0;
  }

  let count = 0;
  let index = content.indexOf(term);
  while (index >= 0 && count < maxCount) {
    count += 1;
    index = content.indexOf(term, index + term.length);
  }

  return count;
}

function matchedLinesForTerms(content: string, searchTerms: string[]): string[] {
  const lines = content.split("\n");
  const matches: string[] = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const lowerLine = trimmed.toLowerCase();
    if (searchTerms.some((term) => lowerLine.includes(term.toLowerCase()))) {
      matches.push(`${index + 1}: ${trimmed.replace(/\s+/g, " ").slice(0, 160)}`);
    }

    if (matches.length >= 4) {
      break;
    }
  }

  return matches;
}

async function buildContextFiles(
  task: ForgeTask,
  files: string[],
  matches: RepositorySearchMatch[],
  preferredPaths: string[] = []
): Promise<ContextFile[]> {
  const selected = selectRepositoryContextPaths(task, files, matches, preferredPaths);
  const contextFiles: ContextFile[] = [];

  for (const file of selected) {
    const content = await runTool(task, "read_context_file", file, () => runReadOnlyFileTool(file));
    const match = matches.find((candidate) => candidate.path === file);
    contextFiles.push({
      path: file,
      summary: summarizeContextFile(file, content, match),
      byteLength: Buffer.byteLength(content, "utf8"),
      contentSha256: sha256Text(content),
      matchedLineCount: match?.matchedLines.length ?? 0,
      matchReasons: match?.reasons ?? []
    });
  }

  return contextFiles;
}

function mergeContextFiles(existing: ContextFile[], incoming: ContextFile[]): ContextFile[] {
  const byPath = new Map<string, ContextFile>();
  for (const file of incoming) {
    byPath.set(file.path, file);
  }
  for (const file of existing) {
    if (!byPath.has(file.path)) {
      byPath.set(file.path, file);
    }
  }

  return [...byPath.values()].slice(0, modelGuidedContextMaxStoredFiles);
}

function selectRepositoryContextPaths(
  task: ForgeTask,
  files: string[],
  matches: RepositorySearchMatch[],
  preferredPaths: string[] = []
): string[] {
  const selected: string[] = [];
  const fileSet = new Set(files);
  const add = (candidate: string | undefined) => {
    if (!candidate || selected.includes(candidate)) {
      return;
    }

    if (fileSet.has(candidate) || explicitContextPathsForTask(task).includes(candidate)) {
      selected.push(candidate);
    }
  };

  for (const explicitPath of explicitContextPathsForTask(task)) {
    add(explicitPath);
  }

  for (const preferredPath of preferredPaths) {
    add(preferredPath);
  }

  for (const match of matches) {
    add(match.path);
  }

  for (const importantPath of repositoryImportantFiles) {
    add(importantPath);
  }

  return selected.slice(0, repositoryContextMaxFiles);
}

function normalizeProviderSearchTerms(
  contextRequest: { searchTerms: string[] },
  task: ForgeTask
): string[] {
  const terms = new Set<string>();
  const addTerm = (term: string) => {
    const normalized = term
      .toLowerCase()
      .replace(/[^a-z0-9._/-]+/g, " ")
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2 && !repositorySearchStopWords.has(part));

    for (const part of normalized) {
      terms.add(part.slice(0, 64));
    }
  };

  for (const term of contextRequest.searchTerms) {
    addTerm(term);
  }

  if (terms.size === 0) {
    for (const fallbackTerm of deriveRepositorySearchTerms(task)) {
      addTerm(fallbackTerm);
    }
  }

  return [...terms].slice(0, 10);
}

function normalizeProviderReadPaths(readPaths: string[], files: string[]): string[] {
  const fileSet = new Set(files);
  const normalizedPaths: string[] = [];

  for (const readPath of readPaths) {
    const normalized = path.posix.normalize(readPath.replaceAll("\\", "/").replace(/^@/, "").replace(/^\.\/+/, ""));
    if (
      !normalized ||
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.startsWith("/") ||
      normalized.startsWith(".git/") ||
      normalized.startsWith(".forge/") ||
      normalized.includes("/.git/") ||
      normalized.includes("/.forge/") ||
      normalized.includes("\0")
    ) {
      continue;
    }

    if (fileSet.has(normalized) && !normalizedPaths.includes(normalized)) {
      normalizedPaths.push(normalized);
    }
  }

  return normalizedPaths.slice(0, repositoryContextMaxFiles);
}

function explicitContextPathsForTask(task: ForgeTask): string[] {
  return [
    ...new Set(
      task.messages
        .flatMap((message) => message.fileReferences)
        .filter((reference) => reference.status === "Resolved" && reference.path)
        .map((reference) => reference.path as string)
    )
  ];
}

function deriveRepositorySearchTerms(task: ForgeTask): string[] {
  const source = [
    task.title,
    task.objective,
    ...task.messages.slice(-6).map((message) => message.content),
    ...task.contextFiles.map((file) => `${file.path} ${file.summary}`)
  ].join(" ");
  const lowerSource = source.toLowerCase();
  const terms = new Set<string>();

  for (const match of lowerSource.matchAll(/[a-z][a-z0-9_-]{2,}/g)) {
    const term = match[0].replaceAll("_", "-");
    if (!repositorySearchStopWords.has(term)) {
      terms.add(term);
    }
  }

  for (const [needle, mappedTerms] of chineseIntentSearchTerms) {
    if (source.includes(needle)) {
      for (const mappedTerm of mappedTerms) {
        terms.add(mappedTerm);
      }
    }
  }

  for (const explicitPath of explicitContextPathsForTask(task)) {
    for (const part of explicitPath.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 3 && !repositorySearchStopWords.has(part)) {
        terms.add(part);
      }
    }
  }

  if (terms.size === 0) {
    for (const fallbackTerm of ["agent", "runtime", "context", "review"]) {
      terms.add(fallbackTerm);
    }
  }

  return [...terms].slice(0, 10);
}

function deriveExecutionSearchTerms(task: ForgeTask): string[] {
  const executionTerms = new Set(deriveRepositorySearchTerms(task));
  for (const step of task.planSteps) {
    for (const part of `${step.title} ${step.summary}`.toLowerCase().split(/[^a-z0-9_-]+/)) {
      const term = part.replaceAll("_", "-");
      if (term.length >= 3 && !repositorySearchStopWords.has(term)) {
        executionTerms.add(term);
      }
    }
  }

  for (const file of task.contextFiles) {
    for (const part of file.path.toLowerCase().split(/[^a-z0-9_-]+/)) {
      if (part.length >= 3 && !repositorySearchStopWords.has(part)) {
        executionTerms.add(part);
      }
    }
  }

  return [...executionTerms].slice(0, 12);
}

async function runReadOnlyFileTool(relativePath: string): Promise<string> {
  const { absolutePath } = resolveReadOnlyWorkspacePath(relativePath);

  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }

  return readFile(absolutePath, "utf8");
}

function summarizeContextFile(
  relativePath: string,
  content: string,
  match?: RepositorySearchMatch
): string {
  const baseSummary = relativePath.endsWith(".md")
    ? summarizeMarkdown(content)
    : summarizeSourceFile(relativePath, content);
  const matchSummary = match
    ? [
        `Score ${match.score}`,
        match.reasons.length > 0 ? match.reasons.join("; ") : undefined,
        match.matchedLines.length > 0 ? `Snippets: ${match.matchedLines.join(" | ")}` : undefined
      ].filter(Boolean).join(". ")
    : "";

  return [baseSummary, matchSummary].filter(Boolean).join(" ").slice(0, 360);
}

function summarizeSourceFile(relativePath: string, content: string): string {
  const lines = content.split("\n");
  const firstMeaningfulLine = lines
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("#!"));
  return [
    relativePath,
    `${lines.length} line(s)`,
    firstMeaningfulLine
  ].filter(Boolean).join(" - ").slice(0, 220);
}

function summarizeMarkdown(content: string): string {
  const heading = content
    .split("\n")
    .find((line) => line.startsWith("# "))
    ?.replace(/^#\s+/, "")
    .trim();
  const firstParagraph = content
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find((part) => part.length > 30 && !part.startsWith("#"));
  return [heading, firstParagraph].filter(Boolean).join(" - ").slice(0, 220);
}

function formatPathList(paths: string[]): string {
  if (paths.length === 0) {
    return "no files";
  }

  return paths.slice(0, 6).join(", ");
}

async function runTool<T>(
  task: ForgeTask,
  name: string,
  input: string,
  execute: () => Promise<T>
): Promise<T> {
  const startedAt = new Date().toISOString();
  const toolCall: ToolCall = {
    id: randomUUID(),
    name,
    status: "Started",
    input,
    outputSummary: "Running",
    startedAt
  };
  task.toolCalls.push(toolCall);
  task.updatedAt = startedAt;
  saveTask(task);
  emit("tool.started", { taskID: task.id, toolCall });

  try {
    const output = await execute();
    toolCall.status = "Completed";
    toolCall.endedAt = new Date().toISOString();
    toolCall.outputSummary = summarizeToolOutput(output);
    task.updatedAt = toolCall.endedAt;
    saveTask(task);
    emit("tool.completed", { taskID: task.id, toolCall });
    return output;
  } catch (error) {
    toolCall.status = "Failed";
    toolCall.endedAt = new Date().toISOString();
    toolCall.outputSummary = error instanceof Error ? error.message : String(error);
    task.updatedAt = toolCall.endedAt;
    saveTask(task);
    emit("tool.failed", { taskID: task.id, toolCall });
    throw error;
  }
}

function summarizeToolOutput(output: unknown): string {
  if (Array.isArray(output)) {
    const preview = output
      .slice(0, 4)
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (isRecord(item) && typeof item.path === "string") {
          return typeof item.score === "number" ? `${item.path} (${item.score})` : item.path;
        }

        return JSON.stringify(item);
      })
      .join(", ");
    return `${output.length} result(s): ${preview}`;
  }

  if (typeof output === "string") {
    return `${output.length} characters read`;
  }

  return "Completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

return {
  indexRepository,
  readRepositoryIndexStatus,
  listRepositoryFiles,
  searchRepositoryContext,
  searchRepositoryWithRipgrep,
  buildContextFiles,
  mergeContextFiles,
  normalizeProviderSearchTerms,
  normalizeProviderReadPaths,
  explicitContextPathsForTask,
  deriveRepositorySearchTerms,
  deriveExecutionSearchTerms,
  summarizeMarkdown,
  formatPathList,
  runTool
};
}
