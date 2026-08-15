import type { ForgeTask } from "../types.js";

export const SECRET_REDACTION_POLICY = Object.freeze({
  id: "forge-secret-redaction",
  version: 1,
  replacement: "[REDACTED]",
  encodedInspectionMaxBytes: 8_192,
  summary:
    "Forge secret redaction policy v1 removes known credentials, structured secret values, private keys, and encoded known credentials before diagnostic, command-output, error, or audit evidence is retained."
});

export type SecretFindingKind =
  | "authorization"
  | "known_token"
  | "structured_secret"
  | "private_key"
  | "credential_url"
  | "encoded_secret";

export interface SecretFindingSummary {
  kind: SecretFindingKind;
  count: number;
}

export interface SecretRedactionResult {
  text: string;
  redacted: boolean;
  redactionCount: number;
  findings: SecretFindingSummary[];
  policyID: string;
  policyVersion: number;
}

/**
 * Line-buffered redaction for process stdout/stderr. A credential split across
 * transport chunks is classified only after the complete line is available,
 * so chunk boundaries cannot turn one secret into two retained fragments.
 */
export class SecretRedactionStream {
  #pending = "";
  #insidePrivateKey = false;

  push(chunk: string): string {
    this.#pending += chunk;
    const boundary = this.#pending.lastIndexOf("\n");
    if (boundary < 0) return "";
    const complete = this.#pending.slice(0, boundary + 1);
    this.#pending = this.#pending.slice(boundary + 1);
    return this.#redactCompleteLines(complete);
  }

  flush(): string {
    const remaining = this.#pending;
    this.#pending = "";
    return this.#redactCompleteLines(remaining, true);
  }

  #redactCompleteLines(value: string, flushing = false): string {
    let result = "";
    for (const line of value.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      if (this.#insidePrivateKey) {
        if (/-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/i.test(line)) {
          this.#insidePrivateKey = false;
        }
        continue;
      }

      const begin = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/i.exec(line);
      if (begin) {
        result += `${redactSensitiveText(line.slice(0, begin.index)).text}${replacement}`;
        if (line.endsWith("\n") || flushing) result += "\n";
        const suffix = line.slice(begin.index + begin[0].length);
        this.#insidePrivateKey = !/-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/i.test(suffix);
        continue;
      }

      result += redactSensitiveText(line).text;
    }
    return result;
  }
}

const replacement = SECRET_REDACTION_POLICY.replacement;
const sensitiveKey = String.raw`(?:api[_-]?key|access[_-]?token|auth(?:orization)?[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret|session[_-]?token|github[_-]?token|openai[_-]?api[_-]?key)`;
const falsePositiveValues = new Set([
  "configured", "missing", "required", "optional", "present", "absent",
  "enabled", "disabled", "true", "false", "null", "none", "unknown",
  "placeholder", "example", "sample", "test", "redacted"
]);

/**
 * Redacts text while returning classification counts only. Findings never
 * contain the matched value, a hash, surrounding text, or an offset that could
 * be used to reconstruct a credential.
 */
