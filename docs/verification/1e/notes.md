# 1e · Settings — Guardrails

- Date: 2026-07-19 · SHA 9775dd3 (+fixes)
- Window: Settings 980x602; reference 980x527
- Evidence: `20260719T061554Z_9775dd3_Forge-Settings.png`

What matches: sidebar with GUARDRAILS accent highlight; ALWAYS ON badge
rows (plan approval, diff review); toggle rows (ask before new
dependencies, run tests after each step with the real "3 validation
preset(s) currently loaded" count, allow network off by default); footnote
"guardrails marked ALWAYS ON cannot be disabled — that's the point".

Infra: settings page selection is now persisted (@AppStorage
forge.settingsSection, native remember-last-pane behavior) and the debug
driver can open Settings via the openSettings environment action.

Known gap: the Settings scene shows the system titlebar ("Forge Settings")
above the drawn FORGE — SETTINGS bar; SwiftUI Settings scenes don't honor
hiddenTitleBar. Platform limitation, recorded. Verified.
