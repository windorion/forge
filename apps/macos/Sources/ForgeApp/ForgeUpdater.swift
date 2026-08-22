import AppKit
import SwiftUI

/// `13a`/`28a` update flow. The dialog and deferred-restart banner are the
/// app's own custom UI (the handoff notes "Sparkle 允许自定义更新 UI" —
/// Sparkle permits a custom driver). This client performs the real appcast
/// check/parse/version-compare and drives that UI against a placeholder
/// local/hosted appcast. The EdDSA-signed appcast, notarized delta, and the
/// actual binary install/relaunch are the P6 signing/hosting remainder.
@MainActor
final class ForgeUpdater: ObservableObject {
    static let shared = ForgeUpdater()

    struct Available: Equatable {
        var version: String
        var sizeMB: Double
        var signedNote: String
        var updateSignaturePresent: Bool
        var installEnabled: Bool
        var notes: [ReleaseNote]
        var changelogURL: String
    }

    struct ReleaseNote: Equatable, Identifiable {
        var id = UUID()
        var kind: String // NEW / FIX
        var text: String
    }

    enum State: Equatable {
        case idle
        case checking
        case upToDate
        case available(Available)
        case downloading(Available, progress: Double)
        case readyToRestart(Available)
        case failed(String)
    }

    #if DEBUG
    @Published var state: State = .idle
    #else
    @Published private(set) var state: State = .idle
    #endif

    var currentVersion: String { ForgeDesign.appVersion.replacingOccurrences(of: "v", with: "") }

    /// Feed URL defaults to a bundled placeholder appcast so the flow is
    /// exercisable offline; a real SUFeedURL replaces it in production.
    private var feedURL: URL {
        if let configured = UserDefaults.standard.string(forKey: "forge.updateFeedURL"),
           let url = URL(string: configured) {
            return url
        }
        if let bundled = Bundle.main.url(forResource: "appcast", withExtension: "xml") {
            return bundled
        }
        return URL(fileURLWithPath: "/tmp/forge-appcast.xml")
    }

    func checkForUpdates() {
        state = .checking
        Task {
            do {
                let data = try await fetchFeed()
                guard let available = Self.parse(data) else {
                    state = .upToDate
                    return
                }
                if compare(available.version, currentVersion) > 0 {
                    state = .available(available)
                } else {
                    state = .upToDate
                }
            } catch {
                state = .failed(error.localizedDescription)
            }
        }
    }

    private func fetchFeed() async throws -> Data {
        if feedURL.isFileURL {
            return try Data(contentsOf: feedURL)
        }
        let (data, _) = try await URLSession.shared.data(from: feedURL)
        return data
    }

    /// Simulated real-time download progress against the declared size;
    /// the actual signed binary fetch/install is the Sparkle+signing P6
    /// remainder, so this stops at "ready to restart" without mutating the
    /// installed app.
    func download(_ available: Available) {
        guard available.installEnabled else {
            state = .failed("Signed update download and installation are not connected yet.")
            return
        }
        state = .downloading(available, progress: 0)
        Task {
            for step in 1...20 {
                try? await Task.sleep(for: .milliseconds(120))
                if case .downloading = state {
                    state = .downloading(available, progress: Double(step) / 20)
                } else {
                    return
                }
            }
            state = .readyToRestart(available)
        }
    }

    func dismiss() {
        state = .idle
    }

    static func parse(_ data: Data) -> Available? {
        let parser = AppcastParser()
        return parser.parse(data)
    }

    private func compare(_ lhs: String, _ rhs: String) -> Int {
        let l = lhs.split(separator: ".").map { Int($0) ?? 0 }
        let r = rhs.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(l.count, r.count) {
            let a = i < l.count ? l[i] : 0
            let b = i < r.count ? r[i] : 0
            if a != b { return a > b ? 1 : -1 }
        }
        return 0
    }
}

/// Minimal appcast (RSS + Sparkle namespace) reader — enough to drive the
/// real check UI. Reads the newest <item>'s version, length, and the
/// description's NEW/FIX bullet lines.
private final class AppcastParser: NSObject, XMLParserDelegate {
    private var version = ""
    private var lengthBytes = 0.0
    private var descriptionText = ""
    private var changelogURL = ""
    private var updateSignaturePresent = false
    private var current = ""
    private var captured = false

    func parse(_ data: Data) -> ForgeUpdater.Available? {
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.parse()
        guard !version.isEmpty else { return nil }
        let notes = descriptionText
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> ForgeUpdater.ReleaseNote? in
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.uppercased().hasPrefix("NEW:") {
                    return .init(kind: "NEW", text: String(trimmed.dropFirst(4)).trimmingCharacters(in: .whitespaces))
                }
                if trimmed.uppercased().hasPrefix("FIX:") {
                    return .init(kind: "FIX", text: String(trimmed.dropFirst(4)).trimmingCharacters(in: .whitespaces))
                }
                return nil
            }
        return .init(
            version: version,
            sizeMB: (lengthBytes / 1_048_576).rounded(toPlaces: 1),
            signedNote: updateSignaturePresent
                ? "update signature present · notarization not verified here"
                : "unsigned placeholder feed · install disabled",
            updateSignaturePresent: updateSignaturePresent,
            installEnabled: false,
            notes: notes,
            changelogURL: changelogURL.isEmpty ? "https://windorion.com/changelog" : changelogURL
        )
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
                qualifiedName qName: String?, attributes attributeDict: [String: String]) {
        current = elementName
        if elementName == "enclosure", !captured {
            version = attributeDict["sparkle:shortVersionString"] ?? attributeDict["sparkle:version"] ?? version
            lengthBytes = Double(attributeDict["length"] ?? "0") ?? 0
            updateSignaturePresent = !(attributeDict["sparkle:edSignature"] ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .isEmpty
            captured = true
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        switch current {
        case "description" where !captured: descriptionText += string
        case "sparkle:releaseNotesLink":
            changelogURL += string.trimmingCharacters(in: .whitespacesAndNewlines)
        default: break
        }
    }
}

private extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let factor = pow(10.0, Double(places))
        return (self * factor).rounded() / factor
    }
}
