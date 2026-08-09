# Mission Control XCUITest Evidence

Status: **Partial — real suite implemented and compile-verified; authenticated
action-level execution still required.**

## Coverage

`Tests/ForgeAppUITests/MissionControlUITests.swift` contains three real
`XCUIApplication` methods covering:

1. observer authorization and active-runtime revocation confirmations,
2. background slot 1 → 2 and review-card navigation,
3. validation-preset approval, active-command cancellation, and Git branch/
   commit confirmation cancellation with blocked remote actions absent.

The tests launch the existing SwiftUI application source through the generated
`ForgeApp.xcodeproj`; the product does not contain a fake test-only UI.
Deterministic DEBUG fixtures intercept only the side effects after the same
buttons and alerts used by the real surface are reached.

## 2026-08-09 Results

- `xcodebuild ... build-for-testing CODE_SIGNING_ALLOWED=NO`: passed.
- `xcodebuild ... test`: built and signed the app/Runner, reached
  `ForgeAppUITests-Runner`, then failed before test methods ran because macOS
  Local Authentication returned code -2, “Authentication cancelled.”
- No XCUITest method is claimed as passed from that run.

Run `script/test_mission_control_ui.sh` in an interactive Mac session, approve
the first-use local authentication prompt, and archive the resulting
`build/mission-control-xcui/<timestamp>/ForgeAppUI.xcresult` and log. Use
`FORGE_XCUI_BUILD_ONLY=1 script/test_mission_control_ui.sh` for the non-launching
compile gate.
