# Forge Runtime

The runtime is the local agent execution process for Forge.

This first slice is intentionally small:

- `GET /`
- `GET /health`
- `GET /tasks`
- `GET /git/status`
- `GET /git/diff?path=<repo-relative-path>`
- `GET /git/branch-preview`
- `POST /git/branch`
- `GET /git/branch-publish-preview`
- `POST /git/branch-publish`
- `GET /git/commit-preview`
- `POST /git/commit`
- `GET /git/push-preview`
- `POST /git/push`
- `GET /git/pr-preview`
- `GET /validation-presets`
- `GET /settings/model-provider`
- `POST /settings/model-provider`
- `GET /tasks/:taskID/validation-permissions`
- `POST /tasks`
- `POST /tasks/:taskID/messages`
- `POST /tasks/:taskID/generate-plan-revision`
- `POST /tasks/:taskID/approve-plan`
- `POST /tasks/:taskID/run-agent-step`
- `POST /tasks/:taskID/run-agent-loop`
- `POST /tasks/:taskID/pause-agent-loop`
- `POST /tasks/:taskID/abort-agent-loop`
- `POST /tasks/:taskID/resume-agent-loop`
- `POST /tasks/:taskID/generate-edit-proposal`
- `POST /tasks/:taskID/revise-edit-proposal`
- `POST /tasks/:taskID/generate-validation-repair-proposal`
- `POST /tasks/:taskID/validate-edit-proposal`
- `POST /tasks/:taskID/apply-edit-proposal`
- `POST /tasks/:taskID/rollback-edit-proposal`
- `POST /tasks/:taskID/reject-edit-proposal`
- `POST /tasks/:taskID/approve-validation-preset`
- `POST /tasks/:taskID/run-validation`
- `POST /tasks/:taskID/run-task-command`
- `POST /tasks/:taskID/rerun-repair-command`
- `POST /tasks/:taskID/cancel-task-command`
- `GET /events` as a Server-Sent Events stream

Creating a task starts Agent Loop v0. It is deterministic for now: the Manager
and Planner update task state, plan steps, events, task conversation, and the
review gate without calling a remote model. The loop runs bounded read-only
repo-context tools: `list_repo_files`, `search_repo_context`, and
`read_context_file`. Search terms come from the task objective, recent task
conversation, and explicit file references; private/generated directories and
oversized files are skipped.

Creating a task records the initial user objective as a task message and asks
the configured provider for a structured intent brief. The task conversation
can continue through
`POST /tasks/:taskID/messages`; each user message gets a new provider-generated
intent brief with summary, constraints, acceptance criteria, open questions,
and next action. User messages can mention repo files with paths such as
`README.md`, `docs/v0_scope.md`, or `@runtime/src/server.ts:120`. The runtime
resolves up to six safe repo-local file references, stores their summaries on
the message, and exposes missing or blocked references without reading outside
the workspace.

The task conversation can also drive planning through
`POST /tasks/:taskID/generate-plan-revision`. It asks the configured model
provider to turn the latest task message and intent brief into a new plan
revision. The runtime replaces the visible plan steps with the revision, clears
any prepared execution proposal, returns the task to `Human Review`, and
requires a fresh plan approval before execution can continue. The endpoint is
blocked while an edit proposal is still proposed or already applied.
When the OpenAI provider is active, plan revision first asks the model for a
bounded context loop. Each round returns either `SearchAndRead` with search
terms and repo-relative read paths or `ReadyForPlan` to stop. The runtime
validates those requests, runs only logged read-only repo tools, stops on
repeated context or the round limit, stores compact context summaries, and only
then asks for the plan revision.

