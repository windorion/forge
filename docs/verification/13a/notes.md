# 13a · Software Update Dialog — 2026-07-21

Evidence: `update-dialog.png` (found-new-version state, real appcast data).

Built from Missing (custom Sparkle-driver-style UI, per the handoff's
"Sparkle 允许自定义更新 UI"): ForgeUpdater performs a real appcast
fetch → XML parse → version compare against the current app version, and
drives UpdateDialogView. Rendered on real data from the bundled
placeholder appcast (apps/macos/Resources/appcast.xml): "Forge 0.5.0 is
ready.", "you have 0.4.2 · 18.4 MB · signed & notarized" (size parsed
from the enclosure length), WHAT'S NEW IN 0.5.0 with NEW/NEW/FIX badges
and the three release notes parsed from the item description, changelog
link, SKIP THIS VERSION / DOWNLOAD & INSTALL (drives a real progress
state). 22a CHECK NOW triggers the real check.

Recorded gaps (documented, plan-consistent): the EdDSA-signed production
appcast, notarized binary download, and actual install/relaunch are the
Sparkle-integration + P6 signing remainder; the download state stops at
"ready to restart" without mutating the installed app (the 28a banner
takes over from there). Verified (with notes).
