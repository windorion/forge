# 15a · Sign In — 2026-07-19 · SHA 9e51b45

Evidence: `20260719T182824Z_9e51b45_window3.png` (welcome state).

Built from Missing: SignInView with both handoff states — the welcome
card (logo, WELCOME TO FORGE, "Ship while you sleep.", Windorion subtext,
⌥ CONTINUE WITH GITHUB accent action, CONTINUE WITH EMAIL, first-sign-in
note, underlined terms · privacy, "code stays on your machine / keys live
in Keychain" footer) and the CONNECT GITHUB device-flow state (STEP 1
code display + COPY CODE, STEP 2 auto-detect with live expiry countdown,
BACK, three-scopes footnote). GitHubAuth implements the real OAuth device
flow (device-code request → poll → token in Keychain via the new generic
KeychainStore.save → login fetch); the panel opens from 6a CONNECT GITHUB
and the signIn/signInFlow debug specs.

Updated 2026-08-02: GitHub remains the real authorization path. Missing Client
ID now opens an actionable configuration screen in the panel, with GitHub
settings, local Client ID persistence, and Save & Request Code. The Device Flow
adds Open GitHub, standards-compliant interval/`slow_down` polling, expiry and
denial handling, `/user` validation before Keychain persistence, a connected
receipt, Continue to Forge, and disconnect. Three focused unit tests cover the
flow. Live code/connected-state capture remains founder-dependent because it
requires a Forge-owned OAuth App Client ID with Device Flow enabled.

Email is no longer an inert or falsely promising action. It opens a status
screen that explains the absent hosted account/email/sync service and provides
Continue Locally. A real Email login remains a product/backend decision, not a
desktop-only implementation. Status remains Verified with notes; live GitHub
grant capture is pending the Client ID.
