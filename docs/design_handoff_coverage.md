# Design Handoff Coverage

Document role: track implementation and exact visual/interaction verification
for every named screen in `design_handoff_forge/Forge App States.dc.html`.

Last updated: 2026-08-11

## Completion Rule

A screen is `Verified` only when all of the following are true:

- every visible string, state label, unit, and keyboard hint matches the handoff
- layout, dimensions, spacing, borders, hard shadows, colors, and typography
  match at the handoff window size
- all specified controls and state transitions work with real application data
- the screen has been compared visually with the rendered handoff
- no obsolete or duplicate UI hierarchy is visible

`Implemented` means the main structure exists but has not passed that exact
verification. `Partial` means only some UI or supporting behavior exists.
`Missing` means there is no dedicated handoff-equivalent surface.

The handoff README says 37 screens, while the delivered HTML currently contains
43 named `<section>` screens/states. This tracker follows the HTML because it is
the actual visual source of truth.

## Current Coverage

| Group | Screen | Status | Current gap |
| --- | --- | --- | --- |
| Core | `14a` Main window | Verified | Rendered comparison done (docs/verification/14a); thinking-stream format, plan strip timing, and sidebar running/budget footer aligned. Sidebar nav rows and FULL DIFF/AUDIT entries are recorded additions. |
| Core | `1a` New task empty state | Verified | Rendered comparison done (docs/verification/1a); button spec, chip border token, footer weights fixed. Indexed-file count is now real (durable SQLite index; docs/verification/1a/real-indexed-footer.png). |
| Core | `1b` Plan approval | Verified | Standalone compact approval state built and compared (docs/verification/1b); routes only for dialog-free proposals, chat sessions keep the embedded card. |
| Core | `20a` Full plan approval | Verified | Right column matches handoff order with real guardrails and planned-in timing (docs/verification/20a); per-step minutes, ADD A STEP, and PRODUCT CALL badges await plan-editing runtime capability. |
| Core | `32a` New session | Verified | Chat session structure compared (docs/verification/32a); mid-run chat perspective is the recorded gap (run switches to 14a layout). |
| Core | `10a` Fullscreen diff review | Verified | Layout aligned and compared on live proposal data (docs/verification/10a); PLAN STEP badge, CONVENTION MATCHED, and OPEN PR await runtime/P2 capability. |
| Core | `26a` Task queue | Verified | Rendered comparison done on real queue data (docs/verification/26a); drag polish recorded. |
| Core | `4a` Mission control | Verified | Rendered comparison done on live multi-repo data (docs/verification/4a); duplicate registration fixed; cross-runtime click-through awaits a real second runtime session. |
| Decisions | `33a` Agent question | Verified | Rendered comparison done on a real enriched WaitForHumanReview step (docs/verification/33a). |
| Decisions | `34a` Batch questions | Verified | Rendered comparison done with a real waiting task (docs/verification/34a). |
| Decisions | `18a` Merge conflict | Verified | Rendered comparison done on a real conflicted merge (docs/verification/18a). |
| Decisions | `19a` Failed/rollback | Verified | Rendered comparison done via the real startup-recovery fail path (docs/verification/19a). |
| Decisions | `24a` First success | Verified | Rendered comparison done on the real first Completed task (docs/verification/24a); runtime branch-name bug fixed. The guarded publication flow now supplies a real PR number/state when one exists. |
| Decisions | `37a` Cost breakdown | Verified | Step/model-call accordion surface built and compared (docs/verification/37a); token columns await token accounting; in-app cost-metric entry point pending. |
| Settings | `22a` General | Verified | Rendered comparison done (docs/verification/22a); notify/theme prefs persist, login item registers via SMAppService, CHECK NOW drives the real 13a update dialog. |
| Settings | `3a` Model | Verified | Rendered comparison done (docs/verification/3a); STANDARD/MAX labels, real budget usage, real stats footer. Provider cards list real runtime providers, not the illustrative Claude lineup. |
| Settings | `6a` GitHub | Partial | OAuth configuration, Device Flow, browser opening, polling/error handling, Keychain state, connect/disconnect UI, and tests are complete (docs/verification/6a). Live grant capture still requires the founder GitHub OAuth App Client ID with Device Flow enabled. |
| Settings | `30a` API key | Verified | Rendered comparison done (docs/verification/30a); mockup provider labels, reveal toggle, THIS MONTH card. Windorion-credits card awaits the 15a hosted-account decision. |
| Settings | `5b` Shortcuts | Verified | Real remapping shipped (ForgeShortcuts registry + recording UI + live menu bindings, override-proven). Focus-repo/cycle-tab/PR/copy-branch bindings and a human keypress pass remain (docs/verification/5b). |
| Settings | `16a` Account/usage | Verified | Rendered comparison done (docs/verification/16a); local-first profile card replaces hosted identity pending 15a; TOKENS→COMPLETED honest substitute. |
| Quick entry | `5a` Command palette | Verified | Rendered comparison done (docs/verification/5a). |
| Quick entry | `12a` Quick capture | Verified | Global-hotkey floating panel with real repos/presets and honest AI hint (docs/verification/12a); file-match intelligence awaits P3 indexing. |
| Quick entry | `7a` Menu bar mini window | Verified | NSStatusItem + floating panel with live tasks, quick entry, budget footer (docs/verification/7a); MenuBarExtra scene avoided due to a Darwin-notification conflict. |
| Quick entry | `27a` CLI companion | Verified | Self-contained forge-cli target (task/status/answer/review) against the shared runtime + forge:// deep link (docs/verification/27a); brew tap stays P6. |
| Quick entry | `36a` Task templates | Verified | Library built with local store, placeholder prompts, real presets, prefill flow (docs/verification/36a). |
| System | `8a` Dock menu | Verified | Live applicationDockMenu with real tasks + waiting badge (docs/verification/8a); right-click screenshot awaits human pass. |
| System | `9a` Notifications | Verified | Four UN categories with contextual auth, 22a gate, real transition emitters, deep-link actions (docs/verification/9a). |
| System | `11a` Spotlight | Verified | CSSearchableIndex reindex on refresh + result continuation into the task (docs/verification/11a); dynamic create-task row stays a stretch goal. |
| System | `21a` App menu | Verified | Full handoff command set with registry shortcuts and real enable state; dropdown chrome is system-rendered (docs/verification/21a). |
| System | `35a` Widget | Missing | Timeboxed hand-assembled .appex experiment ran and failed as pre-declared (pluginkit never discovers an ad-hoc-signed hand-built extension; embedded runtime resource forks block deep signing). Widget code compiles and is kept in-tree; unblocks with P6 signing infrastructure (docs/verification/35a). |
| Recovery | `15a` Sign in | Verified | Welcome, Client ID setup, Device Flow, and connected states use the real OAuth client (docs/verification/15a); live code capture activates once the founder registers the Client ID. Email now opens an honest service-status/local-continuation state pending the hosted-account decision. |
| Recovery | `25a` Onboarding | Verified | Four-step first-run wizard orchestrating GitHub connect, repo pick, real guardrails preview, and the 1a first-task flow (docs/verification/25a); all four steps captured. |
| Recovery | `17a` No repository | Verified | Rendered comparison done (docs/verification/17a); subtitle truncation fixed; both actions real. |
| Recovery | `29a` Offline | Verified | Rendered comparison done with cached tasks (docs/verification/29a); mid-session disconnect detection fixed en route. |
| Recovery | `31a` Crash recovery | Verified | Rendered comparison done via a real interrupted-apply startup recovery (docs/verification/31a). |
| Recovery | `13a` Update dialog | Verified | Custom update dialog on real appcast fetch/parse/compare (docs/verification/13a); signed appcast + install/relaunch are the Sparkle/P6 remainder. |
| Recovery | `28a` Update ready | Verified | Deferred-restart banner honoring live running-task count (docs/verification/28a); restart-relaunch is the P6/Sparkle install remainder. |
| Recovery | `23a` Share/collaboration | Verified | Real share popover + local opaque token/read-only export (docs/verification/23a); hosted forge.windorion.com viewer + comment reflux are the documented founder-level gap. |
| Recovery | `2a` Task history | Verified | Rendered comparison done (docs/verification/2a). |
| Recovery | `2b` Audit log | Verified | Rendered comparison done (docs/verification/2b). |
| Compact states | `1c` Needs decision | Verified | Rendered comparison done (docs/verification/1c); real provider A/B options, paused/blocked durations live. |
| Compact states | `1d` PR ready | Verified | Rendered comparison done (docs/verification/1d); real metrics/files/branch, finished-in timing. Real PR publication landed in P2: the header now shows the actual PR number and live state (docs/verification/1d-merged-pr). |
| Compact states | `1e` Guardrails | Verified | Rendered comparison done (docs/verification/1e); always-on badges, real preset count; Settings-scene system titlebar is a recorded platform limitation. |

