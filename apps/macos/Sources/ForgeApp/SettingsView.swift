import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        TabView {
            RuntimeSettingsTab(
                endpoint: workspace.runtimeEndpoint,
                runtimeState: workspace.runtimeState,
                eventStreamState: workspace.eventStreamState,
                statusMessage: workspace.statusMessage,
                eventStreamStatus: workspace.eventStreamStatus,
                runtimeHealth: workspace.runtimeHealth,
                runtimeLastCheckedAt: workspace.runtimeLastCheckedAt,
                runtimeLastError: workspace.runtimeLastError,
                runtimeProcessState: workspace.runtimeProcessState,
                runtimeProcessMessage: workspace.runtimeProcessMessage,
                runtimeProcessID: workspace.runtimeProcessID,
                runtimeProcessDirectory: workspace.runtimeProcessDirectory,
                canStartRuntimeProcess: workspace.canStartRuntimeProcess,
                canStopRuntimeProcess: workspace.canStopRuntimeProcess,
                startRuntimeProcess: workspace.startRuntimeProcess,
                stopRuntimeProcess: workspace.stopRuntimeProcess,
                refresh: workspace.refreshRuntimeHealth,
                copyDiagnostics: workspace.copyRuntimeDiagnostics,
                openRuntimeStatusPage: workspace.openRuntimeStatusPage
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
    var endpoint: String
    var runtimeState: RuntimeConnectionState
    var eventStreamState: RuntimeEventStreamState
    var statusMessage: String
    var eventStreamStatus: String
    var runtimeHealth: RuntimeHealth?
    var runtimeLastCheckedAt: Date?
    var runtimeLastError: String?
    var runtimeProcessState: RuntimeProcessState
    var runtimeProcessMessage: String
    var runtimeProcessID: Int32?
    var runtimeProcessDirectory: String?
    var canStartRuntimeProcess: Bool
    var canStopRuntimeProcess: Bool
    var startRuntimeProcess: () -> Void
    var stopRuntimeProcess: () -> Void
    var refresh: () -> Void
    var copyDiagnostics: () -> Void
    var openRuntimeStatusPage: () -> Void

    var body: some View {
        Form {
            Section("Runtime") {
                LabeledContent("Endpoint", value: endpoint)
                LabeledContent("Runtime State") {
                    RuntimeStateText(state: runtimeState)
                }
                LabeledContent("Event Stream") {
                    EventStreamStateText(state: eventStreamState)
                }
                LabeledContent("Status", value: statusMessage)
                LabeledContent("Stream Detail", value: eventStreamStatus)
                LabeledContent("Managed Process") {
                    Text(runtimeProcessState.rawValue)
                }
                LabeledContent("Process Detail", value: runtimeProcessMessage)
                if let runtimeProcessID {
                    LabeledContent("Process ID", value: "\(runtimeProcessID)")
                }
                if let runtimeProcessDirectory {
                    LabeledContent("Process Directory", value: runtimeProcessDirectory)
                }

                if let runtimeLastCheckedAt {
                    LabeledContent("Last Checked", value: runtimeLastCheckedAt.formatted(date: .abbreviated, time: .standard))
                }

                if let runtimeLastError {
                    LabeledContent("Last Error", value: runtimeLastError)
                }

                if let runtimeHealth {
                    LabeledContent("Service", value: runtimeHealth.service)
                    LabeledContent("Version", value: runtimeHealth.version)
                    LabeledContent("Expected Version", value: WorkspaceModel.expectedRuntimeVersion)
                    LabeledContent("Uptime", value: formattedUptime(runtimeHealth.uptimeSeconds))
                    if let persistence = runtimeHealth.persistence {
                        LabeledContent("Task Count", value: "\(persistence.taskCount)")
                        LabeledContent("Database", value: persistence.databasePath)
                    }
                }

                HStack {
                    Button(action: startRuntimeProcess) {
                        Label("Start Runtime", systemImage: "play.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canStartRuntimeProcess)

                    Button(action: stopRuntimeProcess) {
                        Label("Stop Runtime", systemImage: "stop.circle")
                    }
                    .buttonStyle(.bordered)
                    .disabled(!canStopRuntimeProcess)

                    Button(action: refresh) {
                        Label("Refresh Runtime", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)

                    Button(action: openRuntimeStatusPage) {
                        Label("Open Status Page", systemImage: "safari")
                    }
                    .buttonStyle(.bordered)

                    Button(action: copyDiagnostics) {
                        Label("Copy Diagnostics", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(.bordered)
                }
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

private struct RuntimeStateText: View {
    var state: RuntimeConnectionState

    var body: some View {
        Label(state.rawValue, systemImage: systemImage)
            .foregroundStyle(color)
    }

    private var systemImage: String {
        switch state {
        case .unchecked:
            return "questionmark.circle"
        case .checking:
            return "arrow.triangle.2.circlepath.circle"
        case .running:
            return "checkmark.circle.fill"
        case .needsProviderConfiguration:
            return "exclamationmark.triangle.fill"
        case .wrongVersion:
            return "xmark.octagon.fill"
        case .disconnected:
            return "bolt.horizontal.circle"
        }
    }

    private var color: Color {
        switch state {
        case .running:
            return .green
        case .needsProviderConfiguration, .checking:
            return .orange
        case .wrongVersion, .disconnected:
            return .red
        case .unchecked:
            return .secondary
        }
    }
}

private struct EventStreamStateText: View {
    var state: RuntimeEventStreamState

    var body: some View {
        Label(state.rawValue, systemImage: systemImage)
            .foregroundStyle(color)
    }

    private var systemImage: String {
        switch state {
        case .connected:
            return "dot.radiowaves.left.and.right"
        case .connecting:
            return "antenna.radiowaves.left.and.right"
        case .disconnected:
            return "wifi.slash"
        }
    }

    private var color: Color {
        switch state {
        case .connected:
            return .green
        case .connecting:
            return .orange
        case .disconnected:
            return .secondary
        }
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
