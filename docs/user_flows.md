# User Flows

Document role: record end-to-end workflows that product, design, and runtime
implementation must support.

Last updated: 2026-07-11

## Flow 1: First Launch And Workspace Setup

Goal: get a developer from installing Forge to the first coding task.

Steps:

1. User opens Forge.
2. Forge explains local permissions and provider/GitHub choices plainly.
3. User selects a repository folder.
4. Forge detects git root, project type, package manager, languages, and likely
   validation commands.
5. Forge indexes enough local context to start.
6. Forge lands on the `1a` task composer: "What should Forge build?"

Required states:

- no repo
- permission needed
- indexing
- ready
- indexing failed
- provider needs configuration

## Flow 2: New Coding Task

Goal: turn vague developer intent into an approved implementation plan.

Steps:

1. User enters a coding task, such as "fix random logout" or "add rate limiting
   to the public API."
2. Forge creates a task session and records the user objective.
3. Agent reads/searches relevant repo context.
4. If the task is unclear, agent asks one or more clarification questions.
5. User answers in the session.
6. Agent produces a plan card with steps, files/areas, risk notes, estimates,
   and test plan.
7. User edits/regenerates/approves the plan.
8. Only after approval can the agent mutate files or run approved commands.

Required surfaces:

- `1a` new task composer
- `32a` chat-to-task session
- `1b` or `20a` plan approval

## Flow 3: Live Agent Coding Run

Goal: let the agent code while the user can understand what is happening.

Steps:

1. Agent starts the approved run on a task branch or controlled working tree.
2. Agent streams read/search/tool activity.
3. Agent edits files through the patch engine.
4. Agent runs approved checks/tests.
5. Agent summarizes each step in the live stream.
6. Diff and Tests tabs update during the run.
7. User can pause, abort, or open diff/tests at any point.

Current implementation: Pause and Abort are cooperative at agent-step
boundaries, while Resume creates a linked loop from the prior safe checkpoint.
Commands already in progress use their separate Cancel Command control.

Visible surfaces:

- `14a` main window
- live thinking/code stream
- plan progress strip
- Log/Diff/Tests tabs
- pause/abort controls

Quality bar:

- The run must look like real engineering work, not a status-card sequence.
- Tool calls, file edits, command output, and failures must be chronological.

## Flow 4: Test Failure And Self-Fix

Goal: support the normal case where the first attempt fails.

Steps:

1. Agent runs an approved validation/test command.
2. Command fails.
3. Tester summarizes the failure.
4. Coder proposes or applies a reviewed follow-up patch depending on the
   configured safety mode.
5. Agent reruns the approved check.
6. Forge preserves the failure, fix attempt, and rerun output.

Important rule:

- The user can inspect every failure and fix attempt.
- Product/architecture decisions pause and ask the user instead of guessing.

## Flow 5: Decision Point

Goal: let the agent stop cleanly when it needs human judgment.

Steps:

1. Agent detects an ambiguous product, architecture, dependency, permission, or
   cost decision.
2. Task moves to `Needs You`.
3. Forge shows the question with options and consequences.
4. User answers one task or batch-answers several tasks.
5. Agent resumes from the checkpoint.

Required surfaces:

- `33a` agent question
- `34a` batch question inbox later

## Flow 6: Diff Review

Goal: make generated work safe and fast to review.

Steps:

1. Forge shows `Review Ready` after tests/checks complete or after the run
   pauses for review.
2. User opens full diff review.
3. Forge shows changed-file tree, unified/split diff, why-this-change,
   conventions matched, and tests covering each file.
4. User approves a file, requests changes, or asks a question.
5. Requested changes create a revision loop.
6. Final approval moves to commit/PR handoff.

Required surface:

- `10a` Fullscreen diff review.

Review must show:

- file list with A/M/D markers
- diff
- plan-step link
- reasoning per file
- tests and command evidence
- risk notes
- request-change path

## Flow 7: Commit And PR Handoff

Goal: turn reviewed changes into a publishable result.

Steps:

1. User approves the final diff.
2. Forge proposes commit title/body.
3. User commits after explicit approval.
4. Forge pushes only after explicit approval.
5. Forge drafts or opens a PR only after explicit approval.
6. Forge records commit hash, branch, PR URL, tests, and task link.

Approval required:

- commit
- push
- PR creation
- branch creation/switch when risky

## Flow 8: Resume, Recovery, And Rollback

Goal: make long-running agent work durable.

Steps:

1. User returns to Forge after closing the app, losing network, or a crash.
2. Forge restores task state, plan, context, command logs, patch/diff, and
   approvals.
3. User resumes, reviews, retries, rolls back, or archives.

Required surfaces:

- crash recovery
- offline queue
- task history
- audit log

## Flow 9: Quick Entry Later

Goal: start or resume agent work outside the main window.

Steps:

1. User invokes command palette, quick capture, menu bar, CLI, or template.
2. Forge creates or resumes a task.
3. The same plan gate applies.
4. The run returns to the main coding session when work starts.

Required surfaces later:

- `5a` command palette
- `12a` quick capture
- `7a` menu bar mini window
- `27a` CLI companion
- `36a` task templates

## Flow Quality Bar

Every core flow should answer:

- What did I ask Forge to build?
- What has the agent read?
- What is the plan?
- Is the agent allowed to proceed?
- What is the agent doing now?
- What changed?
- What tests/checks ran?
- Where did it fail or self-fix?
- What needs my decision?
- What is ready to review or publish?