Approving a plan records an approval and opens the controlled execution
preparation phase. The runtime then asks the configured model provider for a
safe execution proposal without applying file changes.
After that, a safe edit proposal can be generated as a proposed diff preview.
It is validated when generated and is not applied to the workspace until the
user explicitly applies it. If the user requests changes, the rejected proposal
can be revised through `POST /tasks/:taskID/revise-edit-proposal`; the runtime
archives the rejected proposal, asks the model provider for a new proposal from
the latest task conversation, validates it, and returns to human review without
writing files. If generated validation is blocked, the runtime can run a
bounded repair loop by feeding failed validation checks back to the model
provider; blocked intermediate proposals are archived as `Superseded`. The
apply path revalidates against the current workspace before writing. The
current apply path is intentionally narrow: it supports append-text on
existing Markdown files, exact replace and multi-hunk exact patch operations
on existing Markdown and allowlisted source/text files, strict single-file
Unified Diff modifications for normal source edits, plus create-file operations
for new `docs/*.md` files. Unified Diffs require matching paths, ordered/count-
correct hunks, and exact current-file context. Cross-file apply/rollback
records transaction evidence, verifies hashes, and compensates partial
failures back to the last verified state.
After apply, the runtime runs controlled built-in validation commands and only
marks the task completed if validation passes.
If validation fails, the runtime asks the model provider for a repair brief
from compact failed command summaries. The brief records likely cause,
recommended actions, and a follow-up prompt without rerunning commands or
editing files.
After a repair brief exists, `POST /tasks/:taskID/generate-validation-repair-proposal`
can create a new proposed repair diff linked to that brief. The previous
applied proposal is archived for audit, the new proposal is validated, and no
files are changed until the user explicitly applies it.
For repair proposals sourced from failed task commands, apply records rerun
evidence but does not rerun the command automatically. The explicit
`POST /tasks/:taskID/rerun-repair-command` endpoint reruns the original failed
command through the same approved command runner and links the new command run
to the failed source run, repair brief, and applied proposal.

`POST /tasks/:taskID/run-agent-step` asks the active model provider for one
safe next action and then lets the runtime enforce the same gates as the
manual endpoints. The current action enum can inspect the repository, generate
an edit proposal, run an approved task command, generate a validation repair
proposal, rerun reviewed self-fix evidence, wait for human review, or request
plan approval. Inspection accepts bounded provider search terms and optional
repo-relative read paths, but the runtime filters paths and executes only its
logged read-only list/search/read tools. Normalized inspection requests retain
a short fingerprint and visible budget summary; repeated fingerprints block
before duplicate search/read calls. Every decision is stored in
`agentRunSteps` with provider metadata, rationale, inspection evidence, status,
linked target IDs, result summaries, and timestamps. This endpoint is one step
at a time; the bounded loop endpoint chains the same safe boundary.

Inspection search mode is provider-selected but runtime-enforced: `Text` uses
fixed-string ripgrep matching, while `Symbol` adds whole-word identifier
matching. Ripgrep runs without a shell against the bounded safe file list with
JSON output, a five-second timeout, and bounded captured output; unavailable or
failed ripgrep falls back to the existing substring scanner and records the
actual engine on the step.

OpenAI agent-step decision decoding has one bounded format-recovery attempt.
Malformed JSON/schema/required-field/action-enum output is corrected with the
same strict schema. Recovered decisions store attempt/error evidence; two bad
outputs produce a failed safe-wait step and no step tool, command, or mutation.
Transport and HTTP failures are recorded without an automatic retry.

`POST /tasks/:taskID/run-agent-loop` wraps the same runtime-owned step
boundary in a bounded loop. The request can include `maxSteps` from 1 to 8 and
an optional `preferredCommandID` for already-runnable command steps. The loop
records `agentRunLoops`, links each step by ID, and stops at edit-proposal
review gates, passed commands, verified self-fix reruns, blocked/failed
steps, busy-task guards, no-progress guards, or max-step protection. It does
not add new permissions and does not apply patches automatically.

Pause and abort can target only the runtime-owned active loop ID and take
effect after the current safe step; they do not kill an in-flight provider call
or command. Resume accepts a paused, aborted, or failed loop ID and creates a
new bounded loop linked in both directions so history remains auditable.

