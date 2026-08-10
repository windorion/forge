import Darwin
import Foundation
import XCTest
@testable import ForgeApp

@MainActor
final class MissionControlRuntimeSupervisorIntegrationTests: XCTestCase {
    func testTransportDisconnectAndOwnedChildTerminationRecoverWithoutQueueEscape() async throws {
        let fileManager = FileManager.default
        let fixtureRoot = fileManager.temporaryDirectory
            .appendingPathComponent("forge-supervisor-integration-\(UUID().uuidString)", isDirectory: true)
        let runtimeDirectory = fixtureRoot.appendingPathComponent("runtime", isDirectory: true)
        let distDirectory = runtimeDirectory.appendingPathComponent("dist", isDirectory: true)
        let repositoryRoot = fixtureRoot.appendingPathComponent("repository", isDirectory: true)
        try fileManager.createDirectory(at: distDirectory, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: repositoryRoot, withIntermediateDirectories: true)

        guard let fixtureURL = Bundle.module.url(
            forResource: "mission_control_supervisor_fixture",
            withExtension: "cjs",
            subdirectory: "Fixtures"
        ) else {
            XCTFail("Missing bundled Mission Control supervisor process fixture.")
            return
        }
        try fileManager.copyItem(
            at: fixtureURL,
            to: distDirectory.appendingPathComponent("server.js")
        )

        let supervisor = MissionControlRuntimeSupervisor(configuration: .init(
            portBase: Int.random(in: 24_000...54_000),
            monitorInterval: .milliseconds(25),
            reconnectDelaySchedule: [0.08, 0.16, 0.24]
        ))
        var snapshots: [String: MissionControlObservedRepository] = [:]
        supervisor.onUpdate = { snapshots = $0 }
        defer {
            supervisor.stopAll()
            try? fileManager.removeItem(at: fixtureRoot)
        }

        let repositoryPath = repositoryRoot.path
        supervisor.synchronize(
            repositoryPaths: [repositoryPath],
            currentPath: nil,
            runtimeDirectory: runtimeDirectory
        )
        try await waitUntil("initial observer runtime") {
            snapshots[repositoryPath]?.status == "LIVE OBSERVER"
        }
        XCTAssertEqual(snapshots[repositoryPath]?.gitStatus?.branch, "fixture-main")

        supervisor.setActiveAuthorization(
            path: repositoryPath,
            isActive: true,
            runtimeDirectory: runtimeDirectory
        )
        try await waitUntil("authorized active runtime") {
            snapshots[repositoryPath]?.status == "ACTIVE RUNTIME"
                && snapshots[repositoryPath]?.health?.runtimeAuthorization?.id != nil
        }

        guard let firstActive = snapshots[repositoryPath],
              let firstProcessID = firstActive.processID,
              let authorizationID = firstActive.health?.runtimeAuthorization?.id
        else {
            XCTFail("Active fixture did not expose process and authorization evidence.")
            return
        }
        XCTAssertEqual(firstActive.health?.queueDispatch?.mode, "supervised")
        XCTAssertEqual(firstActive.queue?.running.count, 1)
        XCTAssertEqual(firstActive.queue?.queued.count, 1)

        let beforeTransport = firstActive.reconnectTelemetry ?? MissionControlReconnectTelemetry()
        let disconnectControl = repositoryRoot.appendingPathComponent("disconnect-once")
        try Data("disconnect".utf8).write(to: disconnectControl, options: .atomic)

        try await waitUntil("transport retry wait") {
            guard let snapshot = snapshots[repositoryPath] else { return false }
            return snapshot.status == "RETRY WAIT"
                && snapshot.processID == firstProcessID
                && (snapshot.reconnectTelemetry?.totalFailures ?? 0) > beforeTransport.totalFailures
        }
        let transportFailure = try XCTUnwrap(snapshots[repositoryPath])
        XCTAssertEqual(transportFailure.gitStatus?.branch, "fixture-main")
        XCTAssertEqual(transportFailure.queue?.queued.map(\.taskID), ["fixture-queued"])
        XCTAssertEqual(transportFailure.health?.runtimeAuthorization?.id, authorizationID)

        try await waitUntil("same-process transport recovery") {
            guard let snapshot = snapshots[repositoryPath] else { return false }
            return snapshot.status == "ACTIVE RUNTIME"
                && snapshot.processID == firstProcessID
                && (snapshot.reconnectTelemetry?.successfulRecoveries ?? 0)
                    > beforeTransport.successfulRecoveries
        }
        let afterTransport = try XCTUnwrap(snapshots[repositoryPath])
        XCTAssertEqual(afterTransport.reconnectTelemetry?.restartAttempts, beforeTransport.restartAttempts)
        XCTAssertEqual(afterTransport.health?.runtimeAuthorization?.id, authorizationID)

        let beforeTermination = afterTransport.reconnectTelemetry ?? MissionControlReconnectTelemetry()
        XCTAssertEqual(Darwin.kill(firstProcessID, SIGKILL), 0)

        try await waitUntil("owned-child termination retry wait") {
            guard let snapshot = snapshots[repositoryPath] else { return false }
            return snapshot.status == "RETRY WAIT"
                && snapshot.processID == nil
                && (snapshot.reconnectTelemetry?.totalFailures ?? 0) > beforeTermination.totalFailures
        }
        let terminated = try XCTUnwrap(snapshots[repositoryPath])
        XCTAssertEqual(terminated.gitStatus?.branch, "fixture-main")
        XCTAssertEqual(terminated.queue?.queued.map(\.taskID), ["fixture-queued"])
        XCTAssertEqual(terminated.health?.runtimeAuthorization?.id, authorizationID)

        try await waitUntil("owned-child relaunch") {
            guard let snapshot = snapshots[repositoryPath],
                  let processID = snapshot.processID
            else { return false }
            return snapshot.status == "ACTIVE RUNTIME"
                && processID != firstProcessID
                && snapshot.health?.runtimeAuthorization?.id == authorizationID
                && (snapshot.reconnectTelemetry?.restartAttempts ?? 0)
                    > beforeTermination.restartAttempts
                && (snapshot.reconnectTelemetry?.successfulRecoveries ?? 0)
                    > beforeTermination.successfulRecoveries
        }

        let recovered = try XCTUnwrap(snapshots[repositoryPath])
        XCTAssertEqual(recovered.health?.queueDispatch?.mode, "supervised")
        XCTAssertEqual(recovered.queue?.running.map(\.taskID), ["fixture-running"])
        XCTAssertEqual(recovered.queue?.queued.map(\.taskID), ["fixture-queued"])

        let events = try readEvents(
            at: repositoryRoot.appendingPathComponent("supervisor-events.jsonl")
        )
        let activeStarts = events.filter { $0.event == "start" && $0.mode == "primary" }
        XCTAssertGreaterThanOrEqual(activeStarts.count, 2)
        XCTAssertTrue(activeStarts.allSatisfy { $0.authorizationID == authorizationID })
        XCTAssertTrue(activeStarts.allSatisfy { $0.queueDispatchMode == "supervised" })
        XCTAssertTrue(events.contains { $0.event == "transport-down" && $0.pid == firstProcessID })
        XCTAssertTrue(events.contains { $0.event == "transport-up" && $0.pid == firstProcessID })
        XCTAssertFalse(events.contains { $0.event == "request" && $0.method == "POST" })
    }

    private func waitUntil(
        _ description: String,
        timeout: TimeInterval = 8,
        condition: @MainActor () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Timed out waiting for \(description).")
        throw IntegrationTestError.timeout(description)
    }

    private func readEvents(at url: URL) throws -> [FixtureEvent] {
        let data = try Data(contentsOf: url)
        return try String(decoding: data, as: UTF8.self)
            .split(separator: "\n")
            .map { Data($0.utf8) }
            .map { try JSONDecoder().decode(FixtureEvent.self, from: $0) }
    }

    private struct FixtureEvent: Decodable {
        var event: String
        var pid: Int32?
        var mode: String?
        var authorizationID: String?
        var queueDispatchMode: String?
        var method: String?
    }

    private enum IntegrationTestError: Error {
        case timeout(String)
    }
}
