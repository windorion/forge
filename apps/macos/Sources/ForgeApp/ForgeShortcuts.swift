import AppKit
import SwiftUI

/// User-remappable keyboard shortcut registry (`5b`). Definitions carry the
/// handoff defaults; overrides persist per command in UserDefaults and are
/// read live by SwiftUI `.keyboardShortcut` call sites.
enum ForgeShortcuts {
    struct Definition: Identifiable {
        var id: String
        var title: String
        var group: String
        var key: String
        var modifiers: [String]
        /// Commands whose keys are structural (hunk J/K, Escape) or not yet
        /// wired stay display-only in the settings list.
        var remappable = true
    }

    static let definitions: [Definition] = [
        Definition(id: "newTask", title: "New task", group: "TASKS", key: "n", modifiers: ["cmd"]),
        Definition(id: "commandPalette", title: "Command palette", group: "TASKS", key: "k", modifiers: ["cmd"]),
        Definition(id: "approvePlan", title: "Approve plan / confirm", group: "TASKS", key: "return", modifiers: ["cmd"]),
        Definition(id: "pauseResume", title: "Pause / resume agent", group: "TASKS", key: "p", modifiers: ["cmd"]),
        Definition(id: "abortTask", title: "Abort task", group: "TASKS", key: "delete", modifiers: ["cmd"]),
        Definition(id: "switchRepo", title: "Switch repo", group: "NAVIGATE", key: "k", modifiers: ["cmd", "shift"]),
        Definition(id: "missionControl", title: "Mission control", group: "NAVIGATE", key: "m", modifiers: ["cmd", "shift"]),
        Definition(id: "taskQueue", title: "Task queue", group: "NAVIGATE", key: "q", modifiers: ["cmd", "shift"]),
        Definition(id: "taskHistory", title: "Task history", group: "NAVIGATE", key: "y", modifiers: ["cmd"]),
        Definition(id: "openDiff", title: "Open full diff", group: "REVIEW", key: "1", modifiers: ["cmd"]),
        Definition(id: "exportAudit", title: "Export audit log", group: "REVIEW", key: "e", modifiers: ["cmd"]),
        Definition(id: "approveFile", title: "Approve file", group: "REVIEW", key: "return", modifiers: ["cmd"])
    ]

    private static func storageKey(_ id: String) -> String { "forge.shortcut.\(id)" }

    static func stored(_ id: String) -> (key: String, modifiers: [String])? {
        guard let raw = UserDefaults.standard.string(forKey: storageKey(id)) else { return nil }
        let parts = raw.split(separator: "|").map(String.init)
        guard let key = parts.first, !key.isEmpty else { return nil }
        return (key, Array(parts.dropFirst()))
    }

    static func store(_ id: String, key: String, modifiers: [String]) {
        UserDefaults.standard.set(([key] + modifiers).joined(separator: "|"), forKey: storageKey(id))
    }

    static func resetAll() {
        for definition in definitions {
            UserDefaults.standard.removeObject(forKey: storageKey(definition.id))
        }
    }

    static func effective(_ id: String) -> (key: String, modifiers: [String]) {
        if let stored = stored(id) { return stored }
        guard let definition = definitions.first(where: { $0.id == id }) else { return ("", []) }
        return (definition.key, definition.modifiers)
    }

    /// Live shortcut for `.keyboardShortcut(_:)` call sites.
    static func shortcut(_ id: String) -> KeyboardShortcut {
        let (key, modifiers) = effective(id)
        return KeyboardShortcut(keyEquivalent(key), modifiers: eventModifiers(modifiers))
    }

    static func keycaps(_ id: String) -> [String] {
        let (key, modifiers) = effective(id)
        return modifiers.compactMap { modifierSymbols[$0] } + [keySymbol(key)]
    }

    private static let modifierSymbols: [String: String] = [
        "cmd": "⌘", "shift": "⇧", "option": "⌥", "control": "⌃"
    ]

    private static func keySymbol(_ key: String) -> String {
        switch key {
        case "return": return "↵"
        case "delete": return "⌫"
        case "escape": return "ESC"
        case "space": return "SPACE"
        case "left": return "←"
        case "right": return "→"
        case "up": return "↑"
        case "down": return "↓"
        default: return key.uppercased()
        }
    }

    private static func keyEquivalent(_ key: String) -> KeyEquivalent {
        switch key {
        case "return": return .return
        case "delete": return .delete
        case "escape": return .escape
        case "space": return .space
        case "left": return .leftArrow
        case "right": return .rightArrow
        case "up": return .upArrow
        case "down": return .downArrow
        default: return KeyEquivalent(Character(key.lowercased()))
        }
    }

    private static func eventModifiers(_ modifiers: [String]) -> EventModifiers {
        var result: EventModifiers = []
        if modifiers.contains("cmd") { result.insert(.command) }
        if modifiers.contains("shift") { result.insert(.shift) }
        if modifiers.contains("option") { result.insert(.option) }
        if modifiers.contains("control") { result.insert(.control) }
        return result
    }

    /// Translate a captured key event into storable (key, modifiers);
    /// nil when the event has no usable key.
    static func capture(from event: NSEvent) -> (key: String, modifiers: [String])? {
        var modifiers: [String] = []
        if event.modifierFlags.contains(.command) { modifiers.append("cmd") }
        if event.modifierFlags.contains(.shift) { modifiers.append("shift") }
        if event.modifierFlags.contains(.option) { modifiers.append("option") }
        if event.modifierFlags.contains(.control) { modifiers.append("control") }

        switch event.keyCode {
        case 36: return ("return", modifiers)
        case 51: return ("delete", modifiers)
        case 49: return ("space", modifiers)
        case 123: return ("left", modifiers)
        case 124: return ("right", modifiers)
        case 125: return ("down", modifiers)
        case 126: return ("up", modifiers)
        case 53: return nil // Escape cancels recording
        default:
            guard let chars = event.charactersIgnoringModifiers?.lowercased(),
                  let first = chars.first, first.isLetter || first.isNumber
            else { return nil }
            return (String(first), modifiers)
        }
    }
}
