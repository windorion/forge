# Mission Control Fairness Evidence

Date: 2026-08-09 CEST

Source HEAD before commit: `5f1ff18`
Surface: native DEBUG ForgeApp, Mission Control 1240px workspace mode

## Final four-state captures

- `20260808T221610Z_5f1ff18_Forge.png`: observer/read-only background runtimes
- `20260808T221611Z_5f1ff18_Forge.png`: one authorized supervised runtime
- `20260808T221613Z_5f1ff18_Forge.png`: two queued repositories, visible
  `BG SLOTS 2`, next fair grant, and supervised footers
- `20260808T221615Z_5f1ff18_Forge.png`: review + running state at the background
  limit, with Pause-before-read-only boundary

The earlier `221504`-`221509` files are the first automation pass. Visual
inspection found that the DEBUG fixture did not match the real focused path
and the slot menu lacked a clear border at this width. The final pass fixes
both; the earlier files are retained as the auditable repair trail. `Item-0`
and `window2/window3` files are other visible native Forge windows captured by
the all-window hook.

## Automation and runtime evidence

- `script/verify_mission_control_surfaces.sh` drove
  observer → active → queued → review and produced 12 native-window captures
  in the final pass.
- `smoke:mission-control-fairness` proved six held tasks, exact alternating
  grants (`alpha → beta → alpha → beta → alpha → beta`), stale-authorization
  rejection, and restart injection every two grants.
- A 20-second extended run completed 79 restart cycles with no unexpected
  dispatch, identity change, task loss, or resurrected queue entry.
- A bounded 300-second run started at `2026-08-09T21:03:13.946Z` and completed
  1,086 soak restart cycles plus the same six alternating grants, two
  drain-time restarts, stale-authorization rejection, startup hold, starvation
  prevention, and empty final queues. Its generated local report is
  `runtime/build/mission-control-soak/20260809T210228Z-five-minute/mission-control-soak-report.md`;
  that ignored report records the battery/power note and explicitly says this
  is not the six-hour acceptance run.

## Action-level XCUITest checkpoint

- The authenticated `20260809T211229Z` run executed all three real
  `XCUIApplication` methods. Background-slot change and review-card navigation
  passed end to end.
- Authorization/revocation reached the native confirmation sheet but exposed a
  global accessibility-tree query that lost the sheet body between snapshots.
  Command routing reached cancellation but reused a cached pre-cancellation
  element for its disappearance assertion.
- The repair scopes title, body, and Cancel queries to `app.sheets.firstMatch`,
  re-queries the command control after retained `CANCELLED` evidence, removes a
  root identifier that overwrote descendant semantics, and gives routed task
  detail its own contained accessibility node. The app host and all three test
  methods pass `build-for-testing` after the repair.
- A complete passing archive remains outstanding. Action-level XCUITest takes
  foreground focus and must only be rerun in a user-approved unattended desktop
  window; compile-only CI remains the normal non-interactive gate.

This evidence verifies the deterministic native state/capture entry and the
runtime scheduling contract plus one passing action-level path. It is not a
claim of a complete passing XCUITest archive or a completed six-hour soak.
