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

Per the approved plan: GitHub is the one truly wired action — pressing it
without a registered Client ID shows the honest "OAuth App is not
registered yet" notice (forge.githubClientID activates the live flow the
moment the founder registers one); CONTINUE WITH EMAIL is visibly present
but inert, explaining hosted accounts are not in the local-first build.
The device-flow state renders real codes only once the Client ID exists —
its live capture is the founder-dependent remainder. Verified (with
notes; device-state live capture pending Client ID).
