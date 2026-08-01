import path from "node:path";

import { HttpError } from "../runtime/runtimeError.js";

export interface WorkspacePathPolicyOptions {
  repoRoot: string;
  ignoredDirectories: ReadonlySet<string>;
  blockedFileNames: ReadonlySet<string>;
  editableExtensions: ReadonlySet<string>;
  editableFileNames: ReadonlySet<string>;
}

export interface WorkspacePathPolicy {
  resolveEditableWorkspacePath(inputPath: string): { absolutePath: string; relativePath: string };
  isEditableMarkdownWorkspacePath(normalized: string): boolean;
  isEditableWorkspaceTextPath(normalized: string): boolean;
}

export function createWorkspacePathPolicy(options: WorkspacePathPolicyOptions): WorkspacePathPolicy {
  const isEditableMarkdownWorkspacePath = (normalized: string): boolean =>
    normalized === "README.md" || (normalized.startsWith("docs/") && normalized.endsWith(".md"));

  const hasUnsafeEditPathSegment = (normalized: string): boolean =>
    normalized.split("/").some((segment) => segment === ".git" || segment === ".forge");

  const hasIgnoredEditDirectory = (normalized: string): boolean =>
    normalized
      .split("/")
      .slice(0, -1)
      .some((segment) => options.ignoredDirectories.has(segment) || segment.endsWith(".xcodeproj"));

  const isEditableWorkspaceTextPath = (normalized: string): boolean => {
    if (isEditableMarkdownWorkspacePath(normalized)) return true;

    const fileName = path.posix.basename(normalized);
    if (
      options.blockedFileNames.has(fileName) ||
      fileName.startsWith(".env") ||
      hasIgnoredEditDirectory(normalized)
    ) {
      return false;
    }

    return options.editableFileNames.has(fileName) || options.editableExtensions.has(path.posix.extname(fileName));
  };

  const resolveWorkspaceEditPath = (inputPath: string): { absolutePath: string; relativePath: string } => {
    if (inputPath.includes("\0") || path.isAbsolute(inputPath)) {
      throw new HttpError(409, `Unsafe edit path: ${inputPath}`);
    }

    const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/"));
    if (
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.startsWith("/")
    ) {
      throw new HttpError(409, `Unsafe edit path: ${inputPath}`);
    }

    if (hasUnsafeEditPathSegment(normalized)) {
      throw new HttpError(409, `Unsafe edit path segment: ${inputPath}`);
    }

    const absolutePath = path.resolve(options.repoRoot, normalized);
    if (!absolutePath.startsWith(`${options.repoRoot}${path.sep}`)) {
      throw new HttpError(409, `Unsafe edit path: ${inputPath}`);
    }

    return { absolutePath, relativePath: normalized };
  };

  const resolveEditableWorkspacePath = (inputPath: string) => {
    const resolved = resolveWorkspaceEditPath(inputPath);
    if (!isEditableWorkspaceTextPath(resolved.relativePath)) {
      throw new HttpError(409, `Only allowlisted source/text files can be edited in v0: ${inputPath}`);
    }

    return resolved;
  };

  return { resolveEditableWorkspacePath, isEditableMarkdownWorkspacePath, isEditableWorkspaceTextPath };
}
