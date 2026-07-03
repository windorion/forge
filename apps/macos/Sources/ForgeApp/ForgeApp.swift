import SwiftUI

@main
struct ForgeApp: App {
    @StateObject private var workspace = WorkspaceModel()

    var body: some Scene {
        WindowGroup("Forge") {
            WorkspaceView()
                .environmentObject(workspace)
                .frame(minWidth: 1180, minHeight: 760)
        }

        Settings {
            SettingsView()
                .environmentObject(workspace)
        }
    }
}
