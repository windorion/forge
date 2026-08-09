# Mission Control Routed Actions Evidence

Date: 2026-08-09 (Europe/Berlin)

Source worktree base: `2b27716` plus the reviewed Mission Control routed-action
changes in this session.

## Scope

`script/verify_mission_control_routed_actions.sh` drove a running DEBUG
`ForgeApp` through three native task-detail states without changing the primary
workspace:

1. Commands: runtime-owned validation permissions, explicit preset approval,
   known command run, active command cancellation, and reviewed repair rerun.
2. Git: repository-local status, bounded diff, local branch/commit review, and
   honest blocked publish/push state when remote/upstream evidence is absent.
3. Commands again: proves the action-driven transition returns to the same
   `(repository path, task ID)` route.

The final app-window captures are:

- `20260809T074840Z_2b27716_Forge.png`
- `20260809T074842Z_2b27716_Forge.png`
- `20260809T074844Z_2b27716_Forge.png`

## Review Notes

- Exact routed path and `AUTHORIZED ROUTE` state remain visible.
- Commands and Git are mutually exclusive tabs inside the root-owned Mission
  Control surface.
- Blocked publish/push actions do not render misleading enabled controls.
- The Git fixture reuses its bounded stored diff and does not contact an absent
  runtime or leave a false error in the status bar.
- The implementation uses the same square, opaque, desktop-native surface
  language as the existing `4a` Mission Control evidence.

This is deterministic DEBUG native view/action-transition evidence. It is not
an XCUITest claim and does not replace the planned accessibility-driven
authorization, slot, navigation, and confirmation tests.
