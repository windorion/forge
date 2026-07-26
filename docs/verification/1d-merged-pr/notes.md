# 1d — real merged-PR wording (previously blocked on P2)

Date: 2026-07-26
Git SHA at capture: 141d5ae (PR-state follow-on committed immediately after)
Window: main workspace window, `RunCompleteState` (`task.status == "Completed"`)

## What this closes

`docs/design_handoff_coverage.md` marked `1d` Verified with one carve-out:
"hosted PR publication remains P2". The handoff's own header reads
`… #128 · finished in 11m` — a real pull request number. Until P2 landed, the
app substituted the task ID prefix (`#<6 chars>`). With real PR publishing and
PR-state refresh, 1d now shows the actual PR number and live state.

## Evidence

`20260726T165941Z_141d5ae_Forge.png` — the completion header renders
`#128 · merged · finished in 10m`, matching the handoff's
`#<pr-number> · finished in <duration>` shape with the real merged state added.
The merged state is rendered in ink rather than muted.

`20260726T170114Z_141d5ae_Forge.png` — the same screen with the PR handoff
panel loaded: `PR #128` + a `MERGED` badge (accent fill, 1.5px ink border),
`forge/rate-limiting → main`, `CHECK STATUS` and `VIEW ON GITHUB →` actions, and
the real selectable PR URL.

## How the state was produced

A completed task carrying a merged `pullRequest` record was injected directly
into the workspace SQLite store, then read back through the runtime (`GET
/tasks` confirmed `merged: true`) and rendered by the real app — no mocked view
state. The injected task was removed afterwards.

The open → merged transition itself is covered end-to-end by `smoke:pr-publish`,
which publishes against a mock GitHub API, flips the mock to merged, and asserts
`POST /git/pr-status` persists `merged: true` plus a
`git.pull_request.state_changed` event.

Duration reads 10m vs the handoff's 11m purely because it is computed from the
injected task's real timestamps.

## Not verified here

A merge performed on real github.com — that needs the founder's token and a real
PR. The runtime's status path is otherwise fully covered by the fixture.
