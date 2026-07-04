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

No file is changed while the proposal is generated. `changedFiles` remains
empty until the user explicitly applies the proposal.

When a proposal is rejected, Forge records the rejection, leaves files
unchanged, and allows another proposal to be generated. When a proposal is
applied, Forge validates the proposal again, records an approval decision, and
updates `changedFiles`. The runtime then runs controlled post-apply validation
before marking the task completed.

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
- optional validation result

The current local deterministic provider emits a small reviewable proposal
against a context file. It includes a restricted append-text operation so the
UI, state machine, event stream, persistence path, and controlled apply path can
be tested without introducing a general-purpose patch interpreter.

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
- Current v0 apply behavior only supports `AppendText`.
- Current v0 apply behavior only writes existing Markdown files in `README.md`
  or `docs/*.md`.
- Absolute paths, parent-directory traversal, `.git`, and `.forge` paths are
  rejected.
- Apply is blocked if the proposed append text is already present at the target
  file end.
- Applying a proposal moves the task into `Testing` and runs built-in
  validation commands before completion.
- Medium-risk project validation presets require explicit approval before they
  can run.
- Commit or push actions remain separate from edit application.

## Future Work

- Generate real patch content from a model provider.
- Add a richer patch apply engine after preview validation is mature.
- Store proposal revisions.
- Link edit proposals to normalized file-change records.
