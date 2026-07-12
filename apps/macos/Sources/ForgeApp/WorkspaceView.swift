import SwiftUI

private enum ForgeDesign {
    static let paper = Color(red: 244 / 255, green: 244 / 255, blue: 241 / 255)
    static let ink = Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255)
    static let muted = Color(red: 106 / 255, green: 106 / 255, blue: 100 / 255)
    static let border = Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255)
    static let divider = Color(red: 226 / 255, green: 225 / 255, blue: 220 / 255)
    static let accent = Color(red: 166 / 255, green: 116 / 255, blue: 255 / 255)
    static let warning = Color(red: 254 / 255, green: 188 / 255, blue: 46 / 255)
    static let success = Color(red: 40 / 255, green: 200 / 255, blue: 64 / 255)
    static let danger = Color(red: 192 / 255, green: 57 / 255, blue: 43 / 255)

    static var mono: Font {
        .system(.caption, design: .monospaced)
    }
}

private extension View {
    func forgeCard(shadow: Bool = true) -> some View {
        self
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.border, lineWidth: 1.5))
            .shadow(color: shadow ? ForgeDesign.ink : .clear, radius: 0, x: 4, y: 4)
    }

    func forgeTerminal() -> some View {
        self
            .background(ForgeDesign.ink)
            .overlay(Rectangle().stroke(ForgeDesign.border, lineWidth: 1.5))
    }
}

private struct ForgePrimaryButtonStyle: ButtonStyle {
    var fill: Color = ForgeDesign.ink
    var foreground: Color = ForgeDesign.paper

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.caption, design: .monospaced).weight(.bold))
            .textCase(.uppercase)
            .foregroundStyle(foreground)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(fill)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            .shadow(color: ForgeDesign.ink, radius: 0, x: configuration.isPressed ? 1 : 3, y: configuration.isPressed ? 1 : 3)
            .offset(x: configuration.isPressed ? 2 : 0, y: configuration.isPressed ? 2 : 0)
    }
}

private struct ForgeSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.caption, design: .monospaced).weight(.bold))
            .textCase(.uppercase)
            .foregroundStyle(ForgeDesign.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            .offset(x: configuration.isPressed ? 1 : 0, y: configuration.isPressed ? 1 : 0)
    }
}

private enum SessionTab: String, CaseIterable, Identifiable {
    case log = "LOG"
    case diff = "DIFF"
    case tests = "TESTS"

    var id: String { rawValue }
}

private enum DiffReviewMode: String, CaseIterable, Identifiable {
    case unified = "UNIFIED"
    case split = "SPLIT"

    var id: String { rawValue }
}

private struct DiffReviewFile: Identifiable, Hashable {
    var id: String { path }
    var path: String
    var status: String
    var detail: String
    var additions: Int?
    var deletions: Int?
    var rationale: String?
    var validationStatus: String?
}

struct WorkspaceView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 250, ideal: 300)
        } detail: {
            ZStack {
                ForgeDesign.paper.ignoresSafeArea()
                if let task = workspace.selectedTask {
                    TaskWorkspaceView(task: task)
                } else {
                    NewTaskEmptyState()
                }
            }
        }
        .toolbar {
            ToolbarItemGroup {
                Button {
                    workspace.startRuntimeProcess()
                } label: {
                    Label("Start Runtime", systemImage: "play.circle")
                }
                .disabled(!workspace.canStartRuntimeProcess)

                Button {
                    workspace.stopRuntimeProcess()
                } label: {
                    Label("Stop Runtime", systemImage: "stop.circle")
                }
                .disabled(!workspace.canStopRuntimeProcess)

                Button {
                    workspace.refreshRuntimeHealth()
                } label: {
                    Label("Check Runtime", systemImage: "bolt.horizontal.circle")
                }

                Button {
                    workspace.createDemoTask()
                } label: {
                    Label("Start Demo Agent", systemImage: "play.circle")
                }
            }
        }
        .onChange(of: workspace.selectedTaskID) { _, taskID in
            workspace.refreshValidationPermissions(for: taskID)
        }
    }
}

private struct SidebarView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .lastTextBaseline) {
                Text("FORGE")
                    .font(.system(size: 22, weight: .black, design: .monospaced))
                Spacer()
                Text("AGENT")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(ForgeDesign.accent)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            }
            .padding(.horizontal, 14)
            .padding(.top, 16)

            RuntimeBadge()
                .padding(.horizontal, 14)

            TaskComposer()
                .padding(.horizontal, 14)

            List(selection: $workspace.selectedTaskID) {
                Section("TASK QUEUE") {
                    ForEach(workspace.tasks) { task in
                        TaskRow(task: task)
                            .tag(task.id)
                    }
                }
            }
            .listStyle(.sidebar)
        }
        .background(ForgeDesign.paper)
    }
}

private struct RuntimeBadge: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: runtimeSystemImage)
                    .foregroundStyle(runtimeColor)
                Text(workspace.runtimeState.rawValue)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
                Spacer()
                if let version = workspace.runtimeHealth?.version {
                    Text(version)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            Text(runtimeDetail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            Label(workspace.runtimeEndpoint, systemImage: "network")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(1)

            Label(streamDetail, systemImage: streamSystemImage)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Label(processDetail, systemImage: processSystemImage)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            HStack(spacing: 8) {
                Button {
                    workspace.startRuntimeProcess()
                } label: {
                    Label("Start", systemImage: "play.fill")
                }
                .disabled(!workspace.canStartRuntimeProcess)
                .help("Start app-managed runtime")

                Button {
                    workspace.stopRuntimeProcess()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                }
                .disabled(!workspace.canStopRuntimeProcess)
                .help("Stop app-managed runtime")

                Button {
                    workspace.refreshRuntimeHealth()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .help("Refresh runtime health")

                Button {
                    workspace.openRuntimeStatusPage()
                } label: {
                    Label("Open", systemImage: "safari")
                }
                .help("Open runtime status page")

                Button {
                    workspace.copyRuntimeDiagnostics()
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }
                .help("Copy runtime diagnostics")
            }
            .labelStyle(.iconOnly)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .forgeCard(shadow: false)
    }

    private var runtimeDetail: String {
        switch workspace.runtimeState {
        case .unchecked:
            return "Runtime has not been checked."
        case .checking:
            return "Checking the expected local runtime."
        case .running:
            return workspace.statusMessage
        case .needsProviderConfiguration:
            return providerIssue ?? "Runtime is reachable, but provider setup needs attention."
        case .wrongVersion:
            return "Expected \(WorkspaceModel.expectedRuntimeService) \(WorkspaceModel.expectedRuntimeVersion)."
        case .disconnected:
            return workspace.runtimeLastError ?? "Runtime did not respond on the expected endpoint."
        }
    }

    private var providerIssue: String? {
        workspace.modelProviderSettingsEnvelope?.configuration.issues.first ??
            workspace.runtimeHealth?.modelProviderConfiguration?.issues.first
    }

    private var streamDetail: String {
        "\(workspace.eventStreamState.rawValue) · \(workspace.eventStreamStatus)"
    }

    private var processDetail: String {
        "\(workspace.runtimeProcessState.rawValue) · \(workspace.runtimeProcessMessage)"
    }

    private var runtimeSystemImage: String {
        switch workspace.runtimeState {
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

    private var runtimeColor: Color {
        switch workspace.runtimeState {
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

    private var streamSystemImage: String {
        switch workspace.eventStreamState {
        case .connected:
            return "dot.radiowaves.left.and.right"
        case .connecting:
            return "antenna.radiowaves.left.and.right"
        case .disconnected:
            return "wifi.slash"
        }
    }

    private var processSystemImage: String {
        switch workspace.runtimeProcessState {
        case .notStarted:
            return "power"
        case .starting:
            return "hourglass"
        case .running:
            return "play.circle.fill"
        case .external:
            return "network"
        case .stopping:
            return "stopwatch"
        case .stopped:
            return "stop.circle"
        case .failed:
            return "exclamationmark.triangle.fill"
        }
    }
}

private struct TaskComposer: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @State private var title = ""
    @State private var objective = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("NEW TASK")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)

            TextField("Short title", text: $title)
                .textFieldStyle(.roundedBorder)

            TextField("What should Forge build?", text: $objective, axis: .vertical)
                .lineLimit(3...5)
                .textFieldStyle(.roundedBorder)

            Button {
                workspace.createTask(title: resolvedTitle, objective: resolvedObjective)
            } label: {
                Label("Start Task", systemImage: "sparkles")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgePrimaryButtonStyle())
            .disabled(resolvedObjective.isEmpty)
        }
        .padding(10)
        .forgeCard()
    }

    private var resolvedObjective: String {
        objective.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var resolvedTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return trimmed
        }
        return String(resolvedObjective.prefix(54))
    }
}

private struct TaskRow: View {
    var task: ForgeTask

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                    .lineLimit(2)
                Text(task.currentPhase.uppercased())
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
            }
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch task.status {
        case "Completed":
            return ForgeDesign.success
        case "Failed":
            return ForgeDesign.danger
        case "Human Review":
            return ForgeDesign.warning
        case "Running", "Testing":
            return ForgeDesign.accent
        default:
            return ForgeDesign.muted
        }
    }
}

private struct TaskWorkspaceView: View {
    var task: ForgeTask
    @State private var selectedTab: SessionTab = .log
    @State private var showDiffReview = false

    var body: some View {
        VStack(spacing: 14) {
            TaskHeader(task: task)

            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 12) {
                    PlanProgressStrip(task: task)
                    LiveAgentStream(task: task)
                    SessionTabs(selectedTab: $selectedTab, task: task)
                    SessionTabContent(
                        tab: selectedTab,
                        task: task,
                        openDiffReview: {
                            showDiffReview = true
                        }
                    )
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

                SessionDecisionRail(
                    task: task,
                    openDiffReview: {
                        showDiffReview = true
                    }
                )
                    .frame(width: 330)
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .padding(18)
        .background(ForgeDesign.paper)
        .sheet(isPresented: $showDiffReview) {
            FullscreenDiffReview(task: task)
                .frame(minWidth: 1180, minHeight: 760)
        }
    }
}

private struct TaskHeader: View {
    var task: ForgeTask

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("CURRENT TASK")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)

                Text(task.title)
                    .font(.system(size: 24, weight: .black, design: .default))
                    .lineLimit(1)

                Text(task.objective)
                    .font(.callout)
                    .foregroundStyle(ForgeDesign.muted)
                    .lineLimit(2)
            }

            Spacer()

            StatusPill(label: task.status, color: statusColor)
            StatusPill(label: task.currentPhase, color: ForgeDesign.paper, foreground: ForgeDesign.ink)

            Button {} label: {
                Label("Pause", systemImage: "pause.fill")
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(true)

            Button {} label: {
                Label("Abort", systemImage: "xmark")
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(true)
        }
        .padding(14)
        .forgeCard()
    }

    private var statusColor: Color {
        switch task.status {
        case "Completed":
            return ForgeDesign.success
        case "Failed":
            return ForgeDesign.danger
        case "Human Review":
            return ForgeDesign.warning
        case "Running", "Testing":
            return ForgeDesign.accent
        default:
            return Color.white
        }
    }
}

private struct NewTaskEmptyState: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @State private var prompt = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Spacer(minLength: 20)

            Text("What should Forge build?")
                .font(.system(size: 34, weight: .black))

            Text("Start with a coding task. Forge will turn it into a plan, stop for approval, then make the work reviewable.")
                .font(.title3)
                .foregroundStyle(ForgeDesign.muted)
                .frame(maxWidth: 720, alignment: .leading)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Example: Add a source patch engine with rollback metadata", text: $prompt, axis: .vertical)
                    .lineLimit(5...8)
                    .font(.system(size: 15, design: .monospaced))
                    .textFieldStyle(.plain)
                    .padding(12)
                    .background(Color.white)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

                HStack {
                    Button {
                        workspace.createTask(title: title, objective: objective)
                    } label: {
                        Label("Create Task", systemImage: "arrow.right")
                    }
                    .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
                    .disabled(objective.isEmpty)

                    Text("Plan approval is still required before file changes.")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(ForgeDesign.muted)
                }
            }
            .frame(maxWidth: 760)
            .forgeCard()

            HStack(spacing: 10) {
                ExampleTaskButton(title: "Refactor WorkspaceView into live session") {
                    prompt = "Refactor the macOS WorkspaceView so the main task screen shows a live agent coding stream, Log/Diff/Tests tabs, and a compact plan approval rail."
                }
                ExampleTaskButton(title: "Add patch rollback metadata") {
                    prompt = "Add rollback metadata to source-file patch proposals and show the rollback boundary in review."
                }
                ExampleTaskButton(title: "Stream validation output") {
                    prompt = "Add streamed output for approved task-scoped validation commands and show it in the Tests tab."
                }
            }

            Spacer()
        }
        .padding(36)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var objective: String {
        prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var title: String {
        String(objective.prefix(60))
    }
}

private struct ExampleTaskButton: View {
    var title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title.uppercased())
                .lineLimit(2)
        }
        .buttonStyle(ForgeSecondaryButtonStyle())
    }
}

private struct StatusPill: View {
    var label: String
    var color: Color
    var foreground: Color = ForgeDesign.ink

    var body: some View {
        Text(label.uppercased())
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundStyle(foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(color)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }
}

private struct PlanProgressStrip: View {
    var task: ForgeTask

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("PLAN PROGRESS")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
                Spacer()
                Text("\(doneCount)/\(max(task.planSteps.count, 1)) STEPS")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Rectangle()
                        .fill(Color.white)
                    Rectangle()
                        .fill(ForgeDesign.accent)
                        .frame(width: proxy.size.width * progress)
                }
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            }
            .frame(height: 18)

            HStack(spacing: 6) {
                ForEach(task.planSteps.prefix(6)) { step in
                    Text(step.status.uppercased())
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(stepColor(step.status))
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1))
                }
            }
        }
        .padding(12)
        .forgeCard(shadow: false)
    }

    private var doneCount: Int {
        task.planSteps.filter { $0.status == "Done" }.count
    }

    private var progress: CGFloat {
        guard !task.planSteps.isEmpty else {
            return 0
        }
        return CGFloat(doneCount) / CGFloat(task.planSteps.count)
    }

    private func stepColor(_ status: String) -> Color {
        switch status {
        case "Done":
            return ForgeDesign.success
        case "Active":
            return ForgeDesign.accent
        case "Blocked":
            return ForgeDesign.warning
        default:
            return Color.white
        }
    }
}

private struct LiveAgentStream: View {
    var task: ForgeTask

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("LIVE AGENT STREAM")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.paper)
                Spacer()
                Text(task.currentPhase.uppercased())
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.accent)
            }
            .padding(10)
            .background(Color(red: 26 / 255, green: 26 / 255, blue: 23 / 255))

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(streamRows) { row in
                        HStack(alignment: .top, spacing: 10) {
                            Text(row.time)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(Color.gray)
                                .frame(width: 72, alignment: .leading)
                            Text(row.kind)
                                .font(.system(size: 10, weight: .bold, design: .monospaced))
                                .foregroundStyle(row.color)
                                .frame(width: 92, alignment: .leading)
                            Text(row.message)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(ForgeDesign.paper)
                                .textSelection(.enabled)
                            Spacer(minLength: 0)
                        }
                    }

                    HStack(spacing: 8) {
                        Text("now")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(Color.gray)
                            .frame(width: 72, alignment: .leading)
                        Text("CURSOR")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(ForgeDesign.accent)
                            .frame(width: 92, alignment: .leading)
                        Rectangle()
                            .fill(ForgeDesign.accent)
                            .frame(width: 8, height: 14)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minHeight: 300, maxHeight: 430)
        .forgeTerminal()
    }

    private var streamRows: [AgentStreamRow] {
        var rows: [AgentStreamRow] = []

        rows.append(AgentStreamRow(kind: "TASK", message: task.objective, color: ForgeDesign.accent, time: shortTime(task.createdAt)))

        for message in task.messages.suffix(4) {
            rows.append(AgentStreamRow(kind: message.role.uppercased(), message: message.intentBrief?.summary ?? message.content, color: message.role == "User" ? ForgeDesign.paper : ForgeDesign.warning, time: shortTime(message.createdAt)))
        }

        for call in task.toolCalls.suffix(6) {
            rows.append(AgentStreamRow(kind: call.name.uppercased(), message: call.outputSummary, color: toolColor(call.status), time: shortTime(call.startedAt)))
        }

        for event in task.events.suffix(7) {
            rows.append(AgentStreamRow(kind: event.type.uppercased(), message: event.message, color: ForgeDesign.paper, time: shortTime(event.createdAt)))
        }

        if rows.count == 1 {
            rows.append(AgentStreamRow(kind: "WAITING", message: "Connect runtime or approve the next plan gate to start visible agent work.", color: ForgeDesign.warning, time: "local"))
        }

        return Array(rows.suffix(14))
    }

    private func toolColor(_ status: String) -> Color {
        switch status {
        case "Completed":
            return ForgeDesign.success
        case "Failed":
            return ForgeDesign.danger
        default:
            return ForgeDesign.accent
        }
    }

    private func shortTime(_ value: String) -> String {
        if value.count > 8 {
            return String(value.suffix(8))
        }
        return value
    }
}

private struct AgentStreamRow: Identifiable {
    let id = UUID()
    var kind: String
    var message: String
    var color: Color
    var time: String
}

private struct SessionTabs: View {
    @Binding var selectedTab: SessionTab
    var task: ForgeTask

