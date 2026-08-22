# macOS Native Design

Document role: record how Forge should use macOS as a product advantage,
including native features, permissions, distribution, and system integration.

## Native Product Thesis

Forge should not feel like a browser window in a desktop wrapper. The Mac
itself should become part of the agent workspace.

## Core Native Features

### Mission Control Window Surface

The current `4a` implementation is a 1240px auxiliary sheet opened with
`⌘⇧M`. It retains explicit desktop selection state, offers `⌘1–3` repository
focus and `⌘⇧N` new-task access, and preserves up to three local repository
slots in app preferences. The primary repository uses the normal runtime; up
to two others use app-owned read-only observer runtimes on unique loopback
ports. The supervisor polls them, validates repository identity, shows PID and
port evidence, and terminates only its own children. A visible confirmation can
authorize one of those repositories as active for this app session. The
transition shows its exact path/port/consequences, verifies a generated health
authorization ID, displays shortened evidence in the footer, permits safe
return to read-only, and extends Pause All across accepted active runtimes.
Repository task cards now retain an explicit `(repository path, task ID)`
selection and open fresh Overview/Review/Commands/Git/Activity detail inside
the root-owned Mission Control surface, without a modal sheet or primary-
workspace restart.
The new-task composer selects its target repository explicitly. Accepted
active runtimes support scoped conversation, plan, file-review, Apply,
validation preset approval/run, runtime-known command run/cancel, reviewed
self-fix rerun, and separately confirmed local commit/branch/non-force publish/
push actions. Observers expose the same GET evidence read-only. Loading,
mutation, authorization, and routing errors live in the shared workspace model
rather than view-local network state.
Active background runtimes now report a supervised queue mode. The same shared
model owns a persisted 1-2 background slot preference, oldest-first then
round-robin grant cursor, running/queued counts, next repository, and grant
history count. These appear in the main Mission Control chrome rather than a
modal. DEBUG builds expose deterministic `missionControlFixture:observer`,
`:active`, `:queued`, and `:review` states through the existing native surface
driver; `script/verify_mission_control_surfaces.sh` captures all four view
hierarchies without Screen Recording permission. A second allowlisted DEBUG
action channel drives the owning task-detail view through Commands -> Git ->
Commands, and `script/verify_mission_control_routed_actions.sh` archives the
three rendered states in `docs/verification/mission-control-routed-actions/`.
This remains the fast native view/action-transition evidence, distinct from
XCUITest. Forge now also has a generated `ForgeApp.xcodeproj` UI-test host and
three real `XCUIApplication` methods for authorization/revocation, slots, card
navigation, command actions, and Git confirmation cancellation. The bundle
passes `build-for-testing`. An authenticated action-level run executed all three
methods and passed the slot/card-navigation path. The other two exposed sheet
scoping and stale-element assertions; scoped fixes compile, while a complete
passing archive remains for a user-approved unattended desktop window because
XCUITest takes foreground focus.
The committed app host and UI-test bundle are also compile-gated in a separate
macOS 15 GitHub Actions job with signing disabled; this is hosted toolchain
evidence only and does not replace the interactive accessibility run.
Supervisor-owned observer/active children now reconnect without fixed-rate
polling: transport failures wait 2/4/8/16/30 seconds, unexpected exits relaunch
the exact in-memory target after the deadline, and a validated refresh records
recovery. The compact repository footer shows retry/failure/recovery evidence;
the same counters and timestamps appear in copied diagnostics. Identity,
authorization, repository, mode, and supervised-queue mismatches still fail
closed and clear automatic restart intent.
The SwiftPM process-level fixture now exercises both transport loss on a live
PID and `SIGKILL` of the app-owned child. It verifies cached Git/queue evidence
during retry, same-session authorization and supervised mode after recovery,
a new PID after relaunch, and no mutation or queue-dispatch request. This is a
headless loopback test and does not launch Forge or control the desktop.
The final observer/active/queued/review capture set and repair notes live in
`docs/verification/mission-control-fairness/`.

### Menu Bar Agent

Purpose:

- show background agent status
- start quick tasks
- open active task
- show completion or failure

Example states:

- idle
- indexing
- running task
- waiting for approval
- tests failed
- review ready

### Global Shortcut

Purpose:

- open a command palette from anywhere
- submit a quick task
- ask about selected code
- review current diff

The shortcut should feel closer to Raycast or Spotlight than to a chat window.

### Notification Center

Purpose:

- notify task completion
- request review
- report failed tests
- show long-running command status

Notifications should be actionable:

- open diff
- view logs
- continue task
- dismiss

### Dock Progress

Purpose:

- make long-running work visible without opening the app
- show indexing, testing, or task progress

### Local Runtime Lifecycle

Purpose:

- start the local agent runtime without requiring a separate terminal session
- stop the app-managed runtime process when the user is done
- show whether the runtime is external, app-managed, starting, running,
  stopping, stopped, or failed
- include process state, PID, and runtime directory in diagnostics

