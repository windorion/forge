import XCTest
@testable import ForgeApp

final class MissionControlRuntimeAccessTests: XCTestCase {
    func testObserverEvidenceAllowsReadOnlyRouting() throws {
        XCTAssertNoThrow(try MissionControlRuntimeAccessPolicy.validate(
            health: health(mode: "observer", readOnly: true),
            expectation: expectation(mode: "observer", requirement: .readOnlyOrAuthorized)
        ))
    }

    func testObserverEvidenceBlocksMutationBeforeRequest() throws {
        XCTAssertThrowsError(try MissionControlRuntimeAccessPolicy.validate(
            health: health(mode: "observer", readOnly: true),
            expectation: expectation(mode: "observer", requirement: .authorizedMutation)
        )) { error in
            XCTAssertTrue(error.localizedDescription.contains("read-only"))
        }
    }

    func testAuthorizedRuntimeRequiresExactSessionEvidence() throws {
        XCTAssertNoThrow(try MissionControlRuntimeAccessPolicy.validate(
            health: health(mode: "primary", readOnly: false, authorizationID: "session-a"),
            expectation: expectation(
                mode: "primary",
                authorizationID: "session-a",
                requirement: .authorizedMutation
            )
        ))

        XCTAssertThrowsError(try MissionControlRuntimeAccessPolicy.validate(
            health: health(mode: "primary", readOnly: false, authorizationID: "session-b"),
            expectation: expectation(
                mode: "primary",
                authorizationID: "session-a",
                requirement: .authorizedMutation
            )
        )) { error in
            XCTAssertTrue(error.localizedDescription.contains("session authorization"))
        }
    }

    func testAuthorizedBackgroundRuntimeRequiresSupervisedDispatchEvidence() throws {
        var expected = expectation(
            mode: "primary",
            authorizationID: "session-a",
            requirement: .authorizedMutation
        )
        expected.requiresSupervisedQueueDispatch = true

        XCTAssertNoThrow(try MissionControlRuntimeAccessPolicy.validate(
            health: health(
                mode: "primary",
                readOnly: false,
                authorizationID: "session-a",
                queueDispatch: RuntimeQueueDispatchInfo(mode: "supervised", acceptsSupervisorGrants: true)
            ),
            expectation: expected
        ))
        XCTAssertThrowsError(try MissionControlRuntimeAccessPolicy.validate(
            health: health(
                mode: "primary",
                readOnly: false,
                authorizationID: "session-a",
                queueDispatch: RuntimeQueueDispatchInfo(mode: "automatic", acceptsSupervisorGrants: false)
            ),
            expectation: expected
        )) { error in
            XCTAssertTrue(error.localizedDescription.contains("supervisor grants"))
        }
    }

    func testRepositoryIdentityMismatchFailsClosedForReadsAndWrites() throws {
        let mismatched = health(
            mode: "primary",
            readOnly: false,
            authorizationID: "session-a",
            repositoryPath: "/tmp/unexpected"
        )
        for requirement in [MissionControlRuntimeAccessRequirement.readOnlyOrAuthorized, .authorizedMutation] {
            XCTAssertThrowsError(try MissionControlRuntimeAccessPolicy.validate(
                health: mismatched,
                expectation: expectation(
                    mode: "primary",
                    authorizationID: "session-a",
                    requirement: requirement
                )
            )) { error in
                XCTAssertTrue(error.localizedDescription.contains("different repository"))
            }
        }
    }

    func testModeAndReadOnlyMismatchFailsClosed() throws {
        XCTAssertThrowsError(try MissionControlRuntimeAccessPolicy.validate(
            health: health(mode: "primary", readOnly: false, authorizationID: "session-a"),
            expectation: expectation(mode: "observer", requirement: .readOnlyOrAuthorized)
        ))

        XCTAssertThrowsError(try MissionControlRuntimeAccessPolicy.validate(
            health: health(mode: "observer", readOnly: false),
            expectation: expectation(mode: "observer", requirement: .readOnlyOrAuthorized)
        ))
    }

    func testReconnectBackoffGrowsExponentiallyAndCapsAtThirtySeconds() {
        XCTAssertEqual(
            (0...7).map(MissionControlReconnectPolicy.delay(forConsecutiveFailureCount:)),
            [0, 2, 4, 8, 16, 30, 30, 30]
        )
    }

