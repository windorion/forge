# Roadmap

Document role: record sequencing, milestones, proof points, and what should
not be built too early.

Last updated: 2026-07-11

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

Status: mostly built.

Goal: prove local runtime, task state, review gates, safe mutation boundaries,
git preflight, validation, persistence, and diagnostics.

Proof point:

- Forge can create tasks, inspect context, propose restricted edits, run
  validation, and expose safe git review actions.

This foundation is necessary but not sufficient. It should no longer be the
main demo story.

### Coding-Agent Demo V0

Status: next milestone.

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

Goal: make Forge useful on small real engineering tasks.

Deliverables:

- OpenAI provider in the normal run flow, not just plan/proposal demos.
- Tool-call-driven loop for read/search/patch/run/repair.
- Patch engine with multi-file apply, rollback, and workspace revalidation.
- Repository index v1: ripgrep search plus lightweight symbols.
- Hosted GitHub PR creation after explicit approval.
- Task cancellation, pause/resume, and crash recovery checkpoints.
- Workspace/repository picker and provider onboarding.

Proof point:

- Forge can complete small code, test, docs, and refactor tasks on a real repo
  with human review and reliable recovery.

### Beta: Installable Mac Product

Goal: make Forge trustworthy outside the development checkout.

Deliverables:

- Signed/notarized app distribution.
- DMG and update mechanism.
- Robust app-managed runtime packaging.
- GitHub auth with least scopes.
- Keychain provider setup.
- Notifications, menu bar, and quick capture.
- Usage/cost reporting and budget guardrails.

Proof point:

- A developer can install Forge, connect a repo/provider/GitHub, run a small
  agent coding task, review the diff, and open a PR without touching the
  terminal.

### v1: Native Agent Workspace

Goal: turn the single-task coding loop into a durable engineering workspace.

Deliverables:

- Multi-task queue and mission control.
- Decision inbox.
- Task templates.
- Local memory and semantic context.
- CLI companion.
- Shareable task review artifacts.
- System integrations: menu bar, global shortcut, Spotlight, widgets,
  notifications.

Proof point:

- Forge becomes the place a developer starts, supervises, resumes, and reviews
  agent engineering work across repositories.

## Immediate Build Order

1. Reshape the macOS UI around `32a`, `14a`, `1a`, `1b`, and `10a`.
2. Add a real patch proposal/apply engine for source files.
3. Add task-scoped command execution with streaming logs.
4. Wire provider-driven read/search/patch/run/repair into the normal flow.
5. Build full-screen diff review with per-file reasoning.
6. Add pause/abort/request-change loops around the live run.
7. Only then continue GitHub PR publication and broader integrations.

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
