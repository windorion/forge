import AppKit
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @State private var selection = ForgeSettingsSection.general

    var body: some View {
        VStack(spacing: 0) {
            SettingsTitleBar()

            HStack(spacing: 0) {
                SettingsSidebar(selection: $selection)
                    .frame(width: 200)

                Rectangle()
                    .fill(SettingsDesign.ink)
                    .frame(width: 1.5)

                settingsContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.white)
            }
        }
        .frame(width: 980, height: 602)
        .background(SettingsDesign.paper)
    }

    @ViewBuilder
    private var settingsContent: some View {
        switch selection {
        case .general:
            GeneralSettingsPage(refresh: workspace.refreshRuntimeHealth)
        case .guardrails:
            GuardrailsSettingsPage(
                validationPresetCount: workspace.validationPresets.count,
                workspaceConfig: workspace.workspaceValidationPresetConfig
            )
        case .model:
            ModelSettingsPage(
                envelope: workspace.modelProviderSettingsEnvelope,
                fallbackConfiguration: workspace.runtimeHealth?.modelProviderConfiguration,
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
                isSaving: workspace.isUpdatingModelProviderSettings(),
                openAPIKey: { selection = .apiKey }
            )
        case .apiKey:
            APIKeySettingsPage(
                envelope: workspace.modelProviderSettingsEnvelope,
                isSaving: workspace.isUpdatingModelProviderSettings(),
                save: { key, clear in
                    let editable = workspace.modelProviderSettingsEnvelope?.editableSettings
                    workspace.updateModelProviderSettings(
                        providerID: "openai",
                        modelName: editable?.modelName,
                        openAIBaseURL: editable?.openAIBaseURL,
                        openAITimeoutMs: editable?.openAITimeoutMs,
                        openAIMaxOutputTokens: editable?.openAIMaxOutputTokens,
                        openAIAPIKey: key,
                        clearOpenAIAPIKey: clear ? true : nil
                    )
                }
            )
        case .account, .github, .shortcuts:
            SettingsPendingPage(section: selection)
        }
    }
}

private enum SettingsDesign {
    static let paper = Color(red: 244 / 255, green: 244 / 255, blue: 241 / 255)
    static let ink = Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255)
    static let muted = Color(red: 106 / 255, green: 106 / 255, blue: 100 / 255)
    static let faint = Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255)
    static let divider = Color(red: 226 / 255, green: 225 / 255, blue: 220 / 255)
    static let accent = Color(red: 166 / 255, green: 116 / 255, blue: 255 / 255)
}

private enum ForgeSettingsSection: String, CaseIterable, Identifiable {
    case general = "GENERAL"
    case account = "ACCOUNT"
    case guardrails = "GUARDRAILS"
    case github = "GITHUB"
    case apiKey = "API KEY"
    case model = "MODEL"
    case shortcuts = "SHORTCUTS"

    var id: String { rawValue }
}

private struct SettingsTitleBar: View {
    var body: some View {
        ZStack {
            HStack(spacing: 10) {
                SettingsLogo(size: 18)
                Text("FORGE — SETTINGS")
                    .font(.custom("JetBrains Mono", fixedSize: 12).weight(.bold))
                    .tracking(0.5)
            }
            HStack {
                Spacer()
                Text("v0.4.2")
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(SettingsDesign.muted)
                    .padding(.trailing, 16)
            }
        }
        .frame(height: 42)
        .background(Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255))
        .overlay(alignment: .bottom) {
            Rectangle().fill(SettingsDesign.ink).frame(height: 1.5)
        }
    }
}

private struct SettingsLogo: View {
    var size: CGFloat

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().interpolation(.high)
            } else {
                Text("F")
                    .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(SettingsDesign.accent)
            }
        }
        .frame(width: size, height: size)
        .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1))
    }

    private var image: NSImage? {
        Bundle.main.url(forResource: "forge-logo", withExtension: "png")
            .flatMap(NSImage.init(contentsOf:))
    }
}

private struct SettingsSidebar: View {
    @Binding var selection: ForgeSettingsSection

