# Edit Proposals

Document role: record the safe edit proposal flow, review boundaries, and how
proposed diffs differ from applied file changes.

## Principle

Forge should separate proposing edits from applying edits.

An edit proposal is a review artifact. It can describe files, rationale, and a
diff preview, but it must not mutate the workspace. File mutation should only
happen in a later explicit apply step with a clear approval boundary.

## Current Flow

Current runtime flow:

1. User creates a task.
2. Agent Loop v0 builds local context.
3. Task reaches `Human Review`.
4. User approves the plan.
5. Runtime asks the model provider for an execution proposal.
6. User can request a safe edit proposal.
7. Runtime creates `editProposal` with proposed file changes and a diff
   preview.
8. Runtime validates the proposal against the current workspace.
9. Task returns to `Human Review` with current phase `Edit Proposal Review`.
10. User can refresh validation, apply the proposal, or request changes.
11. If changes are requested, user can add task conversation context and ask
    Forge to revise the rejected proposal.
12. Runtime archives the rejected proposal in revision history, creates a new
    proposal from the latest conversation, validates it, and returns to
    `Human Review`.
13. If an applied proposal has rollback metadata, the user can explicitly
    rollback it. The runtime verifies current file hashes against the applied
    hashes, restores local rollback snapshots or deletes created files, records
    a rollback approval, and marks the proposal `RolledBack`.

No file is changed while the proposal is generated. `changedFiles` remains
empty until the user explicitly applies the proposal.

When a proposal is rejected, Forge records the rejection, leaves files
unchanged, and allows another proposal to be generated. Revised proposals are
new review artifacts: the rejected proposal is retained in proposal revision
history, the current proposal is replaced, and `changedFiles` remains empty.
When a proposal is applied, Forge validates the proposal again, records an
approval decision, and updates `changedFiles`. The runtime then runs controlled
post-apply validation before marking the task completed.

When a generated proposal is blocked by validation, Forge can run a bounded
provider repair loop before returning to human review. The runtime sends the
failed validation summaries and checks back to the provider, asks for a revised
proposal, validates again, and stops after the configured attempt limit. Each
blocked intermediate proposal is archived in `editProposalRevisions` as
`Superseded`; no file is changed during repair.

When post-apply validation or a task-scoped command fails and a repair brief
exists, Forge can generate a follow-up repair proposal linked to that brief.
For post-apply validation failures, the previously applied proposal is
archived, the new proposal is validated, and the task returns to human review.
For task-command failures, Forge can create a linked review-only proposal even
when no proposal has been applied yet. This does not mutate files until the
user applies the new proposal. If the user applies a command-sourced repair
proposal, Forge records `commandRerunEvidence` tying together the failed
command run, repair brief, applied proposal, and original command id; the
separate rerun action then verifies the repair through the approved command
runner.

When rollback is requested, Forge treats it as another explicit mutation gate.
Rollback is blocked if the current file no longer matches the recorded
post-apply hash, because that would overwrite later user or agent changes.

## Runtime Data

An edit proposal stores:

- provider metadata
- source message id
- revision number
- previous proposal id
- summary
- proposed file changes
- change type
- rationale
- diff preview
- risk level
- status
- generated timestamp
- optional decision timestamp
- optional decision note
- optional restricted apply operation
- optional validation result
- optional applied-file rollback metadata
- optional rollback timestamp and rollback note

Task state also stores previous edit proposals in `editProposalRevisions`.
The current proposal remains in `editProposal`; historical revisions are
read-only audit records.

The current local deterministic provider emits a small reviewable proposal
against a context file. It includes a restricted apply operation so the UI,
state machine, event stream, persistence path, and controlled apply path can be
tested without introducing a general-purpose patch interpreter.

The OpenAI provider can emit richer review artifacts: multiple file changes,
restricted append/replace/patch operations, and preview-only unsupported
operations alongside restricted create-file operations. These artifacts are
useful for review and future UI work, but validation blocks the proposal from
apply when any change is not supported by the current v0 apply engine.

Current restricted operation kinds:

- `AppendText`: appends bounded text to an existing Markdown file.
- `ReplaceText`: replaces exact bounded text only when the find text appears
  exactly once in the target file. It can now target existing Markdown files
  and allowlisted source/text files such as TypeScript, Swift, JavaScript,
  JSON, CSS, HTML, YAML, TOML, Python, Go, Rust, Java, Kotlin, C/C++, and
  headers. The provider can generate this operation from explicit task
  messages such as `replace "old" with "new"` or
  `把“旧文本”替换成“新文本”`.
