# User Flows

Document role: record end-to-end workflows that product, design, and runtime
implementation must support.

## Flow 1: First Launch And Workspace Setup

Goal: get a developer from installing Forge to a usable local workspace.

Steps:

1. User opens Forge.
2. Forge explains required local permissions in plain language.
3. User selects a repository folder.
4. Forge creates a workspace record.
5. Forge detects project type, git root, package manager, languages, and test
   commands.
6. Forge builds an initial local index.
7. Forge shows the task workspace.

Required states:

- permission needed
- indexing
- ready
- indexing failed
- repository unsupported

## Flow 2: Create A Task

Goal: turn user intent into a structured task.

Steps:

1. User describes work: "Fix the login timeout bug."
2. Forge creates a task conversation and records the initial objective as a
   user message.
3. Forge produces a structured intent brief with summary, constraints,
   acceptance criteria, open questions, and next action.
4. User can clarify or refine the task in the same task conversation.
5. User can ask Forge to update the plan from the latest conversation.
6. Forge records a plan revision and returns to human review.
7. Planner agent inspects repo context.
8. Forge presents a plan.
9. User approves, edits, or rejects the plan.

Task record should include:

- title
- objective
- messages
- context
- plan
- plan revisions
- constraints
- status
- approval history

## Flow 3: Agent Execution

Goal: let the agent work while the user can inspect progress.

Steps:

1. Runtime builds context.
2. Agent reads relevant files.
3. Agent proposes edits.
4. Runtime applies edits in a controlled working area.
5. Agent runs tests or validation commands.
6. Agent reacts to failures.
7. Runtime streams progress to the UI.

Visible surfaces:

- planner checklist
- active agent
- tool calls
- terminal output
- changed files
- current reasoning summary

## Flow 4: Human Review

Goal: make generated work safe to accept.

Steps:

1. Forge summarizes changed files.
2. User opens diff review.
3. Forge explains why each change was made.
4. User accepts, rejects, or asks for revisions.
5. If revisions are requested, user can clarify in the task conversation and
   Forge generates a revised edit proposal without changing files.
6. Accepted changes are applied to the working tree.

Review must show:

- file list
- before/after diff
- proposal revision history
- tests run
- command logs
- risk notes
- unresolved questions

## Flow 5: Test Failure Loop

Goal: support realistic engineering work where the first attempt fails.

Steps:

1. Agent runs a test command.
2. Command fails.
3. Tester agent summarizes the failure.
4. Coder agent modifies code or tests.
5. Runtime reruns the command.
6. Forge records the full loop.

Important rule:

The user should be able to inspect the failure and each fix attempt.

## Flow 6: Git Commit

Goal: turn reviewed changes into a commit.

Steps:

1. User reviews diff.
2. Forge proposes a commit message.
3. User edits or accepts the message.
4. Forge commits only after explicit approval.
5. Forge records commit hash and task link.

Approval required:

- commit
- push
- branch creation if policy requires it

## Flow 7: Menu Bar Quick Task

Goal: start a task from anywhere on macOS.

Steps:

1. User triggers global shortcut.
2. Forge opens a compact launcher.
3. User enters a command such as "review current diff."
4. Forge detects active app, repository, branch, and current context when
   possible.
5. Forge opens or updates the relevant task.

Examples:

- explain selected code
- fix failing test
- review current diff
- commit current changes
- open latest task

## Flow 8: Open In Existing IDE

Goal: keep Forge IDE-agnostic.

Steps:

1. User reviews a changed file in Forge.
2. User chooses "Open in Xcode", "Open in Cursor", or "Open in VS Code."
3. Forge opens the file and line when possible.
4. Forge keeps task state synchronized with file changes.

## Flow 9: Resume Previous Task

Goal: make long tasks durable.

Steps:

1. User returns to Forge.
2. Forge lists active and recent tasks.
3. User opens a task.
4. Forge restores plan, messages, diff, commands, approvals, and memory.
5. User continues, reviews, or archives the task.

## Flow Quality Bar

Every core flow should answer:

- What is the task?
- What is the current state?
- What did the agent do?
- What changed?
- What needs approval?
- What is the next action?
