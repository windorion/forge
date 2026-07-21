# 25a · Onboarding — 2026-07-21

Evidence: `onboarding-step1.png` (4-step wizard, step 1 active).

Built from Missing: OnboardingView is a clickable 4-step first-run wizard
(exclusive surface, auto-presented on genuine first launch via
forge.hasCompletedOnboarding), orchestrating existing capability:
- STEP 1 CONNECT GITHUB — "Your code stays yours." with the three scope
  rows; the button opens the real 15a device-flow sign-in.
- STEP 2 PICK A REPO — lists real registered repositories (or opens the
  native picker when none), with the "invisible to the agent" copy.
- STEP 3 SET THE LEASH — guardrails preview reading real settings (plan
  approval ALWAYS, branch-only LOCKED, real monthly budget cap, self-fix
  attempts).
- STEP 4 FIRST TASK — the three suggested tasks + own-text field; ▸ PLAN
  runs the real 1a createTask flow.
skip setup and completion both persist forge.hasCompletedOnboarding.

All four steps captured (onboarding-step1..4.png) via the onboardingStep
debug driver: step 1 GitHub scopes, step 2 repo pick from real registered
repos, step 3 guardrails preview with real values (ALWAYS/LOCKED/$40/2),
step 4 first-task suggestions + composer. Verified.
