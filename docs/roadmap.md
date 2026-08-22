# Roadmap

Document role: record sequencing, milestones, proof points, and what should
not be built too early.

Last updated: 2026-08-22

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
- Local-metadata fork-owner/base detection plus default-off bounded PR status
  supervision with durable refresh attempts.
- Task cancellation, pause/resume, stuck detection, and crash recovery.
- Repository selection, provider settings, and first-run onboarding.

Remaining Alpha evidence:

- pinned public-repository tasks run with a live model under explicit budgets;
- broader provider tool/patch choices and repeated successful recovery;
- archive a full-duration restart-heavy supervision run and a complete passing
  action-level UI archive for the implemented authorized task/detail/review
  routing. Bounded reconnect backoff, crash restart, and supervisor telemetry
  are implemented. A headless process fixture now proves transport recovery,
  owned-child relaunch, cached visibility, authorization retention, and no
  mutation/dispatch request.

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
4. Archive full-duration Mission Control soak evidence and capture the existing
   true XCUITest suite in a user-approved unattended desktop window.
5. Complete signed/notarized packaging, appcast install/relaunch, production
   diagnostics, and commercial decisions.

## Roadmap Gap Register

The milestone narrative previously under-specified several cross-cutting exit
gates. This register makes the missing work, dependencies, and proof points
explicit. Percentages remain in `docs/project_status.md`; this table controls
sequence rather than inventing another score.

| Gap | Horizon | Current evidence | Dependency / blocker | Exit proof |
| --- | --- | --- | --- | --- |
| Daily-use coding quality | Alpha | Deterministic local and mock-OpenAI protocol campaigns pass. | Live provider credentials and an explicit cost budget. | At least eight pinned public-repository tasks across four families, all budget-accounted, externally scored, and classified. |
| Broader safe agent choices | Alpha | Read/search, reviewed Unified Diff, approved command, repair, and rerun actions exist. | Must be selected from corpus failures rather than intuition. | Measured improvement on the pinned corpus without unauthorized writes, raw shell, or weaker review gates. |
| Multi-repository operational proof | Alpha | Fair supervised dispatch, 300-second/1,086-restart soak, one passing action-level UI path, exponential reconnect backoff, visible diagnostics, and a passing process-level transport/termination/relaunch fixture with no authorization widening or queue escape. | Stable AC for six-hour evidence; unattended desktop window for XCUITest. | Six-hour report and complete passing `.xcresult` with documented power/desktop conditions. |
| Runtime history, retention, and migrations | Beta | SQLite schema v6 runs ordered safety-classified migrations; v4/v5 upgrades preserve tasks; fixture destructive v7 requires a verified owner-only `VACUUM INTO` manifest and the offline CLI preserves displaced data plus receipts. Policy v1 retains task events/tool calls/messages/indexes indefinitely, never auto-purges, exports deterministically with redaction and source/content hashes, preserves unfinished tasks, and atomically records terminal-task/index purge evidence. | Commercial privacy language and any future hosted deletion SLA depend on the founder's local-only versus hosted boundary. | Unit, HTTP, restart, raw-SQLite, observer, stale/forged receipt, backup, offline recovery, and native client/UI proofs pass. Beta exit requires matching product privacy text and signed-package threat review, not another runtime purge mechanism. |
| Performance and resource budgets | Beta | Versioned smoke/standard/large runtime profiles now measure cold start, idle CPU/RSS, retained-task listing, cold/warm index, Git status/diff, and deterministic agent-step latency. Hard/advisory budgets, noise-aware same-profile comparisons, direct evaluator tests, and a hosted macOS artifact-producing CI gate are real. | Representative real large repositories and a signed-package profiling environment. | Synthetic runtime regression gate remains green; then add pinned real-repository index/Git evidence plus signed app/runtime launch, combined RSS, energy, and interactive native budgets. |
| Security lifecycle | Beta | Explicit approvals, read-only observers, scoped authorization, Keychain secrets, bounded task-command grants, append-only revocation, restart proof, versioned Secret Redaction/workspace retention, and versioned fail-closed app/runtime/helper/widget signing, entitlement, nested-code, update, and notarization-boundary checks are enforced by hosted security workflows. | Repository/session validation grants remain deliberately unimplemented until evidence requires them; commercial privacy text and live signed-package proof need product/credential inputs. | Keep approval/redaction/retention/distribution regressions green and archive the exact final signed artifact's independent Developer ID, hardened-runtime, entitlement, nested-code, update-signature, notarization/stapling, and Gatekeeper proofs. |
| Signed Mac distribution | Beta | App-managed Runtime resource path, onboarding/update UI, honest disabled placeholder feed, deterministic unsigned assembly and clean staging, explicit unsigned/ad-hoc profiles, and hosted release-negative control. | Pinned bundled Node, production archive/export setup, founder Developer ID and notarization credentials, appcast key/installer, DMG work, and Widget extension packaging. | Clean-machine DMG install, Gatekeeper/notarization pass, signed appcast install/relaunch, nested-code/team verification, and rollback/recovery rehearsal. |
| Account and commercial boundary | Beta | Honest local-only continuation; provider/GitHub credentials stay local. | Founder decision: local-only/open-core vs hosted account/team product. | Written decision plus matching UI, privacy/deletion behavior, packaging, pricing, entitlement, support, and launch evidence. |
| Repository memory and semantic retrieval | v1 | Durable file/symbol/trigram indexes with live verification. | Evaluation corpus and privacy/resource budgets. | Hybrid retrieval beats text/symbol baseline on a versioned benchmark while remaining local, bounded, and inspectable. |
| Complete native workflow | v1 | Menus, shortcuts, notifications, Spotlight, CLI, Mission Control, decision inbox, templates. | Signed package and final human-input checks. | Finder/IDE handoff, remappable shortcuts, Dock/menu/notification verification, signed WidgetKit or an explicit permanent descope. |
| Hosted collaboration | v1 or later | No production service; intentionally local single-user today. | Account/team boundary and validated demand. | Either a scoped tenancy/sharing/sync plan with security/deletion proof, or an explicit roadmap removal. |

This register originally exposed four omissions that should not hide behind
broad milestone labels: data lifecycle/migrations, measurable performance
budgets, approval/audit lifecycle, and the account/commercial decision gate.
The migration, command-output data-lifecycle, performance-budget, bounded
task-approval lifecycle, broader Secret Redaction, and workspace-wide
retention/export/purge and signed-build threat-review slices are now
implemented. The remaining distribution work is an actual release-shaped and
credential-proven artifact, not another paper threat model. It should not
preempt the live-model Alpha corpus, and each remaining exit condition must be
resolved before claiming the corresponding Beta or v1 finish line.

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
