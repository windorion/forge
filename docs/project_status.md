# Project Status

Document role: record the current product state, objective completion estimate,
major gaps, and what "finished" means at each product horizon.

Last updated: 2026-07-10

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
- OpenAI-backed plan revisions can first run a bounded model-guided
  read/search context loop; the runtime validates and executes each requested
  round through logged read-only repo tools.
- Explicit human plan approval.
- Execution proposals.
- Safe edit proposal review flow with multi-file OpenAI proposal artifacts,
  including blocked preview-only unsupported operations.
- `AppendText` and exact `ReplaceText` restricted edit operations for
  `README.md` and `docs/*.md`.
- Restricted `CreateFile` apply for new Markdown files under `docs/`.
- Edit proposal validation before apply and immediate revalidation during
  apply.
- Bounded validation-feedback repair loop for blocked edit proposals.
- Request-changes revision loop for rejected edit proposals.
- Post-apply validation runs.
- Validation failure repair briefs for failed validation command output.
- Follow-up repair edit proposals generated from validation repair briefs.
- macOS Review UI display and action flow for validation repair briefs and
  follow-up repair proposals.
- Read-only git status and bounded per-file diff inspection from the runtime,
  surfaced in the macOS Review UI with changed-file open/reveal actions.
  Diff responses now include display-mode metadata, unavailable reasons,
  byte/line counts, and app preview limits so binary and oversized files are
  presented as explicit messages rather than broken side-by-side diffs.
- Read-only commit preparation preview from the runtime, surfaced in the macOS
  Review UI with suggested commit message, included files, validation
  suggestions, blockers, risk notes, and a non-mutating operation boundary.
- Branch preparation preview and explicit local branch create/switch actions
  from the macOS Review UI. The runtime validates the target branch name,
  detects whether it will create or switch, requires expected HEAD and current
  branch values from the reviewed preview, blocks unmerged files, blocks
  switching existing branches with dirty working trees, and records a linked
  task event when possible.
- Branch publish preview and explicit first-push/upstream setup from the macOS
  Review UI. The runtime chooses or validates a configured remote, compares
  current branch work against the default base branch, lists commits to
  publish, blocks default-base/detached/already-upstream/no-commit/unmerged
  states, blocks remote branch collisions, rechecks expected HEAD, branch,
  remote, and remote branch values, then runs a non-force
  `git push --set-upstream <remote> HEAD:<branch>` when approved.
- Explicit local git commit action from the macOS Review UI. The runtime
  requires a fresh expected-HEAD value, explicit confirmation, selected paths
  from the current working tree, no unmerged files, and no staged files outside
  the reviewed selection before it stages those paths and creates one local
  commit. It does not push.
- Push preparation preview and explicit current-branch push action from the
  macOS Review UI. The runtime requires expected HEAD, branch, and upstream
  values to match the reviewed preview, blocks detached/no-upstream/behind/no
  ahead/unmerged states, pushes with no force, and records a linked task event
  when possible.
- Read-only PR handoff preview from the macOS Review UI. The runtime resolves
  a default base branch when possible, compares current branch work against
  that base, suggests a branch name, PR title, draft body, test plan, commits,
  changed files, blockers, and risk notes, and explicitly does not create or
  publish a PR.
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
  restricted docs create-file apply, SQLite restart recovery, runtime health
  diagnostics, model-provider settings GET/POST, fake-key handling without
  secret persistence, a mock OpenAI model-guided context loop,
  blocked-to-repaired proposal handling, and bounded blocked preview-only
  proposal handling, plus failed project validation repair brief generation
  and follow-up repair proposal generation.
- A short local V0 demo script in `docs/development.md`.
- App-visible runtime state and diagnostics for unchecked/checking/running,
  disconnected, wrong version, provider configuration issues, SSE stream state,
  expected endpoint, database/task count, and copy/open diagnostics actions.
- First-pass app-managed runtime start/stop from the macOS toolbar, sidebar
  runtime badge, and Settings window. The app builds the runtime and launches
  the local Node process directly, then can stop only the process it started.
- Runtime lifecycle diagnostics now distinguish external runtimes from
  app-managed processes, capture bounded build/launch output, list runtime
  directory candidates, expose launch commands in Settings/diagnostics, and
  report slow stop attempts.

## Completion Estimate

These percentages are product-readiness estimates, not calendar estimates.

| Horizon | Estimate | Meaning |
| --- | ---: | --- |
| V0 local demo | 98-99% | A local demo can show task creation, context inspection, planning, review, restricted edits, validation, repair proposal review, git status/diff visibility, branch review, branch publish/upstream setup, commit preparation preview, explicit local commit and push actions, PR handoff preview, core runtime/app-facing regression coverage, runtime diagnostics, provider settings coverage, and hardened runtime lifecycle diagnostics. |
| Useful developer alpha | 56-66% | A developer can use Forge on small real tasks with model-backed planning/editing, visible diffs, branch review, branch publish/upstream setup, commit preparation, local commits, guarded push, PR handoff preview, runtime lifecycle controls, and reliable rollback. |
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
- git workflow from dirty tree to approved published PR
- robust command execution and failure recovery
- native macOS distribution, signing, notarization, and updates
- trust polish: permissions, audit trail, secret handling, and clear user
  control

## V0 Finish Line

V0 is done when a user can run Forge locally, create a task, watch it inspect
real repo context, review a plan, approve a safe edit proposal, apply a
restricted change, and see validation results.

Remaining V0 gaps:

- polish app-managed runtime start/stop for packaged app locations and
  distribution-specific path resolution
- polish git/diff review navigation for larger multi-file changes and packaged
  app workflows
- harden local commit review for failed git identity/signing/hooks, mixed
  staged/unstaged states, and larger changes
- harden push review for remote auth failures, non-fast-forward rejections,
  branch protection, and disconnected networks
- harden branch publish/upstream setup for remote auth failures, protected
  branch names, stale remote refs, fork remotes, and isolated success-path
  tests
- harden PR handoff preview for unusual default branches, fork remotes, and
  richer test-plan evidence
- harden branch review for protected default branches, dirty-worktree edge
  cases, and isolated success-path tests
- optional live-provider smoke with a user-supplied OpenAI key outside
  committed tests
- small UI polish pass around task states and review panels

## Alpha Finish Line

Alpha is done when Forge can complete small real documentation or code tasks
with a model provider while preserving human review.

Alpha requires:

- real provider-backed planning and proposal generation in normal flows
- a richer patch format than append/exact replace
- side-by-side diff review
- git status, changed-file inspection, commit preparation preview, and local
  commit creation in the app
- branch publish/upstream setup and guarded current-branch push in the app
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
- approved PR workflow
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
