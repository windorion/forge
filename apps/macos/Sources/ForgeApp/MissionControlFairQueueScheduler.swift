import Foundation

struct MissionControlFairQueueRepository: Equatable, Hashable {
    var path: String
    var isAuthorized: Bool
    var isLive: Bool
    var dispatchMode: String?
    var runningCount: Int
    var queuedCount: Int
    var oldestEnqueuedAt: String?
}

struct MissionControlFairQueueState: Equatable, Hashable {
    var concurrencyLimit: Int = 1
    var runningCount: Int = 0
    var queuedCount: Int = 0
    var nextRepositoryPath: String?
    var lastGrantedPath: String?
    var grantCount: Int = 0
    var isDispatching = false
    var status = "No authorized background work is queued."
}

enum MissionControlFairQueueScheduler {
    static func nextRepository(
        from repositories: [MissionControlFairQueueRepository],
        concurrencyLimit: Int,
        lastGrantedPath: String?
    ) -> String? {
        let limit = min(max(concurrencyLimit, 1), 2)
        let running = repositories.reduce(0) { $0 + $1.runningCount }
        guard running < limit else { return nil }

        let candidates = repositories.filter {
            $0.isAuthorized && $0.isLive && $0.dispatchMode == "supervised" &&
                $0.runningCount == 0 && $0.queuedCount > 0
        }
        guard !candidates.isEmpty else { return nil }

        let ordered = candidates.sorted { lhs, rhs in
            let left = lhs.oldestEnqueuedAt ?? "9999"
            let right = rhs.oldestEnqueuedAt ?? "9999"
            return left == right ? lhs.path < rhs.path : left < right
        }
        guard let lastGrantedPath,
              let lastIndex = ordered.firstIndex(where: { $0.path == lastGrantedPath })
        else {
            return ordered.first?.path
        }
        return ordered[(lastIndex + 1) % ordered.count].path
    }

    static func state(
        repositories: [MissionControlFairQueueRepository],
        concurrencyLimit: Int,
        lastGrantedPath: String?,
        grantCount: Int,
        isDispatching: Bool
    ) -> MissionControlFairQueueState {
        let limit = min(max(concurrencyLimit, 1), 2)
        let running = repositories.reduce(0) { $0 + $1.runningCount }
        let queued = repositories.reduce(0) { $0 + $1.queuedCount }
        let next = nextRepository(
            from: repositories,
            concurrencyLimit: limit,
            lastGrantedPath: lastGrantedPath
        )
        let status: String
        if isDispatching {
            status = "Granting the next supervised background slot."
        } else if running >= limit {
            status = "Background concurrency limit reached; queued repositories remain ordered fairly."
        } else if let next {
            status = "Next fair grant: \(URL(fileURLWithPath: next).lastPathComponent)."
        } else if queued > 0 {
            status = "Queued work is waiting for an authorized live supervised runtime."
        } else {
            status = "No authorized background work is queued."
        }
        return MissionControlFairQueueState(
            concurrencyLimit: limit,
            runningCount: running,
            queuedCount: queued,
            nextRepositoryPath: next,
            lastGrantedPath: lastGrantedPath,
            grantCount: grantCount,
            isDispatching: isDispatching,
            status: status
        )
    }
}
