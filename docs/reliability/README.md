# Repository Reliability Campaign

Document role: define Forge's repeatable Alpha repository-task reliability
campaign, its pass/fail semantics, and the limits of the resulting evidence.

## Purpose

The campaign exercises the real runtime HTTP lifecycle against isolated Git
repositories rather than calling edit helpers directly. It is intended to
catch cross-service regressions in intake, planning, approval, proposal
generation, safe-edit validation, file review, apply, Git evidence, and audit
export.

The current baseline is stored in:

- `alpha-repository-baseline.json`: machine-readable schema-versioned result
- `alpha-repository-baseline.md`: human-readable scorecard and per-stage
  evidence

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
```

The first command writes temporary reports and removes them with its fixtures.
The baseline command updates the two durable files in this directory. Both
commands exit nonzero for any unexpected case failure.

Pure report aggregation and Markdown rendering are covered by
`scripts/reliability-campaign-test.mjs`; provider follow-up and escaped-quote
parsing regressions are covered by `scripts/model-provider-test.mjs`.

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

## Evidence Boundary

This is a deterministic, repository-shaped regression corpus, not proof of
broad autonomous coding quality. It does not yet cover external repository
histories, large monorepositories, remote OpenAI behavior, arbitrary Unified
Diff generation, project-specific command approval, network tools, merge
conflicts, commits, pushes, or PR publication. Those capabilities retain their
focused smoke coverage, while the next reliability expansion should add a
curated set of real public repositories and provider-backed tasks.