    var body: some View {
        HStack(spacing: 0) {
            ForEach(SessionTab.allCases) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    Text(label(for: tab))
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(selectedTab == tab ? ForgeDesign.paper : ForgeDesign.ink)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(selectedTab == tab ? ForgeDesign.ink : Color.white)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func label(for tab: SessionTab) -> String {
        switch tab {
        case .log:
            return "LOG \(task.events.count)"
        case .diff:
            return "DIFF \(diffCount)"
        case .tests:
            return "TESTS \(task.validationRuns.count)"
        }
    }

    private var diffCount: Int {
        max(task.changedFiles.count, task.editProposal?.fileChanges.count ?? 0)
    }
}

private struct SessionTabContent: View {
    var tab: SessionTab
    var task: ForgeTask
    var openDiffReview: () -> Void

    var body: some View {
        Group {
            switch tab {
            case .log:
                AgentLogTab(task: task)
            case .diff:
                AgentDiffTab(task: task, openDiffReview: openDiffReview)
            case .tests:
                AgentTestsTab(task: task)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

private struct AgentLogTab: View {
    var task: ForgeTask

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                TaskConversationPanel(task: task)
                ContextPanel(task: task)
                ToolCallPanel(task: task)
                EventPanel(task: task)
            }
            .padding(14)
        }
        .forgeCard(shadow: false)
    }
}

private struct AgentDiffTab: View {
    var task: ForgeTask
    var openDiffReview: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                DiffReviewSummary(task: task, openDiffReview: openDiffReview)
                GitWorkingTreeCard(task: task)
            }
            .padding(14)
        }
        .forgeCard(shadow: false)
    }
}

private struct DiffReviewSummary: View {
    var task: ForgeTask
    var openDiffReview: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("DIFF REVIEW")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(ForgeDesign.muted)
                    Spacer()
                    Button {
                        openDiffReview()
                    } label: {
                        Label("Open Full Diff", systemImage: "rectangle.expand.vertical")
                    }
                    .buttonStyle(ForgeSecondaryButtonStyle())
                    .disabled(diffFiles.isEmpty)
                }

                if diffFiles.isEmpty {
                    Text("No diff is ready yet. Approve the plan, generate an edit proposal, then inspect changed files here.")
                        .foregroundStyle(ForgeDesign.muted)
                } else {
                    ForEach(diffFiles, id: \.self) { file in
                        HStack {
                            Text(file)
                                .font(.system(.caption, design: .monospaced))
                                .lineLimit(1)
                            Spacer()
                            Text("REVIEW")
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .foregroundStyle(ForgeDesign.muted)
                        }
                        .padding(8)
                        .background(Color.white)
                        .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 8) {
                Text("WHY THIS CHANGE")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
                Text(task.editProposal?.summary ?? task.reviewSummary ?? "Forge will explain the reasoning for each changed file here once a proposal exists.")
                    .font(.callout)
                    .foregroundStyle(ForgeDesign.ink)
                    .textSelection(.enabled)
            }
            .frame(width: 260, alignment: .leading)
            .padding(10)
            .background(ForgeDesign.paper)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        }
    }

    private var diffFiles: [String] {
        let proposalPaths = task.editProposal?.fileChanges.map(\.path) ?? []
        return Array(Set(task.changedFiles + proposalPaths)).sorted()
    }
}

private struct FullscreenDiffReview: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @Environment(\.dismiss) private var dismiss

    var task: ForgeTask

    @State private var selectedPath: String?
    @State private var mode: DiffReviewMode = .unified

    var body: some View {
        VStack(spacing: 0) {
            header

            HStack(spacing: 0) {
                fileTree
                    .frame(width: 275)

                Rectangle()
                    .fill(ForgeDesign.ink)
                    .frame(width: 1.5)

                diffPane
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                Rectangle()
                    .fill(ForgeDesign.ink)
                    .frame(width: 1.5)

                reasoningPane
                    .frame(width: 330)
            }
            .frame(maxHeight: .infinity)
        }
        .background(ForgeDesign.paper)
        .onAppear {
            if workspace.gitStatus == nil {
                workspace.refreshGitStatus()
            }
            if let activePath {
                workspace.refreshGitDiff(path: activePath)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("FULLSCREEN DIFF REVIEW")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
                Text(task.title)
                    .font(.system(size: 22, weight: .black))
                    .lineLimit(1)
            }

            Spacer()

            StatusPill(label: "\(reviewFiles.count) Files", color: ForgeDesign.paper)
            StatusPill(label: validationState, color: validationColor)

            Button {
                workspace.refreshGitStatus()
            } label: {
                Label(workspace.isRefreshingGitStatus() ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(workspace.isRefreshingGitStatus())

            Button {
                dismiss()
            } label: {
                Label("Close", systemImage: "xmark")
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
        }
        .padding(14)
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private var fileTree: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("FILES")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
                Spacer()
                Text("+\(totalAdditions) -\(totalDeletions)")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
            }
            .padding(10)
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1))

            if reviewFiles.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("NO DIFF READY")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                    Text("Generate or apply a proposal, then refresh git status.")
                        .font(.caption)
                        .foregroundStyle(ForgeDesign.muted)
                }
                .padding(12)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(reviewFiles) { file in
                            Button {
                                selectedPath = file.path
                                workspace.refreshGitDiff(path: file.path)
                            } label: {
                                DiffReviewFileRow(
                                    file: file,
                                    isSelected: activePath == file.path
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .background(Color.white)
    }

    private var diffPane: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(DiffReviewMode.allCases) { item in
                    Button {
                        mode = item
                    } label: {
                        Text(item.rawValue)
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(mode == item ? ForgeDesign.paper : ForgeDesign.ink)
                            .frame(width: 92)
                            .padding(.vertical, 10)
                            .background(mode == item ? ForgeDesign.ink : Color.white)
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                }

                Spacer()

                if let activePath {
                    Text(activePath)
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .lineLimit(1)
                        .padding(.horizontal, 10)
                }
            }
            .background(Color.white)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let activePath {
                        if mode == .split {
                            Text("Split mode uses Forge's bounded side-by-side renderer when the runtime marks the diff as previewable.")
                                .font(.caption)
                                .foregroundStyle(ForgeDesign.muted)
                                .padding(10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.white)
                                .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1))
                        }

                        GitDiffCard(
                            path: activePath,
                            diff: workspace.gitDiff(for: activePath),
                            isLoading: workspace.isLoadingGitDiff(path: activePath),
                            load: {
                                workspace.refreshGitDiff(path: activePath)
                            }
                        )
                    } else {
                        EmptyTerminalMessage(
                            title: "NO FILE SELECTED",
                            message: "Select a changed file from the left tree to inspect its diff."
                        )
                    }
                }
                .padding(14)
            }
        }
        .background(ForgeDesign.paper)
    }

    private var reasoningPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("WHY THIS CHANGE")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(ForgeDesign.muted)

                    Text(selectedRationale)
                        .font(.callout)
                        .textSelection(.enabled)
                }
                .padding(12)
                .forgeCard(shadow: false)

                VStack(alignment: .leading, spacing: 8) {
                    Text("TESTS COVERING THIS FILE")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(ForgeDesign.muted)

                    if testEvidence.isEmpty {
                        Text("No validation evidence has been recorded yet.")
                            .font(.caption)
                            .foregroundStyle(ForgeDesign.muted)
                    } else {
                        ForEach(Array(testEvidence.prefix(6).enumerated()), id: \.offset) { _, evidence in
                            Text(evidence)
                                .font(.caption.monospaced())
                                .foregroundStyle(ForgeDesign.ink)
                                .textSelection(.enabled)
                        }
                    }
                }
                .padding(12)
                .forgeCard(shadow: false)

                VStack(alignment: .leading, spacing: 8) {
                    Text("FILE REVIEW")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(ForgeDesign.muted)

                    if let selectedFile {
                        MetricRow(label: "Status", value: selectedFile.status)
                        MetricRow(label: "Validation", value: selectedFile.validationStatus ?? "Unknown")
                        MetricRow(label: "Lines", value: "+\(selectedFile.additions ?? 0) -\(selectedFile.deletions ?? 0)")
                    }

                    Button {} label: {
                        Label("Looks Good", systemImage: "checkmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(ForgeSecondaryButtonStyle())
                    .disabled(true)
                    .help("Per-file approval state is UI-only until the review model grows file-level decisions.")

                    Button {
                        workspace.rejectEditProposal(for: task)
                    } label: {
                        Label(requestChangeTitle, systemImage: "arrow.uturn.backward")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(ForgeSecondaryButtonStyle())
                    .disabled(!canRejectProposal)

                    Button {
                        workspace.applyEditProposal(for: task)
                    } label: {
                        Label(applyPatchTitle, systemImage: "checkmark.seal")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
                    .disabled(!canApplyProposal)

                    Button {
                        workspace.rollbackEditProposal(for: task)
                    } label: {
                        Label(rollbackPatchTitle, systemImage: "arrow.uturn.backward.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(ForgeSecondaryButtonStyle())
                    .disabled(!canRollbackProposal)
                }
                .padding(12)
                .forgeCard()
            }
            .padding(12)
        }
        .background(ForgeDesign.paper)
    }

    private var activePath: String? {
        if let selectedPath, reviewFiles.contains(where: { $0.path == selectedPath }) {
            return selectedPath
        }
        return reviewFiles.first?.path
    }

    private var selectedFile: DiffReviewFile? {
        guard let activePath else {
            return nil
        }
        return reviewFiles.first { $0.path == activePath }
    }

    private var reviewFiles: [DiffReviewFile] {
        var files: [String: DiffReviewFile] = [:]

        for change in workspace.gitStatus?.changedFiles ?? [] {
            files[change.path] = DiffReviewFile(
                path: change.path,
                status: change.status,
                detail: "index \(change.indexStatus) / worktree \(change.worktreeStatus)",
                additions: change.additions,
                deletions: change.deletions,
                rationale: nil,
                validationStatus: nil
            )
        }

        for change in task.editProposal?.fileChanges ?? [] {
            let validation = validationResult(for: change.path)
            let existing = files[change.path]
            files[change.path] = DiffReviewFile(
                path: change.path,
                status: existing?.status ?? change.changeType,
                detail: existing?.detail ?? change.changeType,
                additions: existing?.additions,
                deletions: existing?.deletions,
                rationale: change.rationale,
                validationStatus: validation?.status
            )
        }

        for path in task.changedFiles where files[path] == nil {
            files[path] = DiffReviewFile(
                path: path,
                status: "Changed",
                detail: "task changed file",
                additions: nil,
                deletions: nil,
                rationale: nil,
                validationStatus: validationResult(for: path)?.status
            )
        }

        return files.values.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
    }

    private var selectedRationale: String {
        if let rationale = selectedFile?.rationale, !rationale.isEmpty {
            return rationale
        }
        if let summary = task.editProposal?.summary {
            return summary
        }
        return task.reviewSummary ?? "Forge will attach file-level reasoning here when an edit proposal exists."
    }

    private var testEvidence: [String] {
        task.validationRuns.reversed().flatMap { run in
            run.commands.map { command in
                "\(run.presetName) / \(command.name) / \(command.status): \(command.outputSummary)"
            }
        }
    }

    private var validationState: String {
        task.validationRuns.last?.status ?? "No Tests"
    }

    private var validationColor: Color {
        switch validationState {
        case "Passed":
            return ForgeDesign.success
        case "Failed":
            return ForgeDesign.danger
        case "Running":
            return ForgeDesign.warning
        default:
            return ForgeDesign.paper
        }
    }

    private var totalAdditions: Int {
        reviewFiles.compactMap(\.additions).reduce(0, +)
    }

    private var totalDeletions: Int {
        reviewFiles.compactMap(\.deletions).reduce(0, +)
    }

    private var canApplyProposal: Bool {
        task.editProposal?.status == "Proposed" &&
            task.editProposal?.validation?.status != "Blocked" &&
            !workspace.isApplyingEditProposal(taskID: task.id) &&
            !workspace.isRollingBackEditProposal(taskID: task.id) &&
            !workspace.isValidatingEditProposal(taskID: task.id) &&
            !workspace.isRejectingEditProposal(taskID: task.id)
    }

    private var canRejectProposal: Bool {
        task.editProposal?.status == "Proposed" &&
            !workspace.isApplyingEditProposal(taskID: task.id) &&
            !workspace.isRollingBackEditProposal(taskID: task.id) &&
            !workspace.isRejectingEditProposal(taskID: task.id)
    }

    private var canRollbackProposal: Bool {
        task.editProposal?.status == "Applied" &&
            task.editProposal?.appliedFileChanges?.isEmpty == false &&
            !workspace.isApplyingEditProposal(taskID: task.id) &&
            !workspace.isRollingBackEditProposal(taskID: task.id)
    }

    private var applyPatchTitle: String {
        if workspace.isApplyingEditProposal(taskID: task.id) {
            return "Applying"
        }
        return task.editProposal?.status == "Applied" ? "Applied" : "Apply Final Patch"
    }

    private var rollbackPatchTitle: String {
        if workspace.isRollingBackEditProposal(taskID: task.id) {
            return "Rolling Back"
        }
        return task.editProposal?.status == "RolledBack" ? "Rolled Back" : "Rollback Patch"
    }

    private var requestChangeTitle: String {
        workspace.isRejectingEditProposal(taskID: task.id) ? "Requesting" : "Request Change"
    }

    private func validationResult(for path: String) -> FileChangeValidation? {
        task.editProposal?.validation?.fileResults.first { result in
            result.path == path
        }
    }
}

private struct DiffReviewFileRow: View {
    var file: DiffReviewFile
    var isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(statusToken)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.ink)
                .frame(width: 24)
                .padding(.vertical, 3)
                .background(statusColor)
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1))

            VStack(alignment: .leading, spacing: 4) {
                Text(file.path)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.ink)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    Text(file.detail)
                    if let additions = file.additions, let deletions = file.deletions {
                        Text("+\(additions) -\(deletions)")
                    }
                }
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)
                .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(9)
        .background(isSelected ? ForgeDesign.accent : Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1))
    }

    private var statusToken: String {
        switch file.status {
        case "Added", "Untracked", "CreateFile":
            return "A"
        case "Deleted", "Delete":
            return "D"
        case "Renamed":
            return "R"
        default:
            return "M"
        }
    }

    private var statusColor: Color {
        switch statusToken {
        case "A":
            return ForgeDesign.success
        case "D":
            return ForgeDesign.danger
        case "R":
            return ForgeDesign.warning
        default:
            return ForgeDesign.paper
        }
    }
}

private struct AgentTestsTab: View {
    var task: ForgeTask

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if task.taskCommandRuns.isEmpty && task.validationRuns.isEmpty && task.commandRerunEvidence.isEmpty {
                    EmptyTerminalMessage(title: "NO TEST RUNS YET", message: "Approved checks and command output will appear here as the agent runs.")
                } else {
                    ForEach(task.commandRerunEvidence.reversed()) { evidence in
                        CommandRerunEvidenceCard(
                            evidence: evidence,
                            sourceRun: taskCommandRun(for: evidence.sourceTaskCommandRunID),
                            repairBrief: validationRepairBrief(for: evidence.validationRepairBriefID),
                            rerunRun: taskCommandRun(for: evidence.rerunTaskCommandRunID)
                        )
                    }

                    ForEach(task.taskCommandRuns.reversed()) { run in
                        TaskCommandTerminalCard(run: run)
                    }

                    ForEach(task.validationRuns.reversed()) { run in
                        TestRunTerminalCard(run: run)
                    }
                }

                if !task.validationRepairBriefs.isEmpty {
                    ForEach(task.validationRepairBriefs.reversed()) { brief in
                        ValidationRepairBriefCard(
                            brief: brief,
                            validationRun: validationRun(for: brief.validationRunID),
                            taskCommandRun: taskCommandRun(for: brief.taskCommandRunID),
                            isCurrentProposalSource: task.editProposal?.validationRepairBriefID == brief.id
                        )
                    }
                }
            }
            .padding(14)
        }
        .forgeCard(shadow: false)
    }

    private func validationRun(for id: String?) -> ValidationRun? {
        guard let id else {
            return nil
        }

        return task.validationRuns.first { $0.id == id }
    }

    private func taskCommandRun(for id: String?) -> TaskCommandRun? {
        guard let id else {
            return nil
        }

        return task.taskCommandRuns.first { $0.id == id }
    }

    private func validationRepairBrief(for id: String?) -> ValidationRepairBrief? {
        guard let id else {
            return nil
        }

        return task.validationRepairBriefs.first { $0.id == id }
    }
}

private struct EmptyTerminalMessage: View {
    var title: String
    var message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.accent)
            Text(message)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(ForgeDesign.paper)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .forgeTerminal()
    }
}

