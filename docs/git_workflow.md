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

Current implementation:

- the runtime exposes `GET /git/status`
- the response includes git root, branch, upstream, head, dirty state,
  staged/unstaged/untracked files, and line stats when available
- the macOS Review panel shows the working tree and highlights files related
  to the selected task
- `.git` and `.forge` internals are not exposed through the review endpoints
- the runtime exposes `GET /git/commit-preview` as a read-only commit
  preparation artifact with suggested message, included files, validation
  suggestions, risk notes, blockers, and a non-mutating operation boundary
- the macOS Review panel can request and display that commit review artifact
  from the Working Tree surface

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

Current implementation:

- the runtime exposes `GET /git/diff?path=<repo-relative-path>`
- the endpoint returns a bounded textual diff for tracked files and a bounded
  synthetic diff for untracked text files
- the endpoint reports display mode, unavailable reason, byte/line counts, and
  app preview line limits so binary and oversized files are explicit review
  messages rather than malformed text diffs
- the macOS Review panel renders a compact side-by-side diff preview
- the macOS Review panel shows metadata and message-style previews when a file
  cannot be rendered as a side-by-side text diff
- changed files can be opened or revealed in Finder from the Review panel

Current limitations:

- no general staging, unstaging, discard, checkout/reset, or binary diff actions
- no binary visual preview beyond clear metadata/message handling
- no full-file diff navigation or advanced filtering beyond the first review
  list
- large diffs are truncated by the runtime

## Conflict Workflow

Forge treats an unmerged index as a dedicated human-review state instead of
allowing normal commit, branch, publish, push, or PR actions to proceed.

Current implementation:

- `GET /git/conflicts` reads actual unmerged files and exposes Base (stage 1),
  Ours (stage 2), Theirs (stage 3), and the working file with explicit missing,
  binary, oversized, irregular-file, and command-failure states.
- Operation-aware labels explain merge, rebase, and cherry-pick semantics;
  Forge does not pretend stage 2/3 always means the same branches.
- Every reviewed file carries a SHA-256 conflict fingerprint derived from its
  unmerged index entries and working content. Resolution requires that
  fingerprint plus the reviewed HEAD and exact `RESOLVE_GIT_CONFLICT`
  confirmation.
- `POST /git/conflicts/resolve` can select Ours, select Theirs, preserve a
  selected deletion, or atomically write reviewed manual UTF-8 text. Manual
  writes preserve the regular file mode and reject residual conflict markers,
  binary content, oversized content, symlinks, and paths outside the git root.
- A successful action stages only the selected file and refreshes remaining
  conflicts. If a task is linked, Forge records a task event; all resolutions
  emit runtime audit evidence.
- Forge never runs merge/rebase/cherry-pick continue or abort, never commits,
  and never pushes from conflict resolution. Those remain separate human
  decisions after all files are reviewed.
- `npm run smoke:git-conflicts` creates a temporary two-file real merge
  conflict and verifies stage reading, confirmation and stale-review gates,
  Ours/manual resolution, staging, and preservation of `MERGE_HEAD`.

## Commit Workflow

Commit steps:

1. User reviews diff.
2. Forge summarizes changes.
3. Forge proposes commit message.
4. User approves or edits.
5. Forge commits.
6. Forge links commit to task.

Never commit without explicit user approval.

Current implementation:

- Forge can prepare steps 2 and 3 through a read-only commit preview.
- The preview can include blockers such as clean working tree or unmerged
  files, plus risk notes such as unstaged/untracked changes or failed/missing
  task validation.
- The preview also includes commit preflight metadata: git author identity
  status, staged/unstaged/untracked counts, total additions/deletions,
  files-without-stats count, large-change warnings, validation state,
  hook-risk disclosure, and the commit path limit.
- Forge can create one local commit from the reviewed preview after explicit
  confirmation in the macOS Review panel.
- The runtime rechecks the expected HEAD, validates selected repo-relative
  paths against current git status, rejects unmerged files, rejects staged
  files outside the reviewed selection, preflights git author identity, stages
  only selected paths, creates the local commit, and records a task event when
  a task is linked.
- Forge does not push from the commit action; push is a separate explicit
  review action.

## Push Workflow

Push should require explicit approval.

Before push, Forge should show:

- branch
- remote
- commits to push
- uncommitted changes
- possible risk notes

Current implementation:

- Forge can prepare a push preview with branch, upstream, ahead/behind counts,
  commits to push, uncommitted local changes, structured preflight metadata,
  blockers, and risk notes.
- The push preflight summarizes branch readiness, upstream ahead/behind state,
  configured remote availability, commit-range scope, dirty-worktree state,
  action readiness, and common failure categories Forge will classify after an
  approved push attempt.
