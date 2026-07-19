# 11a · Spotlight — 2026-07-19

Evidence: the DEBUG index log wrote "indexed 9 task(s)" after the live
reindex (CSSearchableIndex accepted all items).

Built from Missing: ForgeSpotlight reindexes every task on refresh
(title, "Forge Task — Status · repo" description, keywords, stable
uniqueIdentifier per task) under a domain identifier, and Spotlight
result activation continues into the app via CSSearchableItemActionType →
task deep link (same route as CLI/notifications/dock). The Spotlight
window is system-rendered; the mockup's dynamic "create task from query"
row was pre-declared a stretch goal and stays out. Verified (with notes).