OpenAI-backed edit proposals can include multiple file changes and
preview-only unsupported operations. Unsupported changes are kept as review
artifacts; validation blocks apply until every proposed change fits the current
restricted apply engine.

The runtime also exposes read-only git review endpoints. `GET /git/status`
returns git root, branch, head, ahead/behind, dirty state, changed files,
staged/unstaged/untracked flags, and available line-count stats. `GET /git/diff`
returns a bounded per-file diff for a repo-relative path from that status
snapshot. Diff responses include display mode, unavailable reason, byte/line
counts, and the app preview line limit so binary and oversized files are
represented clearly. Diff reads are low-risk and run through `git` without a
shell; paths must stay repo-relative and `.git`/`.forge` internals are blocked.
`GET /git/branch-preview` prepares a branch review artifact with current
branch, expected HEAD, default base branch, target branch, create/switch mode,
dirty state, blockers, and risk notes.
`POST /git/branch` is a high-risk local branch action. It requires explicit
confirmation plus the expected HEAD and current branch from the preview,
validates the target branch name, creates a new local branch or switches to an
existing clean local branch, blocks unmerged files and dirty switches, and
records a linked task event when possible. It does not set upstream tracking,
push, merge, reset, delete branches, or create a PR.
`GET /git/branch-publish-preview` prepares a first-push review artifact with
current branch, configured remote, remote branch, default base branch, commits
to publish, local changes that will remain local, blockers, and risk notes.
`POST /git/branch-publish` is a high-risk branch publish action. It requires
explicit confirmation plus the expected HEAD, branch, remote, and remote branch
from the preview. The runtime blocks detached/default-base/already-upstream/
no-commit/unmerged states, blocks remote branch collisions, runs a non-force
`git push --set-upstream <remote> HEAD:<branch>`, and records a linked task
event when possible. It does not force push, merge, reset, delete branches, or
create a PR.
`GET /git/commit-preview` turns the current working tree, optional task
context, and latest task validation state into a review artifact with a
suggested commit message, included files, validation commands to consider,
risk notes, blockers, commit preflight metadata, and an explicit non-mutating
operation boundary. The preflight includes git author identity status, staged/
unstaged/untracked counts, line stats, large-change warnings, validation
state, hook-risk disclosure, and the commit path limit. It does not stage,
commit, push, or mutate the repository.
`POST /git/commit` is the first high-risk git action. It requires explicit
confirmation, the expected HEAD from the reviewed preview, a commit message,
and selected repo-relative paths. The runtime rechecks current git status,
rejects unmerged files and staged files outside the reviewed selection,
preflights git author identity, stages selected paths, creates one local
commit, and records a linked task event when possible. It does not push.
`GET /git/push-preview` summarizes the current branch, upstream, ahead/behind
state, commits to push, uncommitted local changes, blockers, and risk notes.
`POST /git/push` is a high-risk action that requires explicit confirmation
plus the expected HEAD, branch, and upstream from the preview. The runtime
blocks detached/no-upstream/behind/no-ahead/unmerged states and runs a
non-force push to the configured upstream branch. It does not force push,
merge, reset, delete branches, or create a PR.
`GET /git/pr-preview` is a read-only PR handoff artifact. It resolves the
default base branch when possible, compares current branch work against that
base, and returns head/base/upstream state, a suggested branch name, PR title,
draft body, test plan, commits, changed files, blockers, and risk notes. It
does not create, publish, update, close, or comment on pull requests.

Validation presets:

- `forge-post-apply`: low-risk built-in audit checks.
- `runtime-typescript`: medium-risk project commands for `runtime`
  (`npm run check` and `npm run build`). This preset requires task-level
  approval before it can run.
- `macos-swiftpm`: medium-risk project command for the native macOS app
  (`swift build` from the repository root). This preset requires task-level
  approval before it can run.

