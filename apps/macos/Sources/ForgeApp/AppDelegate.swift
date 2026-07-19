import AppKit
import CoreText

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        registerBundledFonts()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        #if DEBUG
        DebugWindowCapture.activate()
        #endif

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
