# Documentation Truth

Document role: define which Forge artifacts are authoritative for current
status, how duplicated headline facts stay synchronized, and why a GitHub
default-branch page can temporarily lag an active task branch.

Last updated: 2026-08-08

## Authority Order

Use the smallest authoritative artifact for each fact:

1. executable manifests, tests, and versioned JSON baselines for measured
   engineering facts;
2. `docs/design_handoff_coverage.md` and its rendered evidence for screen
   status;
3. `docs/project_status.md` for the detailed current product snapshot;
4. `docs/todo.md` for active priorities;
5. `README.md` for the compact public summary.

Historical session entries and old commits remain immutable records. They are
not current-status sources.

## Automated Check

Run from the repository root:

```bash
node script/check_documentation_truth.mjs
```

Or from `runtime/`:

```bash
npm run check:docs
```

The check currently verifies:

- shared update dates for the four critical status documents;
- matching readiness estimates between README and project status;
- the 43-screen handoff status distribution and five verified primary screens;
- both versioned reliability baselines and their headline scorecards;
- runtime route, smoke-script, and unit-test-file counts; and
- removal of known completed work from README future claims and active P0 TODOs.

GitHub Actions runs the same check. Add a new assertion when a repeatedly
duplicated fact becomes important enough that silent drift would mislead a
reader.

## Branch And GitHub Page Boundary

GitHub renders the README from the branch selected in the branch picker. A
commit pushed to `codex/alpha-runtime-controls` does not change the README shown
for `main`; the default-branch page updates only after that branch is merged or
the same commit is otherwise integrated into `main`.

Documentation can therefore be current on the task branch while the public
default-branch page is older. Always compare the selected branch and commit
before treating the GitHub page as contradictory evidence. Publishing or
merging remains a separate repository action from editing the documents.
