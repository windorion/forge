# 1b · Plan Approval (standalone compact)

- Date: 2026-07-18
- Base SHA: fa87c83 (fixes in working tree at capture time)
- App window: 980x520 (compact mode)
- Reference: handoff section `1b`, drawn window 980x446
- Evidence: `20260718T182851Z_fa87c83_Forge.png` (final)

## What was built

The coverage tracker's own gap note said "Standalone state … remain[s]" —
plan approval previously only existed inside the 1380 session layout. Added
`CompactPlanApprovalState` (WorkspaceView.swift) routed when a task is in
Human Review / Plan Review with a plan revision and nothing has run
(`compactApprovalRevision(_:)`), at compact window size:

- Header: PLAN PROPOSED badge (mono 9 bold, 1.5 border) + "#N · nothing has
  run yet" (real task ordinal by createdAt) + 17pt heavy title.
- Step rows: 20x20 numbered box, mono 12 bold title, mono 10 #9a9a92 meta
  (real step summaries), ✎ EDIT per row (opens the 20a full-plan surface),
  1.5 divider rows, padding 14/28 per handoff.
- Footer (#f7f7f4): "est. ~16 min · touches 1 file area · runs tests after
  each step" with ink-bold highlights (real estimatedMinutes /
  expectedFileAreas), ↻ REGENERATE (real generatePlanRevision), ✓ APPROVE &
  RUN (accent bg, 3x3 hard shadow, real approvePlanAndRun, ⌘↩).

## Deltas fixed along the way (affect many screens)

- Replaced all 11 `.shadow(color:radius:0)` offset shadows with a
  `forgeShadow` modifier (offset filled rect — exact `box-shadow` semantics).
  SwiftUI `.shadow` projects per-layer silhouettes and produced doubled
  text under capture; the rect background is correct on screen and in
  capture, and matches CSS box-shadow exactly.
- App now persists and restores the selected task across relaunch
  (`forge.selectedTaskID`), fixing relaunch always landing on the empty
  state even with live tasks.

## Intentional deviations

- Window height 520 vs 446 crop (stable compact window; see 1a notes).
- Step meta shows the runtime's real step summaries; the mockup's meta line
  is placeholder (`{{ p.meta }}`).
- "touches N file areas" (real `expectedFileAreas` count) vs mockup's
  illustrative "9 files" — count formatting preserved, unit made honest.

## Verdict

Matches the handoff layout with real data end to end. Verified.
