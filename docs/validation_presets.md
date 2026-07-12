# Validation Presets

Document role: record validation preset sources, workspace configuration,
approval rules, and command execution boundaries.

## Principle

Validation presets let Forge run repeatable checks after an applied proposal.
They must stay auditable and bounded. A workspace can choose from runtime-known
commands, but it cannot inject arbitrary shell commands.

## Sources

Forge currently supports two preset sources:

- `BuiltIn`: shipped by the runtime.
- `Workspace`: loaded from the current workspace config file.

The default workspace config path is:

```text
.forge/validation-presets.json
```

For tests or alternate local setups, the runtime can use:

```text
FORGE_VALIDATION_PRESET_CONFIG_PATH=/path/to/validation-presets.json
```

## Built-In Presets

`forge-post-apply` is low risk and runs automatically after apply:

- `forge:changed-files-exist`
- `forge:applied-proposal-recorded`
- `forge:ready-validation-retained`

`runtime-typescript` is medium risk and requires approval:

- `npm run check` in `runtime/`
- `npm run build` in `runtime/`

`macos-swiftpm` is medium risk and requires approval:

- `swift build` from the repository root

## Workspace Config Format

Workspace presets can only reference command IDs that the runtime already
knows. They cannot provide raw command strings.

Example:

```json
{
  "presets": [
    {
      "id": "workspace-runtime-checks",
      "name": "Workspace Runtime Checks",
      "description": "Run runtime checks chosen by this workspace.",
      "commandIDs": ["runtime-npm-check", "runtime-npm-build", "macos-swift-build"]
    }
  ]
}
```

The runtime computes risk from the referenced commands. Presets containing
medium- or high-risk commands require task-level approval before execution.

## Permission Snapshots

The runtime exposes task-specific preset permission state at:

```text
GET /tasks/:taskID/validation-permissions
```

Each permission snapshot includes:

- preset source and risk level
- approval state: `NotRequired`, `NeedsApproval`, or `Approved`
- execution state: `Blocked`, `NeedsApproval`, `Ready`, or `Running`
- blocked reasons
- command execution mode and boundary
- last validation run for the preset, if one exists

The macOS Review panel uses this endpoint to show command permission requests.
The UI should not locally invent a different permission policy.

Approval and execution readiness are intentionally separate. A medium-risk
preset can be approved before an edit proposal is applied. Running a full
validation preset still requires the applied-proposal validation gate, while a
task-scoped command run can reuse the same approval to run one command by ID
inside the live task session.

## Task-Scoped Command Runs

The runtime exposes:

```text
POST /tasks/:taskID/run-task-command
POST /tasks/:taskID/cancel-task-command
```

The request accepts a `commandID` only. The command must already exist in the
runtime command catalog and must belong to a preset that is either low risk or
approved for the task. Raw shell strings from the app, workspace config, model,
or user prompt are not accepted.

The first app surface uses `runtime-npm-check` as a live-session command. The
runtime records the approving preset, status, exit code, output summary, and
bounded stdout/stderr/system chunks in task state, and streams output through
SSE events. Failed task-scoped commands generate provider repair briefs linked
to `taskCommandRunID`; the same explicit repair-proposal endpoint can then
create a review-only self-fix proposal without applying files automatically.

Active spawned task-scoped commands can be cancelled by `taskCommandRunID`.
Cancellation is not arbitrary process control: the runtime only cancels an
active child process it started for the given task command run. A cancellation
request records a `Cancel Task Command` approval/audit entry, appends a system
output chunk, emits cancellation events, and marks the command `Cancelled`
when the process exits. Cancelled commands do not create failure repair briefs.

## Safety Rules

- Workspace preset ids must be lowercase, dash-separated identifiers.
- Duplicate preset ids are skipped.
- Unknown command ids are reported as config issues.
- Project commands run with `spawn`, `shell: false`.
- Command cwd values are runtime-owned and must resolve inside the repo.
- Permission cards show command boundaries before approval or execution.
- Exit code and output summary are recorded for every command.
- Cancellation accepts only task command run ids for active runtime-owned
  processes, never raw PIDs or shell text.
- Task-scoped command output chunks are bounded before persistence.
- Failed commands make the validation run fail.
- Failed validation runs and failed task-scoped commands can trigger a
  provider-generated repair brief from compact command summaries. The brief is
  advisory and does not rerun commands or change files.

## Future Work

- Add a settings editor for workspace presets.
- Add more command catalog entries.
- Add per-workspace approval memory with revocation.
- Split validation runs into normalized database tables.
