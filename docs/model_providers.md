# Model Providers

Document role: record the model-provider boundary, current provider behavior,
configuration, and rules for adding real LLM providers.

## Principle

Forge should keep model access behind a runtime-owned provider interface.
Agents should not call vendor APIs directly from orchestration code. This keeps
model choice, local-first policy, billing, telemetry, and safety gates
separable from task state.

## Current Implementation

The runtime now has a `ModelProvider` interface and a default local provider:

- provider id: `local`
- provider name: `Local Deterministic`
- model: `local-deterministic-v0`
- mode: `local`

The current provider does not call an external model. It produces a
deterministic task intent brief from the task conversation, a deterministic
plan revision from the latest intent brief, and a deterministic execution
proposal after a user approves a plan. This lets the app and runtime exercise
the provider boundary, task state updates, event streaming, and SQLite
persistence without requiring API keys.

It can also produce a deterministic edit proposal with a diff preview and a
restricted append-text operation. The provider still does not apply changes
itself; validating, applying, or rejecting proposals remains a runtime-owned
approval step.

## Configuration

Environment variables:

- `FORGE_MODEL_PROVIDER`: provider id. Defaults to `local`.
- `FORGE_MODEL_NAME`: model name. Defaults to `local-deterministic-v0`.

Unsupported provider ids currently fall back to the local deterministic
provider. Real provider implementations should fail clearly when required
credentials or settings are missing.

## Runtime Contract

A provider receives task state and returns structured output. Current output:

- provider metadata
- intent summary
- constraints
- acceptance criteria
- open questions
- next action
- plan revision summary
- plan revision rationale
- revised plan steps
- execution summary
- proposed actions
- proposed file changes
- diff previews
- restricted apply operations
- risk level
- generated timestamp

The provider must not directly mutate files, run commands, commit code, push
branches, or upload private repository content. It can propose next actions;
tool execution and approvals remain runtime responsibilities.

## Next Providers

Likely provider implementations:

- OpenAI
- Anthropic
- local Ollama-compatible models
- future local Apple or MLX-backed models

Each provider should implement the same runtime interface and preserve the
approval model before any file or command side effects.
