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

When post-apply validation fails and a validation repair brief exists, Forge can
generate a follow-up repair proposal linked to that brief. The previously
applied proposal is archived, the new proposal is validated, and the task
returns to human review. This does not mutate files until the user applies the
new proposal.

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

Task state also stores previous edit proposals in `editProposalRevisions`.
The current proposal remains in `editProposal`; historical revisions are
read-only audit records.

The current local deterministic provider emits a small reviewable proposal
against a context file. It includes a restricted apply operation so the UI,
state machine, event stream, persistence path, and controlled apply path can be
tested without introducing a general-purpose patch interpreter.

The OpenAI provider can emit richer review artifacts: multiple file changes,
restricted append/replace operations, and preview-only unsupported operations
alongside restricted create-file operations. These artifacts are useful for
review and future UI work, but validation blocks the proposal from apply when
any change is not supported by the current v0 apply engine.

Current restricted operation kinds:

- `AppendText`: appends bounded text to an existing Markdown file.
- `ReplaceText`: replaces exact bounded text only when the find text appears
  exactly once in the target file. The provider can generate this operation
  from explicit task messages such as `replace "old" with "new"` or
  `把“旧文本”替换成“新文本”`.
- `CreateFile`: creates a new bounded Markdown file under `docs/` only; it
  never overwrites an existing target.
- `PreviewOnly`: review artifact only; validation blocks apply.

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
- A proposal is validated when generated and again immediately before apply.
- A blocked generated proposal can be repaired automatically only within a
  bounded attempt limit and only by producing another review artifact.
- Current v0 apply behavior only supports `AppendText`, `ReplaceText`, and
  `CreateFile`.
- Current v0 modify behavior only writes existing Markdown files in
  `README.md` or `docs/*.md`; current create behavior only writes new
  `docs/*.md` files.
- Preview-only, delete, unsupported path, overwrite-create, or broad patch
  proposals may be shown for review but must validate as `Blocked`.
- Absolute paths, parent-directory traversal, `.git`, and `.forge` paths are
  rejected.
- Apply is blocked if the proposed append text is already present at the target
  file end.
- Apply is blocked if replace find text is missing, appears more than once,
  is identical to the replacement, or if either side is empty or oversized.
- Apply is blocked if create-file content is empty, oversized, outside
  `docs/*.md`, or targets an existing file.
- Applying a proposal moves the task into `Testing` and runs built-in
  validation commands before completion.
- Medium-risk project validation presets require explicit approval before they
  can run.
- Commit or push actions remain separate from edit application.
- Revising a proposal must not mutate files; it only replaces the current
  review artifact after archiving the rejected one.
- Repairing a proposal must not mutate files; it only archives superseded
  blocked artifacts and exposes the final proposal for review.
- Generating a validation repair proposal must not mutate files; it archives
  the previously applied proposal and exposes a new reviewed proposal linked to
  the repair brief.

## Future Work

- Generate richer model-backed patch content while keeping runtime-owned
  validation and review gates.
- Add a richer patch apply engine after exact replace validation is mature.
- Link edit proposals to normalized file-change records.
