# Runtime Server Refactor Plan

Document role: define the behavior-preserving decomposition of
`runtime/src/server.ts`, including target boundaries, sequencing, safety
constraints, verification gates, and completion criteria.

## Why This Refactor Exists

Before this refactor, `runtime/src/server.ts` was 12,496 lines. It contained 73.9% of all
TypeScript source lines under `runtime/src`, about 376 top-level functions, 55
HTTP method/path branches, and a 437-line request handler.

The problem is not line count by itself. One module currently owns all of
these concerns:

- process startup, environment parsing, shutdown, and watchdog timers
- HTTP routing, JSON parsing, CORS, error mapping, and SSE clients
- mutable runtime state and SQLite task persistence
- task creation, conversation, planning, and provider context
- queue scheduling and Agent Loop control/recovery
- edit proposal generation, validation, apply, rollback, and recovery
- validation presets, command execution, cancellation, and repair evidence
- repository indexing, search, context selection, and logged read tools
- Git status, diff, conflict resolution, branch, commit, push, and PR actions
- model-provider settings persistence and runtime replacement

This makes review risky because a small change can cross unrelated trust
boundaries. It also prevents focused unit testing: most behavior is currently
verified through end-to-end smoke fixtures that must start `dist/server.js`.

## Non-Goals

This refactor must not:

- change HTTP routes, request/response payloads, or status codes
- change SQLite schema or persisted task shapes
- weaken observer-mode read-only enforcement
- change risk classifications or approval requirements
- add a framework, dependency-injection library, or alternative web server
- redesign Agent Loop behavior, edit operations, or Git workflows
- combine feature work with module moves
- split code into arbitrary small files without a stable domain boundary

## Invariants That Must Stay True

Every phase must preserve these runtime guarantees:

1. The server listens only on the configured loopback port.
2. Observer mode rejects every non-GET request before domain execution.
3. Model output remains guidance; the runtime owns validation and side
   effects.
4. File apply and rollback retain path checks, write-ahead evidence, hash
   verification, and compensation behavior.
5. Commands continue to use runtime-owned IDs, `spawn`, `shell: false`,
   bounded output, cancellation ownership, and approval checks.
6. Git mutations retain preview/confirmation/expected-state gates and never
   introduce force operations.
7. Tokens and API keys are never persisted or included in URLs or logs.
8. Task events, approvals, tool calls, command output, and recovery evidence
   remain durable and auditable.
9. `dist/server.js` remains the packaged executable entrypoint throughout the
   migration.

## Target Architecture

The end state is one composition root and a small set of cohesive runtime
services. Names may adjust during extraction, but dependency direction must
remain stable.

```text
server.ts (bootstrap only)
  -> runtime/createRuntime.ts
      -> http/createRequestHandler.ts
          -> route groups
              -> application services
                  -> task state / event bus / policy services
                      -> filesystem / git / process / SQLite adapters
```

Proposed module groups:

```text
runtime/src/
  server.ts
  runtime/
    config.ts
    createRuntime.ts
    runtimeContext.ts
    lifecycle.ts
  http/
    createRequestHandler.ts
    httpError.ts
    response.ts
    routes/
      systemRoutes.ts
      taskRoutes.ts
      queueRoutes.ts
      gitRoutes.ts
      validationRoutes.ts
      settingsRoutes.ts
  events/
    runtimeEventBus.ts
  tasks/
    taskState.ts
    taskService.ts
    conversationService.ts
    planService.ts
  agent/
    agentLoopService.ts
    agentStepService.ts
    agentRecoveryService.ts
    queueService.ts
  edits/
    editProposalService.ts
    editProposalValidation.ts
    editTransactionService.ts
    unifiedDiff.ts
    workspacePathPolicy.ts
  validation/
    validationCatalog.ts
    validationPermissions.ts
    validationService.ts
    taskCommandService.ts
    processRunner.ts
  git/
    gitCommand.ts
    gitStatusService.ts
    gitConflictService.ts
    gitBranchService.ts
    gitCommitService.ts
    gitPushService.ts
    gitPullRequestService.ts
    gitPreflight.ts
  repository/
    repositoryContextService.ts
    repositoryPathPolicy.ts
    repositoryToolService.ts
```

