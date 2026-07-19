#if DEBUG
import AppKit

extension Notification.Name {
    static let forgeDebugPresentSurface = Notification.Name("forge.debug.presentSurface")
}

/// Development-only capture hook used by `script/capture_screen.sh`.
///
/// Renders every visible window's own view hierarchy to PNG files when the
/// Darwin notification `com.windorion.forge.debug.capture` is posted (e.g.
/// via `notifyutil -p com.windorion.forge.debug.capture`). Rendering the
/// app's own views requires no Screen Recording permission, which keeps the
/// design-verification pipeline independent of TCC state. Compiled out of
/// release builds.
enum DebugWindowCapture {
    static let outputDirectory = FileManager.default
        .homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Caches/Forge/debug-captures", isDirectory: true)

    @MainActor private static var appNapActivity: NSObjectProtocol?

    @MainActor
    static func activate() {
        // Keep Darwin-notification delivery immediate while the app is
        // occluded; App Nap otherwise defers capture triggers indefinitely.
        appNapActivity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .idleSystemSleepDisabled],
            reason: "debug window capture"
        )
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            nil,
            { _, _, _, _, _ in
                try? "callback \(Date())".write(
                    toFile: NSTemporaryDirectory() + "forge-debug-callback.txt",
                    atomically: true, encoding: .utf8
                )
                DispatchQueue.main.async {
                    DebugWindowCapture.captureAllVisibleWindows()
                }
            },
            "com.windorion.forge.debug.capture" as CFString,
            nil,
            .deliverImmediately
        )
        // Drive workspace surfaces from verification scripts: write the
        // surface spec to the `forge.debug.presentSurface` default, then
        // post `com.windorion.forge.debug.present` (Darwin notifications
        // carry no payload). Forwarded as an internal notification that
        // WorkspaceView resolves against its surface coordinator.
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            nil,
            { _, _, _, _, _ in
                DispatchQueue.main.async {
                    let spec = UserDefaults.standard.string(forKey: "forge.debug.presentSurface")
                    NotificationCenter.default.post(
                        name: .forgeDebugPresentSurface,
                        object: spec
                    )
                }
            },
            "com.windorion.forge.debug.present" as CFString,
            nil,
            .deliverImmediately
        )
    }

    @MainActor
    private static func captureAllVisibleWindows() {
        let fileManager = FileManager.default
        try? fileManager.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

        let stamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "")
        for (index, window) in NSApp.windows.enumerated() where window.isVisible {
            guard let view = window.contentView?.superview ?? window.contentView,
                  let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)
            else { continue }
            view.cacheDisplay(in: view.bounds, to: rep)
            guard let data = rep.representation(using: .png, properties: [:]) else { continue }

            let title = window.title.isEmpty ? "window\(index)" : window.title
            let safeTitle = title.replacingOccurrences(
                of: "[^A-Za-z0-9._-]",
                with: "-",
                options: .regularExpression
            )
            let url = outputDirectory.appendingPathComponent("\(stamp)_\(safeTitle).png")
            try? data.write(to: url)
        }
    }
}
#endif
