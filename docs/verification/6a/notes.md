# 6a · Settings — GitHub

- Date: 2026-07-19 · SHA f06966b
- Evidence: `20260719T062024Z_f06966b_Forge-Settings.png`

Visual structure matches: disconnected header + CONNECT GITHUB, three Forge
action-boundary cards (repo:read / branch:write / pr:open with the handoff
descriptions), the explanatory scope bar, REPO ACCESS list from real local git
state with LOCAL TRUST toggle and "0 of 1 enabled", footnote.

Updated 2026-08-02: CONNECT GITHUB is no longer hard-disabled. Settings now
contains Client ID configuration, opens GitHub OAuth settings, launches the
shared sign-in panel, reflects OAuth/Keychain state, and can disconnect. Copy
now correctly distinguishes GitHub's requested `repo` OAuth scope from Forge's
three enforced action categories. Device Flow and its error handling are unit
tested. Status stays Partial only until a founder-owned OAuth Client ID with
Device Flow enabled permits the live grant and connected-state capture.