Existing focused modules such as `taskStore.ts`, `modelProvider.ts`,
`repositoryIndex.ts`, `symbolSearch.ts`, `textSearch.ts`,
`inspectionGuard.ts`, and `stuckDetection.ts` remain in place unless a later
move materially improves dependency direction.

## Core Dependency Contracts

Before moving orchestration code, introduce explicit runtime-owned contracts:

- `RuntimeContext`: immutable config plus the service instances used by one
  runtime process. No module should read environment variables after context
  creation.
- `TaskState`: owns the task map and SQLite persistence operations. Domain
  services must not manipulate both independently.
- `RuntimeEventBus`: owns SSE subscribers and structured event publication.
- `Clock` and `IDSource`: injectable only where deterministic recovery and
  transaction tests benefit; production defaults remain `Date` and UUID.
- `ProcessRunner`: owns no-shell child execution, timeout, cancellation, and
  bounded output behavior.
- `GitCommand`: owns safe Git process invocation and bounded output. Higher
  services own policy and approval decisions.
- workspace path policies: separate read-only repository paths, editable
  workspace paths, rollback snapshot paths, and Git-visible paths. These must
  not collapse into one permissive helper.

Avoid a generic service locator. Route handlers should receive a typed object
containing only the services needed by that route group.

## Phased Migration

## Progress

| Phase | State | Evidence |
| --- | --- | --- |
| 0. Freeze observable behavior | Complete | The frozen refactor baseline had 55 routes; the current manifest has 57 after task cancellation/audit export, with HTTP/SSE, build, unit, coverage, and 18 smoke scripts passing |
| 1. Bootstrap and HTTP primitives | Complete | Runtime config, HTTP handler/primitives, event bus, and lifecycle extracted; full gate passes |
| 2. Pure policy and parsing | Complete | Unified diff, text patch, edit paths, Git parsers/failure classes, validation normalization/ranking extracted and directly tested |
| 3. Git vertical slice | Complete | No-shell command adapter plus status, diff, conflict, branch, commit, push, and PR workflow services extracted; Git smokes pass |
| 4. Edit transactions and policies | Complete | Proposal, validation, apply/rollback transaction, recovery, text operation, diff, and workspace path services extracted; recovery smokes pass |
| 5. Validation and commands | Complete | Preset catalog/permissions and command/validation orchestration extracted; cancellation, repair, output, and stuck-work smokes pass |
| 6. Task, queue, and agent orchestration | Complete | Task/conversation/plan, TaskState, queue, Agent Loop/Step/control, and recovery services extracted; queue/provider/stuck smokes pass |
| 7. Repository context and routes | Complete | Repository index/search/context service and typed HTTP route adapter extracted; `server.ts` is a 1-line packaged bootstrap; all final gates pass |

## Final Implementation Snapshot

The packaged executable remains `dist/server.js`. Its source entrypoint now
imports `runtime/createForgeRuntime.ts`, which creates the config, TaskState,
event bus, adapters, domain services, typed route adapter, and lifecycle.
Repository context, Git, edits, validation, task/agent orchestration, provider
settings, HTTP primitives, and lifecycle behavior are owned by focused module
groups. Domain services import the runtime error contract rather than the HTTP
layer, and no module imports `server.ts`.

Final verification on 2026-08-01:

- `runtime/src/server.ts`: 1 line (target: below 300)
- executable manifest: 57 current routes, including observer availability
- direct Node unit suite: 17 scripts, all passing
- TypeScript check, build, and Node coverage gate: passing
- compatibility suite: 18 smoke scripts, all passing

### Phase 0: Freeze Observable Behavior

Goal: make structural changes safe before moving production logic.

Work:

- record a route manifest covering method, path pattern, expected status, and
  observer-mode availability for all current endpoints
- add request-handler contract tests for CORS, JSON parse failures, error
  envelopes, 404 behavior, health, and observer non-GET rejection
- add an SSE lifecycle test for connect, event delivery, and disconnect
- record the current smoke suite as the compatibility gate
- add a script that fails if a route disappears from the manifest without an
  intentional contract update

Exit gate:

