# 4a · Mission Control — 2026-07-19 · SHA c84e96b (+fix)

Evidence: `20260719T171009Z_c84e96b_Forge.png` (post-dedup; the earlier
capture shows the duplicate-registration bug). Real three-column surface:
aggregate header ("0 AGENTS RUNNING · 4 waiting for you · 0 queued · 1
ready"), PAUSE ALL / NEW TASK, per-repo columns with live state badges
(CONNECTING observer with 3-day-old cached task cards; NEEDS YOU with
live task cards including progress bars), empty ADD REPOSITORY slot,
read-only/authorization footnotes.

Fixed en route: repositories registered under trailing-slash path
variants deduplicate (normalized registration).

Routing: task cards call openTask (current repo) or
activateMissionControlRepositoryForTask (pending-select + repository
switch) — the mechanism verified on the current-repo path; a live
second-runtime click-through awaits a genuine multi-runtime session and
is recorded, not faked. Verified (with notes).
