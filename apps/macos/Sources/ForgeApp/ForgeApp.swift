import SwiftUI

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

        Settings {
            SettingsView()
                .environmentObject(workspace)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 980, height: 602)
        .windowResizability(.contentSize)
    }
}
