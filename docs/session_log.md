# Forge Session Log

Document role: preserve timestamped working-session history, including conversation summary, done, not done, and next steps.

New session entries should be appended here instead of expanding the root README.

### 2026-07-04 03:34:39 CST +0800

Conversation summary:

- User asked to add a permanent rule that every conversation should end with a
  timestamped record of the discussion and work status.

Done:

- Added the `Session Logging Rule` to the project memory section.
- Added session logging to the AI development rules.
- Created this first timestamped session log entry.

Not done:

- Did not create separate `docs/` files yet.
- Did not initialize a git repository.
- Did not create `AGENTS.md` yet.

Next:

- Create `AGENTS.md` so future AI agents know to read and maintain this README.
- Create the initial `docs/` structure when the product documentation starts
  expanding beyond this README.
- Continue appending session log entries at the end of each working
  conversation.

### 2026-07-04 03:39:48 CST +0800

Conversation summary:

- User asked for a full product plan covering every major aspect of Forge and
  for multiple detailed documents with different record responsibilities.

Done:

- Created the initial `docs/` documentation system.
- Added detailed planning documents for vision, positioning, users, flows,
  workspace design, macOS native strategy, multi-agent architecture, runtime,
  local-first architecture, database design, git workflow, MCP integration,
  security, business model, roadmap, and founder notes.
- Added `AGENTS.md` so future AI coding agents know how to work in this
  repository.
- Updated this README's documentation index to point to the new files.

Not done:

- Did not initialize a git repository.
- Did not scaffold the macOS app or runtime code.
- Did not create visual mockups or a clickable prototype.
- Did not import the full raw shared conversation into
  `docs/founder_conversation.md`.

Next:

- Review and refine each planning document as product direction becomes more
  specific.
- Add `docs/founder_conversation.md` if the full original conversation should
  be preserved verbatim.
- Decide the first narrow MVP workflow to implement.
- Initialize the actual SwiftUI app and local TypeScript runtime when ready.

### 2026-07-04 03:44:20 CST +0800

Conversation summary:

- User asked whether the documentation is ready enough to start building and
  what is still missing.

Done:

- Assessed that the documentation is sufficient for beginning implementation.
- Identified that the remaining gaps are mostly concrete MVP and engineering
  setup decisions, not more broad product planning.

Not done:

- Did not scaffold the app or runtime.
- Did not initialize git.
- Did not choose final implementation details for the first vertical slice.

Next:

- Choose the first MVP workflow.
- Lock the initial technical setup: SwiftUI project shape, TypeScript runtime
  package manager, app-runtime communication, database choice, and first LLM
  provider.
- Start building the Phase 1/2 foundation once those choices are accepted.

### 2026-07-04 03:51:58 CST +0800

Conversation summary:

- User approved starting implementation and asked to create a public GitHub
  repository named `forge` under `windorion`.
- User also asked whether making the project open source can still support a
  subscription business model.

Done:

- Added `.gitignore` to keep local system files and future build artifacts out
  of git.
- Added an open-source/open-core strategy section to
  `docs/business_model.md`.
- Initialized the local git repository.
- Confirmed GitHub CLI is installed.
- Confirmed the current GitHub CLI token is invalid and remote creation/push is
  blocked until re-authentication.

Not done:

- Did not create the remote `windorion/forge` repository because `gh auth
  status` reports an invalid token for the current GitHub account.
- Did not push to GitHub yet.
- Did not choose a final open-source license.

Next:

- Re-authenticate GitHub CLI with `gh auth login -h github.com`.
- Create the public `windorion/forge` repository.
- Push the local `main` branch to GitHub.
- Decide the license strategy after the first working vertical slice, or sooner
  if public contributions begin.

### 2026-07-04 03:54:55 CST +0800

Conversation summary:

- User confirmed GitHub login was complete and asked to configure the remote
  repository and push the project.

Done:

- Verified GitHub CLI authentication outside the sandbox.
- Confirmed `windorion/forge` did not already exist.
- Created the public GitHub repository `windorion/forge`.
- Added `origin` as `https://github.com/windorion/forge.git`.
- Pushed local `main` to GitHub.

Not done:

- Did not add a license yet.
- Did not scaffold the SwiftUI app or TypeScript runtime yet.

Next:

- Decide whether to add a temporary "all rights reserved" notice, Apache 2.0,
  AGPL, or another license.
- Start the Phase 1/2 implementation: SwiftUI app shell plus local TypeScript
  runtime skeleton.

### 2026-07-04 04:04:01 CST +0800

Conversation summary:

- User said the basic preparation was done and asked about the next step for
  writing code.

Done:

- Started Phase 1/2 implementation.
- Added a SwiftPM-based SwiftUI macOS app shell named `ForgeApp`.
- Added a task-centered workspace UI with task list, planner, agent status,
  runtime events, review panel, and runtime controls.
- Added a local TypeScript runtime skeleton under `runtime/`.
- Implemented runtime endpoints: `GET /health`, `GET /tasks`, `POST /tasks`,
  and `GET /events` for Server-Sent Events.
- Added `docs/development.md` and runtime run instructions.
- Verified `swift build` succeeds.
- Verified `npm run check` and `npm run build` succeed for the runtime.
- Verified runtime `/health` and `POST /tasks` responses locally.

Not done:

- Did not wire the SwiftUI app to consume the SSE event stream yet.
- Did not add SQLite persistence.
- Did not add repository scanning, LLM calls, or file editing tools.
- Did not add a license yet.

Next:

- Wire runtime event streaming into the SwiftUI app.
- Add SQLite-backed task persistence to replace in-memory runtime tasks.
- Add repository picker and workspace records.
- Decide and add the initial license strategy.

### 2026-07-04 04:14:57 CST +0800

Conversation summary:

- User reported that opening `http://127.0.0.1:17373/` in the in-app browser
  showed "site can't be reached."

Done:

- Started the local Forge runtime on `127.0.0.1:17373`.
- Verified `GET /health` returns `200 OK`.
- Found that root path `/` returned `404` even when the runtime was healthy.
- Added a browser-friendly root status page for `GET /`.
- Updated runtime and development docs to mention the root status page.
- Verified `GET /` and `GET /health` both return `200 OK`.

Not done:

- Did not start the SwiftUI app in this turn.
- Did not wire SSE into the SwiftUI app.
- Did not add SQLite persistence.

Next:

- Keep the runtime running while testing the browser page.
- Run `swift run ForgeApp` in another terminal to test the app shell against the
  running runtime.
- Next implementation step remains app-side SSE consumption or SQLite task
  persistence.

### 2026-07-04 04:19:44 CST +0800

Conversation summary:

- User asked why `http://127.0.0.1:17373/` was not a Mac app and why the page
  preview did not show the product UI.

Done:

- Clarified that the browser URL is only the local runtime service, not the
  SwiftUI macOS app.
- Added `script/build_and_run.sh` as the project-local macOS build/run
  entrypoint.
- Added `.codex/environments/environment.toml` so Codex can expose a Run action
  for the native app.
- Updated development docs to prefer `./script/build_and_run.sh`.
- Added app activation logic so the SwiftUI window is more likely to come to
  the foreground when launched as `dist/Forge.app`.
- Verified the app builds and launches through `./script/build_and_run.sh
  --verify`.

Not done:

- Did not replace the runtime status page with the main product UI.
- Did not bundle or auto-start the runtime from inside the app yet.
- Did not add persistence or real agent execution.

Next:

- Keep using `./script/build_and_run.sh` or the Codex Run action to launch the
  native app.
- Add runtime auto-start from the macOS app so users do not need two separate
  terminal processes.
- Continue with SQLite persistence or SSE event consumption.

### 2026-07-04 04:23:56 CST +0800

Conversation summary:

- User asked to stop the local services and commit the current state.

Done:

- Stopped the running Forge runtime process.
- Closed the running Forge macOS app process.
- Verified `127.0.0.1:17373` no longer responds to `/health`.
- Confirmed the working tree had no code changes before adding this log.

Not done:

- Did not make product or code changes in this turn.
- Did not restart the runtime or app after stopping them.

Next:

- Restart runtime with `cd runtime && npm run dev` when backend testing is
  needed.
- Launch the native app with `./script/build_and_run.sh` when UI testing is
  needed.
- Continue with runtime auto-start, SSE consumption, or SQLite persistence.

### 2026-07-04 04:30:00 CST +0800

Conversation summary:

- User noted that the current product still does not feel like an agent and
  asked whether that is because no model has been connected yet.

Done:

- Clarified that the current implementation is still an app/runtime skeleton.
- Identified that the missing "agent feeling" comes from the lack of LLM
  provider integration, tool calling, repository context, planning,
  execution, validation, and visible agent progress.

Not done:

- Did not change product code in this turn.
- Did not connect an LLM provider yet.
- Did not implement the agent loop yet.

Next:

- Build the first true agent loop: task input, context builder, model call,
  tool proposal, visible plan, and human review gate.
- Add a fake/local planner first if needed, then replace it with a real model
  provider.
- Make the UI show observable agent behavior rather than only static task
  panels.

### 2026-07-04 16:11:40 CST +0800

Conversation summary:

- User asked what to do next and asked Codex to proceed.

Done:

- Implemented Agent Loop v0 in the TypeScript runtime.
- Added dynamic task plan steps, agent states, changed files, and review
  summary fields.
- Changed task creation so the runtime now advances tasks through planning,
  context building, plan drafting, and human review gate.
- Added SSE `task.updated` broadcasting and app-side event stream consumption.
- Added a sidebar task composer in the SwiftUI app.
- Updated planner and review panels to show runtime-driven task state instead
  of fixed static content.
- Updated development docs and runtime docs for Agent Loop v0.
- Verified `npm run check`, `npm run build`, `swift build`, runtime task
  creation, loop progression to `Human Review`, and native app launch via
  `./script/build_and_run.sh --verify`.

Not done:

- Did not connect a real LLM provider yet.
- Did not add actual repository scanning, file reading, file editing, test
  running, or git diff generation.
- Did not add SQLite persistence.
- Did not keep runtime or app running after validation.

Next:

- Add a real tool layer starting with read/search project files.
- Add a model-provider abstraction so Agent Loop v0 can be replaced by a real
  planner.
- Add SQLite persistence so tasks survive runtime restarts.

### 2026-07-04 16:18:52 CST +0800

Conversation summary:

- User asked what the next step is, asked Codex to keep pushing forward, and
  asked what the v0 endpoint should look like.

Done:

- Defined the v0 endpoint in `docs/v0_scope.md`: native app plus local runtime,
  task creation, real local context inspection, visible tool calls/context
  files, visible agent progress, and a human review gate before changes.
