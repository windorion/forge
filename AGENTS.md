# Agent Instructions

Document role: tell AI coding agents how to work in this repository.

## Required Reading

Before changing code, docs, prompts, architecture, or product direction, read:

1. `README.md`
2. `docs/README.md`
3. `docs/project_status.md` and `docs/todo.md` when planning next work
4. The specific `docs/` file related to the task

## Handoff Reading Path

When taking over this repository from another agent, read in this order:

1. `README.md` for the compact project definition, current status, and core
   rules.
2. `docs/project_status.md` for what has been built, how far Forge is from
   V0/alpha/beta/v1, and the major remaining gaps.
3. `docs/todo.md` for the active backlog and priority order.
4. `docs/development.md` for how the current app/runtime runs and what the
   present implementation can do.
5. The domain document for the task you are about to touch.
6. `docs/session_log.md` only when you need historical context for why a
   decision was made.

Do not start by reading every document linearly. Use the document map below to
load the smallest relevant set, then inspect code.

## Document Responsibilities

Project index and state:

- `README.md`: compact project constitution, current snapshot, and links.
- `docs/README.md`: documentation map and update rules.
- `docs/project_status.md`: current implementation state, completion estimate,
  distance to finished product, and major risks.
- `docs/todo.md`: active TODOs, priorities, and next implementation tasks.
- `docs/session_log.md`: timestamped work-session history.
- `docs/founder_notes.md`: durable founder decisions and collaboration
  pattern.

Product and market:

- `docs/product_vision.md`: why Forge exists and what must not change.
- `docs/product_positioning.md`: category, competitors, differentiation, and
  messaging.
- `docs/user_personas.md`: target users, pains, motivations, objections, and
  success criteria.
- `docs/business_model.md`: pricing, packaging, customer segments, and
  go-to-market assumptions.
- `docs/roadmap.md`: long-range sequencing, milestones, and what not to build
  too early.

Experience and macOS design:

- `docs/workspace_design.md`: workspace surfaces, layout responsibilities,
  panel behavior, and interaction rules.
- `docs/user_flows.md`: end-to-end flows from onboarding through task review.
- `docs/macos_native.md`: native macOS features, permissions, distribution,
  and system integrations.
- `docs/v0_scope.md`: first end-to-end demo target and V0 completion criteria.

Runtime and engineering:

- `docs/runtime_architecture.md`: local runtime modules, app-runtime
  boundaries, task loop, tools, and events.
- `docs/model_providers.md`: provider abstraction, local/OpenAI behavior,
  settings, and remote-context boundary.
- `docs/edit_proposals.md`: safe edit proposal flow, validation, apply/reject,
  and restricted edit operations.
- `docs/validation_presets.md`: validation preset registry, workspace config,
  approvals, and command boundaries.
- `docs/local_first.md`: local indexing, privacy, memory, and offline
  behavior.
- `docs/database.md`: SQLite responsibilities, conceptual schema, and
  retention rules.
- `docs/git_workflow.md`: git status, diff, commit, branch, and PR workflow
  direction.
- `docs/mcp.md`: MCP discovery, permissions, tool boundaries, and plugin model.
- `docs/security_permissions.md`: trust model, risk levels, approvals, secrets,
  and auditability.

## Task-Specific Reading Guide

- App/UI work: read `docs/workspace_design.md`, `docs/macos_native.md`,
  `docs/development.md`, then the relevant Swift files.
- Runtime/task-loop work: read `docs/runtime_architecture.md`,
  `docs/development.md`, then `runtime/src/server.ts`.
- Model provider work: read `docs/model_providers.md`,
  `docs/security_permissions.md`, then `runtime/src/modelProvider.ts`.
- Edit proposal work: read `docs/edit_proposals.md`,
  `docs/security_permissions.md`, then runtime types/server and Swift models.
- Validation command work: read `docs/validation_presets.md`,
  `docs/security_permissions.md`, then runtime validation code and Review UI.
- Database/persistence work: read `docs/database.md`,
  `docs/local_first.md`, then `runtime/src/taskStore.ts`.
- Git workflow work: read `docs/git_workflow.md`,
  `docs/security_permissions.md`, then design the approval boundary before
  coding.
- Product planning or scope work: read `docs/product_vision.md`,
  `docs/project_status.md`, `docs/todo.md`, and `docs/roadmap.md`.

## Project Direction

Forge is a macOS-native, agent-first, local-first software engineering
workspace.

Do not turn it into:

- a VS Code clone
- a Cursor clone
- a generic chat app
- an editor-first IDE

## Working Rules

- Preserve the product principles in `README.md`.
- Keep documentation updated when decisions change.
- Prefer focused changes over broad rewrites.
- Keep architecture modular.
- Make human review and local-first behavior first-class.
- Use native macOS patterns when building the app.
- Keep runtime actions auditable.
- Keep the root README compact. Move detailed records into focused docs.
- Update `docs/project_status.md` when product state or completion estimates
  change.
- Update `docs/todo.md` when priorities change.

## Session Logging

At the end of every working conversation, append a timestamped entry to
`docs/session_log.md`.

Each entry must include:

- timestamp with timezone
- conversation summary
- done
- not done
- next
