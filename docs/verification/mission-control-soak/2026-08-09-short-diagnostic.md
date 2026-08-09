# Mission Control Soak — Short Diagnostic

This is a pipeline diagnostic, not the outstanding six-hour evidence.

- Status: **Passed**
- Started: 2026-08-09T08:14:15.655Z
- Ended: 2026-08-09T08:14:25.527Z
- Requested soak window: 3 seconds
- Actual full fixture elapsed: 9.872 seconds
- Environment: Node v22.18.0, Darwin 25.3.0, arm64
- Power note: AC power; short diagnostic run; sleep unchanged
- Repositories: 2
- Tasks: 3 per repository, 6 held before the first grant
- Grant order: alpha → beta → alpha → beta → alpha → beta
- Restart injection while draining: 2
- Soak restart cycles: 11
- Final running/queued: 0 / 0
- Stale authorization rejection, startup hold, and no-starvation oracle: passed

The same run wrote schema-v1 JSON and Markdown under a temporary evidence
directory. A separate sandbox-denied run failed to bind loopback, wrote a
Failed report with the complete error/runtime output, and preserved its fixture
root; this verified the failure-artifact path before the successful local
loopback run.
