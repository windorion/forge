# Founder Notes

Document role: preserve distilled founder/product decisions from early
conversations so future work keeps the original intent.

## Product Name

Current name: Forge.

Former codename: Atlas.

The name Forge is preferred because it suggests shaping and producing software
with agents. It also supports product names such as Forge Runtime, Forge Agent,
Forge Review, Forge Memory, and Forge Mission.

## Core Decision

Forge should not be built as an AI IDE. It should be built as a macOS-native,
agent-first, local-first software engineering workspace.

## Why Not IDE-First

Building a complete IDE first would force Forge to compete directly with VS
Code, Cursor, Xcode, and JetBrains. That is too broad and misses the sharper
opportunity.

The sharper product is a workspace where agents perform tasks and the user
reviews their work.

## Why macOS Native

The Mac can be part of the product:

- menu bar
- launcher
- notifications
- Dock
- Finder
- Services
- Quick Look
- active app awareness

This makes Forge different from Electron apps, IDE plugins, and terminal-only
agents.

## Why Local First

Developers and teams care about private code. Forge should keep repository
indexes, memory, task history, approvals, and logs local by default.

## Why Human Review

Agent autonomy without review damages trust. Forge should make agents
powerful, but every important change should be observable and approval-based.

## Why Documentation Matters

The project began with important product decisions in conversation. Those
decisions should be captured in durable files so future AI assistants and
engineers do not drift.

The root README is the compact project index. The `docs/` directory stores
domain-specific detail, current status, TODOs, and session history.

## Collaboration Pattern

Preferred pattern:

1. Founder defines direction and intent.
2. Product/architecture docs turn intent into constraints.
3. Codex or another AI agent implements focused pieces.
4. Human reviews output.
5. README stays compact; focused docs and `docs/session_log.md` are updated
   with decisions, TODO changes, status changes, and session history.

## Current Strategic Bet

The first narrow proof should be:

> Give Forge a local repository task, let the agent plan and modify files,
> run validation, then show a clear diff for human review.

If this loop feels better than using chat, terminal, and git separately, Forge
has a real product wedge.
