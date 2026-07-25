# GitHub PAT entry + PR publish wiring

Date: 2026-07-25
Git SHA at capture: 09cb0f4 (runtime PR-creation commit; app wiring committed
immediately after)
Window: Settings scene, GITHUB section (driven via
`script/drive_surface.sh settings:GITHUB`, which now accepts a section suffix)

## What this covers

This is not one of the 43 handoff screens. The handoff's `6a` GITHUB settings
page shows an OAuth/device-flow connect flow, which stays blocked on a
founder-registered OAuth Client ID. This note records the **additional** PAT
section added below the existing scope cards so PR publishing is usable now.

## Evidence

`20260725T212522Z_09cb0f4_Forge-Settings.png` — the GITHUB section rendering
the new PERSONAL ACCESS TOKEN block: heading, NOT SET badge, explanatory copy
naming the required scopes, secure field, and SAVE TOKEN button, in the
handoff's visual language (1.5px ink borders, JetBrains Mono, paper fill).

Known capture artifact: button and badge *labels* do not rasterize through the
`cacheDisplay` self-render path — the scope cards above show the same thing
(their titles are absent while their detail lines render). This is a capture
limitation, not a rendering defect; the labels are present in the view code and
in the live window.

## Contract verification (beyond the screenshot)

1. `swift build` clean.
2. The app's `GitPullRequestPublishRequest` encodes exactly:
   `{baseBranch, body, confirmation, draft, expectedHead, expectedHeadBranch,
   githubToken, headBranch, taskID, title}`.
3. POSTing that exact payload to a live runtime returns **409 with a blocker
   message**, not 400 — i.e. it passed schema validation and reached the
   concurrency/blocker guard, which correctly refused to open a PR from the
   default base branch.
4. The token does not appear anywhere in the response body.

## Not verified here

Opening a real pull request against github.com — that needs the founder's own
token and a real remote. The runtime path itself is covered end-to-end by
`smoke:pr-publish` against a mock GitHub API.
