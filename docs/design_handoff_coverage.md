# Design Handoff Coverage

Document role: track implementation and exact visual/interaction verification
for every named screen in `design_handoff_forge/Forge App States.dc.html`.

Last updated: 2026-07-19

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
| Core | `1a` New task empty state | Verified | Rendered comparison done (docs/verification/1a); button spec, chip border token, footer weights fixed. Indexed-file count stays illustrative until P3 indexing. |
| Core | `1b` Plan approval | Verified | Standalone compact approval state built and compared (docs/verification/1b); routes only for dialog-free proposals, chat sessions keep the embedded card. |
| Core | `20a` Full plan approval | Verified | Right column matches handoff order with real guardrails and planned-in timing (docs/verification/20a); per-step minutes, ADD A STEP, and PRODUCT CALL badges await plan-editing runtime capability. |
| Core | `32a` New session | Verified | Chat session structure compared (docs/verification/32a); mid-run chat perspective is the recorded gap (run switches to 14a layout). |
| Core | `10a` Fullscreen diff review | Verified | Layout aligned and compared on live proposal data (docs/verification/10a); PLAN STEP badge, CONVENTION MATCHED, and OPEN PR await runtime/P2 capability. |
| Core | `26a` Task queue | Implemented | The opaque exclusive 1240px real-data surface has running/queued/needs-you lanes, 1-3 persisted concurrency settings, ordered priority controls, removal, pause, estimates, automatic restart dispatch, and enforced same-repository serialization. Pointer drag polish and exact rendered comparison remain. |
| Core | `4a` Mission control | Partial | The opaque exclusive 1240px three-column surface, verified observers, explicit session-scoped active-runtime authorization, authorization evidence, live health/task/queue/git aggregation, focus shortcuts, New Task, and cross-runtime Pause All are real. Full background task creation/detail/review routing and rendered comparison remain. |
| Decisions | `33a` Agent question | Implemented | Context-backed `WaitForHumanReview` steps open the 1240px choice/consequence/frozen-context layout; answer-and-resume and confirmed abort are real, while rendered comparison remains. |
| Decisions | `34a` Batch questions | Implemented | The sidebar and detailed question state open an opaque exclusive 1240px answer queue backed by all waiting tasks; partial submit leaves unanswered tasks paused and resumes answered loops independently. |
| Decisions | `18a` Merge conflict | Implemented | Actual unmerged index entries open the 1240px conflicted-file/three-way/draft/action layout; Base/Ours/Theirs/working contents, explicit confirmation, stale-review protection, manual/side selection, single-file staging, and no-auto-continue boundary are real. Rendered comparison remains. |
| Decisions | `19a` Failed/rollback | Implemented | Failed tasks open a dedicated evidence/diagnosis/repo-state/reviewed-repair surface with guarded rollback/reject actions. |
| Decisions | `24a` First success | Implemented | The first persisted Completed task opens the one-time 980px celebration/receipt/next-step layout with real elapsed/agent/diff/check/review/cost evidence; Queue Next is real and GitHub opens only a safely derived GitHub remote. True merged-PR wording/URL and rendered comparison remain. |
| Decisions | `37a` Cost breakdown | Partial | Task estimates exist; step/model-call accordion is missing. |
| Settings | `22a` General | Implemented | Shared 980px navigation, startup, appearance, notification, sound, and update rows exist; rendered comparison remains. |
| Settings | `3a` Model | Implemented | Square provider cards, API-key handoff, effort selector, budget guardrail, and real save action exist; rendered comparison remains. |
| Settings | `6a` GitHub | Partial | Exact three-scope and repository-access layout uses real local git state; OAuth/device-flow connection remains. |
| Settings | `30a` API key | Implemented | Dedicated provider/key/status layout uses real Keychain storage and removal; exact provider test semantics and rendered comparison remain. |
| Settings | `5b` Shortcuts | Partial | Handoff shortcut groups now reflect active commands; runtime remapping remains. |
| Settings | `16a` Account/usage | Implemented | Usage summary, activity chart, budget, and repository breakdown use persisted task estimates; rendered comparison remains. |
| Quick entry | `5a` Command palette | Implemented | Scene-level `⌘K` and the visible sidebar entry open the dimmed 620px palette with fuzzy task/command search, keyboard navigation, and real task/runtime/repository/settings actions. |
| Quick entry | `12a` Quick capture | Missing | Global floating capture window is missing. |
| Quick entry | `7a` Menu bar mini window | Missing | Menu bar item and mini window are missing. |
| Quick entry | `27a` CLI companion | Missing | Shared-background CLI is missing. |
| Quick entry | `36a` Task templates | Missing | Template library and placeholder form are missing. |
| System | `8a` Dock menu | Missing | Native Dock menu commands are missing. |
| System | `9a` Notifications | Missing | Four native notification states are missing. |
| System | `11a` Spotlight | Missing | Core Spotlight task indexing is missing. |
| System | `21a` App menu | Partial | A native Forge menu now exposes Command Palette, New Task, and Switch Repository with the documented shortcuts; the full handoff command set and context validation remain. |
| System | `35a` Widget | Missing | WidgetKit S/M/L widgets are missing. |
| Recovery | `15a` Sign in | Missing | GitHub device-flow screen is missing. |
| Recovery | `25a` Onboarding | Missing | Four-step first-run flow is missing. |
| Recovery | `17a` No repository | Implemented | First launch without a selected workspace opens the 980px no-repo state; native folder selection persists a usable repository and starts the runtime, while Demo creates a local git sandbox. |
| Recovery | `29a` Offline | Implemented | Disconnected/wrong-version runtime states open the 1240px offline queue/checkpoint screen with real tasks, cached state, runtime events, and retry; rendered comparison remains. |
| Recovery | `31a` Crash recovery | Implemented | Persisted recovered/recovery-required evidence opens a checkpoint summary with review/resume actions. |
| Recovery | `13a` Update dialog | Missing | Sparkle update dialog is missing. |
| Recovery | `28a` Update ready | Missing | Deferred restart banner and mini-window status are missing. |
| Recovery | `23a` Share/collaboration | Missing | Read-only web review link flow is missing. |
| Recovery | `2a` Task history | Implemented | Dedicated opaque filter/search surface uses persisted task status, phases, changed files, and timestamps without leaving the workspace visible behind it. |
| Recovery | `2b` Audit log | Implemented | Dedicated opaque terminal-style event surface uses real task events, exports a local clipboard record, and does not layer over a visible task screen. |
| Compact states | `1c` Needs decision | Implemented | Runtime `WaitForHumanReview` decisions now open the compact two-route/freeform state; rendered comparison remains. |
| Compact states | `1d` PR ready | Implemented | Completed tasks now open a compact metrics/files/diff/PR-handoff state backed by real task/git data; hosted PR publication remains. |
| Compact states | `1e` Guardrails | Implemented | Shared settings navigation now exposes the exact always-on/toggle guardrail pattern; rendered comparison remains. |