    var body: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 18)
            ForEach(ForgeSettingsSection.allCases) { section in
                Button {
                    selection = section
                } label: {
                    Text(section.rawValue)
                        .font(.custom("JetBrains Mono", fixedSize: 12).weight(selection == section ? .bold : .regular))
                        .foregroundStyle(selection == section ? SettingsDesign.ink : SettingsDesign.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20)
                        .frame(height: 41)
                        .background(selection == section ? SettingsDesign.accent : Color.clear)
                        .overlay(alignment: .top) {
                            if selection == section { Rectangle().fill(SettingsDesign.ink).frame(height: 1.5) }
                        }
                        .overlay(alignment: .bottom) {
                            if selection == section { Rectangle().fill(SettingsDesign.ink).frame(height: 1.5) }
                        }
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .background(SettingsDesign.paper)
    }
}

private struct SettingsToggle: View {
    @Binding var isOn: Bool

    var body: some View {
        Button { isOn.toggle() } label: {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Rectangle()
                    .fill(isOn ? SettingsDesign.accent : SettingsDesign.paper)
                Rectangle()
                    .fill(SettingsDesign.ink)
                    .frame(width: 16, height: 16)
                    .padding(2)
            }
            .frame(width: 38, height: 22)
            .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }
}

private struct SettingsRow<Trailing: View>: View {
    var title: String
    var subtitle: String
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13.5, weight: .bold))
                Text(subtitle)
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(SettingsDesign.faint)
            }
            Spacer()
            trailing()
        }
        .padding(.horizontal, 26)
        .frame(height: 66)
        .overlay(alignment: .bottom) {
            Rectangle().fill(SettingsDesign.divider).frame(height: 1.5)
        }
    }
}

private struct SettingsSectionHeader: View {
    var title: String

    var body: some View {
        Text(title)
            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
            .tracking(1.5)
            .foregroundStyle(SettingsDesign.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 26)
            .frame(height: 38, alignment: .bottom)
            .padding(.bottom, 8)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) {
                Rectangle().fill(SettingsDesign.ink).frame(height: 1.5)
            }
    }
}

private struct GeneralSettingsPage: View {
    var refresh: () -> Void

    @AppStorage("forge.launchAtLogin") private var launchAtLogin = false
    @AppStorage("forge.reopenLastWorkspace") private var reopenLastWorkspace = true
    @AppStorage("forge.keepRuntimeRunning") private var keepRuntimeRunning = true
    @AppStorage("forge.completionSound") private var completionSound = true
    @State private var theme = "AUTO"
    @State private var notify = "ALL"

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                SettingsSectionHeader(title: "STARTUP")
                SettingsRow(title: "Launch Forge at login", subtitle: "start quietly in the menu bar") {
                    SettingsToggle(isOn: $launchAtLogin)
                }
                SettingsRow(title: "Reopen last workspace", subtitle: "restore task queue and selected repository") {
                    SettingsToggle(isOn: $reopenLastWorkspace)
                }
                SettingsRow(title: "Keep local runtime running", subtitle: "continue queued local work after closing the window") {
                    SettingsToggle(isOn: $keepRuntimeRunning)
                }

                SettingsSectionHeader(title: "APPEARANCE")
                SettingsRow(title: "Theme", subtitle: "auto follows macOS appearance") {
                    SettingsSegmented(options: ["AUTO", "LIGHT", "DARK"], selection: $theme)
                }
                SettingsRow(title: "Accent color", subtitle: "used for running states and primary actions") {
                    HStack(spacing: 8) {
                        ForEach([SettingsDesign.accent, Color(red: 22 / 255, green: 224 / 255, blue: 106 / 255), Color(red: 47 / 255, green: 107 / 255, blue: 1), Color(red: 1, green: 92 / 255, blue: 43 / 255)], id: \.self) { color in
                            Rectangle().fill(color).frame(width: 26, height: 26)
                                .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: color == SettingsDesign.accent ? 1.5 : 1))
                        }
                    }
                }

                SettingsSectionHeader(title: "NOTIFICATIONS")
                SettingsRow(title: "Notify me about", subtitle: "delivered as macOS notifications") {
                    SettingsSegmented(options: ["ALL", "NEEDS ME", "NONE"], selection: $notify)
                }
                SettingsRow(title: "Completion sound", subtitle: "a short anvil \"ting\" when a PR is ready") {
                    SettingsToggle(isOn: $completionSound)
                }
                SettingsRow(title: "Updates", subtitle: "v0.4.2 · release notes in changelog") {
                    Button("CHECK NOW", action: refresh).buttonStyle(SettingsOutlineButtonStyle())
                }
            }
        }
    }
}

