import Foundation

struct PullRequestBackgroundRefreshConfiguration: Equatable {
    static let enabledKey = "forge.pullRequestBackgroundRefresh.enabled"
    static let intervalMinutesKey = "forge.pullRequestBackgroundRefresh.intervalMinutes"
    static let maxPullRequestsPerCycleKey = "forge.pullRequestBackgroundRefresh.maxPullRequestsPerCycle"
    static let allowedIntervalMinutes = [15, 30, 60]
    static let allowedCycleLimits = [1, 3, 5]

    var enabled: Bool
    var intervalMinutes: Int
    var maxPullRequestsPerCycle: Int

    static func load(from defaults: UserDefaults) -> Self {
        Self(
            enabled: defaults.bool(forKey: enabledKey),
            intervalMinutes: normalizedInterval(defaults.integer(forKey: intervalMinutesKey)),
            maxPullRequestsPerCycle: normalizedLimit(defaults.integer(forKey: maxPullRequestsPerCycleKey))
        )
    }

    func save(to defaults: UserDefaults) {
        defaults.set(enabled, forKey: Self.enabledKey)
        defaults.set(Self.normalizedInterval(intervalMinutes), forKey: Self.intervalMinutesKey)
        defaults.set(Self.normalizedLimit(maxPullRequestsPerCycle), forKey: Self.maxPullRequestsPerCycleKey)
    }

    private static func normalizedInterval(_ value: Int) -> Int {
        allowedIntervalMinutes.contains(value) ? value : 30
    }

    private static func normalizedLimit(_ value: Int) -> Int {
        allowedCycleLimits.contains(value) ? value : 3
    }
}

struct PullRequestBackgroundRefreshState: Equatable {
    enum Phase: String {
        case disabled = "Disabled"
        case waiting = "Waiting"
        case refreshing = "Refreshing"
        case blocked = "Blocked"
    }

    var phase: Phase = .disabled
    var lastCycleAt: Date?
    var nextCycleAt: Date?
    var attemptedCount = 0
    var succeededCount = 0
    var failedCount = 0
    var message = "Automatic PR status refresh is disabled."
}

enum PullRequestRefreshPolicy {
    /// Select only open, unmerged PRs and refresh the stalest first. This is
    /// deterministic so the bounded cycle cannot starve an older task.
    static func eligibleTasks(_ tasks: [ForgeTask], limit: Int) -> [ForgeTask] {
        let formatter = ISO8601DateFormatter()
        return tasks
            .filter { task in
                guard let pullRequest = task.pullRequest else { return false }
                return pullRequest.state.lowercased() == "open" && !pullRequest.merged
            }
            .sorted { lhs, rhs in
                let left = lhs.pullRequest.flatMap { formatter.date(from: $0.lastCheckedAt) } ?? .distantPast
                let right = rhs.pullRequest.flatMap { formatter.date(from: $0.lastCheckedAt) } ?? .distantPast
                if left != right { return left < right }
                return lhs.id < rhs.id
            }
            .prefix(max(0, limit))
            .map { $0 }
    }
}
