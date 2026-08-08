# Forge Alpha Mock-OpenAI Provider Reliability Baseline

Generated: 2026-08-08T19:32:17.913Z
Provider: OpenAI Responses compatible mock
Provider mode: mock-remote
Campaign status: Passed

## Scorecard

- Cases: 4
- Cases passed: 3
- Negative controls guarded: 1
- Unexpected failures: 0
- Provider requests: 37
- Scored-stage pass rate: 100.0%
- Duration: 11.54 s

## Cases

| Case | Category | Expected | Result | Provider calls | Operations | Commands | Changed files | Duration |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| OpenAI context-guided two-file Unified Diff | provider-edit | Applied | Passed | 8 | UnifiedDiff, UnifiedDiff | — | src/greeting.test.ts, src/greeting.ts | 2.79 s |
| OpenAI-selected approved project command | provider-command | CommandPassed | Passed | 9 | UnifiedDiff | Passed | runtime/src/math.ts | 2.91 s |
| OpenAI unapproved command safety guard | provider-negative-control | Guarded | Guarded | 9 | UnifiedDiff | — | — | 2.78 s |
| OpenAI command failure, reviewed repair, and rerun | provider-recovery | RepairVerified | Passed | 11 | UnifiedDiff | Failed, Passed | runtime/src/broken.ts | 3.06 s |

### OpenAI context-guided two-file Unified Diff

Outcome: Passed.
Provider calls: forge_edit_proposal=1, forge_execution_proposal=1, forge_intent_brief=2, forge_plan_context_request=2, forge_plan_revision=2.

| Stage | Status | Duration | Evidence |
| --- | --- | --- | --- |
| fixture | Passed | 40 ms | Initialized an isolated committed repository with 3 files. |
| mock-provider | Passed | 4 ms | Started a loopback OpenAI Responses-compatible strict-schema mock. |
| runtime | Passed | 114 ms | provider=openai; remoteEndpoint=loopback-mock; apiCost=0 |
| index | Passed | 23 ms | Indexed 3 changed and 0 unchanged files. |
| intake | Passed | 2.42 s | planProvider=openai; planRevisions=2 |
| provider-contract | Passed | 0 ms | forge_intent_brief=2; forge_plan_revision=2; forge_plan_context_request=2 |
| context-evidence | Passed | 0 ms | src/greeting.ts; src/greeting.test.ts; README.md |
| plan-approval | Passed | 13 ms | executionContextFiles=3 |
| proposal | Passed | 6 ms | UnifiedDiff; UnifiedDiff |
| proposal-validation | Passed | 3 ms | Validation passed for 2 proposed file change(s). |
| file-review | Passed | 3 ms | Approved every provider-proposed file individually before mutation. |
| apply | Passed | 9 ms | Applied the reviewed Unified Diff transaction and passed built-in validation. |
| command-approval | Skipped | 0 ms | This provider-edit case does not run a project command. |
| command-run | Skipped | 0 ms | This provider-edit case does not run a project command. |
| repair-brief | Skipped | 0 ms | No repair was expected for the passing provider-edit case. |
| repair-proposal | Skipped | 0 ms | No repair was expected for the passing provider-edit case. |
| repair-apply | Skipped | 0 ms | No repair was expected for the passing provider-edit case. |
| repair-rerun | Skipped | 0 ms | No repair was expected for the passing provider-edit case. |
| git-evidence | Passed | 51 ms | Modified:src/greeting.test.ts; Modified:src/greeting.ts |
| oracle | Passed | 0 ms | Independent file-content oracle verified the expected repository state. |
| audit-export | Passed | 3 ms | Exported redacted JSON and Markdown audit evidence without provider credentials. |

### OpenAI-selected approved project command

Outcome: Passed.
Provider calls: forge_agent_run_step=1, forge_edit_proposal=1, forge_execution_proposal=1, forge_intent_brief=2, forge_plan_context_request=2, forge_plan_revision=2.

| Stage | Status | Duration | Evidence |
| --- | --- | --- | --- |
| fixture | Passed | 53 ms | Initialized an isolated committed repository with 5 files. |
| mock-provider | Passed | 1 ms | Started a loopback OpenAI Responses-compatible strict-schema mock. |
| runtime | Passed | 106 ms | provider=openai; remoteEndpoint=loopback-mock; apiCost=0 |
| index | Passed | 25 ms | Indexed 5 changed and 0 unchanged files. |
| intake | Passed | 2.41 s | planProvider=openai; planRevisions=2 |
| provider-contract | Passed | 0 ms | forge_intent_brief=2; forge_plan_revision=2; forge_plan_context_request=2 |
| context-evidence | Passed | 0 ms | runtime/src/math.ts; runtime/tsconfig.json; runtime/package.json; README.md |
| plan-approval | Passed | 9 ms | executionContextFiles=4 |
| proposal | Passed | 4 ms | UnifiedDiff |
| proposal-validation | Passed | 2 ms | Validation passed for 1 proposed file change(s). |
| file-review | Passed | 1 ms | Approved every provider-proposed file individually before mutation. |
| apply | Passed | 8 ms | Applied the reviewed Unified Diff transaction and passed built-in validation. |
| command-approval | Passed | 3 ms | Proved blocked-before-approval and runnable-after-approval command states. |
| command-run | Passed | 149 ms | status=Passed; exitCode=0 |
| repair-brief | Skipped | 0 ms | The approved project command passed; no repair lineage was needed. |
| repair-proposal | Skipped | 0 ms | The approved project command passed; no repair lineage was needed. |
| repair-apply | Skipped | 0 ms | The approved project command passed; no repair lineage was needed. |
| repair-rerun | Skipped | 0 ms | The approved project command passed; no repair lineage was needed. |
| git-evidence | Passed | 36 ms | Modified:runtime/src/math.ts |
| oracle | Passed | 0 ms | Independent file-content oracle verified the expected repository state. |
| audit-export | Passed | 3 ms | Exported redacted JSON and Markdown audit evidence without provider credentials. |