private struct GuardrailsSettingsPage: View {
    var validationPresetCount: Int
    var workspaceConfig: WorkspaceValidationPresetConfig?

    @AppStorage("forge.askBeforeDependencies") private var askBeforeDependencies = true
    @AppStorage("forge.runTestsAfterStep") private var runTestsAfterStep = true
    @AppStorage("forge.allowTaskNetwork") private var allowTaskNetwork = false

    var body: some View {
        VStack(spacing: 0) {
            GuardrailRow(title: "Plan approval before changes", subtitle: "every task waits for explicit approval before mutation", locked: true, toggle: nil)
            GuardrailRow(title: "Review diff before apply", subtitle: "proposed file changes stay review-only until accepted", locked: true, toggle: nil)
            GuardrailRow(title: "Ask before new dependencies", subtitle: "the agent pauses instead of changing the dependency graph", locked: false, toggle: $askBeforeDependencies)
            GuardrailRow(title: "Run tests after each step", subtitle: "\(validationPresetCount) validation preset(s) currently loaded", locked: false, toggle: $runTestsAfterStep)
            GuardrailRow(title: "Allow network during tasks", subtitle: workspaceConfig?.exists == true ? "workspace policy loaded from local config" : "off by default · local-first boundary", locked: false, toggle: $allowTaskNetwork)
            Text("▸ guardrails marked ALWAYS ON cannot be disabled — that's the point")
                .font(.custom("JetBrains Mono", fixedSize: 10.5))
                .foregroundStyle(SettingsDesign.faint)
                .padding(.horizontal, 26)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 56)
            Spacer()
        }
    }
}

private struct APIKeySettingsPage: View {
    var envelope: ModelProviderSettingsEnvelope?
    var isSaving: Bool
    var save: (String?, Bool) -> Void

