// Pure repository-index helpers (language classification, per-file metadata,
// language distribution). Isolated so they are unit-testable without SQLite
// or a filesystem walk.

import { createHash } from "node:crypto";

export type IndexedFile = {
  path: string;
  language: string;
  byteSize: number;
  lineCount: number;
  contentHash: string;
  indexedAt: string;
};

export type IndexStatus = {
  fileCount: number;
  totalBytes: number;
  languages: { language: string; files: number }[];
  lastIndexedAt: string | null;
  inSync: boolean;
};

const extensionLanguages: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".cts": "TypeScript",
  ".mts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".swift": "Swift",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".c": "C",
  ".h": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".hpp": "C++",
  ".cs": "C#",
  ".rb": "Ruby",
  ".php": "PHP",
  ".css": "CSS",
  ".html": "HTML",
  ".json": "JSON",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".toml": "TOML",
  ".sh": "Shell",
  ".md": "Markdown"
};

export function classifyLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) {
    return "Other";
  }
  return extensionLanguages[lower.slice(dot)] ?? "Other";
}

/** Deterministic content metadata for one file's bytes. */
export function fileMetadata(filePath: string, content: string, indexedAt: string): IndexedFile {
  const byteSize = Buffer.byteLength(content, "utf8");
  // Line count: number of lines including a trailing partial line. Empty file
  // counts as 0 lines.
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;
  const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 32);
  return {
    path: filePath,
    language: classifyLanguage(filePath),
    byteSize,
    lineCount,
    contentHash,
    indexedAt
  };
}

/** Aggregate a status view from indexed rows, sorted by file count desc. */
export function summarizeIndex(files: IndexedFile[], lastIndexedAt: string | null, inSync: boolean): IndexStatus {
  const byLanguage = new Map<string, number>();
  let totalBytes = 0;
  for (const file of files) {
    byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + 1);
    totalBytes += file.byteSize;
  }
  const languages = [...byLanguage.entries()]
    .map(([language, count]) => ({ language, files: count }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
  return {
    fileCount: files.length,
    totalBytes,
    languages,
    lastIndexedAt,
    inSync
  };
}