    func testReconnectFailureRecordsBoundedTelemetryAndRetryDeadline() {
        let now = Date(timeIntervalSince1970: 1_000)
        let first = MissionControlReconnectPolicy.recordingFailure(
            nil,
            at: now,
            summary: String(repeating: "x", count: 300)
        )
        XCTAssertEqual(first.consecutiveFailures, 1)
        XCTAssertEqual(first.totalFailures, 1)
        XCTAssertEqual(first.nextRetryAt, now.addingTimeInterval(2))
        XCTAssertEqual(first.lastFailureSummary?.count, 240)

        let second = MissionControlReconnectPolicy.recordingFailure(
            first,
            at: now.addingTimeInterval(2),
            summary: "connection refused"
        )
        XCTAssertEqual(second.consecutiveFailures, 2)
        XCTAssertEqual(second.totalFailures, 2)
        XCTAssertEqual(second.nextRetryAt, now.addingTimeInterval(6))
    }

    func testReconnectDeadlineFailsClosedUntilBoundary() {
        let now = Date(timeIntervalSince1970: 2_000)
        let telemetry = MissionControlReconnectPolicy.recordingFailure(
            nil,
            at: now,
            summary: "offline"
        )
        XCTAssertFalse(MissionControlReconnectPolicy.isRetryDue(
            telemetry,
            at: now.addingTimeInterval(1.999)
        ))
        XCTAssertTrue(MissionControlReconnectPolicy.isRetryDue(
            telemetry,
            at: now.addingTimeInterval(2)
        ))
    }

    func testReconnectAttemptRetainsFailureLineageAndClearsDeadline() {
        let failed = MissionControlReconnectPolicy.recordingFailure(
            nil,
            at: Date(timeIntervalSince1970: 3_000),
            summary: "process exited"
        )
        let attempted = MissionControlReconnectPolicy.recordingRestartAttempt(failed)
        XCTAssertEqual(attempted.restartAttempts, 1)
        XCTAssertEqual(attempted.consecutiveFailures, 1)
        XCTAssertEqual(attempted.totalFailures, 1)
        XCTAssertNil(attempted.nextRetryAt)
    }

    func testReconnectSuccessResetsBackoffAndCountsOneRecovery() {
        let failed = MissionControlReconnectPolicy.recordingFailure(
            nil,
            at: Date(timeIntervalSince1970: 4_000),
            summary: "timed out"
        )
        let recovered = MissionControlReconnectPolicy.recordingSuccess(
            failed,
            at: Date(timeIntervalSince1970: 4_002)
        )
        XCTAssertEqual(recovered.consecutiveFailures, 0)
        XCTAssertEqual(recovered.totalFailures, 1)
        XCTAssertEqual(recovered.successfulRecoveries, 1)
        XCTAssertEqual(recovered.successfulRefreshes, 1)
        XCTAssertNil(recovered.nextRetryAt)
        XCTAssertNil(recovered.lastFailureSummary)

        let healthy = MissionControlReconnectPolicy.recordingSuccess(
            recovered,
            at: Date(timeIntervalSince1970: 4_004)
        )
        XCTAssertEqual(healthy.successfulRecoveries, 1)
        XCTAssertEqual(healthy.successfulRefreshes, 2)
    }

    private func expectation(
        mode: String,
        authorizationID: String? = nil,
        requirement: MissionControlRuntimeAccessRequirement
    ) -> MissionControlRuntimeAccessExpectation {
        MissionControlRuntimeAccessExpectation(
            repositoryPath: "/tmp/expected",
            runtimeMode: mode,
            authorizationID: authorizationID,
            requirement: requirement
        )
    }

    private func health(
        mode: String,
        readOnly: Bool,
        authorizationID: String? = nil,
        repositoryPath: String = "/tmp/expected",
        queueDispatch: RuntimeQueueDispatchInfo? = nil
    ) -> RuntimeHealth {
        RuntimeHealth(
            ok: true,
            service: "forge-runtime",
            version: "0.1.0",
            uptimeSeconds: 1,
            runtimeMode: mode,
            readOnly: readOnly,
            runtimeAuthorization: authorizationID.map {
                RuntimeAuthorizationInfo(id: $0, authorizedAt: "2026-08-08T12:00:00Z", scope: "repository-active")
            },
            queueDispatch: queueDispatch,
            modelProvider: nil,
            modelProviderConfiguration: nil,
            workspace: RuntimeWorkspaceInfo(
                runtimeDir: "/tmp/runtime",
                repoRoot: repositoryPath,
                repoRootSource: "environment"
            ),
            persistence: nil,
            index: nil
        )
    }
}
