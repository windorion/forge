# 31a · Crash Recovery

- Date: 2026-07-19 · SHA 30b41e9
- Evidence: `20260719T114848Z_30b41e9_Forge.png`
- Driven by the real startup-recovery path (same injected interrupted
  apply transaction as 19a): runtime restart emitted
  edit.proposal.apply.startup_recovered and the app opened the recovery
  state.

Matches: "Forge quit unexpectedly. Your work didn't." headline with ↻
badge, RECOVERED FROM CHECKPOINTS row (real task id/title, "apply
recovered", FULL badge), black REVIEW explainer bar, RESUME ALL / REVIEW
FIRST actions, send-crash-report checkbox. Verified.
