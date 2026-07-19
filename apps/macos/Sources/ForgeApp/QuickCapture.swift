import AppKit
import Carbon.HIToolbox
import SwiftUI

/// `12a` quick capture: a Raycast-style floating panel summoned by a global
/// hotkey from any app. Carbon RegisterEventHotKey is used (no
/// Accessibility permission needed); the combo is user-configurable via the
/// `forge.quickCaptureHotkey` default ("space|option" storage format).
@MainActor
final class QuickCaptureController {
    static let shared = QuickCaptureController()

    private var panel: NSPanel?
    private weak var workspace: WorkspaceModel?
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?

    func activate(workspace: WorkspaceModel) {
        self.workspace = workspace
        registerHotkey()
    }

    private func registerHotkey() {
        guard hotKeyRef == nil else { return }

        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))
        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, _ in
                DispatchQueue.main.async {
                    QuickCaptureController.shared.toggle()
                }
                return noErr
            },
            1,
            &eventType,
            nil,
            &eventHandler
        )

        let (keyCode, modifiers) = Self.storedHotkey()
        var hotKeyID = EventHotKeyID(signature: OSType(0x464F5247), id: 1) // 'FORG'
        RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    /// Default ⌥Space; stored as "space|option" style string.
    static func storedHotkey() -> (UInt32, UInt32) {
        let raw = UserDefaults.standard.string(forKey: "forge.quickCaptureHotkey") ?? "space|option"
        let parts = raw.split(separator: "|").map(String.init)
        let key = parts.first ?? "space"
        var keyCode = UInt32(kVK_Space)
        switch key {
        case "space": keyCode = UInt32(kVK_Space)
        case "f": keyCode = UInt32(kVK_ANSI_F)
        case "j": keyCode = UInt32(kVK_ANSI_J)
        case "k": keyCode = UInt32(kVK_ANSI_K)
        default: keyCode = UInt32(kVK_Space)
        }
        var modifiers: UInt32 = 0
        if parts.contains("option") { modifiers |= UInt32(optionKey) }
        if parts.contains("cmd") { modifiers |= UInt32(cmdKey) }
        if parts.contains("shift") { modifiers |= UInt32(shiftKey) }
        if parts.contains("control") { modifiers |= UInt32(controlKey) }
        if modifiers == 0 { modifiers = UInt32(optionKey) }
        return (keyCode, modifiers)
    }

    func toggle() {
        if let panel, panel.isVisible {
            hide()
        } else {
            show()
        }
    }

    func show() {
        guard let workspace else { return }
        if panel == nil {
            let hosting = NSHostingView(
                rootView: QuickCaptureView(
                    dismiss: { [weak self] in self?.hide() }
                )
                .environmentObject(workspace)
            )
            hosting.frame.size = hosting.fittingSize
            let newPanel = NSPanel(
                contentRect: NSRect(origin: .zero, size: hosting.fittingSize),
                styleMask: [.borderless, .nonactivatingPanel],
                backing: .buffered,
                defer: false
            )
            newPanel.contentView = hosting
            newPanel.isFloatingPanel = true
            newPanel.level = .statusBar
            newPanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            newPanel.backgroundColor = .clear
            newPanel.isOpaque = false
            newPanel.becomesKeyOnlyIfNeeded = true
            panel = newPanel
        }
        guard let panel else { return }
        panel.center()
        var frame = panel.frame
        if let screen = NSScreen.main {
            frame.origin.y = screen.visibleFrame.midY + screen.visibleFrame.height * 0.12
            panel.setFrameOrigin(frame.origin)
        }
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func hide() {
        panel?.orderOut(nil)
    }
}