export function redactSensitiveText(value: string): SecretRedactionResult {
  const counts = new Map<SecretFindingKind, number>();
  let text = value;

  const replaceMatches = (
    pattern: RegExp,
    kind: SecretFindingKind,
    replacer: string | ((...args: any[]) => string)
  ) => {
    const before = countOccurrences(text, replacement);
    text = text.replace(pattern, (...args: any[]) => {
      return typeof replacer === "string" ? replacer : replacer(...args);
    });
    const added = countOccurrences(text, replacement) - before;
    if (added > 0) counts.set(kind, (counts.get(kind) ?? 0) + added);
  };

  replaceMatches(
    /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi,
    "private_key",
    replacement
  );
  replaceMatches(
    /\b(Bearer|Basic)\s+(?!\[REDACTED\])([A-Za-z0-9._~+\/-]{8,}={0,2})/gi,
    "authorization",
    (_match, scheme) => `${scheme} ${replacement}`
  );
  replaceMatches(
    /\b(?:github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{12,}|glpat-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16})\b/g,
    "known_token",
    replacement
  );
  replaceMatches(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    "known_token",
    replacement
  );
  replaceMatches(
    /(https?:\/\/)([^\s\/@]{4,})(@[^\s]+)/gi,
    "credential_url",
    (_match, prefix, _userinfo, suffix) => `${prefix}${replacement}${suffix}`
  );

  const quotedAssignment = new RegExp(
    `((?:["']?${sensitiveKey}["']?)\\s*[:=]\\s*)(["'])([^"'\\r\\n]{4,})\\2`,
    "gi"
  );
  replaceMatches(quotedAssignment, "structured_secret", (match, prefix, quote, candidate) =>
    shouldRedactAssignedValue(candidate) ? `${prefix}${quote}${replacement}${quote}` : match
  );

  const unquotedAssignment = new RegExp(
    `((?:["']?${sensitiveKey}["']?)\\s*[:=]\\s*)(?!["']|\\[REDACTED\\])([^\\s,;}\\]]{4,})`,
    "gi"
  );
  replaceMatches(unquotedAssignment, "structured_secret", (match, prefix, candidate) =>
    shouldRedactAssignedValue(candidate) ? `${prefix}${replacement}` : match
  );

  replaceMatches(/(?=[A-Za-z0-9_.~%-]*%[0-9A-Fa-f]{2})[A-Za-z0-9_.~%-]{12,}/g, "encoded_secret", (match) =>
    decodedCandidateContainsSecret(safeDecodeURIComponent(match)) ? replacement : match
  );
  replaceMatches(/(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9+/=])/g, "encoded_secret", (match) =>
    decodedCandidateContainsSecret(safeDecodeBase64(match)) ? replacement : match
  );

  // Derive the public total from marker growth so pre-redacted input remains
  // idempotent and is not counted as a newly observed credential.
  const initialMarkers = countOccurrences(value, replacement);
  const finalMarkers = countOccurrences(text, replacement);
  const redactionCount = Math.max(0, finalMarkers - initialMarkers);
  if (redactionCount === 0) counts.clear();

  const findings = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ kind, count }));

  return {
    text,
    redacted: redactionCount > 0,
    redactionCount,
    findings,
    policyID: SECRET_REDACTION_POLICY.id,
    policyVersion: SECRET_REDACTION_POLICY.version
  };
}

export function redactSensitiveValue<T>(value: T): T {
  return redactValue(value, undefined) as T;
}

export function safeErrorMessage(error: unknown, maxLength = 500): string {
  const message = error instanceof Error ? error.message : String(error);
  const compact = redactSensitiveText(message).text.replace(/\s+/g, " ").trim();
  return (compact || "Unknown error.").slice(0, Math.max(1, maxLength));
}

/**
 * Returns a persistence clone with evidence/summaries redacted while leaving
 * executable proposal bodies untouched. This prevents a test fixture string
 * inside an approved patch from being rewritten merely because the task was
 * saved.
 */
export function redactTaskPersistenceSurfaces(task: ForgeTask): ForgeTask {
  const clone = structuredClone(task);
  redactTaskEvidenceInPlace(clone);
  return clone;
}

