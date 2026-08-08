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
        repositoryPath: String = "/tmp/expected"
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
