import XCTest

@MainActor
final class MissionControlUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testObserverAuthorizationAndActiveRevocationRequireExplicitConfirmation() throws {
        var app = launch(surface: "missionControlFixture:observer")
        let authorize = element("mission-control-authorize-fixtures-alpha", in: app)
        XCTAssertTrue(authorize.waitForExistence(timeout: 5))
        authorize.click()

        let authorizeAlert = app.alerts["Authorize active runtime?"]
        XCTAssertTrue(authorizeAlert.waitForExistence(timeout: 3))
        assertAlert(authorizeAlert, contains: "/tmp/forge-ui-alpha")
        authorizeAlert.buttons["Cancel"].click()
        XCTAssertTrue(authorize.exists)

        app.terminate()
        app = launch(surface: "missionControlFixture:active")
        let revoke = element("mission-control-revoke-fixtures-alpha", in: app)
        XCTAssertTrue(revoke.waitForExistence(timeout: 5))
        revoke.click()

        let revokeAlert = app.alerts["Return repository to read-only?"]
        XCTAssertTrue(revokeAlert.waitForExistence(timeout: 3))
        assertAlert(revokeAlert, contains: "/tmp/forge-ui-alpha")
        revokeAlert.buttons["Cancel"].click()
        XCTAssertTrue(revoke.exists)
    }

    func testBackgroundSlotChangeAndReviewCardNavigation() throws {
        let app = launch(surface: "missionControlFixture:review")
        let slotMenu = element("mission-control-slot-menu", in: app)
        XCTAssertTrue(slotMenu.waitForExistence(timeout: 5))
        XCTAssertEqual(slotMenu.label, "BG SLOTS 1")
        slotMenu.click()
        app.menuItems["2 — two repositories"].click()
        XCTAssertEqual(slotMenu.label, "BG SLOTS 2")

        let reviewCard = element("mission-control-task-ui-alpha-review", in: app)
        XCTAssertTrue(reviewCard.waitForExistence(timeout: 3))
        reviewCard.click()
        XCTAssertTrue(element("mission-control-task-detail", in: app).waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Route background commands and Git review"].exists)
    }

    func testRoutedCommandActionsAndGitConfirmationCancelPaths() throws {
        let app = launch(surface: "missionControlRouteFixture:commands")
        XCTAssertTrue(element("mission-control-task-detail", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["AUTHORIZED ROUTE"].exists)
        XCTAssertTrue(app.staticTexts["/tmp/forge-ui-alpha"].exists)

        let approvePreset = element("mission-control-approve-preset-macos-swiftpm", in: app)
        XCTAssertTrue(approvePreset.waitForExistence(timeout: 3))
        approvePreset.click()
        XCTAssertTrue(element("mission-control-run-preset-macos-swiftpm", in: app).waitForExistence(timeout: 3))

        let cancelCommand = element("mission-control-cancel-command-ui-command-running", in: app)
        XCTAssertTrue(cancelCommand.exists)
        cancelCommand.click()
        XCTAssertFalse(cancelCommand.waitForExistence(timeout: 1))
        XCTAssertTrue(app.staticTexts["CANCELLED"].waitForExistence(timeout: 3))

        element("mission-control-tab-git", in: app).click()
        XCTAssertTrue(app.staticTexts["BACKGROUND REPOSITORY GIT"].waitForExistence(timeout: 3))

        element("mission-control-git-branch", in: app).click()
        let branchAlert = app.alerts["Change background branch?"]
        XCTAssertTrue(branchAlert.waitForExistence(timeout: 3))
        assertAlert(branchAlert, contains: "/tmp/forge-ui-alpha")
        branchAlert.buttons["Cancel"].click()

        element("mission-control-git-commit", in: app).click()
        let commitAlert = app.alerts["Create background local commit?"]
        XCTAssertTrue(commitAlert.waitForExistence(timeout: 3))
        assertAlert(commitAlert, contains: "/tmp/forge-ui-alpha")
        commitAlert.buttons["Cancel"].click()

        XCTAssertFalse(element("mission-control-git-branchPublish", in: app).exists)
        XCTAssertFalse(element("mission-control-git-push", in: app).exists)
    }

    private func launch(surface: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FORGE_UI_TEST_SURFACE"] = surface
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 8))
        return app
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func assertAlert(_ alert: XCUIElement, contains text: String) {
        let match = alert.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
        XCTAssertTrue(match.exists, "Expected alert to contain \(text). Accessibility tree:\n\(alert.debugDescription)")
    }
}
