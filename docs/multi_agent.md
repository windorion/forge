# Multi-Agent Architecture

Document role: record the roles, responsibilities, handoffs, and orchestration
model for Forge agents.

## Principle

Multi-agent does not mean many uncontrolled bots. It means specialized roles
with clear responsibilities, state, and handoffs.

## Minimum Agent Roles

### Manager

Responsibilities:

- own the task lifecycle
- coordinate other agents
- decide when to ask the user
- preserve constraints
- summarize progress

The Manager should not make code edits directly unless the implementation is
single-agent under the hood.

### Planner

Responsibilities:

- understand the task
- inspect repository structure
- identify relevant files
- propose implementation steps
- define validation steps

Output:

- plan
- likely files
- risks
- questions
- acceptance criteria

### Coder

Responsibilities:

- make code changes
- perform refactors
- update tests when appropriate
- explain implementation choices

The Coder should operate inside the approved plan unless it discovers a reason
to revise the plan.

### Tester

Responsibilities:

- choose validation commands
- run tests
- interpret failures
- propose fixes
- confirm pass/fail status

### Reviewer

Responsibilities:

- inspect final diff
- look for bugs, regressions, security issues, and maintainability problems
- summarize risk
- prepare human review notes

## Future Agents

- Documentation Agent
- Security Agent
- Database Agent
- DevOps Agent
- Release Agent

Future agents should be added only when they reduce complexity or improve
quality. Do not add roles just for theater.

## Task State Machine

```text
Created
Planning
Plan Review
Running
Testing
Agent Review
Human Review
Completed
```

Failure states:

```text
Blocked
Failed Validation
Needs Clarification
Cancelled
```

## Handoff Contract

Each agent handoff should include:

- task id
- objective
- constraints
- current plan
- relevant files
- prior tool calls
- current diff
- validation results
- open questions

## Implementation Strategy

MVP can be implemented as one runtime loop with role-specific prompts and a
shared task state.

The product model should still expose agents as distinct roles because the
user experience depends on understanding who is doing what.

## Anti-Patterns

- agents arguing without producing output
- hidden role switches
- fake multi-agent UI with no state model
- letting specialized agents ignore task constraints
- making users read raw internal reasoning instead of concise status summaries
