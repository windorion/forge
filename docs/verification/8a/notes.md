# 8a · Dock Menu — 2026-07-19

Evidence: live menu dump via the dumpDockMenu debug spec (real state):
```
0 running · 2 needs you · 1 PR ready
---
Answer #01ce — Wait for the user to review th
Answer #4f06 — Wait for the user to review th
---
New Task…
Mission Control
Pause All Agents
```
Built from Missing: applicationDockMenu(_:) constructs the menu fresh from
live tasks (summary header, running items with real progress %, Answer
items per waiting question routing through the task deep link, New Task /
Mission Control / Pause All with real enablement); Dock tile badge shows
the waiting count (NSApp.dockTile.badgeLabel, updated on every refresh).
macOS contributes Show All Windows/Options/Quit itself, and renders the
menu — a right-click screenshot needs the human pass (TCC). Verified
(with notes).
