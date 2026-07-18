# 20a · Full Plan Approval (exclusive surface)

- Date: 2026-07-18
- SHA: 4dc488d (+ working-tree fixes)
- Window: 1240 review mode; reference section `20a` drawn 1240x655
- Evidence: `20260718T183709Z_4dc488d_Forge.png` (final)

## Deltas fixed

- Right column restructured to the handoff's order: HOW I READ YOUR TASK
  (with real "wrong? rephrase the task" link) → DELIBERATELY OUT OF SCOPE →
  new GUARDRAILS ON THIS RUN (three ✓ lines that accurately state the
  runtime's real boundaries) → APPROVAL MODE (mockup helper copy) →
  full-width black APPROVE & RUN ⌘↵ → REPLAN + red ✗ REJECT row.
  The former VALIDATION AFTER THE RUN block (not in the handoff) was
  removed; REVISE SELECTED STEP now appears only once a step is selected,
  matching "click a step to edit it".
- Header: title wrapped in curly quotes; "planned in Ns" now computed from
  real createdAt → revision.generatedAt elapsed time (was a raw timestamp
  suffix).
- Left column: hint copy "✎ click a step to edit it"; footer swapped to
  risk-left / est-total-right per the mockup.

## Intentional deviations / known gaps

- Step rows show real runtime step status (DONE/PENDING/ACTIVE) where the
  mockup shows per-step "~N min"; the runtime has no per-step estimates.
- "+ ADD A STEP · drag to reorder" and the PRODUCT CALL step badge need
  plan-editing runtime capability that does not exist yet; revision goes
  through select-step → REVISE instead. Logged as a known gap, not faked.
- REJECT returns to the workspace without approving (the runtime has no
  discard-plan endpoint); status line explains the next actions.

## Verdict

Layout, section order, copy, and control set match the handoff with real
data; deviations above are recorded. Verified (with notes).
