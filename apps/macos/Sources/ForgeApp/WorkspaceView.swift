import SwiftUI

struct WorkspaceView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 240, ideal: 280)
        } detail: {
            if let task = workspace.selectedTask {
                TaskWorkspaceView(task: task)
            } else {
                ContentUnavailableView("No Task Selected", systemImage: "tray")
            }
        }
        .toolbar {
            ToolbarItemGroup {
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
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Forge")
                    .font(.title2.weight(.semibold))
                Text("Agent workspace")
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.top, 16)

            RuntimeBadge()
                .padding(.horizontal, 14)

            TaskComposer()
                .padding(.horizontal, 14)

            List(selection: $workspace.selectedTaskID) {
                Section("Tasks") {
                    ForEach(workspace.tasks) { task in
                        TaskRow(task: task)
                            .tag(task.id)
                    }
                }
            }
            .listStyle(.sidebar)
        }
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

            HStack(spacing: 8) {
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
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
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
}

private struct TaskComposer: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @State private var title = "Plan Agent Loop v0"
    @State private var objective = "Create a reviewable plan, show agent progress, and stop before code changes."

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("New Task")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            TextField("Title", text: $title)
                .textFieldStyle(.roundedBorder)

            TextField("Objective", text: $objective, axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)

            Button {
                workspace.createTask(title: title, objective: objective)
            } label: {
                Label("Start Agent Loop", systemImage: "sparkles")
                    .frame(maxWidth: .infinity)
            }
            .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(10)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct TaskRow: View {
    var task: ForgeTask

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(task.title)
                .font(.headline)
                .lineLimit(2)
            Text(task.currentPhase)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct TaskWorkspaceView: View {
    var task: ForgeTask

    var body: some View {
        VStack(spacing: 0) {
            TaskHeader(task: task)

            Divider()

            HStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        TaskConversationPanel(task: task)
                        PlannerPanel(task: task)
                        ContextPanel(task: task)
                        ToolCallPanel(task: task)
                        AgentPanel(task: task)
                        EventPanel(task: task)
                    }
                    .padding(20)
                }

                Divider()

                ReviewPanel(task: task)
                    .frame(width: 360)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

private struct TaskHeader: View {
    var task: ForgeTask

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(task.title)
                        .font(.title2.weight(.semibold))
                    Text(task.objective)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 4) {
                    Text(task.status)
                        .font(.headline)
                    Text(task.currentPhase)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(20)
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
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Label(change.path, systemImage: "doc.text")
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Text(change.changeType)
                                        .font(.caption2.weight(.medium))
                                        .padding(.horizontal, 7)
                                        .padding(.vertical, 3)
                                        .background(.quaternary)
                                        .clipShape(RoundedRectangle(cornerRadius: 5))
                                }
                                Text(change.rationale)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                if let operation = change.applyOperation {
                                    Label(operationSummary(operation), systemImage: operationSystemImage(operation))
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(.secondary)
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

    private func operationSummary(_ operation: ProposedFileOperation) -> String {
        switch operation.kind {
        case "AppendText":
            return "AppendText / \(operation.text?.count ?? 0) chars"
        case "ReplaceText":
            return "ReplaceText / \(operation.findText?.count ?? 0) -> \(operation.replaceWith?.count ?? 0) chars"
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
        default:
            return "questionmark.diamond"
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

    private var isValidatingEditProposal: Bool {
        workspace.isValidatingEditProposal(taskID: task.id)
    }

    private var canGenerateEditProposal: Bool {
        task.executionProposal != nil &&
            (task.editProposal == nil || task.editProposal?.status == "Rejected") &&
            !isGeneratingEditProposal &&
            !isApplyingEditProposal &&
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

    private var validationAllowsApply: Bool {
        task.editProposal?.validation?.status != "Blocked"
    }

    private var canRejectEditProposal: Bool {
        task.editProposal?.status == "Proposed" && !isApplyingEditProposal && !isRejectingEditProposal
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
        task.editProposal?.status == "Applied" && task.status != "Testing" && !isRunningValidation
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
