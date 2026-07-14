import Foundation
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
        .onChange(of: workspace.selectedTaskID) { _, taskID in
            workspace.refreshValidationPermissions(for: taskID)
        }
    }
}

private struct SidebarView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
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
            .padding(.vertical, 14)
            .background(Color.white)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            TaskComposer()
                .padding(14)

            Text("TASKS — \(workspace.tasks.count)")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(workspace.tasks) { task in
                        Button {
                            workspace.selectedTaskID = task.id
                        } label: {
                            TaskRow(task: task, isSelected: workspace.selectedTaskID == task.id)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            RuntimeBadge()
                .padding(14)
                .overlay(alignment: .top) {
                    Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                }
        }
        .background(ForgeDesign.paper)
    }
}

private struct RuntimeBadge: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(runtimeColor)
                .frame(width: 8, height: 8)
            Text(workspace.runtimeState.rawValue.uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .lineLimit(1)
            Spacer()
            if let version = workspace.runtimeHealth?.version {
                Text(version)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
            }
            Button {
                workspace.refreshRuntimeHealth()
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.plain)
            .help("Refresh local runtime status")
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
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

}

private struct TaskComposer: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @State private var objective = ""

    var body: some View {
        HStack(spacing: 0) {
            TextField("Describe the next task…", text: $objective)
                .textFieldStyle(.plain)
                .font(.system(.caption, design: .monospaced))
                .padding(.horizontal, 9)
                .onSubmit(createTask)
            Button {
                createTask()
            } label: {
                Image(systemName: "plus")
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)
            .background(ForgeDesign.ink)
            .foregroundStyle(ForgeDesign.paper)
            .disabled(resolvedObjective.isEmpty)
        }
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private var resolvedObjective: String {
        objective.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var resolvedTitle: String {
        return String(resolvedObjective.prefix(54))
    }

    private func createTask() {
        guard !resolvedObjective.isEmpty else { return }
        workspace.createTask(title: resolvedTitle, objective: resolvedObjective)
        objective = ""
    }
}

private struct TaskRow: View {
    var task: ForgeTask
    var isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(task.status.uppercased())
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .foregroundStyle(statusForeground)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(statusColor)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                Spacer()
                Text("#\(task.id.prefix(4).uppercased())")
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
            }

            Text(task.title)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(ForgeDesign.ink)
                .lineLimit(2)
            Text(task.currentPhase.uppercased())
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isSelected ? Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255) : Color.clear)
        .overlay(alignment: .leading) {
            Rectangle().fill(isSelected ? ForgeDesign.accent : Color.clear).frame(width: 3)
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(ForgeDesign.divider).frame(height: 1)
        }
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

    private var statusForeground: Color {
        task.status == "Failed" ? ForgeDesign.paper : ForgeDesign.ink
    }
}

private struct TaskWorkspaceView: View {
    var task: ForgeTask
    @State private var selectedTab: SessionTab = .log
    @State private var showDiffReview = false

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            TaskConversationPanel(task: task)
                .frame(minWidth: 360, idealWidth: 430, maxWidth: 520, maxHeight: .infinity)

            VStack(spacing: 0) {
                PlanProgressStrip(task: task)
                SessionTabContent(
                    tab: selectedTab,
                    task: task,
                    openDiffReview: {
                        showDiffReview = true
                    }
                )
                HStack(spacing: 0) {
                    SessionTabs(selectedTab: $selectedTab, task: task)
                        .frame(width: 330)
                    LiveRunControlBar(
                        task: task,
                        openDiffReview: {
                            showDiffReview = true
                        }
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        .padding(12)
        .background(ForgeDesign.paper)
        .sheet(isPresented: $showDiffReview) {
            FullscreenDiffReview(task: task)
                .frame(minWidth: 1180, minHeight: 760)
        }
    }
}

private struct LiveRunControlBar: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask
    var openDiffReview: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(runStateLabel)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)

            Spacer()

            Button("DIFF ⌘1", action: openDiffReview)
                .buttonStyle(ForgeSecondaryButtonStyle())
                .disabled(diffCount == 0)

            if canStartLoop {
                Button {
                    workspace.runAgentLoop(for: task, maxSteps: 6)
                } label: {
                    Label("Run", systemImage: "play.fill")
                }
                .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
            }

            if canResumeLoop, let loop = latestLoop {
                Button {
                    workspace.resumeAgentLoop(for: task, loop: loop)
                } label: {
                    Label("Resume", systemImage: "play.fill")
                }
                .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
            }

            if canPauseLoop, let loop = latestLoop {
                Button {
                    workspace.pauseAgentLoop(for: task, loop: loop)
                } label: {
                    Label("Pause", systemImage: "pause.fill")
                }
                .buttonStyle(ForgeSecondaryButtonStyle())
            }

            if canAbortLoop, let loop = latestLoop {
                Button {
                    workspace.abortAgentLoop(for: task, loop: loop)
                } label: {
                    Label("Abort", systemImage: "xmark")
                }
                .buttonStyle(ForgeSecondaryButtonStyle())
                .foregroundStyle(ForgeDesign.danger)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(Color.white)
        .overlay(alignment: .top) {
            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
        }
    }

    private var latestLoop: AgentRunLoop? { task.agentRunLoops.last }

    private var canStartLoop: Bool {
        task.executionProposal != nil &&
            task.editProposal?.status != "Proposed" &&
            latestLoop?.status != "Running" &&
            !workspace.isRunningAgentLoop(taskID: task.id)
    }

    private var canPauseLoop: Bool {
        latestLoop?.status == "Running" && latestLoop?.controlState == nil
    }

