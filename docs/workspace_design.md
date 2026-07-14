# Workspace Design

Document role: record the product surface, information architecture, screen
responsibilities, and interaction rules for the Forge workspace.

Last updated: 2026-07-11

## Design Direction

Forge's workspace should feel like a macOS-native coding agent session, not a
workflow dashboard.

The user should experience:

```text
describe task -> agent clarifies -> plan gate -> live coding run -> tests ->
self-fix -> diff review -> commit/PR handoff
```

The current app has too much emphasis on status panels and preflight cards.
The next UI pass should follow `design_handoff_forge/`, especially:

- `32a` New session: chat to task, embedded plan card, live agent work.
- `14a` Main window: task queue, live thinking stream, plan progress, tabs.
- `1a` New task: "What should Forge build?"
- `1b` and `20a` Plan approval.
- `10a` Fullscreen diff review.
- `33a` and `34a` decision prompts.

## Visual System

Use the design handoff as the product style source:

- paper background `#f4f4f1`
- white panels and black terminal panels
- `1.5px solid #0a0a0a` borders
- hard unblurred shadows
- `#a674ff` accent for selected/running/primary states
- JetBrains Mono for UI labels, metrics, code, command output, and task data
- Helvetica Neue for prose where needed
- square controls and sharp app-owned UI, with rounded corners only where
  macOS system surfaces require them

Do not drift into generic macOS dashboard styling. The product should feel
developer-first, sharp, high-contrast, and slightly raw.

## Primary Workspace Model

### Left: Repository And Task Queue

Responsibilities:

- selected repository
- compact task composer
- active/running/blocked/failed/PR-ready tasks
- task status badges
- budget/usage glance
- runtime connection status only as a small utility signal

This should replace the current broad sidebar/status feeling. The sidebar is a
task queue, not a settings dashboard.

### Center: Live Agent Session

Responsibilities:

- current task title and status
- pause/abort controls
- plan progress strip
- live thinking/tool/code stream
- command output summaries
- visible step transitions
- bottom tabs: `LOG`, `DIFF`, `TESTS`

This is the most important surface. When a task is running, the user should
see the agent doing engineering work: reading files, matching conventions,
editing code, running tests, and explaining skips.

Current implementation: the `32a` live footer shows Pause and Abort only for
an active Agent Run Loop, shows the current loop state while a cooperative stop
finishes, and replaces Run with Resume for a paused/aborted/failed checkpoint.
Log, Diff, and Tests are mutually exclusive views in the same live-work column,
so the stream is never rendered behind a second legacy log surface.

### New Session Surface

Responsibilities:

- task conversation
- clarification questions
- plan card embedded in chat
- explicit approve/run action
- live run preview on the right once approved

Chat is strongest during task formation. After approval, the live coding run
should become the dominant surface.

Current implementation: active intent-brief questions appear as an explicit
`PLANNING PAUSED` decision block in the conversation and plan rail. A resolving
reply automatically embeds the generated plan in chat. The card and rail show
time, cost, risk, file-area, and validation evidence; `Approve & Run` enters
the bounded live loop in one action while preserving every later review gate.

### Plan Gate

Responsibilities:

- proposed plan steps
- touched files or expected file areas
- estimated time/cost
- risk labels
- approve all vs step-by-step mode
- edit/regenerate plan

The plan gate is the boundary before code changes. It should be fast to read
and approve, not buried among generic state cards.

### Diff Review

Responsibilities:

- file tree with A/M/D markers and line stats
- unified and split diff modes
- per-file reasoning: why this change, convention matched, tests covering it
- per-file approve/request-change actions
- final approve/apply/commit/PR handoff
- latest changeset transaction evidence: phase, verified file outcomes,
  compensation/recovery state, and any recovery error

The diff review should follow `10a`. It is the trust surface, not an
afterthought inside a scroll stack.

Current implementation: pending proposal diffs render before Apply and working
tree diffs render afterward. Standard unified hunks are parsed into exact
unified or aligned split rows with old/new line numbers. The surface provides
stable file selection, reviewed/to-go progress, `J`/`K` hunk navigation,
`⌘←`/`⌘→` file navigation, and `⌘↵` file approval alongside visible buttons.
Validation evidence names the selected file only when stored command metadata
references its path or filename; otherwise the result appears in a separate
task-wide section explicitly marked as not proving file coverage.

### Tests And Terminal

Responsibilities:

- live command output
- command status and exit code
- failed test summaries
- rerun controls for approved commands
- self-fix loop history

Terminal output should feel close to Claude Code/Codex: readable, chronological,
and linked to agent actions.

### Decision Inbox

Responsibilities:

- agent questions
- explicit choices
- consequence comparison
- "nothing is guessed" state
- batch answering across tasks later

Decision prompts are not errors. They are part of the trust model.

## State Model

Core task states should map to visible product states:

- Drafting: user is describing the task.
- Clarifying: agent asks questions before planning.
- Plan Proposed: nothing has run yet.
- Running: agent is reading/editing/testing.
- Needs You: agent is blocked on a decision.
- Review Ready: diff and tests are ready.
- Failed: failure summary and rollback/retry path are visible.
- PR Ready/Open: reviewed output is ready to publish or already published.

Avoid generic labels like `Human Review` as the primary UI copy. They describe
implementation state, not user experience.

## Interaction Rules

- The first screen asks what Forge should build.
- The main running screen shows live agent work before metadata.
- The plan gate is required before code mutation.
- The agent must ask when the next step requires product/architecture judgment.
- Diff and tests must be one click away during and after a run.
- Review actions are file-level first, task-level second.
- Runtime diagnostics live in Settings, not the core demo path.
- Git preflight remains available, but it should not dominate the primary
  coding demo.
- Keyboard shortcuts should follow the design handoff: `⌘1` Diff, `⌘2` Tests,
  `⌘3` Log, `⌘N` New Task, `⌘K` command/repo switch.

## MVP Workspace

The next MVP workspace should implement these surfaces in order:

1. `1a` New task composer.
2. `1b` Plan approval card.
3. `14a` Main running task view with live stream and Log/Diff/Tests tabs.
4. `10a` Fullscreen diff review.
5. `32a` Chat-to-task session once the main run loop works.

This is intentionally different from polishing the current dashboard. The goal
is to make the first demo feel like an agent coding product.