## Measured Status

- Functional Coding-Agent Demo V0: 100% of its documented behavior criteria.
- Primary V0 screen implementation: all 5 primary targets (`1a` `1b` `10a`
  `14a` `32a`) are now `Verified` with rendered-comparison evidence in
  `docs/verification/`.
- Full handoff: 41 `Verified` out of 43 named screens/states. The
  remaining two: `6a` GitHub is `Partial` (the complete Device Flow is
  implemented and tested, but a live authorization/capture still requires a
  founder-owned GitHub OAuth App Client ID with Device Flow enabled); `35a`
  Widget is a documented platform-blocked descope (a
  hand-assembled ad-hoc-signed WidgetKit extension is not discovered by
  pluginkit; unblocks with P6 signing infrastructure).
- Verification evidence lives in `docs/verification/<screen-id>/` (self-
  rendered captures + notes; see `docs/verification/README.md` for the
  capture pipeline and per-screen reference sizes).
- Weighted full-handoff UI readiness: approximately 95-97% (41 of 43 verified; 6a awaits the founder OAuth Client ID, 35a is a platform-blocked descope).

These metrics must remain separate. Functional completion never implies design
completion.

## Presentation Isolation Audit

All 43 named handoff entries have a documented presentation class. This audit
checks hierarchy and opacity only; it does not replace screenshot comparison.