    @State private var provider = "OPENAI"
    @State private var keyInput = ""
    @State private var statusMessage = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 10) {
                    settingsLabel("PROVIDER")
                    SettingsSegmented(options: ["OPENAI", "ANTHROPIC", "GEMINI"], selection: $provider)
                }
                .padding(.horizontal, 26)
                .padding(.top, 18)

                VStack(alignment: .leading, spacing: 10) {
                    settingsLabel("\(provider) API KEY")
                    HStack(spacing: 0) {
                        Text("🔒")
                            .font(.custom("JetBrains Mono", fixedSize: 11))
                            .frame(width: 42, height: 44)
                            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                            .overlay(alignment: .trailing) {
                                Rectangle().fill(SettingsDesign.divider).frame(width: 1.5)
                            }
                        SecureField(provider == "OPENAI" ? "sk-…" : "paste provider key", text: $keyInput)
                            .textFieldStyle(.plain)
                            .font(.custom("JetBrains Mono", fixedSize: 12))
                            .padding(.horizontal, 14)
                            .frame(height: 44)
                            .disabled(provider != "OPENAI")
                    }
                    .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))

                    HStack(spacing: 12) {
                        Button(isSaving ? "TESTING…" : "TEST KEY") {
                            testAndStoreKey()
                        }
                        .buttonStyle(SettingsOutlineButtonStyle())
                        .disabled(provider != "OPENAI" || trimmedKey.isEmpty || isSaving)
                        Text(statusMessage.isEmpty ? keyStatusNote : statusMessage)
                            .font(.custom("JetBrains Mono", fixedSize: 10))
                            .foregroundStyle(statusColor)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("▸ stored in macOS Keychain — never synced, never sent to Windorion servers")
                        Text("▸ calls go directly from your Mac to the provider — we are not a proxy")
                    }
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(SettingsDesign.faint)
                    .lineSpacing(3)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 18)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(SettingsDesign.ink).frame(height: 1.5)
                }

                VStack(alignment: .leading, spacing: 12) {
                    settingsLabel("KEY STATUS")
                    HStack(spacing: 10) {
                        keyMetric(label: "STATE", value: hasStoredKey ? "● ACTIVE" : "○ MISSING")
                        keyMetric(label: "MODELS VISIBLE", value: hasStoredKey ? "1+" : "0")
                        keyMetric(label: "STORAGE", value: "KEYCHAIN")
                    }
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 16)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(SettingsDesign.ink).frame(height: 1.5)
                }

                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 14) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("No key? Use the local provider")
                                .font(.system(size: 13, weight: .bold))
                            Text("no remote context · no provider cost · works offline")
                                .font(.custom("JetBrains Mono", fixedSize: 9.5))
                                .foregroundStyle(SettingsDesign.muted)
                        }
                        Spacer()
                        Text("AVAILABLE")
                            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 68)
                    .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                    .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))

                    Button("REMOVE KEY FROM KEYCHAIN") {
                        removeKey()
                    }
                    .buttonStyle(.plain)
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                    .foregroundStyle(Color(red: 192 / 255, green: 57 / 255, blue: 43 / 255))
                    .disabled(!hasStoredKey || isSaving)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 16)
            }
        }
        .onAppear(perform: refreshStoredKeyStatus)
        .onChange(of: envelope) { _, _ in refreshStoredKeyStatus() }
    }

    private var hasStoredKey: Bool { envelope?.editableSettings.hasOpenAIAPIKey == true }
    private var trimmedKey: String { keyInput.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var keyStatusNote: String { hasStoredKey ? "key configured · enter a replacement to test" : "no provider key configured" }
    private var statusColor: Color { statusMessage.contains("failed") ? .red : SettingsDesign.muted }

    private func settingsLabel(_ text: String) -> some View {
        Text(text)
            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
            .tracking(1)
            .foregroundStyle(SettingsDesign.muted)
    }

    private func keyMetric(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.custom("JetBrains Mono", fixedSize: 8.5).weight(.bold))
                .tracking(1)
                .foregroundStyle(SettingsDesign.muted)
            Text(value)
                .font(.custom("JetBrains Mono", fixedSize: 13).weight(.bold))
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
        .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
    }

    private func testAndStoreKey() {
        guard provider == "OPENAI", !trimmedKey.isEmpty else { return }
        do {
            try KeychainStore.saveOpenAIAPIKey(trimmedKey)
            save(trimmedKey, false)
            keyInput = ""
            statusMessage = "key stored in Keychain · provider check requested"
        } catch {
            statusMessage = "key test failed: \(error.localizedDescription)"
        }
    }

    private func removeKey() {
        do {
            try KeychainStore.deleteOpenAIAPIKey()
            save(nil, true)
            keyInput = ""
            statusMessage = "key removed from Keychain and runtime memory"
        } catch {
            statusMessage = "remove failed: \(error.localizedDescription)"
        }
    }

    private func refreshStoredKeyStatus() {
        guard statusMessage.isEmpty else { return }
        do {
            statusMessage = try KeychainStore.readOpenAIAPIKey() == nil ? "" : "key present in macOS Keychain"
        } catch {
            statusMessage = "key status failed: \(error.localizedDescription)"
        }
    }
}

private struct ModelSettingsPage: View {
    var envelope: ModelProviderSettingsEnvelope?
    var fallbackConfiguration: ModelProviderConfiguration?
    var save: (String, String?, String?, Int?, Int?, String?, Bool?) -> Void
    var isSaving: Bool
    var openAPIKey: () -> Void

