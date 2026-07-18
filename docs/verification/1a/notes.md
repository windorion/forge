# 1a · New Task — Empty State

- Date: 2026-07-18
- Base SHA: fa87c83 (fixes in working tree at capture time)
- App window: 980x520 (compact mode default)
- Reference: `Forge App States.dc.html` section `1a`, drawn window 980x476
- Evidence: `20260718T181531Z_fa87c83_Forge.png` (post-fix self-render)

## Deltas found and fixed

1. PLAN IT button font was 12pt; handoff specifies 12.5pt with 0.5
   letter-spacing. Fixed (`WorkspaceView.swift` NewTaskEmptyState).
2. Empty-input state dimmed the PLAN IT button via `.disabled`; the handoff
   has no disabled visual (black background, accent text always). Removed
   the modifier — `createTask` already guards empty input.
3. Example-chip dashed border used `muted` (#6a6a64); handoff uses #9a9a92.
   Added `ForgeDesign.dashedBorder` token and applied it.
4. Footer count "1,204" was muted like the rest of the line; handoff renders
   it ink + bold. Fixed with a composed Text.
5. Footer was a fixed 40pt row; handoff measures 36.5 (11px vertical
   padding). Switched to vertical padding 11.

## Intentional deviations

- Window height 520 vs mockup crop 476: compact states 1a–1e crop at
  372–527; the app keeps one stable compact window size instead of jumping
  height per state. Content is Spacer-centered, absorbing the difference.
- Titlebar repo label shows the real connected repository
  (`Forge/DemoTodo`) instead of the illustrative `acme/api-server`.

## Known gaps (out of this pass's scope)

- Footer "indexed 1,204 files · in sync" is hardcoded illustrative copy;
  a real indexed-file count depends on repository indexing (P3), which is
  explicitly out of scope for the design-completion pass.

## Verdict

Content, copy, typography, colors, borders, and control behavior match the
rendered handoff at 980pt width. Verified (with the notes above).
