# Repository Reliability Campaign

Document role: define Forge's repeatable Alpha repository-task reliability
campaign, its pass/fail semantics, and the limits of the resulting evidence.

## Purpose

The campaign exercises the real runtime HTTP lifecycle against isolated Git
repositories rather than calling edit helpers directly. It is intended to
catch cross-service regressions in intake, planning, approval, proposal
generation, safe-edit validation, file review, apply, Git evidence, and audit
export.

The deterministic local-provider baseline is stored in:

- `alpha-repository-baseline.json`: machine-readable schema-versioned result
- `alpha-repository-baseline.md`: human-readable scorecard and per-stage
  evidence

The OpenAI adapter protocol baseline is stored separately in:

- `alpha-provider-baseline.json`: machine-readable schema-versioned result
- `alpha-provider-baseline.md`: human-readable provider/request, review-gate,
  command, repair, and audit evidence

## Corpus

Each run creates and commits a new isolated Git repository for every case,
starts a separate local Forge runtime with its own SQLite/settings/queue state,
and removes the fixture after reporting.

| Case | Proof | Expected result |
| --- | --- | --- |
| TypeScript arithmetic bugfix | One exact source replacement | Applied |
| Python normalization refactor | Two ordered source hunks, including escaped quotes inside the instruction | Applied |
| Markdown documentation note | Bounded append preserving the original prefix | Applied |
| Ambiguous TypeScript replacement | The same find text occurs twice | Guarded without mutation |

The provider-protocol corpus runs the production OpenAI Responses adapter
against a loopback strict-schema mock. It covers a context-guided two-file
Unified Diff, a provider-selected approved project command, an unapproved
command negative control, and command failure followed by a reviewed repair
proposal and linked rerun.

## Stages And Success Semantics

The ordered stages are fixture, runtime, index, intake, plan, approval,
proposal, proposal validation, file review, apply, Git evidence, external
oracle, and audit export.

An applied case passes only when:

1. the referenced path resolves and the task reaches plan review, including a
   real clarification round when required;
2. plan approval and per-file edit approval are persisted;
3. the proposal has the expected operation and passes runtime validation;
4. apply completes and the built-in post-apply validation passes;
5. runtime Git status contains exactly the expected changed file;
6. an independent file-content oracle passes; and
7. JSON and Markdown audit exports contain the task and approval timeline.

A guarded case passes only when proposal validation blocks the unsafe edit,
file review and apply are skipped, Git remains clean, the original content is
unchanged, and audit export still works. Expected blocking is reported as
`Guarded`, not as a campaign failure.

## Running It

From `runtime/`:

```bash
npm run campaign:reliability
npm run campaign:reliability:baseline
npm run campaign:provider-reliability
npm run campaign:provider-reliability:baseline
```

The non-baseline commands write temporary reports and remove them with their
fixtures. The baseline commands intentionally update the matching durable
files in this directory. Every command exits nonzero for an unexpected case
failure.

Pure report aggregation and Markdown rendering are covered by
`scripts/reliability-campaign-test.mjs` and
`scripts/provider-reliability-campaign-test.mjs`; provider follow-up,
repair-context, and escaped-quote parsing regressions are covered by
`scripts/model-provider-test.mjs`.

## Current Baseline And Findings

The 2026-08-08 baseline passes all three applied tasks and the guarded negative
control with no unexpected failure and a 100% scored-stage pass rate.

The first failing baselines found two runtime reliability defects that were
fixed before recording the passing baseline:

- a bounded referenced follow-up could reopen a generic validation
  clarification after the task already had resolved intent and a plan;
- exact replacement instructions containing escaped quotes, common in source
  strings, were split at the inner quote and repeatedly produced a blocked
  patch.

The 2026-08-08 provider-protocol baseline records three passed cases, one
correctly guarded negative control, zero unexpected failures, 37 strict-schema
provider requests, and a 100% scored-stage pass rate. Its failing iterations
found a third production defect: a first command-sourced repair proposal had
no previous proposal or ordinary validation feedback, so prompt construction
returned early and omitted the dedicated repair-brief object. The provider now
receives the complete repair lineage, including command IDs, likely cause,
recommended actions, follow-up prompt, and risk.

## Evidence Boundary

These are deterministic, repository-shaped regression corpora, not proof of
broad autonomous coding quality. The provider campaign proves production
adapter request shaping and runtime enforcement without an external API call
or API cost; its scripted mock does not measure real-model quality. Neither
baseline yet covers large external histories, monorepositories, live OpenAI
behavior, network tools, merge conflicts, commits, pushes, or PR publication.
The next evidence layer should pin a curated set of public repositories and
run budgeted live-provider tasks while keeping those results separate from the
deterministic baselines.
