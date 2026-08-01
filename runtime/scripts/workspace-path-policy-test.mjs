#!/usr/bin/env node
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { HttpError } from "../dist/http/httpError.js";
import { createWorkspacePathPolicy } from "../dist/edits/workspacePathPolicy.js";

const repoRoot = resolve("/tmp/forge-workspace-path-policy");
const policy = createWorkspacePathPolicy({
  repoRoot,
  ignoredDirectories: new Set([".git", ".forge", "dist", "node_modules"]),
  blockedFileNames: new Set(["package-lock.json", ".env"]),
  editableExtensions: new Set([".md", ".ts", ".swift"]),
  editableFileNames: new Set(["Dockerfile", "Package.swift"])
});

assert.equal(policy.isEditableMarkdownWorkspacePath("README.md"), true);
assert.equal(policy.isEditableMarkdownWorkspacePath("docs/runtime.md"), true);
assert.equal(policy.isEditableMarkdownWorkspacePath("nested/README.md"), false);
assert.equal(policy.isEditableWorkspaceTextPath("runtime/src/server.ts"), true);
assert.equal(policy.isEditableWorkspaceTextPath("Package.swift"), true);
assert.equal(policy.isEditableWorkspaceTextPath("assets/icon.png"), false);
assert.equal(policy.isEditableWorkspaceTextPath("node_modules/pkg/index.ts"), false);
assert.equal(policy.isEditableWorkspaceTextPath("Forge.xcodeproj/project.swift"), false);
assert.equal(policy.isEditableWorkspaceTextPath(".env.local"), false);
assert.equal(policy.isEditableWorkspaceTextPath("package-lock.json"), false);

assert.deepEqual(policy.resolveEditableWorkspacePath("runtime\\src\\server.ts"), {
  absolutePath: resolve(repoRoot, "runtime/src/server.ts"),
  relativePath: "runtime/src/server.ts"
});
assert.throws(() => policy.resolveEditableWorkspacePath("../secret.ts"), HttpError);
assert.throws(() => policy.resolveEditableWorkspacePath("/absolute.ts"), /Unsafe edit path/);
assert.throws(() => policy.resolveEditableWorkspacePath(".git/config.ts"), /Unsafe edit path segment/);
assert.throws(() => policy.resolveEditableWorkspacePath("docs/.forge/state.ts"), /Unsafe edit path segment/);
assert.throws(() => policy.resolveEditableWorkspacePath("runtime/src/binary.png"), /Only allowlisted/);
assert.throws(() => policy.resolveEditableWorkspacePath("runtime\0src/server.ts"), /Unsafe edit path/);

console.log("Workspace path policy test passed: 17 assertions.");
