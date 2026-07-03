# User Personas

Document role: record who Forge is for, what pains they have, what they need
to trust, and how product decisions should serve them.

## Primary Persona: Senior Builder

The senior builder is an experienced developer who already uses AI coding
tools but feels the workflow is scattered.

### Jobs

- ship features faster
- fix bugs without losing architectural control
- review generated changes carefully
- keep local repositories private
- move between terminal, git, tests, and IDEs smoothly

### Pains

- AI chat loses context
- terminal agents are powerful but hard to observe
- editor agents are tied to one IDE
- reviewing AI changes can be tedious
- context must be re-explained repeatedly

### What They Need

- clear task progress
- inspectable plans
- readable diffs
- command logs
- approval gates
- fast repo context
- local memory

### Success Criteria

The senior builder should feel that Forge acts like a capable junior-to-mid
engineer whose work is transparent and easy to review.

## Primary Persona: Founder-Engineer

The founder-engineer is building a product with limited time and wants AI to
multiply execution without creating chaos.

### Jobs

- turn product ideas into implementation tasks
- create features end-to-end
- keep technical direction consistent
- avoid losing project memory between sessions
- prepare demos and releases

### Pains

- product decisions live in chat history
- AI tools do not remember why decisions were made
- implementation can drift from product strategy
- too much time is spent coordinating tools

### What They Need

- durable project memory
- task history
- product docs linked to implementation
- roadmap clarity
- simple approval and release flow

### Success Criteria

The founder-engineer should feel that Forge preserves strategic memory while
helping execute concrete work.

## Secondary Persona: Team Tech Lead

The team tech lead cares about quality, coordination, and safety.

### Jobs

- review AI-generated changes
- ensure architecture consistency
- enforce team rules
- keep tasks traceable
- understand what agents did

### Pains

- autonomous changes are hard to audit
- generated code may violate local conventions
- command execution can be risky
- reviews lack rationale

### What They Need

- policy rules
- approval logs
- run history
- architectural notes
- repeatable workflows
- code review summaries

### Success Criteria

The tech lead should trust Forge because every important action is traceable.

## Enterprise Buyer Persona

The enterprise buyer cares about privacy, governance, and integration.

### Jobs

- enable AI coding safely
- protect source code
- manage vendor risk
- enforce approval workflows
- integrate with existing developer systems

### Pains

- cloud-only tools create data concerns
- IDE-specific tools fragment governance
- agent actions can be difficult to audit
- teams use inconsistent prompts and tools

### What They Need

- local-first architecture
- clear permission model
- audit logs
- policy controls
- enterprise deployment story
- provider flexibility

### Success Criteria

The enterprise buyer should see Forge as a controlled agent workspace rather
than an uncontrolled AI coding toy.

## User Promise

Forge should help users feel faster without feeling out of control.