- Added local read-only runtime tools for listing project docs and reading
  selected context files.
- Added `toolCalls` and `contextFiles` to the runtime task model and macOS app
  model.
- Added macOS panels for context files and tool calls.
- Updated docs indexes and development docs for the new v0 scope and local
  tool layer.
- Verified `npm run check`, `npm run build`, `swift build`, and runtime task
  creation through `Human Review` with no changed files.

Not done:

- Did not connect a real LLM provider yet.
- Did not implement autonomous file edits, command execution, tests, git diff
  generation, or SQLite persistence.
- Did not keep the local runtime running after verification.

Next:

- Add SQLite persistence so tasks and tool-call history survive restarts.
- Add explicit plan approval UI so the user can advance from human review into
  a controlled execution phase.
- Add a model-provider abstraction and wire the first real planner model.

### 2026-07-04 16:26:32 CST +0800

Conversation summary:

- User asked Codex to continue with the next step after defining and verifying
  the v0 local context tool layer.

Done:

- Added SQLite-backed runtime task persistence.
- Added `runtime/src/taskStore.ts` with schema setup, task snapshot loading,
  and task saving.
- Changed the runtime to load tasks from SQLite on startup and save task state
  during creation, tool calls, agent loop updates, and failure handling.
- Added `.forge/` to `.gitignore`; the default database path is
  `.forge/forge.sqlite`.
- Added runtime health persistence metadata with database path and task count.
- Updated development, runtime, and database docs for the current persistence
  model.
- Verified `npm run check`, `npm run build`, `swift build`, task creation,
  progression to `Human Review`, runtime restart, and task recovery from
  SQLite.

Not done:

- Did not implement the full normalized runs/messages/tool-calls/commands
  schema yet.
- Did not add explicit plan approval UI yet.
- Did not connect a real LLM provider yet.
- Did not keep the local runtime running after verification.

Next:

- Add an explicit plan approval action and UI so a task can move from human
  review into a controlled execution phase.
- Split the task snapshot store into normalized audit tables as the runtime
  starts executing real tools.
- Add the model-provider abstraction for the first real planner.

### 2026-07-04 17:07:01 CST +0800

Conversation summary:

- User asked Codex to continue with the next step after SQLite task
  persistence.

Done:

- Added a real plan approval flow.
- Added `POST /tasks/:taskID/approve-plan` to the runtime.
- Added approval records to the task model and persisted them in SQLite task
  snapshots.
- Changed approved tasks to move from `Human Review` into `Running` with
  `Execution Preparation` as the current phase.
- Added plan steps for controlled execution preparation and waiting for edit
  tools.
- Added Swift runtime client support for approving a plan.
- Enabled the Review panel `Approve Plan` button when a task is waiting for
  human review.
