import SwiftUI

extension Notification.Name {
    static let forgeToggleCommandPalette = Notification.Name("forge.toggleCommandPalette")
    static let forgeNewTask = Notification.Name("forge.newTask")
    static let forgeSwitchRepository = Notification.Name("forge.switchRepository")
    static let forgeToggleMissionControl = Notification.Name("forge.toggleMissionControl")
}

@main
struct ForgeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var workspace = WorkspaceModel()

    var body: some Scene {
        WindowGroup("Forge") {
            WorkspaceView()
                .environmentObject(workspace)
                .frame(minWidth: 900, minHeight: 480)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 980, height: 520)
        .windowResizability(.contentMinSize)
        .commands {
            CommandMenu("Forge") {
                Button("Command Palette") {
                    NotificationCenter.default.post(name: .forgeToggleCommandPalette, object: nil)
                }
                .keyboardShortcut("k", modifiers: [.command])

                Divider()

                Button("New Task") {
                    NotificationCenter.default.post(name: .forgeNewTask, object: nil)
                }
                .keyboardShortcut("n", modifiers: [.command])

                Button("Mission Control") {
                    NotificationCenter.default.post(name: .forgeToggleMissionControl, object: nil)
                }
                .keyboardShortcut("m", modifiers: [.command, .shift])

                Button("Switch Repository…") {
                    NotificationCenter.default.post(name: .forgeSwitchRepository, object: nil)
                }
                .keyboardShortcut("k", modifiers: [.command, .shift])
            }
        }

        Settings {
            SettingsView()
                .environmentObject(workspace)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 980, height: 602)
        .windowResizability(.contentSize)
    }
}
