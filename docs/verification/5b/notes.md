# 5b · Settings — Shortcuts

- Date: 2026-07-19 · SHA 19f9e85 (+fixes)
- Evidence: `20260719T071618Z_19f9e85_Forge-Settings.png` (defaults),
  `20260719T071649Z_19f9e85_Forge-Settings.png` (⌘T override proof)

Built this pass: real remapping. `ForgeShortcuts` registry (defaults per
command, UserDefaults overrides, keycap rendering, NSEvent capture);
click a binding → "press keys…" recording state → stored → live.
CommandMenu (new task/palette/mission control/switch repo) and sidebar
(queue/history via existing bindings) read the registry. End-to-end
verified by storage override: forge.shortcut.newTask=t|cmd renders ⌘T
and drives the menu item. RESET ALL lives on this page (the mockup's
"reset all in ABOUT" points at an ABOUT pane the 7-item sidebar ruling
dropped).

Known gaps: Focus repo 1–3, Cycle DIFF/TESTS/LOG, Open PR, and Copy
branch name are listed in the mockup but not yet wired to registry-driven
bindings (commands exist partially); recording interaction awaits a human
keypress pass. Verified (with notes).