- Added visible approval history in the macOS Review panel.
- Updated runtime, development, database, and v0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`, task creation,
  plan approval, duplicate approval rejection with `409`, and SQLite recovery
  of approval history after runtime restart.

Not done:

- Did not implement request-changes behavior yet.
- Did not run model-driven edits after approval.
- Did not add file diffs, command execution, tests, or normalized approval
  tables yet.
- Did not keep the local runtime running after verification.

Next:

- Add the first model-provider abstraction so the approved execution phase can
  be driven by a real planner model.
- Add a safe edit proposal flow that creates a reviewable diff without
  silently changing files.
- Add request-changes handling so users can send a plan back to the Planner.

### 2026-07-04 17:19:46 CST +0800

Conversation summary:

- User asked Codex to continue with the next step after the plan approval
  flow.

Done:

- Added the first model-provider abstraction in the runtime.
- Added a default local deterministic provider that requires no API key.
- Added provider metadata to runtime health.
- Added execution proposals to task state.
- Changed plan approval so it records approval, asks the provider for a safe
  execution proposal, records `model.execution.proposed`, and still applies no
  file changes.
- Added Swift models and Review panel UI for execution proposals.
- Added `docs/model_providers.md` and updated the documentation index,
  runtime architecture, development docs, database docs, runtime README, and
  v0 scope.
- Verified `npm run check`, `npm run build`, `swift build`, provider metadata
  in `/health`, execution proposal generation after approval, and SQLite
  recovery of execution proposals after runtime restart.

Not done:

- Did not connect a real remote LLM provider yet.
- Did not add API key settings or model selection UI yet.
- Did not generate or apply file edits yet.
- Did not keep the local runtime running after verification.

Next:

- Add a safe edit proposal flow that turns execution proposals into a
  reviewable diff without silently changing files.
- Add a concrete remote or local LLM provider implementation behind the new
  provider interface.
- Add request-changes handling so users can send a plan or proposal back to the
  Planner.

### 2026-07-04 17:29:54 CST +0800

Conversation summary:

- User asked Codex to continue with a longer next task after the
  model-provider abstraction work.

Done:

- Added the safe edit proposal flow.
- Added `POST /tasks/:taskID/generate-edit-proposal` to the runtime.
- Extended the model-provider interface so providers can generate proposed
  file changes and diff previews.
- Added `editProposal` to runtime and Swift task models.
- Added proposed file change data with path, change type, rationale, and diff
  preview.
- Changed the runtime so generated edit proposals return the task to
  `Human Review` with current phase `Edit Proposal Review`.
- Kept the safety boundary: generated proposals do not mutate files, and
  `changedFiles` remains empty.
- Added macOS Review panel UI for edit proposals, proposed files, and diff
  previews.
- Made the Review panel scroll so longer proposal details remain usable.
- Added `docs/edit_proposals.md` and updated documentation indexes, runtime
  architecture, development docs, database docs, runtime README, model-provider
  docs, v0 scope, and this README.
- Verified `npm run check`, `npm run build`, `swift build`, task creation,
  plan approval, edit proposal generation, no changed files, and SQLite
  recovery of edit proposals after runtime restart.

Not done:

- Did not add apply/reject controls for edit proposals yet.
- Did not mutate workspace files.
- Did not connect a real remote LLM provider.
- Did not normalize edit proposals into dedicated database tables yet.
- Did not keep the local runtime running after verification.

Next:

- Add approve/apply/reject controls for edit proposals while preserving an
  explicit human approval boundary.
- Add patch applicability validation before any apply step can write files.
- Add a concrete remote or local LLM provider implementation behind the model
  provider interface.

### 2026-07-04 17:38:45 CST +0800

Conversation summary:

- User asked Codex to continue the task and preferred a substantial longer
  work session.

Done:

- Added explicit edit proposal decision endpoints:
  `POST /tasks/:taskID/apply-edit-proposal` and
  `POST /tasks/:taskID/reject-edit-proposal`.
- Added restricted `AppendText` apply operations to proposed file changes.
- Added runtime path safety checks for proposal application:
  repo-local paths only, existing Markdown files only, limited to `README.md`
  or `docs/*.md`, with `.git`, `.forge`, absolute paths, and parent traversal
  rejected.
- Added task state transitions for rejected and applied proposals.
- Recorded apply/reject decisions in approval history.
- Updated Swift models, runtime client, workspace state, and Review panel
  buttons for applying or requesting changes on edit proposals.
- Allowed rejected proposals to be regenerated.
- Updated edit proposal, development, runtime, architecture, model-provider,
  and v0 scope docs to match the new apply/reject boundary.
- Verified `npm run check`, `npm run build`, `swift build`, and an end-to-end
  runtime smoke test covering create task, approve plan, generate proposal,
  reject proposal with no changed files, regenerate proposal, and apply
  proposal with `changedFiles` recorded.

Not done:

- Did not add a general patch interpreter.
- Did not add real model-generated code edits.
- Did not add test-runner integration after apply.
- Did not connect a remote LLM provider.
- Did not normalize proposal decisions into dedicated database tables.

Next:

- Add patch applicability validation and preview against the live working tree.
- Add a real provider implementation behind the model-provider interface.
- Add post-apply validation commands and visible test results.
- Add stronger revision history for multiple proposal attempts.

### 2026-07-04 17:56:17 CST +0800

Conversation summary:

- User asked Codex to continue the next implementation step.

Done:

- Added edit proposal validation data to runtime and Swift task models.
- Added `POST /tasks/:taskID/validate-edit-proposal`.
- Made edit proposal generation automatically validate proposed file changes
  against the current workspace.
- Made apply revalidate immediately before writing files.
- Added validation checks for supported change type, supported apply
  operation, edit size, safe Markdown path, existing target file, and duplicate
  append text at the target file end.
- Added blocked validation state so apply attempts can return to human review
  without writing files.
- Added macOS Review panel UI for validation status, per-file validation
  results, and manual validation refresh.
- Updated edit proposal, development, runtime, database, architecture,
  model-provider, and v0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`, a full runtime
  smoke test for validation/apply, duplicate-append blocking, and SQLite
  recovery of validation results after runtime restart.

Not done:

- Did not add a general patch interpreter.
- Did not add real model-generated code edits.
- Did not add post-apply test command execution.
- Did not add normalized validation tables.
- Did not keep the local runtime running after verification.

Next:

- Add a richer patch proposal format beyond append-text.
- Add post-apply validation commands and visible test results.
- Add proposal revision history for multiple attempts.
- Add a concrete remote or local LLM provider implementation.

### 2026-07-04 18:10:38 CST +0800

Conversation summary:

- User asked Codex to continue with a longer next task and use the remaining
  work budget productively.

Done:

- Added post-apply validation runs to runtime and Swift task models.
- Added `POST /tasks/:taskID/run-validation`.
- Changed edit proposal apply flow so applied tasks enter `Testing`, run
  controlled validation, and only become `Completed` after validation passes.
- Added built-in validation commands:
  `forge:changed-files-exist`, `forge:applied-proposal-recorded`, and
  `forge:ready-validation-retained`.
- Stored command-level validation results with trigger, status, output summary,
  start time, and end time.
- Added macOS Review panel UI for `Validation Runs` and a `Run Validation
  Again` action after an applied proposal exists.
- Updated runtime, development, security, database, edit proposal, runtime
  architecture, and v0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`, post-apply
  validation, manual validation rerun, SQLite recovery of validation runs, and
  stopped the local runtime after verification.

Not done:

- Did not run arbitrary shell commands as validation yet.
- Did not wire project-specific test commands such as `npm test` or
  `swift test`.
- Did not add command permission prompts.
- Did not normalize validation runs into dedicated SQLite tables.
- Did not connect a real LLM provider.

Next:

- Add a permissioned command runner for project test commands.
- Add validation command presets and per-workspace settings.
- Add richer patch proposal format beyond append-text.
- Add proposal revision history for multiple attempts.

### 2026-07-05 02:25:09 CST +0800

Conversation summary:

- User asked Codex to continue with a long task and use the remaining work
  budget productively.

Done:

- Committed and pushed the previous post-apply validation checkpoint as
  `e38efd7`.
- Added validation preset data models for runtime and Swift.
- Added `GET /validation-presets`.
- Added `POST /tasks/:taskID/approve-validation-preset`.
- Extended `POST /tasks/:taskID/run-validation` to accept a preset id.
- Added the low-risk `forge-post-apply` preset for built-in audit checks.
- Added the medium-risk `runtime-typescript` preset for `npm run check` and
  `npm run build` in `runtime/`.
- Required task-level approval before running medium-risk validation presets.
- Added allowlisted project command execution with `spawn`, `shell: false`,
  repo-local cwd validation, timeout, exit code capture, and output summary.
- Added macOS Review panel UI for project validation presets, approval state,
  command list, and run action.
- Updated runtime, development, architecture, security, database, edit
  proposal, and v0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`, preset listing,
  unapproved preset blocking, approved runtime checks, exit-code recording, and
  SQLite recovery of preset approval plus validation runs after restart.

Not done:

- Did not expose arbitrary shell command execution.
- Did not add per-workspace custom validation presets.
- Did not add settings UI for validation presets.
- Did not normalize validation preset approvals into dedicated SQLite tables.
- Did not connect a real LLM provider.

Next:

- Add per-workspace validation preset settings.
- Add a permission prompt surface for command execution.
- Add richer patch proposal format beyond append-text.
- Add proposal revision history for multiple attempts.

### 2026-07-05 02:46:13 CST +0800

Conversation summary:

- User asked Codex to continue the next step as a long task.

Done:

- Added workspace validation preset config support through
  `.forge/validation-presets.json`.
- Added `FORGE_VALIDATION_PRESET_CONFIG_PATH` for runtime validation preset
  config overrides.
- Restricted workspace presets to runtime-known command IDs instead of raw
  command strings.
- Added workspace preset source metadata and config status to
  `GET /validation-presets`.
- Added validation run `presetSource` persistence and migration for older task
  payloads.
- Updated the macOS Review panel to show preset source and validation run
  source.
- Updated the macOS Settings window to show workspace validation preset config
  path, existence, and parsing issues.
- Added `docs/validation_presets.md` and updated runtime, development,
  architecture, security, database, and v0 scope docs.
- Verified the workflow with `npm run check`, `npm run build`, `swift build`,
  and an end-to-end API smoke test covering workspace config loading,
  unapproved preset blocking, approval, command execution, and persistence
  after runtime restart.
- Stopped the temporary local runtime service and cleaned temporary smoke-test
  files.

Not done:

- Did not allow workspace config to define arbitrary shell commands.
- Did not add an in-app editor for `.forge/validation-presets.json`.
- Did not normalize validation presets, config issues, or validation runs into
  dedicated SQLite tables.
- Did not add non-runtime command catalog entries yet.
- Did not connect a real LLM provider.

Next:

- Add a visible permission prompt surface for project command execution.
- Expand the validation command catalog to cover app build and test commands.
- Add richer patch proposal formats beyond append-only Markdown edits.
- Add proposal revision history for multiple attempts.

### 2026-07-05 03:07:50 CST +0800

Conversation summary:

- User asked Codex to continue the next step as a long task and use the
  available work budget.

Done:

- Added runtime validation permission snapshots at
  `GET /tasks/:taskID/validation-permissions`.
- Added task-specific approval state, execution state, blocked reasons,
  command execution mode, command boundary, and last-run metadata for validation
  presets.
- Added a runtime guard that prevents starting a second validation run while
  another run is still active.
- Extended validation command manifests with `BuiltIn` and `SpawnNoShell`
  execution modes plus user-facing boundary text.
- Updated macOS models and runtime client to decode validation permission
  snapshots.
- Updated `WorkspaceModel` to refresh permission snapshots after task updates,
  validation approvals, validation runs, event-stream updates, and task
  selection changes.
- Reworked the Review panel from a simple preset list into command permission
  request cards that show runtime-derived state, approval status, blocked
  reasons, command manifest, command boundary, and last run.
- Updated runtime, development, architecture, security, validation preset, and
  v0 scope docs.
- Verified `npm run check`, `npm run build`, `git diff --check`, and one
  successful `swift build` after the Swift UI/model changes.

Not done:

- Could not run the final local runtime API smoke test because sandboxed
  localhost binding failed and the required escalation was rejected by the
  current Codex usage limit.
- Could not rerun the final `swift build` after docs-only edits for the same
  usage-limit reason, although Swift had already passed after the code changes.
- Did not commit or push this checkpoint because git index/remote writes need
  escalation and escalation is currently blocked by usage limits.
- Did not expand the validation command catalog beyond runtime TypeScript
  checks.
- Did not add an in-app editor for workspace validation preset config.

Next:

- After usage resets, run the permission endpoint API smoke test with a
  temporary runtime database.
- Rerun final `swift build`.
- Commit and push the permission surface checkpoint.
- Add macOS app build/test entries to the validation command catalog.
- Add richer patch proposal formats beyond append-only Markdown edits.

### 2026-07-05 14:37:27 CST +0800

Conversation summary:

- User pointed out that the current agent still felt like a mimic rather than
  a chat-driven agent that understands task intent, then asked Codex to plan
  and continue a long next task.

Done:

- Added task-scoped conversation messages to the runtime task model.
- Added structured intent briefs with summary, constraints, acceptance
  criteria, open questions, and next action.
- Extended the model-provider contract with deterministic local
  `createIntentBrief` output.
- Creating a task now records the initial objective as a user message and
  creates an assistant intent brief.
- Added `POST /tasks/:taskID/messages` so users can clarify a task and receive
  an updated intent brief.
- Persisted task messages in the existing SQLite task snapshot payload with
  migration fallback for older tasks.
- Added Swift models, runtime client method, workspace state, sending state,
  and a main workspace `Task Conversation` panel.
- Updated runtime, model provider, runtime architecture, database,
  development, workspace design, user flow, and v0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`, task conversation
  API smoke test, and SQLite recovery of messages after runtime restart.

Not done:

- Did not connect a real LLM provider yet.
- Did not add streaming token-by-token chat output.
- Did not normalize messages into dedicated SQLite tables.
- Did not make follow-up messages alter existing plans or proposals yet.
- Did not add attachment, file mention, or code selection context to messages.

Next:

- Connect task conversation to real provider-backed planning when OpenAI or a
  local model provider is configured.
- Let follow-up messages request proposal revisions.
- Add file mentions or selected-code context to task messages.
- Normalize task messages into dedicated SQLite tables.

### 2026-07-05 15:39:36 CST +0800

Conversation summary:

- User asked Codex to continue the next step and plan a long task after noting
  that the current agent still felt more like mimicry than a chat-driven agent.

Done:

- Added conversation-driven plan revisions to the runtime model.
- Extended the model-provider contract with deterministic local
  `createPlanRevision` output.
- Added `POST /tasks/:taskID/generate-plan-revision`.
- Generating a plan revision now uses the latest task conversation and intent
  brief, records provider/source/rationale/risk/steps, replaces visible plan
  steps, clears any prepared execution proposal, and returns the task to
  `Human Review`.
- Plan approvals now target the current plan revision when one exists, so old
  approvals do not silently approve revised plans.
- Added macOS runtime client, workspace state, conversation-panel button, and
  Planner panel revision card for plan revisions.
- Added a guard so the initial deterministic Agent Loop v0 stops applying
  scheduled updates after a plan revision, plan approval, execution proposal,
  or edit proposal advances the task.
- Updated runtime, model provider, runtime architecture, database,
  development, workspace design, user flow, and v0 scope docs.
- Verified `git diff --check`, `npm run check`, `npm run build`,
  `swift build`, API smoke for two plan revisions and targeted approvals, and
  SQLite recovery after runtime restart.
- Stopped the temporary runtime service and removed temporary smoke-test files.

Not done:

- Did not connect a real LLM or local model provider yet.
- Did not add token streaming for planning or chat.
- Did not allow editing plan steps manually in the UI.
- Did not normalize plan revisions into a dedicated SQLite table.
- Did not generate revised edit proposals from conversation after an edit
  proposal already exists.

Next:

- Connect real provider-backed planning to the new plan revision boundary.
- Add a request-changes flow that can revise an existing edit proposal safely.
- Add file mentions or selected-code context to task messages.
- Add macOS app build/test entries to validation presets.
- Decide whether plan revisions need dedicated persistence tables before v0.1.

### 2026-07-05 21:15:08 CST +0800

Conversation summary:

- User asked Codex to continue the next step, so Codex implemented the
  request-changes edit proposal revision loop.

Done:

- Added edit proposal revision metadata: source message id, revision number,
  previous proposal id, and proposal revision history.
- Added `POST /tasks/:taskID/revise-edit-proposal`.
- Rejected edit proposals are now archived before a revised proposal replaces
  the current review artifact.
- Revised proposals are generated from the latest task conversation and intent
  brief, validated immediately, and returned to `Human Review` without
  changing files.
- Updated the macOS app so the existing proposal action becomes
  `Revise Edit Proposal` after rejection, and the Review panel shows current
  revision metadata plus previous proposal history.
- Updated runtime, edit proposal, model provider, runtime architecture,
  database, development, workspace design, user flow, and v0 scope docs.
- Verified `git diff --check`, `npm run check`, `npm run build`,
  `swift build`, API smoke for reject -> message -> revise, and SQLite
  recovery of current and historical proposal revisions after runtime restart.
- Stopped the temporary runtime service and removed temporary smoke-test files.

Not done:

- Did not connect a real model provider yet.
- Did not add manual editing of proposed diffs.
- Did not normalize edit proposal revisions into dedicated SQLite tables.
- Did not apply revised proposals in the smoke test, to keep the test from
  mutating project files.

Next:

- Add file mentions or selected-code context to task messages.
- Add richer diff proposal formats beyond append-only Markdown edits.
- Add macOS app build/test entries to validation presets.
- Consider a dedicated normalized table for proposal revisions before v0.1.

### 2026-07-05 21:31:18 CST +0800

Conversation summary:

- User asked Codex to continue the next step, so Codex implemented repo-local
  file mentions for task conversation messages.

Done:

- Added `TaskFileReference` metadata to task messages.
- Runtime now parses file mentions from task objectives and follow-up
  messages, including backtick paths, `@path` mentions, and optional line
  ranges such as `@runtime/src/server.ts:120`.
- File references are resolved read-only inside the repository, capped to six
  references per message, and stored as `Resolved`, `Missing`, or `Blocked`.
- Model-provider intent briefs, plan revisions, execution proposals, and safe
  edit proposals can now use resolved file-reference context.
- Mentioned editable Markdown files are preferred as safe edit proposal targets
  while preserving the existing append-only approval boundary.
- macOS Task Conversation now shows file-reference cards on each message.
- Updated runtime, model provider, runtime architecture, database,
  development, workspace design, user flow, v0 scope, and root README docs.
- Verified `git diff --check`, `npm run check`, `npm run build`,
  `swift build`, API smoke for resolved/missing/blocked file references, and
  SQLite recovery after runtime restart.
- Stopped the temporary runtime service and removed temporary smoke-test files.

Not done:

- Did not add selected-code attachments from the active editor yet.
- Did not build autocomplete or picker UI for file mentions.
- Did not normalize message file references into dedicated SQLite tables.
- Did not connect a real model provider yet.

Next:

- Add selected-code or file-picker context to task messages.
- Add richer diff proposal formats beyond append-only Markdown edits.
- Add macOS app build/test entries to validation presets.
- Consider normalized tables for messages and file references before v0.1.

### 2026-07-05 22:03:33 CST +0800

Conversation summary:

- User asked Codex to continue the next step, so Codex added native macOS app
  build coverage to the controlled validation preset system.

Done:

- Added runtime-known project command `macos-swift-build` for `swift build`
  from the repository root.
- Added built-in medium-risk preset `macos-swiftpm`, requiring task-level
  approval before it can run.
- Fixed project command cwd handling so runtime-owned commands can safely run
  from the repository root when no subdirectory cwd is set.
- Updated runtime, validation preset, development, runtime architecture, v0
  scope, and root README docs.
- Verified `git diff --check`, `npm run check`, `npm run build`,
  `swift build`, API smoke for preset listing, approval, `swift build`
  validation execution, and SQLite recovery after runtime restart.
- Stopped the temporary runtime service and removed temporary smoke-test files.

Not done:

- Did not add an Xcode test or UI test preset yet.
- Did not add per-workspace approval memory or revocation.
- Did not add a settings editor for workspace validation presets.

Next:

- Add richer diff proposal formats beyond append-only Markdown edits.
- Add selected-code or file-picker context to task messages.
- Consider Xcode or Swift test presets once tests exist.
- Consider normalized tables for validation runs before v0.1.

### 2026-07-06 01:28:50 CST +0800

Summary:

- User asked for an objective status assessment: where Forge is now, how far it
  is from a finished product, and what capabilities the finished product should
  ultimately have.

Done:

- Re-read the project constitution, document map, v0 scope, roadmap, runtime
  architecture, development notes, macOS-native plan, model provider notes,
  validation preset notes, workspace design, and user flows.
- Inspected the current runtime and macOS app implementation surfaces.
- Confirmed the working tree was clean before this session log.
- Verified the current runtime still passes `npm run check` and
  `npm run build`.
- Verified the current SwiftPM macOS app still passes `swift build`.

Not done:

- Did not change runtime or app behavior.
- Did not add new product scope or roadmap decisions.
- Did not start local runtime or launch the macOS app UI.

Next:

- Decide whether the next implementation focus should be real model provider
  wiring, repository context/search, richer edit proposals, or native macOS
  product polish.
- For product progress, prioritize the first workflow where Forge understands a
  task well enough to inspect relevant files and propose a real reviewable code
  change.

### 2026-07-06 03:15:55 CST +0800

Summary:

- User asked to continue the next step, so Codex advanced Forge from static
  project-memory inspection toward task-intent repository context search.

Done:

- Re-read the required project rules and task-specific docs.
- Added Agent Loop v0 repo context tools: `list_repo_files`,
  `search_repo_context`, and bounded `read_context_file` selection.
- Added safe repo scanning boundaries that skip private/generated directories
  and oversized files.
- Added task-derived search terms from objective, recent conversation,
  explicit file references, and common Chinese intent words.
- Added path/content scoring, matched-line snippets, and improved tool output
  summaries for object search results.
- Kept the existing macOS Context Files and Tool Calls panels as the display
  surface, since their current data model already renders the new results.
- Updated runtime, local-first, runtime architecture, v0 scope, development,
  runtime README, and root README decision notes.
- Verified `git diff --check`, `npm run check`, `npm run build`,
  `swift build`, and an HTTP API smoke test with a temporary runtime and
  SQLite database.
- Stopped the temporary runtime and removed temporary smoke-test files.

Not done:

- Did not add Tree-sitter, symbol search, embeddings, or a persistent
  repository index.
- Did not wire a real remote or local LLM provider.
- Did not expand edit proposals beyond the current Markdown append operation.

Next:

- Add a real model provider path or a provider configuration surface.
- Add richer edit proposal operations so context search can lead to real
  reviewable code diffs.
- Consider a persistent repository index after the first model-backed
  task-to-diff loop works.

### 2026-07-06 03:23:17 CST +0800

Summary:

- User asked to continue the next step, so Codex added the first real remote
  model-provider path while keeping local deterministic mode as the default.

Done:

- Used official OpenAI documentation to verify Responses API and Structured
  Outputs shape before implementation.
- Added optional `FORGE_MODEL_PROVIDER=openai` support backed by the OpenAI
  Responses API.
- Kept `FORGE_MODEL_PROVIDER=local` as the default.
- Added OpenAI provider configuration through `OPENAI_API_KEY`,
  `FORGE_MODEL_NAME`, `FORGE_OPENAI_BASE_URL`,
  `FORGE_OPENAI_TIMEOUT_MS`, and `FORGE_OPENAI_MAX_OUTPUT_TOKENS`.
- Added structured JSON schemas and local normalization for intent briefs,
  plan revisions, execution proposals, and edit proposal guidance.
- Preserved the safety boundary: remote model output remains guidance only,
  while IDs, timestamps, validation, approvals, and restricted apply operations
  stay inside the runtime.
- Updated model provider, development, runtime, security, and root README
  docs.
- Verified `git diff --check`, `npm run check`, `npm run build`,
  `swift build`, and a no-network provider smoke test for missing
  `OPENAI_API_KEY`.

Not done:

- Did not call the live OpenAI API because no API key was provided.
- Did not add a macOS Settings UI for provider configuration.
- Did not add Anthropic, Ollama, or Apple/MLX providers.
- Did not expand edit application beyond restricted Markdown append.

Next:

- Add provider status and configuration visibility in the macOS Settings UI.
- Add a live OpenAI smoke test path once an API key is intentionally provided.
- Add richer edit proposal operations so model-backed guidance can become real
  reviewable code diffs.

### 2026-07-06 03:30:56 CST +0800

Summary:

- User asked for a longer next task, so Codex added runtime-derived model
  provider configuration visibility and surfaced it in the native macOS
  Settings window.

Done:

- Re-read required project rules, model-provider docs, development notes, and
  macOS SwiftUI Settings guidance.
- Added `ModelProviderConfiguration` and config item types to runtime task
  types and Swift app models.
- Added `getModelProviderConfigurationFromEnv()` so provider readiness,
  missing configuration, non-secret settings, and remote-context boundaries are
  derived from the same environment as the active provider.
- Extended `GET /health` with `modelProviderConfiguration`.
- Rebuilt macOS Settings as native tabs for Runtime, Model, and Validation.
- Added a Model Settings tab showing provider status, configured provider id,
  model, mode, non-secret settings, missing key issues, and remote-context
  boundary.
- Updated model provider, development, runtime, v0 scope, security, and root
  README docs.
- Verified `git diff --check`, `npm run check`, `npm run build`,
  `swift build`, and an HTTP `/health` smoke test for
  `FORGE_MODEL_PROVIDER=openai` without an API key.
- Stopped the temporary runtime and removed temporary smoke-test files.

Not done:

- Did not add editable provider settings in the macOS UI.
- Did not store API keys in Keychain.
- Did not call the live OpenAI API.
- Did not add Anthropic, Ollama, or Apple/MLX provider status surfaces.

Next:

- Add secure provider configuration, likely using macOS Keychain and a runtime
  settings endpoint.
- Add a live provider smoke test path once the user intentionally supplies an
  API key.
- Expand edit proposals beyond Markdown append so model-backed guidance can
  produce real reviewable code diffs.

## Decision Log

### 2026-07-04

- Product name for this repository: Forge.
- Atlas is preserved as the former codename.
- Product category: macOS-native, agent-first, local-first software engineering
  workspace.
- The core product is the agent runtime, not the editor.
- The workspace is task-centered, not chat-centered or file-centered.
- Human review is mandatory for important changes.
- Early distribution should use website download, DMG installation, Developer
  ID signing, notarization, and Sparkle updates rather than the Mac App Store.
- This README is the canonical project memory and should be updated as the
  project evolves.
- The repository now uses a multi-document planning system under `docs/`, with
  each document owning a distinct product or architecture area.
- `AGENTS.md` is the operating guide for future AI coding agents.
- Forge can be public and possibly open source, but the commercial model should
  be open-core or service-led rather than relying on goodwill. License remains
  undecided.
- Public GitHub repository created at `https://github.com/windorion/forge`.
- First implementation slice started with a SwiftUI app shell and local
  TypeScript runtime skeleton.
- Native macOS app launch should go through `./script/build_and_run.sh`, which
  builds and opens `dist/Forge.app`; `127.0.0.1:17373` is only the runtime
  service.
- Agent Loop v0 is deterministic and local: it simulates Manager/Planner
  progress and stops at a human review gate before real model/tool execution.
- V0 endpoint: a native app can create a task, the runtime can inspect real
  local project docs through visible read-only tool calls, the UI shows context
  and progress, and the task stops at human review with no file changes.
- Runtime task state now persists to local SQLite at `.forge/forge.sqlite` by
  default, with `FORGE_RUNTIME_DB_PATH` as an override. The first persistence
  slice stores full task snapshots plus basic task index fields; normalized
  audit tables come later.
- Plan approval is now an explicit runtime and UI action: a task waiting at
  `Human Review` can be approved, the approval is recorded, and the task moves
  into `Running` / `Execution Preparation` without applying file changes.
- Model access now goes through a runtime-owned provider abstraction. The
  default provider is local deterministic and produces execution proposals
  without external API calls; real LLM providers come later.
- Edit proposals are review artifacts until explicitly applied. The runtime
  can generate proposed file changes, reject them without touching files, or
  apply them through narrow append-text or exact replace-text operations for
  existing Markdown files after human approval.
- Edit proposal validation is a runtime-owned safety gate. Proposals are
  validated when generated and revalidated immediately before apply; blocked
  validation returns the task to human review without writing files.
- Post-apply validation is now part of the task lifecycle. Applied proposals
  enter `Testing`, run controlled built-in `forge:` validation commands, and
  only become `Completed` after validation passes.

### 2026-07-05

- Validation now uses a preset registry. Low-risk built-in presets can run
  automatically; medium-risk project command presets require task-level
  approval before execution.
- Project validation commands are allowlisted by the runtime, run without a
  shell, use repo-local cwd values, and record exit code plus output summary.
- Workspace validation presets live in `.forge/validation-presets.json` by
  default, with an environment override for testing or alternate workspaces.
  They can only compose runtime-known command IDs and cannot introduce raw
  command strings.
- The app should surface validation preset config status in Settings so users
  can see the active config path and any parse or safety issues.
- Validation permission policy should be derived by the runtime and exposed as
  task-specific snapshots. The app should render those snapshots instead of
  inventing its own command execution policy locally.
- Project command permission cards should show command boundary, execution
  mode, approval state, blocked reasons, and last-run metadata before allowing
  approval or execution.
- Task conversation is the task-scoped collaboration surface. It should help
  Forge understand and refine user intent, but it should not replace task
  state, planner, review, diff, validation, or approval surfaces.
- The model-provider boundary now includes structured intent briefs before
  planning or execution proposals. The local deterministic provider remains a
  placeholder until real LLM or local model providers are wired.
- Task conversation can now drive plan revisions. A revised plan records the
  source message, provider, rationale, risk level, and revised steps, clears
  any prepared execution proposal, returns the task to human review, and
  requires a fresh approval targeted at the current revision before execution
  can continue.
- Edit proposal review now supports a request-changes revision loop. Rejected
  proposals are preserved in history, the latest task conversation can produce
  a revised proposal, and the new artifact is validated and returned to human
  review without mutating files.
- Task conversation now supports repo-local file mentions. The runtime parses
  paths such as `README.md` or `@runtime/src/server.ts:120`, stores resolved,
  missing, or blocked references on the message, and treats them as read-only
  context rather than implicit permission to edit files.
- Validation presets now include native macOS app build coverage. The
  `macos-swiftpm` preset runs allowlisted `swift build` from the repository
  root after explicit task-level approval.

### 2026-07-06

- Agent Loop v0 now includes a bounded read-only repository context pass. It
  lists safe repo-local files, derives search terms from task intent and task
  conversation, searches path/content matches, and reads selected context files
  before plan review.
- This repo context pass is intentionally not a full index yet. Tree-sitter,
  symbol search, dependency graphs, semantic search, embeddings, and
  incremental indexing remain future work.
- The runtime now has an optional `openai` model provider backed by the
  Responses API and Structured Outputs. `local` remains the default; OpenAI is
  enabled only with `FORGE_MODEL_PROVIDER=openai` and `OPENAI_API_KEY`.
- Remote model output is still guidance only. Forge keeps IDs, timestamps,
  validation, approvals, and restricted file apply operations inside the local
  runtime.
- Model-provider configuration status is runtime-derived and visible in the
  macOS Settings window. The app shows provider readiness, missing secret
  status, editable non-secret settings, Keychain-backed OpenAI API key sync,
  and the remote-context boundary without exposing secret values.

### 2026-07-06 03:54:54 CST +0800

Conversation summary:

- User asked Codex to continue the next step as a substantial long task.

Done:

- Added runtime-owned editable model-provider settings through
  `GET /settings/model-provider` and `POST /settings/model-provider`.
- Added `.forge/model-provider-settings.json` persistence for non-secret
  provider settings and `FORGE_MODEL_PROVIDER_SETTINGS_PATH` override support.
- Kept OpenAI API keys out of persisted runtime settings; the runtime only
  reports key presence as configured or missing.
- Changed runtime provider initialization so settings updates rebuild the
  active provider without restarting the process.
- Added Swift models and RuntimeClient methods for provider settings.
- Added macOS Keychain storage for the OpenAI API key.
- Rebuilt the macOS Model Settings tab so it can switch providers, edit model
  and OpenAI non-secret options, save/sync Keychain keys, and clear keys.
- Updated model-provider, security, development, runtime, and v0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`, and
  `git diff --check`.
- Started and stopped a temporary runtime for smoke testing.

Not done:

- Did not call the live OpenAI API.
- Did not add Anthropic, Ollama, Apple/MLX, or other provider settings.
- Did not add a full autonomous tool-using real LLM loop.
- Did not complete the localhost settings API smoke test because sandboxed
  localhost access required escalation and the escalation was blocked by the
  current usage/approval limit.

Next:

- Run the provider settings API smoke test once localhost escalation is
  available again.
- Add a first real provider-backed task smoke with an intentionally supplied
  API key.
- Continue from provider configuration into richer real-model planning and
  safer edit proposal formats.

### 2026-07-07 01:55:18 CST +0800

Conversation summary:

- User asked Codex to continue with another substantial long task.

Done:

- Extended the safe edit proposal operation model from append-only to a
  restricted union of `AppendText` and `ReplaceText`.
- Added runtime validation for exact replace operations: existing Markdown
  target only, bounded text, non-empty find/replacement text, no identical
  replacement, and exactly one find-text match before apply.
- Added controlled apply support for `ReplaceText` using the same review,
  validation, approval, changed-files, and post-apply validation lifecycle as
  append operations.
- Updated the local and OpenAI provider paths so explicit task messages such as
  `replace "old" with "new"` or `把“旧文本”替换成“新文本”` generate a
  replace-text proposal; otherwise they continue to generate append-text
  proposals.
- Updated the macOS task workspace to decode and display edit operation
  summaries for both append and replace proposals.
- Updated edit proposal, runtime architecture, model provider, development,
  runtime README, v0 scope, and root README docs.
- Verified `npm run check`, `npm run build`, `swift build`, `git diff --check`,
  and an end-to-end temporary runtime smoke test that generated, validated, and
  applied a `ReplaceText` proposal.

Not done:

- Did not add a general patch interpreter or multi-hunk diff apply engine.
- Did not allow replace operations outside `README.md` or `docs/*.md`.
- Did not call the live OpenAI API.
- Did not normalize edit proposal operations into dedicated SQLite tables.

Next:

- Add richer proposal previews and possibly side-by-side diff rendering in the
  macOS app.
- Add normalized persistence for proposal revisions and file-change operations.
- Add model-backed smoke tests once a live provider key is intentionally
  supplied.

### 2026-07-07 02:07:58 CST +0800

Conversation summary:

- User said the root README had too much content and asked Codex to classify
  it into multiple documents, clarify TODO, and state the distance to a
  finished product.

Done:

- Slimmed the root `README.md` from a long project log into a compact project
  index and current-status summary.
- Moved historical session entries into `docs/session_log.md`.
- Added `docs/project_status.md` with current implementation state, completion
  estimates, distance to V0/alpha/beta/v1, and major product risks.
- Added `docs/todo.md` with prioritized P0-P6 backlog and recent completed
  work.
- Updated `docs/README.md` so the documentation map includes project status,
  TODO, and session log responsibilities.
- Updated `AGENTS.md` so future agents keep README compact and append session
  history to `docs/session_log.md`.

Not done:

- Did not change app or runtime behavior.
- Did not update roadmap phase sequencing beyond adding status and TODO docs.
- Did not run app/runtime builds because this was documentation-only work.

Next:

- Keep README as the high-level entry point.
- Use `docs/project_status.md` for progress and finished-product distance.
- Use `docs/todo.md` as the source of truth for next implementation tasks.

### 2026-07-07 02:10:52 CST +0800

Conversation summary:

- User asked to make `AGENTS.md` explain the main document design and how other
  agents should read the docs when taking over.

Done:

- Expanded `AGENTS.md` with a handoff reading path for new agents.
- Added grouped document responsibilities covering project state, product,
  experience, runtime, model providers, edit proposals, validation, database,
  git, MCP, and security.
- Added a task-specific reading guide so agents can load the right focused docs
  before editing code.

Not done:

- Did not change app or runtime behavior.
- Did not alter the docs map beyond the agent-facing handoff instructions.

Next:

- Keep future handoffs anchored in `README.md`, `docs/project_status.md`,
  `docs/todo.md`, and the relevant domain doc instead of rereading everything.

### 2026-07-08 01:45:53 CST +0800

Conversation summary:

- User asked to continue the next long development task for Forge.

Done:

- Added `runtime/scripts/smoke-core.mjs`, an automated core runtime smoke
  regression.
- Added `npm run smoke:core`.
- Covered create task, repo-local file-reference message, plan revision, plan
  approval, edit proposal generation, proposal validation, proposal apply,
  built-in post-apply validation, SQLite restart recovery, and both
  `AppendText` and exact `ReplaceText`.
- Updated `README.md`, `docs/development.md`, `docs/project_status.md`,
  `docs/todo.md`, and `runtime/README.md` to document the new smoke command
  and current V0 distance.
- Verified `npm run check`, `npm run build`, and `npm run smoke:core`.

Not done:

- Did not add app-level runtime diagnostics or app-managed runtime lifecycle.
- Did not improve the macOS edit proposal diff preview.
- Did not run a live OpenAI provider settings smoke test.
- Did not add broader app/UI regression automation.

Next:

- Add app-facing runtime state and diagnostics: running, disconnected, wrong
  port, wrong version, startup guidance, and a copy/open diagnostics action.
- Then improve the macOS edit proposal review panel with clearer operation
  metadata and diff preview.

### 2026-07-08 02:13:54 CST +0800

Conversation summary:

- User asked to continue the next implementation step.

Done:

- Added structured app-level runtime state for unchecked, checking, running,
  provider configuration issues, wrong version, and disconnected states.
- Added structured SSE stream state and an immediate `stream.connected` event
  when the app connects to runtime events.
- Upgraded the sidebar runtime badge with endpoint, version, runtime state,
  stream state, refresh, open runtime page, and copy diagnostics actions.
- Expanded the Settings runtime tab with shared runtime state, last checked,
  last error, service/version, uptime, database path, task count, event stream
  status, and diagnostics actions.
- Added a pasteboard diagnostics bundle covering endpoint, expected
  service/version, runtime state, stream state, health, persistence, provider
  status/issues, validation config, and loaded task count.
- Updated `README.md`, `docs/development.md`, `docs/project_status.md`,
  `docs/todo.md`, and `docs/v0_scope.md` to reflect the new runtime state and
  diagnostics surface.
- Verified `swift build`.

Not done:

- Did not implement app-managed runtime start/stop.
- Did not improve the edit proposal diff preview.
- Did not add app-facing automated regression coverage.
- Did not run a live OpenAI provider settings smoke test.

Next:

- Improve the macOS edit proposal panel with clearer operation metadata and a
  more readable diff preview.
- Add a short V0 demo script in `docs/development.md`.
- Add app-facing regression checks for runtime state and diagnostics paths.

### 2026-07-08 02:30:52 CST +0800

Conversation summary:

- User asked to inspect the new `design_handoff_forge` UI handoff, compare it
  against Forge's current product/function state, judge implementability and
  gaps, and plan how to implement the UI.

Done:

- Read the required project handoff/status docs, UI/runtime/macOS design docs,
  V0 scope, current SwiftUI app files, runtime client/types, and the
  `design_handoff_forge` README/HTML/logo.
- Assessed that the new design strongly matches Forge's task-first,
  review-centered direction for core flows, but assumes many alpha/beta/v1
  capabilities that are not implemented yet.
- Prepared an implementation sequencing plan that starts with reusable native
  design tokens/components and the V0-real core workflow screens.

Not done:

- Did not change application or runtime code.
- Did not update completion estimates or backlog priorities.
- Did not run build/test commands because this was a read-only evaluation
  and planning pass.

Next:

- If approved, implement the new native visual system and the 14a/1a/1b core
  task workspace first, mapping only to existing runtime data.
- Then upgrade edit proposal review toward 10a and settings toward the new
  Settings group before tackling long-horizon system integrations.

### 2026-07-08 02:34:45 CST +0800

Conversation summary:

- User asked when Forge's real agent capability can catch up to the new UI
  vision, when complete agent functionality is realistic, and whether an
  external agent framework is needed.

Done:

- Rechecked runtime architecture, model provider, security/permissions, and
  multi-agent docs.
- Compared Forge's current custom runtime/provider boundary with current
  OpenAI Responses API and Agents SDK guidance.
- Framed a staged path from current deterministic V0 to useful real-agent
  alpha, then full PR-producing agent behavior.

Not done:

- Did not change runtime or app code.
- Did not choose or install a new agent framework.

Next:

- Keep Forge's runtime as the orchestration owner in the near term.
- Add a real tool-calling loop, general patch proposals, command execution,
  validation repair, and git workflow before adopting any heavier agent
  framework.

### 2026-07-08 02:36:31 CST +0800

Conversation summary:

- User asked whether the next implementation priority should be agent
  capability or the new UI.

Done:

- Recommended prioritizing the smallest real agent capability spine first,
  with only foundational UI tokens/components in parallel.

Not done:

- Did not change implementation code.
- Did not revise the official backlog yet.

Next:

- Implement model-driven tool calling, richer edit proposals, and validation
  repair before the full UI redesign.
- Build the new UI around real task states as those runtime capabilities land.

### 2026-07-08 02:42:32 CST +0800

Conversation summary:

- User approved continuing with the recommended next step: prioritize the
  smallest real agent capability spine before the full UI redesign.

Done:

- Added an optional `createPlanContextRequest` provider hook.
- Implemented OpenAI Structured Output support for bounded plan-context
  requests with rationale, search terms, and repo-relative read paths.
- Added runtime execution for model-guided plan context before plan revisions:
  the runtime validates requested paths, runs logged read-only repo tools, and
  stores compact context summaries before asking for the revised plan.
- Extended context selection so provider-requested safe files can be inspected
  alongside explicit references, search matches, and important project files.
- Extended `npm run smoke:core` with a mock OpenAI Responses server that
  verifies the model-guided context request path.
- Updated README, runtime README, and focused docs to describe the new ability
  without overstating it as a full repeated tool loop.
- Verified `npm run check`, `npm run build`, and `npm run smoke:core`.

Not done:

- Did not implement a repeated multi-step tool-call loop yet.
- Did not expand patch application beyond Markdown append/exact replace.
- Did not add command repair loops or git workflow.
- Did not change the SwiftUI app UI.

Next:

- Extend model-guided context into a repeated planning/tool loop with explicit
  stop conditions and failure recovery.
- Then add richer edit proposal operations before building the new diff UI.

### 2026-07-08 02:52:31 CST +0800

Conversation summary:

- User asked to continue the next step after the first model-guided context
  request implementation.

Done:

- Extended the OpenAI plan-context request into a bounded loop with explicit
  provider statuses: `SearchAndRead` for another read-only context round and
  `ReadyForPlan` to stop.
- Added a maximum of three model-guided context rounds.
- Added stop behavior for repeated requests that do not introduce new safe
  search/read context.
- Added cumulative context merging with a stored context cap.
- Added `model.context_loop.completed` events and round-specific context
  request events.
- Updated the mock OpenAI smoke flow so the first context request asks for
  read/search work and the second reports `ReadyForPlan`.
- Updated docs to describe the bounded context loop accurately.
- Verified `npm run check`, `npm run build`, and `npm run smoke:core`.

Not done:

- Did not add write/edit tools to the model loop.
- Did not add command execution or validation repair loops.
- Did not change SwiftUI UI.

Next:

- Extend provider-guided execution from read-only planning context into richer
  edit proposal generation with multi-file/create-file proposal shapes.
- Keep file writes behind validation and human approval.

### 2026-07-08 03:03:07 CST +0800

Conversation summary:

- User asked to continue with the next agent capability step after the bounded
  context loop.

Done:

- Added richer OpenAI edit proposal output with a structured
  `forge_edit_proposal` schema.
- Allowed OpenAI proposals to include multiple file changes.
- Added preview-only operation kinds to runtime types: `CreateFile` and
  `PreviewOnly`.
- Kept apply restricted to existing v0-safe Markdown `AppendText` and exact
  `ReplaceText`; unsupported operations validate as blocked review artifacts.
- Extended the mock OpenAI smoke flow to approve the OpenAI plan, generate a
  richer edit proposal, and verify a create-file preview blocks apply.
- Updated edit proposal, provider, development, V0, status, README, runtime
  README, and TODO docs.
- Verified `npm run check`, `npm run build`, and `npm run smoke:core`.

Not done:

- Did not implement create-file apply.
- Did not implement a general patch engine or multi-change apply.
- Did not change the SwiftUI review UI yet.

Next:

- Add native/UI review treatment for blocked preview-only proposal operations,
  or continue runtime work by adding a safe create-file apply path behind
  validation and approval.

### 2026-07-08 03:15:03 CST +0800

Conversation summary:

- User asked to do both next steps: add safe create-file apply capability and
  improve the UI treatment for blocked preview-only proposal operations.

Done:

- Added restricted `CreateFile` apply support for new `docs/*.md` files.
- Kept create-file behind proposal validation, explicit apply approval,
  no-overwrite checks, content limits, and runtime path safety.
- Updated OpenAI edit-proposal instructions so `CreateFile` is only for new
  docs Markdown files and `PreviewOnly` remains for unsupported patches,
  deletes, overwrite attempts, and unsupported paths.
- Extended the core smoke test so the mock OpenAI flow applies an append plus a
  docs create-file proposal, then separately verifies a blocked `PreviewOnly`
  proposal.
- Added SwiftUI decoding for create-file content.
- Replaced the edit proposal file-change inline UI with a dedicated card that
  shows change type, operation metadata, validation status, validation checks,
  and blocked preview-only notes.
- Updated README, runtime README, project status, TODO, development, V0, and
  edit proposal docs to reflect restricted create-file apply and the remaining
  patch-engine gap.
- Verified `npm run check`, `npm run build`, `npm run smoke:core`, and
  `swift build`.

Not done:

- Did not build a general patch engine, section replace, delete apply, rollback,
  side-by-side diff view, or git workflow.
- Did not implement the full autonomous execution/tool-repair agent loop.

Next:

- Move from proposal generation toward the real agent loop: model-selected
  bounded execution steps, validation feedback, repair/revision prompts, and
  then richer diff/git review surfaces.

### 2026-07-08 03:27:56 CST +0800

Conversation summary:

- User decided to defer UI design adaptation and asked to push current agent
  capabilities as far as possible first.

Done:

- Added a bounded validation-feedback repair loop for edit proposal generation.
- When a generated proposal is blocked, the runtime now archives the blocked
  intermediate proposal as `Superseded`, sends failed validation summaries and
  per-file checks back to the model provider, and asks for a repaired proposal.
- Capped automatic proposal repair at two attempts so the agent can recover
  without looping indefinitely.
- Updated task phase, agent state, plan steps, events, and revision history to
  distinguish repaired-ready proposals from proposals that remain blocked.
- Extended the OpenAI provider prompt/context with previous proposal and
  validation feedback details.
- Added deterministic local provider repair context in generated append notes.
- Extended `npm run smoke:core` with a blocked-to-repaired OpenAI proposal flow
  and bounded still-blocked preview-only flow.
- Updated runtime, provider, edit proposal, development, V0, status, README,
  runtime README, and TODO docs.
- Verified `npm run check`, `npm run build`, and `npm run smoke:core`.

Not done:

- Did not implement command/test failure repair after post-apply validation.
- Did not add arbitrary tool execution, git workflow, rollback, or a general
  patch engine.
- Did not adapt the new design handoff UI yet.

Next:

- Extend the same feedback-loop pattern from proposal validation to
  post-apply validation failures, then add model-selected bounded execution
  steps beyond read-only context.

### 2026-07-08 03:38:25 CST +0800

Conversation summary:

- User asked to continue with a longer agent-capability task and requested a
  clearer sense of how much functionality remains.

Done:

- Added `ValidationRepairBrief` task artifacts for failed validation runs.
- Added a model-provider method for validation failure repair briefs.
- Implemented OpenAI Structured Output support for validation repair briefs
  with summary, likely cause, recommended actions, follow-up prompt, risk, and
  provider metadata.
- Implemented local deterministic validation repair briefs for offline/local
  mode.
- Wired failed validation runs to generate a repair brief from compact failed
  command summaries after the `validation.failed` event.
- Updated task agents, plan steps, events, review summary, and task persistence
  so failed validation now produces a reviewable next-step diagnosis instead
  of only stopping at failure.
- Extended `npm run smoke:core` with a real failed runtime TypeScript
  validation scenario using a temporary broken `.ts` file, verified OpenAI
  repair brief generation, and cleaned the temporary file afterward.
- Updated README, runtime README, project status, TODO, runtime architecture,
  model provider, validation preset, development, and V0 docs.
- Verified `npm run check`, `npm run build`, `npm run smoke:core`, and
  `swift build`.

Not done:

- Did not automatically turn validation repair briefs into new edit proposals.
- Did not add arbitrary command/tool execution, rollback, git workflow, or a
  general patch engine.
- Did not adapt the design handoff UI.

Next:

- Let the user review a validation repair brief and request a follow-up edit
  proposal seeded by that brief.
- Then add model-selected bounded execution steps beyond read-only context,
  still behind runtime policy and human review.

### 2026-07-08 03:48:16 CST +0800

Conversation summary:

- User asked to continue the next long agent-capability task before adapting
  the new UI handoff.

Done:

- Added follow-up validation repair edit proposal generation from failed
  validation repair briefs.
- Added `POST /tasks/:taskID/generate-validation-repair-proposal` to create a
  new reviewable edit proposal after an applied proposal fails validation.
- Linked generated repair proposals back to their `ValidationRepairBrief` via
  `validationRepairBriefID`.
- Archived the previous applied proposal revision, preserved changed file
  context, and emitted dedicated validation-repair proposal events.
- Extended OpenAI and local model providers so validation repair briefs are
  included in proposal context and prompt generation.
- Extended the core smoke script with assertions for validation repair proposal
  generation, revision history, preserved changed files, and repair events.
- Updated README, runtime README, project status, TODO, runtime architecture,
  edit proposal, model provider, development, and V0 docs.
- Verified `npm run check` and `npm run build`.

Not done:

- Could not run `npm run smoke:core` this turn because the required escalated
  command approval was rejected by the automatic usage-limit review.
- Did not add the macOS UI action for generating a validation repair proposal.
- Did not implement automatic apply/re-validate for follow-up repair proposals,
  arbitrary tool execution, rollback, git workflow, or a general patch engine.
- Did not adapt the `design_handoff_forge/` UI design yet.

Next:

- Surface the validation repair proposal action in the macOS Review UI.
- Rerun `npm run smoke:core` when command approval is available.
- Continue toward richer diff/git surfaces and broader agent execution under
  policy and human review.

### 2026-07-08 08:08:43 CEST +0200

Conversation summary:

- User asked to terminate the local service and continue a larger feature
  development task, ideally consuming a long work block.

Done:

- Confirmed the Forge runtime was not listening on `127.0.0.1:17373`; `/health`
  could not connect, so the local service is stopped.
- Added macOS app models for validation repair briefs and repair-proposal
  linkage through `validationRepairBriefID`.
- Added the macOS runtime client call for
  `POST /tasks/:taskID/generate-validation-repair-proposal`.
- Surfaced validation repair briefs in the Review panel with likely cause,
  recommended actions, follow-up prompt, provider, risk, and source validation
  run.
- Added the Review action to generate a follow-up validation repair proposal
  when an applied proposal has a latest failed validation run and matching
  repair brief.
- Added first-pass app-managed runtime lifecycle controls: toolbar, sidebar
  runtime badge, and Settings can build/start the local Node runtime and stop
  only the app-owned process.
- Added runtime process state, PID, directory, and messages to diagnostics and
  Settings.
- Updated README, project status, TODO, development, macOS native, and V0 docs.
- Verified `swift build`, `npm run check`, and `npm run build`.

Not done:

- Did not launch the macOS app interactively or start the runtime, because the
  user explicitly asked to terminate local services and keep developing.
- Did not run `npm run smoke:core` in this turn.
- Did not harden packaged-app runtime discovery, stale external process
  detection, launch-output capture, richer diff review, git workflow, rollback,
  or a general patch engine.
- Did not adapt `design_handoff_forge/` yet.

Next:

- Harden app-managed runtime lifecycle for packaged app locations and failed
  launches.
- Build richer side-by-side diff and changed-file review surfaces.
- Continue agent execution work toward broader tool loops, patch application,
  and git review artifacts.

### 2026-07-08 18:46:48 CEST +0200

Conversation summary:

- User asked to continue the next long task. The work focused on Review/Diff/Git
  visibility before moving to commit or PR actions.

Done:

- Added runtime read-only git review types for status snapshots, file changes,
  and bounded per-file diffs.
- Added `GET /git/status` for git root, branch, upstream, head, dirty state,
  staged/unstaged/untracked files, and line stats when available.
- Added `GET /git/diff?path=<repo-relative-path>` for bounded tracked-file
  diffs and synthetic untracked text-file diffs.
- Kept git endpoints read-only: they run `git` without a shell, require
  repo-relative paths, block `.git` and `.forge` internals, and do not stage,
  reset, checkout, commit, or mutate files.
- Added macOS app models, runtime client calls, and workspace state for git
  status and per-file diff caching.
- Added a `Working Tree` section to the macOS Review panel with branch/head
  summary, changed-file list, task-related file highlighting, line stats,
  open/reveal actions, and a compact side-by-side diff preview.
- Extended the core smoke test to verify read-only git status and bounded git
  diff endpoints against temporary smoke fixtures.
- Improved smoke assertion output for task state mismatches so validation
  summaries and per-file checks are visible when a flow fails.
- Fixed the mock OpenAI validation-repair flow so it distinguishes actual
  validation repair brief context from the empty `validationRepairBriefs`
  history list.
- Updated README, runtime README, project status, TODO, development, runtime
  architecture, git workflow, security permissions, and V0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`, `npm run
  smoke:core`, and `git diff --check`.

Not done:

- Did not add staging, unstaging, discard, reset, commit, push, or PR actions.
- Did not add a binary diff viewer, full diff filtering, or large-diff
  navigation beyond bounded previews.
- Did not adapt `design_handoff_forge/`.
- Did not start the persistent local runtime service; smoke used temporary
  runtime ports and cleaned them up.

Next:

- Add commit preparation as a review artifact with proposed commit message,
  changed files, validation summary, and explicit approval.
- Harden the git/diff panel for larger real repositories and binary files.
- Continue toward broader patch apply and rollback/recovery flows.

### 2026-07-08 20:58:30 CEST +0200

Conversation summary:

- User asked to commit all current changes to the remote repository and then
  continue the next implementation step. After pushing the prior work, this
  session continued into commit preparation as the next git review artifact.

Done:

- Staged, committed, and pushed the previous agent-review/git-diff/runtime
  lifecycle work to `origin/main` as `0b9117c Advance Forge agent review
  workflows`.
- Added runtime `GET /git/commit-preview`, a read-only commit preparation
  endpoint that summarizes working tree state, optional task context, latest
  task validation state, suggested commit message, included files, validation
  suggestions, blockers, risk notes, and a non-mutating operation boundary.
- Added TypeScript commit preview types and smoke coverage for the new
  endpoint.
- Added macOS app models, runtime client method, workspace state, and a
  `Commit Review` card inside the Review panel's Working Tree section.
- Updated README, runtime README, project status, TODO, development, runtime
  architecture, git workflow, security permissions, and V0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`,
  `npm run smoke:core`, and `git diff --check`.
- Confirmed no persistent runtime service was listening on the default
  `127.0.0.1:17373` port after smoke finished.

Not done:

- Did not add actual staging, unstaging, commit, push, branch creation, or PR
  publication actions.
- Did not add binary diff viewing, full diff filtering, large-diff navigation,
  or packaged-app runtime lifecycle hardening.
- Did not adapt the shipped UI design handoff into the SwiftUI visual system.

Next:

- Add explicit approved staging and commit actions on top of the commit
  preview artifact.
- Add branch awareness and task-scoped branch suggestions before real commit
  and PR handoff.
- Continue hardening git/diff review for large and mixed staged/unstaged
  working trees.

### 2026-07-08 22:36:22 CEST +0200

Conversation summary:

- User asked to continue the next step. The work continued from commit
  preparation into an explicitly approved local git commit action.

Done:

- Added runtime `POST /git/commit` with explicit confirmation, expected-HEAD
  drift protection, selected-path validation, unmerged-file rejection, staged
  outside-selection rejection, git author identity preflight, selected-path
  staging, local commit creation, and optional task event recording.
- Added TypeScript request/result types and extended smoke coverage to verify
  stale-head commit attempts are rejected before staging or committing.
- Added macOS app request/result models, runtime client method, workspace
  action state, commit result caching, and commit creation from the Review
  panel's Commit Review card.
- Added a macOS confirmation dialog that explains Forge will stage listed
  files and create one local commit, but will not push, merge, reset, delete
  branches, or publish anything.
- Updated README, runtime README, project status, TODO, development, runtime
  architecture, git workflow, security permissions, and V0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`,
  `npm run smoke:core`, and `git diff --check`.
- Confirmed no persistent runtime service was listening on the default
  `127.0.0.1:17373` port after smoke finished.

Not done:

- Did not add push, PR publication, branch creation, unstaging, discard,
  reset, rollback, binary diff viewing, or large-diff navigation.
- Did not run an integration test that creates an actual commit in an isolated
  temporary repository; current smoke verifies the safety rejection path to
  avoid mutating this checkout's git history.
- Did not adapt the shipped UI design handoff into the SwiftUI visual system.

Next:

- Add branch awareness and task-scoped branch suggestions before push/PR.
- Add explicit approved push preview and push action after local commits.
- Add an isolated temporary-repository integration test for successful local
  commit creation.

### 2026-07-09 20:58:47 CEST +0200

Conversation summary:

- User asked to stop local services, commit all code to the remote repository,
  and continue with another long task. The work first confirmed the default
  runtime service was not running, then extended the git workflow from local
  commits into push preparation and explicit push.

Done:

- Confirmed no persistent Forge runtime service was listening on
  `127.0.0.1:17373`.
- Added runtime `GET /git/push-preview` with branch/upstream, ahead/behind,
  commits-to-push, dirty working-tree state, blockers, risk notes, and a
  non-mutating operation boundary.
- Added runtime `POST /git/push` with explicit confirmation, expected HEAD,
  branch, and upstream drift checks, blockers for detached/no-upstream/behind/
  no-ahead/unmerged states, non-force push to the configured upstream, and
  optional task event recording.
- Added TypeScript push preview/request/result types and smoke coverage for
  push-preview plus stale-head push rejection before any network push.
- Added macOS app push models, runtime client calls, workspace state/actions,
  Push Review card, confirmation dialog, and push result display in the Review
  panel.
- Updated README, runtime README, project status, TODO, development, runtime
  architecture, git workflow, security permissions, and V0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`,
  `npm run smoke:core`, and `git diff --check`.

Not done:

- Did not add PR creation/publication, branch creation, branch suggestions,
  unstaging/discard/reset, rollback, binary diff viewing, or large-diff
  navigation.
- Did not run a real network push through the runtime; smoke verifies the
  safety rejection path and this repository push is handled by git directly
  after commit.
- Did not adapt the shipped UI design handoff into the SwiftUI visual system.

Next:

- Commit and push this work to `origin/main`.
- Add branch awareness and task-scoped branch suggestions.
- Add PR handoff preview artifacts before any actual PR creation.

### 2026-07-09 21:11:42 CEST +0200

Conversation summary:

- User asked to commit all code to the remote repository and continue the next
  long task. The previous push workflow work was already committed and pushed;
  this session continued with a read-only PR handoff preview so Forge can move
  from local commit/push toward an approved PR workflow without crossing the
  external publication boundary.

Done:

- Added runtime `GET /git/pr-preview` as a read-only PR handoff artifact with
  default-base detection, base/head/upstream state, suggested branch name, PR
  title, draft body, test plan, commits, changed files, blockers, risk notes,
  and an explicit no-publication boundary.
- Added branch and PR blockers for detached checkout, current branch matching
  the default base branch, missing upstream, unpushed commits, behind-upstream
  state, unmerged files, missing base ref, and no commits between base and
  HEAD.
- Added macOS app model/client support, workspace loading state, preview cache,
  and a PR Handoff card in the Review panel Working Tree section.
- Extended `npm run smoke:core` to verify the PR preview endpoint returns
  title, suggested branch name, body, test plan, readiness, and non-mutating
  boundary.
- Updated README, runtime README, project status, TODO, development, runtime
  architecture, git workflow, security permissions, and V0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`,
  `npm run smoke:core`, and `git diff --check`.
- Confirmed no persistent Forge runtime service was listening on
  `127.0.0.1:17373`.

Not done:

- Did not create, publish, update, close, or comment on pull requests.
- Did not add branch creation/switching, GitHub integration, fork remote
  handling, or approved PR publication.
- Did not adapt the shipped UI design handoff into the SwiftUI visual system.

Next:

- Commit and push this PR handoff preview work to `origin/main`.
- Add explicit branch creation/switching review before PR publication.
- Add approved GitHub PR creation as a separate high-risk action after the
  preview artifact is stable.

### 2026-07-09 21:22:43 CEST +0200

Conversation summary:

- User asked to continue the next long task. The session advanced the git
  workflow gap before PR publication by adding branch preparation and explicit
  local branch create/switch review.

Done:

- Added runtime `GET /git/branch-preview` with current branch, expected HEAD,
  default base branch, target branch, create/switch mode, dirty state,
  blockers, risk notes, related task metadata, and a non-mutating operation
  boundary.
- Added runtime `POST /git/branch` with explicit confirmation, expected HEAD
  and current-branch drift checks, target branch validation, unmerged-file
  blocking, dirty-worktree blocking for switching existing branches, local
  branch creation/switching, optional task approval/event recording, and no
  push or PR publication.
- Added TypeScript branch preview/request/result types and extended approval
  records for create/switch branch actions.
- Added macOS app branch models, runtime client calls, workspace state/actions,
  Branch Review card, optional target branch input, confirmation dialog, and
  branch result display in the Working Tree review surface.
- Extended `npm run smoke:core` with branch-preview assertions and stale-head
  branch rejection before any git switch.
- Updated README, runtime README, project status, TODO, development, runtime
  architecture, git workflow, security permissions, and V0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`,
  `npm run smoke:core`, and `git diff --check`.
- Confirmed no persistent Forge runtime service was listening on
  `127.0.0.1:17373`.

Not done:

- Did not set upstream tracking, push newly created branches, delete branches,
  reset history, or publish PRs.
- Did not add a success-path branch integration test in an isolated temporary
  git repository; smoke verifies the safety rejection path inside this checkout.
- Did not adapt the shipped UI design handoff into the SwiftUI visual system.

Next:

- Add branch publish/upstream setup after local branch creation.
- Add approved GitHub draft PR creation from the PR handoff preview.
- Add isolated temporary-repository integration tests for successful local
  branch creation/switching.

### 2026-07-09 21:35:55 CEST +0200

Conversation summary:

- User asked to continue the next long task. The session extended the git
  workflow from local branch creation into branch publish/upstream setup,
  keeping the action behind a review artifact and explicit confirmation.

Done:

- Added runtime `GET /git/branch-publish-preview` with current branch,
  configured remote, remote branch, default base branch, commits to publish,
  changed files that remain local, blockers, risk notes, related task metadata,
  and a non-mutating operation boundary.
- Added runtime `POST /git/branch-publish` with explicit confirmation,
  expected HEAD/branch/remote/remote-branch drift checks, default-base,
  detached, already-upstream, no-commit, unmerged-file, and remote-branch
  collision blockers, non-force `git push --set-upstream`, and optional task
  approval/event recording.
- Added TypeScript branch publish preview/request/result types and extended
  approval records for publish branch actions.
- Added macOS app branch publish models, runtime client calls, workspace
  state/actions, Publish Review card, remote/remote-branch inputs,
  confirmation dialog, commit list, blockers/risk notes, and publish result
  display in the Working Tree review surface.
- Extended `npm run smoke:core` with branch-publish-preview assertions and
  stale-head branch publish rejection before any network push.
- Updated README, runtime README, project status, TODO, development, runtime
  architecture, git workflow, security permissions, and V0 scope docs.
- Verified `npm run check`, `npm run build`, `swift build`,
  `npm run smoke:core`, and `git diff --check`.
- Confirmed no persistent Forge runtime service was listening on
  `127.0.0.1:17373`.

Not done:

- Did not create, publish, update, close, or comment on pull requests.
- Did not add GitHub integration, fork remote support, branch protection
  awareness, or isolated success-path branch publish tests.
- Did not adapt the shipped UI design handoff into the SwiftUI visual system.

Next:

- Add approved GitHub draft PR creation from the PR handoff preview.
- Harden branch publish for remote auth failures, protected branch names,
  stale remote refs, fork remotes, and isolated success-path tests.
- Broaden app-facing regression coverage for runtime state, diagnostics, and
  provider settings paths.

### 2026-07-09 21:49:28 CEST +0200

Conversation summary:

- User asked to commit local code and continue toward finishing V0. The
  previous branch review/publish workflow was committed, then the session
  closed two V0 polish gaps around app-facing regression coverage and the demo
  script.

Done:

- Committed the branch review and publish workflow as
  `8596ba5 Add branch review and publish workflow`.
- Extended `npm run smoke:core` to cover the runtime home/status page, health
  diagnostics, persistence metadata, model-provider settings GET/POST,
  OpenAI missing-key/ready/clear-key states, and verification that API keys are
  never persisted to the temporary settings file.
- Fixed the smoke isolation boundary so persisted local provider settings do
  not override the later mock OpenAI provider runtime segment.
- Added a short local V0 demo script to `docs/development.md`.
- Updated README, runtime README, project status, and TODO to reflect the new
  V0 coverage and demo path.
- Verified `npm run smoke:core`, `npm run check`, and `git diff --check`.

Not done:

- Did not run a live-provider smoke with a real OpenAI API key.
- Did not further harden large-diff UI, packaged app runtime lifecycle,
  remote auth failure handling, fork remotes, or branch protection paths.
- Did not create, publish, update, close, or comment on pull requests.

Next:

- Commit the V0 smoke/demo-script follow-up.
- If continuing V0 hardening, target either packaged runtime failure
  diagnostics or larger git/diff review behavior.
- After V0 hardening, move to approved GitHub draft PR creation for alpha.

### 2026-07-09 21:54:38 CEST +0200

Conversation summary:

- Continued V0 hardening after the smoke/demo-script checkpoint by improving
  git diff review behavior for binary and oversized files.

Done:

- Added runtime diff metadata fields: display mode, unavailable reason,
  byte/line counts, and app preview line limit.
- Changed tracked and untracked diff generation to return structured display
  results instead of treating binary or oversized files as ordinary text diffs.
- Added explicit binary, too-large, non-regular-file, command-failed, and
  no-textual-diff summaries.
- Updated the macOS Review diff card to render side-by-side only for textual
  diffs and to show clear message-style previews with metadata for binary or
  oversized files.
- Extended `npm run smoke:core` with temporary text, binary, and oversized
  diff fixtures and assertions for the new metadata.
- Updated README, runtime README, project status, TODO, development, and git
  workflow docs.
- Verified `npm run check`, `swift build`, and `npm run smoke:core`.

Not done:

- Did not add advanced diff filtering, full-file diff navigation, or binary
  visual previews.
- Did not harden packaged runtime lifecycle or remote git auth/branch
  protection paths.

Next:

- Commit the git/diff hardening follow-up.
- Continue V0 hardening with packaged runtime failure diagnostics or remote git
  failure handling.

### 2026-07-10 21:10:00 CEST +0200

Conversation summary:

- User asked to continue the next long task. The session first committed the
  staged git/diff hardening checkpoint, then hardened app-managed runtime
  lifecycle diagnostics for V0.

Done:

- Committed `96712ff Harden V0 git diff previews`.
- Added an `External` runtime process state so the app distinguishes a
  reachable terminal-launched runtime from an app-managed process and does not
  offer to stop external runtimes.
- Added runtime directory candidate diagnostics for app-managed startup.
- Captured bounded `npm run build` and `node dist/server.js` output for
  Settings and copied diagnostics.
- Added launch command reporting, slow stop messaging, and richer start
  failure messages.
- Updated Settings Runtime tab with candidate paths and latest launch output.
- Updated README, project status, TODO, development, and macOS native docs.
- Verified `swift build`.

Not done:

- Did not launch the GUI app or package Forge into a distribution layout.
- Did not add distribution-specific runtime path resolution after packaging.
- Did not harden remote git auth, fork remotes, branch protection, or live
  provider smoke with a real key.

Next:

- Commit the runtime lifecycle diagnostics follow-up.
- Continue V0 hardening with local commit/push remote failure paths or
  packaged runtime path resolution once packaging layout is decided.

### 2026-07-10 21:20:58 CEST +0200

Conversation summary:

- User asked to commit/push everything and continue the next long task. The
  session pushed `main` to GitHub, then hardened local commit review preflight
  for V0.

Done:

- Pushed `main` to `origin`, advancing the remote from `31634c5` to
  `98facb0`.
- Added commit preview preflight metadata for git author identity status,
  staged/unstaged/untracked counts, total additions/deletions,
  files-without-stats count, large-change warnings, validation state,
  hook-risk disclosure, and commit path limit.
- Made missing git author identity block commit preview before the user can
  start a local commit.
- Surfaced commit preflight in the macOS Commit Review card.
- Extended `npm run smoke:core` to assert commit preflight metadata.
- Updated README, runtime README, project status, TODO, development,
  git workflow, and security permissions docs.
- Verified `npm run check`, `swift build`, and `npm run smoke:core`.

Not done:

- Did not create a live signing/hook failure fixture or run a real hook
  rejection test.
- Did not harden remote git auth, non-fast-forward, fork remote, or branch
  protection paths.
- Did not push the new commit-preflight work after implementation; it remains
  local until committed and pushed.

Next:

- Commit the commit-preflight hardening follow-up.
- Continue V0 hardening with push/branch-publish remote failure handling or
  PR handoff edge cases.
