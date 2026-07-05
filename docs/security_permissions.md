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

Current v0 post-apply validation defaults to built-in `forge:` checks. It can
also run allowlisted project validation presets, such as runtime `npm run
check` and `npm run build`, after task-level approval. These commands are
logged and visible, run without a shell, use repo-local cwd values, and are not
accepted from arbitrary user input. Workspace validation config can compose
runtime-known command IDs, but it cannot provide raw command strings.
The Review panel now presents these commands as task-specific permission
requests with approval state, blocked reasons, command boundary, and last-run
metadata before the user approves or runs them.

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
- validation command results
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

Remote model provider rule:

- `FORGE_MODEL_PROVIDER=local` remains the default.
- `FORGE_MODEL_PROVIDER=openai` is explicit consent to send compact task
  context to OpenAI or the configured compatible base URL.
- The OpenAI provider slice sends task state, recent task messages, file
  reference summaries, context file summaries, plan steps, changed-file names,
  and proposal metadata. It should not upload whole repositories.
- Runtime health may report whether a secret is configured, but it must not
  return secret values.
- Runtime model-provider settings persist only non-secret values in
  `.forge/model-provider-settings.json`.
- The macOS app stores OpenAI API keys in macOS Keychain and syncs them into
  runtime memory through `POST /settings/model-provider`; the runtime does not
  persist API keys to disk.
- Clearing the OpenAI key from Settings deletes the Keychain item and asks the
  runtime to clear its in-memory copy.
- Remote model output is guidance only. The runtime must continue to validate
  proposals and require approval before file, command, git, or external side
  effects.

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
