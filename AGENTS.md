# Agent Instructions

Document role: tell AI coding agents how to work in this repository.

## Required Reading

Before changing code, docs, prompts, architecture, or product direction, read:

1. `README.md`
2. `docs/README.md`
3. The specific `docs/` file related to the task

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

## Session Logging

At the end of every working conversation, append a timestamped entry to the
`Session Log` section of `README.md`.

Each entry must include:

- timestamp with timezone
- conversation summary
- done
- not done
- next
