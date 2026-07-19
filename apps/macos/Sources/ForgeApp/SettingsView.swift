import AppKit
import ServiceManagement
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @AppStorage("forge.settingsSection") private var selectionRaw = ForgeSettingsSection.general.rawValue

    private var selection: ForgeSettingsSection {
        get { ForgeSettingsSection(rawValue: selectionRaw) ?? .general }
        nonmutating set { selectionRaw = newValue.rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            SettingsTitleBar()

            HStack(spacing: 0) {
                SettingsSidebar(selection: Binding(get: { selection }, set: { selection = $0 }))
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
                tasks: workspace.tasks,
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
                },
                tasks: workspace.tasks
            )
        case .account:
            AccountUsageSettingsPage(tasks: workspace.tasks, repoRoot: workspace.runtimeHealth?.workspace?.repoRoot)
        case .github:
            GitHubSettingsPage(gitStatus: workspace.gitStatus, repoRoot: workspace.runtimeHealth?.workspace?.repoRoot)
        case .shortcuts:
            ShortcutsSettingsPage()
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
    @AppStorage("forge.theme") private var theme = "AUTO"
    @AppStorage("forge.notifyMode") private var notify = "ALL"

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
        .onChange(of: launchAtLogin) { _, enabled in
            applyLoginItem(enabled)
        }
    }

    /// Register/unregister the real macOS login item; revert the toggle if
    /// the OS refuses (e.g. unsigned dev build not yet approved).
    private func applyLoginItem(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            launchAtLogin = !enabled
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

    var tasks: [ForgeTask] = []

    @State private var provider = "OPENAI"
    @State private var keyInput = ""
    @State private var statusMessage = ""
    @State private var revealKey = false

    private var estimatedSpend: Double {
        tasks.compactMap { $0.planRevisions.last?.estimatedCostUSD }.reduce(0, +)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 10) {
                    settingsLabel("PROVIDER")
                    SettingsSegmented(options: ["ANTHROPIC", "OPENAI", "CUSTOM"], selection: $provider)
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
                        Group {
                            if revealKey {
                                TextField(provider == "OPENAI" ? "sk-…" : "paste provider key", text: $keyInput)
                            } else {
                                SecureField(provider == "OPENAI" ? "sk-…" : "paste provider key", text: $keyInput)
                            }
                        }
                        .textFieldStyle(.plain)
                        .font(.custom("JetBrains Mono", fixedSize: 12))
                        .padding(.horizontal, 14)
                        .frame(height: 44)
                        .disabled(provider != "OPENAI")

                        Button(revealKey ? "🙈" : "👁") {
                            revealKey.toggle()
                        }
                        .buttonStyle(.plain)
                        .font(.system(size: 12))
                        .frame(width: 40, height: 44)
                    }
                    .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))

                    HStack(spacing: 12) {
                        Button {
                            testAndStoreKey()
                        } label: {
                            Text(isSaving ? "▸ TESTING…" : "▸ TEST KEY")
                                .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                                .tracking(0.5)
                                .foregroundStyle(SettingsDesign.accent)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(SettingsDesign.ink)
                        }
                        .buttonStyle(.plain)
                        .disabled(provider != "OPENAI" || trimmedKey.isEmpty || isSaving)
                        Text(statusMessage.isEmpty ? (trimmedKey.isEmpty ? keyStatusNote : "sends one tiny request to verify") : statusMessage)
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
                        keyMetric(label: "THIS MONTH", value: String(format: "$%.2f", estimatedSpend))
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
    var tasks: [ForgeTask]
    var save: (String, String?, String?, Int?, Int?, String?, Bool?) -> Void
    var isSaving: Bool
    var openAPIKey: () -> Void

    @State private var providerID = "local"
    @State private var modelName = ""
    @AppStorage("forge.reasoningEffort") private var effort = "STANDARD"
    @AppStorage("forge.monthlyBudgetCap") private var monthlyBudgetCap = 40

    private var estimatedSpend: Double {
        tasks.compactMap { $0.planRevisions.last?.estimatedCostUSD }.reduce(0, +)
    }

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
                        SettingsSegmented(options: ["LOW", "STANDARD", "MAX"], selection: $effort)
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
                                let fraction = min(CGFloat(estimatedSpend / Double(max(monthlyBudgetCap, 1))), 1)
                                ZStack(alignment: .leading) {
                                    Rectangle().fill(SettingsDesign.paper)
                                    Rectangle().fill(SettingsDesign.accent)
                                        .frame(width: proxy.size.width * fraction)
                                    Rectangle().fill(SettingsDesign.ink)
                                        .frame(width: 1.5)
                                        .offset(x: proxy.size.width * fraction)
                                }
                                .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                            }
                            .frame(height: 12)
                        }
                        Stepper("Budget", value: $monthlyBudgetCap, in: 5...500, step: 5)
                            .labelsHidden()
                        Text(String(format: "$%.2f used this month · pauses (never aborts) at cap", estimatedSpend))
                            .font(.custom("JetBrains Mono", fixedSize: 9.5))
                            .foregroundStyle(SettingsDesign.faint)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 16)

                HStack {
                    (Text("this month: ")
                        + Text("\(tasks.count) runs").fontWeight(.bold).foregroundStyle(SettingsDesign.ink)
                        + Text(" · avg ")
                        + Text(String(format: "$%.2f/run", tasks.isEmpty ? 0 : estimatedSpend / Double(tasks.count))).fontWeight(.bold).foregroundStyle(SettingsDesign.ink)
                        + Text(" · cheaper than the coffee you drink while it works"))
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
        case "MAX": return "more reasoning budget for ambiguous or risky work"
        default: return "thinks before each step — the default"
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

private struct AccountUsageSettingsPage: View {
    var tasks: [ForgeTask]
    var repoRoot: String?

    @AppStorage("forge.monthlyBudgetCap") private var monthlyBudgetCap = 40

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack(spacing: 16) {
                    Text("LOCAL")
                        .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                        .frame(width: 46, height: 46)
                        .background(SettingsDesign.accent)
                        .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 10) {
                            Text("Local Forge workspace")
                                .font(.custom("JetBrains Mono", fixedSize: 14).weight(.bold))
                            Text("BETA · FREE")
                                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(SettingsDesign.accent)
                                .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                        }
                        Text("local-first profile · provider usage estimated from persisted task plans")
                            .font(.custom("JetBrains Mono", fixedSize: 10.5))
                            .foregroundStyle(SettingsDesign.muted)
                    }
                    Spacer()
                }
                .padding(.horizontal, 26)
                .frame(height: 88)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(SettingsDesign.ink).frame(height: 1.5)
                }

                HStack(spacing: 0) {
                    usageMetric(label: "SPEND / CAP", value: String(format: "$%.2f / $%d", estimatedSpend, monthlyBudgetCap))
                    usageMetric(label: "RUNS", value: "\(tasks.count)")
                    usageMetric(label: "COMPLETED", value: "\(completedCount)")
                    usageMetric(label: "AVG / RUN", value: String(format: "$%.2f", averageSpend), divider: false)
                }
                .frame(height: 76)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(SettingsDesign.ink).frame(height: 1.5)
                }

                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        settingsLabel("TASK ACTIVITY — LOCAL HISTORY")
                        Spacer()
                        Text("cap pauses, never aborts")
                            .font(.custom("JetBrains Mono", fixedSize: 9.5))
                            .foregroundStyle(SettingsDesign.faint)
                    }
                    HStack(alignment: .bottom, spacing: 5) {
                        ForEach(Array(activityHeights.enumerated()), id: \.offset) { _, height in
                            Rectangle()
                                .fill(height > 0 ? SettingsDesign.accent : SettingsDesign.paper)
                                .frame(maxWidth: .infinity)
                                .frame(height: CGFloat(max(4, height)))
                                .overlay(Rectangle().stroke(height > 0 ? SettingsDesign.ink : SettingsDesign.divider, lineWidth: 1.5))
                        }
                    }
                    .frame(height: 88, alignment: .bottom)
                    HStack {
                        Text("oldest")
                        Spacer()
                        Text("latest")
                    }
                    .font(.custom("JetBrains Mono", fixedSize: 8.5))
                    .foregroundStyle(SettingsDesign.faint)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 16)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(SettingsDesign.ink).frame(height: 1.5)
                }

                VStack(alignment: .leading, spacing: 10) {
                    settingsLabel("SPEND BY REPO")
                    HStack(spacing: 12) {
                        Text(repoName)
                            .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                            .frame(width: 160, alignment: .leading)
                        GeometryReader { proxy in
                            ZStack(alignment: .leading) {
                                SettingsDesign.paper
                                SettingsDesign.accent
                                    .frame(width: proxy.size.width * budgetFraction)
                                Rectangle().fill(SettingsDesign.ink).frame(width: 1.5)
                                    .offset(x: proxy.size.width * budgetFraction)
                            }
                            .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                        }
                        .frame(height: 12)
                        Text(String(format: "$%.2f", estimatedSpend))
                            .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                            .frame(width: 62, alignment: .trailing)
                        Text("\(tasks.count) runs")
                            .font(.custom("JetBrains Mono", fixedSize: 9.5))
                            .foregroundStyle(SettingsDesign.faint)
                            .frame(width: 62, alignment: .trailing)
                    }
                    .frame(height: 34)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(SettingsDesign.divider).frame(height: 1.5)
                    }
                    Text("▸ billed by your own API key — Forge itself is free during beta")
                        .font(.custom("JetBrains Mono", fixedSize: 10))
                        .foregroundStyle(SettingsDesign.faint)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 16)
            }
        }
    }

    private var estimatedSpend: Double {
        tasks.compactMap { $0.planRevisions.last?.estimatedCostUSD }.reduce(0, +)
    }
    private var averageSpend: Double { tasks.isEmpty ? 0 : estimatedSpend / Double(tasks.count) }
    private var completedCount: Int { tasks.filter { $0.status == "Completed" }.count }
    private var budgetFraction: CGFloat { min(1, CGFloat(estimatedSpend / Double(max(monthlyBudgetCap, 1)))) }
    private var repoName: String {
        guard let repoRoot else { return "local workspace" }
        return URL(fileURLWithPath: repoRoot).lastPathComponent
    }
    private var activityHeights: [Int] {
        let activeCount = min(tasks.count, 14)
        return (0..<14).map { index in index < 14 - activeCount ? 0 : 18 + ((index * 17 + tasks.count * 7) % 68) }
    }

    private func settingsLabel(_ text: String) -> some View {
        Text(text)
            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
            .tracking(1)
            .foregroundStyle(SettingsDesign.muted)
    }

    private func usageMetric(label: String, value: String, divider: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            settingsLabel(label)
            Text(value)
                .font(.custom("JetBrains Mono", fixedSize: value.count > 10 ? 15 : 22).weight(.bold))
                .lineLimit(1)
        }
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .overlay(alignment: .trailing) {
            if divider { Rectangle().fill(SettingsDesign.divider).frame(width: 1.5) }
        }
    }
}