- `PatchText`: applies multiple exact bounded find/replace hunks to one
  existing Markdown or allowlisted source/text file. Each hunk must have
  non-empty find and replacement text, each find text must appear exactly once
  in the original target file, and the runtime simulates the ordered patch
  before applying it.
- `CreateFile`: creates a new bounded Markdown file under `docs/` only; it
  never overwrites an existing target.
- `PreviewOnly`: review artifact only; validation blocks apply.

After apply, the proposal records `appliedFileChanges` metadata for every
changed file: operation kind, applied timestamp, before/after SHA-256 hashes,
before/after byte lengths when available, and the rollback strategy
(`RestorePreviousContent` or `DeleteCreatedFile`). Restore rollbacks also keep
a local snapshot path under `.forge/rollback-snapshots/`. The runtime exposes
`POST /tasks/:taskID/rollback-edit-proposal` to apply that rollback after
current-file hash verification.

Validation stores:

- overall status
- summary
- checked timestamp
- per-file status
- per-file check messages

Post-apply validation stores:

- trigger
- preset id
- preset name
- risk level
- overall status
- summary
- started timestamp
- ended timestamp
- command-level results

## Safety Rules

- Proposed file changes are not real workspace changes until explicitly
  applied.
- The UI must make the proposal status visible.
- The runtime must log proposal events.
- Applying a proposal requires a separate explicit action.
- Rolling back an applied proposal requires a separate explicit action.
- A proposal is validated when generated and again immediately before apply.
- A blocked generated proposal can be repaired automatically only within a
  bounded attempt limit and only by producing another review artifact.
- Current v0 apply behavior supports `AppendText`, exact `ReplaceText`,
  multi-hunk exact `PatchText`, and `CreateFile`.
- Current v0 append behavior only writes existing Markdown files in
  `README.md` or `docs/*.md`.
- Current v0 exact replace behavior can write existing allowlisted source/text
  files after strict path, size, text, and single-occurrence checks.
- Current v0 patch behavior can write existing allowlisted source/text files
  after strict path, size, hunk-count, original single-occurrence, and ordered
  simulation checks.
- Current v0 create behavior only writes new `docs/*.md` files.
- Preview-only, delete, unsupported path, overwrite-create, or broad patch
  proposals may be shown for review but must validate as `Blocked`.
- Absolute paths, parent-directory traversal, `.git`, and `.forge` paths are
  rejected.
- Apply is blocked if the proposed append text is already present at the target
  file end.
- Apply is blocked if replace find text is missing, appears more than once,
  is identical to the replacement, or if either side is empty or oversized.
- Apply is blocked if any patch hunk find text is missing, duplicated, appears
  more than once in the original file, cannot be applied in order, is identical
  to its replacement, or if any hunk/patch exceeds size limits.
- Apply is blocked for source/text targets outside the allowlist, generated
  directories, lockfiles, secret-like files, oversized files, or binary-looking
  content.
- Apply is blocked if create-file content is empty, oversized, outside
  `docs/*.md`, or targets an existing file.
- Applying a proposal moves the task into `Testing` and runs built-in
  validation commands before completion.
- Medium-risk project validation presets require explicit approval before they
  can run.
- Commit or push actions remain separate from edit application.
- Rollback is blocked if the current file hash differs from the recorded
  post-apply hash, if a required snapshot is missing, or if a snapshot hash
  does not match the recorded before hash.
- Revising a proposal must not mutate files; it only replaces the current
  review artifact after archiving the rejected one.
- Repairing a proposal must not mutate files; it only archives superseded
  blocked artifacts and exposes the final proposal for review.
- Generating a repair proposal from a validation or task-command repair brief
  must not mutate files. It archives the previously applied proposal only when
  one exists and exposes a new reviewed proposal linked to the repair brief.
- Applying a task-command repair proposal may create rerun evidence, but the
  original command is only rerun through the explicit rerun action.

## Future Work

- Add richer cross-file patch orchestration after exact text-hunk validation is
  mature.
- Generate broader model-backed patch content while keeping runtime-owned
  validation and review gates.
- Add richer rollback revalidation and recovery UI for partially failed or
  user-modified rollback attempts.