- existing 16 `smoke:*` scripts pass
- `npm run test:unit`, `npm run check`, and `npm run build` pass
- route manifest accounts for every current branch in the request handler

### Phase 1: Extract Bootstrap And HTTP Primitives

Goal: remove transport boilerplate without moving domain behavior.

Work:

- move environment/config resolution into `runtime/config.ts`
- move `HttpError`, JSON body parsing, CORS, JSON/HTML responses, and path
  parameter parsing into `http/`
- create `createRequestHandler(context, services)` while temporarily calling
  service functions that still live in `server.ts`
- move signal handling, startup recovery calls, watchdog setup, listen, and
  shutdown into `runtime/lifecycle.ts`

Exit gate:

- `server.ts` is a composition entrypoint rather than the owner of HTTP
  mechanics
- no route or response contract changes
- startup and shutdown smoke behavior remains identical

### Phase 2: Extract Pure Policy And Parsing Code

Goal: move the lowest-coupling, highest-test-value logic first.

Work:

- extract unified-diff parsing and validation
- extract edit path policy and proposal validation helpers
- extract Git status/diff parsers, preflight reducers, failure
  classification, branch-name normalization, and PR body/title builders
- extract validation catalog normalization and permission ranking
- add direct unit tests before deleting each original implementation

Exit gate:

- extracted pure modules have focused tests for success, boundary, and
  fail-closed cases
- no extracted module imports HTTP, process startup, the task map, or
  `server.ts`
- every moved function is removed from the monolith in the same change

### Phase 3: Extract Git As A Vertical Slice

Goal: isolate the largest independent high-risk domain behind typed services.

Work:

- create one safe Git command adapter
- move read-only status/diff/conflict inspection services
- move conflict, branch, commit, push, and PR mutation services separately
- inject task state only into operations that record task evidence
- keep token parameters request-scoped and prevent them from entering service
  state
- make route handlers thin request-to-service adapters

Exit gate:

- no Git command execution remains in `server.ts`
- preview and mutation services remain separate
- all Git conflict, remote, PR publish, and core smoke fixtures pass
- high-risk confirmation and expected-state tests remain explicit

### Phase 4: Extract Edit Transactions And Workspace Policies

Goal: isolate the most safety-sensitive filesystem behavior.

Work:

- move proposal generation orchestration separately from validation
- move apply/rollback transaction logic with its journal and recovery helpers
- keep read-only, editable, Git, and rollback path policies distinct
- inject filesystem operations where failure compensation needs deterministic
  tests
- add direct transaction tests for partial apply, partial rollback, stale
  hashes, symlinks, escaping paths, and interrupted recovery

Exit gate:

- no direct edit filesystem mutation remains in `server.ts`
- startup recovery uses the same transaction service as normal operations
- core smoke and recovery fixtures pass without snapshot or payload changes

### Phase 5: Extract Validation And Task Commands

Goal: give command execution one enforceable boundary.

Work:

- move built-in command/preset catalogs and workspace preset parsing
- move permission derivation into a pure service
- move validation orchestration and task-command orchestration into separate
  services sharing one `ProcessRunner`
- keep cancellation keyed to runtime-owned command-run IDs
- keep output chunking, timeouts, repair briefs, and rerun evidence in their
  owning services

Exit gate:

- all child processes are created through `ProcessRunner`
- raw shell strings are still impossible through HTTP or workspace config
- task-command, cancellation, validation, and stuck-recovery flows pass

### Phase 6: Extract Task, Queue, And Agent Orchestration

Goal: separate durable task state from state-machine behavior.

Work:

- move task creation, messages, intent briefs, file references, and plan
  revisions into task application services
- move queue ordering/dispatch into `queueService.ts`
- move Agent Step, Agent Loop, pause/abort/resume, and startup/stuck recovery
  into the agent group
- require all task changes to persist and publish through `TaskState`
- keep provider calls behind the existing `ModelProvider` boundary

Exit gate:

- Agent services do not know about HTTP request/response objects
- queue dispatch is testable with an injected clock and bounded fake runner
- core, queue, observer, provider-recovery, inspection, and stuck-work smokes
  pass

### Phase 7: Extract Repository Context And Finish Route Groups

