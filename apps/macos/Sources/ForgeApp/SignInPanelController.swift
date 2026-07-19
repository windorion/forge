import AppKit
import SwiftUI

/// Hosts the `15a` sign-in view in a floating panel (used by 6a CONNECT
/// GITHUB, onboarding step 1, and verification driving).
@MainActor
final class SignInPanelController {
    static let shared = SignInPanelController()

    private var panel: NSPanel?

    func show(workspace: WorkspaceModel) {
        if panel == nil {
            let hosting = NSHostingView(
                rootView: SignInView(close: { [weak self] in self?.hide() })
                    .environmentObject(GitHubAuth.shared)
                    .environmentObject(workspace)
            )
            hosting.frame.size = hosting.fittingSize
            let newPanel = NSPanel(
                contentRect: NSRect(origin: .zero, size: hosting.fittingSize),
                styleMask: [.borderless, .nonactivatingPanel],
                backing: .buffered,
                defer: false
            )
            newPanel.contentView = hosting
            newPanel.isFloatingPanel = true
            newPanel.level = .floating
            newPanel.backgroundColor = .clear
            newPanel.isOpaque = false
            panel = newPanel
        }
        panel?.center()
        panel?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func hide() {
        panel?.orderOut(nil)
        GitHubAuth.shared.reset()
    }
}
