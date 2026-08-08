# Roadmap

Document role: record sequencing, milestones, proof points, and what should
not be built too early.

Last updated: 2026-08-08

## Direction Reset

Forge should now optimize for one thing first:

> A developer types a coding task, approves a plan, watches the agent read,
> edit, test, self-fix, and then reviews the resulting diff.

The previous implementation built a strong safety/runtime foundation, but the
demo reads too much like a workflow dashboard. The next roadmap must make the
product feel like an agent coding application, closer in interaction rhythm to
Codex and Claude Code, while preserving Forge's macOS-native and review-first
identity.

## Design Source

Primary UI direction comes from `design_handoff_forge/`:

- `32a` New session: chat clarifies intent, embeds the plan card, then shows
  the agent working live.
- `14a` Main window: task queue on the left, current task with plan progress
  and live thinking/code stream in the center, bottom tabs for Log/Diff/Tests.
- `1a` New task: direct coding-task entry, not a generic task form.
- `1b` and `20a` Plan approval: the plan gate is the start-work boundary.
- `10a` Diff review: file tree, unified/split diff, per-file reasoning, tests,
  and file-level approve/request-change actions.
- `33a` and `34a` Decision points: the agent asks instead of guessing.

The neo-brutalist visual language in the handoff is not decoration; it is part
of the product character. The app should feel sharp, developer-first,
terminal-adjacent, and operational.

## New Milestone Definitions

### Foundation V0: Trust And Runtime Skeleton

Status: implemented and regression-covered; ongoing work hardens it.

Goal: prove local runtime, task state, review gates, safe mutation boundaries,
git preflight, validation, persistence, and diagnostics.

Proof point:

- Forge can create tasks, inspect context, propose restricted edits, run
  validation, and expose safe git review actions.

This foundation is necessary but not sufficient. It should no longer be the
main demo story.

### Coding-Agent Demo V0

Status: functional criteria complete; full handoff design completion remains.

Goal: make Forge feel like an agent coding app.

Deliverables:

- Implement the `32a`/`14a` session model in the macOS app.
- Make the first screen a coding-task composer: "What should Forge build?"
- Show a live agent stream as the primary center of gravity.
- Promote Diff and Tests to first-class tabs next to the live log.
- Add a real patch proposal format that can touch normal source files, not
  only Markdown.
- Add a controlled command runner for approved task-scoped test/check
  commands, with streamed output.
- Add a self-fix loop: failed validation creates a follow-up patch proposal
  and reruns approved checks.
- Make `10a` Diff Review the primary review surface, with file list,
  unified/split diff, why-this-change, tests covering the file, approve file,
  and request change.
- Keep the plan gate, decision prompts, local-first defaults, and audit log.

Proof point:

- A user can ask Forge to make a small code change in this repository, approve
  the plan, watch it edit and test, review a multi-file diff, request a
  revision if needed, and accept the final patch.

### Alpha: Useful Local Coding Agent

Status: deterministic local/provider protocol baselines pass; live-model
public-repository evidence remains.

Goal: make Forge useful on small real engineering tasks.

Implemented toward Alpha:

- OpenAI in normal plan/context/proposal/step/repair flows.
- Runtime-owned read/search plus reviewed patch/run/repair steps.
- Multi-file apply/rollback/recovery and strict Unified Diff support.
- Durable file, symbol, and trigram text indexes.
- Hosted GitHub PR publication after explicit approval.
- Task cancellation, pause/resume, stuck detection, and crash recovery.
- Repository selection, provider settings, and first-run onboarding.

Remaining Alpha evidence:

- pinned public-repository tasks run with a live model under explicit budgets;
- broader provider tool/patch choices and repeated successful recovery;
- automatic fork-owner discovery and optional background PR refresh; and
- full background task/detail/review routing across authorized repositories.

Proof point:

- Forge can complete small code, test, docs, and refactor tasks on a real repo
  with human review and reliable recovery.

### Beta: Installable Mac Product

Status: product surfaces exist; signed distribution and production services do
not.

Goal: make Forge trustworthy outside the development checkout.

Remaining deliverables:

- Signed/notarized app distribution.
- DMG and update mechanism.
- Production app-managed runtime packaging.
- Live-verified GitHub auth with the founder OAuth Client ID.
- Production diagnostics, privacy, and support boundaries.
- Usage/cost reporting and budget guardrails.

Keychain provider setup, onboarding, notifications, menu bar, quick capture,
and update UI are implemented but must be proven inside the signed package.

Proof point:

- A developer can install Forge, connect a repo/provider/GitHub, run a small
  agent coding task, review the diff, and open a PR without touching the
  terminal.

### v1: Native Agent Workspace

Status: much of the workspace surface arrived early; memory/semantic retrieval,
hosted collaboration, and signed WidgetKit remain.

Goal: turn the single-task coding loop into a durable engineering workspace.

Implemented ahead of v1:

- Multi-task queue and mission control.
- Decision inbox.
- Task templates.
- CLI companion.
- Local share/audit artifacts.
- System integrations: menu bar, global shortcut, Spotlight, and notifications.

Remaining v1 deliverables include local memory/semantic context, hosted
collaboration, signed widgets, and complete multi-repository task routing.

Proof point:

- Forge becomes the place a developer starts, supervises, resumes, and reviews
  agent engineering work across repositories.

Milestones are cumulative. Alpha includes V0, beta includes V0 and alpha, and
v1 includes V0, alpha, and beta plus the v1-only workspace requirements.
Readiness percentages therefore use different denominators and are not
additive.

## Immediate Build Order

1. Keep the 41 Verified handoff states stable; close live `6a` OAuth when the
   founder Client ID exists and `35a` only with P6 signing.
2. Run a pinned public-repository live-model corpus with explicit request,
   token, cost, command, and mutation budgets.
3. Use those failures to widen provider tool/patch/recovery behavior without
   weakening runtime ownership or human review.
4. Add automatic fork-owner discovery and optional background refresh after
   the existing publication and on-demand review/check flow.
5. Finish background task/detail/review routing across authorized repositories.
6. Complete signed/notarized packaging, appcast install/relaunch, production
   diagnostics, and commercial decisions.

## What Not To Optimize Next

- More preflight cards before the main coding loop feels real.
- More settings screens before the first-run coding task works.
- Marketplace, enterprise admin, visual theme systems, or team collaboration.
- Broad MCP integration before Forge has a compelling built-in agent loop.
- IDE-like file explorer/editor features that compete with the coding session.

## Product Guardrails

- The plan gate stays.
- The agent should ask at decision points instead of guessing.
- File changes, commands, commits, pushes, and PRs remain explicit,
  reviewable, and auditable.
- The main experience is not chat alone; it is chat plus live agent execution,
  diff, tests, and review.
- Forge should feel like a Mac-native coding agent, not a generic dashboard.
