import SwiftUI

/// `7a` menu bar mini window: glanceable running tasks, needs-attention
/// rows, quick task entry, and app/pause/budget footer. Rendered inside the
/// MenuBarExtra window (and a debug panel for verification captures).
struct MenuBarMiniWindow: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @AppStorage("forge.monthlyBudgetCap") private var monthlyBudgetCap = 40

    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                ForgeLogo(size: 16)
                Text("FORGE")
                    .font(ForgeDesign.mono(11, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(ForgeDesign.paper)
                Spacer()
                HStack(spacing: 7) {
                    Circle()
                        .fill(ForgeDesign.accent)
                        .frame(width: 6, height: 6)
                    Text(runningTasks.isEmpty ? "IDLE" : "\(runningTasks.count) RUNNING")
                        .font(ForgeDesign.mono(9, weight: .bold))
                        .foregroundStyle(ForgeDesign.accent)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(ForgeDesign.ink)

            if runningTasks.isEmpty && attentionTasks.isEmpty && readyTasks.isEmpty {
                Text("no active agent work — drop a task below")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 14)
                    .background(Color.white)
                    .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
            }

            ForEach(runningTasks.prefix(2)) { task in
                runningRow(task)
            }

            ForEach(attentionTasks.prefix(2)) { task in
                attentionRow(task)
            }

            ForEach(readyTasks.prefix(1)) { task in
                readyRow(task)
            }

            HStack(spacing: 0) {
                TextField("new task… (↵ to plan)", text: $draft)
                    .textFieldStyle(.plain)
                    .font(ForgeDesign.mono(11.5))
                    .padding(.horizontal, 14)
                    .frame(height: 38)
                    .onSubmit(submitDraft)
                Text("⌘N")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .foregroundStyle(ForgeDesign.muted)
                    .padding(.horizontal, 12)
                    .frame(height: 38)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(ForgeDesign.divider).frame(width: 1.5)
                    }
            }
            .background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            HStack(spacing: 8) {
                Button("OPEN FORGE") { openMainWindow() }
                    .font(ForgeDesign.mono(9.5, weight: .bold))
                    .foregroundStyle(ForgeDesign.ink)
                    .buttonStyle(.plain)
                Text("·")
                    .foregroundStyle(ForgeDesign.muted)
                Button("pause all") { workspace.pauseAllMissionControlLoops() }
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(ForgeDesign.muted)
                    .buttonStyle(.plain)
                Spacer()
                Text(String(format: "$%.2f / $%d this month", estimatedSpend, monthlyBudgetCap))
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(ForgeDesign.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
        }
        .frame(width: 360)
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private func runningRow(_ task: ForgeTask) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Text("RUNNING")
                    .font(ForgeDesign.mono(8.5, weight: .bold))
                    .tracking(0.5)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(ForgeDesign.accent)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                Text(task.title)
                    .font(.system(size: 12, weight: .bold))
                    .lineLimit(1)
                Spacer()
                Text("#\(task.id.prefix(4))")
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(ForgeDesign.dashedBorder)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Rectangle().fill(ForgeDesign.paper)
                    Rectangle()
                        .fill(ForgeDesign.accent)
                        .frame(width: proxy.size.width * progress(task))
                        .overlay(alignment: .trailing) {
                            Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
                        }
                }
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            }
            .frame(height: 8)
            Text(runningMeta(task))
                .font(ForgeDesign.mono(9))
                .foregroundStyle(ForgeDesign.muted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
        .contentShape(Rectangle())
        .onTapGesture { open(task) }
    }

    private func attentionRow(_ task: ForgeTask) -> some View {
        Button {
            open(task)
        } label: {
            HStack(spacing: 9) {
                Text("⏸ NEEDS YOU")
                    .font(ForgeDesign.mono(8.5, weight: .bold))
                    .tracking(0.5)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(ForgeDesign.warning)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                Text("#\(task.id.prefix(4)) \(attentionSummary(task))")
                    .font(.system(size: 11.5, weight: .semibold))
                    .lineLimit(1)
                Spacer()
                Text("→")
                    .font(ForgeDesign.mono(11, weight: .heavy))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(Color(red: 1, green: 253 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
        }
        .buttonStyle(.plain)
    }

    private func readyRow(_ task: ForgeTask) -> some View {
        Button {
            open(task)
        } label: {
            HStack(spacing: 9) {
                Text("✓ PR READY")
                    .font(ForgeDesign.mono(8.5, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(ForgeDesign.paper)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(ForgeDesign.ink)
                Text("#\(task.id.prefix(4)) \(task.title)")
                    .font(.system(size: 11.5, weight: .semibold))
                    .lineLimit(1)
                Spacer()
                Text("→")
                    .font(ForgeDesign.mono(11, weight: .heavy))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
        }
        .buttonStyle(.plain)
    }

    private var runningTasks: [ForgeTask] {
        workspace.tasks.filter {
            workspace.isRunningAgentLoop(taskID: $0.id) || ["Running", "Testing"].contains($0.status)
        }
    }

    private var attentionTasks: [ForgeTask] {
        workspace.tasks.filter {
            $0.status == "Human Review" && $0.agentRunSteps.last?.action == "WaitForHumanReview"
        }
    }

    private var readyTasks: [ForgeTask] {
        workspace.tasks.filter { $0.status == "Completed" }
    }

    private func progress(_ task: ForgeTask) -> CGFloat {
        let done = task.planSteps.filter { $0.status == "Done" }.count
        return task.planSteps.isEmpty ? 0.1 : CGFloat(done) / CGFloat(task.planSteps.count)
    }

    private func runningMeta(_ task: ForgeTask) -> String {
        let done = task.planSteps.filter { $0.status == "Done" }.count
        let repo = workspace.missionControlCurrentRepositoryPath?.split(separator: "/").last.map(String.init) ?? "workspace"
        let minutes = Self.minutesLabel(task.createdAt)
        return "step \(min(done + 1, max(task.planSteps.count, 1)))/\(max(task.planSteps.count, 1)) · \(repo) · \(minutes)"
    }

    private func attentionSummary(_ task: ForgeTask) -> String {
        if let question = task.agentRunSteps.last?.summary, !question.isEmpty {
            return "asked: \(question)"
        }
        return task.title
    }

    static func minutesLabel(_ startISO: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let start = parser.date(from: startISO) else { return "<1m" }
        let minutes = max(Int(Date().timeIntervalSince(start) / 60), 0)
        switch minutes {
        case ..<1: return "<1m"
        case ..<90: return "\(minutes)m"
        default: return "\(minutes / 60)h \(minutes % 60)m"
        }
    }

    private var estimatedSpend: Double {
        workspace.tasks.compactMap { $0.planRevisions.last?.estimatedCostUSD }.reduce(0, +)
    }

    private func submitDraft() {
        let objective = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !objective.isEmpty else { return }
        workspace.createTask(title: String(objective.prefix(60)), objective: objective)
        draft = ""
        openMainWindow()
    }

    private func open(_ task: ForgeTask) {
        workspace.selectedTaskID = task.id
        openMainWindow()
    }

    private func openMainWindow() {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.windows.first { $0.title == "Forge" || $0.identifier?.rawValue.contains("AppWindow") == true }?
            .makeKeyAndOrderFront(nil)
    }
}
