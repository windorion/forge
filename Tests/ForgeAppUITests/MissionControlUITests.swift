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

        let authorizeDialog = assertDialog(
            in: app,
            title: "Authorize active runtime?",
            contains: "/tmp/forge-ui-alpha"
        )
        authorizeDialog.buttons["Cancel"].click()
        XCTAssertTrue(authorize.exists)

        app.terminate()
        app = launch(surface: "missionControlFixture:active")
        let revoke = element("mission-control-revoke-fixtures-alpha", in: app)
        XCTAssertTrue(revoke.waitForExistence(timeout: 5))
        revoke.click()

        let revokeDialog = assertDialog(
            in: app,
            title: "Return repository to read-only?",
            contains: "/tmp/forge-ui-alpha"
        )
        revokeDialog.buttons["Cancel"].click()
        XCTAssertTrue(revoke.exists)
    }

    func testBackgroundSlotChangeAndReviewCardNavigation() throws {
        let app = launch(surface: "missionControlFixture:review")
        let slotMenu = element("mission-control-slot-menu", in: app)
        XCTAssertTrue(slotMenu.waitForExistence(timeout: 5))
        XCTAssertEqual(slotMenu.title, "BG SLOTS 1")
        slotMenu.click()
        app.menuItems["2 — two repositories"].click()
        XCTAssertEqual(slotMenu.title, "BG SLOTS 2")

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
        assertText(in: app, contains: "/tmp/forge-ui-alpha")

        let approvePreset = element("mission-control-approve-preset-macos-swiftpm", in: app)
        XCTAssertTrue(approvePreset.waitForExistence(timeout: 3))
        approvePreset.click()
        XCTAssertTrue(element("mission-control-run-preset-macos-swiftpm", in: app).waitForExistence(timeout: 3))

        let cancelCommand = element("mission-control-cancel-command-ui-command-running", in: app)
        XCTAssertTrue(cancelCommand.exists)
        cancelCommand.click()
        XCTAssertTrue(app.staticTexts["CANCELLED"].waitForExistence(timeout: 3))
        XCTAssertFalse(element("mission-control-cancel-command-ui-command-running", in: app).exists)

        element("mission-control-tab-git", in: app).click()
        XCTAssertTrue(app.staticTexts["BACKGROUND REPOSITORY GIT"].waitForExistence(timeout: 3))

        element("mission-control-git-branch", in: app).click()
        let branchDialog = assertDialog(
            in: app,
            title: "Change background branch?",
            contains: "/tmp/forge-ui-alpha"
        )
        branchDialog.buttons["Cancel"].click()

        element("mission-control-git-commit", in: app).click()
        let commitDialog = assertDialog(
            in: app,
            title: "Create background local commit?",
            contains: "/tmp/forge-ui-alpha"
        )
        commitDialog.buttons["Cancel"].click()

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

    private func assertDialog(
        in app: XCUIApplication,
        title: String,
        contains text: String
    ) -> XCUIElement {
        let dialog = app.sheets.firstMatch
        XCTAssertTrue(
            dialog.waitForExistence(timeout: 3),
            "Expected a confirmation sheet. Accessibility tree:\n\(app.debugDescription)"
        )
        let titleMatch = accessibleText(title, in: dialog)
        XCTAssertTrue(
            titleMatch.waitForExistence(timeout: 3),
            "Expected a dialog titled \(title). Accessibility tree:\n\(dialog.debugDescription)"
        )
        let bodyMatch = accessibleText(text, in: dialog)
        XCTAssertTrue(
            bodyMatch.waitForExistence(timeout: 3),
            "Expected a dialog containing \(text). Accessibility tree:\n\(dialog.debugDescription)"
        )
        XCTAssertTrue(dialog.buttons["Cancel"].exists, "Expected a cancellable confirmation dialog.")
        return dialog
    }

    private func assertText(in app: XCUIApplication, contains text: String) {
        let match = accessibleText(text, in: app)
        XCTAssertTrue(
            match.waitForExistence(timeout: 3),
            "Expected accessible text containing \(text). Accessibility tree:\n\(app.debugDescription)"
        )
    }

    private func accessibleText(_ text: String, in app: XCUIApplication) -> XCUIElement {
        accessibleText(text, in: app as XCUIElement)
    }

    private func accessibleText(_ text: String, in element: XCUIElement) -> XCUIElement {
        element.descendants(matching: .any)
            .matching(
                NSPredicate(
                    format: "label CONTAINS[c] %@ OR title CONTAINS[c] %@ OR value CONTAINS[c] %@",
                    text,
                    text,
                    text
                )
            )
            .firstMatch
    }
}
