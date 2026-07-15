# Forge Documentation System

Document role: map every durable project document and explain what each file is
responsible for recording.

## Source Of Truth

The root `README.md` is the compact project constitution and memory index. It
records the highest-level decisions, active rules, current status summary, and
links to deeper documents.

The `docs/` directory stores detailed planning and architecture documents.
Each document owns one area of the product so that decisions do not get mixed
together.

Timestamped working history lives in `session_log.md`, not in the root README.

## Document Map

| Document | Record Role |
| --- | --- |
| `product_vision.md` | Why Forge exists, what category it creates, and what principles must not change. |
| `product_positioning.md` | Market position, competitors, differentiation, and messaging. |
| `project_status.md` | Current implementation state, distance to finished product, and completion estimates. |
| `todo.md` | Active TODO list, priority order, and next concrete tasks. |
| `user_personas.md` | Target users, pains, motivations, objections, and success criteria. |
| `user_flows.md` | End-to-end workflows from onboarding to review and shipping. |
| `workspace_design.md` | Product surface model, screen structure, panels, states, and interaction rules. |
| `design_handoff_coverage.md` | Per-screen implementation and strict visual verification status for the delivered handoff. |
| `macos_native.md` | macOS-specific features, permissions, distribution, and native integrations. |
| `multi_agent.md` | Agent roles, responsibilities, handoffs, orchestration, and state transitions. |
| `runtime_architecture.md` | Local runtime modules, app-runtime boundaries, tool execution, and event streams. |
| `model_providers.md` | Model-provider boundary, configuration, and provider implementation rules. |
| `edit_proposals.md` | Safe edit proposal flow and distinction between proposed and applied changes. |
| `validation_presets.md` | Validation preset sources, workspace config, approval rules, and command boundaries. |
| `local_first.md` | Local indexing, privacy model, context cache, embeddings, and offline behavior. |
| `database.md` | Local database responsibilities, conceptual schema, and data retention rules. |
| `git_workflow.md` | Branch, diff, commit, review, and pull request workflows. |
| `mcp.md` | MCP integration model, tool discovery, permissions, and plugin boundaries. |
| `security_permissions.md` | Trust model, approval gates, command risk levels, and auditability. |
| `business_model.md` | Packaging, pricing hypotheses, customer segments, and distribution. |
| `roadmap.md` | Phases, milestones, sequencing, and proof points. |
| `founder_notes.md` | Distilled founder/product decisions from conversations. |
| `development.md` | How to run the current app/runtime skeleton and what is not wired yet. |
| `v0_scope.md` | Defines the first end-to-end product target and completion criteria. |
| `session_log.md` | Timestamped work-session history with summary, done, not done, and next steps. |

## Update Rules

- If a new decision changes product direction, update the root `README.md`
  compactly and move detail into a focused document.
- If a decision adds detail inside a domain, update the matching `docs/` file.
- If overall progress or distance to finished changes, update
  `project_status.md`.
- If priorities change, update `todo.md`.
- If a document becomes too broad, split it into a focused file and link it
  here.
- Every meaningful work session should end with an entry in `session_log.md`.
- Keep documents practical. Each file should help a future AI or engineer make
  better decisions.

## Current Status

This documentation system is the first planning baseline. It is intentionally
not final. It should evolve as Forge moves from product planning into real
macOS app and runtime implementation.
