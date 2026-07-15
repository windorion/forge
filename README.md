# Forge

> A macOS-native, agent-first, local-first software engineering workspace.

Forge is not an AI IDE clone or a chat wrapper. It is a task-centered workspace
where agents inspect a local repository, plan work, propose changes, run
validation, and stop at human review gates before important side effects.

Former codename: Atlas.

## Start Here

This README is now the compact project index. Detailed product memory lives in
`docs/`, and session history lives in `docs/session_log.md`.

Read these first:

- `docs/project_status.md`: current state, completion estimate, and distance to finished product.
- `docs/todo.md`: active TODO list and priority order.
- `docs/v0_scope.md`: first end-to-end product finish line.
- `docs/development.md`: how to run the current app and runtime.
- `docs/README.md`: complete documentation map.

## Product Definition

Forge creates the category:

> Software Engineering Workspace

The product is centered around software engineering tasks, not source files or
chat threads. The developer defines intent, approves plans, reviews diffs, and
decides what ships. Agents do the implementation work inside visible,
auditable boundaries.

The first product proof should feel like a coding-agent session: the developer
types a task, approves a plan, watches the agent read/edit/test/self-fix, and
then reviews a real diff. The task/review model remains core, but the demo
should no longer feel like a generic workflow dashboard.

## Current Status

Last updated: 2026-07-14

The trust/runtime foundation is strong and the Coding-Agent Demo V0 functional
acceptance path is complete. Strict visual closeout is still in progress: the
primary new-task, clarification/plan, live-session, and diff-review screens are
being matched against the latest `design_handoff_forge/` references.

Implemented today:

- SwiftUI macOS app shell.
- State-driven coding-agent session UI in the macOS app: the `1a` new-task
  composer, `1b` reviewable plan, `32a` clarification/plan workspace, `14a`
  running task shell, and mutually exclusive Log/Diff/Tests surfaces based on
  `design_handoff_forge`.
- First usable `10a`-style full-screen diff review surface with a changed-file
  tree, main diff pane, why-this-change reasoning, test evidence, and
  apply/request-change actions backed by the existing review gates.
- TypeScript local runtime.
- Task creation and task conversation.
- Deterministic Agent Loop v0 with visible Manager, Planner, Coder, Tester, and Reviewer states.
- Bounded repo context search and file reading.
- Structured intent briefs and conversation-driven plan revisions.
- `32a` clarification gate: unclear tasks pause before planning, present the
  provider's questions in the conversation and plan rail, reject premature
  plan approval at the runtime boundary, then generate the plan automatically
  when the user's answer resolves the questions.
- Embedded reviewable plans include steps, expected file areas, validation
  plan, risk notes, and bounded time/cost estimates. `Approve & Run` uses
  `POST /tasks/:taskID/approve-plan-and-run` to persist approval, prepare
  execution context, and immediately enter the bounded Agent Run Loop.
- OpenAI plan revisions can run a bounded model-guided read/search context
  loop through logged read-only repo tools.
- Plan approval triggers a bounded read-only execution-context pass before the
  provider drafts the execution proposal, and the proposal keeps tool evidence
  plus inspected context files.
- Provider-selected Agent Run Step v0: `POST /tasks/:taskID/run-agent-step`
  asks the active model provider for one safe next action, then the runtime
  enforces existing gates while it generates an edit proposal, runs an
  approved task command, generates a validation repair proposal, reruns
  reviewed self-fix evidence, or waits for human review. The macOS action rail
  exposes `Run Agent Step`, and the Log tab shows recent agent step decisions,
  rationale, status, linked command/proposal targets, and result summaries.
- Runtime-owned repository inspection step: the provider may choose
  `InspectRepository` with bounded search terms and candidate repo-relative
  paths. Forge filters unsafe inputs, blocks inspections that add no new
  context, executes only its logged read-only list/search/read tools, stores
  context evidence, and can continue the bounded loop into proposal generation
  without granting arbitrary tools. Normalized requests store a stable
  cross-step fingerprint and visible scan/search/context budgets; an identical
  later request is blocked before duplicate search or read calls. Completed
  inspections also persist Strong/Partial/Weak/NoNewContext quality, query-term
  coverage, match/file counts, new-context counts, byte totals, and per-file
  content hashes.
- Agent-step structured-output recovery: malformed JSON/schema/enum decisions
  receive one bounded correction attempt. A recovered decision records both
  attempts; retry exhaustion creates a failed, auditable step without running
  tools, commands, or file mutations.
- Bounded Agent Run Loop v0: `POST /tasks/:taskID/run-agent-loop` repeatedly
  runs provider-selected safe steps up to a small runtime-enforced limit and
  stops at review gates, passed commands, verified self-fixes, blocked steps,
  failures, or max-step protection. The macOS action rail now exposes
  `Run Agent Loop`, and the Log tab shows loop summaries plus the linked step
  trail.
- Cooperative Agent Run Loop controls: pause and abort requests are audited
  while active and stop after the current safe step; resume starts a new
  bounded loop linked to the prior paused/aborted/failed checkpoint. The
  macOS action rail and Log tab expose control state and resume lineage.
