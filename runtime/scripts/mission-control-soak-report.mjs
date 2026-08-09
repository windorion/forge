export const MISSION_CONTROL_SOAK_REPORT_SCHEMA_VERSION = 1;

export function buildMissionControlSoakReport(input) {
  const startedAt = requiredISODate(input.startedAt, "startedAt");
  const endedAt = requiredISODate(input.endedAt, "endedAt");
  const startedMs = Date.parse(startedAt);
  const endedMs = Date.parse(endedAt);
  if (endedMs < startedMs) throw new Error("endedAt must not precede startedAt.");

  const failure = input.failure
    ? {
        name: String(input.failure.name || "Error"),
        message: String(input.failure.message || "Unknown fixture failure."),
        stack: input.failure.stack ? String(input.failure.stack) : undefined
      }
    : undefined;

  return {
    schemaVersion: MISSION_CONTROL_SOAK_REPORT_SCHEMA_VERSION,
    kind: "forge.mission-control-supervision-soak",
    status: failure ? "Failed" : "Passed",
    startedAt,
    endedAt,
    requestedSoakSeconds: nonNegativeInteger(input.requestedSoakSeconds, "requestedSoakSeconds"),
    actualSoakSeconds: nonNegativeNumber(input.actualSoakSeconds, "actualSoakSeconds"),
    actualElapsedSeconds: Number(((endedMs - startedMs) / 1_000).toFixed(3)),
    tasksPerRepository: positiveInteger(input.tasksPerRepository, "tasksPerRepository"),
    repositoryCount: positiveInteger(input.repositoryCount, "repositoryCount"),
    queue: {
      heldBeforeFirstGrant: nonNegativeInteger(input.queue?.heldBeforeFirstGrant, "queue.heldBeforeFirstGrant"),
      finalRunning: nonNegativeInteger(input.queue?.finalRunning, "queue.finalRunning"),
      finalQueued: nonNegativeInteger(input.queue?.finalQueued, "queue.finalQueued")
    },
    grants: {
      total: nonNegativeInteger(input.grants?.total, "grants.total"),
      order: (input.grants?.order ?? []).map(String)
    },
    restarts: {
      everyGrants: positiveInteger(input.restarts?.everyGrants, "restarts.everyGrants"),
      duringGrantDrain: nonNegativeInteger(input.restarts?.duringGrantDrain, "restarts.duringGrantDrain"),
      duringSoak: nonNegativeInteger(input.restarts?.duringSoak, "restarts.duringSoak")
    },
    negativeControls: {
      staleAuthorizationRejected: input.negativeControls?.staleAuthorizationRejected === true,
      startupAutoDispatchPrevented: input.negativeControls?.startupAutoDispatchPrevented === true,
      starvationPrevented: input.negativeControls?.starvationPrevented === true
    },
    environment: {
      node: String(input.environment?.node ?? "unknown"),
      platform: String(input.environment?.platform ?? "unknown"),
      release: String(input.environment?.release ?? "unknown"),
      architecture: String(input.environment?.architecture ?? "unknown"),
      hostname: String(input.environment?.hostname ?? "unknown"),
      powerConditions: String(input.environment?.powerConditions ?? "Not recorded")
    },
    command: String(input.command ?? "unknown"),
    fixtureRoot: String(input.fixtureRoot ?? "unknown"),
    failureArtifactsPreserved: input.failureArtifactsPreserved === true,
    runtimeOutputTails: input.runtimeOutputTails ?? {},
    failure
  };
}

export function renderMissionControlSoakMarkdown(report) {
  const lines = [
    "# Mission Control Supervision Soak Report",
    "",
    `- Status: **${report.status}**`,
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
    `- Requested soak: ${report.requestedSoakSeconds}s`,
    `- Actual soak window: ${report.actualSoakSeconds}s`,
    `- Actual fixture elapsed: ${report.actualElapsedSeconds}s`,
    `- Command: \`${escapeInlineCode(report.command)}\``,
    `- Power/sleep conditions: ${report.environment.powerConditions}`,
    "",
    "## Workload and Oracles",
    "",
    "| Measure | Result |",
    "| --- | ---: |",
    `| Repositories | ${report.repositoryCount} |`,
    `| Tasks per repository | ${report.tasksPerRepository} |`,
    `| Held before first grant | ${report.queue.heldBeforeFirstGrant} |`,
    `| Grants | ${report.grants.total} |`,
    `| Grant-drain restarts | ${report.restarts.duringGrantDrain} |`,
    `| Soak restarts | ${report.restarts.duringSoak} |`,
    `| Final running | ${report.queue.finalRunning} |`,
    `| Final queued | ${report.queue.finalQueued} |`,
    "",
    `Grant order: ${report.grants.order.length ? report.grants.order.join(" → ") : "none"}`,
    "",
    `- Stale authorization rejected: ${yesNo(report.negativeControls.staleAuthorizationRejected)}`,
    `- Startup auto-dispatch prevented: ${yesNo(report.negativeControls.startupAutoDispatchPrevented)}`,
    `- Starvation prevented: ${yesNo(report.negativeControls.starvationPrevented)}`,
    "",
    "## Environment",
    "",
    `- Node: ${report.environment.node}`,
    `- OS: ${report.environment.platform} ${report.environment.release}`,
    `- Architecture: ${report.environment.architecture}`,
    `- Host: ${report.environment.hostname}`,
    `- Fixture root: \`${escapeInlineCode(report.fixtureRoot)}\``,
    `- Failure artifacts preserved: ${yesNo(report.failureArtifactsPreserved)}`
  ];

  if (report.failure) {
    lines.push(
      "",
      "## Failure",
      "",
      `**${report.failure.name}:** ${report.failure.message}`,
      "",
      "```text",
      report.failure.stack ?? report.failure.message,
      "```"
    );
  }

  const outputEntries = Object.entries(report.runtimeOutputTails);
  if (outputEntries.length) {
    lines.push("", "## Runtime Output Tails");
    for (const [repository, output] of outputEntries) {
      lines.push("", `### ${repository}`, "", "```text", String(output || "(empty)"), "```");
    }
  }

  return `${lines.join("\n")}\n`;
}

function requiredISODate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf())) throw new Error(`${label} must be an ISO date.`);
  return date.toISOString();
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return Number(value.toFixed(3));
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function escapeInlineCode(value) {
  return String(value).replaceAll("`", "\\`");
}
