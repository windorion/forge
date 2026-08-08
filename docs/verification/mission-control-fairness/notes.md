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

This evidence verifies the deterministic native state/capture entry and the
runtime scheduling contract. It is not a claim of action-level XCUITest or a
completed six-hour soak.
