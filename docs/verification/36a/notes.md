# 36a · Task Templates Library — 2026-07-19 · SHA ff66a27

Evidence: `20260719T171710Z_ff66a27_Forge.png`.

Built from Missing: local template store (UserDefaults JSON, four seeded
real-use templates), exclusive TEMPLATES surface with search + "N
templates · N runs total" header + NEW TEMPLATE, two-column card grid
(glyph block, summary, runs/last/effort meta, selected accent+shadow),
detail pane (placeholder-highlighted task text, PRESETS BAKED IN read
from real settings/runtime — model, effort, guardrails, current repo,
RECENT RUNS tied to real task IDs), USE TEMPLATE → dismiss + prefill
both composers via forgePrefillComposer, EDIT/DELETE/CREATE forms, and
the plan-gate footnote. Menu entry added (Forge ▸ Task Templates); driven
via the templates debug spec.

Deviations recorded: placeholder chips render as ⟦token⟧ accent text
(SwiftUI Text cannot inline background chips pre-macOS 15); glyph set is
emoji rather than the mockup's letterforms. Verified (with notes).
