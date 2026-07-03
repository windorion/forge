# Security And Permissions

Document role: record Forge's trust model, approval gates, command risk
levels, and audit requirements.

## Security Principle

Forge should make agent power safe by making actions explicit, reviewable, and
auditable.

## Trust Model

The user owns:

- repository access
- command approval
- file change approval
- git commit and push approval
- external publishing approval

The agent can propose and execute within policy, but it should not silently
cross trust boundaries.

## Action Risk Levels

### Low Risk

Examples:

- read allowed files
- search repository
- inspect git status
- read project docs

Can run automatically after workspace access is granted.

### Medium Risk

Examples:

- edit files in workspace
- run test commands
- install project dependencies
- generate local indexes

May run automatically based on settings, but should be logged and visible.

### High Risk

Examples:

- delete files
- run destructive shell commands
- change permissions
- commit
- push
- deploy
- upload private code
- modify external services

Requires explicit approval.

## Approval Dialogs

Approval requests should show:

- action
- reason
- target
- risk
- exact command or file list when applicable
- consequence of approving

Avoid vague prompts like "continue?"

## Audit Log

Forge should record:

- who approved
- when approval happened
- what was approved
- command output
- file changes
- git operations
- external tool calls

## Sensitive Data

Forge must avoid exposing:

- API keys
- credentials
- tokens
- private customer data
- local secrets
- SSH keys
- environment files

The context builder should respect ignore rules and future secret detection.

## Emergency Controls

The user should be able to:

- stop a running task
- revoke workspace access
- disable tools
- purge memory
- clear command logs
- remove integrations

## Product Promise

Forge should feel powerful, but never sneaky.
