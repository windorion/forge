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
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Circle()
                    .fill(workspace.runtimeHealth?.ok == true ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
                Text(workspace.statusMessage)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
            }

            Text(workspace.eventStreamStatus)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
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

private struct PlannerPanel: View {
    var task: ForgeTask

    var body: some View {
        Panel(title: "Planner", systemImage: "checklist") {
            VStack(alignment: .leading, spacing: 10) {
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
                            Label("Status: \(editProposal.status)", systemImage: "list.bullet.clipboard")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                            Label("Risk: \(editProposal.riskLevel)", systemImage: "shield")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
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
        task.status == "Human Review" && task.approvals.isEmpty && !isApproving
    }

    private var approveButtonTitle: String {
        if isApproving {
            return "Approving"
        }

        if !task.approvals.isEmpty {
            return "Plan Approved"
        }

        return "Approve Plan"
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
            !isGeneratingEditProposal
    }

    private var generateEditProposalButtonTitle: String {
        if isGeneratingEditProposal {
            return "Generating Edit Proposal"
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

    private func validationSystemImage(_ status: String) -> String {
        status == "Ready" ? "checkmark.shield" : "exclamationmark.triangle"
    }

    private var emptyChangedFilesMessage: String {
        if task.status == "Running" {
            return "No file changes yet. Controlled execution is open."
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
