import Foundation

struct MissionControlReconnectTelemetry: Codable, Equatable, Hashable {
    var consecutiveFailures = 0
    var totalFailures = 0
    var restartAttempts = 0
    var successfulRecoveries = 0
    var successfulRefreshes = 0
    var lastConnectedAt: Date?
    var lastFailureAt: Date?
    var nextRetryAt: Date?
    var lastFailureSummary: String?
}

enum MissionControlReconnectPolicy {
    static let maximumDelay: TimeInterval = 30

    static func delay(forConsecutiveFailureCount failureCount: Int) -> TimeInterval {
        guard failureCount > 0 else { return 0 }
        let exponent = min(failureCount - 1, 4)
        return min(pow(2, Double(exponent + 1)), maximumDelay)
    }

    static func recordingFailure(
        _ current: MissionControlReconnectTelemetry?,
        at now: Date,
        summary: String
    ) -> MissionControlReconnectTelemetry {
        var telemetry = current ?? MissionControlReconnectTelemetry()
        telemetry.consecutiveFailures += 1
        telemetry.totalFailures += 1
        telemetry.lastFailureAt = now
        telemetry.lastFailureSummary = String(summary.prefix(240))
        telemetry.nextRetryAt = now.addingTimeInterval(
            delay(forConsecutiveFailureCount: telemetry.consecutiveFailures)
        )
        return telemetry
    }

    static func recordingRestartAttempt(
        _ current: MissionControlReconnectTelemetry?
    ) -> MissionControlReconnectTelemetry {
        var telemetry = current ?? MissionControlReconnectTelemetry()
        telemetry.restartAttempts += 1
        telemetry.nextRetryAt = nil
        return telemetry
    }

    static func recordingSuccess(
        _ current: MissionControlReconnectTelemetry?,
        at now: Date
    ) -> MissionControlReconnectTelemetry {
        var telemetry = current ?? MissionControlReconnectTelemetry()
        if telemetry.consecutiveFailures > 0 {
            telemetry.successfulRecoveries += 1
        }
        telemetry.consecutiveFailures = 0
        telemetry.successfulRefreshes += 1
        telemetry.lastConnectedAt = now
        telemetry.nextRetryAt = nil
        telemetry.lastFailureSummary = nil
        return telemetry
    }

    static func clearingBackoff(
        _ current: MissionControlReconnectTelemetry?
    ) -> MissionControlReconnectTelemetry {
        var telemetry = current ?? MissionControlReconnectTelemetry()
        telemetry.consecutiveFailures = 0
        telemetry.nextRetryAt = nil
        telemetry.lastFailureSummary = nil
        return telemetry
    }

    static func isRetryDue(
        _ telemetry: MissionControlReconnectTelemetry?,
        at now: Date
    ) -> Bool {
        guard let nextRetryAt = telemetry?.nextRetryAt else { return true }
        return now >= nextRetryAt
    }
}
