# 28a · Update Ready (deferred restart) — 2026-07-21

Evidence: `update-ready-banner.png` (main-window bottom banner).

Built from Missing: UpdateReadyBanner renders at the main window bottom
once ForgeUpdater reaches readyToRestart — "⇣ v0.5.0 READY · Update
downloaded — sessions and queue survive" with the real running-task
count driving the copy and primary action: N running → "won't be
interrupted" + RESTART WHEN IDLE; none running → "safe to restart" +
RESTART NOW; LATER dismisses. Honors the never-interrupt-a-task rule via
the live runningTaskCount. The menu-bar mini-window footer (7a) is the
second advertised placement; the bottom banner is the primary one and is
captured here. Verified (with notes; restart-relaunch is the P6/Sparkle
install remainder).
