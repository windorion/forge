# MCP Integration

Document role: record how Forge should use MCP servers and plugins as external
capabilities while preserving local control and user trust.

## MCP Principle

MCP extends what agents can do. It should not bypass Forge's permission model.

## Use Cases

MCP can connect Forge agents to:

- GitHub
- issue trackers
- documentation sources
- databases
- browsers
- design tools
- deployment providers
- internal company tools

## Tool Discovery

Forge should discover available MCP tools and present them as capabilities with
clear names, descriptions, and permission needs.

Tool metadata should include:

- server name
- tool name
- description
- input schema
- output type
- risk level
- requires network
- can modify external state

## Permission Model

MCP calls should follow the same trust rules as local tools.

Require approval for:

- posting comments
- creating issues
- opening PRs
- changing remote data
- deploying
- sending private content to third-party services

## Runtime Integration

MCP tools should be wrapped by Forge's Tool Registry so that:

- calls are logged
- permissions are enforced
- outputs are attached to task history
- failures are visible
- risky actions are reviewed

## Product UI

Forge should expose MCP integrations in settings:

- connected servers
- available tools
- trust level
- permissions
- recent calls
- disable or remove

## Anti-Patterns

- letting MCP tools run outside task history
- hiding third-party data transfer
- treating all tools as equally safe
- giving agents unbounded external write access
