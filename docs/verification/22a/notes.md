# 22a · Settings — General

- Date: 2026-07-19 · SHA f06966b (+fixes)
- Evidence: `20260719T062007Z_f06966b_Forge-Settings.png`

Fixes this pass: "Notify me about" and "Theme" now persist via @AppStorage
(previously plain @State that reset on every open); "Launch Forge at
login" now registers/unregisters the real SMAppService login item and
reverts the toggle if macOS refuses.

Remaining for full Verified: theme segmented control is persisted but not
yet applied to rendering (visual theme system is explicitly Not Now);
CHECK NOW still refreshes runtime health pending the Phase 8 Sparkle
wiring. Structure/copy match the mockup rows. Status: Implemented→pending
final pass with 13a.