Workspace presets can be loaded from:

```text
.forge/validation-presets.json
```

Workspace presets can only reference runtime-known command IDs such as
`runtime-npm-check`, `runtime-npm-build`, and `macos-swift-build`; they cannot
define raw shell commands.

Project validation commands are allowlisted by the runtime, run without a
shell, use repo-local cwd values, and record exit code plus output summary.
`GET /tasks/:taskID/validation-permissions` returns a task-specific permission
snapshot for each preset, including approval state, execution state, blocked
reasons, command execution mode, and the last run for that preset.

Task state is persisted locally in SQLite. By default the runtime stores task
snapshots in:

```text
.forge/forge.sqlite
```

Set `FORGE_RUNTIME_DB_PATH` to use a different SQLite file.

The default model provider is local and deterministic:

```text
FORGE_MODEL_PROVIDER=local
FORGE_MODEL_NAME=local-deterministic-v0
```

The runtime also has an optional OpenAI Responses provider:

```text
FORGE_MODEL_PROVIDER=openai
FORGE_MODEL_NAME=gpt-5.5
OPENAI_API_KEY=...
```

Optional OpenAI settings:

```text
FORGE_OPENAI_BASE_URL=https://api.openai.com/v1
FORGE_OPENAI_TIMEOUT_MS=30000
FORGE_OPENAI_MAX_OUTPUT_TOKENS=1800
```

The settings endpoint can update provider configuration while the runtime is
running:

```text
GET /settings/model-provider
POST /settings/model-provider
```

Non-secret settings are persisted in:

```text
.forge/model-provider-settings.json
```

Set `FORGE_MODEL_PROVIDER_SETTINGS_PATH` to use a different non-secret
settings file. The runtime never persists API keys to that file. API keys can
come from `OPENAI_API_KEY` at startup or be sent to the settings endpoint for
the current runtime process. The macOS app stores the OpenAI key in Keychain
and syncs it into runtime memory.

The OpenAI provider uses Responses API Structured Outputs for model-provider
artifacts. It receives compact task and context summaries, not whole
repositories. Before plan revisions it may run a bounded read/search context
loop, but the runtime still owns tool execution, approval gates, validation,
IDs, timestamps, and restricted file apply operations.

`GET /health` returns `modelProviderConfiguration` so the macOS Settings
window can show provider readiness, missing configuration, non-secret settings,
and the remote-context boundary. Secret values are never returned; key status
is reported as `Configured` or `Missing`.

## Development

```bash
cd runtime
npm install
npm run dev
```

The server listens on:

```text
http://127.0.0.1:17373
```

Run the core lifecycle smoke regression:

```bash
cd runtime
npm run smoke:core
```

The smoke command builds the runtime, starts a temporary local runtime process,
uses temporary SQLite and provider settings paths, creates and cleans unique
Markdown fixtures under `docs/`, and verifies create task, file-reference
messages, plan revision, plan approval, edit proposal generation, validation,
apply, post-apply validation, restart recovery, and both append/replace
restricted edit operations. It verifies the runtime status page, health
diagnostics, persistence metadata, and model-provider settings GET/POST paths,
including fake-key handling and confirmation that API keys are not persisted.
It also verifies read-only git status, bounded git diff metadata for text,
binary, and oversized files, branch-preview, stale-head branch rejection,
branch-publish-preview, stale-head branch publish rejection, commit-preview,
commit preflight metadata, stale-head commit rejection, push-preview, and
stale-head push rejection endpoints, plus the read-only PR handoff preview,
against temporary fixtures.
It also starts a
mock OpenAI Responses server to verify the model-guided context loop path
before an OpenAI-backed plan
revision, a richer edit proposal with append/create apply, and a blocked
preview-only artifact. It also verifies a blocked-to-repaired proposal path and
bounded stop behavior for proposals that remain preview-only. The smoke also
verifies a provider-selected repository inspection followed by proposal
generation, including rejection of an unsafe requested path. It then
verifies an identical second inspection is fingerprinted and blocked before
duplicate search/read tool calls. It then
verifies one malformed agent-step decision recovering on its corrective
request and a two-attempt exhaustion path that fails closed. It then
forces a temporary TypeScript validation failure and verifies provider-backed
repair brief generation plus follow-up repair proposal generation before
cleaning the temporary file.

