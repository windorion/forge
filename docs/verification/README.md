# Screen Verification Evidence

Document role: define how a handoff screen earns `Verified` status in
`docs/design_handoff_coverage.md`, and where the evidence lives.

## Why this exists

`docs/todo.md` requires "screenshots or equivalent visual comparison
evidence for each screen; do not mark a screen verified from code
inspection alone." Before 2026-07-18 nothing in the repo satisfied this:
there was no capture tooling and no evidence convention, and multiple prior
sessions record being blocked by unavailable macOS Screen Recording
permission (see `docs/session_log.md`, entries around 2026-07-15).

## Evidence tiers

**Tier 1 — real pixel comparison (required for `Verified`).**

1. Capture the running app with `script/capture_screen.sh <screen-id>`,
   saved to `docs/verification/<screen-id>/<timestamp>_<git-sha>.png`.
   Primary mechanism: the DEBUG build renders its own visible windows to
   PNG when the Darwin notification `com.windorion.forge.debug.capture` is
   posted (see `apps/macos/Sources/ForgeApp/DebugWindowCapture.swift`) —
   the app rendering its own view hierarchy needs **no Screen Recording
   permission**, so the pipeline is independent of TCC state. The script
   additionally attempts a true-pixel `screencapture` region grab as a
   non-fatal bonus when the calling process happens to have permission.
   The DEBUG build also disables App Nap so captures work while the app is
   occluded (verified 2026-07-18: with App Nap active, Darwin notification
   delivery is deferred indefinitely until the app is activated).
2. Get a reference image by opening
   `design_handoff_forge/Forge App States.dc.html` in a real browser and
   capturing the matching `<section id="X">` at that section's own
   specified width. The file renders real mock content directly (confirmed
   2026-07-18), not raw template placeholders.
3. Compare side by side; note every delta (copy, spacing, color, shadow,
   typography) in that screen's `notes.md`; fix them in code; re-capture;
   confirm clean; only then flip the row in `docs/design_handoff_coverage.md`.

**Tier 2 — structural fallback (explicitly NOT `Verified`).** Only use if
Tier 1 is confirmed permanently blocked in this environment. A scripted
Accessibility-tree dump (window/AXSheet counts, every `AXStaticText` value +
frame) diffed against strings extracted from the matching handoff section,
plus manual design-token diffing (colors/fonts/shadows read from source).
This can confirm exact strings and absence of duplicate/obsolete UI
hierarchy, but cannot confirm layout, spacing, color, shadow, or typography
fidelity. Screens checked this way should be marked with an explicit
distinct status (not `Verified`) if this tier is ever adopted — that is a
tracking-vocabulary change requiring sign-off, not something to do silently.

## Known gotchas

- `screencapture`'s Screen Recording permission is granted per **calling
  process** (whatever app hosts the shell that runs it), not per target
  app. Confirmed 2026-07-18: this session's shell traced back to
  `/Applications/Claude.app` itself, not a terminal emulator — that is the
  app that needs the grant (System Settings → Privacy & Security → Screen
  Recording), followed by fully quitting and relaunching it. macOS only
  re-checks this permission on process restart; it cannot be granted or
  applied programmatically.
- The handoff HTML pulls JetBrains Mono from Google Fonts at render time.
  Without that fetch, a browser reference screenshot silently substitutes a
  different monospace font, which is an unfair baseline. Either allow that
  one-time fetch, or point a local `@font-face` override at the app's own
  bundled TTFs (`apps/macos/Resources/Fonts/JetBrainsMono-Regular.ttf` /
  `-Bold.ttf`) before capturing the reference.
- Capture at the screen's own specified window size
  (`WorkspaceWindowMode` in `apps/macos/Sources/ForgeApp/WorkspaceView.swift`
  encodes the per-surface target sizes) — don't compare arbitrary window
  sizes against a fixed-width reference.
- Don't chase literal sameness of illustrative numbers/IDs (task #128,
  $0.83, etc. are handoff placeholder data) — chase formatting-convention
  sameness (monospace alignment, units, precision).

## Reference window sizes (measured from the rendered handoff, 2026-07-18)

Logical px, first drawn app-window `<div>` per section. Mockup heights are
content-crops of each state; the app keeps stable per-mode window sizes
(`WorkspaceWindowMode`) rather than jumping height per state — content
fidelity is what gets compared, with intentional deviations noted per
screen.

| Screen | Size | Screen | Size | Screen | Size |
|---|---|---|---|---|---|
| 1a | 980x476 | 1b | 980x446 | 1c | 980x473 |
| 1d | 980x372 | 1e | 980x527 | 2a | 980x583 |
| 2b | 980x430 | 3a | 980x580 | 4a | 1240x572 |
| 5a | 980x607 | 5b | 980x787 | 6a | 980x611 |
| 7a | 760x377 | 8a | 720x460 | 9a | 500x338 |
| 10a | 1240x669 | 11a | 680x398 | 12a | 900x520 |
| 13a | 988x403 | 14a | 1380x687 | 15a | 908x495 |
| 16a | 980x607 | 17a | 980x586 | 18a | 1240x593 |
| 19a | 1240x575 | 20a | 1240x655 | 21a | 900x277 |
| 22a | 980x630 | 23a | 1088x432 | 24a | 980x631 |
| 25a | 1100x661 | 26a | 1240x513 | 27a | 1148x389 |
| 28a | 980x297 | 29a | 1240x578 | 30a | 980x587 |
| 31a | 980x587 | 32a | 1380x707 | 33a | 1240x644 |
| 34a | 1240x557 | 35a | 997x454 | 36a | 1240x647 |
| 37a | 1100x663 | | | | |

## Folder convention

```
docs/verification/<screen-id>/
  notes.md          date, git SHA, window size used, deltas found/fixed, sign-off
  <timestamp>_<sha>.png   one or more capture(s)
```
