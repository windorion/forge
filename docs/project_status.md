# Project Status

Document role: record the current product state, objective completion estimate,
major gaps, and what "finished" means at each product horizon.

Last updated: 2026-07-08

## One-Line Status

Forge is a working local prototype of a macOS-native agent workspace. It can
create tasks, inspect bounded repo context, hold review gates, generate safe
edit proposals, apply restricted Markdown edits, validate work, and persist task
state locally. The runtime core now has automated smoke coverage. It is not yet
a real autonomous coding agent product.

## Current Implementation

Implemented:

- Native SwiftUI macOS app shell.
- Local TypeScript runtime.
- Task creation and task conversation.
- Server-Sent Events from runtime to app.
- SQLite task persistence.
- Deterministic Agent Loop v0 with Manager, Planner, Coder, Tester, Reviewer
  states.
- Bounded repository file listing, search, and context reading.
- Repo-local file mentions in task messages.
- Structured intent briefs.
- Conversation-driven plan revisions.
- Explicit human plan approval.
- Execution proposals.
- Safe edit proposal review flow.
- `AppendText` and exact `ReplaceText` restricted edit operations for
  `README.md` and `docs/*.md`.
- Edit proposal validation before apply and immediate revalidation during
  apply.
- Request-changes revision loop for rejected edit proposals.
- Post-apply validation runs.
- Built-in and allowlisted project validation presets.
- Runtime-derived command permission state in the app.
- Runtime model-provider abstraction.
- Local deterministic provider.
- Optional OpenAI Responses provider with Structured Outputs.
- Editable model-provider settings in macOS Settings.
- OpenAI API key handling through macOS Keychain and runtime memory.
- Core runtime smoke regression command covering create task, file-reference
  messages, plan revision, plan approval, edit proposal generation,
  validation, apply, built-in post-apply validation, append/replace operations,
  and SQLite restart recovery.
- App-visible runtime state and diagnostics for unchecked/checking/running,
  disconnected, wrong version, provider configuration issues, SSE stream state,
  expected endpoint, database/task count, and copy/open diagnostics actions.

## Completion Estimate

These percentages are product-readiness estimates, not calendar estimates.

| Horizon | Estimate | Meaning |
| --- | ---: | --- |
| V0 local demo | 87-90% | A local demo can show task creation, context inspection, planning, review, restricted edits, validation, core runtime regression coverage, and runtime diagnostics. |
| Useful developer alpha | 40-50% | A developer can use Forge on small real tasks with model-backed planning/editing, visible diffs, and reliable rollback. |
| Commercial beta | 25-30% | A paid user can install it, connect providers, trust permissions, use git workflows, and recover from failures. |
| Polished v1 product | 15-20% | Forge feels like a complete native Mac product with runtime management, indexing, packaging, updates, onboarding, billing, and integrations. |

## Distance To "Finished"

Forge is past the "blank prototype" stage and has a credible architecture
skeleton. It is still far from finished as a commercial product.

The hardest remaining work is not the app shell. The hardest remaining work is:

- real model-backed agent execution, not deterministic simulation
- reliable repository understanding beyond bounded file scans
- safe but useful patch generation and diff review
- app-managed runtime lifecycle
- git workflow from dirty tree to reviewed commit or PR
- robust command execution and failure recovery
- native macOS distribution, signing, notarization, and updates
- trust polish: permissions, audit trail, secret handling, and clear user
  control

## V0 Finish Line

V0 is done when a user can run Forge locally, create a task, watch it inspect
real repo context, review a plan, approve a safe edit proposal, apply a
restricted change, and see validation results.

Remaining V0 gaps:

- app-managed runtime start/stop
- more useful diff preview in the macOS app
- provider settings smoke test with a live key supplied intentionally
- broadened regression coverage for app-facing runtime state and provider
  settings paths
- small UI polish pass around task states and review panels

## Alpha Finish Line

Alpha is done when Forge can complete small real documentation or code tasks
with a model provider while preserving human review.

Alpha requires:

- real provider-backed planning and proposal generation in normal flows
- a richer patch format than append/exact replace
- side-by-side diff review
- git status and changed-file inspection in the app
- task recovery after runtime restart and common failures
- a clean onboarding path for choosing a repo and provider

## Commercial Beta Finish Line

Commercial beta is done when a user can install Forge outside the development
machine and safely use it on real repositories.

Commercial beta requires:

- signed and notarized app distribution
- Sparkle or equivalent updates
- app-managed runtime process
- robust provider configuration and diagnostics
- workspace/repository selection
- git commit and PR preparation workflow
- privacy and permission messaging
- crash/error reporting strategy
- pricing and packaging decision

## Product Risk

Primary risks:

- Forge may feel like a simulator until the real model/tool loop is strong.
- The app can become too dashboard-like if diff, git, and terminal workflows do
  not become first-class.
- Local-first privacy is valuable, but remote model configuration must be clear
  enough that users trust what leaves the machine.
- The first commercial scope must stay narrow; becoming a full IDE too early
  would slow the product down.
