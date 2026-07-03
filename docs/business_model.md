# Business Model

Document role: record packaging, pricing hypotheses, distribution, customer
segments, and commercial strategy.

## Commercial Thesis

Forge sells trust, workflow, and leverage. The product is valuable because it
turns AI coding from scattered prompts into a controlled engineering workspace.

## Distribution

Early distribution:

```text
Website
DMG download
Drag to Applications
Automatic updates
```

Avoid Mac App Store early because the product needs local developer-tool
capabilities such as shell execution, git access, Docker support, local
indexing, and optional Accessibility APIs.

## Customer Segments

### Indie Developers

Need speed, affordability, and local privacy.

### Founder-Engineers

Need project memory, product-to-code execution, and rapid shipping.

### Professional Developers

Need trustworthy task execution, reviewable diffs, and IDE-agnostic workflow.

### Teams

Need repeatable workflows, shared rules, and audit logs.

### Enterprises

Need governance, provider control, privacy, and policy enforcement.

## Pricing Hypotheses

Potential tiers:

### Free

- local workspace
- limited tasks
- bring-your-own-key
- basic history

### Pro

- unlimited local tasks
- advanced memory
- multi-agent workflows
- integrations
- richer macOS features

### Team

- shared rules
- team templates
- review policies
- GitHub integrations
- task handoff

### Enterprise

- policy controls
- provider controls
- audit exports
- SSO
- deployment controls
- support

## Revenue Model

Possible models:

- subscription
- bring-your-own-key plus product subscription
- bundled model credits later
- team seats
- enterprise contracts

Early product should likely support bring-your-own-key to reduce model cost
complexity.

## Open Source Strategy

Forge can be public and eventually open source, but the business model should
be designed deliberately.

Recommended direction:

- Make the local single-player core visible and trustworthy.
- Keep the app useful with bring-your-own-key.
- Charge for convenience, collaboration, governance, and hosted services.
- Do not depend on "people paying out of goodwill."

Potential free or open core:

- local app shell
- local runtime basics
- repository scanning
- task history
- bring-your-own-key agent loop
- basic diff review

Potential paid product:

- hosted sync across devices
- managed model credits
- team workspaces
- shared rules and prompts
- GitHub PR automation
- advanced memory
- enterprise policy controls
- audit exports
- SSO and admin controls
- priority updates and support

Important licensing note:

Public repository does not automatically mean open source. A real open-source
strategy needs an explicit license. License choice is still open. Reasonable
future options include Apache 2.0, AGPL, or a source-available/open-core model,
depending on how much commercial protection Forge needs.

My current recommendation:

Start public, build community trust, delay the final open-source license
decision until the first working vertical slice exists.

## Go-To-Market Wedge

Start with macOS developers who already use AI coding tools but want a better
workflow than terminal-only or editor-only agents.

Strong initial message:

> A native Mac workspace for reviewing and controlling AI coding agents.

## Commercial Risks

- competing directly with Cursor as an IDE
- underestimating model cost
- failing to build trust
- making setup too complicated
- not proving a sharp first workflow

## First Proof Point

The first product should prove that a developer can give Forge a real local
task, watch the agent work, review the diff, run tests, and approve a safe
commit faster than with scattered tools.
