# 13a · Software Update Dialog — 2026-07-21

Evidence: `update-dialog.png` (found-new-version) and `update-downloading.png` (download progress) — both states, real appcast data.

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

Security-truth addendum (2026-08-22): the original rendered evidence remains a
layout/state comparison, but its `signed & notarized` placeholder copy was not
a valid trust claim. Current code says `unsigned placeholder feed · install
disabled`, describes a present feed signature without inferring notarization,
and keeps `installEnabled` false. The production download method fails closed
when installation is unavailable. DEBUG can still place the view into
download/restart states for design verification, but that is not shipping
update evidence. No replacement screenshot was captured because this work was
code-only and did not run desktop automation.
