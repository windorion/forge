# V0 Scope

Document role: define the first end-to-end product target for Forge so early
implementation has a clear finish line.

## V0 Goal

V0 should make Forge feel like a local agent workspace, even before full model
and code-editing autonomy exists.

The user should be able to:

1. Start the local runtime.
2. Launch the native macOS app.
3. Create a task.
4. Watch the agent inspect real local project context.
5. See tool calls, context files, plan steps, agent states, and runtime events.
6. Continue a task conversation and see a structured intent brief.
7. Ask Forge to revise the plan from the task conversation.
8. Reach a human review gate before any code changes are applied.
9. Approve a generated edit proposal before a narrow, controlled file change is
   applied.

## V0 Product Feeling

Forge v0 should not feel like a static task manager. It should feel like a
transparent agent that is preparing work.

The product should show:

- what the Manager is doing
- what the Planner is doing
- which local files were inspected
- which tools ran
- what plan was produced
- why the task is waiting for human review

## V0 Included

- SwiftUI native macOS app shell
- local TypeScript runtime
- task creation
- Server-Sent Events stream
- deterministic Agent Loop v0
- local file listing and file reads
- task-intent repo context search
- visible tool calls
- visible context files
- visible plan steps
- task conversation
- task message file references
- structured intent briefs
- conversation-driven plan revisions
- human review gate
- SQLite task persistence
- model-provider abstraction
- provider configuration visibility
- editable model-provider settings
- execution proposals
- safe edit proposals
- revised edit proposals after requested changes
- edit proposal validation
- explicit apply/reject actions for edit proposals
- post-apply validation runs
- approved runtime validation preset
- workspace validation preset config
- command permission request surface
- app-visible runtime state and diagnostics
- copy/open runtime diagnostics actions
- no automatic file changes

## V0 Not Included

- full autonomous tool-using real LLM loop
- autonomous file edits
- arbitrary command execution
- general test runner orchestration
- git diff generation
- full repository index
- Tree-sitter parsing
- provider ecosystem beyond local deterministic and optional OpenAI
- release packaging

## V0 Completion Criteria

V0 is complete when:

- A user can run `cd runtime && npm run dev`.
- A user can run `./script/build_and_run.sh`.
- The app can create a task.
- Creating a task records the initial objective as a task message and produces
  a structured intent brief.
- A user can add a task message and receive an updated intent brief.
- A user can mention repo-local files in task messages and see resolved,
  missing, or blocked references preserved on the message.
- A user can generate a plan revision from the latest task conversation.
- Approving a plan targets the current plan revision when one exists, so an old
  approval does not automatically approve a revised plan.
- The runtime can inspect real local project files.
- The runtime can derive search terms from the task intent and inspect
  matching repo-local context files.
- The app updates from runtime events.
- The task reaches `Human Review`.
- The UI shows tool calls and context files.
- No code changes are made without approval.
- A generated edit proposal can be rejected without changing files.
- A rejected edit proposal can be revised from the latest task conversation
  without changing files, while preserving the rejected proposal in history.
- A generated edit proposal can be explicitly applied through a restricted
  Markdown append or exact replace operation.
- A generated edit proposal can be validated before apply, and blocked if the
  workspace no longer matches the safe append or exact replace boundary.
- Applying an edit proposal runs controlled built-in validation before the task
  is marked completed.
- A task can approve and run the `runtime-typescript` validation preset for
  `npm run check` and `npm run build`.
- A task can approve and run the `macos-swiftpm` validation preset for
  `swift build`.
- Runtime can load workspace validation presets from
  `.forge/validation-presets.json`.
- The app can show runtime-derived command permission state before approving or
  running project validation presets.
- The Settings window can show and edit runtime-derived model-provider status,
  missing provider configuration, non-secret provider options, Keychain-backed
  OpenAI API key sync, and remote-context boundary.
- The app shows whether the expected runtime endpoint is unchecked, checking,
  running, disconnected, wrong version, or blocked by provider configuration,
  and exposes copy/open diagnostics actions.

## V0 Next After Completion

After v0, Forge should move toward v0.1:

- richer file-edit proposal flow
- deeper repository understanding with symbols, dependency hints, and
  persistent indexing

The explicit plan approval action has started: approval is recorded and opens
controlled execution preparation, but it does not yet run model-driven edits.

The model-provider abstraction has also started: the default local
deterministic provider creates task intent briefs, plan revisions, and an
execution proposal after plan approval. An optional OpenAI Responses provider
exists behind the same boundary, but full autonomous tool use through a real
LLM loop is still future work.

Safe edit proposals have started: Forge can create a proposed diff preview and
return the task to human review without mutating files. A proposal can now be
validated, rejected without touching files, or applied through a narrow
append-text or exact replace-text operation against existing Markdown files.
Applied proposals now run built-in validation before completion. Approved
runtime validation presets can also run allowlisted project checks after
completion, including presets composed from workspace config. The Review panel
now shows command permission requests from runtime-derived permission snapshots
instead of only listing preset commands.
