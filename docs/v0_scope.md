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
7. Reach a human review gate before any code changes are applied.
8. Approve a generated edit proposal before a narrow, controlled file change is
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
- visible tool calls
- visible context files
- visible plan steps
- task conversation
- structured intent briefs
- human review gate
- SQLite task persistence
- model-provider abstraction
- execution proposals
- safe edit proposals
- edit proposal validation
- explicit apply/reject actions for edit proposals
- post-apply validation runs
- approved runtime validation preset
- workspace validation preset config
- command permission request surface
- no automatic file changes

## V0 Not Included

- real LLM provider
- autonomous file edits
- command execution
- test runner
- git diff generation
- full repository index
- Tree-sitter parsing
- model settings UI
- release packaging

## V0 Completion Criteria

V0 is complete when:

- A user can run `cd runtime && npm run dev`.
- A user can run `./script/build_and_run.sh`.
- The app can create a task.
- Creating a task records the initial objective as a task message and produces
  a structured intent brief.
- A user can add a task message and receive an updated intent brief.
- The runtime can inspect real local project files.
- The app updates from runtime events.
- The task reaches `Human Review`.
- The UI shows tool calls and context files.
- No code changes are made without approval.
- A generated edit proposal can be rejected without changing files.
- A generated edit proposal can be explicitly applied through a restricted
  Markdown append operation.
- A generated edit proposal can be validated before apply, and blocked if the
  workspace no longer matches the safe append boundary.
- Applying an edit proposal runs controlled built-in validation before the task
  is marked completed.
- A task can approve and run the `runtime-typescript` validation preset for
  `npm run check` and `npm run build`.
- Runtime can load workspace validation presets from
  `.forge/validation-presets.json`.
- The app can show runtime-derived command permission state before approving or
  running project validation presets.

## V0 Next After Completion

After v0, Forge should move toward v0.1:

- read/search tools powered by real task intent
- richer file-edit proposal flow

The explicit plan approval action has started: approval is recorded and opens
controlled execution preparation, but it does not yet run model-driven edits.

The model-provider abstraction has also started: the default local
deterministic provider creates task intent briefs and an execution proposal
after plan approval. Real remote or local LLM providers are still future work.

Safe edit proposals have started: Forge can create a proposed diff preview and
return the task to human review without mutating files. A proposal can now be
validated, rejected without touching files, or applied through a narrow
append-text operation against existing Markdown files. Applied proposals now
run built-in validation before completion. Approved runtime validation presets
can also run allowlisted project checks after completion, including presets
composed from workspace config. The Review panel now shows command permission
requests from runtime-derived permission snapshots instead of only listing
preset commands.
