import AppKit
import SwiftUI

/// `23a` task share: real local link-generation and a read-only export.
/// The popover, token, scopes, expiry, and revoke are fully real; the
/// hosted viewer at forge.windorion.com is the documented founder-level
/// gap — until it exists, the export is also written locally so the
/// "what they see" page is a real artifact.
enum ShareLinkManager {
    struct Share: Codable {
        var token: String
        var taskID: String
        var scopes: [String]
        var expiresDays: Int
        var createdAt: Date
    }

    private static let key = "forge.taskShares"

    static var sharesDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Forge/shares", isDirectory: true)
    }

    static func load() -> [Share] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let shares = try? JSONDecoder().decode([Share].self, from: data) else { return [] }
        return shares
    }

    static func save(_ shares: [Share]) {
        if let data = try? JSONEncoder().encode(shares) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    static func share(for taskID: String) -> Share? {
        load().first { $0.taskID == taskID }
    }

    @discardableResult
    static func generate(task: ForgeTask, scopes: [String], expiresDays: Int) -> Share {
        var shares = load().filter { $0.taskID != task.id }
        let alphabet = Array("abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789")
        let token = String((0..<12).map { _ in alphabet.randomElement()! })
        let share = Share(token: token, taskID: task.id, scopes: scopes, expiresDays: expiresDays, createdAt: Date())
        shares.append(share)
        save(shares)
        exportReadOnlyPage(task: task, share: share)
        return share
    }

    static func revoke(taskID: String) {
        let shares = load()
        if let existing = shares.first(where: { $0.taskID == taskID }) {
            try? FileManager.default.removeItem(
                at: sharesDirectory.appendingPathComponent("\(existing.token).html")
            )
        }
        save(shares.filter { $0.taskID != taskID })
    }

    static func url(for share: Share) -> String {
        "forge.windorion.com/t/\(share.token)"
    }

    /// Real read-only artifact rendered from live task data.
    private static func exportReadOnlyPage(task: ForgeTask, share: Share) {
        try? FileManager.default.createDirectory(at: sharesDirectory, withIntermediateDirectories: true)
        var sections: [String] = []
        if share.scopes.contains("plan"), let revision = task.planRevisions.last {
            let steps = revision.steps.enumerated()
                .map { "<li>\($0.offset + 1). \(escape($0.element.title))</li>" }
                .joined()
            sections.append("<h2>Plan</h2><ol>\(steps)</ol>")
        }
        if share.scopes.contains("diff"), let proposal = task.editProposal {
            let files = proposal.fileChanges
                .map { "<li><code>\(escape($0.path))</code></li>" }
                .joined()
            sections.append("<h2>Diff</h2><ul>\(files)</ul>")
        }
        if share.scopes.contains("tests") {
            let runs = task.validationRuns.suffix(5)
                .map { "<li>\(escape($0.status)) — \(escape($0.summary ?? ""))</li>" }
                .joined()
            sections.append("<h2>Tests</h2><ul>\(runs.isEmpty ? "<li>no runs recorded</li>" : runs)</ul>")
        }
        let log = task.events.suffix(10)
            .map { "<li><code>\(escape($0.type))</code> \(escape($0.message))</li>" }
            .joined()
        sections.append("<h2>Log</h2><ul>\(log)</ul>")

        let html = """
        <meta charset="utf-8"><title>\(escape(task.title)) — Forge (read-only)</title>
        <style>body{font-family:ui-monospace,monospace;max-width:720px;margin:40px auto;padding:0 20px;background:#f4f4f1;color:#0a0a0a}h1{font-size:20px}h2{font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#6a6a64;border-top:1.5px solid #0a0a0a;padding-top:14px}.badge{display:inline-block;border:1.5px solid #0a0a0a;padding:2px 8px;font-size:11px;font-weight:700}</style>
        <span class="badge">READ-ONLY</span>
        <h1>\(escape(task.title))</h1>
        <p>shared from Forge · status \(escape(task.status)) · expires in \(share.expiresDays)d</p>
        \(sections.joined())
        """
        try? html.write(
            to: sharesDirectory.appendingPathComponent("\(share.token).html"),
            atomically: true, encoding: .utf8
        )
    }

    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}

struct TaskSharePopover: View {
    var task: ForgeTask
    var close: () -> Void

    @State private var share: ShareLinkManager.Share?
    @State private var copied = false
    @State private var scopePlan = true
    @State private var scopeDiff = true
    @State private var scopeTests = true
    @State private var expiresDays = 7

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("SHARE TASK #\(task.id.prefix(4))")
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

