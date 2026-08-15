import { createHash } from "node:crypto";
import {
  SECRET_REDACTION_POLICY,
  redactSensitiveText,
  redactSensitiveValue
} from "../security/secretRedaction.js";
import type { ForgeTask } from "../types.js";

export type TaskAuditExportFormat = "json" | "markdown";

export interface TaskAuditExportEnvelope {
  filename: string;
  contentType: "application/json" | "text/markdown";
  content: string;
  generatedAt: string;
  contentSha256: string;
  sourceTaskUpdatedAt: string;
  sourceSha256: string;
  redactionSummary: string;
}

export function buildTaskAuditExport(
  task: ForgeTask,
  format: TaskAuditExportFormat,
  generatedAt = new Date().toISOString()
): TaskAuditExportEnvelope {
  const audit = buildAuditRecord(task, generatedAt);
  const stem = `forge-task-${safeFilenamePart(task.id)}-audit`;
  const content = format === "markdown"
    ? renderAuditMarkdown(audit)
    : JSON.stringify(audit, null, 2);
  return {
    filename: `${stem}.${format === "markdown" ? "md" : "json"}`,
    contentType: format === "markdown" ? "text/markdown" : "application/json",
    content,
    generatedAt,
    contentSha256: sha256(content),
    sourceTaskUpdatedAt: task.updatedAt,
    sourceSha256: taskAuditSourceSha256(task),
    redactionSummary: audit.redactionSummary
  };
}

export function taskAuditSourceSha256(task: ForgeTask): string {
  return sha256(JSON.stringify(task));
}

function buildAuditRecord(task: ForgeTask, generatedAt: string) {
  return redactSensitiveValue({
    schemaVersion: 1,
    generatedAt,
    redactionPolicy: {
      id: SECRET_REDACTION_POLICY.id,
      version: SECRET_REDACTION_POLICY.version,
      replacement: SECRET_REDACTION_POLICY.replacement
    },
    redactionSummary: `${SECRET_REDACTION_POLICY.summary} Provider keys and GitHub tokens are not export fields.`,
    task: {
      id: task.id,
      title: task.title,
      objective: task.objective,
      status: task.status,
      currentPhase: task.currentPhase,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      reviewSummary: task.reviewSummary,
      changedFiles: task.changedFiles,
      cancellation: task.cancellation,
      pullRequest: task.pullRequest
    },
    planRevisions: task.planRevisions.map((revision) => ({
      id: revision.id,
      provider: revision.provider,
      summary: revision.summary,
      rationale: revision.rationale,
      riskLevel: revision.riskLevel,
      expectedFileAreas: revision.expectedFileAreas,
      validationPlan: revision.validationPlan,
      riskNotes: revision.riskNotes,
      estimatedMinutes: revision.estimatedMinutes,
      estimatedCostUSD: revision.estimatedCostUSD,
      generatedAt: revision.generatedAt
    })),
    approvals: task.approvals,
    events: task.events,
    agentRunLoops: task.agentRunLoops,
    agentRunSteps: task.agentRunSteps,
    toolCalls: task.toolCalls,
    taskCommandRuns: task.taskCommandRuns,
    historyPurges: task.historyPurges ?? [],
    validationRuns: task.validationRuns,
    editProposals: task.editProposalRevisions.map((proposal) => ({
      id: proposal.id,
      status: proposal.status,
      summary: proposal.summary,
      generatedAt: proposal.generatedAt,
      decidedAt: proposal.decidedAt,
      decisionNote: proposal.decisionNote,
      validation: proposal.validation,
      fileChanges: proposal.fileChanges.map((change) => ({
        id: change.id,
        path: change.path,
        changeType: change.changeType,
        rationale: change.rationale,
        operationKind: change.applyOperation?.kind
      })),
      fileDecisions: proposal.fileDecisions,
      applyTransaction: proposal.applyTransaction,
      rollbackTransaction: proposal.rollbackTransaction
    })),
    contextFiles: task.contextFiles.map((file) => ({
      path: file.path,
      summary: file.summary,
      byteLength: file.byteLength,
      contentSha256: file.contentSha256,
      matchedLineCount: file.matchedLineCount,
      matchReasons: file.matchReasons
    }))
  });
}

function renderAuditMarkdown(audit: ReturnType<typeof buildAuditRecord>): string {
  const task = audit.task;
  const lines: string[] = [
    `# Forge Task Audit — ${escapeMarkdown(task.title)}`,
    "",
    `- Task: \`${task.id}\``,
    `- Status: ${task.status} / ${task.currentPhase}`,
    `- Created: ${task.createdAt}`,
    `- Updated: ${task.updatedAt}`,
    `- Exported: ${audit.generatedAt}`,
    "",
    "## Objective",
    "",
    task.objective,
    "",
    "## Review Summary",
    "",
    task.reviewSummary ?? "No review summary recorded.",
    ""
  ];

  if (task.cancellation) {
    lines.push(
      "## Cancellation",
      "",
      `- Status: ${task.cancellation.status}`,
      `- Requested: ${task.cancellation.requestedAt}`,
      `- Completed: ${task.cancellation.completedAt ?? "pending"}`,
      `- Queue: ${task.cancellation.queueDisposition}`,
      `- Agent Loop: ${task.cancellation.agentLoopDisposition}`,
      `- Task Command: ${task.cancellation.taskCommandDisposition}`,
      `- Validation: ${task.cancellation.validationDisposition}`,
      "",
      task.cancellation.summary,
      ""
    );
  }

  appendTable(lines, "Human Approvals", ["Time", "Action", "Decision", "Scope", "Expires", "Revokes", "Summary"], audit.approvals.map((approval) => [
    approval.decidedAt,
    approval.action,
    approval.decision,
    approval.scope ?? "—",
    approval.expiresAt ?? "—",
    approval.revokedApprovalID ?? "—",
    approval.summary
  ]));
  appendTable(lines, "Event Timeline", ["Time", "Type", "Message"], audit.events.map((event) => [
    event.createdAt, event.type, event.message
  ]));
  appendTable(lines, "Agent Loops", ["Started", "Status", "Stop Reason", "Summary"], audit.agentRunLoops.map((loop) => [
    loop.startedAt, loop.status, loop.stopReason ?? "—", loop.summary
  ]));
  appendTable(lines, "Task Commands", ["Started", "Command", "Status", "Output"], audit.taskCommandRuns.map((run) => [
    run.startedAt, run.command, run.status, run.outputSummary
  ]));
  appendTable(lines, "Validation Runs", ["Started", "Preset", "Status", "Summary"], audit.validationRuns.map((run) => [
    run.startedAt, run.presetName, run.status, run.summary
  ]));
  appendTable(lines, "Changed Files", ["Path"], task.changedFiles.map((path) => [path]));
  lines.push("## Redaction", "", audit.redactionSummary, "");
  return lines.join("\n");
}

function appendTable(lines: string[], title: string, headers: string[], rows: string[][]): void {
  lines.push(`## ${title}`, "");
  if (rows.length === 0) {
    lines.push("No records.", "");
    return;
  }
  lines.push(`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) lines.push(`| ${row.map(markdownCell).join(" | ")} |`);
  lines.push("");
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("#", "\\#").replaceAll("*", "\\*").replaceAll("_", "\\_");
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "task";
}

export function redactAuditText(value: string): string {
  return redactSensitiveText(value).text;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
