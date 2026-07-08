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

    private func validationRun(for id: String) -> ValidationRun? {
        task.validationRuns.first { run in
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

    private var validationAllowsApply: Bool {
        task.editProposal?.validation?.status != "Blocked"
    }

    private var canRejectEditProposal: Bool {
        task.editProposal?.status == "Proposed" &&
            !isApplyingEditProposal &&
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

    private var latestValidationRepairBrief: ValidationRepairBrief? {
        guard let latestFailedValidationRun else {
            return nil
        }

        return task.validationRepairBriefs.reversed().first { brief in
            brief.validationRunID == latestFailedValidationRun.id
        }
    }

    private var canGenerateValidationRepairProposal: Bool {
        task.executionProposal != nil &&
            task.editProposal?.status == "Applied" &&
            latestFailedValidationRun != nil &&
            latestValidationRepairBrief != nil &&
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

        if task.editProposal?.validationRepairBriefID == latestValidationRepairBrief?.id {
            return "Repair Proposal Ready"
        }

        if latestFailedValidationRun != nil && latestValidationRepairBrief == nil {
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

                GitCommitPreviewCard(
                    task: task,
                    preview: workspace.gitCommitPreview(for: task.id),
                    isLoading: workspace.isPreparingGitCommitReview(taskID: task.id),
                    prepare: {
                        workspace.prepareGitCommitReview(for: task)
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
    var isLoading: Bool
    var prepare: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label("Commit Review", systemImage: "doc.badge.gearshape")
                    .font(.subheadline.weight(.semibold))

                Spacer()

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

                if diff.truncated {
                    Label("Preview truncated by the runtime.", systemImage: "scissors")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }

                SideBySideDiffView(diffText: diff.diff)
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
}

private struct SideBySideDiffView: View {
    var diffText: String

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

            ForEach(diffLines.prefix(260)) { line in
                DiffLineRow(line: line)
            }

            if diffLines.count > 260 {
                Text("\(diffLines.count - 260) more diff line(s) hidden in the app preview.")
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