private struct GitHubSettingsPage: View {
    var gitStatus: GitStatusSnapshot?
    var repoRoot: String?

    @AppStorage("forge.githubRepoEnabled") private var repoEnabled = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack(spacing: 16) {
                    Text("GH")
                        .font(.custom("JetBrains Mono", fixedSize: 15).weight(.bold))
                        .frame(width: 46, height: 46)
                        .background(isRemoteKnown ? SettingsDesign.accent : SettingsDesign.paper)
                        .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 10) {
                            Text(isRemoteKnown ? (gitStatus?.upstream ?? "Git remote detected") : "GitHub not connected")
                                .font(.custom("JetBrains Mono", fixedSize: 14).weight(.bold))
                            Text(isRemoteKnown ? "REMOTE FOUND" : "DISCONNECTED")
                                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(isRemoteKnown ? SettingsDesign.accent : SettingsDesign.paper)
                                .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                        }
                        Text("OAuth/device-flow authorization is required before hosted publication")
                            .font(.custom("JetBrains Mono", fixedSize: 10.5))
                            .foregroundStyle(SettingsDesign.muted)
                    }
                    Spacer()
                    Button("CONNECT GITHUB") {}
                        .buttonStyle(SettingsOutlineButtonStyle())
                        .disabled(true)
                }
                .padding(.horizontal, 26)
                .frame(height: 88)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(SettingsDesign.ink).frame(height: 1.5)
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("TOKEN SCOPES — EXACTLY THREE, NOTHING MORE")
                        .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                        .tracking(1)
                        .foregroundStyle(SettingsDesign.muted)
                    HStack(spacing: 10) {
                        scopeCard("repo:read", "read code & issues to plan work")
                        scopeCard("branch:write", "push to forge/* branches only")
                        scopeCard("pr:open", "open & update its own PRs")
                    }
                    Text("▸ no merge scope, no delete scope, no admin scope — revoke anytime at github.com/settings")
                        .font(.custom("JetBrains Mono", fixedSize: 10.5))
                        .foregroundStyle(Color(red: 201 / 255, green: 201 / 255, blue: 196 / 255))
                        .padding(.horizontal, 14)
                        .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                        .background(SettingsDesign.ink)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 18)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(SettingsDesign.ink).frame(height: 1.5)
                }

                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("REPO ACCESS")
                            .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                            .tracking(1)
                            .foregroundStyle(SettingsDesign.muted)
                        Spacer()
                        Text(repoEnabled ? "1 of 1 enabled" : "0 of 1 enabled")
                            .font(.custom("JetBrains Mono", fixedSize: 10))
                            .foregroundStyle(SettingsDesign.muted)
                    }
                    HStack(spacing: 13) {
                        Text("⌥").font(.custom("JetBrains Mono", fixedSize: 12).weight(.bold))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(repoName).font(.custom("JetBrains Mono", fixedSize: 12.5).weight(.bold))
                            Text(gitStatus?.branch ?? "local repository")
                                .font(.custom("JetBrains Mono", fixedSize: 9.5))
                                .foregroundStyle(SettingsDesign.faint)
                        }
                        Spacer()
                        Text("LOCAL TRUST")
                            .font(.custom("JetBrains Mono", fixedSize: 8.5).weight(.bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                        SettingsToggle(isOn: $repoEnabled)
                            .disabled(!isRemoteKnown)
                    }
                    .frame(height: 56)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(SettingsDesign.divider).frame(height: 1.5)
                    }
                    Text("▸ disabled repos are invisible to the hosted integration — local work remains available")
                        .font(.custom("JetBrains Mono", fixedSize: 10))
                        .foregroundStyle(SettingsDesign.faint)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 18)
            }
        }
    }

    private var isRemoteKnown: Bool { gitStatus?.upstream != nil }
    private var repoName: String {
        guard let repoRoot else { return "local workspace" }
        return URL(fileURLWithPath: repoRoot).lastPathComponent
    }

    private func scopeCard(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("✓ \(title)")
                .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
            Text(detail)
                .font(.custom("JetBrains Mono", fixedSize: 9.5))
                .foregroundStyle(SettingsDesign.muted)
                .lineLimit(2)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, minHeight: 66, alignment: .leading)
        .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
    }
}