Current implementation:

- a saved repository is restored only when `Reopen last workspace` is enabled;
  launch probes the endpoint and automatically starts the managed runtime when
  no external runtime is reachable
- the Offline workspace and General Settings expose start/reconnect and
  repository-switch controls; Settings can also stop an app-managed process
  and copy diagnostics
- the app can build a development checkout runtime or launch a prebuilt
  bundled runtime resource with `node dist/server.js`
- the app resolves the runtime installation directory separately from the
  repository root and passes the repo root through `FORGE_REPO_ROOT`
- stop only terminates the process that the app started, avoiding broad process
  killing
- the app distinguishes an externally reachable runtime from an app-managed
  runtime process and does not offer to stop external processes
- Settings and copied diagnostics include runtime launch candidates, launch
  command, bounded build/launch output, process state, PID, runtime directory,
  and repository root
- slow stop attempts are surfaced with a user-facing message

Remaining workspace hardening:

- add a real workspace/repository picker for installed apps that no longer sit
  next to a checkout
- keep installed-workspace selection separate from the signed application
  installation directory

### Finder Integration

Purpose:

- right-click a folder or file and send it to Forge
- explain folder
- review code
- generate tests
- start a task from a repository

### Live Agent Controls

Current implementation:

- the task action rail exposes state-specific Pause, Abort, and Resume buttons
- controls are owned by the shared workspace model rather than view-local
  network state
- pending cooperative stop requests remain visible until the current safe
  step finishes
- resume creates a new bounded loop linked to the prior paused, aborted, or
  failed checkpoint, preserving append-only history

### Coordinated Apply Evidence

Current implementation:

- the existing Review surface shows the latest proposal apply attempt without
  creating another window or view-local runtime state
- transaction phase, per-file verification, and automatic compensation make
  partial-write recovery visible alongside the proposal
- an incomplete recovery error remains visible for explicit human follow-up

### Quick Look

Purpose:

- preview diffs
- inspect generated summaries
- review files quickly

### Services

Purpose:

- send selected text or files from other apps to Forge
- ask the agent about selected code, logs, or docs

### Apple Shortcuts

Purpose:

- automate developer workflows
- start tasks from system automations
- integrate with personal workflows

### Pull Request Status Supervision

The Git settings page owns durable user preferences for an optional PR status
schedule while the shared `WorkspaceModel` owns the live timer and cycle state.
It is disabled by default. Native controls restrict the interval to 15, 30, or
60 minutes and the sequential cycle cap to 1, 3, or 5 oldest open/unmerged PRs.
The model loads the GitHub credential from Keychain per cycle, performs no HTTP
request when it is absent, prevents overlap with manual checks, stops a cycle
on auth failure, and cancels the timer when Forge exits or the runtime
disconnects. Settings shows Disabled/Waiting/Refreshing/Blocked plus the last
cycle summary; the completion surface shows per-task progress and the latest
credential-free audited attempt. This is foreground app supervision and does
not claim a persistent macOS background daemon or login-item entitlement.

## Permissions

Forge may need:

- file access to selected repositories
- permission to run local commands
- optional Accessibility permission for active app context
- notification permission
- login item or background item permission

Permissions must be explained clearly. The user should understand why each one
is needed.

## Distribution

Early strategy:

```text
Official website
DMG download
Drag to Applications
Launch
Automatic updates
```

Do not prioritize Mac App Store distribution early because Forge needs local
developer-tool capabilities that may conflict with sandbox restrictions.

Expected infrastructure:

- Developer ID signing
- notarization
- Sparkle updates
- crash reporting policy
- privacy policy

Current distribution-security foundation:

- `distribution/macos-signing-policy.json` versions the exact main app,
  Runtime, login-item, CLI, Widget, Keychain, local-artifact, and update-feed
  inventory
- `./script/build_and_run.sh --build-only` assembles without launching Forge or
  stopping a running app, removes SwiftPM's compiler ad-hoc signature, cleans
  stale Runtime output, and produces an entitlement-free unsigned bundle
- `script/stage_macos_distribution.sh` copies into a new signing stage without
  extended attributes; this avoids Finder/File Provider metadata invalidating
  code signing
- the artifact checker distinguishes unsigned, explicit ad-hoc, and Developer
  ID profiles, verifies exact entitlements and nested code, and keeps
  notarization/stapling/Gatekeeper separate from appcast signatures
- the current placeholder feed has no EdDSA signature, reports no notarization
  claim, and cannot invoke the download/install path
- hosted `macOS Distribution Posture` CI runs real unsigned/ad-hoc artifact
  checks and proves the same bundle is rejected by the release profile

The exact threat model, commands, and unresolved release prerequisites live in
`docs/macos_distribution_security.md`.

## Native Quality Bar

Forge should respect:

- keyboard navigation
- system appearance
- window behavior
- notifications
- menu conventions
- privacy prompts
- accessibility

Native does not mean decorative. Every native feature should make the agent
workflow faster, safer, or easier to understand.
