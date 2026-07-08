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

## Safety Rules

- Workspace preset ids must be lowercase, dash-separated identifiers.
- Duplicate preset ids are skipped.
- Unknown command ids are reported as config issues.
- Project commands run with `spawn`, `shell: false`.
- Command cwd values are runtime-owned and must resolve inside the repo.
- Permission cards show command boundaries before approval or execution.
- Exit code and output summary are recorded for every command.
- Failed commands make the validation run fail.
- Failed validation runs can trigger a provider-generated repair brief from
  compact command summaries. The brief is advisory and does not rerun commands
  or change files.

## Future Work

- Add a settings editor for workspace presets.
- Add more command catalog entries.
- Add per-workspace approval memory with revocation.
- Split validation runs into normalized database tables.
