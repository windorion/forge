import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        Form {
            Section("Runtime") {
                LabeledContent("Endpoint", value: "http://127.0.0.1:17373")
                LabeledContent("Status", value: workspace.statusMessage)
            }

            Section("Validation Presets") {
                LabeledContent("Loaded", value: "\(workspace.validationPresets.count)")

                if let config = workspace.workspaceValidationPresetConfig {
                    LabeledContent("Workspace Config", value: config.path)
                    LabeledContent("Config Exists", value: config.exists ? "Yes" : "No")

                    if !config.issues.isEmpty {
                        ForEach(config.issues, id: \.self) { issue in
                            Label(issue, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Text("Check Runtime to load validation preset settings.")
                        .foregroundStyle(.secondary)
                }
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