## Measured Status

- Functional Coding-Agent Demo V0: 100% of its documented behavior criteria.
- Primary V0 screen implementation: all 5 primary targets (`1a` `1b` `10a`
  `14a` `32a`) are now `Verified` with rendered-comparison evidence in
  `docs/verification/`.
- Full handoff: 6 `Verified` (`1a` `1b` `10a` `14a` `20a` `32a`), 20
  `Implemented`, 4 `Partial`, 13 `Missing` out of 43 named screens/states.
- Verification evidence lives in `docs/verification/<screen-id>/` (self-
  rendered captures + notes; see `docs/verification/README.md` for the
  capture pipeline and per-screen reference sizes).
- Weighted full-handoff UI readiness: approximately 66-70%.

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
- Partial or missing dedicated product surfaces that cannot currently create
  duplicate UI: `37a`, `12a`, `7a`, `27a`, `36a`, `8a`, `9a`, `11a`, `35a`,
  `15a`, `25a`, `13a`, `28a`, and `23a`.

System alerts and confirmation dialogs remain intentional native modal layers.
They are not counted as obsolete or duplicate product interfaces.

## Design-First Implementation Order

1. Verify and close `1a`, `1b`, `10a`, `14a`, and `32a` line by line.
2. Complete compact task states `1c`, `1d`, and `1e`.
3. Rebuild the shared settings shell and finish `22a`, `3a`, `6a`, `30a`,
   `5b`, and `16a`.
4. Complete decision and recovery states, starting with `33a`, `19a`, `31a`,
   `29a`, and `17a`.
5. Complete queue/history/audit and multi-task surfaces.
6. Complete quick-entry and native system integrations.
7. Complete onboarding, authorization, updates, sharing, cost, templates, and
   first-success polish.

No new feature track should move ahead of this sequence unless it is required
to make a handoff interaction real.
