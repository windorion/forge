#!/usr/bin/env node
// Pure unit test for the GitHub remote-URL parser.
import { parseGitHubRemote } from "../dist/githubRemote.js";

let count = 0;
function assert(condition, message) {
  count += 1;
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}
function eq(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// scp-like
eq(parseGitHubRemote("git@github.com:acme/widgets.git"), { host: "github.com", owner: "acme", repo: "widgets" }, "scp .git");
eq(parseGitHubRemote("git@github.com:acme/widgets"), { host: "github.com", owner: "acme", repo: "widgets" }, "scp no .git");

// https
eq(parseGitHubRemote("https://github.com/acme/widgets.git"), { host: "github.com", owner: "acme", repo: "widgets" }, "https .git");
eq(parseGitHubRemote("https://github.com/acme/widgets"), { host: "github.com", owner: "acme", repo: "widgets" }, "https no .git");
eq(parseGitHubRemote("https://github.com/acme/widgets/"), { host: "github.com", owner: "acme", repo: "widgets" }, "https trailing slash");

// https with credentials + ssh
eq(parseGitHubRemote("https://user:token@github.com/acme/widgets.git"), { host: "github.com", owner: "acme", repo: "widgets" }, "https creds");
eq(parseGitHubRemote("ssh://git@github.com/acme/widgets.git"), { host: "github.com", owner: "acme", repo: "widgets" }, "ssh url");

// enterprise host preserved
eq(parseGitHubRemote("git@ghe.corp.example:team/repo.git"), { host: "ghe.corp.example", owner: "team", repo: "repo" }, "enterprise scp");
eq(parseGitHubRemote("https://ghe.corp.example/team/repo"), { host: "ghe.corp.example", owner: "team", repo: "repo" }, "enterprise https");

// host is lowercased; owner/repo case preserved
eq(parseGitHubRemote("https://GitHub.com/Acme/Widgets"), { host: "github.com", owner: "Acme", repo: "Widgets" }, "case handling");

// unparseable
assert(parseGitHubRemote("") === null, "empty → null");
assert(parseGitHubRemote("   ") === null, "blank → null");
assert(parseGitHubRemote("not-a-url") === null, "garbage → null");
assert(parseGitHubRemote("https://github.com/acme") === null, "owner only → null");
assert(parseGitHubRemote("/local/path/repo.git") === null, "local path → null");

console.log(`GitHub remote test passed: ${count} assertions.`);
