# Product Vision

Document role: record why Forge exists, the category it creates, and the
principles that should guide every later product and engineering decision.

## One-Sentence Vision

Forge is a macOS-native, agent-first, local-first software engineering
workspace where AI agents complete development tasks and humans review,
approve, and decide what ships.

## Mission

Forge should make software engineering feel less fragmented.

Today, a developer moves between an IDE, terminal, ChatGPT, GitHub, CI,
project management, logs, documentation, and Slack. AI assistants usually live
inside one of those surfaces. Forge turns the task itself into the center of
the workflow.

## Category

Forge creates the category:

> Software Engineering Workspace

It is not an AI IDE. It is not an editor with chat. It is not a terminal-only
agent. It is a coordinated workspace where the task, agents, repository,
terminal, diff, git state, memory, and review all live together.

## Core Belief

The next generation of coding tools will not be organized around files. It
will be organized around intent, execution, and review.

The developer should act more like a tech lead:

- describe the task
- set constraints
- approve plans
- review diffs
- decide what ships

The AI should act more like an implementation team:

- inspect the repository
- build context
- plan work
- edit code
- run commands
- fix failures
- explain tradeoffs
- prepare reviewable output

## Product Principles

### Task First

Every meaningful unit of work starts as a task. A task has a lifecycle,
history, context, plan, execution trace, changed files, commands, approvals,
and result.

### Agent First

The agent runtime is the center of the product. UI exists to make agent work
observable, controllable, and reviewable.

### Workspace First

Forge should combine chat, terminal, diff, git, tasks, memory, logs, and agent
state into one coherent workspace.

### Human Review

Agent autonomy is useful only when paired with trust. Important changes must
remain reviewable and auditable.

### Local First

Private code and development memory should stay local whenever possible. Cloud
LLMs can be used, but repository state, task history, indexes, and approvals
should be local by default.

### macOS Native

Forge should feel like a Mac application. It should use system capabilities
that web wrappers and IDE plugins cannot fully own: menu bar, global
shortcuts, notifications, Finder, Services, Quick Look, Dock state, and native
permissions.

## What Must Not Change

- Forge must not become a VS Code clone.
- Forge must not become a chat-first app.
- Forge must not hide agent work from the user.
- Forge must not silently apply risky changes.
- Forge must not treat the editor as the product center.

## Long-Term Vision

Forge should become the operating system for software engineering on macOS:

- one place to define engineering intent
- one place to observe agent execution
- one place to review changes
- one place to connect local tools, repos, terminals, IDEs, and MCP servers
- one memory layer for the project and the developer's engineering workflow

In the long run, Forge can support teams, enterprise policy, shared agent
recipes, secure local indexing, and repeatable engineering workflows. The
first product must prove the local single-developer workflow before expanding.
