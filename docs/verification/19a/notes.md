# 19a · Failed / Rollback

- Date: 2026-07-19 · SHA 30b41e9
- Evidence: `20260719T114851Z_30b41e9_Forge.png`
- Driven by a real fail-closed path: an interrupted apply transaction
  (journaled Running state) recovered on runtime startup → task Failed /
  Apply Recovered.

Matches: red FAILED header with real "N failed attempt(s) · apply
recovered" meta, WHAT HAPPENED numbered evidence, AI DIAGNOSIS block with
terminal-style error pane, YOUR REPO IS PRESERVED guarantees, PICK A
DIRECTION radio trio, GENERATE REVIEWED SELF-FIX / KEEP BRANCH / DISCARD
ALL actions (all wired to real runtime actions). Verified.
