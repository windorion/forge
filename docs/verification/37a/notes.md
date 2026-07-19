# 37a · Task Cost Breakdown

- Date: 2026-07-19 · SHA 7b00203 (+view)
- Evidence: `20260719T125515Z_7b00203_Forge.png` (two-step task)

Built this pass: TaskCostBreakdownView as a new exclusive surface
(1100x663 cost window mode): COST titlebar, TASK TOTAL block with real
meta (status · runtime · steps · calls · provider) and metric trio,
COST BY STEP proportional bar with heaviest highlight, per-step accordion
rows (calls · model · $) expanding to per-call lines, insight footer, and
a real EXPORT CSV (NSSavePanel; step/action/calls/model/cost columns).
Driven via the new cost:<taskID> debug spec.

Honest-data notes: local provider costs are genuinely $0.00 and per-step
cost is apportioned from the revision estimate by call count; token
columns are omitted (no token accounting yet — same substitution recorded
for 16a). Step labels map runtime actions to the mockup vocabulary. An
in-app entry point (clicking the cost metric on 1d/16a) is still to wire;
the surface itself is real and reachable. Verified (with notes).