private struct TaskCommandTerminalCard: View {
    var run: TaskCommandRun

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("\(run.name.uppercased()) / \(run.status.uppercased())")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(statusColor)
                Spacer()
                Text(run.endedAt ?? run.startedAt)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(Color.gray)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("$ \(run.command)")
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .foregroundStyle(ForgeDesign.accent)
                if let cwd = run.cwd {
                    Text("cwd: \(cwd)")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Color.gray)
                }
                Text(run.presetName ?? "Approved command")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(Color.gray)
            }

            if run.outputChunks.isEmpty {
                Text(run.outputSummary)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(ForgeDesign.paper)
                    .textSelection(.enabled)
            } else {
                ForEach(run.outputChunks) { chunk in
                    HStack(alignment: .top, spacing: 8) {
                        Text(chunk.stream.uppercased())
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundStyle(streamColor(chunk.stream))
                            .frame(width: 48, alignment: .leading)
                        Text(chunk.text.trimmingCharacters(in: .newlines))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(ForgeDesign.paper)
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .padding(14)
        .forgeTerminal()
    }

    private var statusColor: Color {
        switch run.status {
        case "Passed":
            return ForgeDesign.success
        case "Failed":
            return ForgeDesign.danger
        case "Running":
            return ForgeDesign.warning
        case "Cancelled":
            return ForgeDesign.muted
        default:
            return ForgeDesign.accent
        }
    }

    private func streamColor(_ stream: String) -> Color {
        switch stream {
        case "stderr":
            return ForgeDesign.warning
        case "system":
            return ForgeDesign.muted
        default:
            return ForgeDesign.success
        }
    }
}

private struct CommandRerunEvidenceCard: View {
    var evidence: CommandRerunEvidence
    var sourceRun: TaskCommandRun?
    var repairBrief: ValidationRepairBrief?
    var rerunRun: TaskCommandRun?

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label("SELF-FIX RERUN / \(evidence.status.uppercased())", systemImage: statusSystemImage)
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(statusColor)

                Spacer(minLength: 8)

                Text(evidence.updatedAt)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(Color.gray)
            }

            Text(evidence.summary)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(ForgeDesign.paper)
                .textSelection(.enabled)

            VStack(alignment: .leading, spacing: 4) {
                evidenceLine(
                    title: "failed",
                    value: sourceRun.map { "\($0.name) / \($0.status)" } ?? evidence.commandName
                )
                evidenceLine(
                    title: "brief",
                    value: repairBrief?.summary ?? evidence.validationRepairBriefID
                )
                evidenceLine(
                    title: "proposal",
                    value: evidence.repairProposalID
                )
                if let rerunRun {
                    evidenceLine(
                        title: "rerun",
                        value: "\(rerunRun.name) / \(rerunRun.status)"
                    )
                } else {
                    evidenceLine(
                        title: "rerun",
                        value: evidence.status == "Ready" ? "ready to verify" : "not recorded yet"
                    )
                }
            }
        }
        .padding(14)
        .forgeTerminal()
    }

    @ViewBuilder
    private func evidenceLine(title: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)
                .frame(width: 54, alignment: .leading)
            Text(value)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(ForgeDesign.paper)
                .lineLimit(3)
                .textSelection(.enabled)
        }
    }

    private var statusSystemImage: String {
        switch evidence.status {
        case "Passed":
            return "checkmark.seal"
        case "Failed":
            return "exclamationmark.triangle"
        case "Running":
            return "hourglass"
        case "Cancelled":
            return "stop.circle"
        default:
            return "arrow.clockwise.circle"
        }
    }

    private var statusColor: Color {
        switch evidence.status {
        case "Passed":
            return ForgeDesign.success
        case "Failed":
            return ForgeDesign.danger
        case "Running":
            return ForgeDesign.warning
        case "Cancelled":
            return ForgeDesign.muted
        default:
            return ForgeDesign.accent
        }
    }
}

private struct TestRunTerminalCard: View {
    var run: ValidationRun

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("\(run.presetName.uppercased()) / \(run.status.uppercased())")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(statusColor)
                Spacer()
                Text(run.endedAt ?? run.startedAt)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(Color.gray)
            }

            Text(run.summary)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(ForgeDesign.paper)
                .textSelection(.enabled)

            ForEach(run.commands) { command in
                VStack(alignment: .leading, spacing: 4) {
                    Text("$ \(command.command)")
                        .font(.system(.caption, design: .monospaced).weight(.bold))
                        .foregroundStyle(ForgeDesign.accent)
                    Text(command.outputSummary)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(ForgeDesign.paper)
                        .textSelection(.enabled)
                }
                .padding(.top, 4)
            }
        }
        .padding(14)
        .forgeTerminal()
    }

    private var statusColor: Color {
        switch run.status {
        case "Passed":
            return ForgeDesign.success
        case "Failed":
            return ForgeDesign.danger
        case "Running":
            return ForgeDesign.warning
        default:
            return ForgeDesign.accent
        }
    }
}

private struct SessionDecisionRail: View {
    var task: ForgeTask
    var openDiffReview: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                PlanGateCard(task: task)
                AgentRunActionsCard(task: task)
                AgentMiniReviewCard(task: task, openDiffReview: openDiffReview)
            }
            .padding(.bottom, 4)
        }
    }
}

private struct PlanGateCard: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    var task: ForgeTask

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("PLAN GATE")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
                Spacer()
                StatusPill(label: planState, color: planColor)
            }

            if let revision = task.planRevisions.last {
                Text(revision.summary)
                    .font(.callout.weight(.semibold))
                    .textSelection(.enabled)
                Text(revision.rationale)
                    .font(.caption)
                    .foregroundStyle(ForgeDesign.muted)
                    .textSelection(.enabled)
                Label("Risk \(revision.riskLevel)", systemImage: "shield")
                    .font(.caption)
                    .foregroundStyle(ForgeDesign.muted)
            } else {
                Text(task.reviewSummary ?? "Forge is waiting for a generated plan before code changes can begin.")
                    .font(.callout)
                    .foregroundStyle(ForgeDesign.muted)
            }

            VStack(alignment: .leading, spacing: 7) {
                ForEach(activePlanSteps.prefix(5)) { step in
                    HStack(alignment: .top, spacing: 8) {
                        Text(step.status.uppercased())
                            .font(.system(size: 8, weight: .bold, design: .monospaced))
                            .frame(width: 54, alignment: .leading)
                            .foregroundStyle(step.status == "Done" ? ForgeDesign.success : ForgeDesign.muted)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(step.title)
                                .font(.caption.weight(.semibold))
                            Text(step.summary)
                                .font(.caption2)
                                .foregroundStyle(ForgeDesign.muted)
                                .lineLimit(2)
                        }
                    }
                }
            }

            Button {
                workspace.approvePlan(for: task)
            } label: {
                Label(approveTitle, systemImage: "checkmark.seal")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
            .disabled(!canApprovePlan)

            Button {
                workspace.generatePlanRevision(for: task)
            } label: {
                Label(planRevisionTitle, systemImage: "arrow.triangle.branch")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(!canGeneratePlanRevision)
        }
        .padding(12)
        .forgeCard()
    }

    private var activePlanSteps: [PlanStep] {
        task.planRevisions.last?.steps ?? task.planSteps
    }

    private var latestPlanRevision: PlanRevision? {
        task.planRevisions.last
    }

    private var hasApprovedCurrentPlan: Bool {
        task.approvals.contains { approval in
            approval.action == "Approve Plan" &&
                approval.decision == "Approved" &&
                approval.targetID == latestPlanRevision?.id
        }
    }

    private var canApprovePlan: Bool {
        task.status == "Human Review" &&
            !hasApprovedCurrentPlan &&
            !workspace.isApprovingPlan(taskID: task.id)
    }

    private var approveTitle: String {
        if workspace.isApprovingPlan(taskID: task.id) {
            return "Approving"
        }
        if hasApprovedCurrentPlan {
            return "Plan Approved"
        }
        return "Approve Plan"
    }

    private var canGeneratePlanRevision: Bool {
        !workspace.isGeneratingPlanRevision(taskID: task.id) &&
            task.editProposal?.status != "Proposed" &&
            task.editProposal?.status != "Applied"
    }

    private var planRevisionTitle: String {
        workspace.isGeneratingPlanRevision(taskID: task.id) ? "Updating Plan" : "Regenerate Plan"
    }

    private var planState: String {
        if hasApprovedCurrentPlan {
            return "Approved"
        }
        return task.status == "Human Review" ? "Needs Review" : task.currentPhase
    }

    private var planColor: Color {
        hasApprovedCurrentPlan ? ForgeDesign.success : ForgeDesign.warning
    }
}