- Explicit human review gates for plans and edits.
- Safe edit proposals with multi-file OpenAI proposal artifacts, including
  blocked preview-only operations. Apply supports Markdown `AppendText`,
  exact `ReplaceText` and multi-hunk `PatchText` for Markdown and allowlisted
  source/text files, context-anchored single-file `UnifiedDiff` operations for
  normal source modifications including EOF newline markers, plus reviewed
  allowlisted source/text `CreateFile` and `DeleteFile` changes.
  Cross-file apply and rollback record durable transaction evidence, verify
  every resulting hash, and compensate already-written files after a partial
  failure. Apply persists a per-file write-ahead journal before mutation;
  startup recovery restores interrupted transactions only from recorded
  before/after hashes and snapshots. The macOS diff review shows recovery
  evidence.
- Edit proposal validation, bounded validation-feedback repair, apply/reject
  flow, revision loop, and post-apply validation.
- Approved task-scoped command execution for runtime-known command IDs. The
  runtime now supports `POST /tasks/:taskID/run-task-command`, reuses
  validation-preset approvals, runs project commands with `spawn` and
  `shell:false`, streams stdout/stderr chunks over SSE, and stores bounded
  command-run output in task state. The macOS Tests tab shows these task
  command runs, and the action rail now includes an approved-command chooser
  sourced from runtime permission state instead of a single hardcoded shortcut.
  Failed task commands can now generate a provider repair brief and a follow-up
  review-only repair proposal through the same human-gated proposal flow used
  by validation failures. Once that reviewed self-fix is applied, Forge records
  rerun evidence and exposes `POST /tasks/:taskID/rerun-repair-command` so the
  original failed command can be rerun and linked back to the repair proposal.
  Active spawned task commands can now be cancelled through `POST
  /tasks/:taskID/cancel-task-command`; cancellation is scoped to runtime-owned
  active runs, records an audit entry, streams a system output chunk, and
  surfaces a Cancel Command action in the macOS session UI.
- Validation failure repair briefs that turn failed command output into a
  reviewable next-step diagnosis.
- Follow-up repair edit proposals generated from validation repair briefs,
  surfaced in the macOS Review UI and still behind human review.
- Read-only git status and bounded file diff inspection surfaced in the macOS
  Review UI, including open/reveal actions for changed files plus explicit
  binary/large-file diff handling.
- Read-only commit preparation artifacts with suggested commit message,
  included files, validation suggestions, preflight metadata, blockers, and
  risk notes surfaced in the macOS Review UI.
- Branch preparation preview plus explicit local branch create/switch actions
  with structured preflight metadata, guarded by expected-HEAD/current-branch
  checks, default-branch target blockers, target branch validation, and
  dirty-worktree blockers for switching existing branches.
- Branch publish preview plus explicit first-push/upstream setup for task
  branches with structured preflight metadata, guarded by
  expected-HEAD/branch/remote checks, remote-branch collision checks,
  classified push failure messages, and a no-force-push/no-PR boundary.
- Explicit local git commit action from the commit review card, guarded by a
  confirmation dialog, expected-HEAD check, path validation, and no push.
- Push preparation preview and explicit current-branch push action with
  structured preflight metadata, guarded by expected-HEAD/branch/upstream
  checks, blockers, classified push failure messages, and a no-force-push
  boundary.
- Read-only PR handoff preview with base/head branch awareness, suggested
  branch name, PR title/body, test plan, commits, changed files, structured
  preflight metadata, blockers, risk notes, and a no-publication boundary.
- SQLite task persistence.
- Validation presets and runtime-derived command permission state.
- Local deterministic model provider and optional OpenAI Responses provider.
- Editable model-provider settings in macOS Settings with Keychain-backed OpenAI API key sync.
- First-pass app-managed runtime start/stop from the macOS toolbar, sidebar
  runtime badge, and Settings window, including external-runtime detection,
  runtime directory candidate diagnostics, launch command/output capture, and
  stop timeout messaging.
- App-managed runtime launch separates the runtime installation directory from
  the repository root through `FORGE_REPO_ROOT`, can launch a prebuilt bundled
  runtime resource, and reports both paths in health/settings diagnostics.
- Local repeatable git remote fixtures cover stale remote/non-fast-forward
  push rejection, branch-publish remote branch collision, and remote policy
  rejection through real runtime HTTP endpoints.
- Core runtime smoke regression for the main task lifecycle, restricted
  append/replace/create edits, post-apply validation, restart recovery, and a
  mock OpenAI model-guided context/agent-step/repair loop plus validation
  failure diagnosis. The smoke also covers runtime health diagnostics and
  provider settings GET/POST without persisting API keys.
- Local foundation walkthrough in `docs/development.md`.
- App-visible runtime state and diagnostics for endpoint, version, provider
  configuration, SSE stream, and copy/open diagnostics actions.

Beyond V0:

- Continued handoff fidelity and broader decision-inbox polish.
- Rich autonomous model-backed read/search/patch/run/repair beyond the current
  bounded loop and restricted unified-diff patch engine.
