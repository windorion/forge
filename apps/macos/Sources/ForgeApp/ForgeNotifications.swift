import AppKit
import UserNotifications

/// `9a` native notifications: four content kinds fed to
/// UNUserNotificationCenter (macOS renders the banners; the app supplies
/// title/body/actions). Authorization is requested contextually on the
/// first notification-worthy event, never at launch. The "Notify me about"
/// setting (22a) gates delivery: ALL / NEEDS ME / NONE.
@MainActor
enum ForgeNotifications {
    enum Kind {
        case prReady(taskTitle: String, checks: String)
        case needsDecision(taskTitle: String, question: String)
        case selfFix(taskTitle: String, summary: String)
        case budgetCap(spend: String, cap: String)
    }

    private static var authorizationRequested = false

    static func configure() {
        let center = UNUserNotificationCenter.current()
        let review = UNNotificationAction(identifier: "forge.review", title: "Review", options: [.foreground])
        let later = UNNotificationAction(identifier: "forge.later", title: "Later", options: [])
        let answer = UNNotificationAction(identifier: "forge.answer", title: "Answer", options: [.foreground])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "forge.prReady", actions: [review, later], intentIdentifiers: []),
            UNNotificationCategory(identifier: "forge.needsDecision", actions: [answer, later], intentIdentifiers: []),
            UNNotificationCategory(identifier: "forge.selfFix", actions: [], intentIdentifiers: []),
            UNNotificationCategory(identifier: "forge.budgetCap", actions: [review, later], intentIdentifiers: [])
        ])
    }

    static func notify(_ kind: Kind, taskID: String?) {
        let mode = UserDefaults.standard.string(forKey: "forge.notifyMode") ?? "ALL"
        guard mode != "NONE" else { return }

        let content = UNMutableNotificationContent()
        switch kind {
        case let .prReady(title, checks):
            content.title = "PR ready — \(title)"
            content.body = "\(checks) · review the diff before anything ships"
            content.categoryIdentifier = "forge.prReady"
        case let .needsDecision(title, question):
            content.title = "Forge needs a decision — \(title)"
            content.body = question
            content.categoryIdentifier = "forge.needsDecision"
        case let .selfFix(title, summary):
            guard mode == "ALL" else { return }
            content.title = "Self-fix applied — \(title)"
            content.body = summary
            content.categoryIdentifier = "forge.selfFix"
        case let .budgetCap(spend, cap):
            content.title = "Budget cap reached"
            content.body = "\(spend) of \(cap) — agents pause (never abort) until you raise the cap"
            content.categoryIdentifier = "forge.budgetCap"
        }
        content.sound = UserDefaults.standard.bool(forKey: "forge.completionSound") ? .default : nil
        if let taskID {
            content.userInfo = ["taskID": taskID]
        }

        let center = UNUserNotificationCenter.current()
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )

        if authorizationRequested {
            center.add(request)
        } else {
            authorizationRequested = true
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                if granted {
                    center.add(request)
                }
            }
        }
    }

    /// Diff two task snapshots and emit the matching notifications.
    static func emitTransitions(old: [ForgeTask], new: [ForgeTask]) {
        let oldByID = Dictionary(uniqueKeysWithValues: old.map { ($0.id, $0) })
        for task in new {
            guard let previous = oldByID[task.id] else { continue }
            if task.status == "Completed", previous.status != "Completed" {
                let checks = "\(task.validationRuns.filter { $0.status == "Passed" }.count) checks ✓"
                notify(.prReady(taskTitle: task.title, checks: checks), taskID: task.id)
            }
            let wasWaiting = previous.agentRunSteps.last?.action == "WaitForHumanReview"
            let isWaiting = task.agentRunSteps.last?.action == "WaitForHumanReview"
            if isWaiting, !wasWaiting, task.status == "Human Review" {
                let question = task.agentRunSteps.last?.summary ?? "The agent paused at a decision point."
                notify(.needsDecision(taskTitle: task.title, question: question), taskID: task.id)
            }
            if task.commandRerunEvidence.count > previous.commandRerunEvidence.count {
                let summary = task.commandRerunEvidence.last?.summary ?? "A failing check was repaired and re-run."
                notify(.selfFix(taskTitle: task.title, summary: summary), taskID: task.id)
            }
        }
    }
}
