import CoreSpotlight
import Foundation

/// `11a` Core Spotlight task indexing: every task is searchable by title
/// with status/repo metadata; ↵ opens the task in Forge via the same
/// deep-link route the CLI uses. macOS renders the results — the app only
/// supplies metadata.
enum ForgeSpotlight {
    private static let domain = "com.windorion.forge.tasks"

    static func reindex(tasks: [ForgeTask], repoName: String) {
        let items = tasks.map { task -> CSSearchableItem in
            let attributes = CSSearchableItemAttributeSet(contentType: .item)
            attributes.title = task.title
            attributes.contentDescription = "Forge Task — \(task.status) · \(repoName)"
            attributes.keywords = ["forge", "task", repoName, task.status]
            attributes.identifier = task.id
            attributes.relatedUniqueIdentifier = task.id
            return CSSearchableItem(
                uniqueIdentifier: task.id,
                domainIdentifier: domain,
                attributeSet: attributes
            )
        }
        let index = CSSearchableIndex.default()
        index.deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in
            index.indexSearchableItems(items) { error in
                #if DEBUG
                let summary = error.map { "error: \($0.localizedDescription)" }
                    ?? "indexed \(items.count) task(s) at \(Date())"
                try? summary.write(
                    toFile: NSTemporaryDirectory() + "forge-spotlight.txt",
                    atomically: true, encoding: .utf8
                )
                #endif
            }
        }
    }
}
