# 29a · Offline

- Date: 2026-07-19 · SHA 30b41e9 (+fixes)
- Evidence: `20260719T074714Z_30b41e9_Forge.png` (final, with cached tasks)

Fixed en route: mid-session runtime disconnects now trigger offline
detection (event-stream end/error refreshes runtime health — previously
the app kept showing RUNNING after the runtime died); frozen-stream
timestamps render as HH:mm:ss.

Matches: OFFLINE banner with RETRY NOW, cached task list (LOCAL/CACHED
badges with per-task offline meta), WAITING FOR NETWORK header,
STILL WORKS OFFLINE / WAITING ON RECONNECT capability cards, frozen
thinking stream with real events, checkpointed footer. Verified.
