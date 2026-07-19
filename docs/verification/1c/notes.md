# 1c · Blocked — Needs Your Decision

- Date: 2026-07-19 · SHA 9775dd3 (+fixes)
- Window: compact 980x520; reference 980x473
- Evidence: `20260719T061634Z_9775dd3_Forge.png` (final)
- Driven via the real loop: approve & run → proposal Proposed → one more
  agent step → provider returns WaitForHumanReview → NeedsDecisionState.

Deltas fixed: header now "paused at step N of M · Xm elapsed" (real);
footnote now "▸ blocked Xm · the agent never guesses on architecture — it
asks" (real duration since the blocking step).

Notes: A/B options are provider-generated (recommendation + safer
alternative) — real data; the mockup's illustrative Redis-vs-LRU copy is
scenario content, not spec. Verified.
