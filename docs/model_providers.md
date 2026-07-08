# Model Providers

Document role: record the model-provider boundary, current provider behavior,
configuration, and rules for adding real LLM providers.

## Principle

Forge should keep model access behind a runtime-owned provider interface.
Agents should not call vendor APIs directly from orchestration code. This keeps
model choice, local-first policy, billing, telemetry, and safety gates
separable from task state.

## Current Implementation

The runtime now has a `ModelProvider` interface, a default local provider, and
an optional OpenAI Responses provider.

- provider id: `local`
- provider name: `Local Deterministic`
- model: `local-deterministic-v0`
- mode: `local`

The current provider does not call an external model. It produces a
deterministic task intent brief from the task conversation, a deterministic
plan revision from the latest intent brief and file references, and a
deterministic execution proposal after a user approves a plan. This lets the
app and runtime exercise the provider boundary, task state updates, event
streaming, and SQLite persistence without requiring API keys.

It can also produce a deterministic edit proposal with a diff preview and a
restricted apply operation. The default is append-text; if the latest task
conversation includes an explicit quoted replacement instruction such as
`replace "old" with "new"` or `把“旧文本”替换成“新文本”`, the provider can
emit an exact replace-text operation. When a proposal is rejected, the provider
can produce a revised proposal from the latest task conversation while
preserving the same review and validation boundary. The provider still does
not apply changes itself; validating, applying, rejecting, or archiving
proposals remains a runtime-owned approval step.

The optional OpenAI provider:

- provider id: `openai`
- provider name: `OpenAI Responses`
- default model: `gpt-5.5`
- mode: `remote`

It uses the Responses API with Structured Outputs (`text.format` JSON schema)
for intent briefs, model-guided plan-context requests, plan revisions,
execution proposals, and edit proposal guidance. Before a plan revision, the
provider can run a bounded context loop: each round returns `SearchAndRead`
with search terms/read paths or `ReadyForPlan` to stop. The runtime validates
and executes those requests through logged read-only tools before calling the
model again for the revision. During edit proposal generation, the runtime can
also feed blocked validation checks back to the provider for a bounded repair
loop. When validation commands fail, the runtime can ask the provider for a
repair brief from compact command summaries. A later edit proposal request can
include that repair brief so the provider proposes a narrow follow-up repair
artifact. The runtime still generates IDs, timestamps, validation state, and
restricted apply operations locally. The remote provider never directly edits
files, runs commands, commits, pushes, or executes tools.

## Configuration

Environment variables provide startup defaults:

- `FORGE_MODEL_PROVIDER`: provider id. Defaults to `local`.
- `FORGE_MODEL_NAME`: model name. Defaults to `local-deterministic-v0` for
  local and `gpt-5.5` for OpenAI.
- `OPENAI_API_KEY`: required when `FORGE_MODEL_PROVIDER=openai`.
- `FORGE_OPENAI_BASE_URL`: optional OpenAI-compatible base URL override.
  Defaults to `https://api.openai.com/v1`.
- `FORGE_OPENAI_TIMEOUT_MS`: optional request timeout. Defaults to `30000`.
- `FORGE_OPENAI_MAX_OUTPUT_TOKENS`: optional structured-output budget.
  Defaults to `1800`.

Unsupported provider ids now fail clearly through an unavailable provider.
The OpenAI provider also fails clearly when `OPENAI_API_KEY` is missing.

Runtime-editable settings:

- `GET /settings/model-provider`: returns the active provider configuration
  plus editable non-secret runtime settings.
- `POST /settings/model-provider`: updates provider id, model name, OpenAI
  base URL, OpenAI timeout, OpenAI max output tokens, and in-memory OpenAI API
  key state.
- `.forge/model-provider-settings.json`: stores non-secret provider settings.
- `FORGE_MODEL_PROVIDER_SETTINGS_PATH`: optional override for the non-secret
  settings file path.

The runtime never writes API keys into `.forge/model-provider-settings.json`.
When the macOS app saves an OpenAI API key, it stores the key in macOS
Keychain and sends it to the runtime settings endpoint so the current runtime
process can use it in memory. After a runtime restart, the key must come from
`OPENAI_API_KEY` or be synced from Keychain again.

Remote-provider privacy boundary:

- Forge sends compact task state, recent task messages, file reference
  summaries, context file summaries, current plan steps, changed-file names,
  proposal metadata, and compact validation command summaries for repair
  briefs.
- Forge does not upload whole repositories in this provider slice.
- Users should still treat `FORGE_MODEL_PROVIDER=openai` as explicit consent
  to send selected task context to OpenAI or the configured compatible base
  URL.

## Runtime Status Surface

`GET /health` exposes `modelProviderConfiguration` for the macOS Settings
window. The snapshot includes:

- active provider metadata
- configured provider id
- status: `Ready`, `NeedsConfiguration`, or `Unsupported`
- summary and issues
- non-secret configuration values
- secret presence as `Configured` or `Missing`, never the secret value
- whether selected task context can be sent to a remote provider
- a short remote-context boundary summary

The macOS Settings window reads this status and the dedicated settings
endpoint. It can switch between `local` and `openai`, adjust non-secret OpenAI
options, store the OpenAI API key in Keychain, sync that key into runtime
memory, and clear the key from both Keychain and runtime memory.

## Runtime Contract

A provider receives task state and returns structured output. Current output:

- provider metadata
- intent summary
- constraints
- acceptance criteria
- open questions
- next action
- resolved file references
- plan revision summary
- plan revision rationale
- revised plan steps
- model-guided context request rationale
- model-guided context request status
- bounded requested search terms and repo-relative read paths
- execution summary
- proposed actions
- proposed file changes
- proposal revision number
- previous proposal link
- diff previews
- restricted apply operations
- preview-only unsupported operations for review artifacts
- validation feedback for bounded proposal repair attempts
- validation failure repair brief summaries
- validation repair brief context for follow-up proposals
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