private struct ShortcutsSettingsPage: View {
    @State private var recordingID: String?
    @State private var monitor: Any?
    @State private var revision = 0

    private var groups: [(String, [ForgeShortcuts.Definition])] {
        let order = ["TASKS", "NAVIGATE", "REVIEW"]
        return order.map { group in
            (group, ForgeShortcuts.definitions.filter { $0.group == group })
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(groups, id: \.0) { group in
                    SettingsSectionHeader(title: group.0)
                    ForEach(group.1) { definition in
                        shortcutRow(definition)
                    }
                }
                HStack {
                    Text("▸ click any binding to remap · esc cancels recording")
                        .font(.custom("JetBrains Mono", fixedSize: 10))
                        .foregroundStyle(SettingsDesign.faint)
                    Spacer()
                    Button("RESET ALL") {
                        ForgeShortcuts.resetAll()
                        revision += 1
                    }
                    .buttonStyle(SettingsOutlineButtonStyle())
                }
                .padding(.horizontal, 26)
                .frame(height: 52)
            }
        }
        .onDisappear(perform: stopRecording)
        .id(revision)
    }

    private func shortcutRow(_ definition: ForgeShortcuts.Definition) -> some View {
        HStack(spacing: 14) {
            Text(definition.title)
                .font(.system(size: 13.5))
            Spacer()
            Button {
                startRecording(definition.id)
            } label: {
                HStack(spacing: 6) {
                    if recordingID == definition.id {
                        Text("press keys…")
                            .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                            .padding(.horizontal, 10)
                            .frame(height: 26)
                            .background(SettingsDesign.accent)
                            .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                    } else {
                        ForEach(ForgeShortcuts.keycaps(definition.id), id: \.self) { cap in
                            Text(cap)
                                .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                                .frame(minWidth: 30)
                                .padding(.horizontal, 9)
                                .frame(height: 26)
                                .background(SettingsDesign.paper)
                                .overlay(Rectangle().stroke(SettingsDesign.ink, lineWidth: 1.5))
                                .forgeShadow(SettingsDesign.ink, x: 2, y: 2)
                        }
                    }
                }
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 26)
        .frame(height: 50)
        .overlay(alignment: .bottom) {
            Rectangle().fill(SettingsDesign.divider).frame(height: 1.5)
        }
    }

    private func startRecording(_ id: String) {
        stopRecording()
        recordingID = id
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if let captured = ForgeShortcuts.capture(from: event) {
                ForgeShortcuts.store(id, key: captured.key, modifiers: captured.modifiers)
            }
            DispatchQueue.main.async {
                stopRecording()
                revision += 1
            }
            return nil
        }
    }

    private func stopRecording() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        recordingID = nil
    }
}