struct QuickCaptureView: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    var dismiss: () -> Void

    @State private var draft = ""
    @State private var selectedRepoIndex = 0
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ForgeLogo(size: 24)
                TextField("what should Forge build?", text: $draft)
                    .textFieldStyle(.plain)
                    .font(ForgeDesign.mono(15))
                    .focused($focused)
                    .onSubmit { submit(planOnly: false) }
                Text("ESC")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(ForgeDesign.muted)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .overlay(Rectangle().stroke(Color(red: 204 / 255, green: 202 / 255, blue: 194 / 255), lineWidth: 1.5))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            HStack(spacing: 8) {
                Text("REPO")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                ForEach(Array(repoNames.enumerated()), id: \.offset) { index, name in
                    Button {
                        selectedRepoIndex = index
                    } label: {
                        Text(name)
                            .font(ForgeDesign.mono(10.5, weight: index == selectedRepoIndex ? .bold : .semibold))
                            .foregroundStyle(index == selectedRepoIndex ? ForgeDesign.ink : ForgeDesign.muted)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 3)
                            .background(index == selectedRepoIndex ? ForgeDesign.accent : Color.clear)
                            .overlay(Rectangle().stroke(
                                index == selectedRepoIndex ? ForgeDesign.ink : Color(red: 204 / 255, green: 202 / 255, blue: 194 / 255),
                                lineWidth: 1.5
                            ))
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                Text("⇥ switch")
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(ForgeDesign.dashedBorder)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 11)
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }

            HStack(alignment: .top, spacing: 10) {
                Text("AI")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(ForgeDesign.accent)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(ForgeDesign.ink)
                Text(hint)
                    .font(ForgeDesign.mono(11))
                    .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                    .lineSpacing(4)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }

            HStack(spacing: 14) {
                presetText("model", workspace.runtimeHealth?.modelProvider?.model ?? "local-deterministic-v0")
                presetText("effort", (UserDefaults.standard.string(forKey: "forge.reasoningEffort") ?? "STANDARD").lowercased())
                presetText("guardrails", "on")
                Spacer()
                Text("⌘, change defaults")
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(ForgeDesign.dashedBorder)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 11)
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            HStack(spacing: 0) {
                Button {
                    submit(planOnly: true)
                } label: {
                    HStack(spacing: 9) {
                        Text("PLAN ONLY")
                            .font(ForgeDesign.mono(11.5, weight: .bold))
                            .tracking(0.5)
                        Text("⌥↵")
                            .font(ForgeDesign.mono(9))
                            .foregroundStyle(ForgeDesign.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(ForgeDesign.paper)
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.return, modifiers: [.option])
                .overlay(alignment: .trailing) { Rectangle().fill(ForgeDesign.ink).frame(width: 1.5) }

                Button {
                    submit(planOnly: false)
                } label: {
                    HStack(spacing: 9) {
                        Text("▸ PLAN & RUN")
                            .font(ForgeDesign.mono(11.5, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(ForgeDesign.accent)
                        Text("↵")
                            .font(ForgeDesign.mono(9))
                            .foregroundStyle(ForgeDesign.accent.opacity(0.7))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(ForgeDesign.ink)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(width: 560)
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        .forgeShadow(ForgeDesign.ink.opacity(0.85), x: 10, y: 10)
        .onExitCommand(perform: dismiss)
        .onAppear { focused = true }
    }

    private var repoNames: [String] {
        let registered = workspace.missionControlRepositories.map(\.name)
        return registered.isEmpty ? ["current workspace"] : registered
    }

    /// Honest lightweight intelligence: match the draft against the local
    /// template library; otherwise state the real planning guarantees.
    private var hint: String {
        let lowered = draft.lowercased()
        if !lowered.isEmpty {
            if let match = TaskTemplateStore.load().first(where: { template in
                template.name.lowercased().split(separator: " ").contains { lowered.contains($0) } ||
                    template.summary.lowercased().split(separator: " ").filter { $0.count > 4 }.contains { lowered.contains($0) }
            }) {
                return "matched template: \(match.name) — prefilled presets apply · plan gate still applies"
            }
        }
        return "will plan first · asks before touching anything — nothing runs without your approval"
    }

    private func presetText(_ label: String, _ value: String) -> some View {
        (Text("\(label) ") + Text(value).fontWeight(.bold).foregroundStyle(ForgeDesign.ink))
            .font(ForgeDesign.mono(10))
            .foregroundStyle(ForgeDesign.muted)
    }

    private func submit(planOnly: Bool) {
        let objective = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !objective.isEmpty else { return }
        workspace.createTask(title: String(objective.prefix(60)), objective: objective)
        draft = ""
        dismiss()
        if !planOnly {
            NSApp.activate(ignoringOtherApps: true)
            NSApp.windows.first { $0.identifier?.rawValue.contains("AppWindow") == true }?
                .makeKeyAndOrderFront(nil)
        }
    }
}