    @State private var providerID = "local"
    @State private var modelName = ""
    @AppStorage("forge.reasoningEffort") private var effort = "MEDIUM"
    @AppStorage("forge.monthlyBudgetCap") private var monthlyBudgetCap = 40

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 8) {
                    modelLabel("AGENT MODEL")
                    modelCard(
                        id: "local",
                        name: "LOCAL PROVIDER",
                        tag: "PRIVATE",
                        detail: "deterministic local planning · no remote context",
                        speed: "FAST",
                        cost: "$0"
                    )
                    modelCard(
                        id: "openai",
                        name: modelName.isEmpty ? "OPENAI" : modelName.uppercased(),
                        tag: hasOpenAIKey ? "READY" : "KEY NEEDED",
                        detail: "provider-backed planning and reviewed execution proposals",
                        speed: "REMOTE",
                        cost: "provider billing"
                    )
                }
                .padding(.horizontal, 26)
                .padding(.top, 20)

                VStack(alignment: .leading, spacing: 10) {
                    modelLabel("MODEL NAME")
                    HStack(spacing: 0) {
                        TextField("e.g. gpt-5", text: $modelName)
                            .textFieldStyle(.plain)
                            .font(.custom("JetBrains Mono", fixedSize: 12))
                            .padding(.horizontal, 14)
                            .frame(height: 42)
                            .disabled(providerID == "local")
                        Button(hasOpenAIKey ? "KEY CONFIGURED" : "ADD API KEY", action: openAPIKey)
                            .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                            .padding(.horizontal, 14)
                            .frame(height: 42)
                            .background(Color.white)
                            .buttonStyle(.plain)
                            .overlay(alignment: .leading) {
                                Rectangle().fill(SettingsDesign.ink).frame(width: 1.5)
                            }
                    }
                    .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                    Text("stored in local Forge settings · provider keys stay in macOS Keychain")
                        .font(.custom("JetBrains Mono", fixedSize: 10))
                        .foregroundStyle(SettingsDesign.faint)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 14)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(SettingsDesign.divider).frame(height: 1.5)
                }

                HStack(alignment: .top, spacing: 22) {
                    VStack(alignment: .leading, spacing: 10) {
                        modelLabel("REASONING EFFORT")
                        SettingsSegmented(options: ["LOW", "MEDIUM", "HIGH"], selection: $effort)
                        Text(effortNote)
                            .font(.custom("JetBrains Mono", fixedSize: 9.5))
                            .foregroundStyle(SettingsDesign.faint)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 10) {
                        modelLabel("MONTHLY BUDGET CAP")
                        HStack(spacing: 12) {
                            Text("$\(monthlyBudgetCap)")
                                .font(.custom("JetBrains Mono", fixedSize: 20).weight(.bold))
                            GeometryReader { proxy in
                                ZStack(alignment: .leading) {
                                    Rectangle().fill(SettingsDesign.paper)
                                    Rectangle().fill(SettingsDesign.accent)
                                        .frame(width: proxy.size.width * 0.31)
                                    Rectangle().fill(SettingsDesign.ink)
                                        .frame(width: 1.5)
                                        .offset(x: proxy.size.width * 0.31)
                                }
                                .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                            }
                            .frame(height: 12)
                        }
                        Stepper("Budget", value: $monthlyBudgetCap, in: 5...500, step: 5)
                            .labelsHidden()
                        Text("pauses — never aborts — when the configured cap is reached")
                            .font(.custom("JetBrains Mono", fixedSize: 9.5))
                            .foregroundStyle(SettingsDesign.faint)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 16)

                HStack {
                    Text(configuration?.summary ?? "Choose a provider and save it to the local runtime.")
                        .font(.custom("JetBrains Mono", fixedSize: 10))
                        .foregroundStyle(SettingsDesign.muted)
                        .lineLimit(2)
                    Spacer()
                    Button(isSaving ? "SAVING…" : "SAVE MODEL") {
                        saveModel()
                    }
                    .buttonStyle(SettingsOutlineButtonStyle())
                    .disabled(isSaving || (providerID == "openai" && modelName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
                .padding(.horizontal, 26)
                .frame(minHeight: 54)
                .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                .overlay(alignment: .top) {
                    Rectangle().fill(SettingsDesign.ink).frame(height: 1.5)
                }
            }
        }
        .onAppear(perform: load)
        .onChange(of: envelope) { _, _ in load() }
    }

    private var configuration: ModelProviderConfiguration? { envelope?.configuration ?? fallbackConfiguration }
    private var hasOpenAIKey: Bool { envelope?.editableSettings.hasOpenAIAPIKey == true }
    private var effortNote: String {
        switch effort {
        case "LOW": return "faster and cheaper for straightforward tasks"
        case "HIGH": return "more reasoning budget for ambiguous or risky work"
        default: return "balanced default for normal repository tasks"
        }
    }

    private func modelLabel(_ text: String) -> some View {
        Text(text)
            .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
            .tracking(1)
            .foregroundStyle(SettingsDesign.muted)
    }

    private func modelCard(id: String, name: String, tag: String, detail: String, speed: String, cost: String) -> some View {
        Button { providerID = id } label: {
            HStack(spacing: 14) {
                Text(providerID == id ? "✓" : "")
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                    .frame(width: 18, height: 18)
                    .background(providerID == id ? SettingsDesign.accent : Color.white)
                    .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 9) {
                        Text(name)
                            .font(.custom("JetBrains Mono", fixedSize: 13).weight(.bold))
                        Text(tag)
                            .font(.custom("JetBrains Mono", fixedSize: 8.5).weight(.bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(providerID == id ? SettingsDesign.accent : SettingsDesign.paper)
                            .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1))
                    }
                    Text(detail)
                        .font(.custom("JetBrains Mono", fixedSize: 10.5))
                        .foregroundStyle(SettingsDesign.muted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(speed).font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                    Text(cost).font(.custom("JetBrains Mono", fixedSize: 9)).foregroundStyle(SettingsDesign.faint)
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 68)
            .background(providerID == id ? Color(red: 250 / 255, green: 248 / 255, blue: 1) : Color.white)
            .overlay(Rectangle().stroke(providerID == id ? SettingsDesign.ink : SettingsDesign.divider, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }

    private func load() {
        providerID = envelope?.editableSettings.providerID ?? configuration?.provider.id ?? "local"
        modelName = envelope?.editableSettings.modelName ?? configuration?.provider.model ?? ""
    }

    private func saveModel() {
        let editable = envelope?.editableSettings
        let name = modelName.trimmingCharacters(in: .whitespacesAndNewlines)
        save(
            providerID,
            name.isEmpty ? nil : name,
            editable?.openAIBaseURL,
            editable?.openAITimeoutMs,
            editable?.openAIMaxOutputTokens,
            nil,
            nil
        )
    }
}

private struct GuardrailRow: View {
    var title: String
    var subtitle: String
    var locked: Bool
    var toggle: Binding<Bool>?

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 14, weight: .bold))
                Text(subtitle)
                    .font(.custom("JetBrains Mono", fixedSize: 10.5))
                    .foregroundStyle(SettingsDesign.muted)
            }
            Spacer()
            if locked {
                Text("ALWAYS ON")
                    .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                    .tracking(0.5)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
            } else if let toggle {
                SettingsToggle(isOn: toggle)
            }
        }
        .padding(.horizontal, 26)
        .frame(height: 82)
        .overlay(alignment: .bottom) {
            Rectangle().fill(SettingsDesign.divider).frame(height: 1.5)
        }
    }
}

private struct SettingsSegmented: View {
    var options: [String]
    @Binding var selection: String

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { option in
                Button(option) { selection = option }
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                    .foregroundStyle(selection == option ? Color.white : SettingsDesign.ink)
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .background(selection == option ? SettingsDesign.ink : Color.white)
                    .buttonStyle(.plain)
                    .overlay(alignment: .trailing) {
                        if option != options.last { Rectangle().fill(SettingsDesign.ink).frame(width: 1.5) }
                    }
            }
        }
        .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
    }
}

private struct SettingsOutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
            .padding(.horizontal, 13)
            .frame(height: 34)
            .background(Color.white)
            .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
            .offset(x: configuration.isPressed ? 1 : 0, y: configuration.isPressed ? 1 : 0)
    }
}

private struct SettingsPendingPage: View {
    var section: ForgeSettingsSection

    var body: some View {
        VStack(spacing: 12) {
            Text(section.rawValue)
                .font(.custom("JetBrains Mono", fixedSize: 12).weight(.bold))
            Text("This handoff screen is next in the design-first queue.")
                .font(.custom("JetBrains Mono", fixedSize: 10))
                .foregroundStyle(SettingsDesign.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
