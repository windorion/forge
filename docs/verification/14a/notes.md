# 14a · Main Window (running-task session)

- Date: 2026-07-19
- SHA: 5145aac (+ working-tree fixes)
- Window: session mode 1380; reference section `14a` drawn 1380x687
- Evidence: `20260719T055912Z_5145aac_Forge.png` (final)

## Deltas fixed

- Plan strip: heading "PLAN — STEP N OF M"; real "Xm elapsed · ~Ym left"
  (hours format past 90m) from createdAt + latest revision estimate; step
  labels numbered lowercase ("01 review clarified intent").
- Live stream: heading "— thinking stream · step N: <active step> —"; rows
  reduced to HH:mm:ss local time + colored message text (tool calls render
  as "tool_name — summary" in status color); bare cursor block on the
  "now" row. Was: bold KIND column + raw ISO time suffixes.
- Sidebar footer: "N running" (live agent-loop count when connected) +
  real "$spend / $cap" from persisted revision estimates and the
  forge.monthlyBudgetCap setting. Was: runtime-state word + version.
- Sidebar composer placeholder fixed earlier ("describe a task… (↵ to
  plan)").

## Intentional deviations

- MISSION CONTROL / QUEUE / HISTORY navigation rows stay in the sidebar
  (real entry points to surfaces the mockup reaches other ways).
- FULL DIFF / AUDIT header buttons stay (real entries to 10a/2b).
- Local deterministic provider echoes the objective as assistant text, so
  the stream's first rows repeat the same sentence — data artifact, not UI.

## Verdict

Layout, stream format, progress strip, and sidebar match the handoff with
real data. Verified (with notes).
