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
6. Reach a human review gate before any code changes are applied.

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
- human review gate
- no automatic file changes

## V0 Not Included

- real LLM provider
- autonomous file edits
- command execution
- test runner
- git diff generation
- SQLite persistence
- full repository index
- Tree-sitter parsing
- model settings UI
- release packaging

## V0 Completion Criteria

V0 is complete when:

- A user can run `cd runtime && npm run dev`.
- A user can run `./script/build_and_run.sh`.
- The app can create a task.
- The runtime can inspect real local project files.
- The app updates from runtime events.
- The task reaches `Human Review`.
- The UI shows tool calls and context files.
- No code changes are made without approval.

## V0 Next After Completion

After v0, Forge should move toward v0.1:

- SQLite task persistence
- model provider abstraction
- read/search tools powered by real task intent
- explicit plan approval action
- first safe file-edit proposal flow