Goal: leave `server.ts` as a small composition root.

Work:

- move repository file listing, search, context selection, file summaries,
  and logged read tools into repository services
- compose existing index/symbol/text modules through that service
- group routes by domain and inject only their required services
- remove temporary compatibility exports and remaining singleton reads
- document the final dependency graph

Exit gate:

- `server.ts` contains only config/context creation, server startup, and fatal
  startup reporting
- target size for `server.ts` is below 300 lines
- no domain module imports from `server.ts` or `http/`
- the full build, unit, coverage, and 16-script smoke suite pass

## Change Size And Review Rules

- Keep each change behavior-preserving and focused on one boundary.
- Prefer 300-800 moved lines per review; a mechanically moved cohesive service
  may be larger when its diff is clearly relocation-only.
- Do not rename public payload fields while moving code.
- Do not reformat unrelated code in extraction changes.
- Add tests before or in the same change as an extraction, never later.
- Delete the old implementation immediately after the new path is wired; do
  not maintain two active implementations.
- Run the smallest focused tests during development and the full compatibility
  gate before completing each phase.
- If a move exposes unclear ownership, stop and introduce a narrow interface;
  do not solve coupling with a global `services` bag.

## Verification Matrix

| Boundary | Focused verification | Required smoke coverage |
| --- | --- | --- |
| HTTP/bootstrap | route manifest, errors, CORS, SSE, observer guard | core, observer |
| Git | parsers, preflight, approval/expected-state checks | git-conflicts, git-remote, github-remote, pr-publish |
| Edits | path policy, diff parser, transaction compensation | core |
| Validation/commands | catalog, permission states, timeout/cancel/output | core, stuck-recovery |
| Agent/queue | state transitions, stop reasons, recovery, ordering | core, queue, provider-recovery, inspection-guard, stuck-recovery |
| Repository context | budgets, ignored paths, search/index merge | core, repo-index, symbol-search, text-search |

Every phase must also pass:

```bash
cd runtime
npm run check
npm run build
npm run test:unit
npm run coverage:unit
```

Before a phase is declared complete, run every `smoke:*` script from
`runtime/package.json`.

## Completion Criteria

The refactor is complete when:

- `server.ts` is below 300 lines and contains no domain policy
- HTTP route groups contain transport adaptation only
- runtime state is created once and passed explicitly
- task persistence and event publication have single owners
- all process and Git execution goes through narrow adapters
- pure policy/parsing modules have direct unit tests
- high-risk boundaries remain visible in code and tests
- the full public HTTP/SSE and persisted-task behavior is unchanged
- all unit, coverage, build, type-check, and smoke gates pass

The intended outcome is not merely smaller files. A reviewer should be able to
change one runtime domain, identify its trust boundary, run its focused tests,
and know which integration fixtures prove that unrelated behavior did not
move.

The final implemented graph and runtime sequences are documented in
`docs/runtime_server_architecture.md`.

## Readability Follow-Up Completed

The second readability pass completed the remaining coarse service splits
without changing the public runtime contract:

- `gitWorkflowService.ts` is a 17-line facade over branch, branch-publish,
  commit, push, and pull-request services.
- `agentOrchestrationService.ts` is a 52-line facade over queue, loop, step,
  repository-inspection, and recovery services with one explicit shared
  runtime-state object.
- edit transaction dispatch now delegates create, delete, text-modify, and
  patch/unified-diff operations to dedicated handlers.
- `validationService.ts` is a 21-line facade over `ProcessRunner`, task
  commands, validation runs, and repair evidence.
- `runtimeRoutes.ts` is a 107-line route composer over system, task, agent,
  edit, validation, Git, and settings groups. The executable route-manifest
  test scans those groups and currently proves all 57 routes.
- runtime composition now separates core and validation assembly from domain
  defaults; `createForgeRuntime.ts` fell from 932 to 476 lines while the
  packaged `server.ts` remains one line.

The final compatibility gate passed TypeScript check/build, 17 unit scripts,
unit coverage, all 18 runtime smoke scripts, and 26 Swift tests. The current
unit coverage aggregate is 56.94% lines, 88.42% branches, and 67.29%
functions.
