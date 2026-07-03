import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        Form {
            Section("Runtime") {
                LabeledContent("Endpoint", value: "http://127.0.0.1:17373")
                LabeledContent("Status", value: workspace.statusMessage)
            }

            Section("Product Rules") {
                Text("Forge is task-first, agent-first, local-first, and review-centered.")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
        .frame(width: 520)
    }
}
