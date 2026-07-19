# 27a · CLI Companion — 2026-07-19 · SHA 7df30a7

Evidence: real terminal transcripts in the 2026-07-19 session log capture
(forge status listing all seven live tasks with mockup-format glyphs and
suggested commands; forge task full flow: repo detected → "plan ready — 5
steps · est ~16m · ~$0.00" → numbered steps → y/e/n prompt → graceful
open-questions guidance), plus deep-link capture set.

Built from Missing: new self-contained `forge-cli` SPM executable target
(apps/cli/Sources/ForgeCLI) speaking to the same local runtime over HTTP —
commands: task (create → plan → y/n approve → queued), status (colored
live list), answer <id>, review/open <id> (deep-links forge://task/<id>).
URL scheme registered in the packaged Info.plist (CFBundleURLTypes) with
an AppDelegate open-URLs handler routing through forgeOpenTaskDeepLink to
select the task and front the app — "heavy lifting stays in the app" per
the mockup footnote.

Recorded gaps: `brew install windorion/forge` is marked SOON in the mockup
itself (distribution is P6); per-step time/cost estimates in the plan
summary use the revision totals (no per-step estimates yet); the terminal
window chrome is the user's own terminal by design. Verified (with notes).
