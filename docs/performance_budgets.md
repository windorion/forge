# Performance And Resource Budgets

Document role: define Forge's repeatable runtime performance measurements,
budget semantics, fixture profiles, CI gate, and evidence limitations.

Last updated: 2026-08-11

## Purpose

Performance is a product boundary, not an anecdotal stopwatch result. Forge
must remain responsive while it retains local task evidence, indexes repository
context, prepares Git review, and runs the bounded agent loop. The performance
campaign turns those paths into versioned JSON and Markdown evidence without a
remote model, external network access, UI automation, or mutation of the Forge
worktree.

The first slice measures the TypeScript runtime. Signed application launch,
SwiftUI frame behavior, energy impact, and packaged app/runtime memory remain
separate P6 evidence because development-checkout numbers cannot prove the
signed product.

## Measured Paths

| Metric ID | What is measured | Boundary |
| --- | --- | --- |
| `runtime.cold_start` | Spawn to a validated `GET /health` response | Includes SQLite open/migrations and retained-task load. |
| `runtime.idle_rss` | Resident memory sampled from the isolated runtime child | MiB from `ps`; fixture and host are recorded. |
| `runtime.idle_cpu` | CPU percentage after startup activity is allowed to decay | Advisory because host scheduling and `ps` semantics vary. |
| `database.task_list` | Parsed `GET /tasks` with retained task snapshots | Includes loopback HTTP, serialization, transfer, and JSON decode. |
| `repository.index_cold` | First `POST /index/rebuild` | Includes file scan, metadata, symbol extraction, trigrams, and SQLite writes. |
| `repository.index_warm` | Unchanged incremental index rebuild | Proves unchanged files do not repeat full indexing work. |
| `git.status` | Parsed `GET /git/status` after a tracked change | Uses the production bounded Git command path. |
| `git.diff` | Parsed bounded `GET /git/diff` for one tracked file | Includes status refresh plus staged/unstaged diff collection. |
| `agent.step` | One local deterministic `run-agent-step` after plan preparation | Setup is excluded; provider decision, runtime gates, and safe checkpoint are included. |

Every metric stores its bounded raw samples plus min, mean, p50, p95, and max
so percentile evidence can be recomputed. Reports do not include machine
process logs or repository content.

## Fixture Profiles

The authoritative configuration is `runtime/performance-budgets.json`.

- `smoke`: 40 source modules, 20 retained tasks, short sample counts. This is
  the hosted CI guardrail.
- `standard`: 200 source modules and 100 retained tasks. This is the routine
  developer comparison profile.
- `large`: 600 source modules and 400 retained tasks. This is a manual stress
  profile, not a claim about all large real repositories.

Each run creates a fresh temporary Git repository and SQLite store, uses a
random loopback port, forces the local deterministic provider, and deletes the
fixture afterward unless `--keep-fixture` is explicit. It never contacts
GitHub or OpenAI.

## Commands

From `runtime/`:

```bash
npm run performance:smoke
npm run performance:standard
npm run performance:large
```

Results default to the ignored
`.forge/performance-results/<profile>-<timestamp>/` directory. A CI or audit
caller can choose a durable destination:

```bash
npm run performance:smoke -- --output /tmp/forge-performance
```

Compare a new run with a prior report from the same profile:

```bash
node scripts/performance-campaign.mjs \
  --profile standard \
  --enforce \
  --baseline /path/to/runtime-performance.json \
  --output /tmp/forge-performance-comparison
```

Baseline comparison fails only when the configured percentage allowance and
absolute noise floor are both exceeded. Profile, platform, architecture, or
Node-major mismatches fail closed instead of producing a misleading trend.

## Budget Semantics

Budgets have a statistic, maximum, severity, and rationale:

- `hard`: a missing or exceeded metric fails an enforced campaign. Hard limits
  are deliberately broad enough for heterogeneous hosted macOS runners and
  primarily catch hangs, runaway memory, accidental full-work repetition, or
  order-of-magnitude regressions.
- `advisory`: the report shows the miss but does not fail the campaign. Idle
  CPU/memory targets remain advisory where host scheduling or the missing
  signed-package boundary makes a narrow hard limit dishonest.

An enforced campaign also fails a real baseline regression. It does not fail
an improvement, stable result, or missing optional baseline metric. Budget
configuration is copied into every output directory so evidence remains
interpretable after the repository changes.

## CI Evidence

`.github/workflows/runtime-performance.yml` runs the `smoke` profile on the
hosted macOS runner with Node 22. It uploads the JSON report, Markdown report,
and exact budget snapshot even when the gate fails. CI does not overwrite a
durable baseline: baseline refresh is an explicit reviewed action, not a side
effect of a passing build.

The campaign evaluator has direct unit tests for percentile calculation,
invalid samples, missing metrics, hard versus advisory gates, baseline noise,
and Markdown output. The end-to-end campaign exercises the production runtime,
SQLite store, repository index, Git services, HTTP routes, and local provider.

## Interpretation And Remaining Work

Synthetic fixtures make regressions repeatable, but they do not represent
monorepo topology, generated files, huge histories, Git LFS, slow disks, or
real developer task payloads. The next performance slices are:

1. run the `standard` and `large` profiles on pinned representative public
   repositories without changing the fixture-independent report schema;
2. add signed-package app launch, combined app/runtime RSS, idle energy, and
   interactive SwiftUI evidence;
3. add incremental-index churn and larger retained event/tool/output payloads;
4. derive tighter platform-specific targets from repeated evidence rather
   than lowering ceilings after one fast machine run.

No single local run changes a readiness estimate by itself. Progress comes
from repeatable gates, archived evidence, and remediation of measured
regressions.
