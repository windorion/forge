import AppKit
import CoreSpotlight
import CoreText
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    /// SwiftUI's adaptor wraps NSApp.delegate, so expose the real instance.
    @MainActor private(set) static weak var shared: AppDelegate?

    /// Injected once the SwiftUI scene creates the model, so the Dock menu
    /// (`8a`) and notification actions can read live task state.
    weak var workspace: WorkspaceModel?

    /// `8a` Dock right-click menu built fresh from live task state: summary
    /// header, running tasks with progress, per-question answer items, then
    /// New Task / Mission Control / Pause All. (Show All Windows, Options,
    /// and Quit are contributed by macOS itself.)
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        guard let workspace else { return menu }

        let running = workspace.tasks.filter {
            workspace.isRunningAgentLoop(taskID: $0.id) || ["Running", "Testing"].contains($0.status)
        }
        let waiting = workspace.tasks.filter {
            $0.status == "Human Review" && $0.agentRunSteps.last?.action == "WaitForHumanReview"
        }
        let ready = workspace.tasks.filter { $0.status == "Completed" }

        let summary = NSMenuItem(
            title: "\(running.count) running · \(waiting.count) needs you · \(ready.count) PR ready",
            action: nil,
            keyEquivalent: ""
        )
        summary.isEnabled = false
        menu.addItem(summary)
        menu.addItem(.separator())

        for task in running.prefix(3) {
            let done = task.planSteps.filter { $0.status == "Done" }.count
            let percent = task.planSteps.isEmpty ? 0 : Int(Double(done) / Double(task.planSteps.count) * 100)
            let item = NSMenuItem(
                title: "#\(task.id.prefix(4)) — \(task.title.prefix(28)) (\(percent)%)",
                action: #selector(openTaskMenuItem(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = task.id
            menu.addItem(item)
        }

        for task in waiting.prefix(3) {
            let question = task.agentRunSteps.last?.summary ?? task.title
            let item = NSMenuItem(
                title: "Answer #\(task.id.prefix(4)) — \(question.prefix(30))",
                action: #selector(openTaskMenuItem(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = task.id
            menu.addItem(item)
        }

        if !running.isEmpty || !waiting.isEmpty {
            menu.addItem(.separator())
        }

        let newTask = NSMenuItem(title: "New Task…", action: #selector(newTaskMenuItem), keyEquivalent: "")
        newTask.target = self
        menu.addItem(newTask)

        let missionControl = NSMenuItem(title: "Mission Control", action: #selector(missionControlMenuItem), keyEquivalent: "")
        missionControl.target = self
        menu.addItem(missionControl)

        let pauseAll = NSMenuItem(title: "Pause All Agents", action: #selector(pauseAllMenuItem), keyEquivalent: "")
        pauseAll.target = self
        pauseAll.isEnabled = !running.isEmpty
        menu.addItem(pauseAll)

        return menu
    }

    @objc private func openTaskMenuItem(_ sender: NSMenuItem) {
        guard let taskID = sender.representedObject as? String else { return }
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: .forgeOpenTaskDeepLink, object: taskID)
    }

    @objc private func newTaskMenuItem() {
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: .forgeNewTask, object: nil)
    }

    @objc private func missionControlMenuItem() {
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: .forgeToggleMissionControl, object: nil)
    }

    @objc private func pauseAllMenuItem() {
        let target = workspace
        Task { @MainActor in
            target?.pauseAllMissionControlLoops()
        }
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        AppDelegate.shared = self
        registerBundledFonts()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        #if DEBUG
        DebugWindowCapture.activate()
        #endif

        UNUserNotificationCenter.current().delegate = self
        Task { @MainActor in
            ForgeNotifications.configure()
        }

        DispatchQueue.main.async {
            for window in NSApp.windows {
                window.titleVisibility = .hidden
                window.titlebarAppearsTransparent = true
                window.isMovableByWindowBackground = true
            }
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "forge" {
            guard url.host == "task" else { continue }
            let taskID = url.lastPathComponent
            guard !taskID.isEmpty else { continue }
            NSApp.activate(ignoringOtherApps: true)
            NotificationCenter.default.post(name: .forgeOpenTaskDeepLink, object: taskID)
        }
    }

    /// Notification taps and action buttons route back into the task.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        guard response.actionIdentifier != "forge.later",
              let taskID = response.notification.request.content.userInfo["taskID"] as? String
        else { return }
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: .forgeOpenTaskDeepLink, object: taskID)
    }

    /// Show banners even while Forge is frontmost.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    /// Spotlight result taps (`11a`) continue into the task deep link.
    func application(_ application: NSApplication, continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void) -> Bool {
        guard userActivity.activityType == CSSearchableItemActionType,
              let taskID = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String
        else { return false }
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: .forgeOpenTaskDeepLink, object: taskID)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        NotificationCenter.default.post(name: .forgeApplicationWillTerminate, object: nil)
    }

    private func registerBundledFonts() {
        let fontURLs = Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? []
        for url in fontURLs {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}
