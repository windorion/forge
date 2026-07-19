# 1d · Run Complete — PR Ready

- Date: 2026-07-19 · SHA 9775dd3 (+fixes)
- Window: compact 980x520; reference 980x372
- Evidence: `20260719T061641Z_9775dd3_Forge.png` (final)
- Driven via the real loop: per-file review approved → apply-edit-proposal
  → validation passed → Completed.

Deltas fixed: header "#id · finished in Xm" (real elapsed); TESTS detail
"N runs · M self-fix"; file stats follow the filename per mockup; branch
name bold-ink in the footer. Runtime fix: git status parser returned the
sentence "No commits yet on main" as the branch — now yields the real
branch name (server.ts parseGitBranchLine).

Known gaps: per-file +N −N stats are zero for proposal-only entries;
"OPEN PR ON GITHUB" prepares the local PR review (hosted publication is
P2). Verified.
