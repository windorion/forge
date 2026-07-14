# V0 Scope

Document role: define the first end-to-end product target for Forge so early
implementation has a clear finish line.

Last updated: 2026-07-14

## Scope Reset

The previous V0 target proved the trust/runtime foundation, but it does not
yet make Forge feel like a coding agent product.

From now on, V0 means:

> a local demo where Forge behaves like an agent coding app: task input,
> clarification, plan approval, live code/test stream, self-fix, and full diff
> review.

The old task-to-review flow remains valuable infrastructure, but it is no
longer the product finish line.

## V0 Goal

The user should be able to:

1. Open Forge on a repository.
2. Type a coding task in a first-screen composer.
3. Watch Forge inspect repo context and ask clarifying questions when needed.
4. Review and approve a plan card.
5. Watch the agent run live: read files, edit code, run checks, and react to
   failures.
6. Open Diff and Tests while the run is active.
7. Review a real multi-file source diff with per-file reasoning.
8. Request changes or approve the final patch.
9. Optionally create a local commit from the reviewed output.

## Primary Design Targets

Implement these screens first from `design_handoff_forge/`:

- `1a` New task empty state.
- `1b` Plan approval card.
- `14a` Main running task window.
- `10a` Fullscreen diff review.
- `32a` New session chat-to-task.

Secondary V0-adjacent states:

- `33a` Agent question waiting for answer.
- `19a` Task failed / rollback.
- `24a` First task success.
- `1d` Run complete / PR ready, initially as PR handoff if full PR creation is
  not ready.

## V0 Product Feeling

Forge v0 should feel like:

- a coding agent is actively working
- the user can supervise without micromanaging
- every important side effect is still reviewable
- failures and decisions are visible, not hidden
- the UI is sharp, terminal-adjacent, and developer-first

It should not feel like:

- a generic task dashboard
- a settings-heavy admin panel
- a git preflight demo
- a chat app with cards attached

## V0 Included

- macOS SwiftUI app using the design handoff's layout and visual language
- local TypeScript runtime
- task composer and task session
- repo context search/read tools
- clarification question flow
- plan card and approve/regenerate/edit path
- live agent stream
- plan progress strip
- Log/Diff/Tests tabs
- model-provider-backed normal run path
- reviewed source-file create/modify/delete with exact EOF handling
- crash-time recovery checkpoints for agent loops and compensated
  apply/rollback transactions
- approved task-scoped command runner for checks/tests
- command output streaming into the task
- failed-check self-fix loop
- full-screen diff review with file tree, unified/split mode, per-file
  reasoning, tests covering the file, approve file, and request change
- local commit review after final approval
- runtime persistence and crash-resume basics
- audit trail for tools, patches, commands, approvals, and git actions
- Settings for provider/runtime only as supporting surfaces

## V0 Not Included

- full IDE/editor replacement
- arbitrary shell execution
- silent autonomous commits, pushes, or PRs
- hosted GitHub branch protection/auth/fork fixtures
- multi-task mission control
- command palette, menu bar, widgets, CLI companion
- full repository semantic index
- signed/notarized distribution
- team collaboration

## Completion Criteria

V0 is complete when:

- The first screen asks what Forge should build.
- A user can start a coding task without touching Settings first in the happy
  path.
- Forge can ask a clarification question before planning.
- Forge can produce a plan with steps, expected file areas, tests, risk notes,
  and cost/time estimate.
- Approving the plan starts an agent run.
- The live run shows chronological read/search/edit/test/self-fix events.
- The patch engine can propose and apply a real source-file change inside the
  repo, with rollback action and revalidation.
- The command runner can run an approved project check and stream output.
- A failed check can produce a bounded repair attempt and rerun evidence.
- Diff and Tests tabs update during or immediately after the run.
- Fullscreen diff review can show at least a multi-file source diff with
  file-level reasoning and tests.
