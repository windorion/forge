# Forge Alpha Repository Reliability Baseline

Generated: 2026-08-08T19:07:10.317Z
Provider: local-deterministic
Campaign status: Passed

## Scorecard

- Cases: 4
- Applied cases passed: 3
- Negative controls guarded: 1
- Unexpected failures: 0
- Stage pass rate: 100.0%
- Duration: 3.82 s

## Cases

| Case | Category | Language | Expected | Result | Operation | Changed files | Duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TypeScript arithmetic bugfix | code-bugfix | TypeScript | Applied | Passed | ReplaceText | src/calculator.ts | 367 ms |
| Python two-hunk normalization refactor | code-refactor | Python | Applied | Passed | PatchText | src/slugify.py | 2.76 s |
| Documentation append | documentation | Markdown | Applied | Passed | AppendText | docs/usage.md | 344 ms |
| Ambiguous replacement safety guard | negative-control | TypeScript | Guarded | Guarded | ReplaceText | — | 348 ms |

### TypeScript arithmetic bugfix

Outcome: Passed.

| Stage | Status | Duration | Evidence |
| --- | --- | --- | --- |
| fixture | Passed | 42 ms | Initialized isolated Git repository with 3 tracked files. |
| runtime | Passed | 125 ms | workspace=isolated-git-repository; provider=local-deterministic |
| index | Passed | 23 ms | Indexed 3 changed and 0 unchanged files. |
| intake | Passed | 9 ms | planRevisions=1; clarification=resolved |
| plan | Passed | 4 ms | Generated plan revision 2 from a resolved file reference. |
| approval | Passed | 7 ms | Approved the plan and retained a human approval plus execution proposal. |
| proposal | Passed | 3 ms | revision=1; repairAttempts=0 |
| proposal-validation | Passed | 2 ms | Validation passed for 1 proposed file change(s). |
| file-review | Passed | 1 ms | Approved every proposed file individually before mutation. |
| apply | Passed | 6 ms | Applied the reviewed edit and passed built-in post-apply validation. |
| git-evidence | Passed | 41 ms | Modified:src/calculator.ts |
| oracle | Passed | 0 ms | External content oracle verified src/calculator.ts. |
| audit-export | Passed | 2 ms | jsonSchemaVersion=1; markdownEventTimeline=true |

### Python two-hunk normalization refactor

Outcome: Passed.

| Stage | Status | Duration | Evidence |
| --- | --- | --- | --- |
| fixture | Passed | 52 ms | Initialized isolated Git repository with 3 tracked files. |
| runtime | Passed | 106 ms | workspace=isolated-git-repository; provider=local-deterministic |
| index | Passed | 22 ms | Indexed 3 changed and 0 unchanged files. |
| intake | Passed | 2.40 s | planRevisions=1; clarification=not-needed |
| plan | Passed | 7 ms | Generated plan revision 2 from a resolved file reference. |
| approval | Passed | 9 ms | Approved the plan and retained a human approval plus execution proposal. |
| proposal | Passed | 4 ms | revision=1; repairAttempts=0 |
| proposal-validation | Passed | 1 ms | Validation passed for 1 proposed file change(s). |
| file-review | Passed | 2 ms | Approved every proposed file individually before mutation. |
| apply | Passed | 7 ms | Applied the reviewed edit and passed built-in post-apply validation. |
| git-evidence | Passed | 52 ms | Modified:src/slugify.py |
| oracle | Passed | 0 ms | External content oracle verified src/slugify.py. |
| audit-export | Passed | 2 ms | jsonSchemaVersion=1; markdownEventTimeline=true |

### Documentation append

Outcome: Passed.

| Stage | Status | Duration | Evidence |
| --- | --- | --- | --- |
| fixture | Passed | 46 ms | Initialized isolated Git repository with 2 tracked files. |
| runtime | Passed | 107 ms | workspace=isolated-git-repository; provider=local-deterministic |
| index | Passed | 21 ms | Indexed 2 changed and 0 unchanged files. |
| intake | Passed | 7 ms | planRevisions=1; clarification=resolved |
| plan | Passed | 2 ms | Generated plan revision 2 from a resolved file reference. |
| approval | Passed | 7 ms | Approved the plan and retained a human approval plus execution proposal. |
| proposal | Passed | 3 ms | revision=1; repairAttempts=0 |
| proposal-validation | Passed | 1 ms | Validation passed for 1 proposed file change(s). |
| file-review | Passed | 1 ms | Approved every proposed file individually before mutation. |
| apply | Passed | 6 ms | Applied the reviewed edit and passed built-in post-apply validation. |
| git-evidence | Passed | 39 ms | Modified:docs/usage.md |
| oracle | Passed | 0 ms | External content oracle verified docs/usage.md. |
| audit-export | Passed | 3 ms | jsonSchemaVersion=1; markdownEventTimeline=true |

### Ambiguous replacement safety guard

Outcome: Guarded.

| Stage | Status | Duration | Evidence |
| --- | --- | --- | --- |
| fixture | Passed | 50 ms | Initialized isolated Git repository with 2 tracked files. |
| runtime | Passed | 106 ms | workspace=isolated-git-repository; provider=local-deterministic |
| index | Passed | 22 ms | Indexed 2 changed and 0 unchanged files. |
| intake | Passed | 7 ms | planRevisions=1; clarification=resolved |
| plan | Passed | 3 ms | Generated plan revision 2 from a resolved file reference. |
| approval | Passed | 7 ms | Approved the plan and retained a human approval plus execution proposal. |
| proposal | Passed | 7 ms | revision=3; repairAttempts=2 |
| proposal-validation | Passed | 1 ms | Validation blocked 1 of 1 proposed file change(s). |
| file-review | Skipped | 0 ms | Unsafe proposal was not offered for approval. |
| apply | Skipped | 0 ms | Blocked proposal was not applied. |
| git-evidence | Passed | 41 ms |  |
| oracle | Passed | 0 ms | External content oracle verified src/repeated.ts. |
| audit-export | Passed | 3 ms | jsonSchemaVersion=1; markdownEventTimeline=true |

## Interpretation

An applied case passes only when the reviewed edit is applied, Git reports exactly the expected file set, the external content oracle passes, and both JSON and Markdown audit exports contain the task evidence. A guarded negative control passes only when proposal validation blocks the unsafe edit and the repository remains unchanged.
