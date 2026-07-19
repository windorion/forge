import AppKit
import SwiftUI

/// `7a` menu bar presence via AppKit NSStatusItem (SwiftUI's MenuBarExtra
/// scene breaks Darwin-notification delivery in this app, so the classic
/// status-item + floating panel path is used instead).
@MainActor
final class MenuBarController {
    static let shared = MenuBarController()

    private var statusItem: NSStatusItem?
    private var panel: NSPanel?
    private weak var workspace: WorkspaceModel?

    func activate(workspace: WorkspaceModel) {
        self.workspace = workspace
        guard statusItem == nil,
              UserDefaults.standard.object(forKey: "forge.showMenuBarExtra") as? Bool ?? true
        else { return }

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            if let url = Bundle.main.url(forResource: "forge-logo", withExtension: "png"),
               let image = NSImage(contentsOf: url) {
                image.size = NSSize(width: 16, height: 16)
                image.isTemplate = false
                button.image = image
            } else {
                button.image = NSImage(systemSymbolName: "hammer.fill", accessibilityDescription: "Forge")
            }
            button.target = self
            button.action = #selector(togglePanel)
        }
        statusItem = item
    }

    func updateBadge(running: Int) {
        guard let button = statusItem?.button else { return }
        button.title = running > 0 ? " \(running)" : ""
        button.attributedTitle = NSAttributedString(
            string: button.title,
            attributes: [
                .foregroundColor: NSColor(red: 166 / 255, green: 116 / 255, blue: 1, alpha: 1),
                .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .heavy)
            ]
        )
    }

    @objc private func togglePanel() {
        if let panel, panel.isVisible {
            panel.orderOut(nil)
            return
        }
        showPanel()
    }

    func showPanel() {
        guard let workspace else { return }
        if panel == nil {
            let hosting = NSHostingView(rootView: MenuBarMiniWindow().environmentObject(workspace))
            hosting.frame.size = hosting.fittingSize
            let newPanel = NSPanel(
                contentRect: NSRect(origin: .zero, size: hosting.fittingSize),
                styleMask: [.borderless, .nonactivatingPanel],
                backing: .buffered,
                defer: false
            )
            newPanel.contentView = hosting
            newPanel.isFloatingPanel = true
            newPanel.level = .statusBar
            newPanel.backgroundColor = .clear
            newPanel.isOpaque = false
            newPanel.hidesOnDeactivate = false
            panel = newPanel
        }
        guard let panel else { return }

        if let button = statusItem?.button, let window = button.window {
            let buttonFrame = window.convertToScreen(button.convert(button.bounds, to: nil))
            let origin = NSPoint(
                x: buttonFrame.midX - panel.frame.width / 2,
                y: buttonFrame.minY - panel.frame.height - 6
            )
            panel.setFrameOrigin(origin)
        } else {
            panel.center()
        }
        panel.orderFrontRegardless()
    }

    func hidePanel() {
        panel?.orderOut(nil)
    }
}
