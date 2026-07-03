# Git Workflow

Document role: record how Forge should understand, display, and safely operate
on git repositories.

## Git Principle

Git is a first-class workflow surface. Forge should make every agent change
reviewable through git state and diffs.

## Repository Awareness

Forge should detect:

- git root
- current branch
- remote
- dirty files
- staged files
- untracked files
- ignored files
- merge or rebase state

## Diff Workflow

The diff should answer:

- what changed?
- why did it change?
- which task caused it?
- were tests run?
- what risk remains?

Diff views should support:

- file list
- inline diff
- file-level summary
- accept/reject where possible
- open in external IDE

## Commit Workflow

Commit steps:

1. User reviews diff.
2. Forge summarizes changes.
3. Forge proposes commit message.
4. User approves or edits.
5. Forge commits.
6. Forge links commit to task.

Never commit without explicit user approval.

## Push Workflow

Push should require explicit approval.

Before push, Forge should show:

- branch
- remote
- commits to push
- uncommitted changes
- possible risk notes

## Branch Workflow

Forge can propose branches for tasks.

Branch name examples:

- `forge/fix-login-timeout`
- `forge/add-task-history`

Branch creation may be automatic only if the user has allowed it in settings.

## Pull Request Handoff

Forge can prepare:

- PR title
- PR summary
- test plan
- changed files
- risk notes
- linked task

Creating or publishing the PR should require user approval.

## Safety Rules

Commands that require special care:

- reset
- clean
- checkout with file overwrite
- rebase
- force push
- branch delete

These should require approval and clear explanation.
