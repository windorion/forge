import AppKit
import SwiftUI

/// `13a` software-update dialog: found-new-version and downloading states in
/// the app's own window (custom Sparkle driver style).
struct UpdateDialogView: View {
    @ObservedObject var updater = ForgeUpdater.shared
    var close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                ForgeLogo(size: 18)
                Text("SOFTWARE UPDATE")
                    .font(ForgeDesign.mono(11, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(ForgeDesign.paper)
                Spacer()
                Button("✕") { close() }
                    .font(ForgeDesign.mono(11))
                    .foregroundStyle(ForgeDesign.muted)
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(ForgeDesign.ink)

            content
        }
        .frame(width: 440)
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        .forgeShadow(ForgeDesign.ink.opacity(0.85), x: 10, y: 10)
    }

    @ViewBuilder
    private var content: some View {
        switch updater.state {
        case let .available(available):
            found(available, downloading: nil)
        case let .downloading(available, progress):
            found(available, downloading: progress)
        case let .readyToRestart(available):
            found(available, downloading: 1)
        case .checking:
            message("Checking for updates…")
        case .upToDate:
            message("Forge \(updater.currentVersion) is up to date.")
        case let .failed(reason):
            message("Update check failed: \(reason)")
        case .idle:
            message("No update in progress.")
        }
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(ForgeDesign.mono(11))
            .foregroundStyle(ForgeDesign.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
    }

    private func found(_ available: ForgeUpdater.Available, downloading: Double?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Forge \(available.version) is ready.")
                    .font(.system(size: 17, weight: .heavy))
                Text("you have \(updater.currentVersion) · \(String(format: "%.1f", available.sizeMB)) MB · \(available.signedNote)")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            VStack(alignment: .leading, spacing: 10) {
                Text("WHAT'S NEW IN \(available.version)")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                ForEach(available.notes) { note in
                    HStack(alignment: .top, spacing: 9) {
                        Text(note.kind)
                            .font(ForgeDesign.mono(8, weight: .bold))
                            .foregroundStyle(note.kind == "NEW" ? ForgeDesign.accent : ForgeDesign.muted)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .overlay(Rectangle().stroke(note.kind == "NEW" ? ForgeDesign.ink : ForgeDesign.dashedBorder, lineWidth: 1.5))
                        Text(note.text)
                            .font(.system(size: 12))
                            .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                    }
                }
                Button {
                    let raw = available.changelogURL
                    if let url = URL(string: raw.hasPrefix("http") ? raw : "https://\(raw)") {
                        NSWorkspace.shared.open(url)
                    }
                } label: {
                    (Text("full changelog → ")
                        + Text(available.changelogURL).underline())
                        .font(ForgeDesign.mono(9.5))
                        .foregroundStyle(ForgeDesign.muted)
                }
                .buttonStyle(.plain)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            if let progress = downloading {
                VStack(alignment: .leading, spacing: 8) {
                    Text(progress >= 1 ? "downloaded — restart when idle to apply" : "downloading… \(Int(progress * 100))%")
                        .font(ForgeDesign.mono(10))
                        .foregroundStyle(ForgeDesign.muted)
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Rectangle().fill(Color.white)
                            Rectangle().fill(ForgeDesign.accent)
                                .frame(width: proxy.size.width * progress)
                                .overlay(alignment: .trailing) { Rectangle().fill(ForgeDesign.ink).frame(width: 1.5) }
                        }
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    }
                    .frame(height: 12)
                }
                .padding(18)
            } else {
                HStack(spacing: 10) {
                    Button {
                        updater.dismiss()
                        close()
                    } label: {
                        Text("SKIP THIS VERSION")
                            .font(ForgeDesign.mono(10.5, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 42)
                            .background(Color.white)
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                    Button {
                        updater.download(available)
                    } label: {
                        Text("▸ DOWNLOAD & INSTALL")
                            .font(ForgeDesign.mono(10.5, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(ForgeDesign.accent)
                            .frame(maxWidth: .infinity)
                            .frame(height: 42)
                            .background(ForgeDesign.ink)
                    }
                    .buttonStyle(.plain)
                }
                .padding(18)
            }
        }
    }
}

/// `28a` deferred-restart banner shown at the main window bottom once an
/// update is downloaded; never interrupts a running task.
struct UpdateReadyBanner: View {
    @ObservedObject var updater = ForgeUpdater.shared
    var runningTaskCount: Int

    var body: some View {
        if case let .readyToRestart(available) = updater.state {
            HStack(spacing: 12) {
                Text("⇣ v\(available.version) READY")
                    .font(ForgeDesign.mono(9.5, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(ForgeDesign.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .overlay(Rectangle().stroke(ForgeDesign.accent, lineWidth: 1.5))
                (Text("Update downloaded — sessions and queue survive. ")
                    + Text(runningTaskCount > 0
                           ? "\(runningTaskCount) task\(runningTaskCount == 1 ? "" : "s") running — won't be interrupted."
                           : "no task running — safe to restart."))
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.paper)
                Spacer()
                bannerButton(runningTaskCount > 0 ? "RESTART WHEN IDLE" : "RESTART NOW", filled: true)
                bannerButton("LATER", filled: false) { updater.dismiss() }
            }
            .padding(.horizontal, 20)
            .frame(height: 46)
            .background(ForgeDesign.ink)
            .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.accent).frame(height: 1.5) }
        }
    }

    private func bannerButton(_ title: String, filled: Bool, action: @escaping () -> Void = {}) -> some View {
        Button(action: action) {
            Text(title)
                .font(ForgeDesign.mono(9.5, weight: .bold))
                .tracking(0.5)
                .foregroundStyle(filled ? ForgeDesign.ink : ForgeDesign.paper)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(filled ? ForgeDesign.accent : Color.clear)
                .overlay(Rectangle().stroke(filled ? ForgeDesign.accent : ForgeDesign.paper, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }
}

@MainActor
final class UpdatePanelController {
    static let shared = UpdatePanelController()
    private var panel: NSPanel?

    func show() {
        panel?.orderOut(nil)
        let hosting = NSHostingView(rootView: UpdateDialogView { [weak self] in self?.hide() })
        hosting.frame.size = hosting.fittingSize
        let newPanel = NSPanel(
            contentRect: NSRect(origin: .zero, size: hosting.fittingSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        newPanel.contentView = hosting
        newPanel.isFloatingPanel = true
        newPanel.level = .floating
        newPanel.backgroundColor = .clear
        newPanel.isOpaque = false
        newPanel.center()
        newPanel.makeKeyAndOrderFront(nil)
        panel = newPanel
        NSApp.activate(ignoringOtherApps: true)
    }

    func hide() {
        panel?.orderOut(nil)
        panel = nil
    }
}