- Forge can push the current branch to its configured upstream after explicit
  confirmation in the macOS Review panel.
- The runtime rechecks expected HEAD, branch, and upstream from the reviewed
  preview, blocks detached/no-upstream/behind/no-ahead/unmerged states, and
  runs a non-force `git push <remote> HEAD:<remote-branch>`.
- If git rejects the push, Forge classifies common authentication,
  non-fast-forward, protected-branch, network, remote-rejected, and unknown
  failures before surfacing the command output.
- Forge does not force push, merge, reset, delete branches, or create a PR.
- The local `npm run smoke:git-remote` fixture verifies stale remote/
  non-fast-forward rejection after a reviewed push preview.

## Branch Workflow

Forge can propose branches for tasks.

Branch name examples:

- `forge/fix-login-timeout`
- `forge/add-task-history`

Branch creation may be automatic only if the user has allowed it in settings.

Current implementation:

- PR handoff preview can suggest a `forge/<task-slug>` branch name when the
  current checkout is detached or still on the default base branch.
- Forge can prepare a branch review artifact with current branch, expected
  HEAD, default base branch, target branch, create/switch mode, dirty state,
  structured preflight metadata, blockers, and risk notes.
- The preflight summarizes target branch validity, whether the current branch
  is the default base branch or detached, whether dirty local changes are
  allowed or blocked for the selected action, existing local/remote branch
  state, and overall action readiness.
- Forge can create a new local branch or switch to an existing local branch
  after explicit confirmation in the macOS Review panel.
- The runtime validates the target branch name, rechecks expected HEAD and
  current branch from the reviewed preview, blocks targeting the default base
  branch, blocks unmerged files, and blocks switching to existing branches
  while the working tree is dirty.
- Creating a new branch may carry current uncommitted changes forward into the
  new branch; the preview calls this out as a risk note.
- Forge does not set upstream tracking, push the branch, delete branches,
  checkout files, reset, or publish a PR from the branch action.

## Branch Publish Workflow

Branch publish is the first-push step after a local task branch exists.

Before publishing a branch, Forge should show:

- current branch
- remote
- remote branch
- default base branch
- commits that will become visible remotely
- uncommitted local changes that will remain local
- blockers and risk notes

Current implementation:

- Forge can prepare a branch publish preview with configured remote detection,
  default-base comparison, commits to publish, uncommitted local changes,
  structured preflight metadata, blockers, and risk notes.
- The branch publish preflight summarizes branch readiness, remote and remote
  branch availability, default-base comparison, commit-range scope,
  dirty-worktree state, action readiness, and common failure categories Forge
  will classify after an approved first-push attempt.
- Forge can publish the current local branch and set upstream after explicit
  confirmation in the macOS Review panel.
- The runtime rechecks expected HEAD, current branch, remote, and remote branch
  from the reviewed preview, blocks detached/default-base/already-upstream/
  no-commit/unmerged states, blocks remote branch collisions, and runs a
  non-force `git push --set-upstream <remote> HEAD:<branch>`.
- Publishing to a differently named remote branch is intentionally blocked in
  the first implementation.
- If git rejects the publish, Forge classifies common authentication,
  non-fast-forward, protected-branch, network, remote-rejected, and unknown
  failures before surfacing the command output.
- Forge does not force push, merge, reset, delete branches, or create a PR from
  the branch publish action.
- Remote branch collision detection checks local remote-tracking refs and
  `git ls-remote --heads` before publish. The local remote fixture verifies
  branch collision blocking and pre-receive remote policy rejection.

## Pull Request Handoff

Forge can prepare:

- PR title
- PR summary
- test plan
- changed files
- risk notes
- linked task

Creating or publishing the PR should require user approval.

Current implementation:

- Forge exposes a read-only PR handoff preview from the macOS Review panel.
- The runtime resolves a default base branch when possible, compares current
  branch work against that base, and shows the head branch, upstream, suggested
  branch name, PR title, draft body, test plan, commits, changed files,
  structured preflight metadata, blockers, and risk notes.
- The preflight summarizes base ref resolution, head branch readiness,
  upstream push/sync state, multi-remote or fork-like review risk, latest
  validation state, test evidence, and a publish-readiness summary.
- The preview blocks when the user is still on the default base branch, has no
  upstream, has unpushed commits, is behind upstream, is detached, has
  unmerged files, or has no commits between base and HEAD.
- Forge does not create, publish, update, close, or comment on pull requests
  yet.

## Safety Rules

Commands that require special care:

- reset
- clean
- checkout with file overwrite
- rebase
- force push
- branch delete

These should require approval and clear explanation.
