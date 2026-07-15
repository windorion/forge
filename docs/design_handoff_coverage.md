# Design Handoff Coverage

Document role: track implementation and exact visual/interaction verification
for every named screen in `design_handoff_forge/Forge App States.dc.html`.

Last updated: 2026-07-15

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
| Core | `14a` Main window | Implemented | Exact rendered comparison and typography remain. |
| Core | `1a` New task empty state | Implemented | Exact rendered comparison and typography remain. |
| Core | `1b` Plan approval | Implemented | Standalone state and exact rendered comparison remain. |
| Core | `20a` Full plan approval | Partial | Detailed plan data exists; dedicated full-screen layout is missing. |
| Core | `32a` New session | Implemented | Exact rendered comparison and responsive verification remain. |
| Core | `10a` Fullscreen diff review | Implemented | Exact rendered comparison and larger diff edge states remain. |
| Core | `26a` Task queue | Partial | Basic task list exists; concurrency lanes, limits, drag order, and repo serialization are missing. |
| Core | `4a` Mission control | Missing | Multi-repository three-column view is missing. |
| Decisions | `33a` Agent question | Implemented | Context-backed `WaitForHumanReview` steps open the 1240px choice/consequence/frozen-context layout; answer-and-resume and confirmed abort are real, while rendered comparison remains. |
| Decisions | `34a` Batch questions | Implemented | The sidebar and detailed question state open a 1240px answer queue backed by all waiting tasks; partial submit leaves unanswered tasks paused and resumes answered loops independently. |
| Decisions | `18a` Merge conflict | Missing | Three-way conflict resolver is missing. |
| Decisions | `19a` Failed/rollback | Implemented | Failed tasks open a dedicated evidence/diagnosis/repo-state/reviewed-repair surface with guarded rollback/reject actions. |
| Decisions | `24a` First success | Missing | Celebration and next-step state are missing. |
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
| Recovery | `2a` Task history | Implemented | Dedicated filter/search table uses persisted task status, phases, changed files, and timestamps. |
| Recovery | `2b` Audit log | Implemented | Dedicated terminal-style event log uses real task events and exports a local clipboard record. |
| Compact states | `1c` Needs decision | Implemented | Runtime `WaitForHumanReview` decisions now open the compact two-route/freeform state; rendered comparison remains. |
| Compact states | `1d` PR ready | Implemented | Completed tasks now open a compact metrics/files/diff/PR-handoff state backed by real task/git data; hosted PR publication remains. |
| Compact states | `1e` Guardrails | Implemented | Shared settings navigation now exposes the exact always-on/toggle guardrail pattern; rendered comparison remains. |

## Measured Status

- Functional Coding-Agent Demo V0: 100% of its documented behavior criteria.
- Primary V0 screen implementation: 5 of 5 substantially implemented, none
  yet marked `Verified` under the strict rule above.
- Full handoff: 21 `Implemented`, 4 `Partial`, 18 `Missing`, 0 `Verified` out
  of 43 named screens/states.
- Weighted full-handoff UI readiness: approximately 53-56%.

These metrics must remain separate. Functional completion never implies design
completion.

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