/** Redacts evidence fields without replacing task collections or run objects. */
export function redactTaskEvidenceInPlace(clone: ForgeTask): void {
  const redact = (value: string | undefined) => value === undefined ? undefined : redactSensitiveText(value).text;

  clone.reviewSummary = redact(clone.reviewSummary);
  for (const item of clone.agentStates ?? []) item.summary = redact(item.summary)!;
  for (const item of clone.planSteps ?? []) item.summary = redact(item.summary)!;
  for (const item of clone.events ?? []) item.message = redact(item.message)!;
  for (const item of clone.approvals ?? []) {
    item.summary = redact(item.summary)!;
    item.userNote = redact(item.userNote);
  }
  for (const item of clone.toolCalls ?? []) {
    item.input = redact(item.input)!;
    item.outputSummary = redact(item.outputSummary)!;
  }
  for (const item of clone.agentRunLoops ?? []) {
    item.summary = redact(item.summary)!;
    item.controlNote = redact(item.controlNote);
  }
  for (const item of clone.agentRunSteps ?? []) {
    item.summary = redact(item.summary)!;
    item.rationale = redact(item.rationale)!;
    item.resultSummary = redact(item.resultSummary);
    item.error = redact(item.error);
    if (item.providerAttemptErrors) {
      for (let index = 0; index < item.providerAttemptErrors.length; index += 1) {
        item.providerAttemptErrors[index] = redact(item.providerAttemptErrors[index])!;
      }
    }
  }
  for (const item of clone.taskCommandRuns ?? []) {
    item.outputSummary = redact(item.outputSummary)!;
    for (const chunk of item.outputChunks ?? []) chunk.text = redact(chunk.text)!;
  }
  for (const item of clone.commandRerunEvidence ?? []) item.summary = redact(item.summary)!;
  for (const item of clone.validationRuns ?? []) {
    item.summary = redact(item.summary)!;
    for (const command of item.commands ?? []) command.outputSummary = redact(command.outputSummary)!;
  }
  for (const item of clone.validationRepairBriefs ?? []) {
    item.sourceSummary = redact(item.sourceSummary);
    item.summary = redact(item.summary)!;
    item.likelyCause = redact(item.likelyCause)!;
    for (let index = 0; index < (item.recommendedActions?.length ?? 0); index += 1) {
      item.recommendedActions[index] = redact(item.recommendedActions[index])!;
    }
    item.followUpPrompt = redact(item.followUpPrompt)!;
  }
  for (const item of clone.historyPurges ?? []) item.summary = redact(item.summary)!;
  if (clone.cancellation) {
    clone.cancellation.note = redact(clone.cancellation.note);
    clone.cancellation.summary = redact(clone.cancellation.summary)!;
  }
  if (clone.pullRequest) {
    clone.pullRequest.reviewSummary = redact(clone.pullRequest.reviewSummary);
    clone.pullRequest.checksSummary = redact(clone.pullRequest.checksSummary);
    for (const item of clone.pullRequest.refreshAttempts ?? []) item.summary = redact(item.summary)!;
  }
}

function redactValue(value: unknown, key: string | undefined): unknown {
  if (typeof value === "string") {
    if (key && isSensitiveKey(key) && shouldRedactAssignedValue(value)) return replacement;
    return redactSensitiveText(value).text;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, undefined));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, item]) => [childKey, redactValue(item, childKey)])
    );
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return [
    "apikey", "accesstoken", "authtoken", "authorizationtoken", "clientsecret",
    "privatekey", "password", "passwd", "secret", "sessiontoken", "githubtoken",
    "openaiapikey"
  ].includes(normalized);
}

function shouldRedactAssignedValue(candidate: string): boolean {
  const normalized = candidate.trim().replace(/^<|>$/g, "").toLowerCase();
  if (normalized === replacement.toLowerCase()) return false;
  if (falsePositiveValues.has(normalized)) return false;
  if (/^\$\{?[A-Z][A-Z0-9_]*\}?$/.test(candidate.trim())) return false;
  return candidate.trim().length >= 8 || directSecretKind(candidate) !== undefined;
}

function decodedCandidateContainsSecret(candidate: string | undefined): boolean {
  if (!candidate || Buffer.byteLength(candidate) > SECRET_REDACTION_POLICY.encodedInspectionMaxBytes) return false;
  const printable = [...candidate].filter((character) => /[\x20-\x7E\r\n\t]/.test(character)).length;
  if (candidate.length === 0 || printable / candidate.length < 0.85) return false;
  return directSecretKind(candidate) !== undefined;
}

function directSecretKind(value: string): SecretFindingKind | undefined {
  if (/-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/i.test(value)) return "private_key";
  if (/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{8,}={0,2}/i.test(value)) return "authorization";
  if (/\b(?:github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{12,}|glpat-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16})\b/.test(value)) return "known_token";
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(value)) return "known_token";
  const assignment = new RegExp(`${sensitiveKey}\\s*[:=]\\s*["']?([^\\s,"';}\\]]{4,})`, "i").exec(value);
  if (assignment?.[1] && shouldRedactAssignedValue(assignment[1])) return "structured_secret";
  return undefined;
}

function safeDecodeURIComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function safeDecodeBase64(value: string): string | undefined {
  if (value.length % 4 === 1) return undefined;
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