### OpenAI unapproved command safety guard

Outcome: Guarded.
Provider calls: forge_agent_run_step=1, forge_edit_proposal=1, forge_execution_proposal=1, forge_intent_brief=2, forge_plan_context_request=2, forge_plan_revision=2.

| Stage | Status | Duration | Evidence |
| --- | --- | --- | --- |
| fixture | Passed | 56 ms | Initialized an isolated committed repository with 5 files. |
| mock-provider | Passed | 0 ms | Started a loopback OpenAI Responses-compatible strict-schema mock. |
| runtime | Passed | 107 ms | provider=openai; remoteEndpoint=loopback-mock; apiCost=0 |
| index | Passed | 23 ms | Indexed 5 changed and 0 unchanged files. |
| intake | Passed | 2.41 s | planProvider=openai; planRevisions=2 |
| provider-contract | Passed | 0 ms | forge_intent_brief=2; forge_plan_revision=2; forge_plan_context_request=2 |
| context-evidence | Passed | 0 ms | runtime/src/guard.ts; runtime/tsconfig.json; runtime/package.json; README.md |
| plan-approval | Passed | 11 ms | executionContextFiles=4 |
| proposal | Passed | 4 ms | UnifiedDiff |
| proposal-validation | Passed | 2 ms | Validation passed for 1 proposed file change(s). |
| file-review | Skipped | 0 ms | The negative control intentionally leaves the valid proposal awaiting human review. |
| apply | Skipped | 0 ms | The negative control must not mutate the repository. |
| command-approval | Passed | 1 ms | Intentionally withheld the medium-risk command preset approval. |
| command-run | Passed | 7 ms | Runtime rejected the provider-selected unapproved command and waited for human review without a process side effect. |
| repair-brief | Skipped | 0 ms | The unsafe command never ran, so no failure repair lineage was created. |
| repair-proposal | Skipped | 0 ms | The unsafe command never ran, so no failure repair lineage was created. |
| repair-apply | Skipped | 0 ms | The unsafe command never ran, so no failure repair lineage was created. |
| repair-rerun | Skipped | 0 ms | The unsafe command never ran, so no failure repair lineage was created. |
| git-evidence | Passed | 53 ms |  |
| oracle | Passed | 0 ms | Independent file-content oracle verified the expected repository state. |
| audit-export | Passed | 3 ms | Exported redacted JSON and Markdown audit evidence without provider credentials. |

### OpenAI command failure, reviewed repair, and rerun

Outcome: Passed.
Provider calls: forge_agent_run_step=2, forge_edit_proposal=1, forge_execution_proposal=1, forge_intent_brief=2, forge_plan_context_request=2, forge_plan_revision=2, forge_validation_repair_brief=1.

| Stage | Status | Duration | Evidence |
| --- | --- | --- | --- |
| fixture | Passed | 44 ms | Initialized an isolated committed repository with 5 files. |
| mock-provider | Passed | 0 ms | Started a loopback OpenAI Responses-compatible strict-schema mock. |
| runtime | Passed | 106 ms | provider=openai; remoteEndpoint=loopback-mock; apiCost=0 |
| index | Passed | 23 ms | Indexed 5 changed and 0 unchanged files. |
| intake | Passed | 2.41 s | planProvider=openai; planRevisions=2 |
| provider-contract | Passed | 0 ms | forge_intent_brief=2; forge_plan_revision=2; forge_plan_context_request=2 |
| context-evidence | Passed | 0 ms | runtime/src/broken.ts; runtime/tsconfig.json; runtime/package.json; README.md |
| plan-approval | Passed | 14 ms | executionContextFiles=3 |
| proposal | Skipped | 0 ms | This recovery case begins with an approved command failure before any edit proposal. |
| proposal-validation | Skipped | 0 ms | This recovery case begins with an approved command failure before any edit proposal. |
| file-review | Skipped | 0 ms | This recovery case begins with an approved command failure before any edit proposal. |
| apply | Skipped | 0 ms | This recovery case begins with an approved command failure before any edit proposal. |
| command-approval | Passed | 5 ms | Proved blocked-before-approval and runnable-after-approval command states. |
| command-run | Passed | 163 ms | status=Failed; exitCode=2 |
| repair-brief | Passed | 0 ms | source=TaskCommandRun; risk=Medium |
| repair-proposal | Passed | 6 ms | Generated, validated, and per-file approved a repair-linked Unified Diff. |
| repair-apply | Passed | 5 ms | Applied the reviewed self-fix and created linked rerun evidence. |
| repair-rerun | Passed | 139 ms | source=Failed; rerun=Passed; evidence=Passed |
| git-evidence | Passed | 37 ms | Modified:runtime/src/broken.ts |
| oracle | Passed | 0 ms | Independent file-content oracle verified the expected repository state. |
| audit-export | Passed | 3 ms | Exported redacted JSON and Markdown audit evidence without provider credentials. |

## Interpretation

This baseline exercises the production OpenAI Responses adapter against a loopback mock that returns strict-schema artifacts. It proves request shaping, context/tool mediation, provider-output normalization, review gates, no-shell command policy, repair lineage, and audit persistence without sending repository data to an external service or incurring API cost. It does not measure real-model coding quality.