    private var canAbortLoop: Bool {
        latestLoop?.status == "Running" && latestLoop?.controlState != "AbortRequested"
    }

    private var canResumeLoop: Bool {
        guard let status = latestLoop?.status else { return false }
        return ["Paused", "Aborted", "Failed"].contains(status) && !workspace.isRunningAgentLoop(taskID: task.id)
    }

    private var diffCount: Int {
        max(task.changedFiles.count, task.editProposal?.fileChanges.count ?? 0)
    }

    private var runStateLabel: String {
        if workspace.isRunningAgentLoop(taskID: task.id) { return "AGENT WORKING" }
        if let loop = latestLoop { return "LOOP \(loop.status.uppercased()) · \(loop.stepsRun)/\(loop.maxSteps)" }
        return "GUARDRAILS ON · WAITING"
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

private struct MetricRow: View {
    var label: String
    var value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)
            Spacer()
            Text(value)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(ForgeDesign.ink)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 2)
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

            HStack(alignment: .top, spacing: 6) {
                ForEach(task.planSteps.prefix(6)) { step in
                    VStack(alignment: .leading, spacing: 5) {
                        Rectangle()
                            .fill(stepColor(step.status))
                            .frame(height: 10)
                            .overlay(
                                Rectangle().stroke(
                                    step.status == "Pending" ? Color(red: 204 / 255, green: 202 / 255, blue: 194 / 255) : ForgeDesign.ink,
                                    lineWidth: 1.5
                                )
                            )
                        Text(step.title.uppercased())
                            .font(.system(size: 8, weight: step.status == "Active" ? .bold : .regular, design: .monospaced))
                            .foregroundStyle(step.status == "Pending" ? ForgeDesign.muted : ForgeDesign.ink)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(12)
        .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
        .overlay(alignment: .bottom) {
            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
        }
    }

    private var doneCount: Int {
        task.planSteps.filter { $0.status == "Done" }.count
    }

    private func stepColor(_ status: String) -> Color {
        switch status {
        case "Done":
            return ForgeDesign.ink
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
        .frame(minHeight: 300, maxHeight: .infinity)
        .background(ForgeDesign.ink)
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
                LiveAgentStream(task: task)
            case .diff:
                AgentDiffTab(task: task, openDiffReview: openDiffReview)
            case .tests:
                AgentTestsTab(task: task)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

private struct AgentDiffTab: View {
    var task: ForgeTask
    var openDiffReview: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                DiffReviewSummary(task: task, openDiffReview: openDiffReview)
            }
        }
        .background(Color.white)
    }
}

private struct DiffReviewSummary: View {
    var task: ForgeTask
    var openDiffReview: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
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
                        .background(ForgeDesign.paper)
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
            .padding(.leading, 14)
            .overlay(alignment: .leading) {
                Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
            }
        }
        .padding(14)
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
    @State private var selectedHunkIndex = 0

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
        .onChange(of: activePath) { _, path in
            selectedHunkIndex = 0
            if let path {
                workspace.refreshGitDiff(path: path)
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

            if !reviewFiles.isEmpty {
                Text("FILE \(activeFileIndex + 1) OF \(reviewFiles.count)")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
            }

            Button {
                selectPreviousFile()
            } label: {
                Label("Prev", systemImage: "arrow.left")
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .keyboardShortcut(.leftArrow, modifiers: [.command])
            .disabled(!canSelectPreviousFile)

            Button {
                selectNextFile()
            } label: {
                Label("Next", systemImage: "arrow.right")
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .keyboardShortcut(.rightArrow, modifiers: [.command])
            .disabled(!canSelectNextFile)

            Button {
                workspace.refreshGitStatus()
            } label: {
                Label(workspace.isRefreshingGitStatus() ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .keyboardShortcut(.cancelAction)
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

                HStack {
                    Text("✓ \(approvedFileCount) REVIEWED")
                    Spacer()
                    Text("\(max(reviewFiles.count - approvedFileCount, 0)) TO GO")
                }
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)
                .padding(10)
                .overlay(alignment: .top) {
                    Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
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

            if let activePath {
                FullscreenGitDiffView(
                    path: activePath,
                    diff: workspace.gitDiff(for: activePath),
                    proposalDiff: selectedProposalChange?.diffPreview,
                    isLoading: workspace.isLoadingGitDiff(path: activePath),
                    mode: mode,
                    selectedHunkIndex: $selectedHunkIndex,
                    load: { workspace.refreshGitDiff(path: activePath) }
                )
            } else {
                EmptyTerminalMessage(
                    title: "NO FILE SELECTED",
                    message: "Select a changed file from the left tree to inspect its diff."
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(14)
            }

            fileVerdictBar
        }
        .background(ForgeDesign.paper)
    }

    private var fileVerdictBar: some View {
        HStack(spacing: 8) {
            Button("↑ PREV HUNK") {
                selectedHunkIndex = max(selectedHunkIndex - 1, 0)
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .keyboardShortcut("k", modifiers: [])
            .disabled(selectedHunkIndex <= 0 || selectedHunkCount == 0)

            Button("↓ NEXT HUNK") {
                selectedHunkIndex = min(selectedHunkIndex + 1, max(selectedHunkCount - 1, 0))
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .keyboardShortcut("j", modifiers: [])
            .disabled(selectedHunkIndex >= selectedHunkCount - 1 || selectedHunkCount == 0)

            Text(selectedHunkCount == 0 ? "NO HUNKS" : "HUNK \(selectedHunkIndex + 1)/\(selectedHunkCount)")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)

            Spacer()

            Text("THIS FILE:")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)

            Button(selectedFileDecision?.decision == "Approved" ? "✓ APPROVED" : "✓ LOOKS GOOD") {
                approveSelectedFile()
            }
            .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
            .keyboardShortcut(.return, modifiers: [.command])
            .disabled(!canReviewSelectedFile || selectedFileDecision?.decision == "Approved")

            Button("✎ REQUEST CHANGE") {
                requestChangeForSelectedFile()
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .disabled(!canRejectProposal)
        }
        .padding(10)
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
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
                    Text("VALIDATION EVIDENCE")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(ForgeDesign.muted)

                    if fileTestEvidence.isEmpty && taskWideTestEvidence.isEmpty {
                        Text("No validation evidence has been recorded yet.")
                            .font(.caption)
                            .foregroundStyle(ForgeDesign.muted)
                    } else {
                        Text(fileTestEvidence.isEmpty ? "FILE-SPECIFIC  NONE RECORDED" : "FILE-SPECIFIC")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundStyle(fileTestEvidence.isEmpty ? ForgeDesign.warning : ForgeDesign.success)

                        ForEach(Array(fileTestEvidence.prefix(4).enumerated()), id: \.offset) { _, evidence in
                            Text(evidence)
                                .font(.caption.monospaced())
                                .foregroundStyle(ForgeDesign.ink)
                                .textSelection(.enabled)
                        }

                        if !taskWideTestEvidence.isEmpty {
                            Text("TASK-WIDE — NOT CLAIMED AS FILE COVERAGE")
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .foregroundStyle(ForgeDesign.muted)

                            ForEach(Array(taskWideTestEvidence.prefix(3).enumerated()), id: \.offset) { _, evidence in
                                Text(evidence)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(ForgeDesign.muted)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                }
                .padding(12)
                .forgeCard(shadow: false)

                if let proposal = task.editProposal,
                   proposal.applyTransaction != nil || proposal.rollbackTransaction != nil {
                    ProposalTransactionEvidenceCard(proposal: proposal)
                }

                CompactCommitHandoffCard(task: task)

                VStack(alignment: .leading, spacing: 8) {
                    Text("FILE REVIEW")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(ForgeDesign.muted)

                    if let selectedFile {
                        MetricRow(label: "Status", value: selectedFile.status)
                        MetricRow(label: "Validation", value: selectedFile.validationStatus ?? "Unknown")
                        MetricRow(label: "Review", value: selectedFileDecision?.decision ?? "Pending")
                        MetricRow(label: "Lines", value: "+\(selectedFile.additions ?? 0) -\(selectedFile.deletions ?? 0)")
                    }

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

    private var activeFileIndex: Int {
        guard let activePath,
              let index = reviewFiles.firstIndex(where: { $0.path == activePath }) else {
            return 0
        }
        return index
    }

    private var canSelectPreviousFile: Bool {
        !reviewFiles.isEmpty && activeFileIndex > 0
    }

    private var canSelectNextFile: Bool {
        !reviewFiles.isEmpty && activeFileIndex < reviewFiles.count - 1
    }

    private var approvedFileCount: Int {
        Set((task.editProposal?.fileDecisions ?? [])
            .filter { $0.decision == "Approved" }
            .map(\.fileChangeID)).count
    }

    private var selectedHunkCount: Int {
        if let proposalDiff = selectedProposalChange?.diffPreview,
           !proposalDiff.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return ParsedUnifiedDiff(proposalDiff).hunks.count
        }
        guard let activePath, let diff = workspace.gitDiff(for: activePath),
              (diff.displayMode ?? "SideBySide") == "SideBySide" else {
            return 0
        }
        return ParsedUnifiedDiff(diff.diff).hunks.count
    }

    private func selectPreviousFile() {
        guard canSelectPreviousFile else { return }
        selectedPath = reviewFiles[activeFileIndex - 1].path
    }

    private func selectNextFile() {
        guard canSelectNextFile else { return }
        selectedPath = reviewFiles[activeFileIndex + 1].path
    }

    private func approveSelectedFile() {
        guard let change = selectedProposalChange else { return }
        workspace.reviewEditProposalFile(for: task, change: change, decision: "Approved")
    }

    private func requestChangeForSelectedFile() {
        guard let change = selectedProposalChange else { return }
        workspace.reviewEditProposalFile(
            for: task,
            change: change,
            decision: "ChangesRequested",
            note: "Revise the proposed change for \(change.path)."
        )
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
            let proposalStats = diffStats(change.diffPreview)
            files[change.path] = DiffReviewFile(
                path: change.path,
                status: existing?.status ?? change.changeType,
                detail: existing?.detail ?? change.changeType,
                additions: existing?.additions ?? proposalStats.additions,
                deletions: existing?.deletions ?? proposalStats.deletions,
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

    private func diffStats(_ preview: String) -> (additions: Int, deletions: Int) {
        var additions = 0
        var deletions = 0
        for line in preview.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("+") && !line.hasPrefix("+++") {
                additions += 1
            } else if line.hasPrefix("-") && !line.hasPrefix("---") {
                deletions += 1
            }
        }
        return (additions, deletions)
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

    private var fileTestEvidence: [String] {
        validationEvidence.filter { $0.isFileSpecific }.map { $0.summary }
    }

    private var taskWideTestEvidence: [String] {
        validationEvidence.filter { !$0.isFileSpecific }.map { $0.summary }
    }

    private var validationEvidence: [(summary: String, isFileSpecific: Bool)] {
        let path = activePath ?? ""
        let fileName = path.split(separator: "/").last.map(String.init) ?? path
        return task.validationRuns.reversed().flatMap { run in
            run.commands.map { command in
                let searchable = "\(command.name) \(command.command) \(command.outputSummary)".lowercased()
                let isFileSpecific = !path.isEmpty && (
                    searchable.contains(path.lowercased()) ||
                    (!fileName.isEmpty && searchable.contains(fileName.lowercased()))
                )
                return (
                    "\(run.presetName) / \(command.name) / \(command.status): \(command.outputSummary)",
                    isFileSpecific
                )
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
            allProposedFilesApproved &&
            !workspace.isApplyingEditProposal(taskID: task.id) &&
            !workspace.isRollingBackEditProposal(taskID: task.id) &&
            !workspace.isValidatingEditProposal(taskID: task.id) &&
            !workspace.isRejectingEditProposal(taskID: task.id)
    }

    private var canRejectProposal: Bool {
        task.editProposal?.status == "Proposed" &&
            selectedProposalChange != nil &&
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
        if let change = selectedProposalChange,
           workspace.isReviewingEditProposalFile(taskID: task.id, fileChangeID: change.id) {
            return "Requesting"
        }
        return "Request Change"
    }

    private var selectedProposalChange: ProposedFileChange? {
        guard let activePath else { return nil }
        return task.editProposal?.fileChanges.first { $0.path == activePath }
    }

    private var selectedFileDecision: EditProposalFileDecision? {
        guard let change = selectedProposalChange else { return nil }
        return task.editProposal?.fileDecisions?.first { $0.fileChangeID == change.id }
    }

    private var canReviewSelectedFile: Bool {
        guard let change = selectedProposalChange else { return false }
        return task.editProposal?.status == "Proposed" &&
            !workspace.isReviewingEditProposalFile(taskID: task.id, fileChangeID: change.id) &&
            !workspace.isApplyingEditProposal(taskID: task.id) &&
            !workspace.isRollingBackEditProposal(taskID: task.id)
    }

    private var allProposedFilesApproved: Bool {
        guard let proposal = task.editProposal else { return false }
        if proposal.requiresFileReview != true { return true }
        let approved = Set((proposal.fileDecisions ?? [])
            .filter { $0.decision == "Approved" }
            .map(\.fileChangeID))
        return proposal.fileChanges.allSatisfy { approved.contains($0.id) }
    }

    private func validationResult(for path: String) -> FileChangeValidation? {
        task.editProposal?.validation?.fileResults.first { result in
            result.path == path
        }
    }
}

private struct CompactCommitHandoffCard: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask
    @State private var showConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("LOCAL COMMIT")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
                Spacer()
                if let preview {
                    StatusPill(
                        label: preview.readiness,
                        color: preview.blockers.isEmpty ? ForgeDesign.accent : ForgeDesign.warning
                    )
                }
            }

            if let result = workspace.gitCommitResult(for: task.id) {
                Text("✓ \(result.shortHash) · \(result.messageTitle)")
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .textSelection(.enabled)
                Text(result.summary)
                    .font(.caption)
                    .foregroundStyle(ForgeDesign.muted)
            } else if let preview {
                Text(preview.suggestedTitle)
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .textSelection(.enabled)
                Text("\(preview.includedFiles.count) files · \(preview.validationSummary)")
                    .font(.caption)
                    .foregroundStyle(ForgeDesign.muted)
                if !preview.blockers.isEmpty {
                    Text(preview.blockers.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(ForgeDesign.danger)
                }
                Button {
                    showConfirmation = true
                } label: {
                    Text(workspace.isCreatingGitCommit(taskID: task.id) ? "CREATING COMMIT…" : "CREATE LOCAL COMMIT")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
                .disabled(!canCreateCommit)
                .confirmationDialog(
                    "Create the reviewed local commit?",
                    isPresented: $showConfirmation,
                    titleVisibility: .visible
                ) {
                    Button("Create Local Commit") {
                        workspace.createGitCommit(for: task, preview: preview)
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("Forge will stage only the reviewed files and create one local commit. It will not push or open a PR.")
                }
            } else {
                Text("Prepare a fresh, non-mutating commit review after the patch is approved and applied.")
                    .font(.caption)
                    .foregroundStyle(ForgeDesign.muted)
                Button {
                    workspace.prepareGitCommitReview(for: task)
                } label: {
                    Text(workspace.isPreparingGitCommitReview(taskID: task.id) ? "PREPARING…" : "PREPARE COMMIT REVIEW")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(ForgeSecondaryButtonStyle())
                .disabled(workspace.isPreparingGitCommitReview(taskID: task.id))
            }
        }
        .padding(12)
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private var preview: GitCommitPreview? {
        workspace.gitCommitPreview(for: task.id)
    }

    private var canCreateCommit: Bool {
        guard let preview else { return false }
        return preview.expectedHead != nil &&
            !preview.includedFiles.isEmpty &&
            preview.blockers.isEmpty &&
            !workspace.isCreatingGitCommit(taskID: task.id)
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

private struct TaskConversationPanel: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask

    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Circle()
                    .fill(clarificationQuestions.isEmpty ? ForgeDesign.accent : ForgeDesign.warning)
                    .frame(width: 7, height: 7)
                Text("SESSION")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                Text(conversationState)
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(clarificationQuestions.isEmpty ? ForgeDesign.muted : ForgeDesign.danger)
                Spacer()
                Text(task.messages.last?.provider?.model ?? "GUARDRAILS ON")
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .frame(height: 36)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if task.messages.isEmpty {
                        Text("Describe what Forge should build.")
                            .font(.callout)
                            .foregroundStyle(ForgeDesign.muted)
                    } else {
                        ForEach(task.messages) { message in
                            TaskMessageRow(message: message)
                        }
                    }

                    if let revision = task.planRevisions.last {
                        EmbeddedConversationPlanCard(task: task, revision: revision)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color.white)

            VStack(spacing: 0) {
                HStack(alignment: .bottom, spacing: 0) {
                    TextField(replyPlaceholder, text: $draft, axis: .vertical)
                        .lineLimit(2...5)
                        .textFieldStyle(.plain)
                        .font(.callout.monospaced())
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)

                    Button {
                        send()
                    } label: {
                        Text(sendButtonTitle.uppercased())
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(ForgeDesign.accent)
                            .frame(minWidth: 76, minHeight: 46)
                            .background(ForgeDesign.ink)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSend)
                }

                if task.planRevisions.last != nil {
                    VStack(alignment: .leading, spacing: 10) {
                        Button {
                            workspace.generatePlanRevision(for: task)
                        } label: {
                            Label(planRevisionButtonTitle, systemImage: "arrow.triangle.2.circlepath")
                        }
                        .buttonStyle(.plain)
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(ForgeDesign.muted)
                        .disabled(!canGeneratePlanRevision)
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 9)
                }
            }
            .background(Color.white)
            .overlay(alignment: .top) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }
        }
        .overlay(alignment: .trailing) {
            Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
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
            clarificationQuestions.isEmpty &&
            task.editProposal?.status != "Proposed" &&
            task.editProposal?.status != "Applied"
    }

    private var planRevisionButtonTitle: String {
        if !clarificationQuestions.isEmpty {
            return "Answer Clarification First"
        }
        return workspace.isGeneratingPlanRevision(taskID: task.id) ? "Updating Plan" : "Update Plan From Conversation"
    }

    private var clarificationQuestions: [String] {
        task.messages.last(where: { $0.role == "Assistant" })?.intentBrief?.openQuestions ?? []
    }

    private var replyPlaceholder: String {
        clarificationQuestions.isEmpty ? "Reply, adjust the plan, or ask anything" : "Answer Forge's clarification questions"
    }

    private var conversationState: String {
        clarificationQuestions.isEmpty ? "· \(task.currentPhase.uppercased())" : "· PLANNING PAUSED"
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

private struct EmbeddedConversationPlanCard: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask
    var revision: PlanRevision

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("PLAN")
                    .font(.system(size: 9, weight: .black, design: .monospaced))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(ForgeDesign.accent)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                Text(revision.summary)
                    .font(.callout.weight(.bold))
                    .lineLimit(2)
                Spacer()
            }

            ForEach(revision.steps.prefix(6)) { step in
                HStack(alignment: .top, spacing: 7) {
                    Text(step.status == "Done" ? "✓" : step.status == "Active" ? "▸" : "○")
                        .font(.caption.monospaced().weight(.bold))
                        .foregroundStyle(step.status == "Done" ? ForgeDesign.success : ForgeDesign.accent)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(step.title)
                            .font(.caption.weight(.semibold))
                        Text(step.summary)
                            .font(.caption2)
                            .foregroundStyle(ForgeDesign.muted)
                            .lineLimit(2)
                    }
                }
            }

            HStack(spacing: 12) {
                Text("est ~\(revision.estimatedMinutes ?? 0)m")
                Text(revision.estimatedCostUSD == 0 ? "local $0" : String(format: "~$%.2f", revision.estimatedCostUSD ?? 0))
                Text("risk \(revision.riskLevel.lowercased())")
                if let areas = revision.expectedFileAreas, !areas.isEmpty {
                    Text("\(areas.count) area(s)")
                }
            }
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundStyle(ForgeDesign.muted)

            Button {
                workspace.approvePlan(for: task)
            } label: {
                Label(approveTitle, systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
            .disabled(!canApprove)
            .keyboardShortcut(.return, modifiers: [.command])
        }
        .padding(11)
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        .shadow(color: ForgeDesign.ink, radius: 0, x: 4, y: 4)
    }

    private var approved: Bool {
        task.approvals.contains {
            $0.action == "Approve Plan" && $0.decision == "Approved" && $0.targetID == revision.id
        }
    }

    private var canApprove: Bool {
        task.status == "Human Review" && task.currentPhase == "Plan Review" && !approved && !workspace.isApprovingPlan(taskID: task.id)
    }

    private var approveTitle: String {
        workspace.isApprovingPlan(taskID: task.id) ? "Approving & Starting" : approved ? "Approved" : "Approve & Run"
    }
}

private struct TaskMessageRow: View {
    var message: TaskMessage

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            if message.role == "User" {
                Spacer(minLength: 42)
            } else {
                messageAvatar
            }

            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text(message.role.uppercased())
                        .font(.system(size: 8, weight: .bold, design: .monospaced))
                    Spacer()
                    Text(shortTime(message.createdAt))
                        .font(.system(size: 8, design: .monospaced))
                        .opacity(0.65)
                }

                if let intentBrief = message.intentBrief {
                    IntentBriefView(brief: intentBrief)
                } else {
                    Text(message.content)
                        .font(.callout)
                        .foregroundStyle(message.role == "User" ? ForgeDesign.paper : ForgeDesign.ink)
                        .textSelection(.enabled)
                }

                if let provider = message.provider {
                    Text("\(provider.name) · \(provider.model)")
                        .font(.system(size: 8, design: .monospaced))
                        .opacity(0.65)
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
                                }

                                Text(fileReferenceDetail(reference))
                                    .font(.caption2)
                                    .opacity(0.7)
                            }
                            .padding(7)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .overlay(Rectangle().stroke(message.role == "User" ? ForgeDesign.paper.opacity(0.35) : ForgeDesign.divider, lineWidth: 1))
                        }
                    }
                }
            }
            .padding(10)
            .frame(maxWidth: 420, alignment: .leading)
            .foregroundStyle(message.role == "User" ? ForgeDesign.paper : ForgeDesign.ink)
            .background(message.role == "User" ? ForgeDesign.ink : Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

            if message.role == "User" {
                messageAvatar
            } else {
                Spacer(minLength: 42)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var messageAvatar: some View {
        Text(message.role == "User" ? "YOU" : "F")
            .font(.system(size: 8, weight: .black, design: .monospaced))
            .foregroundStyle(ForgeDesign.ink)
            .frame(width: 28, height: 28)
            .background(message.role == "User" ? ForgeDesign.accent : Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private func shortTime(_ value: String) -> String {
        value.count > 8 ? String(value.suffix(8)) : value
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

private struct FullscreenGitDiffView: View {
    var path: String
    var diff: GitFileDiff?
    var proposalDiff: String?
    var isLoading: Bool
    var mode: DiffReviewMode
    @Binding var selectedHunkIndex: Int
    var load: () -> Void

    var body: some View {
        Group {
            if let proposalDiff,
               !proposalDiff.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ReviewDiffDocumentView(
                    parsed: ParsedUnifiedDiff(proposalDiff),
                    mode: mode,
                    selectedHunkIndex: $selectedHunkIndex,
                    lineLimit: 260
                )
            } else if let diff, shouldRender(diff) {
                ReviewDiffDocumentView(
                    parsed: ParsedUnifiedDiff(diff.diff),
                    mode: mode,
                    selectedHunkIndex: $selectedHunkIndex,
                    lineLimit: diff.appPreviewLineLimit ?? 260
                )
            } else {
                ScrollView {
                    GitDiffCard(path: path, diff: diff, isLoading: isLoading, load: load)
                        .padding(14)
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            if isLoading {
                ProgressView()
                    .controlSize(.small)
                    .padding(10)
            }
        }
    }

    private func shouldRender(_ diff: GitFileDiff) -> Bool {
        (diff.displayMode ?? "SideBySide") == "SideBySide" &&
            !diff.diff.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

private struct ReviewDiffDocumentView: View {
    var parsed: ParsedUnifiedDiff
    var mode: DiffReviewMode
    @Binding var selectedHunkIndex: Int
    var lineLimit: Int

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView([.horizontal, .vertical]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(parsed.metadata.prefix(12).enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(Color.white.opacity(0.46))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 2)
                    }

                    ForEach(Array(parsed.hunks.enumerated()), id: \.element.id) { index, hunk in
                        VStack(alignment: .leading, spacing: 0) {
                            ReviewDiffHunkHeader(
                                hunk: hunk,
                                index: index,
                                count: parsed.hunks.count,
                                isSelected: index == selectedHunkIndex
                            )

                            if mode == .split {
                                ReviewSplitHunkView(hunk: hunk, lineLimit: lineLimit)
                            } else {
                                ReviewUnifiedHunkView(hunk: hunk, lineLimit: lineLimit)
                            }
                        }
                        .id(hunk.id)
                    }

                    if parsed.hunks.isEmpty {
                        Text("NO TEXT HUNKS IN THIS DIFF")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(Color.white.opacity(0.55))
                            .padding(18)
                    }
                }
                .frame(minWidth: mode == .split ? 900 : 720, alignment: .leading)
            }
            .background(ForgeDesign.ink)
            .onChange(of: selectedHunkIndex) { _, index in
                guard parsed.hunks.indices.contains(index) else { return }
                withAnimation(.easeOut(duration: 0.16)) {
                    proxy.scrollTo(parsed.hunks[index].id, anchor: .top)
                }
            }
        }
    }
}

private struct ReviewDiffHunkHeader: View {
    var hunk: ParsedDiffHunk
    var index: Int
    var count: Int
    var isSelected: Bool

    var body: some View {
        HStack(spacing: 10) {
            Text("HUNK \(index + 1)/\(count)")
                .fontWeight(.black)
            Text(hunk.header)
                .lineLimit(1)
        }
        .font(.system(size: 10, design: .monospaced))
        .foregroundStyle(isSelected ? ForgeDesign.ink : Color.white.opacity(0.72))
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isSelected ? ForgeDesign.accent : Color.white.opacity(0.08))
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.white.opacity(0.16)).frame(height: 1)
        }
    }
}

private struct ReviewUnifiedHunkView: View {
    var hunk: ParsedDiffHunk
    var lineLimit: Int

    var body: some View {
        ForEach(hunk.unifiedLines.prefix(lineLimit)) { line in
            HStack(alignment: .top, spacing: 0) {
                Text(line.oldLine.map(String.init) ?? "")
                    .frame(width: 42, alignment: .trailing)
                Text(line.newLine.map(String.init) ?? "")
                    .frame(width: 42, alignment: .trailing)
                Text(line.marker)
                    .frame(width: 22)
                Text(line.text.isEmpty ? " " : line.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(line.foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(line.background)
        }
    }
}

private struct ReviewSplitHunkView: View {
    var hunk: ParsedDiffHunk
    var lineLimit: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Text("OLD")
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("NEW")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(.system(size: 9, weight: .black, design: .monospaced))
            .foregroundStyle(Color.white.opacity(0.5))
            .padding(.horizontal, 12)
            .padding(.vertical, 5)

            ForEach(hunk.splitRows.prefix(lineLimit)) { row in
                HStack(alignment: .top, spacing: 0) {
                    ReviewSplitCell(cell: row.old, side: .old)
                    Rectangle().fill(Color.white.opacity(0.18)).frame(width: 1)
                    ReviewSplitCell(cell: row.new, side: .new)
                }
            }
        }
    }
}

private struct ReviewSplitCell: View {
    enum Side { case old, new }

    var cell: ReviewDiffCell?
    var side: Side

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(cell?.lineNumber.map(String.init) ?? "")
                .foregroundStyle(Color.white.opacity(0.28))
                .frame(width: 38, alignment: .trailing)
            Text(cell?.text.isEmpty == false ? cell?.text ?? "" : " ")
                .foregroundStyle(foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.system(size: 11, design: .monospaced))
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(background)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var foreground: Color {
        guard let cell else { return Color.white.opacity(0.2) }
        switch cell.kind {
        case .deletion: return Color(red: 1, green: 0.63, blue: 0.63)
        case .addition: return Color(red: 0.62, green: 1, blue: 0.69)
        case .marker: return Color.white.opacity(0.46)
        case .context: return Color.white.opacity(0.82)
        }
    }

    private var background: Color {
        guard let cell else { return Color.white.opacity(0.018) }
        switch (side, cell.kind) {
        case (.old, .deletion): return Color.red.opacity(0.2)
        case (.new, .addition): return Color.green.opacity(0.18)
        case (_, .marker): return Color.white.opacity(0.055)
        default: return .clear
        }
    }
}

private struct ParsedUnifiedDiff {
    var metadata: [String]
    var hunks: [ParsedDiffHunk]

    init(_ text: String) {
        var metadata: [String] = []
        var hunks: [ParsedDiffHunk] = []
        var currentHeader: String?
        var currentLines: [String] = []

        func flushHunk() {
            guard let currentHeader else { return }
            hunks.append(ParsedDiffHunk(index: hunks.count, header: currentHeader, rawLines: currentLines))
        }

        for raw in text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
            if raw.hasPrefix("@@") {
                flushHunk()
                currentHeader = raw
                currentLines = []
            } else if currentHeader == nil {
                metadata.append(raw)
            } else {
                currentLines.append(raw)
            }
        }
        flushHunk()
        self.metadata = metadata.filter { !$0.isEmpty }
        self.hunks = hunks
    }
}

private struct ParsedDiffHunk: Identifiable {
    var id: String { "hunk-\(index)-\(header)" }
    var index: Int
    var header: String
    var unifiedLines: [ReviewUnifiedLine]
    var splitRows: [ReviewSplitRow]

    init(index: Int, header: String, rawLines: [String]) {
        self.index = index
        self.header = header
        let ranges = Self.parseRanges(header)
        var oldLine = ranges.oldStart
        var newLine = ranges.newStart
        var unifiedLines: [ReviewUnifiedLine] = []
        var splitRows: [ReviewSplitRow] = []
        var pendingOld: [ReviewDiffCell] = []
        var pendingNew: [ReviewDiffCell] = []

        func flushChanges() {
            let count = max(pendingOld.count, pendingNew.count)
            for offset in 0..<count {
                splitRows.append(ReviewSplitRow(
                    id: "\(index)-split-\(splitRows.count)",
                    old: pendingOld.indices.contains(offset) ? pendingOld[offset] : nil,
                    new: pendingNew.indices.contains(offset) ? pendingNew[offset] : nil
                ))
            }
            pendingOld.removeAll(keepingCapacity: true)
            pendingNew.removeAll(keepingCapacity: true)
        }

        for (offset, raw) in rawLines.enumerated() {
            if raw == "\\ No newline at end of file" {
                flushChanges()
                let marker = ReviewDiffCell(lineNumber: nil, text: raw, kind: .marker)
                splitRows.append(ReviewSplitRow(id: "\(index)-split-\(splitRows.count)", old: marker, new: marker))
                unifiedLines.append(ReviewUnifiedLine(id: "\(index)-line-\(offset)", oldLine: nil, newLine: nil, text: raw, kind: .marker))
                continue
            }

            let marker = raw.first
            let text = marker == "+" || marker == "-" || marker == " " ? String(raw.dropFirst()) : raw
            switch marker {
            case "-":
                let cell = ReviewDiffCell(lineNumber: oldLine, text: text, kind: .deletion)
                pendingOld.append(cell)
                unifiedLines.append(ReviewUnifiedLine(id: "\(index)-line-\(offset)", oldLine: oldLine, newLine: nil, text: text, kind: .deletion))
                oldLine = oldLine.map { $0 + 1 }
            case "+":
                let cell = ReviewDiffCell(lineNumber: newLine, text: text, kind: .addition)
                pendingNew.append(cell)
                unifiedLines.append(ReviewUnifiedLine(id: "\(index)-line-\(offset)", oldLine: nil, newLine: newLine, text: text, kind: .addition))
                newLine = newLine.map { $0 + 1 }
            default:
                flushChanges()
                let oldCell = ReviewDiffCell(lineNumber: oldLine, text: text, kind: .context)
                let newCell = ReviewDiffCell(lineNumber: newLine, text: text, kind: .context)
                splitRows.append(ReviewSplitRow(id: "\(index)-split-\(splitRows.count)", old: oldCell, new: newCell))
                unifiedLines.append(ReviewUnifiedLine(id: "\(index)-line-\(offset)", oldLine: oldLine, newLine: newLine, text: text, kind: .context))
                oldLine = oldLine.map { $0 + 1 }
                newLine = newLine.map { $0 + 1 }
            }
        }
        flushChanges()
        self.unifiedLines = unifiedLines
        self.splitRows = splitRows
    }

    private static func parseRanges(_ header: String) -> (oldStart: Int?, newStart: Int?) {
        let parts = header.split(separator: " ")
        guard parts.count >= 3 else { return (nil, nil) }
        return (parseStart(parts[1], prefix: "-"), parseStart(parts[2], prefix: "+"))
    }

    private static func parseStart(_ token: Substring, prefix: Character) -> Int? {
        guard token.first == prefix else { return nil }
        let range = token.dropFirst().split(separator: ",", maxSplits: 1).first
        return Int(range ?? "")
    }
}

private enum ReviewDiffKind {
    case context
    case addition
    case deletion
    case marker
}

private struct ReviewDiffCell {
    var lineNumber: Int?
    var text: String
    var kind: ReviewDiffKind
}

private struct ReviewSplitRow: Identifiable {
    var id: String
    var old: ReviewDiffCell?
    var new: ReviewDiffCell?
}

private struct ReviewUnifiedLine: Identifiable {
    var id: String
    var oldLine: Int?
    var newLine: Int?
    var text: String
    var kind: ReviewDiffKind

    var marker: String {
        switch kind {
        case .addition: return "+"
        case .deletion: return "−"
        case .marker: return "\\"
        case .context: return " "
        }
    }

    var foreground: Color {
        switch kind {
        case .addition: return Color(red: 0.62, green: 1, blue: 0.69)
        case .deletion: return Color(red: 1, green: 0.63, blue: 0.63)
        case .marker: return Color.white.opacity(0.46)
        case .context: return Color.white.opacity(0.82)
        }
    }

    var background: Color {
        switch kind {
        case .addition: return Color.green.opacity(0.17)
        case .deletion: return Color.red.opacity(0.19)
        case .marker: return Color.white.opacity(0.055)
        case .context: return .clear
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
    var reviewDecision: EditProposalFileDecision?

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
                if let reviewDecision {
                    Text(reviewDecision.decision)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(reviewDecision.decision == "Approved" ? .green : .orange)
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
        case "UnifiedDiff":
            return "UnifiedDiff / \(operation.patch?.count ?? 0) chars"
        case "CreateFile":
            return "CreateFile / \(operation.content?.count ?? 0) chars"
        case "DeleteFile":
            return "DeleteFile / explicit reviewed deletion"
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
        case "UnifiedDiff":
            return "arrow.triangle.branch"
        case "CreateFile":
            return "doc.badge.plus"
        case "DeleteFile":
            return "doc.badge.minus"
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
        case "UnifiedDiff":
            return "Apply-ready only when file headers, ranges, counts, and context lines match the current file."
        case "CreateFile":
            return "Apply-ready only for a new allowlisted source/text path; existing files are never overwritten."
        case "DeleteFile":
            return "High-risk file deletion requires explicit per-file review and retains a verified rollback snapshot."
        case "PreviewOnly":
            return "Review artifact only; revise or wait for a future patch engine before applying."
        default:
            return nil
        }
    }
}

private struct ProposalTransactionEvidenceCard: View {
    var proposal: EditProposal

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("CHANGESET RECOVERY")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ForgeDesign.muted)

            if let transaction = proposal.applyTransaction {
                transactionRow(transaction)
            }

            if let transaction = proposal.rollbackTransaction {
                transactionRow(transaction)
            }

            let verifiedApplyCount = proposal.appliedFileChanges?.filter { $0.applyVerifiedAt != nil }.count ?? 0
            let verifiedRollbackCount = proposal.appliedFileChanges?.filter { $0.rollbackVerifiedAt != nil }.count ?? 0
            if verifiedApplyCount > 0 || verifiedRollbackCount > 0 {
                Text("HASH VERIFIED  APPLY \(verifiedApplyCount)  /  ROLLBACK \(verifiedRollbackCount)")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ForgeDesign.muted)
            }
        }
        .padding(12)
        .forgeCard(shadow: false)
    }

    @ViewBuilder
    private func transactionRow(_ transaction: EditProposalFileTransaction) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Label(transaction.kind.uppercased(), systemImage: transactionIcon(transaction))
                    .font(.caption.weight(.bold))
                Spacer()
                Text(transaction.status.uppercased())
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(transactionColor(transaction))
            }
            Text(transaction.summary)
                .font(.caption)
                .foregroundStyle(ForgeDesign.ink)
            Text("\(transaction.paths.count) file(s) / \(transaction.verifiedAt == nil ? "verification pending" : "hash verified")")
                .font(.caption2.monospaced())
                .foregroundStyle(ForgeDesign.muted)
            if let recoverySummary = transaction.recoverySummary {
                Text(recoverySummary)
                    .font(.caption2)
                    .foregroundStyle(transactionColor(transaction))
            }
        }
    }

    private func transactionIcon(_ transaction: EditProposalFileTransaction) -> String {
        switch transaction.status {
        case "Completed":
            return "checkmark.shield"
        case "Recovered":
            return "arrow.uturn.backward.circle"
        case "RecoveryFailed":
            return "exclamationmark.triangle"
        default:
            return "hourglass"
        }
    }

    private func transactionColor(_ transaction: EditProposalFileTransaction) -> Color {
        switch transaction.status {
        case "Completed":
            return ForgeDesign.success
        case "Recovered":
            return ForgeDesign.warning
        case "RecoveryFailed":
            return ForgeDesign.danger
        default:
            return ForgeDesign.accent
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