## Example

```bash
curl http://127.0.0.1:17373/health
curl http://127.0.0.1:17373/git/status
curl "http://127.0.0.1:17373/git/diff?path=README.md"
curl "http://127.0.0.1:17373/git/branch-preview"
curl -X POST http://127.0.0.1:17373/git/branch \
  -H 'Content-Type: application/json' \
  -d '{"expectedHead":"<head-from-preview>","expectedCurrentBranch":"main","targetBranch":"forge/demo-task","mode":"CreateBranch","confirmation":"CreateBranch"}'
curl "http://127.0.0.1:17373/git/branch-publish-preview"
curl -X POST http://127.0.0.1:17373/git/branch-publish \
  -H 'Content-Type: application/json' \
  -d '{"expectedHead":"<head-from-preview>","expectedBranch":"forge/demo-task","remote":"origin","remoteBranch":"forge/demo-task","confirmation":"PublishCurrentBranch"}'
curl "http://127.0.0.1:17373/git/commit-preview"
curl "http://127.0.0.1:17373/git/pr-preview"
curl -X POST http://127.0.0.1:17373/git/commit \
  -H 'Content-Type: application/json' \
  -d '{"expectedHead":"<head-from-preview>","title":"Update Forge workspace","body":["Reviewed in Forge."],"paths":["README.md"],"confirmation":"CreateLocalCommit"}'
curl "http://127.0.0.1:17373/git/push-preview"
curl -X POST http://127.0.0.1:17373/git/push \
  -H 'Content-Type: application/json' \
  -d '{"expectedHead":"<head-from-preview>","expectedBranch":"main","expectedUpstream":"origin/main","confirmation":"PushCurrentBranch"}'
curl http://127.0.0.1:17373/settings/model-provider
curl -X POST http://127.0.0.1:17373/settings/model-provider \
  -H 'Content-Type: application/json' \
  -d '{"providerID":"openai","modelName":"gpt-5.5","openAIBaseURL":"https://api.openai.com/v1","openAITimeoutMs":30000,"openAIMaxOutputTokens":1800}'
curl -X POST http://127.0.0.1:17373/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Demo task","objective":"Prove task creation."}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/messages \
  -H 'Content-Type: application/json' \
  -d '{"content":"Make the acceptance criteria explicit before planning. Use `docs/v0_scope.md`."}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/generate-plan-revision \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/approve-plan \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/generate-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/reject-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{"note":"Needs a narrower change."}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/messages \
  -H 'Content-Type: application/json' \
  -d '{"content":"Revise the proposal around a narrower documentation change in @docs/development.md."}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/revise-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/validate-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/apply-edit-proposal \
  -H 'Content-Type: application/json' \
  -d '{}'
curl http://127.0.0.1:17373/validation-presets
curl http://127.0.0.1:17373/tasks/<task-id>/validation-permissions
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/approve-validation-preset \
  -H 'Content-Type: application/json' \
  -d '{"presetID":"runtime-typescript"}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/run-validation \
  -H 'Content-Type: application/json' \
  -d '{"presetID":"runtime-typescript"}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/approve-validation-preset \
  -H 'Content-Type: application/json' \
  -d '{"presetID":"macos-swiftpm"}'
curl -X POST http://127.0.0.1:17373/tasks/<task-id>/run-validation \
  -H 'Content-Type: application/json' \
  -d '{"presetID":"macos-swiftpm"}'
```