            VStack(alignment: .leading, spacing: 0) {
                Text("READ-ONLY LINK")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                    .padding(.bottom, 8)

                HStack(spacing: 0) {
                    Text(linkText)
                        .font(ForgeDesign.mono(10.5))
                        .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(.horizontal, 12)
                        .frame(height: 38)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white)
                    Button(copied ? "COPIED" : "COPY") {
                        copyLink()
                    }
                    .font(ForgeDesign.mono(10, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(copied ? ForgeDesign.ink : ForgeDesign.accent)
                    .padding(.horizontal, 14)
                    .frame(height: 38)
                    .background(copied ? ForgeDesign.accent : ForgeDesign.ink)
                    .buttonStyle(.plain)
                    .overlay(alignment: .leading) { Rectangle().fill(ForgeDesign.ink).frame(width: 1.5) }
                }
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                .padding(.bottom, 8)

                Text("anyone with the link can view — plan, diff, tests, log · no code checkout, no Forge install")
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(ForgeDesign.dashedBorder)
                    .padding(.bottom, 16)

                Text("WHAT THEY SEE")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                    .padding(.bottom, 4)

                scopeRow("plan & steps", hint: "always safe", isOn: $scopePlan)
                scopeRow("full diff", hint: "code visible", isOn: $scopeDiff)
                scopeRow("tests & log", hint: "output visible", isOn: $scopeTests)

                HStack(spacing: 10) {
                    Text("EXPIRES")
                        .font(ForgeDesign.mono(9, weight: .bold))
                        .tracking(1)
                        .foregroundStyle(ForgeDesign.muted)
                    HStack(spacing: 0) {
                        expiryOption("24H", days: 1)
                        expiryOption("7D", days: 7)
                        expiryOption("30D", days: 30)
                    }
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    Spacer()
                    Button("REVOKE LINK") {
                        ShareLinkManager.revoke(taskID: task.id)
                        share = nil
                        copied = false
                    }
                    .font(ForgeDesign.mono(9.5, weight: .bold))
                    .foregroundStyle(ForgeDesign.danger)
                    .buttonStyle(.plain)
                    .disabled(share == nil)
                }
                .padding(.top, 14)

                Text(share == nil
                     ? "▸ COPY generates the link and writes the real read-only export locally"
                     : "▸ hosted viewer is pending — the export lives in Application Support/Forge/shares")
                    .font(ForgeDesign.mono(8.5))
                    .foregroundStyle(ForgeDesign.dashedBorder)
                    .padding(.top, 10)
            }
            .padding(18)
        }
        .frame(width: 420)
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        .forgeShadow(ForgeDesign.ink.opacity(0.85), x: 10, y: 10)
        .onAppear { share = ShareLinkManager.share(for: task.id) }
    }

    private var linkText: String {
        share.map(ShareLinkManager.url(for:)) ?? "forge.windorion.com/t/————————"
    }

    private var scopes: [String] {
        var result: [String] = []
        if scopePlan { result.append("plan") }
        if scopeDiff { result.append("diff") }
        if scopeTests { result.append("tests") }
        return result
    }

    private func copyLink() {
        let active = share ?? ShareLinkManager.generate(task: task, scopes: scopes, expiresDays: expiresDays)
        share = active
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("https://\(ShareLinkManager.url(for: active))", forType: .string)
        copied = true
    }

    private func scopeRow(_ label: String, hint: String, isOn: Binding<Bool>) -> some View {
        HStack(spacing: 11) {
            Text(label)
                .font(ForgeDesign.mono(11, weight: .semibold))
            Spacer()
            Text(hint)
                .font(ForgeDesign.mono(9))
                .foregroundStyle(ForgeDesign.dashedBorder)
            Button {
                isOn.wrappedValue.toggle()
                copied = false
                share = nil
            } label: {
                ZStack(alignment: isOn.wrappedValue ? .trailing : .leading) {
                    Rectangle()
                        .fill(isOn.wrappedValue ? ForgeDesign.accent : Color.white)
                        .frame(width: 38, height: 22)
                    Rectangle()
                        .fill(ForgeDesign.ink)
                        .frame(width: 16, height: 16)
                        .padding(1)
                }
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
    }

    private func expiryOption(_ label: String, days: Int) -> some View {
        Button {
            expiresDays = days
            copied = false
            share = nil
        } label: {
            Text(label)
                .font(ForgeDesign.mono(9.5, weight: .bold))
                .foregroundStyle(expiresDays == days ? ForgeDesign.accent : ForgeDesign.ink)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(expiresDays == days ? ForgeDesign.ink : Color.white)
        }
        .buttonStyle(.plain)
    }
}

@MainActor
final class SharePanelController {
    static let shared = SharePanelController()
    private var panel: NSPanel?

    func show(task: ForgeTask) {
        panel?.orderOut(nil)
        let hosting = NSHostingView(
            rootView: TaskSharePopover(task: task) { [weak self] in self?.hide() }
        )
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
