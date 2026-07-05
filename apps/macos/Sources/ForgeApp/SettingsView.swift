import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        TabView {
            RuntimeSettingsTab(
                statusMessage: workspace.statusMessage,
                runtimeHealth: workspace.runtimeHealth,
                refresh: workspace.refreshRuntimeHealth
            )
            .tabItem {
                Label("Runtime", systemImage: "server.rack")
            }

            ModelProviderSettingsTab(configuration: workspace.runtimeHealth?.modelProviderConfiguration)
                .tabItem {
                    Label("Model", systemImage: "cpu")
                }

            ValidationSettingsTab(
                validationPresetCount: workspace.validationPresets.count,
                workspaceConfig: workspace.workspaceValidationPresetConfig
            )
            .tabItem {
                Label("Validation", systemImage: "checklist")
            }
        }
        .padding()
        .frame(width: 640, height: 500)
    }
}

private struct RuntimeSettingsTab: View {
    var statusMessage: String
    var runtimeHealth: RuntimeHealth?
    var refresh: () -> Void

    var body: some View {
        Form {
            Section("Runtime") {
                LabeledContent("Endpoint", value: "http://127.0.0.1:17373")
                LabeledContent("Status", value: statusMessage)

                if let runtimeHealth {
                    LabeledContent("Service", value: runtimeHealth.service)
                    LabeledContent("Version", value: runtimeHealth.version)
                    LabeledContent("Uptime", value: formattedUptime(runtimeHealth.uptimeSeconds))
                }

                Button(action: refresh) {
                    Label("Refresh Runtime", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
            }

            Section("Product Rules") {
                Text("Forge is task-first, agent-first, local-first, and review-centered.")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private func formattedUptime(_ seconds: Double) -> String {
        let value = Int(seconds.rounded())
        if value < 60 {
            return "\(value)s"
        }

        let minutes = value / 60
        let remainingSeconds = value % 60
        return "\(minutes)m \(remainingSeconds)s"
    }
}

private struct ModelProviderSettingsTab: View {
    var configuration: ModelProviderConfiguration?

    var body: some View {
        Form {
            Section("Provider") {
                if let configuration {
                    LabeledContent("Status") {
                        StatusText(status: configuration.status)
                    }
                    LabeledContent("Provider", value: configuration.provider.name)
                    LabeledContent("Provider ID", value: configuration.provider.id)
                    LabeledContent("Configured ID", value: configuration.configuredProviderID)
                    LabeledContent("Model", value: configuration.provider.model)
                    LabeledContent("Mode", value: configuration.provider.mode)
                    Text(configuration.summary)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Check Runtime to load model provider settings.")
                        .foregroundStyle(.secondary)
                }
            }

            if let configuration {
                Section("Configuration") {
                    ForEach(configuration.settings) { item in
                        LabeledContent(item.label, value: displayValue(for: item))
                    }
                }

                Section("Context Boundary") {
                    LabeledContent("Remote Context", value: configuration.sendsRemoteContext ? "Enabled" : "Disabled")
                    if let summary = configuration.remoteContextSummary {
                        Text(summary)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Issues") {
                    if configuration.issues.isEmpty {
                        Label("No provider issues reported.", systemImage: "checkmark.circle")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(configuration.issues, id: \.self) { issue in
                            Label(issue, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private func displayValue(for item: ModelProviderConfigItem) -> String {
        item.isSecret && item.value == "Configured" ? "Configured" : item.value
    }
}

private struct ValidationSettingsTab: View {
    var validationPresetCount: Int
    var workspaceConfig: WorkspaceValidationPresetConfig?

    var body: some View {
        Form {
            Section("Validation Presets") {
                LabeledContent("Loaded", value: "\(validationPresetCount)")

                if let workspaceConfig {
                    LabeledContent("Workspace Config", value: workspaceConfig.path)
                    LabeledContent("Config Exists", value: workspaceConfig.exists ? "Yes" : "No")

                    if !workspaceConfig.issues.isEmpty {
                        ForEach(workspaceConfig.issues, id: \.self) { issue in
                            Label(issue, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Text("Check Runtime to load validation preset settings.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }
}

private struct StatusText: View {
    var status: String

    var body: some View {
        Label(status, systemImage: systemImage)
            .foregroundStyle(color)
    }

    private var systemImage: String {
        switch status {
        case "Ready":
            return "checkmark.circle.fill"
        case "NeedsConfiguration":
            return "exclamationmark.triangle.fill"
        case "Unsupported":
            return "xmark.octagon.fill"
        default:
            return "questionmark.circle.fill"
        }
    }

    private var color: Color {
        switch status {
        case "Ready":
            return .green
        case "NeedsConfiguration":
            return .orange
        case "Unsupported":
            return .red
        default:
            return .secondary
        }
    }
}
