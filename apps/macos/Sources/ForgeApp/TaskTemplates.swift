import SwiftUI

/// `36a` task templates: prefilled task text with placeholders and baked-in
/// presets. Stored locally (UserDefaults JSON); templates only prefill the
/// composer — the plan gate still applies to every run.
struct ForgeTaskTemplate: Identifiable, Codable, Hashable {
    var id: String
    var name: String
    var glyph: String
    var summary: String
    var prompt: String
    var effort: String
    var guardrailsNote: String
    var runTaskIDs: [String] = []
    var lastRunAt: Date?

    var runs: Int { runTaskIDs.count }
}

enum TaskTemplateStore {
    private static let key = "forge.taskTemplates"

    static let seeds: [ForgeTaskTemplate] = [
        ForgeTaskTemplate(
            id: "dep-upgrade", name: "DEP UPGRADE", glyph: "⬆",
            summary: "bump one dependency, run the full check suite, summarize breaking changes",
            prompt: "Upgrade {dependency} to {version}, run every approved validation preset, and summarize any breaking-change risk before proposing edits.",
            effort: "STANDARD", guardrailsNote: "asks before new dependencies"
        ),
        ForgeTaskTemplate(
            id: "flaky-test", name: "FLAKY TEST", glyph: "🎲",
            summary: "reproduce a flaky test, isolate the race, fix it without weakening the assertion",
            prompt: "Fix the flaky test {test_path}: reproduce the failure, isolate the root cause, and repair it without deleting or weakening the assertion.",
            effort: "STANDARD", guardrailsNote: "tests must pass before review"
        ),
        ForgeTaskTemplate(
            id: "input-validation", name: "INPUT GUARD", glyph: "🛡",
            summary: "add input validation to an endpoint with tests for the rejection paths",
            prompt: "Add input validation to {endpoint}: validate required fields and types, return structured errors, and add tests covering each rejection path.",
            effort: "LOW", guardrailsNote: "review gate on every file"
        ),
        ForgeTaskTemplate(
            id: "lint-sweep", name: "LINT SWEEP", glyph: "🧹",
            summary: "upgrade the linter, fix new warnings, keep the diff mechanical",
            prompt: "Upgrade {linter} and fix every new warning it reports. Keep changes mechanical — no behavior edits without flagging them.",
            effort: "LOW", guardrailsNote: "mechanical-only edits flagged"
        )
    ]

    static func load() -> [ForgeTaskTemplate] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let stored = try? JSONDecoder().decode([ForgeTaskTemplate].self, from: data)
        else { return seeds }
        return stored
    }

    static func save(_ templates: [ForgeTaskTemplate]) {
        if let data = try? JSONEncoder().encode(templates) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}

