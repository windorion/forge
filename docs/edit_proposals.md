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
8. Task returns to `Human Review` with current phase `Edit Proposal Review`.
9. User can apply the proposal or request changes.

No file is changed while the proposal is generated. `changedFiles` remains
empty until the user explicitly applies the proposal.

When a proposal is rejected, Forge records the rejection, leaves files
unchanged, and allows another proposal to be generated. When a proposal is
applied, Forge records an approval decision and updates `changedFiles`.

## Runtime Data

An edit proposal stores:

- provider metadata
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

The current local deterministic provider emits a small reviewable proposal
against a context file. It includes a restricted append-text operation so the
UI, state machine, event stream, persistence path, and controlled apply path can
be tested without introducing a general-purpose patch interpreter.

## Safety Rules

- Proposed file changes are not real workspace changes until explicitly
  applied.
- The UI must make the proposal status visible.
- The runtime must log proposal events.
- Applying a proposal requires a separate explicit action.
- Current v0 apply behavior only supports `AppendText`.
- Current v0 apply behavior only writes existing Markdown files in `README.md`
  or `docs/*.md`.
- Absolute paths, parent-directory traversal, `.git`, and `.forge` paths are
  rejected.
- Commit or push actions remain separate from edit application.

## Future Work

- Generate real patch content from a model provider.
- Validate patch applicability without applying it.
- Add a richer patch apply engine after preview validation is mature.
- Store proposal revisions.
- Link edit proposals to normalized file-change records.
