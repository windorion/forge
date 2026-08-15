#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  SECRET_REDACTION_POLICY,
  SecretRedactionStream,
  redactSensitiveText,
  redactSensitiveValue,
  redactTaskPersistenceSurfaces,
  safeErrorMessage
} from "../dist/security/secretRedaction.js";

const githubToken = ["ghp", "1234567890abcdefghijklmnop"].join("_");
const openAIToken = ["sk", "1234567890abcdefghijklmnop"].join("-");
const slackToken = ["xoxb", "123456789012", "abcdefghijklmnop"].join("-");
const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JnZSJ9.signature123456";
const privateKey = "-----BEGIN PRIVATE KEY-----\nfixture-key-material\n-----END PRIVATE KEY-----";

assert.equal(SECRET_REDACTION_POLICY.version, 1);
assert.equal(SECRET_REDACTION_POLICY.replacement, "[REDACTED]");

const direct = redactSensitiveText([
  `Authorization: Bearer ${githubToken}`,
  `Authorization: Basic ${Buffer.from("forge:password-value").toString("base64")}`,
  `provider=${openAIToken}`,
  `slack=${slackToken}`,
  `jwt=${jwt}`,
  `password: "correct-horse-battery-staple"`,
  `https://forge:database-password@example.test/path`,
  `https://credential-username-value@example.test/token-userinfo`,
  privateKey
].join("\n"));
assert.equal(direct.policyID, "forge-secret-redaction");
assert.equal(direct.policyVersion, 1);
assert.equal(direct.redacted, true);
assert(direct.redactionCount >= 8);
for (const secret of [githubToken, openAIToken, slackToken, jwt, "correct-horse-battery-staple", "database-password", "credential-username-value", "fixture-key-material"]) {
  assert(!direct.text.includes(secret), `Direct redaction leaked ${secret.slice(0, 4)} fixture.`);
  assert(!JSON.stringify(direct.findings).includes(secret), "Finding metadata contained secret material.");
}

const encoded = redactSensitiveText([
  `base64=${Buffer.from(`access_token=${githubToken}`).toString("base64")}`,
  `percent=${encodeURIComponent(`api_key=${openAIToken}`)}`
].join("\n"));
assert.equal(encoded.redacted, true);
assert(!encoded.text.includes(Buffer.from(`access_token=${githubToken}`).toString("base64")));
assert(!encoded.text.includes(encodeURIComponent(`api_key=${openAIToken}`)));
assert(encoded.findings.some((finding) => finding.kind === "encoded_secret"));

const structured = redactSensitiveValue({
  request: {
    headers: { authorizationToken: githubToken },
    provider: { api_key: openAIToken },
    status: { apiKey: "Configured", hasSecret: true }
  },
  lines: [`client_secret=${slackToken}`]
});
assert.equal(structured.request.headers.authorizationToken, "[REDACTED]");
assert.equal(structured.request.provider.api_key, "[REDACTED]");
assert.equal(structured.request.status.apiKey, "Configured");
assert.equal(structured.request.status.hasSecret, true);
assert.equal(structured.lines[0], "client_secret=[REDACTED]");

const falsePositives = [
  "API key is configured through Settings.",
  "api_key=configured",
  "password=required",
  "secret sauce belongs in the recipe",
  "OPENAI_API_KEY=\${OPENAI_API_KEY}",
  "OAuth Client ID Iv1.1234567890abcdef is public configuration.",
  "sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "The secret-detection policy is enabled."
];
for (const value of falsePositives) {
  const result = redactSensitiveText(value);
  assert.equal(result.text, value, `False positive changed: ${value}`);
  assert.equal(result.redacted, false);
}

assert.equal(redactSensitiveText(direct.text).text, direct.text, "Redaction must be idempotent.");
assert.equal(
  safeErrorMessage(new Error(`request failed: api_key=${openAIToken}\nsecond line`)),
  "request failed: api_key=[REDACTED] second line"
);

const stream = new SecretRedactionStream();
assert.equal(stream.push(`partial ${githubToken.slice(0, 11)}`), "");
const streamedLine = stream.push(`${githubToken.slice(11)} complete\n`);
assert(!streamedLine.includes(githubToken), "Chunk-split credential leaked from streaming redaction.");
assert(streamedLine.includes("[REDACTED]"));
assert.equal(stream.flush(), "");

const keyStream = new SecretRedactionStream();
const keyHeader = keyStream.push("prefix -----BEGIN PRIVATE KEY-----\n");
const keyBody = keyStream.push("sensitive-key-material\n-----END PRIVATE KEY-----\nvisible\n");
assert.equal(keyHeader, "prefix [REDACTED]\n");
assert.equal(keyBody, "visible\n");

const persistenceTask = {
  id: "secret-task",
  title: "Persistence boundary",
  objective: `User-authored fixture intentionally retains ${githubToken}`,
  status: "Human Review",
  currentPhase: "Review",
  createdAt: "2026-08-15T10:00:00.000Z",
  updatedAt: "2026-08-15T10:01:00.000Z",
  agentStates: [{ role: "Reviewer", status: "Active", summary: `api_key=${openAIToken}` }],
  planSteps: [{ id: "one", title: "Review", status: "Active", summary: `Bearer ${githubToken}` }],
  events: [{ type: "provider.failed", message: `password=${slackToken}`, createdAt: "2026-08-15T10:01:00.000Z" }],
  approvals: [],
  toolCalls: [],
  agentRunLoops: [],
  agentRunSteps: [],
  taskCommandRuns: [{
    id: "run", commandID: "fixture", name: "Fixture", command: "fixture", kind: "ProjectCommand",
    riskLevel: "Medium", status: "Failed", outputSummary: `token ${openAIToken}`,
    outputChunks: [{ id: "chunk", stream: "stderr", text: githubToken, createdAt: "2026-08-15T10:01:00.000Z" }],
    startedAt: "2026-08-15T10:01:00.000Z"
  }],
  commandRerunEvidence: [],
  validationRuns: [],
  validationRepairBriefs: [],
  messages: [],
  planRevisions: [],
  editProposalRevisions: [{
    id: "proposal", provider: { id: "local", name: "Local", model: "fixture", mode: "local" },
    revisionNumber: 1, summary: "Fixture proposal", riskLevel: "Medium", status: "Proposed",
    generatedAt: "2026-08-15T10:01:00.000Z",
    fileChanges: [{
      id: "change", path: "fixture.ts", changeType: "Create", rationale: "Test fixture",
      diffPreview: `+export const fixture = \"${githubToken}\";`,
      applyOperation: { kind: "CreateFile", content: `export const fixture = \"${githubToken}\";\n` }
    }]
  }],
  contextFiles: [],
  changedFiles: [],
  reviewSummary: `provider failed with ${openAIToken}`
};
const persisted = redactTaskPersistenceSurfaces(persistenceTask);
assert(!persisted.reviewSummary.includes(openAIToken));
assert(!persisted.taskCommandRuns[0].outputChunks[0].text.includes(githubToken));
assert(!persisted.events[0].message.includes(slackToken));
assert(
  persisted.editProposalRevisions[0].fileChanges[0].applyOperation.content.includes(githubToken),
  "Persistence redaction must not rewrite executable proposal content."
);
assert(persistenceTask.reviewSummary.includes(openAIToken), "Persistence cloning mutated live input.");

console.log("Secret redaction test passed: direct, encoded, structured, false-positive, error, and persistence boundaries.");
