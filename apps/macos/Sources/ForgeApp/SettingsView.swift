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

            ModelProviderSettingsTab(
                envelope: workspace.modelProviderSettingsEnvelope,
                fallbackConfiguration: workspace.runtimeHealth?.modelProviderConfiguration,
                refresh: workspace.refreshModelProviderSettings,
                save: { providerID, modelName, openAIBaseURL, timeout, maxOutputTokens, apiKey, clearKey in
                    workspace.updateModelProviderSettings(
                        providerID: providerID,
                        modelName: modelName,
                        openAIBaseURL: openAIBaseURL,
                        openAITimeoutMs: timeout,
                        openAIMaxOutputTokens: maxOutputTokens,
                        openAIAPIKey: apiKey,
                        clearOpenAIAPIKey: clearKey
                    )
                },
                isSaving: workspace.isUpdatingModelProviderSettings()
            )
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
    var envelope: ModelProviderSettingsEnvelope?
    var fallbackConfiguration: ModelProviderConfiguration?
    var refresh: () -> Void
    var save: (String, String?, String?, Int?, Int?, String?, Bool?) -> Void
    var isSaving: Bool

    @State private var providerID = "local"
    @State private var modelName = ""
    @State private var openAIBaseURL = ""
    @State private var timeoutText = ""
    @State private var maxOutputText = ""
    @State private var apiKeyInput = ""
    @State private var localMessage = ""

    private var configuration: ModelProviderConfiguration? {
        envelope?.configuration ?? fallbackConfiguration
    }

    var body: some View {
        Form {
            Section("Edit Provider") {
                Picker("Provider", selection: $providerID) {
                    Text("Local").tag("local")
                    Text("OpenAI").tag("openai")
                }
                .pickerStyle(.segmented)

                TextField("Model", text: $modelName)

                HStack {
                    Button(action: refresh) {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }

                    Button(action: { saveCurrentSettings() }) {
                        Label("Save", systemImage: "square.and.arrow.down")
                    }
                    .keyboardShortcut("s", modifiers: [.command])
                    .disabled(isSaving)

                    if isSaving {
                        ProgressView()
                            .controlSize(.small)
                    }
                }

                if let settingsPath = envelope?.editableSettings.settingsPath {
                    LabeledContent("Settings File", value: settingsPath)
                }
            }

            Section("OpenAI") {
                TextField("Base URL", text: $openAIBaseURL)
                TextField("Timeout ms", text: $timeoutText)
                    .monospacedDigit()
                TextField("Max Output Tokens", text: $maxOutputText)
                    .monospacedDigit()
                SecureField("API Key", text: $apiKeyInput)

                if let editableSettings = envelope?.editableSettings {
                    LabeledContent("Runtime Key", value: editableSettings.hasOpenAIAPIKey ? "Configured" : "Missing")
                }

                HStack {
                    Button(action: syncStoredKey) {
                        Label("Use Stored Key", systemImage: "key")
                    }
                    .disabled(isSaving)

                    Button(role: .destructive, action: clearStoredKey) {
                        Label("Clear Key", systemImage: "trash")
                    }
                    .disabled(isSaving)
                }
            }

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

            if !localMessage.isEmpty {
                Section("Last Action") {
                    Text(localMessage)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .onAppear(perform: loadCurrentSettings)
        .onChange(of: envelope) { _, _ in
            loadCurrentSettings()
        }
    }

    private func displayValue(for item: ModelProviderConfigItem) -> String {
        item.isSecret && item.value == "Configured" ? "Configured" : item.value
    }

    private func loadCurrentSettings() {
        let editableSettings = envelope?.editableSettings
        let configuration = configuration
        providerID = editableSettings?.providerID ?? configuration?.provider.id ?? "local"
        modelName = editableSettings?.modelName ?? configuration?.provider.model ?? ""
        openAIBaseURL = editableSettings?.openAIBaseURL ?? ""
        timeoutText = editableSettings?.openAITimeoutMs.map(String.init) ?? ""
        maxOutputText = editableSettings?.openAIMaxOutputTokens.map(String.init) ?? ""
        apiKeyInput = ""
    }

    private func saveCurrentSettings() {
        saveCurrentSettings(apiKeyOverride: nil, clearKey: false, storeEnteredAPIKey: true)
    }

    private func syncStoredKey() {
        do {
            guard let storedKey = try KeychainStore.readOpenAIAPIKey(), !storedKey.isEmpty else {
                localMessage = "No OpenAI API key found in Keychain."
                return
            }

            saveCurrentSettings(apiKeyOverride: storedKey, clearKey: false, storeEnteredAPIKey: false)
            localMessage = "Stored OpenAI API key synced to runtime memory."
        } catch {
            localMessage = "Read Keychain failed: \(error.localizedDescription)"
        }
    }

    private func clearStoredKey() {
        do {
            try KeychainStore.deleteOpenAIAPIKey()
            apiKeyInput = ""
            saveCurrentSettings(apiKeyOverride: nil, clearKey: true, storeEnteredAPIKey: false)
            localMessage = "OpenAI API key cleared from Keychain and runtime memory."
        } catch {
            localMessage = "Clear Keychain failed: \(error.localizedDescription)"
        }
    }

    private func saveCurrentSettings(
        apiKeyOverride: String?,
        clearKey: Bool,
        storeEnteredAPIKey: Bool
    ) {
        do {
            localMessage = ""
            let timeout = try optionalPositiveInteger(timeoutText, fieldName: "Timeout")
            let maxOutputTokens = try optionalPositiveInteger(maxOutputText, fieldName: "Max Output Tokens")
            let trimmedAPIKey = apiKeyOverride ?? optionalTrimmed(apiKeyInput)

            if storeEnteredAPIKey, let trimmedAPIKey {
                try KeychainStore.saveOpenAIAPIKey(trimmedAPIKey)
            }

            save(
                providerID,
                optionalTrimmed(modelName),
                optionalTrimmed(openAIBaseURL),
                timeout,
                maxOutputTokens,
                trimmedAPIKey,
                clearKey ? true : nil
            )

            if trimmedAPIKey != nil && storeEnteredAPIKey {
                apiKeyInput = ""
                localMessage = "Settings saved. API key stored in Keychain and synced to runtime memory."
            } else {
                localMessage = "Settings saved."
            }
        } catch {
            localMessage = error.localizedDescription
        }
    }

    private func optionalTrimmed(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func optionalPositiveInteger(_ value: String, fieldName: String) throws -> Int? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }

        guard let integer = Int(trimmed), integer > 0 else {
            throw SettingsInputError.invalidPositiveInteger(fieldName)
        }

        return integer
    }
}

private enum SettingsInputError: LocalizedError {
    case invalidPositiveInteger(String)

    var errorDescription: String? {
        switch self {
        case .invalidPositiveInteger(let fieldName):
            return "\(fieldName) must be a positive whole number."
        }
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
