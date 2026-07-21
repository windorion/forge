# 23a · Task Share / Collaboration — 2026-07-21

Evidence: `share-popover.png` (in-app share layer, matches the mockup).

Scope (per approved plan): single-user read-only share, distinct from the
"Not Now" team-collaboration track. The in-app popover and the local
link/export are fully real; the hosted teammate viewer is the documented
founder-level infrastructure gap.

Built from Missing:
- `TaskSharePopover` (SharePanelController floating panel): SHARE TASK
  #id header, READ-ONLY LINK row with COPY, "anyone with the link can
  view — plan, diff, tests, log · no code checkout, no Forge install"
  note, WHAT THEY SEE scope toggles (plan & steps / full diff / tests &
  log, each with hint), EXPIRES 24H/7D/30D segmented, REVOKE LINK.
- `ShareLinkManager`: real opaque token generation (12-char), persisted
  share records, revoke (deletes token + export), and a real read-only
  HTML export written from live task data (plan/diff/tests/log honoring
  the selected scopes) into ~/Library/Application Support/Forge/shares.
  COPY writes `https://forge.windorion.com/t/<token>` to the pasteboard
  and generates the export.

Recorded gaps (documented, not faked): the forge.windorion.com hosted
viewer that serves the export and receives teammate comments is a
founder-level server-side decision (out of this plan's scope); the local
HTML export is the honest current artifact. Comment reflux (mockup's
"评论会回流到任务里") depends on that server. Verified (with notes).