- Actual PR creation/publication after explicit review.
- Durable repository index with symbols and semantic search.
- Full workspace picker and commercial packaging/signing path.
- Packaged, signed, notarized, auto-updating Mac distribution.

## Completion Estimate

Product-readiness estimate:

| Horizon | Estimate | Meaning |
| --- | ---: | --- |
| Trust/runtime foundation | 80-85% | Local runtime, task state, review gates, restricted edits, validation, guarded git actions, diagnostics, and smoke coverage are real. |
| Coding-agent demo V0 behavior | 100% | The documented functional acceptance path is implemented and smoke-covered. |
| Primary V0 handoff UI | 95-98% | The five primary screens are implemented; exact font and screenshot-based pixel/interaction verification remain. |
| Full handoff UI | 44-47% | The handoff HTML contains 43 named screens/states. Seventeen are implemented and five have functional foundations; none is marked strictly verified until rendered comparison passes. |
| Useful developer alpha | 50-60% | Forge can recover interrupted loops/transactions and apply guarded source create/modify/delete changes, but still needs broader autonomous tool use and repeated success on real repositories. |
| Commercial beta | 20-25% | Needs installable packaging, onboarding, GitHub/provider setup, trust polish, and repeated success on real repos. |
| Polished v1 | 15-20% | Needs native distribution, indexing, memory, MCP/GitHub, and product polish. |

Short version: V0 behavior is complete, but the entire 43-screen product design
is not. Alpha is the next cumulative horizon, followed by beta and then v1;
v1 includes the completed requirements from every earlier milestone.

## Next TODO

Top priorities are tracked in `docs/todo.md`. Current post-V0 themes:

- harden the completed V0 on varied real repositories
- widen safe provider tool use and planning/patch output recovery
- return to PR/GitHub publication after the agent coding loop feels real

## Core Principles

- Task first: every meaningful unit of work starts as a task.
- Agent first: the runtime is the product center; the editor is only one tool.
- Workspace first: plans, tools, logs, context, diffs, git, and review belong together.
- Human review: important changes must be explicit, reviewable, and auditable.
- Local first: private repository context and task memory should stay local whenever possible.
- macOS native: Forge should feel like a real Mac app, not a web wrapper.

## Non-Goals

Forge must not become:

- a VS Code clone
- a Cursor clone
- a generic chat app
- an editor-first IDE
- a cloud-only coding agent
- a product that silently changes code without review

## Architecture At A Glance

```text
SwiftUI macOS app
Local TypeScript runtime
SQLite task state
Model provider boundary
Runtime tool and permission layer
Human review and validation gates
Git and packaging layers later
```

Key implementation docs:

- `docs/runtime_architecture.md`
- `docs/model_providers.md`
- `docs/edit_proposals.md`
- `docs/validation_presets.md`
- `docs/database.md`
- `docs/security_permissions.md`

## Run Locally

Run the runtime:

```bash
cd runtime
npm install
npm run dev
```

Run the native app from the repository root:

```bash
./script/build_and_run.sh
```

Build checks:

```bash
cd runtime && npm run check && npm run build
swift build
```

## Documentation Map

Product and strategy:

- `docs/product_vision.md`
- `docs/product_positioning.md`
- `docs/user_personas.md`
- `docs/business_model.md`
- `docs/roadmap.md`
- `docs/project_status.md`
- `docs/todo.md`

Experience and flows:

- `docs/workspace_design.md`
- `docs/user_flows.md`
- `docs/macos_native.md`
- `docs/v0_scope.md`

Runtime and engineering:

- `docs/runtime_architecture.md`
- `docs/model_providers.md`
- `docs/edit_proposals.md`
- `docs/validation_presets.md`
- `docs/local_first.md`
- `docs/database.md`
- `docs/git_workflow.md`
- `docs/mcp.md`
- `docs/security_permissions.md`
- `docs/development.md`

Project memory:

- `docs/founder_notes.md`
- `docs/session_log.md`
- `AGENTS.md`

## AI Development Rules

1. Read this README before making product, architecture, code, or documentation changes.
2. Read `docs/README.md` and the relevant focused docs before editing.
3. Keep README compact; move detailed records into the appropriate `docs/` file.
4. Update `docs/project_status.md` when the overall product state changes.
5. Update `docs/todo.md` when priorities or next tasks change.
6. Append timestamped session entries to `docs/session_log.md` before ending a working conversation.
7. Preserve human review, local-first behavior, and macOS-native direction.
8. Do not turn Forge into an editor-first IDE or chat-first app.

## Open Questions

- Which provider mix should be first release: OpenAI only, OpenAI plus local, or multiple remote providers?
- What is the narrowest real task that proves Forge is worth using daily?
- Should the first paid product focus on solo developers or small teams?
- How much editor functionality belongs inside Forge versus external IDE handoff?

## Final Goal

Forge should become the operating system for software engineering on macOS:

developers define intent, agents perform implementation, and humans review and
approve what ships.
