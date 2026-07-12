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

Last updated: 2026-07-12

Direction reset: the trust/runtime foundation is strong, but the next milestone
is a redesigned coding-agent demo based on `design_handoff_forge/`, especially
the new-task, plan-approval, live-session, and full diff-review screens.

Implemented today:

- SwiftUI macOS app shell.
- First-pass coding-agent session UI in the macOS app: neo-brutalist task
  queue, new-task empty state, live agent stream, plan progress, Log/Diff/Tests
  tabs, compact plan gate, and action rail based on `design_handoff_forge`.
- First usable `10a`-style full-screen diff review surface with a changed-file
  tree, main diff pane, why-this-change reasoning, test evidence, and
  apply/request-change actions backed by the existing review gates.
- TypeScript local runtime.
- Task creation and task conversation.
- Deterministic Agent Loop v0 with visible Manager, Planner, Coder, Tester, and Reviewer states.
- Bounded repo context search and file reading.
- Structured intent briefs and conversation-driven plan revisions.
- OpenAI plan revisions can run a bounded model-guided read/search context
  loop through logged read-only repo tools.
- Plan approval triggers a bounded read-only execution-context pass before the
  provider drafts the execution proposal, and the proposal keeps tool evidence
  plus inspected context files.
- Explicit human review gates for plans and edits.
- Safe edit proposals with multi-file OpenAI proposal artifacts, including
  blocked preview-only operations. Apply supports Markdown `AppendText`,
  exact `ReplaceText` for Markdown and allowlisted source/text files, new
  `docs/*.md` `CreateFile` changes, applied-file rollback metadata, and an
  explicit rollback action.
- Edit proposal validation, bounded validation-feedback repair, apply/reject
  flow, revision loop, and post-apply validation.
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
  mock OpenAI model-guided context/repair loop plus validation failure
  diagnosis. The smoke also covers runtime health diagnostics and provider
  settings GET/POST without persisting API keys.
- Local foundation walkthrough in `docs/development.md`.
- App-visible runtime state and diagnostics for endpoint, version, provider
  configuration, SSE stream, and copy/open diagnostics actions.

Not finished yet:

- Full-fidelity `design_handoff_forge` UI, especially exact split-diff polish,
  file-level review persistence, decision prompts, and polished live-run
  states.
- Real autonomous model-backed read/search/patch/run/repair loop.
- General source-code patch engine, richer rollback/revalidation, and richer
  diff review.
- Streamed task-scoped command/test output and self-fix loops.
- Actual PR creation/publication after explicit review.
- Durable repository index with symbols and semantic search.
- Full workspace picker and commercial packaging/signing path.
- Packaged, signed, notarized, auto-updating Mac distribution.

## Completion Estimate

Product-readiness estimate:

| Horizon | Estimate | Meaning |
| --- | ---: | --- |
| Trust/runtime foundation | 80-85% | Local runtime, task state, review gates, restricted edits, validation, guarded git actions, diagnostics, and smoke coverage are real. |
| Coding-agent demo V0 | 50-55% | Has a first-pass session UI shell, full-screen diff review surface, and first exact source replace path, but still needs a broader source patch engine, streamed command output, and provider-driven patch/run/repair loop. |
| Useful developer alpha | 35-45% | A developer cannot yet rely on Forge like Codex or Claude Code for normal coding tasks. It needs real patching, command execution, recovery, and a stronger model-backed run loop. |
| Commercial beta | 20-25% | Needs installable packaging, onboarding, GitHub/provider setup, trust polish, and repeated success on real repos. |
| Polished v1 | 15-20% | Needs native distribution, indexing, memory, MCP/GitHub, and product polish. |

Short version: Forge has a real trust/runtime skeleton, but the visible demo
must now become a real coding-agent workspace.

## Next TODO

Top priorities are tracked in `docs/todo.md`. Current P0/P1 themes:

- polish the first-pass macOS coding-agent session UI toward the exact
  `design_handoff_forge` screens
- broaden source-file patch proposal/apply beyond exact replace and harden
  rollback/revalidation
- add approved task-scoped command execution with streamed logs
- wire provider-driven read/search/patch/run/repair into the normal task flow
- connect full diff review to durable file-level decisions once the review
  model supports them
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
