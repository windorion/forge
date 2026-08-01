#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  classifyGitPushFailure,
  gitFileChangeFromNameStatus,
  gitPushFailureMessage,
  mergeGitFileChanges,
  parseGitBranchLine,
  parseGitNumstatValue,
  parseGitRangeNumstat,
  parseGitStatusChanges,
  parseGitUpstream,
  summarizeGitCommandOutput,
  summarizeRemoteURLKind
} from "../dist/git/gitParsers.js";

assert.deepEqual(parseGitUpstream("origin/feature/one"), { remote: "origin", remoteBranch: "feature/one" });
assert.equal(parseGitUpstream("origin"), undefined);
assert.equal(parseGitUpstream("origin/"), undefined);

assert.deepEqual(parseGitBranchLine("## main...origin/main [ahead 2, behind 3]"), {
  branch: "main", upstream: "origin/main", ahead: 2, behind: 3
});
assert.deepEqual(parseGitBranchLine("## No commits yet on feature"), {
  branch: "feature", upstream: undefined, ahead: undefined, behind: undefined
});
assert.deepEqual(parseGitBranchLine("invalid"), {});

const changes = parseGitStatusChanges([
  "## main...origin/main",
  "M  staged.ts",
  " M unstaged.ts",
  "?? new.ts",
  "R  old.ts -> new-name.ts",
  "UU conflict.ts"
].join("\n"));
assert.equal(changes.length, 5);
assert.deepEqual(changes.map((change) => change.status), ["Modified", "Modified", "Untracked", "Renamed", "Unmerged"]);
assert.equal(changes[0].staged, true);
assert.equal(changes[1].unstaged, true);
assert.equal(changes[2].untracked, true);
assert.equal(changes[3].oldPath, "old.ts");

const stats = parseGitRangeNumstat("12\t3\tsrc/a.ts\n-\t-\tasset.bin\n");
assert.deepEqual(stats.get("src/a.ts"), { additions: 12, deletions: 3 });
assert.deepEqual(stats.get("asset.bin"), { additions: undefined, deletions: undefined });
assert.equal(parseGitNumstatValue("0"), 0);
assert.equal(parseGitNumstatValue("-"), undefined);

const renamed = gitFileChangeFromNameStatus("R100\told.ts\tnew.ts", new Map([
  ["new.ts", { additions: 4, deletions: 1 }]
]));
assert.equal(renamed.status, "Renamed");
assert.equal(renamed.oldPath, "old.ts");
assert.equal(renamed.additions, 4);
assert.equal(gitFileChangeFromNameStatus("", new Map()), undefined);

const merged = mergeGitFileChanges(
  [{ path: "b.ts", status: "Modified" }, { path: "a.ts", status: "Added" }],
  [{ path: "b.ts", status: "Deleted" }]
);
assert.deepEqual(merged.map((change) => `${change.path}:${change.status}`), ["a.ts:Added", "b.ts:Deleted"]);

assert.equal(summarizeRemoteURLKind("https://github.com/example/repo.git"), "HTTPS");
assert.equal(summarizeRemoteURLKind("git@github.com:example/repo.git"), "SSH");
assert.equal(summarizeRemoteURLKind("/tmp/repo.git"), "Local");
assert.equal(summarizeRemoteURLKind("custom:repo"), "Other");
assert.equal(summarizeRemoteURLKind(undefined), "Unknown");

assert.equal(classifyGitPushFailure("fatal: Authentication failed").kind, "Authentication");
assert.equal(classifyGitPushFailure("protected branch hook declined").kind, "ProtectedBranch");
assert.equal(classifyGitPushFailure("rejected non-fast-forward").kind, "NonFastForward");
assert.equal(classifyGitPushFailure("Could not resolve host").kind, "Network");
assert.equal(classifyGitPushFailure("[remote rejected]").kind, "RemoteRejected");
assert.equal(classifyGitPushFailure("fatal: unknown").kind, "Unknown");
assert.equal(summarizeGitCommandOutput("  one\n  two  "), "one two");
assert.match(gitPushFailureMessage("rejected non-fast-forward", "Push failed"), /^Push failed: remote has commits/);

console.log("Git parsers test passed: 37 assertions.");