private struct AgentRunActionsCard: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @State private var selectedTaskCommandID: String?
    var task: ForgeTask

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("NEXT ACTIONS")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)

            Button {
                workspace.generateEditProposal(for: task)
            } label: {
                Label(generateEditProposalTitle, systemImage: "doc.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgePrimaryButtonStyle())
            .disabled(!canGenerateEditProposal)

            Button {
                workspace.validateEditProposal(for: task)
            } label: {
                Label(validateEditProposalTitle, systemImage: "checkmark.shield")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(!canValidateEditProposal)

            Button {
                workspace.applyEditProposal(for: task)
            } label: {
                Label(applyEditProposalTitle, systemImage: "checkmark.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
            .disabled(!canApplyEditProposal)

            Button {
                workspace.rollbackEditProposal(for: task)
            } label: {
                Label(rollbackEditProposalTitle, systemImage: "arrow.uturn.backward.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(!canRollbackEditProposal)

            Button {
                workspace.rejectEditProposal(for: task)
            } label: {
                Label(rejectEditProposalTitle, systemImage: "arrow.uturn.backward")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(!canRejectEditProposal)

            Divider()

            Menu {
                ForEach(taskCommandPermissions) { permission in
                    Button {
                        selectedTaskCommandID = permission.command.id
                    } label: {
                        Label(taskCommandMenuTitle(permission), systemImage: taskCommandSystemImage(permission))
                    }
                }
            } label: {
                Label(selectedTaskCommandTitle, systemImage: "terminal")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(taskCommandPermissions.isEmpty || isRunningTaskCommand || isCancellingTaskCommand || isRerunningRepairCommand)

            if let selectedTaskCommandPermission {
                Text(selectedTaskCommandPermission.command.command)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                if let selectedTaskCommandPermission {
                    workspace.runTaskCommand(for: task, commandID: selectedTaskCommandPermission.command.id)
                }
            } label: {
                Label(runTaskCommandTitle, systemImage: "play.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(!canRunSelectedTaskCommand)

            Button {
                if let latestRunningTaskCommandRun {
                    workspace.cancelTaskCommand(for: task, run: latestRunningTaskCommandRun)
                }
            } label: {
                Label(cancelTaskCommandTitle, systemImage: "stop.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(!canCancelTaskCommand)

            Button {
                workspace.runValidation(for: task)
            } label: {
                Label(runValidationTitle, systemImage: "play.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(!canRunValidation)

            Button {
                workspace.generateValidationRepairProposal(for: task)
            } label: {
                Label(generateRepairTitle, systemImage: "wrench.and.screwdriver")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(!canGenerateValidationRepairProposal)

            Button {
                if let latestRunnableCommandRerunEvidence {
                    workspace.rerunRepairCommand(for: task, evidence: latestRunnableCommandRerunEvidence)
                }
            } label: {
                Label(rerunRepairCommandTitle, systemImage: "arrow.clockwise.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(!canRerunRepairCommand)
        }
        .padding(12)
        .forgeCard()
    }

    private var isGeneratingEditProposal: Bool {
        workspace.isGeneratingEditProposal(taskID: task.id)
    }

    private var isGeneratingValidationRepairProposal: Bool {
        workspace.isGeneratingValidationRepairProposal(taskID: task.id)
    }

    private var isValidatingEditProposal: Bool {
        workspace.isValidatingEditProposal(taskID: task.id)
    }

    private var isApplyingEditProposal: Bool {
        workspace.isApplyingEditProposal(taskID: task.id)
    }

    private var isRollingBackEditProposal: Bool {
        workspace.isRollingBackEditProposal(taskID: task.id)
    }

    private var isRejectingEditProposal: Bool {
        workspace.isRejectingEditProposal(taskID: task.id)
    }

    private var isRunningValidation: Bool {
        workspace.isRunningValidation(taskID: task.id)
    }

    private var isRunningTaskCommand: Bool {
        workspace.isRunningTaskCommand(taskID: task.id)
    }

    private var latestCommandRerunEvidence: CommandRerunEvidence? {
        task.commandRerunEvidence.reversed().first
    }

    private var latestRunnableCommandRerunEvidence: CommandRerunEvidence? {
        task.commandRerunEvidence.reversed().first { evidence in
            evidence.status == "Ready" || evidence.status == "Failed"
        }
    }

    private var isRerunningRepairCommand: Bool {
        workspace.isRerunningRepairCommand(evidenceID: latestCommandRerunEvidence?.id) ||
            latestCommandRerunEvidence?.status == "Running"
    }

    private var latestRunningTaskCommandRun: TaskCommandRun? {
        task.taskCommandRuns.reversed().first { run in
            run.status == "Running"
        }
    }

    private var isCancellingTaskCommand: Bool {
        workspace.isCancellingTaskCommand(runID: latestRunningTaskCommandRun?.id)
    }

    private var taskCommandPermissions: [TaskCommandPermission] {
        workspace.taskCommandPermissions(for: task.id)
    }

    private var selectedTaskCommandPermission: TaskCommandPermission? {
        if let selectedTaskCommandID,
           let selected = taskCommandPermissions.first(where: { $0.command.id == selectedTaskCommandID }) {
            return selected
        }

        return taskCommandPermissions.first { $0.canRun } ?? taskCommandPermissions.first
    }

    private var selectedTaskCommandTitle: String {
        selectedTaskCommandPermission?.command.name ?? "Select Command"
    }

    private var canRunSelectedTaskCommand: Bool {
        guard let selectedTaskCommandPermission else {
            return false
        }

        return selectedTaskCommandPermission.canRun &&
            task.status != "Testing" &&
            !isRunningTaskCommand &&
            !isRunningValidation &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isCancellingTaskCommand &&
            !isRerunningRepairCommand
    }

    private var runTaskCommandTitle: String {
        if isRunningTaskCommand {
            return "Running Command"
        }
        guard let selectedTaskCommandPermission else {
            return "No Commands"
        }
        if selectedTaskCommandPermission.canRun {
            return "Run Command"
        }
        if selectedTaskCommandPermission.executionState == "NeedsApproval" {
            return "Approve Preset First"
        }
        return "Command Blocked"
    }

    private var canCancelTaskCommand: Bool {
        latestRunningTaskCommandRun != nil && !isCancellingTaskCommand
    }

    private var cancelTaskCommandTitle: String {
        isCancellingTaskCommand ? "Cancelling Command" : "Cancel Command"
    }

    private func taskCommandMenuTitle(_ permission: TaskCommandPermission) -> String {
        if let lastRun = permission.lastRun {
            return "\(permission.command.name) / \(permission.executionState) / last \(lastRun.status)"
        }

        return "\(permission.command.name) / \(permission.executionState)"
    }

    private func taskCommandSystemImage(_ permission: TaskCommandPermission) -> String {
        if permission.canRun {
            return "play.circle"
        }
        if permission.executionState == "NeedsApproval" {
            return "lock"
        }
        if permission.executionState == "Running" {
            return "hourglass"
        }
        return "exclamationmark.triangle"
    }

    private var canGenerateEditProposal: Bool {
        task.executionProposal != nil &&
            (task.editProposal == nil || task.editProposal?.status == "Rejected") &&
            !isGeneratingEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isRejectingEditProposal &&
            !isRunningTaskCommand &&
            !isCancellingTaskCommand &&
            !isRerunningRepairCommand
    }

    private var generateEditProposalTitle: String {
        if isGeneratingEditProposal {
            return "Generating Proposal"
        }
        if task.editProposal?.status == "Rejected" {
            return "Revise Proposal"
        }
        if task.editProposal != nil {
            return "Proposal Ready"
        }
        return "Generate Proposal"
    }

    private var canValidateEditProposal: Bool {
        task.editProposal?.status == "Proposed" &&
            !isValidatingEditProposal &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isRejectingEditProposal &&
            !isRunningTaskCommand &&
            !isCancellingTaskCommand &&
            !isRerunningRepairCommand
    }

    private var validateEditProposalTitle: String {
        isValidatingEditProposal ? "Validating" : "Validate Proposal"
    }

    private var canApplyEditProposal: Bool {
        task.editProposal?.status == "Proposed" &&
            task.editProposal?.validation?.status != "Blocked" &&
            !isValidatingEditProposal &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isRejectingEditProposal &&
            !isRunningTaskCommand &&
            !isCancellingTaskCommand &&
            !isRerunningRepairCommand
    }

    private var applyEditProposalTitle: String {
        if isApplyingEditProposal {
            return "Applying"
        }
        if task.editProposal?.status == "Applied" {
            return "Applied"
        }
        return "Apply Patch"
    }

    private var canRollbackEditProposal: Bool {
        task.editProposal?.status == "Applied" &&
            task.editProposal?.appliedFileChanges?.isEmpty == false &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isRunningTaskCommand &&
            !isCancellingTaskCommand &&
            !isRerunningRepairCommand
    }

    private var rollbackEditProposalTitle: String {
        if isRollingBackEditProposal {
            return "Rolling Back"
        }
        if task.editProposal?.status == "RolledBack" {
            return "Rolled Back"
        }
        return "Rollback Patch"
    }

    private var canRejectEditProposal: Bool {
        task.editProposal?.status == "Proposed" &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isRejectingEditProposal &&
            !isRunningTaskCommand &&
            !isCancellingTaskCommand &&
            !isRerunningRepairCommand
    }

    private var rejectEditProposalTitle: String {
        isRejectingEditProposal ? "Requesting" : "Request Change"
    }

    private var canRunValidation: Bool {
        task.editProposal?.status == "Applied" &&
            task.status != "Testing" &&
            !isRunningValidation &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isRunningTaskCommand &&
            !isCancellingTaskCommand &&
            !isRerunningRepairCommand
    }

    private var runValidationTitle: String {
        if isRunningValidation {
            return "Running Checks"
        }
        if !task.validationRuns.isEmpty {
            return "Run Checks Again"
        }
        return "Run Checks"
    }

    private var latestFailedValidationRun: ValidationRun? {
        task.validationRuns.reversed().first { run in
            run.status == "Failed"
        }
    }

    private var latestFailedTaskCommandRun: TaskCommandRun? {
        task.taskCommandRuns.reversed().first { run in
            run.status == "Failed"
        }
    }

    private var latestValidationRepairBrief: ValidationRepairBrief? {
        guard let latestFailedValidationRun else {
            return nil
        }

        return task.validationRepairBriefs.reversed().first { brief in
            brief.validationRunID == latestFailedValidationRun.id
        }
    }

    private var latestTaskCommandRepairBrief: ValidationRepairBrief? {
        guard let latestFailedTaskCommandRun else {
            return nil
        }

        return task.validationRepairBriefs.reversed().first { brief in
            brief.taskCommandRunID == latestFailedTaskCommandRun.id
        }
    }

    private var latestRepairBrief: ValidationRepairBrief? {
        if let latestTaskCommandRepairBrief,
           latestFailedValidationRun == nil ||
            (latestFailedTaskCommandRun?.endedAt ?? latestFailedTaskCommandRun?.startedAt ?? "") >=
            (latestFailedValidationRun?.endedAt ?? latestFailedValidationRun?.startedAt ?? "") {
            return latestTaskCommandRepairBrief
        }

        return latestValidationRepairBrief ?? latestTaskCommandRepairBrief
    }

    private var canGenerateValidationRepairProposal: Bool {
        task.executionProposal != nil &&
            task.editProposal?.status != "Proposed" &&
            latestRepairBrief != nil &&
            !isGeneratingValidationRepairProposal &&
            !isGeneratingEditProposal &&
            !isValidatingEditProposal &&
            !isApplyingEditProposal &&
            !isRejectingEditProposal &&
            !isRunningValidation &&
            !isRunningTaskCommand &&
            !isCancellingTaskCommand &&
            !isRerunningRepairCommand
    }

    private var generateRepairTitle: String {
        if isGeneratingValidationRepairProposal {
            return "Generating Repair"
        }
        if task.editProposal?.validationRepairBriefID == latestRepairBrief?.id {
            return "Self-Fix Ready"
        }
        return "Generate Self-Fix"
    }

    private var canRerunRepairCommand: Bool {
        latestRunnableCommandRerunEvidence != nil &&
            task.status != "Testing" &&
            !isRerunningRepairCommand &&
            !isRunningValidation &&
            !isRunningTaskCommand &&
            !isCancellingTaskCommand &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isGeneratingEditProposal
    }

    private var rerunRepairCommandTitle: String {
        if isRerunningRepairCommand {
            return "Rerunning Self-Fix"
        }

        if let evidence = latestCommandRerunEvidence {
            switch evidence.status {
            case "Passed":
                return "Self-Fix Verified"
            case "Failed":
                return "Rerun Self-Fix Again"
            case "Running":
                return "Rerunning Self-Fix"
            default:
                return "Rerun Self-Fix"
            }
        }

        return "No Self-Fix Rerun"
    }
}

private struct AgentMiniReviewCard: View {
    var task: ForgeTask
    var openDiffReview: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("REVIEW STATE")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)

            MetricRow(label: "Changed", value: "\(changedFileCount)")
            MetricRow(label: "Validation", value: validationState)
            MetricRow(label: "Proposal", value: task.editProposal?.status ?? "None")
            MetricRow(label: "Commands", value: "\(commandCount)")

            if let summary = task.reviewSummary {
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(ForgeDesign.muted)
                    .textSelection(.enabled)
            }

            Button {
                openDiffReview()
            } label: {
                Label("Open Full Diff", systemImage: "rectangle.expand.vertical")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(changedFileCount == 0)
        }
        .padding(12)
        .forgeCard(shadow: false)
    }

    private var changedFileCount: Int {
        max(task.changedFiles.count, task.editProposal?.fileChanges.count ?? 0)
    }

    private var validationState: String {
        task.validationRuns.last?.status ?? "Not Run"
    }

    private var commandCount: Int {
        task.taskCommandRuns.count + task.validationRuns.flatMap(\.commands).count
    }
}

private struct MetricRow: View {
    var label: String
    var value: String

    var body: some View {
        HStack {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)
            Spacer()
            Text(value)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.ink)
        }
    }
}

private struct TaskConversationPanel: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask

    @State private var draft = ""

    var body: some View {
        Panel(title: "Task Conversation", systemImage: "bubble.left.and.text.bubble.right") {
            VStack(alignment: .leading, spacing: 12) {
                if task.messages.isEmpty {
                    Text("No task messages yet.")
                        .foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(task.messages) { message in
                            TaskMessageRow(message: message)
                        }
                    }
                }

                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Add instruction or clarification", text: $draft, axis: .vertical)
                        .lineLimit(2...5)
                        .textFieldStyle(.roundedBorder)

                    Button {
                        send()
                    } label: {
                        Label(sendButtonTitle, systemImage: "paperplane")
                    }
                    .disabled(!canSend)
                }

                Button {
                    workspace.generatePlanRevision(for: task)
                } label: {
                    Label(planRevisionButtonTitle, systemImage: "list.bullet.clipboard")
                        .frame(maxWidth: .infinity)
                }
                .disabled(!canGeneratePlanRevision)
            }
        }
    }

    private var trimmedDraft: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSend: Bool {
        !trimmedDraft.isEmpty && !workspace.isSendingTaskMessage(taskID: task.id)
    }

    private var sendButtonTitle: String {
        workspace.isSendingTaskMessage(taskID: task.id) ? "Sending" : "Send"
    }

    private var canGeneratePlanRevision: Bool {
        !workspace.isGeneratingPlanRevision(taskID: task.id) &&
            task.editProposal?.status != "Proposed" &&
            task.editProposal?.status != "Applied"
    }

    private var planRevisionButtonTitle: String {
        workspace.isGeneratingPlanRevision(taskID: task.id) ? "Updating Plan" : "Update Plan From Conversation"
    }

    private func send() {
        let content = trimmedDraft
        guard !content.isEmpty else {
            return
        }

        draft = ""
        workspace.sendTaskMessage(for: task, content: content)
    }
}

private struct TaskMessageRow: View {
    var message: TaskMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(message.role, systemImage: systemImage)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(message.createdAt)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if let intentBrief = message.intentBrief {
                IntentBriefView(brief: intentBrief)
            } else {
                Text(message.content)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            if let provider = message.provider {
                Label("\(provider.name) / \(provider.model)", systemImage: "cpu")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if !message.fileReferences.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(message.fileReferences) { reference in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Label(reference.path ?? reference.requestedPath, systemImage: fileReferenceSystemImage(reference.status))
                                    .font(.caption.weight(.semibold))
                                Spacer()
                                Text(reference.status)
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(.secondary)
                            }

                            Text(fileReferenceDetail(reference))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(7)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.quaternary)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(messageBackgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var systemImage: String {
        message.role == "User" ? "person.crop.circle" : "sparkles"
    }

    private var messageBackgroundColor: Color {
        message.role == "User"
            ? Color(nsColor: .textBackgroundColor)
            : Color.secondary.opacity(0.12)
    }

    private func fileReferenceSystemImage(_ status: String) -> String {
        switch status {
        case "Resolved":
            return "doc.text.magnifyingglass"
        case "Missing":
            return "questionmark.folder"
        case "Blocked":
            return "exclamationmark.triangle"
        default:
            return "doc"
        }
    }

    private func fileReferenceDetail(_ reference: TaskFileReference) -> String {
        var parts = [reference.summary]

        if let lineStart = reference.lineStart {
            if let lineEnd = reference.lineEnd, lineEnd != lineStart {
                parts.append("Lines \(lineStart)-\(lineEnd)")
            } else {
                parts.append("Line \(lineStart)")
            }
        }

        if let lineCount = reference.lineCount {
            parts.append("\(lineCount) lines")
        }

        return parts.joined(separator: " · ")
    }
}

private struct IntentBriefView: View {
    var brief: IntentBrief

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(brief.summary)
                .font(.subheadline)
                .textSelection(.enabled)

            BriefList(title: "Constraints", values: brief.constraints)
            BriefList(title: "Acceptance", values: brief.acceptanceCriteria)
            BriefList(title: "Open Questions", values: brief.openQuestions)

            Label(brief.nextAction, systemImage: "arrow.forward.circle")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct BriefList: View {
    var title: String
    var values: [String]

    var body: some View {
        if !values.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(values, id: \.self) { value in
                    Text("- \(value)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        }
    }
}

private struct PlannerPanel: View {
    var task: ForgeTask

    var body: some View {
        Panel(title: "Planner", systemImage: "checklist") {
            VStack(alignment: .leading, spacing: 10) {
                if let revision = task.planRevisions.last {
                    PlanRevisionCard(revision: revision)
                }

                ForEach(task.planSteps) { step in
                    HStack(spacing: 10) {
                        Image(systemName: iconName(for: step.status))
                            .foregroundStyle(iconColor(for: step.status))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(step.title)
                            Text(step.summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func iconName(for status: String) -> String {
        switch status {
        case "Done":
            return "checkmark.circle.fill"
        case "Active":
            return "arrow.triangle.2.circlepath.circle.fill"
        case "Blocked":
            return "exclamationmark.triangle.fill"
        default:
            return "circle"
        }
    }

    private func iconColor(for status: String) -> Color {
        switch status {
        case "Done":
            return .green
        case "Active":
            return .blue
        case "Blocked":
            return .orange
        default:
            return .secondary
        }
    }
}

private struct PlanRevisionCard: View {
    var revision: PlanRevision

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label("Plan Revision", systemImage: "arrow.triangle.branch")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(revision.riskLevel)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            Text(revision.summary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            Text(revision.rationale)
                .font(.caption)
                .foregroundStyle(.secondary)

            Label("\(revision.provider.name) / \(revision.provider.model)", systemImage: "cpu")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct ContextPanel: View {
    var task: ForgeTask

    var body: some View {
        Panel(title: "Context Files", systemImage: "folder.badge.gearshape") {
            if task.contextFiles.isEmpty {
                Text("No local context files inspected yet.")
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(task.contextFiles) { file in
                        VStack(alignment: .leading, spacing: 3) {
                            Label(file.path, systemImage: "doc.text")
                                .font(.subheadline.weight(.semibold))
                            Text(file.summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
    }
}

private struct ToolCallPanel: View {
    var task: ForgeTask

    var body: some View {
        Panel(title: "Tool Calls", systemImage: "wrench.and.screwdriver") {
            if task.toolCalls.isEmpty {
                Text("No tools have run yet.")
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(task.toolCalls) { call in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: iconName(for: call.status))
                                .foregroundStyle(iconColor(for: call.status))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(call.name)
                                    .font(.subheadline.weight(.semibold))
                                Text(call.input)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(call.outputSummary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(call.status)
                                .font(.caption2.weight(.medium))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(.quaternary)
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                        }
                    }
                }
            }
        }
    }

    private func iconName(for status: String) -> String {
        switch status {
        case "Completed":
            return "checkmark.circle.fill"
        case "Failed":
            return "exclamationmark.triangle.fill"
        default:
            return "arrow.triangle.2.circlepath.circle.fill"
        }
    }

    private func iconColor(for status: String) -> Color {
        switch status {
        case "Completed":
            return .green
        case "Failed":
            return .orange
        default:
            return .blue
        }
    }
}

private struct AgentPanel: View {
    var task: ForgeTask

    var body: some View {
        Panel(title: "Agents", systemImage: "person.3.sequence") {
            VStack(spacing: 10) {
                ForEach(task.agentStates, id: \.role) { agent in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(agent.role)
                                .font(.headline)
                            Text(agent.summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Text(agent.status)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.quaternary)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .padding(10)
                    .background(.background)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }
}

private struct EventPanel: View {
    var task: ForgeTask

    var body: some View {
        Panel(title: "Runtime Events", systemImage: "waveform.path.ecg") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(task.events) { event in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(event.type)
                            .font(.caption.weight(.semibold))
                        Text(event.message)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }
}

private struct ReviewPanel: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Label("Review", systemImage: "doc.text.magnifyingglass")
                    .font(.title3.weight(.semibold))

                VStack(alignment: .leading, spacing: 8) {
                    Text("Changed files")
                        .font(.headline)
                    if task.changedFiles.isEmpty {
                        Text(emptyChangedFilesMessage)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(task.changedFiles, id: \.self) { file in
                            Label(file, systemImage: "doc.text")
                        }
                    }
                }

                GitWorkingTreeCard(task: task)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Review Summary")
                        .font(.headline)
                    Text(task.reviewSummary ?? "No review summary yet.")
                        .foregroundStyle(.secondary)
                }

                if let proposal = task.executionProposal {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Execution Proposal")
                            .font(.headline)

                        VStack(alignment: .leading, spacing: 6) {
                            Label("\(proposal.provider.name) / \(proposal.provider.model)", systemImage: "cpu")
                                .font(.subheadline.weight(.semibold))
                            Text(proposal.summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            Label("Risk: \(proposal.riskLevel)", systemImage: "shield")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                        }

                        VStack(alignment: .leading, spacing: 5) {
                            ForEach(Array(proposal.proposedActions.enumerated()), id: \.offset) { index, action in
                                HStack(alignment: .top, spacing: 8) {
                                    Text("\(index + 1).")
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                    Text(action)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }

                        if let toolEvidence = proposal.toolEvidence,
                           !toolEvidence.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Execution Context")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                ForEach(toolEvidence, id: \.self) { evidence in
                                    Label(evidence, systemImage: "checkmark.seal")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }

                        if let contextFiles = proposal.contextFiles,
                           !contextFiles.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(contextFiles, id: \.path) { contextFile in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(contextFile.path)
                                            .font(.caption2.monospaced())
                                        Text(contextFile.summary)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }

                if let editProposal = task.editProposal {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Edit Proposal")
                            .font(.headline)

                        VStack(alignment: .leading, spacing: 6) {
                            Label("\(editProposal.provider.name) / \(editProposal.provider.model)", systemImage: "pencil.and.list.clipboard")
                                .font(.subheadline.weight(.semibold))
                            Text(editProposal.summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Label("Revision: \(editProposal.revisionNumber)", systemImage: "arrow.triangle.branch")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                            Label("Status: \(editProposal.status)", systemImage: "list.bullet.clipboard")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                            Label("Risk: \(editProposal.riskLevel)", systemImage: "shield")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                            if let revisionOfID = editProposal.revisionOfID {
                                Label("Revises \(revisionOfID)", systemImage: "arrow.uturn.backward")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            if let validationRepairBriefID = editProposal.validationRepairBriefID {
                                Label("From repair brief \(validationRepairBriefID)", systemImage: "wrench.and.screwdriver")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }

                        if let validation = editProposal.validation {
                            VStack(alignment: .leading, spacing: 6) {
                                Label("Validation: \(validation.status)", systemImage: validationSystemImage(validation.status))
                                    .font(.subheadline.weight(.semibold))
                                Text(validation.summary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(validation.checkedAt)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)

                                ForEach(validation.fileResults) { result in
                                    VStack(alignment: .leading, spacing: 4) {
                                        Label("\(result.path) · \(result.status)", systemImage: validationSystemImage(result.status))
                                            .font(.caption.weight(.semibold))
                                        Text(result.summary)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        ForEach(result.checks, id: \.self) { check in
                                            Text("- \(check)")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    .padding(8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(.quaternary)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                                }
                            }
                        } else {
                            Label("Validation: Not Run", systemImage: "exclamationmark.triangle")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                        }

                        ForEach(editProposal.fileChanges) { change in
                            EditProposalFileChangeCard(
                                change: change,
                                validationResult: validationResult(for: change, in: editProposal)
                            )
                        }
                    }
                }

                if !task.editProposalRevisions.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Previous Edit Proposals")
                            .font(.headline)

                        ForEach(task.editProposalRevisions.reversed()) { proposal in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack {
                                    Label("Revision \(proposal.revisionNumber)", systemImage: "clock.arrow.circlepath")
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Text(proposal.status)
                                        .font(.caption2.weight(.medium))
                                        .foregroundStyle(.secondary)
                                }
                                Text(proposal.summary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(proposal.decisionNote ?? "No reviewer note.")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                if let validationRepairBriefID = proposal.validationRepairBriefID {
                                    Label("From repair brief \(validationRepairBriefID)", systemImage: "wrench.and.screwdriver")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .padding(10)
                            .background(.background)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }

                if !task.validationRuns.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Validation Runs")
                            .font(.headline)

                        ForEach(task.validationRuns.reversed()) { run in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Label("\(run.trigger) / \(run.status)", systemImage: statusSystemImage(run.status))
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Text(run.endedAt ?? run.startedAt)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }

                                Text(run.summary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Label("\(run.presetName) / \(run.presetSource) / \(run.riskLevel)", systemImage: "checklist")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(.secondary)

                                ForEach(run.commands) { command in
                                    VStack(alignment: .leading, spacing: 3) {
                                        Label("\(command.name) / \(command.status)", systemImage: statusSystemImage(command.status))
                                            .font(.caption.weight(.semibold))
                                        Text(command.command)
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(.secondary)
                                        Text(command.outputSummary)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    .padding(8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(.quaternary)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                                }
                            }
                            .padding(10)
                            .background(.background)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }

                if !task.validationRepairBriefs.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Validation Repair Briefs")
                            .font(.headline)

                        ForEach(task.validationRepairBriefs.reversed()) { brief in
                            ValidationRepairBriefCard(
                                brief: brief,
                                validationRun: validationRun(for: brief.validationRunID),
                                taskCommandRun: taskCommandRun(for: brief.taskCommandRunID),
                                isCurrentProposalSource: task.editProposal?.validationRepairBriefID == brief.id
                            )
                        }
                    }
                }

                if !projectValidationPermissions.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Command Permission Requests")
                            .font(.headline)

                        ForEach(projectValidationPermissions) { permission in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Label(
                                        "\(permission.preset.name) / \(permission.preset.riskLevel)",
                                        systemImage: statusSystemImage(permission.executionState)
                                    )
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Text(permission.executionState)
                                        .font(.caption2.weight(.medium))
                                        .foregroundStyle(.secondary)
                                }

                                Label("\(permission.preset.source) / \(permission.approvalState)", systemImage: "person.crop.circle.badge.checkmark")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(.secondary)

                                Text(permission.preset.description)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                if let approval = permission.approval {
                                    Label("Approved \(approval.decidedAt)", systemImage: "checkmark.seal")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                if let lastRun = permission.lastRun {
                                    Label("Last run: \(lastRun.status) / \(lastRun.endedAt ?? lastRun.startedAt)", systemImage: statusSystemImage(lastRun.status))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                ForEach(permission.blockedReasons, id: \.self) { reason in
                                    Label(reason, systemImage: "exclamationmark.triangle")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                Text("Command Manifest")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)

                                ForEach(permission.preset.commands) { command in
                                    VStack(alignment: .leading, spacing: 3) {
                                        Label("\(command.name) / \(command.riskLevel)", systemImage: "terminal")
                                            .font(.caption.weight(.semibold))
                                        Text(command.command)
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(.secondary)
                                        Label(command.executionMode, systemImage: "shield.lefthalf.filled")
                                            .font(.caption2.weight(.medium))
                                            .foregroundStyle(.secondary)
                                        Text(command.boundary)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                        if let cwd = command.cwd {
                                            Text(cwd)
                                                .font(.caption2)
                                                .foregroundStyle(.tertiary)
                                        }
                                    }
                                    .padding(8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(.quaternary)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                                }

                                HStack {
                                    Button {
                                        workspace.approveValidationPreset(for: task, presetID: permission.preset.id)
                                    } label: {
                                        Label(approvePermissionButtonTitle(permission), systemImage: "checkmark.seal")
                                            .frame(maxWidth: .infinity)
                                    }
                                    .disabled(!canApproveValidationPermission(permission))

                                    Button {
                                        workspace.runValidation(for: task, presetID: permission.preset.id)
                                    } label: {
                                        Label(runPermissionButtonTitle(permission), systemImage: "play.circle")
                                            .frame(maxWidth: .infinity)
                                    }
                                    .disabled(!canRunValidationPermission(permission))
                                }
                            }
                            .padding(10)
                            .background(.background)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                } else if !workspace.validationPresets.filter({ $0.id != "forge-post-apply" }).isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Command Permission Requests")
                            .font(.headline)
                        Label("Check Runtime to load task permission state.", systemImage: "hourglass")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if !task.approvals.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Approval History")
                            .font(.headline)
                        ForEach(task.approvals.reversed()) { approval in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Label(approval.decision, systemImage: "checkmark.seal.fill")
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Text(approval.decidedAt)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                                Text(approval.summary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(10)
                            .background(.background)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Approval")
                        .font(.headline)
                    Button {
                        workspace.approvePlan(for: task)
                    } label: {
                        Label(approveButtonTitle, systemImage: "checkmark.seal")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!canApprovePlan)
                    .keyboardShortcut(.return, modifiers: [.command])

                    Button {
                        workspace.generateEditProposal(for: task)
                    } label: {
                        Label(generateEditProposalButtonTitle, systemImage: "doc.badge.plus")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!canGenerateEditProposal)

                    Button {
                        workspace.validateEditProposal(for: task)
                    } label: {
                        Label(validateEditProposalButtonTitle, systemImage: "checkmark.shield")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!canValidateEditProposal)

                    Button {
                        workspace.applyEditProposal(for: task)
                    } label: {
                        Label(applyEditProposalButtonTitle, systemImage: "checkmark.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!canApplyEditProposal)

                    Button {
                        workspace.rollbackEditProposal(for: task)
                    } label: {
                        Label(rollbackEditProposalButtonTitle, systemImage: "arrow.uturn.backward.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!canRollbackEditProposal)

                    Button {
                        workspace.rejectEditProposal(for: task)
                    } label: {
                        Label(rejectEditProposalButtonTitle, systemImage: "arrow.uturn.backward")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!canRejectEditProposal)

                    Button {
                        workspace.runValidation(for: task)
                    } label: {
                        Label(runValidationButtonTitle, systemImage: "play.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!canRunValidation)

                    Button {
                        workspace.generateValidationRepairProposal(for: task)
                    } label: {
                        Label(generateValidationRepairProposalButtonTitle, systemImage: "wrench.and.screwdriver")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!canGenerateValidationRepairProposal)
                }

                Text("Task ID: \(task.id)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(20)
        }
    }

    private var isApproving: Bool {
        workspace.isApprovingPlan(taskID: task.id)
    }

    private var canApprovePlan: Bool {
        task.status == "Human Review" && !hasApprovedCurrentPlan && !isApproving
    }

    private func validationResult(
        for change: ProposedFileChange,
        in proposal: EditProposal
    ) -> FileChangeValidation? {
        proposal.validation?.fileResults.first { result in
            result.id == change.id || result.path == change.path
        }
    }

    private func validationRun(for id: String?) -> ValidationRun? {
        guard let id else {
            return nil
        }

        return task.validationRuns.first { run in
            run.id == id
        }
    }

    private func taskCommandRun(for id: String?) -> TaskCommandRun? {
        guard let id else {
            return nil
        }

        return task.taskCommandRuns.first { run in
            run.id == id
        }
    }

    private var approveButtonTitle: String {
        if isApproving {
            return "Approving"
        }

        if hasApprovedCurrentPlan {
            return "Plan Approved"
        }

        return "Approve Plan"
    }

    private var latestPlanRevision: PlanRevision? {
        task.planRevisions.last
    }

    private var hasApprovedCurrentPlan: Bool {
        task.approvals.contains { approval in
            approval.action == "Approve Plan" &&
                approval.decision == "Approved" &&
                approval.targetID == latestPlanRevision?.id
        }
    }

    private var isGeneratingEditProposal: Bool {
        workspace.isGeneratingEditProposal(taskID: task.id)
    }

    private var isGeneratingValidationRepairProposal: Bool {
        workspace.isGeneratingValidationRepairProposal(taskID: task.id)
    }

    private var isValidatingEditProposal: Bool {
        workspace.isValidatingEditProposal(taskID: task.id)
    }

    private var canGenerateEditProposal: Bool {
        task.executionProposal != nil &&
            (task.editProposal == nil || task.editProposal?.status == "Rejected") &&
            !isGeneratingEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isRejectingEditProposal
    }

    private var generateEditProposalButtonTitle: String {
        if isGeneratingEditProposal {
            return "Generating Edit Proposal"
        }

        if task.editProposal?.status == "Rejected" {
            return "Revise Edit Proposal"
        }

        if task.editProposal != nil {
            return "Edit Proposal Ready"
        }

        return "Generate Edit Proposal"
    }

    private var canValidateEditProposal: Bool {
        task.editProposal?.status == "Proposed" &&
            !isValidatingEditProposal &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isRejectingEditProposal
    }

    private var validateEditProposalButtonTitle: String {
        if isValidatingEditProposal {
            return "Validating Proposal"
        }

        if task.editProposal?.validation?.status == "Ready" {
            return "Validation Ready"
        }

        return "Validate Proposal"
    }

    private var isApplyingEditProposal: Bool {
        workspace.isApplyingEditProposal(taskID: task.id)
    }

    private var isRollingBackEditProposal: Bool {
        workspace.isRollingBackEditProposal(taskID: task.id)
    }

    private var isRejectingEditProposal: Bool {
        workspace.isRejectingEditProposal(taskID: task.id)
    }

    private var isRunningValidation: Bool {
        workspace.isRunningValidation(taskID: task.id)
    }

    private var projectValidationPermissions: [ValidationPresetPermission] {
        workspace.validationPermissions(for: task.id).filter { $0.preset.id != "forge-post-apply" }
    }

    private var canApplyEditProposal: Bool {
        task.editProposal?.status == "Proposed" &&
            validationAllowsApply &&
            !isValidatingEditProposal &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isRejectingEditProposal
    }

    private var applyEditProposalButtonTitle: String {
        if isApplyingEditProposal {
            return "Applying Edit Proposal"
        }

        if task.editProposal?.status == "Applied" {
            return "Edit Proposal Applied"
        }

        return "Apply Edit Proposal"
    }

    private var canRollbackEditProposal: Bool {
        task.editProposal?.status == "Applied" &&
            task.editProposal?.appliedFileChanges?.isEmpty == false &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal
    }

    private var rollbackEditProposalButtonTitle: String {
        if isRollingBackEditProposal {
            return "Rolling Back"
        }

        if task.editProposal?.status == "RolledBack" {
            return "Edit Proposal Rolled Back"
        }

        return "Rollback Edit Proposal"
    }

    private var validationAllowsApply: Bool {
        task.editProposal?.validation?.status != "Blocked"
    }

    private var canRejectEditProposal: Bool {
        task.editProposal?.status == "Proposed" &&
            !isApplyingEditProposal &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal &&
            !isRejectingEditProposal
    }

    private var rejectEditProposalButtonTitle: String {
        if isRejectingEditProposal {
            return "Requesting Changes"
        }

        if task.editProposal?.status == "Rejected" {
            return "Changes Requested"
        }

        return "Request Changes"
    }

    private var canRunValidation: Bool {
        task.editProposal?.status == "Applied" &&
            task.status != "Testing" &&
            !isRunningValidation &&
            !isRollingBackEditProposal &&
            !isGeneratingValidationRepairProposal
    }

    private var runValidationButtonTitle: String {
        if isRunningValidation {
            return "Running Validation"
        }

        if !task.validationRuns.isEmpty {
            return "Run Validation Again"
        }

        return "Run Validation"
    }

    private var latestFailedValidationRun: ValidationRun? {
        task.validationRuns.reversed().first { run in
            run.status == "Failed"
        }
    }

    private var latestFailedTaskCommandRun: TaskCommandRun? {
        task.taskCommandRuns.reversed().first { run in
            run.status == "Failed"
        }
    }

    private var latestValidationRepairBrief: ValidationRepairBrief? {
        guard let latestFailedValidationRun else {
            return nil
        }

        return task.validationRepairBriefs.reversed().first { brief in
            brief.validationRunID == latestFailedValidationRun.id
        }
    }

    private var latestTaskCommandRepairBrief: ValidationRepairBrief? {
        guard let latestFailedTaskCommandRun else {
            return nil
        }

        return task.validationRepairBriefs.reversed().first { brief in
            brief.taskCommandRunID == latestFailedTaskCommandRun.id
        }
    }

    private var latestRepairBrief: ValidationRepairBrief? {
        if let latestTaskCommandRepairBrief,
           latestFailedValidationRun == nil ||
            (latestFailedTaskCommandRun?.endedAt ?? latestFailedTaskCommandRun?.startedAt ?? "") >=
            (latestFailedValidationRun?.endedAt ?? latestFailedValidationRun?.startedAt ?? "") {
            return latestTaskCommandRepairBrief
        }

        return latestValidationRepairBrief ?? latestTaskCommandRepairBrief
    }

    private var canGenerateValidationRepairProposal: Bool {
        task.executionProposal != nil &&
            task.editProposal?.status != "Proposed" &&
            latestRepairBrief != nil &&
            !isGeneratingValidationRepairProposal &&
            !isGeneratingEditProposal &&
            !isValidatingEditProposal &&
            !isApplyingEditProposal &&
            !isRejectingEditProposal &&
            !isRunningValidation
    }

    private var generateValidationRepairProposalButtonTitle: String {
        if isGeneratingValidationRepairProposal {
            return "Generating Repair Proposal"
        }

        if task.editProposal?.validationRepairBriefID == latestRepairBrief?.id {
            return "Repair Proposal Ready"
        }

        if (latestFailedValidationRun != nil || latestFailedTaskCommandRun != nil) && latestRepairBrief == nil {
            return "Repair Brief Needed"
        }

        return "Generate Repair Proposal"
    }

    private func canApproveValidationPermission(_ permission: ValidationPresetPermission) -> Bool {
        permission.canApprove &&
            !workspace.isApprovingValidationPreset(taskID: task.id, presetID: permission.preset.id)
    }

    private func approvePermissionButtonTitle(_ permission: ValidationPresetPermission) -> String {
        if workspace.isApprovingValidationPreset(taskID: task.id, presetID: permission.preset.id) {
            return "Approving"
        }

        if permission.approvalState == "Approved" {
            return "Approved"
        }

        return "Approve Permission"
    }

    private func canRunValidationPermission(_ permission: ValidationPresetPermission) -> Bool {
        permission.canRun &&
            !workspace.isRunningValidation(taskID: task.id, presetID: permission.preset.id)
    }

    private func runPermissionButtonTitle(_ permission: ValidationPresetPermission) -> String {
        if workspace.isRunningValidation(taskID: task.id, presetID: permission.preset.id) {
            return "Running"
        }

        return "Run Preset"
    }

    private func validationSystemImage(_ status: String) -> String {
        status == "Ready" ? "checkmark.shield" : "exclamationmark.triangle"
    }

    private func statusSystemImage(_ status: String) -> String {
        switch status {
        case "Passed", "Ready", "Approved", "NotRequired":
            return "checkmark.circle"
        case "NeedsApproval":
            return "exclamationmark.shield"
        case "Failed", "Blocked":
            return "exclamationmark.triangle"
        case "Running":
            return "hourglass"
        default:
            return "circle"
        }
    }

    private var emptyChangedFilesMessage: String {
        if task.status == "Running" {
            return "No file changes yet. Controlled execution is open."
        }

        if task.status == "Testing" {
            return "Changes are being validated."
        }

        if task.status == "Human Review" {
            return "No file changes yet. Review the plan before approving execution."
        }

        return "No file changes yet."
    }
}

private struct GitWorkingTreeCard: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask

    @State private var selectedPath: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label("Working Tree", systemImage: "arrow.triangle.branch")
                    .font(.headline)

                Spacer()

                Button {
                    workspace.refreshGitStatus()
                } label: {
                    Label(refreshTitle, systemImage: "arrow.clockwise")
                }
                .labelStyle(.iconOnly)
                .disabled(workspace.isRefreshingGitStatus())
                .help("Refresh git status")
            }

            if let status = workspace.gitStatus {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Label(status.branch ?? "Detached", systemImage: status.isDirty ? "exclamationmark.circle" : "checkmark.circle")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(status.isDirty ? .orange : .green)

                        if let head = status.head {
                            Text(head)
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                        }

                        Spacer(minLength: 8)

                        Text("\(status.changedFiles.count) files")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                    }

                    Text(status.summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let upstream = status.upstream {
                        Label(upstreamDetail(upstream: upstream, ahead: status.ahead, behind: status.behind), systemImage: "arrow.up.arrow.down")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }

                if orderedChanges.isEmpty {
                    Label("Working tree is clean.", systemImage: "checkmark.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(orderedChanges.prefix(18)) { change in
                            GitFileChangeRow(
                                change: change,
                                isTaskChange: taskRelevantPaths.contains(change.path),
                                isSelected: activePath == change.path,
                                selectDiff: {
                                    selectedPath = change.path
                                    workspace.refreshGitDiff(path: change.path)
                                },
                                openFile: {
                                    workspace.openGitFile(path: change.path)
                                },
                                revealFile: {
                                    workspace.revealGitFile(path: change.path)
                                },
                                isLoadingDiff: workspace.isLoadingGitDiff(path: change.path)
                            )
                        }

                        if orderedChanges.count > 18 {
                            Text("\(orderedChanges.count - 18) more file(s) not shown.")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                if let activePath {
                    GitDiffCard(
                        path: activePath,
                        diff: workspace.gitDiff(for: activePath),
                        isLoading: workspace.isLoadingGitDiff(path: activePath),
                        load: {
                            workspace.refreshGitDiff(path: activePath)
                        }
                    )
                }

                GitBranchPreviewCard(
                    preview: workspace.gitBranchPreview(for: task.id),
                    result: workspace.gitBranchResult(for: task.id),
                    isLoading: workspace.isPreparingGitBranchReview(taskID: task.id),
                    isChangingBranch: workspace.isChangingGitBranch(taskID: task.id),
                    prepare: { targetBranch in
                        workspace.prepareGitBranchReview(for: task, targetBranch: targetBranch)
                    },
                    changeBranch: { preview in
                        workspace.createOrSwitchGitBranch(for: task, preview: preview)
                    }
                )

                GitBranchPublishPreviewCard(
                    preview: workspace.gitBranchPublishPreview(for: task.id),
                    result: workspace.gitBranchPublishResult(for: task.id),
                    isLoading: workspace.isPreparingGitBranchPublishReview(taskID: task.id),
                    isPublishing: workspace.isPublishingGitBranch(taskID: task.id),
                    prepare: { remote, remoteBranch in
                        workspace.prepareGitBranchPublishReview(
                            for: task,
                            remote: remote,
                            remoteBranch: remoteBranch
                        )
                    },
                    publish: { preview in
                        workspace.publishGitBranch(for: task, preview: preview)
                    }
                )

                GitCommitPreviewCard(
                    task: task,
                    preview: workspace.gitCommitPreview(for: task.id),
                    result: workspace.gitCommitResult(for: task.id),
                    isLoading: workspace.isPreparingGitCommitReview(taskID: task.id),
                    isCreatingCommit: workspace.isCreatingGitCommit(taskID: task.id),
                    prepare: {
                        workspace.prepareGitCommitReview(for: task)
                    },
                    createCommit: { preview in
                        workspace.createGitCommit(for: task, preview: preview)
                    }
                )

                GitPushPreviewCard(
                    preview: workspace.gitPushPreview(for: task.id),
                    result: workspace.gitPushResult(for: task.id),
                    isLoading: workspace.isPreparingGitPushReview(taskID: task.id),
                    isPushing: workspace.isPushingGitBranch(taskID: task.id),
                    prepare: {
                        workspace.prepareGitPushReview(for: task)
                    },
                    push: { preview in
                        workspace.pushGitBranch(for: task, preview: preview)
                    }
                )

                GitPullRequestPreviewCard(
                    preview: workspace.gitPullRequestPreview(for: task.id),
                    isLoading: workspace.isPreparingGitPullRequestReview(taskID: task.id),
                    prepare: {
                        workspace.prepareGitPullRequestReview(for: task)
                    }
                )
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Git status unavailable.", systemImage: "exclamationmark.triangle")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    if let error = workspace.gitStatusLastError {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Button {
                        workspace.refreshGitStatus()
                    } label: {
                        Label("Refresh Git Status", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(workspace.isRefreshingGitStatus())
                }
            }
        }
        .padding(10)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onAppear {
            if workspace.gitStatus == nil {
                workspace.refreshGitStatus()
            }
        }
    }

    private var orderedChanges: [GitFileChange] {
        guard let changes = workspace.gitStatus?.changedFiles else {
            return []
        }

        return changes.sorted { first, second in
            let firstRelevant = taskRelevantPaths.contains(first.path)
            let secondRelevant = taskRelevantPaths.contains(second.path)
            if firstRelevant != secondRelevant {
                return firstRelevant && !secondRelevant
            }

            return first.path.localizedStandardCompare(second.path) == .orderedAscending
        }
    }

    private var activePath: String? {
        if let selectedPath, orderedChanges.contains(where: { $0.path == selectedPath }) {
            return selectedPath
        }

        return orderedChanges.first?.path
    }

    private var taskRelevantPaths: Set<String> {
        var paths = Set(task.changedFiles)
        for change in task.editProposal?.fileChanges ?? [] {
            paths.insert(change.path)
        }
        return paths
    }

    private var refreshTitle: String {
        workspace.isRefreshingGitStatus() ? "Refreshing" : "Refresh"
    }

    private func upstreamDetail(upstream: String, ahead: Int?, behind: Int?) -> String {
        var parts = [upstream]
        if let ahead, ahead > 0 {
            parts.append("ahead \(ahead)")
        }
        if let behind, behind > 0 {
            parts.append("behind \(behind)")
        }
        return parts.joined(separator: " / ")
    }
}

private struct GitCommitPreviewCard: View {
    var task: ForgeTask
    var preview: GitCommitPreview?
    var result: GitCreateCommitResult?
    var isLoading: Bool
    var isCreatingCommit: Bool
    var prepare: () -> Void
    var createCommit: (GitCommitPreview) -> Void

    @State private var showCommitConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label("Commit Review", systemImage: "doc.badge.gearshape")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                if let preview {
                    Button {
                        showCommitConfirmation = true
                    } label: {
                        Label(isCreatingCommit ? "Committing" : "Commit", systemImage: "checkmark.seal")
                    }
                    .labelStyle(.iconOnly)
                    .disabled(!canCreateCommit(preview))
                    .help("Create local commit")
                }

                Button {
                    prepare()
                } label: {
                    Label(isLoading ? "Preparing" : "Prepare", systemImage: "doc.text.magnifyingglass")
                }
                .labelStyle(.iconOnly)
                .disabled(isLoading)
                .help("Prepare commit review")
            }

            if let preview {
                HStack(spacing: 8) {
                    Label(preview.readiness, systemImage: readinessImage)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(readinessColor)

                    Spacer(minLength: 8)

                    Text(preview.generatedAt)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                Text(preview.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let relatedTask = preview.relatedTask {
                    Label("\(relatedTask.title) / \(relatedTask.status) / \(relatedTask.currentPhase)", systemImage: "target")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                if let preflight = preview.preflight {
                    CommitPreflightCard(preflight: preflight)
                }

                VStack(alignment: .leading, spacing: 5) {
                    Text("Suggested Message")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)

                    Text(preview.suggestedTitle)
                        .font(.caption.monospaced().weight(.semibold))
                        .textSelection(.enabled)

                    ForEach(Array(preview.suggestedBody.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.background)
                .clipShape(RoundedRectangle(cornerRadius: 6))

                if !preview.blockers.isEmpty {
                    CommitPreviewNoteList(
                        title: "Blockers",
                        systemImage: "xmark.octagon",
                        notes: preview.blockers,
                        color: .red
                    )
                }

                if !preview.riskNotes.isEmpty {
                    CommitPreviewNoteList(
                        title: "Risk Notes",
                        systemImage: "exclamationmark.triangle",
                        notes: preview.riskNotes,
                        color: .orange
                    )
                }

                if !preview.validationCommands.isEmpty {
                    CommitPreviewNoteList(
                        title: "Suggested Validation",
                        systemImage: "checkmark.shield",
                        notes: preview.validationCommands,
                        color: .secondary
                    )
                }

                VStack(alignment: .leading, spacing: 5) {
                    Text("Included Files")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)

                    ForEach(preview.includedFiles.prefix(10)) { file in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(file.status)
                                .font(.caption2.weight(.medium))
                                .frame(width: 64, alignment: .leading)
                                .foregroundStyle(.secondary)

                            Text(file.path)
                                .font(.caption2.monospaced())
                                .lineLimit(1)

                            Spacer(minLength: 6)

                            if let additions = file.additions, let deletions = file.deletions {
                                Text("+\(additions) -\(deletions)")
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }

                    if preview.includedFiles.count > 10 {
                        Text("\(preview.includedFiles.count - 10) more file(s) in commit preview.")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }

                Label(preview.operationBoundary, systemImage: "lock.shield")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Button {
                    showCommitConfirmation = true
                } label: {
                    Label(createCommitButtonTitle(preview), systemImage: "checkmark.seal")
                        .frame(maxWidth: .infinity)
                }
                .disabled(!canCreateCommit(preview))
                .confirmationDialog(
                    "Create local git commit?",
                    isPresented: $showCommitConfirmation,
                    titleVisibility: .visible
                ) {
                    Button("Create Local Commit") {
                        createCommit(preview)
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("Forge will stage the listed files and create one local commit. It will not push, merge, reset, delete branches, or publish anything.")
                }
            } else if let result {
                CommitResultView(result: result)
            } else {
                Label(isLoading ? "Preparing commit review..." : "Commit review has not been prepared.", systemImage: isLoading ? "hourglass" : "doc.text.magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(.quaternary)
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }

    private var readinessImage: String {
        switch preview?.readiness {
        case "Ready":
            return "checkmark.circle"
        case "Blocked":
            return "xmark.octagon"
        default:
            return "exclamationmark.triangle"
        }
    }

    private var readinessColor: Color {
        switch preview?.readiness {
        case "Ready":
            return .green
        case "Blocked":
            return .red
        default:
            return .orange
        }
    }

    private func canCreateCommit(_ preview: GitCommitPreview) -> Bool {
        !isCreatingCommit &&
            !isLoading &&
            preview.expectedHead != nil &&
            preview.blockers.isEmpty &&
            !preview.includedFiles.isEmpty
    }

    private func createCommitButtonTitle(_ preview: GitCommitPreview) -> String {
        if isCreatingCommit {
            return "Creating Commit"
        }

        if preview.blockers.isEmpty {
            return "Create Local Commit"
        }

        return "Commit Blocked"
    }
}

private struct GitBranchPreviewCard: View {
    var preview: GitBranchPreview?
    var result: GitBranchResult?
    var isLoading: Bool
    var isChangingBranch: Bool
    var prepare: (String?) -> Void
    var changeBranch: (GitBranchPreview) -> Void

    @State private var targetBranch = ""
    @State private var showBranchConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label("Branch Review", systemImage: "arrow.triangle.branch")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                if let preview {
                    Button {
                        showBranchConfirmation = true
                    } label: {
                        Label(actionButtonTitle(preview), systemImage: actionImage(for: preview))
                    }
                    .labelStyle(.iconOnly)
                    .disabled(!canChangeBranch(preview))
                    .help(actionHelp(for: preview))
                }

                Button {
                    prepare(preparedTargetBranch)
                } label: {
                    Label(isLoading ? "Preparing" : "Prepare", systemImage: "doc.text.magnifyingglass")
                }
                .labelStyle(.iconOnly)
                .disabled(isLoading || isChangingBranch)
                .help("Prepare branch review")
            }

            HStack(spacing: 6) {
                TextField("forge/task-branch", text: $targetBranch)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
                Button {
                    prepare(preparedTargetBranch)
                } label: {
                    Label("Review", systemImage: "arrow.clockwise")
                }
                .labelStyle(.iconOnly)
                .disabled(isLoading || isChangingBranch)
                .help("Review target branch")
            }

            if let preview {
                HStack(spacing: 8) {
                    Label(preview.readiness, systemImage: readinessImage(for: preview))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(readinessColor(for: preview))

                    Spacer(minLength: 8)

                    Text(preview.generatedAt)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                Text(preview.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Label(preview.currentBranch ?? "Detached", systemImage: "arrow.triangle.branch")
                    Label(preview.targetBranch, systemImage: preview.branchExists ? "folder" : "plus.circle")
                    Spacer()
                    Text(preview.mode)
                }
                .font(.caption2)
                .foregroundStyle(.secondary)

                if let preflight = preview.preflight {
                    BranchPreflightCard(preflight: preflight)
                }

                if let relatedTask = preview.relatedTask {
                    Label("\(relatedTask.title) / \(relatedTask.status) / \(relatedTask.currentPhase)", systemImage: "target")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                if !preview.blockers.isEmpty {
                    CommitPreviewNoteList(
                        title: "Blockers",
                        systemImage: "xmark.octagon",
                        notes: preview.blockers,
                        color: .red
                    )
                }

                if !preview.riskNotes.isEmpty {
                    CommitPreviewNoteList(
                        title: "Risk Notes",
                        systemImage: "exclamationmark.triangle",
                        notes: preview.riskNotes,
                        color: .orange
                    )
                }

                if preview.isDirty && !preview.changedFiles.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Working Tree")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)

                        ForEach(preview.changedFiles.prefix(6)) { file in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(file.status)
                                    .font(.caption2.weight(.medium))
                                    .frame(width: 64, alignment: .leading)
                                    .foregroundStyle(.secondary)
                                Text(file.path)
                                    .font(.caption2.monospaced())
                                    .lineLimit(1)
                                Spacer(minLength: 6)
                            }
                        }

                        if preview.changedFiles.count > 6 {
                            Text("\(preview.changedFiles.count - 6) more file(s) not shown.")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                Label(preview.operationBoundary, systemImage: "lock.shield")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Button {
                    showBranchConfirmation = true
                } label: {
                    Label(actionButtonTitle(preview), systemImage: actionImage(for: preview))
                        .frame(maxWidth: .infinity)
                }
                .disabled(!canChangeBranch(preview))
                .confirmationDialog(
                    confirmationTitle(for: preview),
                    isPresented: $showBranchConfirmation,
                    titleVisibility: .visible
                ) {
                    Button(confirmationButtonTitle(for: preview)) {
                        changeBranch(preview)
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text(confirmationMessage(for: preview))
                }
            } else if let result {
                BranchResultView(result: result)
            } else {
                Label(isLoading ? "Preparing branch review..." : "Branch review has not been prepared.", systemImage: isLoading ? "hourglass" : "arrow.triangle.branch")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(.quaternary)
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }

    private var preparedTargetBranch: String? {
        let trimmed = targetBranch.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func canChangeBranch(_ preview: GitBranchPreview) -> Bool {
        !isChangingBranch &&
            !isLoading &&
            preview.expectedHead != nil &&
            preview.currentBranch != nil &&
            preview.blockers.isEmpty &&
            (preview.mode == "CreateBranch" || preview.mode == "SwitchBranch")
    }

    private func actionButtonTitle(_ preview: GitBranchPreview) -> String {
        if isChangingBranch {
            return "Changing Branch"
        }

        switch preview.mode {
        case "CreateBranch":
            return preview.blockers.isEmpty ? "Create Branch" : "Branch Blocked"
        case "SwitchBranch":
            return preview.blockers.isEmpty ? "Switch Branch" : "Branch Blocked"
        default:
            return "No Branch Action"
        }
    }

    private func actionImage(for preview: GitBranchPreview) -> String {
        preview.mode == "SwitchBranch" ? "arrow.left.arrow.right" : "plus.circle"
    }

    private func actionHelp(for preview: GitBranchPreview) -> String {
        preview.mode == "SwitchBranch" ? "Switch to branch" : "Create branch"
    }

    private func confirmationTitle(for preview: GitBranchPreview) -> String {
        preview.mode == "SwitchBranch" ? "Switch git branch?" : "Create git branch?"
    }

    private func confirmationButtonTitle(for preview: GitBranchPreview) -> String {
        preview.mode == "SwitchBranch" ? "Switch Branch" : "Create Branch"
    }

    private func confirmationMessage(for preview: GitBranchPreview) -> String {
        if preview.mode == "SwitchBranch" {
            return "Forge will switch to the existing local branch \(preview.targetBranch). It will not commit, push, reset, delete branches, or publish a PR."
        }

        return "Forge will create and switch to \(preview.targetBranch) from the current HEAD. It will not commit, push, reset, delete branches, or publish a PR."
    }

    private func readinessImage(for preview: GitBranchPreview) -> String {
        switch preview.readiness {
        case "Ready":
            return "checkmark.circle"
        case "Blocked":
            return "xmark.octagon"
        default:
            return "exclamationmark.triangle"
        }
    }

    private func readinessColor(for preview: GitBranchPreview) -> Color {
        switch preview.readiness {
        case "Ready":
            return .green
        case "Blocked":
            return .red
        default:
            return .orange
        }
    }
}

private struct BranchPreflightCard: View {
    var preflight: GitBranchPreflight

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("Preflight", systemImage: "checklist")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Text(preflight.actionReadinessSummary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            VStack(alignment: .leading, spacing: 5) {
                BranchPreflightStatusRow(
                    title: "Target",
                    status: preflight.targetStatus,
                    summary: preflight.targetSummary
                )
                BranchPreflightStatusRow(
                    title: "Current",
                    status: preflight.currentBranchStatus,
                    summary: preflight.currentBranchSummary
                )
                BranchPreflightStatusRow(
                    title: "Worktree",
                    status: preflight.worktreeStatus,
                    summary: preflight.worktreeSummary
                )
                BranchPreflightStatusRow(
                    title: "Existing",
                    status: preflight.existingBranchStatus,
                    summary: preflight.existingBranchSummary
                )
                BranchPreflightStatusRow(
                    title: "Action",
                    status: preflight.actionReadiness,
                    summary: preflight.actionReadinessSummary
                )
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct BranchPreflightStatusRow: View {
    var title: String
    var status: String
    var summary: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Label(status, systemImage: statusImage(for: status))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(statusColor(for: status))
                .frame(width: 108, alignment: .leading)

            Text(title)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(width: 62, alignment: .leading)

            Text(summary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .textSelection(.enabled)

            Spacer(minLength: 4)
        }
    }

    private func statusImage(for status: String) -> String {
        switch status {
        case "Valid", "Ready", "Clean", "NewLocal":
            return "checkmark.circle"
        case "Invalid", "DefaultBranch", "CurrentBranch", "Detached", "Unknown", "DirtyBlocked", "Blocked":
            return "xmark.octagon"
        default:
            return "exclamationmark.triangle"
        }
    }

    private func statusColor(for status: String) -> Color {
        switch status {
        case "Valid", "Ready", "Clean", "NewLocal":
            return .green
        case "Invalid", "DefaultBranch", "CurrentBranch", "Detached", "Unknown", "DirtyBlocked", "Blocked":
            return .red
        default:
            return .orange
        }
    }
}

private struct BranchResultView: View {
    var result: GitBranchResult

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(result.summary, systemImage: result.mode == "SwitchBranch" ? "arrow.left.arrow.right" : "plus.circle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.green)

            HStack(spacing: 8) {
                if let previousBranch = result.previousBranch {
                    Text(previousBranch)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }

                Text(result.branch)
                    .font(.caption2.monospaced().weight(.semibold))
                    .textSelection(.enabled)

                Spacer()

                Text(result.mode)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Text(result.outputSummary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            Label(result.operationBoundary, systemImage: "lock.shield")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct CommitPreflightCard: View {
    var preflight: GitCommitPreflight

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Label(preflight.identityStatus, systemImage: identityImage)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(identityColor)

                Spacer()

                Text(preflight.validationState)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(validationColor)
            }

            Text(preflight.identitySummary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            HStack(spacing: 8) {
                Label("\(preflight.stagedFileCount) staged", systemImage: "tray.full")
                Label("\(preflight.unstagedFileCount) unstaged", systemImage: "tray")
                Label("\(preflight.untrackedFileCount) untracked", systemImage: "plus.square")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                Label("+\(preflight.totalAdditions)", systemImage: "plus")
                Label("-\(preflight.totalDeletions)", systemImage: "minus")
                if preflight.filesWithoutStats > 0 {
                    Label("\(preflight.filesWithoutStats) no stats", systemImage: "questionmark.square")
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)

            if preflight.largeChangeSet, let largeChangeSummary = preflight.largeChangeSummary {
                Label(largeChangeSummary, systemImage: "exclamationmark.triangle")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }

            Label(preflight.hookRiskSummary, systemImage: "curlybraces")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private var identityImage: String {
        switch preflight.identityStatus {
        case "Ready":
            return "person.crop.circle.badge.checkmark"
        case "Missing":
            return "person.crop.circle.badge.exclamationmark"
        default:
            return "questionmark.circle"
        }
    }

    private var identityColor: Color {
        switch preflight.identityStatus {
        case "Ready":
            return .green
        case "Missing":
            return .red
        default:
            return .orange
        }
    }

    private var validationColor: Color {
        switch preflight.validationState {
        case "Passed":
            return .green
        case "Failed":
            return .red
        case "Missing":
            return .orange
        default:
            return .secondary
        }
    }
}

private struct GitBranchPublishPreviewCard: View {
    var preview: GitBranchPublishPreview?
    var result: GitBranchPublishResult?
    var isLoading: Bool
    var isPublishing: Bool
    var prepare: (String?, String?) -> Void
    var publish: (GitBranchPublishPreview) -> Void

    @State private var remote = ""
    @State private var remoteBranch = ""
    @State private var showPublishConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label("Publish Review", systemImage: "arrow.up.right.circle")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                if let preview {
                    Button {
                        showPublishConfirmation = true
                    } label: {
                        Label(publishButtonTitle(preview), systemImage: "paperplane")
                    }
                    .labelStyle(.iconOnly)
                    .disabled(!canPublish(preview))
                    .help("Publish branch and set upstream")
                }

                Button {
                    prepare(preparedRemote, preparedRemoteBranch)
                } label: {
                    Label(isLoading ? "Preparing" : "Prepare", systemImage: "network")
                }
                .labelStyle(.iconOnly)
                .disabled(isLoading || isPublishing)
                .help("Prepare branch publish review")
            }

            HStack(spacing: 6) {
                TextField("origin", text: $remote)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
                TextField("remote branch", text: $remoteBranch)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
                Button {
                    prepare(preparedRemote, preparedRemoteBranch)
                } label: {
                    Label("Review", systemImage: "arrow.clockwise")
                }
                .labelStyle(.iconOnly)
                .disabled(isLoading || isPublishing)
                .help("Review branch publish target")
            }

            if let preview {
                HStack(spacing: 8) {
                    Label(preview.readiness, systemImage: readinessImage(for: preview))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(readinessColor(for: preview))

                    Spacer(minLength: 8)

                    Text(preview.generatedAt)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                Text(preview.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Label(preview.branch ?? "Detached", systemImage: "arrow.triangle.branch")
                    Label(preview.remote ?? "No remote", systemImage: "network")
                    Label(preview.remoteBranch ?? "No remote branch", systemImage: "arrow.up.right")
                    Spacer()
                    Text(preview.upstream ?? "no upstream")
                }
                .font(.caption2)
                .foregroundStyle(.secondary)

                if let preflight = preview.preflight {
                    BranchPublishPreflightCard(preflight: preflight)
                }

                if let relatedTask = preview.relatedTask {
                    Label("\(relatedTask.title) / \(relatedTask.status) / \(relatedTask.currentPhase)", systemImage: "target")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                if !preview.blockers.isEmpty {
                    CommitPreviewNoteList(
                        title: "Blockers",
                        systemImage: "xmark.octagon",
                        notes: preview.blockers,
                        color: .red
                    )
                }

                if !preview.riskNotes.isEmpty {
                    CommitPreviewNoteList(
                        title: "Risk Notes",
                        systemImage: "exclamationmark.triangle",
                        notes: preview.riskNotes,
                        color: .orange
                    )
                }

                if !preview.commitsToPublish.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Commits To Publish")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)

                        ForEach(preview.commitsToPublish.prefix(8)) { commit in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(commit.shortHash)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                                Text(commit.title)
                                    .font(.caption2)
                                    .lineLimit(1)
                                Spacer(minLength: 6)
                            }
                        }

                        if preview.commitsToPublish.count > 8 {
                            Text("\(preview.commitsToPublish.count - 8) more commit(s) not shown.")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                if preview.isDirty && !preview.changedFiles.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Local Changes Not Published")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)

                        ForEach(preview.changedFiles.prefix(5)) { file in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(file.status)
                                    .font(.caption2.weight(.medium))
                                    .frame(width: 64, alignment: .leading)
                                    .foregroundStyle(.secondary)
                                Text(file.path)
                                    .font(.caption2.monospaced())
                                    .lineLimit(1)
                                Spacer(minLength: 6)
                            }
                        }
                    }
                }

                Label(preview.operationBoundary, systemImage: "lock.shield")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Button {
                    showPublishConfirmation = true
                } label: {
                    Label(publishButtonTitle(preview), systemImage: "paperplane")
                        .frame(maxWidth: .infinity)
                }
                .disabled(!canPublish(preview))
                .confirmationDialog(
                    "Publish current branch?",
                    isPresented: $showPublishConfirmation,
                    titleVisibility: .visible
                ) {
                    Button("Publish Current Branch") {
                        publish(preview)
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("Forge will push the listed commits and set upstream for this branch. It will not force push, merge, reset, delete branches, or create a PR.")
                }
            } else if let result {
                BranchPublishResultView(result: result)
            } else {
                Label(isLoading ? "Preparing branch publish review..." : "Branch publish review has not been prepared.", systemImage: isLoading ? "hourglass" : "arrow.up.right.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(.quaternary)
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }

    private var preparedRemote: String? {
        let trimmed = remote.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private var preparedRemoteBranch: String? {
        let trimmed = remoteBranch.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func canPublish(_ preview: GitBranchPublishPreview) -> Bool {
        !isPublishing &&
            !isLoading &&
            preview.expectedHead != nil &&
            preview.branch != nil &&
            preview.remote != nil &&
            preview.remoteBranch != nil &&
            preview.blockers.isEmpty &&
            !preview.commitsToPublish.isEmpty
    }

    private func publishButtonTitle(_ preview: GitBranchPublishPreview) -> String {
        if isPublishing {
            return "Publishing Branch"
        }

        return preview.blockers.isEmpty ? "Publish Branch" : "Publish Blocked"
    }

    private func readinessImage(for preview: GitBranchPublishPreview) -> String {
        switch preview.readiness {
        case "Ready":
            return "checkmark.circle"
        case "Blocked":
            return "xmark.octagon"
        default:
            return "exclamationmark.triangle"
        }
    }

    private func readinessColor(for preview: GitBranchPublishPreview) -> Color {
        switch preview.readiness {
        case "Ready":
            return .green
        case "Blocked":
            return .red
        default:
            return .orange
        }
    }
}

private struct BranchPublishPreflightCard: View {
    var preflight: GitBranchPublishPreflight

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("Preflight", systemImage: "checklist")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Text(preflight.actionReadinessSummary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            VStack(alignment: .leading, spacing: 5) {
                GitTransportPreflightStatusRow(title: "Branch", status: preflight.branchStatus, summary: preflight.branchSummary)
                GitTransportPreflightStatusRow(title: "Remote", status: preflight.remoteStatus, summary: preflight.remoteSummary)
                GitTransportPreflightStatusRow(title: "Base", status: preflight.baseStatus, summary: preflight.baseSummary)
                GitTransportPreflightStatusRow(title: "Commits", status: preflight.commitStatus, summary: preflight.commitSummary)
                GitTransportPreflightStatusRow(title: "Worktree", status: preflight.worktreeStatus, summary: preflight.worktreeSummary)
                GitTransportPreflightStatusRow(title: "Action", status: preflight.actionReadiness, summary: preflight.actionReadinessSummary)
            }

            Label(preflight.failureRiskSummary, systemImage: "exclamationmark.shield")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .textSelection(.enabled)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct BranchPublishResultView: View {
    var result: GitBranchPublishResult

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(result.summary, systemImage: "paperplane")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.green)

            HStack(spacing: 8) {
                Text(result.branch)
                    .font(.caption2.monospaced())
                Text(result.upstream)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(result.pushedCommits.count) commits")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Text(result.outputSummary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            Label(result.operationBoundary, systemImage: "lock.shield")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct CommitPreviewNoteList: View {
    var title: String
    var systemImage: String
    var notes: [String]
    var color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)

            ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
                Text(note)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CommitResultView: View {
    var result: GitCreateCommitResult

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(result.summary, systemImage: "checkmark.seal")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.green)

            Text(result.messageTitle)
                .font(.caption.monospaced().weight(.semibold))
                .textSelection(.enabled)

            HStack(spacing: 8) {
                Text(result.shortHash)
                    .font(.caption2.monospaced())
                    .textSelection(.enabled)

                if let branch = result.branch {
                    Text(branch)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text("\(result.committedFiles.count) files")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Label(result.operationBoundary, systemImage: "lock.shield")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct GitPushPreviewCard: View {
    var preview: GitPushPreview?
    var result: GitPushResult?
    var isLoading: Bool
    var isPushing: Bool
    var prepare: () -> Void
    var push: (GitPushPreview) -> Void

    @State private var showPushConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label("Push Review", systemImage: "arrow.up.circle")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                if let preview {
                    Button {
                        showPushConfirmation = true
                    } label: {
                        Label(isPushing ? "Pushing" : "Push", systemImage: "paperplane")
                    }
                    .labelStyle(.iconOnly)
                    .disabled(!canPush(preview))
                    .help("Push current branch")
                }

                Button {
                    prepare()
                } label: {
                    Label(isLoading ? "Preparing" : "Prepare", systemImage: "arrow.triangle.branch")
                }
                .labelStyle(.iconOnly)
                .disabled(isLoading || isPushing)
                .help("Prepare push review")
            }

            if let preview {
                HStack(spacing: 8) {
                    Label(preview.readiness, systemImage: readinessImage(for: preview))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(readinessColor(for: preview))

                    Spacer(minLength: 8)

                    Text(preview.generatedAt)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                Text(preview.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Label(preview.branch ?? "Detached", systemImage: "arrow.triangle.branch")
                    Label(preview.upstream ?? "No upstream", systemImage: "network")
                    Spacer()
                    Text("ahead \(preview.ahead ?? 0) / behind \(preview.behind ?? 0)")
                }
                .font(.caption2)
                .foregroundStyle(.secondary)

                if let preflight = preview.preflight {
                    PushPreflightCard(preflight: preflight)
                }

                if !preview.blockers.isEmpty {
                    CommitPreviewNoteList(
                        title: "Blockers",
                        systemImage: "xmark.octagon",
                        notes: preview.blockers,
                        color: .red
                    )
                }

                if !preview.riskNotes.isEmpty {
                    CommitPreviewNoteList(
                        title: "Risk Notes",
                        systemImage: "exclamationmark.triangle",
                        notes: preview.riskNotes,
                        color: .orange
                    )
                }

                if !preview.commitsToPush.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Commits To Push")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)

                        ForEach(preview.commitsToPush.prefix(8)) { commit in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(commit.shortHash)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                                Text(commit.title)
                                    .font(.caption2)
                                    .lineLimit(1)
                                Spacer(minLength: 6)
                            }
                        }

                        if preview.commitsToPush.count > 8 {
                            Text("\(preview.commitsToPush.count - 8) more commit(s) not shown.")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                Label(preview.operationBoundary, systemImage: "lock.shield")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Button {
                    showPushConfirmation = true
                } label: {
                    Label(pushButtonTitle(preview), systemImage: "paperplane")
                        .frame(maxWidth: .infinity)
                }
                .disabled(!canPush(preview))
                .confirmationDialog(
                    "Push current branch?",
                    isPresented: $showPushConfirmation,
                    titleVisibility: .visible
                ) {
                    Button("Push Current Branch") {
                        push(preview)
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("Forge will push the listed local commits to the configured upstream. It will not force push, merge, reset, delete branches, or create a PR.")
                }
            } else if let result {
                PushResultView(result: result)
            } else {
                Label(isLoading ? "Preparing push review..." : "Push review has not been prepared.", systemImage: isLoading ? "hourglass" : "arrow.up.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(.quaternary)
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }

    private func canPush(_ preview: GitPushPreview) -> Bool {
        !isPushing &&
            !isLoading &&
            preview.expectedHead != nil &&
            preview.branch != nil &&
            preview.upstream != nil &&
            preview.blockers.isEmpty &&
            !preview.commitsToPush.isEmpty
    }

    private func pushButtonTitle(_ preview: GitPushPreview) -> String {
        if isPushing {
            return "Pushing Branch"
        }

        return preview.blockers.isEmpty ? "Push Current Branch" : "Push Blocked"
    }

    private func readinessImage(for preview: GitPushPreview) -> String {
        switch preview.readiness {
        case "Ready":
            return "checkmark.circle"
        case "Blocked":
            return "xmark.octagon"
        default:
            return "exclamationmark.triangle"
        }
    }

    private func readinessColor(for preview: GitPushPreview) -> Color {
        switch preview.readiness {
        case "Ready":
            return .green
        case "Blocked":
            return .red
        default:
            return .orange
        }
    }
}

private struct PushPreflightCard: View {
    var preflight: GitPushPreflight

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("Preflight", systemImage: "checklist")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Text(preflight.actionReadinessSummary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            VStack(alignment: .leading, spacing: 5) {
                GitTransportPreflightStatusRow(title: "Branch", status: preflight.branchStatus, summary: preflight.branchSummary)
                GitTransportPreflightStatusRow(title: "Upstream", status: preflight.upstreamStatus, summary: preflight.upstreamSummary)
                GitTransportPreflightStatusRow(title: "Remote", status: preflight.remoteStatus, summary: preflight.remoteSummary)
                GitTransportPreflightStatusRow(title: "Commits", status: preflight.commitStatus, summary: preflight.commitSummary)
                GitTransportPreflightStatusRow(title: "Worktree", status: preflight.worktreeStatus, summary: preflight.worktreeSummary)
                GitTransportPreflightStatusRow(title: "Action", status: preflight.actionReadiness, summary: preflight.actionReadinessSummary)
            }

            Label(preflight.failureRiskSummary, systemImage: "exclamationmark.shield")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .textSelection(.enabled)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct GitTransportPreflightStatusRow: View {
    var title: String
    var status: String
    var summary: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Label(status, systemImage: statusImage(for: status))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(statusColor(for: status))
                .frame(width: 112, alignment: .leading)

            Text(title)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(width: 66, alignment: .leading)

            Text(summary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .textSelection(.enabled)

            Spacer(minLength: 4)
        }
    }

    private func statusImage(for status: String) -> String {
        switch status {
        case "Ready", "Resolved", "Clean":
            return "checkmark.circle"
        case "Missing", "Unknown", "Detached", "DefaultBranch", "AlreadyTracking", "RemoteCollision", "Empty", "Behind", "NoAhead", "Blocked":
            return "xmark.octagon"
        default:
            return "exclamationmark.triangle"
        }
    }

    private func statusColor(for status: String) -> Color {
        switch status {
        case "Ready", "Resolved", "Clean":
            return .green
        case "Missing", "Unknown", "Detached", "DefaultBranch", "AlreadyTracking", "RemoteCollision", "Empty", "Behind", "NoAhead", "Blocked":
            return .red
        default:
            return .orange
        }
    }
}

private struct PushResultView: View {
    var result: GitPushResult

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(result.summary, systemImage: "paperplane")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.green)

            HStack(spacing: 8) {
                Text(result.branch)
                    .font(.caption2.monospaced())
                Text(result.upstream)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(result.pushedCommits.count) commits")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Text(result.outputSummary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            Label(result.operationBoundary, systemImage: "lock.shield")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct GitPullRequestPreviewCard: View {
    var preview: GitPullRequestPreview?
    var isLoading: Bool
    var prepare: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label("PR Handoff", systemImage: "arrow.triangle.pull")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                Button {
                    prepare()
                } label: {
                    Label(isLoading ? "Preparing" : "Prepare", systemImage: "doc.text.magnifyingglass")
                }
                .labelStyle(.iconOnly)
                .disabled(isLoading)
                .help("Prepare PR handoff review")
            }

            if let preview {
                HStack(spacing: 8) {
                    Label(preview.readiness, systemImage: readinessImage(for: preview))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(readinessColor(for: preview))

                    Spacer(minLength: 8)

                    Text(preview.generatedAt)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                Text(preview.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Label(preview.headBranch ?? "Detached", systemImage: "arrow.triangle.branch")
                    Label(preview.baseBranch, systemImage: "target")
                    Spacer()
                    Text(preview.upstream ?? "No upstream")
                }
                .font(.caption2)
                .foregroundStyle(.secondary)

                if let preflight = preview.preflight {
                    PullRequestPreflightCard(preflight: preflight)
                }

                VStack(alignment: .leading, spacing: 5) {
                    Text("Suggested PR")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)

                    Text(preview.title)
                        .font(.caption.monospaced().weight(.semibold))
                        .textSelection(.enabled)

                    Label(preview.suggestedBranchName, systemImage: "arrow.triangle.branch")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.background)
                .clipShape(RoundedRectangle(cornerRadius: 6))

                if !preview.blockers.isEmpty {
                    CommitPreviewNoteList(
                        title: "Blockers",
                        systemImage: "xmark.octagon",
                        notes: preview.blockers,
                        color: .red
                    )
                }

                if !preview.riskNotes.isEmpty {
                    CommitPreviewNoteList(
                        title: "Risk Notes",
                        systemImage: "exclamationmark.triangle",
                        notes: preview.riskNotes,
                        color: .orange
                    )
                }

                if !preview.testPlan.isEmpty {
                    CommitPreviewNoteList(
                        title: "Test Plan",
                        systemImage: "checkmark.shield",
                        notes: preview.testPlan,
                        color: .secondary
                    )
                }

                if !preview.commits.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Commits")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)

                        ForEach(preview.commits.prefix(8)) { commit in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(commit.shortHash)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                                Text(commit.title)
                                    .font(.caption2)
                                    .lineLimit(1)
                                Spacer(minLength: 6)
                            }
                        }

                        if preview.commits.count > 8 {
                            Text("\(preview.commits.count - 8) more commit(s) not shown.")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                if !preview.changedFiles.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Files")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)

                        ForEach(preview.changedFiles.prefix(8)) { file in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(file.status)
                                    .font(.caption2.weight(.medium))
                                    .frame(width: 64, alignment: .leading)
                                    .foregroundStyle(.secondary)

                                Text(file.path)
                                    .font(.caption2.monospaced())
                                    .lineLimit(1)

                                Spacer(minLength: 6)

                                if let additions = file.additions, let deletions = file.deletions {
                                    Text("+\(additions) -\(deletions)")
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }

                        if preview.changedFiles.count > 8 {
                            Text("\(preview.changedFiles.count - 8) more file(s) not shown.")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Draft Body")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)

                    ForEach(Array(preview.body.prefix(18).enumerated()), id: \.offset) { _, line in
                        Text(line.isEmpty ? " " : line)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }

                    if preview.body.count > 18 {
                        Text("\(preview.body.count - 18) more line(s) not shown.")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.background)
                .clipShape(RoundedRectangle(cornerRadius: 6))

                Label(preview.operationBoundary, systemImage: "lock.shield")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            } else {
                Label(isLoading ? "Preparing PR handoff..." : "PR handoff has not been prepared.", systemImage: isLoading ? "hourglass" : "arrow.triangle.pull")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(.quaternary)
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }

    private func readinessImage(for preview: GitPullRequestPreview) -> String {
        switch preview.readiness {
        case "Ready":
            return "checkmark.circle"
        case "Blocked":
            return "xmark.octagon"
        default:
            return "exclamationmark.triangle"
        }
    }

    private func readinessColor(for preview: GitPullRequestPreview) -> Color {
        switch preview.readiness {
        case "Ready":
            return .green
        case "Blocked":
            return .red
        default:
            return .orange
        }
    }
}

private struct PullRequestPreflightCard: View {
    var preflight: GitPullRequestPreflight

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("Preflight", systemImage: "checklist")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Text(preflight.publishReadinessSummary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            VStack(alignment: .leading, spacing: 5) {
                PullRequestPreflightStatusRow(
                    title: "Base",
                    status: preflight.baseRefStatus,
                    summary: preflight.baseRefSummary
                )
                PullRequestPreflightStatusRow(
                    title: "Head",
                    status: preflight.headBranchStatus,
                    summary: preflight.headBranchSummary
                )
                PullRequestPreflightStatusRow(
                    title: "Upstream",
                    status: preflight.upstreamStatus,
                    summary: preflight.upstreamSummary
                )
                PullRequestPreflightStatusRow(
                    title: "Remote",
                    status: preflight.remoteStatus,
                    summary: preflight.remoteSummary
                )
                PullRequestPreflightStatusRow(
                    title: "Validation",
                    status: preflight.validationState,
                    summary: preflight.validationSummary
                )
            }

            if !preflight.testEvidence.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Evidence")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)

                    ForEach(Array(preflight.testEvidence.prefix(5).enumerated()), id: \.offset) { _, evidence in
                        Text(evidence)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }

                    if preflight.testEvidence.count > 5 {
                        Text("\(preflight.testEvidence.count - 5) more evidence line(s) not shown.")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct PullRequestPreflightStatusRow: View {
    var title: String
    var status: String
    var summary: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Label(status, systemImage: statusImage(for: status))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(statusColor(for: status))
                .frame(width: 94, alignment: .leading)

            Text(title)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(width: 64, alignment: .leading)

            Text(summary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .textSelection(.enabled)

            Spacer(minLength: 4)
        }
    }

    private func statusImage(for status: String) -> String {
        switch status {
        case "Ready", "Resolved", "Passed":
            return "checkmark.circle"
        case "Missing", "Detached", "DefaultBranch", "Unpushed", "Behind", "Failed":
            return "xmark.octagon"
        default:
            return "exclamationmark.triangle"
        }
    }

    private func statusColor(for status: String) -> Color {
        switch status {
        case "Ready", "Resolved", "Passed":
            return .green
        case "Missing", "Detached", "DefaultBranch", "Unpushed", "Behind", "Failed":
            return .red
        default:
            return .orange
        }
    }
}

private struct GitFileChangeRow: View {
    var change: GitFileChange
    var isTaskChange: Bool
    var isSelected: Bool
    var selectDiff: () -> Void
    var openFile: () -> Void
    var revealFile: () -> Void
    var isLoadingDiff: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: statusImage)
                    .foregroundStyle(statusColor)
                    .frame(width: 16)

                VStack(alignment: .leading, spacing: 2) {
                    Text(change.path)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        Text(change.status)
                        Text("index \(change.indexStatus) / worktree \(change.worktreeStatus)")
                        if let additions = change.additions, let deletions = change.deletions {
                            Text("+\(additions) -\(deletions)")
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }

                Spacer(minLength: 8)

                if isTaskChange {
                    Image(systemName: "target")
                        .font(.caption)
                        .foregroundStyle(.blue)
                        .help("Related to the selected task")
                }
            }

            HStack(spacing: 8) {
                Button {
                    selectDiff()
                } label: {
                    Label(isLoadingDiff ? "Loading" : "Diff", systemImage: isSelected ? "doc.text.magnifyingglass" : "doc.text")
                        .frame(maxWidth: .infinity)
                }
                .disabled(isLoadingDiff)

                Button {
                    openFile()
                } label: {
                    Label("Open", systemImage: "arrow.up.forward.app")
                        .frame(maxWidth: .infinity)
                }
                .disabled(change.status == "Deleted")

                Button {
                    revealFile()
                } label: {
                    Label("Reveal", systemImage: "folder")
                        .frame(maxWidth: .infinity)
                }
            }
            .font(.caption)
        }
        .padding(8)
        .background(isSelected ? Color.secondary.opacity(0.16) : Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }

    private var statusImage: String {
        switch change.status {
        case "Added", "Untracked":
            return "doc.badge.plus"
        case "Deleted":
            return "doc.badge.minus"
        case "Renamed", "Copied":
            return "arrow.triangle.2.circlepath"
        case "Unmerged":
            return "exclamationmark.triangle"
        default:
            return "doc.text"
        }
    }

    private var statusColor: Color {
        switch change.status {
        case "Added", "Untracked":
            return .green
        case "Deleted", "Unmerged":
            return .orange
        case "Renamed", "Copied":
            return .blue
        default:
            return .secondary
        }
    }
}

private struct GitDiffCard: View {
    var path: String
    var diff: GitFileDiff?
    var isLoading: Bool
    var load: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label("Diff Preview", systemImage: "rectangle.split.2x1")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                Button {
                    load()
                } label: {
                    Label(isLoading ? "Loading" : "Load", systemImage: "arrow.down.doc")
                }
                .labelStyle(.iconOnly)
                .disabled(isLoading)
                .help("Load diff")
            }

            Text(path)
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)

            if let diff {
                Text(diff.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    if let byteCount = diff.byteCount {
                        Label("\(byteCount) bytes", systemImage: "doc")
                    }
                    if let lineCount = diff.lineCount {
                        Label("\(lineCount) lines", systemImage: "text.alignleft")
                    }
                    if let unavailableReason = diff.unavailableReason {
                        Label(unavailableReason, systemImage: "info.circle")
                    }
                }
                .font(.caption2)
                .foregroundStyle(.tertiary)

                if diff.truncated {
                    Label("Preview truncated by the runtime.", systemImage: "scissors")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }

                if shouldRenderSideBySide(diff) {
                    SideBySideDiffView(
                        diffText: diff.diff,
                        lineLimit: diff.appPreviewLineLimit ?? 260
                    )
                } else {
                    VStack(alignment: .leading, spacing: 5) {
                        Label(diffUnavailableTitle(for: diff), systemImage: diffUnavailableImage(for: diff))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(diffUnavailableColor(for: diff))

                        if !diff.diff.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text(diff.diff)
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.background)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            } else {
                Label(isLoading ? "Loading diff..." : "Select Load to inspect this file.", systemImage: isLoading ? "hourglass" : "doc.text.magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(.quaternary)
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }

    private func shouldRenderSideBySide(_ diff: GitFileDiff) -> Bool {
        (diff.displayMode ?? "SideBySide") == "SideBySide" &&
            !diff.diff.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func diffUnavailableTitle(for diff: GitFileDiff) -> String {
        switch diff.unavailableReason {
        case "Binary":
            return "Binary diff preview unavailable"
        case "TooLarge":
            return "File too large for inline diff"
        case "NotRegularFile":
            return "Path is not a regular file"
        case "CommandFailed":
            return "Diff command failed"
        default:
            return "Textual diff unavailable"
        }
    }

    private func diffUnavailableImage(for diff: GitFileDiff) -> String {
        switch diff.unavailableReason {
        case "Binary":
            return "doc.fill"
        case "TooLarge":
            return "doc.zipper"
        case "CommandFailed":
            return "exclamationmark.triangle"
        default:
            return "info.circle"
        }
    }

    private func diffUnavailableColor(for diff: GitFileDiff) -> Color {
        switch diff.unavailableReason {
        case "CommandFailed":
            return .orange
        default:
            return .secondary
        }
    }
}

private struct SideBySideDiffView: View {
    var diffText: String
    var lineLimit: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 6) {
                Text("Old")
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("New")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)

            ForEach(diffLines.prefix(lineLimit)) { line in
                DiffLineRow(line: line)
            }

            if diffLines.count > lineLimit {
                Text("\(diffLines.count - lineLimit) more diff line(s) hidden in the app preview.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 4)
            }
        }
        .textSelection(.enabled)
    }

    private var diffLines: [DiffLine] {
        diffText
            .split(separator: "\n", omittingEmptySubsequences: false)
            .enumerated()
            .map { index, rawLine in
                DiffLine(index: index, raw: String(rawLine))
            }
    }
}

private struct DiffLine: Identifiable {
    var id: Int { index }
    var index: Int
    var raw: String

    var kind: DiffLineKind {
        if raw.hasPrefix("+++") || raw.hasPrefix("---") || raw.hasPrefix("diff --git") || raw.hasPrefix("index ") || raw.hasPrefix("# ") {
            return .metadata
        }
        if raw.hasPrefix("@@") {
            return .hunk
        }
        if raw.hasPrefix("+") {
            return .addition
        }
        if raw.hasPrefix("-") {
            return .deletion
        }
        return .context
    }

    var displayText: String {
        switch kind {
        case .addition, .deletion:
            return String(raw.dropFirst())
        default:
            return raw
        }
    }
}

private enum DiffLineKind {
    case metadata
    case hunk
    case addition
    case deletion
    case context
}

private struct DiffLineRow: View {
    var line: DiffLine

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            oldText
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(oldBackground)

            newText
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(newBackground)
        }
        .font(.caption2.monospaced())
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    @ViewBuilder
    private var oldText: some View {
        switch line.kind {
        case .addition:
            Text("")
        case .metadata, .hunk:
            Text(line.displayText)
                .foregroundStyle(.secondary)
        default:
            Text(line.displayText)
        }
    }

    @ViewBuilder
    private var newText: some View {
        switch line.kind {
        case .deletion:
            Text("")
        case .metadata, .hunk:
            Text(line.displayText)
                .foregroundStyle(.secondary)
        default:
            Text(line.displayText)
        }
    }

    private var oldBackground: Color {
        switch line.kind {
        case .deletion:
            return .red.opacity(0.16)
        case .metadata, .hunk:
            return .secondary.opacity(0.08)
        default:
            return .clear
        }
    }

    private var newBackground: Color {
        switch line.kind {
        case .addition:
            return .green.opacity(0.16)
        case .metadata, .hunk:
            return .secondary.opacity(0.08)
        default:
            return .clear
        }
    }
}

private struct ValidationRepairBriefCard: View {
    var brief: ValidationRepairBrief
    var validationRun: ValidationRun?
    var taskCommandRun: TaskCommandRun?
    var isCurrentProposalSource: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label(brief.summary, systemImage: "wrench.and.screwdriver")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)

                Spacer(minLength: 8)

                Text(brief.riskLevel)
                    .font(.caption2.weight(.medium))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.quaternary)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }

            if let validationRun {
                Label("\(validationRun.presetName) / \(validationRun.status)", systemImage: validationRun.status == "Failed" ? "exclamationmark.triangle" : "checkmark.circle")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            } else if let taskCommandRun {
                Label("\(taskCommandRun.name) / \(taskCommandRun.status)", systemImage: taskCommandRun.status == "Failed" ? "exclamationmark.triangle" : "terminal")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            } else if let sourceSummary = brief.sourceSummary {
                Label(sourceSummary, systemImage: brief.source == "TaskCommandRun" ? "terminal" : "checklist")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            Label("\(brief.provider.name) / \(brief.provider.model)", systemImage: "cpu")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)

            if isCurrentProposalSource {
                Label("Current edit proposal was generated from this brief.", systemImage: "arrow.triangle.branch")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.green)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Likely Cause")
                    .font(.caption.weight(.semibold))
                Text(brief.likelyCause)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            if !brief.recommendedActions.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Recommended Actions")
                        .font(.caption.weight(.semibold))
                    ForEach(brief.recommendedActions.prefix(5), id: \.self) { action in
                        Text("- \(action)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Follow-up Prompt")
                    .font(.caption.weight(.semibold))
                Text(brief.followUpPrompt)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            Text(brief.generatedAt)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(10)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct EditProposalFileChangeCard: View {
    var change: ProposedFileChange
    var validationResult: FileChangeValidation?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label(change.path, systemImage: changeSystemImage)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                Spacer(minLength: 8)

                Text(change.changeType)
                    .font(.caption2.weight(.medium))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.quaternary)
                    .clipShape(RoundedRectangle(cornerRadius: 5))

                if let validationResult {
                    ValidationStatusBadge(result: validationResult)
                }
            }

            Text(change.rationale)
                .font(.caption)
                .foregroundStyle(.secondary)

            OperationSummaryRow(operation: change.applyOperation)

            if let validationResult {
                VStack(alignment: .leading, spacing: 4) {
                    Text(validationResult.summary)
                        .font(.caption)
                        .foregroundStyle(validationResult.status == "Blocked" ? .orange : .secondary)

                    ForEach(validationResult.checks.prefix(4), id: \.self) { check in
                        Text("- \(check)")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            Text(change.diffPreview)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary)
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .padding(10)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var changeSystemImage: String {
        switch change.changeType {
        case "Create":
            return "doc.badge.plus"
        case "Delete":
            return "doc.badge.minus"
        default:
            return "doc.text"
        }
    }
}

private struct ValidationStatusBadge: View {
    var result: FileChangeValidation

    var body: some View {
        Label(result.status, systemImage: result.status == "Blocked" ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
            .font(.caption2.weight(.medium))
            .foregroundStyle(result.status == "Blocked" ? .orange : .green)
            .labelStyle(.titleAndIcon)
    }
}

private struct OperationSummaryRow: View {
    var operation: ProposedFileOperation?

    var body: some View {
        if let operation {
            VStack(alignment: .leading, spacing: 4) {
                Label(operationSummary(operation), systemImage: operationSystemImage(operation))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(operationForegroundStyle(operation))

                if let note = operationNote(operation) {
                    Text(note)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            Label("No apply operation / blocked", systemImage: "nosign")
                .font(.caption.weight(.medium))
                .foregroundStyle(.orange)
        }
    }

    private func operationSummary(_ operation: ProposedFileOperation) -> String {
        switch operation.kind {
        case "AppendText":
            return "AppendText / \(operation.text?.count ?? 0) chars"
        case "ReplaceText":
            return "ReplaceText / \(operation.findText?.count ?? 0) -> \(operation.replaceWith?.count ?? 0) chars"
        case "PatchText":
            return "PatchText / \(operation.hunks?.count ?? 0) hunk(s)"
        case "CreateFile":
            return "CreateFile / \(operation.content?.count ?? 0) chars"
        case "PreviewOnly":
            return "PreviewOnly / not apply-ready in v0"
        default:
            return "\(operation.kind) / unsupported"
        }
    }

    private func operationSystemImage(_ operation: ProposedFileOperation) -> String {
        switch operation.kind {
        case "AppendText":
            return "text.append"
        case "ReplaceText":
            return "arrow.left.arrow.right"
        case "PatchText":
            return "rectangle.stack.badge.plus"
        case "CreateFile":
            return "doc.badge.plus"
        case "PreviewOnly":
            return "eye"
        default:
            return "questionmark.diamond"
        }
    }

    private func operationForegroundStyle(_ operation: ProposedFileOperation) -> Color {
        switch operation.kind {
        case "PreviewOnly":
            return .orange
        default:
            return .secondary
        }
    }

    private func operationNote(_ operation: ProposedFileOperation) -> String? {
        switch operation.kind {
        case "PatchText":
            return "Apply-ready only when every hunk has one exact match in the original file."
        case "CreateFile":
            return "Apply-ready only for new docs/*.md files after runtime validation."
        case "PreviewOnly":
            return "Review artifact only; revise or wait for a future patch engine before applying."
        default:
            return nil
        }
    }
}

private struct Panel<Content: View>: View {
    var title: String
    var systemImage: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.headline)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
