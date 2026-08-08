import XCTest
@testable import ForgeApp

final class MissionControlFairQueueSchedulerTests: XCTestCase {
    func testOldestEligibleRepositoryReceivesInitialGrant() {
        let repositories = [
            repository("/beta", queued: 1, enqueuedAt: "2026-08-09T10:01:00Z"),
            repository("/alpha", queued: 1, enqueuedAt: "2026-08-09T10:00:00Z")
        ]
        XCTAssertEqual(
            MissionControlFairQueueScheduler.nextRepository(
                from: repositories,
                concurrencyLimit: 1,
                lastGrantedPath: nil
            ),
            "/alpha"
        )
    }

    func testRoundRobinAlternatesWithoutStarvation() {
        let repositories = [repository("/alpha", queued: 3), repository("/beta", queued: 3)]
        var last: String?
        var grants: [String] = []
        for _ in 0..<6 {
            last = MissionControlFairQueueScheduler.nextRepository(
                from: repositories,
                concurrencyLimit: 1,
                lastGrantedPath: last
            )
            grants.append(try! XCTUnwrap(last))
        }
        XCTAssertEqual(grants, ["/alpha", "/beta", "/alpha", "/beta", "/alpha", "/beta"])
    }

    func testObserverOfflineAndAutomaticRuntimesAreSkipped() {
        var observer = repository("/observer", queued: 1)
        observer.isAuthorized = false
        var offline = repository("/offline", queued: 1)
        offline.isLive = false
        var automatic = repository("/automatic", queued: 1)
        automatic.dispatchMode = "automatic"
        let active = repository("/active", queued: 1)

        XCTAssertEqual(
            MissionControlFairQueueScheduler.nextRepository(
                from: [observer, offline, automatic, active],
                concurrencyLimit: 2,
                lastGrantedPath: nil
            ),
            "/active"
        )
    }

    func testGlobalRunningCountConsumesLimit() {
        var running = repository("/alpha", queued: 0)
        running.runningCount = 1
        XCTAssertNil(MissionControlFairQueueScheduler.nextRepository(
            from: [running, repository("/beta", queued: 2)],
            concurrencyLimit: 1,
            lastGrantedPath: "/alpha"
        ))
        XCTAssertEqual(MissionControlFairQueueScheduler.nextRepository(
            from: [running, repository("/beta", queued: 2)],
            concurrencyLimit: 2,
            lastGrantedPath: "/alpha"
        ), "/beta")
    }

    func testStateExplainsWaitingForAuthorization() {
        var observer = repository("/alpha", queued: 2)
        observer.isAuthorized = false
        let state = MissionControlFairQueueScheduler.state(
            repositories: [observer],
            concurrencyLimit: 1,
            lastGrantedPath: nil,
            grantCount: 0,
            isDispatching: false
        )
        XCTAssertEqual(state.queuedCount, 2)
        XCTAssertNil(state.nextRepositoryPath)
        XCTAssertTrue(state.status.contains("authorized live supervised"))
    }

    private func repository(
        _ path: String,
        queued: Int,
        enqueuedAt: String? = "2026-08-09T10:00:00Z"
    ) -> MissionControlFairQueueRepository {
        MissionControlFairQueueRepository(
            path: path,
            isAuthorized: true,
            isLive: true,
            dispatchMode: "supervised",
            runningCount: 0,
            queuedCount: queued,
            oldestEnqueuedAt: enqueuedAt
        )
    }
}