struct TaskTemplatesLibraryView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var close: () -> Void
    var useTemplate: (String) -> Void

    @State private var templates = TaskTemplateStore.load()
    @State private var selectedID: String?
    @State private var search = ""
    @State private var editing = false
    @State private var draftName = ""
    @State private var draftPrompt = ""
    @State private var draftSummary = ""

    private var filtered: [ForgeTaskTemplate] {
        let trimmed = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty else { return templates }
        return templates.filter {
            $0.name.lowercased().contains(trimmed) || $0.summary.lowercased().contains(trimmed)
        }
    }

    private var selected: ForgeTaskTemplate? {
        filtered.first { $0.id == selectedID } ?? filtered.first
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                ForgeLogo(size: 18)
                Text("FORGE — TEMPLATES")
                    .font(ForgeDesign.mono(12, weight: .bold))
                    .tracking(0.5)
                Spacer()
                Text(ForgeDesign.appVersion)
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
                Button("CLOSE", action: close)
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .buttonStyle(.plain)
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 16)
            .frame(height: 44)
            .background(Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255))
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            HStack(spacing: 0) {
                gridColumn
                    .frame(maxWidth: .infinity)
                Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
                detailColumn
                    .frame(width: 420)
            }
        }
        .background(ForgeDesign.paper)
    }

    private var gridColumn: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                HStack(spacing: 8) {
                    Text("⌕")
                        .font(ForgeDesign.mono(11))
                        .foregroundStyle(ForgeDesign.muted)
                    TextField("search templates", text: $search)
                        .textFieldStyle(.plain)
                        .font(ForgeDesign.mono(11))
                }
                .padding(.horizontal, 12)
                .frame(height: 34)
                .frame(maxWidth: 260)
                .background(Color.white)
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

                Text("\(templates.count) template\(templates.count == 1 ? "" : "s") · \(totalRuns) runs total")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)

                Spacer()

                Button {
                    startNewTemplate()
                } label: {
                    Text("＋ NEW TEMPLATE")
                        .font(ForgeDesign.mono(10, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(ForgeDesign.accent)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(ForgeDesign.ink)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 13)
            .background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible())], spacing: 14) {
                    ForEach(filtered) { template in
                        templateCard(template)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 18)
            }

            Text("▸ templates are just prefilled task text — the plan gate still applies to every run")
                .font(ForgeDesign.mono(9.5))
                .foregroundStyle(ForgeDesign.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.vertical, 12)
                .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
        }
    }

    private func templateCard(_ template: ForgeTaskTemplate) -> some View {
        let isSelected = selected?.id == template.id
        return Button {
            selectedID = template.id
            editing = false
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 9) {
                    Text(template.glyph)
                        .font(ForgeDesign.mono(12, weight: .heavy))
                        .frame(width: 26, height: 26)
                        .background(isSelected ? ForgeDesign.accent : ForgeDesign.paper)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    Text(template.name)
                        .font(ForgeDesign.mono(11.5, weight: .heavy))
                        .tracking(0.3)
                }
                Text(template.summary)
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(ForgeDesign.muted)
                    .lineSpacing(3)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) {
                    Text("\(template.runs) runs")
                    Text("·")
                    Text(template.lastRunAt.map(Self.relative) ?? "never run")
                    Spacer()
                    Text(template.effort)
                        .fontWeight(.bold)
                        .foregroundStyle(ForgeDesign.accent)
                }
                .font(ForgeDesign.mono(8.5))
                .foregroundStyle(ForgeDesign.dashedBorder)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(isSelected ? Color(red: 247 / 255, green: 242 / 255, blue: 255 / 255) : Color.white)
            .overlay(Rectangle().stroke(isSelected ? ForgeDesign.ink : ForgeDesign.divider, lineWidth: 1.5))
            .forgeShadow(isSelected ? ForgeDesign.ink : .clear, x: 4, y: 4)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var detailColumn: some View {
        if editing {
            editorPane
        } else if let template = selected {
            detailPane(template)
        } else {
            VStack {
                Spacer()
                Text("No template selected")
                    .font(ForgeDesign.mono(11))
                    .foregroundStyle(ForgeDesign.muted)
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .background(Color.white)
        }
    }

    private func detailPane(_ template: ForgeTaskTemplate) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("TEMPLATE")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                Text(template.name)
                    .font(ForgeDesign.mono(12, weight: .heavy))
                Spacer()
                Text("\(template.runs) runs · last \(template.lastRunAt.map(Self.relative) ?? "—")")
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(ForgeDesign.dashedBorder)
            }
            .padding(.horizontal, 20)
            .frame(height: 44)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 9) {
                        Text("TASK TEXT — FILL THE BLANKS")
                            .font(ForgeDesign.mono(9, weight: .bold))
                            .tracking(1)
                            .foregroundStyle(ForgeDesign.muted)
                        promptPreview(template.prompt)
                            .padding(13)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("PRESETS BAKED IN")
                            .font(ForgeDesign.mono(9, weight: .bold))
                            .tracking(1)
                            .foregroundStyle(ForgeDesign.muted)
                        presetRow("model", workspace.runtimeHealth?.modelProvider?.model ?? "local-deterministic-v0")
                        presetRow("effort", template.effort)
                        presetRow("guardrails", template.guardrailsNote)
                        presetRow("repo", repoName)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("RECENT RUNS")
                            .font(ForgeDesign.mono(9, weight: .bold))
                            .tracking(1)
                            .foregroundStyle(ForgeDesign.muted)
                        if recentRuns(for: template).isEmpty {
                            Text("no runs yet — USE TEMPLATE prefills the composer")
                                .font(ForgeDesign.mono(10))
                                .foregroundStyle(ForgeDesign.dashedBorder)
                        } else {
                            ForEach(recentRuns(for: template), id: \.id) { task in
                                HStack(spacing: 10) {
                                    Text(runMark(task))
                                        .fontWeight(.bold)
                                        .foregroundStyle(runColor(task))
                                    Text(task.title)
                                        .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                                        .lineLimit(1)
                                    Spacer()
                                    Text(Self.relative(Self.parseISO(task.createdAt) ?? Date()))
                                        .foregroundStyle(ForgeDesign.dashedBorder)
                                }
                                .font(ForgeDesign.mono(10))
                                .padding(.vertical, 6)
                                .overlay(alignment: .bottom) {
                                    Rectangle().fill(Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255)).frame(height: 1.5)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                }
            }
            .background(Color.white)

            HStack(spacing: 10) {
                Button {
                    var updated = template
                    updated.lastRunAt = Date()
                    replace(updated)
                    useTemplate(template.prompt)
                } label: {
                    Text("▸ USE TEMPLATE")
                        .font(ForgeDesign.mono(11, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(ForgeDesign.accent)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(ForgeDesign.ink)
                        .forgeShadow(ForgeDesign.ink.opacity(0.35), x: 4, y: 4)
                }
                .buttonStyle(.plain)

                Button {
                    startEditing(template)
                } label: {
                    Text("✎ EDIT")
                        .font(ForgeDesign.mono(10, weight: .bold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .background(Color.white)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                }
                .buttonStyle(.plain)

                Spacer()

                Button {
                    templates.removeAll { $0.id == template.id }
                    TaskTemplateStore.save(templates)
                    selectedID = templates.first?.id
                } label: {
                    Text("DELETE")
                        .font(ForgeDesign.mono(10, weight: .semibold))
                        .foregroundStyle(ForgeDesign.danger)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 11)
                        .background(Color.white)
                        .overlay(Rectangle().stroke(Color(red: 204 / 255, green: 202 / 255, blue: 194 / 255), lineWidth: 1.5))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(Color.white)
            .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
        }
    }

    private var editorPane: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(draftIsNew ? "NEW TEMPLATE" : "EDIT TEMPLATE")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                Spacer()
            }
            .padding(.horizontal, 20)
            .frame(height: 44)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            VStack(alignment: .leading, spacing: 14) {
                editorField("NAME", text: $draftName, mono: true)
                editorField("SUMMARY", text: $draftSummary, mono: false)
                VStack(alignment: .leading, spacing: 6) {
                    Text("TASK TEXT — use {placeholders} for the blanks")
                        .font(ForgeDesign.mono(9, weight: .bold))
                        .tracking(1)
                        .foregroundStyle(ForgeDesign.muted)
                    TextEditor(text: $draftPrompt)
                        .font(ForgeDesign.mono(11))
                        .scrollContentBackground(.hidden)
                        .padding(8)
                        .frame(height: 130)
                        .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                }
            }
            .padding(20)

            Spacer()

            HStack(spacing: 10) {
                Button {
                    saveDraft()
                } label: {
                    Text("SAVE TEMPLATE")
                        .font(ForgeDesign.mono(10, weight: .bold))
                        .foregroundStyle(ForgeDesign.accent)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .background(ForgeDesign.ink)
                }
                .buttonStyle(.plain)
                .disabled(draftName.trimmingCharacters(in: .whitespaces).isEmpty || draftPrompt.trimmingCharacters(in: .whitespaces).isEmpty)

                Button {
                    editing = false
                } label: {
                    Text("CANCEL")
                        .font(ForgeDesign.mono(10, weight: .bold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .background(Color.white)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
        }
        .background(Color.white)
    }

    private func editorField(_ label: String, text: Binding<String>, mono: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(ForgeDesign.mono(9, weight: .bold))
                .tracking(1)
                .foregroundStyle(ForgeDesign.muted)
            TextField("", text: text)
                .textFieldStyle(.plain)
                .font(mono ? ForgeDesign.mono(12, weight: .bold) : .system(size: 12))
                .padding(.horizontal, 10)
                .frame(height: 34)
                .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        }
    }

    /// Render {placeholder} spans as accent-highlighted chips.
    private func promptPreview(_ prompt: String) -> Text {
        var result = Text("")
        var rest = prompt[...]
        while let open = rest.firstIndex(of: "{"), let closeIdx = rest[open...].firstIndex(of: "}") {
            result = result + Text(String(rest[..<open]))
            let token = String(rest[rest.index(after: open)..<closeIdx])
            result = result
                + Text("⟦\(token)⟧")
                .foregroundStyle(ForgeDesign.accent)
                .fontWeight(.heavy)
            rest = rest[rest.index(after: closeIdx)...]
        }
        result = result + Text(String(rest))
        return result
            .font(ForgeDesign.mono(11.5))
            .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
    }

    private func presetRow(_ label: String, _ value: String) -> some View {
        HStack(spacing: 10) {
            Text(label)
                .foregroundStyle(ForgeDesign.muted)
                .frame(width: 84, alignment: .leading)
            Text(value)
                .fontWeight(.bold)
            Spacer()
        }
        .font(ForgeDesign.mono(10.5))
    }

    private var repoName: String {
        workspace.runtimeHealth?.workspace?.repoRoot.split(separator: "/").last.map(String.init) ?? "current workspace"
    }

    private var totalRuns: Int { templates.reduce(0) { $0 + $1.runs } }

    private func recentRuns(for template: ForgeTaskTemplate) -> [ForgeTask] {
        workspace.tasks
            .filter { template.runTaskIDs.contains($0.id) }
            .sorted { $0.createdAt > $1.createdAt }
            .prefix(3)
            .map { $0 }
    }

    private func runMark(_ task: ForgeTask) -> String {
        task.status == "Completed" ? "✓" : task.status == "Failed" ? "✗" : "⏸"
    }
    private func runColor(_ task: ForgeTask) -> Color {
        task.status == "Completed" ? ForgeDesign.success : task.status == "Failed" ? ForgeDesign.danger : ForgeDesign.warning
    }

    private var draftIsNew: Bool { selected.map { $0.id != selectedID } ?? true }

    private func startNewTemplate() {
        draftName = ""
        draftSummary = ""
        draftPrompt = ""
        selectedID = nil
        editing = true
    }

    private func startEditing(_ template: ForgeTaskTemplate) {
        draftName = template.name
        draftSummary = template.summary
        draftPrompt = template.prompt
        selectedID = template.id
        editing = true
    }

    private func saveDraft() {
        let name = draftName.trimmingCharacters(in: .whitespaces).uppercased()
        if let selectedID, var existing = templates.first(where: { $0.id == selectedID }) {
            existing.name = name
            existing.summary = draftSummary
            existing.prompt = draftPrompt
            replace(existing)
        } else {
            let template = ForgeTaskTemplate(
                id: UUID().uuidString, name: name, glyph: "✚",
                summary: draftSummary, prompt: draftPrompt,
                effort: "STANDARD", guardrailsNote: "plan gate applies"
            )
            templates.append(template)
            TaskTemplateStore.save(templates)
            selectedID = template.id
        }
        editing = false
    }

    private func replace(_ template: ForgeTaskTemplate) {
        if let index = templates.firstIndex(where: { $0.id == template.id }) {
            templates[index] = template
            TaskTemplateStore.save(templates)
        }
    }

    static func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    static func parseISO(_ value: String) -> Date? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return parser.date(from: value)
    }
}