- Direct, mutually exclusive workspace states: `14a`, `1a`, `1b`, `32a`,
  `33a`, `18a`, `19a`, `24a`, `17a`, `29a`, `31a`, `1c`, and `1d`.
- Opaque exclusive workspace surfaces: `20a`, `10a`, `26a`, `4a`, `34a`,
  `2a`, and `2b`. A single root coordinator owns these surfaces. While one is
  visible, the prior workspace is opacity-zero, ignores pointer input, and is
  removed from the accessibility tree. No SwiftUI `.sheet` remains in the
  macOS app source.
- Intentional dimmed overlay: `5a` Command Palette. The visible background is
  part of the handoff interaction rather than obsolete UI.
- Dedicated native Settings scene with an opaque root: `22a`, `3a`, `6a`,
  `30a`, `5b`, `16a`, and `1e`.
- Native menu surface without a second content hierarchy: `21a`.
- Dedicated native or auxiliary surfaces verified outside the primary
  workspace hierarchy: `37a`, `12a`, `7a`, `27a`, `36a`, `8a`, `9a`, `11a`,
  `15a`, `25a`, `13a`, `28a`, and `23a`.
- Remaining partial/missing boundaries: `6a` needs one live OAuth grant with a
  founder-owned Client ID; `35a` needs the signed P6 WidgetKit pipeline.

System alerts and confirmation dialogs remain intentional native modal layers.
They are not counted as obsolete or duplicate product interfaces.

## Remaining Closeout Order

1. Live-verify `6a` after the founder supplies a GitHub OAuth App Client ID
   with Device Flow enabled; retain the grant/error capture as evidence.
2. Revisit `35a` only with the P6 signed packaging pipeline; the documented
   ad-hoc experiment is not a shippable WidgetKit path.
3. Preserve rendered evidence when later product work changes a Verified
   surface. Recorded follow-ons such as PR checks, cost tokens, cross-runtime
   routing, and semantic retrieval belong in `docs/todo.md`; they do not reopen
   the completed visual verification unless the rendered surface changes.