- User can request changes and receive a revised patch.
- User can approve the final patch.
- Local commit can be prepared and created after explicit approval.
- No file change, command, commit, push, or PR happens without an explicit
  policy path and audit record.

## Completed State Against V0

Built foundation:

- local runtime and task persistence
- bounded repo context reads
- provider abstraction and OpenAI structured-output path
- plan approval and review gates
- restricted edit proposals
- validation presets and repair briefs
- approved task-scoped command runner with streamed stdout/stderr chunks
- failed task-command repair briefs and review-only self-fix proposals
- provider-selected bounded agent loop for proposal generation, approved
  command execution, validation repair proposal generation, reviewed self-fix
  reruns, human-review pauses, and max-step protection
- git status/diff/commit/push/branch/PR handoff preflights
- app-managed runtime diagnostics
- local smoke coverage
- first-pass macOS session shell with task queue, new-task empty state, live
  agent stream, plan gate/action rail, and Log/Diff/Tests tabs
- first usable full-screen diff review surface with file tree, main diff pane,
  reasoning, validation evidence, and existing proposal apply/request-change
  actions. Validation is split into genuinely file-specific evidence and
  clearly labelled task-wide evidence that is not claimed as file coverage.
- `32a` clarification pauses planning and blocks approval until the active
  questions are answered. The resolving reply automatically creates the plan.
- embedded plans expose steps, expected file areas, validation, risk notes,
  and runtime-derived time/cost estimates in both conversation and plan rail.
- `Approve & Run` records the plan approval and immediately enters the bounded
  Agent Run Loop through a combined runtime endpoint.

Acceptance evidence:

- The UI implements the V0 responsibilities of `1a`, `1b`, `10a`, `14a`, and
  `32a`; additional pixel-level handoff fidelity is post-V0 polish.
- Full-screen diff review now has durable file-level decisions and linked
  request-change revisions, exact aligned split rendering with old/new line
  numbers, proposal-before-Apply preview, and keyboard file/hunk/approval
  navigation. Its validation panel only calls evidence file-specific when the
  command metadata names the selected path or filename; all other results are
  labelled task-wide and are not claimed as file coverage.
- Patch apply now supports exact replacements, multi-hunk text patches, and
  strict context-anchored Unified Diff modifications across reviewed source
  files, reviewed source create/delete, and standard EOF newline markers, with
  verified compensated apply/rollback transactions.
- Command output now has a streamed, cancellable, selectable task-scoped
  surface with reviewed self-fix rerun evidence after apply.
- Provider-backed run loop has bounded multi-step orchestration and
  persisted Strong/Partial/Weak/NoNewContext inspection quality with query
  coverage, matches, new-context, byte totals, per-file hashes, and persisted
  review evidence.
- Agent Loops left `Running` by runtime shutdown now recover at startup as
  `Paused / RuntimeRestarted` checkpoints with finalized transient evidence and
  resumable lineage.
- Apply/Rollback transactions left `Running` by runtime shutdown now recover
  from a versioned per-file write-ahead journal. Apply returns verified files
  to Before; Rollback either finalizes an already-complete rollback or
  compensates a mixed state back to Applied. Unknown hashes fail closed.
- The provider can now choose `InspectRepository`; the runtime safely executes
  bounded read-only list/search/read tools and lets the loop continue into a
  proposal step with persisted evidence. Stable request fingerprints block an
  identical later request before duplicate search/read calls, and the Log shows
  the active inspection budgets.
- Malformed Agent Run Step decisions now get one bounded correction attempt.
  Recovery and exhaustion evidence is persisted, and exhaustion fails closed
  before tools, commands, or edits.
- The live session now exposes cooperative pause/abort/resume controls. Pause
  and abort stop after the current safe step; resume preserves the prior loop
  and creates a linked recovery run.

## Post-V0 Implementation Order

1. Exercise the completed V0 repeatedly on varied real repositories.
2. Extend safe tool choice, query variation, and malformed planning/patch
   recovery for the alpha horizon.
3. Add approved GitHub PR publication and packaged distribution later.
