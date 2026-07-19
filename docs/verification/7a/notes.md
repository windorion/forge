# 7a · Menu Bar Mini Window — 2026-07-19 · SHA 2794978

Evidence: `20260719T173247Z_2794978_window5.png` (panel), plus sibling
captures of the coexisting windows.

Built from Missing via AppKit: MenuBarController (NSStatusItem with logo
button + accent running-count badge, floating borderless NSPanel hosting
the SwiftUI MenuBarMiniWindow) — black FORGE header with live
IDLE/N RUNNING indicator, RUNNING task cards (progress bars + step/repo/
elapsed meta), ⏸ NEEDS YOU rows (real waiting questions), ✓ PR READY
rows, "new task… (↵ to plan)" quick input creating real tasks, footer
OPEN FORGE · pause all · real "$spend / $cap this month". Gated by the
forge.showMenuBarExtra default; badge updates from live task state.

Engineering note recorded: SwiftUI's MenuBarExtra scene broke Darwin
notification delivery app-wide (capture pipeline died with the scene
present; restored the moment it was removed — bisected twice). The
AppKit status-item path avoids the conflict entirely and gives the
custom panel chrome the mockup draws anyway. Verified (with notes).
