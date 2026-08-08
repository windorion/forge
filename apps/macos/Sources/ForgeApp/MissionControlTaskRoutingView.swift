import SwiftUI

struct MissionControlTaskRoute: Equatable, Hashable {
    var repositoryPath: String
    var taskID: ForgeTask.ID
}

struct MissionControlTaskComposerView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var repositories: [MissionControlRepositorySnapshot]
    var currentPath: String?
    var close: () -> Void
    var closeSurface: () -> Void

    @State private var selectedPath: String
    @State private var title = ""
    @State private var objective = ""

    init(
        repositories: [MissionControlRepositorySnapshot],
        currentPath: String?,
        close: @escaping () -> Void,
        closeSurface: @escaping () -> Void
    ) {
        self.repositories = repositories
        self.currentPath = currentPath
        self.close = close
        self.closeSurface = closeSurface
        _selectedPath = State(initialValue: currentPath ?? repositories.first?.path ?? "")
    }

    var body: some View {
        VStack(spacing: 0) {
            routingHeader(title: "NEW TASK — CHOOSE RUNTIME", close: close)

            HStack(spacing: 0) {
                repositoryPicker
                    .frame(width: 330)

                Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)

                VStack(alignment: .leading, spacing: 18) {
                    Text("WHAT SHOULD FORGE BUILD?")
                        .font(ForgeDesign.mono(11, weight: .bold))
                        .tracking(0.8)

                    TextField("Short task title", text: $title)
                        .textFieldStyle(.plain)
                        .font(.system(size: 18, weight: .bold))
                        .padding(12)
                        .background(Color.white)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

                    TextEditor(text: $objective)
                        .font(.system(size: 14))
                        .scrollContentBackground(.hidden)
                        .padding(10)
                        .frame(minHeight: 180)
                        .background(Color.white)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

                    accessExplanation

                    if let error = workspace.missionControlRouteError {
                        Text(error)
                            .font(ForgeDesign.mono(10))
                            .foregroundStyle(ForgeDesign.danger)
                    }

                    HStack {
                        Spacer()
                        Button("CREATE TASK") { submit() }
                            .buttonStyle(MissionRoutePrimaryButtonStyle())
                            .keyboardShortcut(.return, modifiers: [.command])
                            .disabled(!canSubmit)
                    }
                }
                .padding(28)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private var repositoryPicker: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("TARGET REPOSITORY")
                .font(ForgeDesign.mono(9, weight: .bold))
                .tracking(1)
                .foregroundStyle(ForgeDesign.muted)
                .padding(16)

            ForEach(repositories) { repository in
                Button {
                    selectedPath = repository.path
                    workspace.missionControlRouteError = nil
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(repository.name)
                                .font(ForgeDesign.mono(11, weight: .bold))
                                .lineLimit(1)
                            Spacer()
                            Text(accessLabel(repository))
                                .font(ForgeDesign.mono(8, weight: .bold))
                        }
                        Text(repository.path)
                            .font(ForgeDesign.mono(9))
                            .foregroundStyle(ForgeDesign.muted)
                            .lineLimit(2)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(selectedPath == repository.path ? ForgeDesign.accent.opacity(0.35) : Color.white)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: selectedPath == repository.path ? 2 : 1))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
            }

            Spacer()
            Text("Background creation is enabled only after the repository's session-scoped active runtime is accepted.")
                .font(ForgeDesign.mono(9))
                .foregroundStyle(ForgeDesign.muted)
                .padding(16)
        }
        .background(Color.white)
    }

    @ViewBuilder
    private var accessExplanation: some View {
        if selectedPath == currentPath {
            routeNotice("FOCUSED PRIMARY", "The task will use the current workspace runtime.", color: ForgeDesign.accent)
        } else if workspace.missionControlRepositoryIsAuthorized(selectedPath) {
            routeNotice("AUTHORIZED BACKGROUND", "The supervisor will revalidate repository identity and authorization immediately before POST /tasks.", color: ForgeDesign.accent)
        } else {
            routeNotice("READ-ONLY", "Return to Mission Control and authorize this repository's active runtime before creating a task.", color: ForgeDesign.warning)
        }
    }

    private func routeNotice(_ label: String, _ message: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(label)
                .font(ForgeDesign.mono(8, weight: .bold))
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(color)
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1))
            Text(message)
                .font(ForgeDesign.mono(9.5))
                .foregroundStyle(ForgeDesign.muted)
        }
    }

    private var canSubmit: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !objective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            workspace.missionControlCreatingRepositoryPath == nil &&
            (selectedPath == currentPath || workspace.missionControlRepositoryIsAuthorized(selectedPath))
    }

    private func accessLabel(_ repository: MissionControlRepositorySnapshot) -> String {
        if repository.path == currentPath { return "PRIMARY" }
        return workspace.missionControlRepositoryIsAuthorized(repository.path) ? "ACTIVE" : "READ-ONLY"
    }

    private func submit() {
        let isPrimary = selectedPath == currentPath
        workspace.createMissionControlTask(path: selectedPath, title: title, objective: objective)
        if isPrimary {
            closeSurface()
        }
    }
}

struct MissionControlTaskDetailView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var route: MissionControlTaskRoute
    var focusRepository: () -> Void
    var close: () -> Void

    @State private var tab: DetailTab = .overview
    @State private var selectedFileChangeID: String?
    @State private var message = ""
    @State private var reviewNote = ""

    private enum DetailTab: String, CaseIterable, Identifiable {
        case overview = "OVERVIEW"
        case review = "REVIEW"
        case activity = "ACTIVITY"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            routingHeader(title: "BACKGROUND TASK — \(repositoryName)", close: close)
            taskHeader

            if workspace.missionControlRouteIsLoading && task == nil {
                ProgressView("Loading fresh task detail…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let task {
                HStack(spacing: 0) {
                    taskRail(task)
                        .frame(width: 292)
                    Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
                    detailContent(task)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                ContentUnavailableView(
                    "Task unavailable",
                    systemImage: "exclamationmark.triangle",
                    description: Text(workspace.missionControlRouteError ?? "The background runtime did not return this task.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            routeStatusBar
        }
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        .onAppear {
            if workspace.missionControlRoutedTask?.id != route.taskID {
                workspace.openMissionControlTask(path: route.repositoryPath, taskID: route.taskID)
            }
        }
    }

    private var task: ForgeTask? {
        guard workspace.missionControlTaskRoute == route else { return nil }
        return workspace.missionControlRoutedTask
    }

    private var authorized: Bool {
        workspace.missionControlRepositoryIsAuthorized(route.repositoryPath)
    }

    private var repositoryName: String {
        workspace.missionControlRepositories.first(where: { $0.path == route.repositoryPath })?.name ?? route.repositoryPath
    }

    private var taskHeader: some View {
        HStack(spacing: 12) {
            if let task {
                Text(task.status.uppercased())
                    .font(ForgeDesign.mono(8.5, weight: .bold))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(task.status == "Human Review" ? ForgeDesign.warning : ForgeDesign.accent)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                Text(task.title)
                    .font(.system(size: 16, weight: .heavy))
                    .lineLimit(1)
                Text("#\(task.id.prefix(8))")
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(ForgeDesign.muted)
            }
            Spacer()
            ForEach(DetailTab.allCases) { item in
                Button(item.rawValue) { tab = item }
                    .buttonStyle(MissionRouteTabButtonStyle(selected: tab == item))
            }
            Button("FOCUS REPOSITORY", action: focusRepository)
                .buttonStyle(MissionRouteSecondaryButtonStyle())
            Button(workspace.missionControlRouteIsLoading ? "REFRESHING" : "REFRESH") {
                workspace.refreshMissionControlTask()
            }
            .buttonStyle(MissionRouteSecondaryButtonStyle())
            .disabled(workspace.missionControlRouteIsLoading)
        }
        .padding(.horizontal, 18)
        .frame(height: 56)
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private func taskRail(_ task: ForgeTask) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                metric("PHASE", task.currentPhase)
                metric("PROVIDER", task.planRevisions.last?.provider.name ?? "Local runtime")
                metric("PLAN STEPS", "\(task.planSteps.filter { $0.status == "Done" }.count)/\(task.planSteps.count)")
                metric("FILES", "\(task.editProposal?.fileChanges.count ?? task.changedFiles.count)")
                metric("VALIDATIONS", "\(task.validationRuns.count)")

                Rectangle().fill(ForgeDesign.divider).frame(height: 1)

                Text("OBJECTIVE")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .foregroundStyle(ForgeDesign.muted)
                Text(task.objective)
                    .font(.system(size: 12.5))
                    .textSelection(.enabled)

                Text("RUNTIME BOUNDARY")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .foregroundStyle(ForgeDesign.muted)
                Text(authorized
                     ? "Authorized background runtime. Every mutation is preceded by a fresh identity and session-authorization check."
                     : "Read-only observer. Detail and review evidence are visible, but no mutation request can leave the app.")
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(ForgeDesign.muted)
            }
            .padding(18)
        }
        .background(Color.white)
    }

    @ViewBuilder
    private func detailContent(_ task: ForgeTask) -> some View {
        switch tab {
        case .overview:
            overview(task)
        case .review:
            review(task)
        case .activity:
            activity(task)
        }
    }

    private func overview(_ task: ForgeTask) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                sectionTitle("CURRENT PLAN")
                if let revision = task.planRevisions.last {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(revision.summary).font(.system(size: 14, weight: .bold))
                        ForEach(Array(revision.steps.enumerated()), id: \.element.id) { index, step in
                            HStack(alignment: .top, spacing: 10) {
                                Text("\(index + 1)").font(ForgeDesign.mono(9, weight: .bold))
                                    .frame(width: 22, height: 22).background(step.status == "Done" ? ForgeDesign.accent : ForgeDesign.paper)
                                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(step.title).font(.system(size: 12.5, weight: .bold))
                                    Text(step.summary).font(.system(size: 11.5)).foregroundStyle(ForgeDesign.muted)
                                }
                            }
                        }
                    }
                    .routePanel()
                } else {
                    emptyPanel("No plan revision is ready yet.")
                }

                sectionTitle("TASK CONVERSATION")
                ForEach(task.messages.suffix(8)) { item in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.role.uppercased()).font(ForgeDesign.mono(8, weight: .bold)).foregroundStyle(ForgeDesign.muted)
                        Text(item.content).font(.system(size: 12.5)).textSelection(.enabled)
                    }
                    .routePanel()
                }

                if authorized {
                    HStack(alignment: .bottom, spacing: 10) {
                        TextField("Answer a clarification or add review context", text: $message, axis: .vertical)
                            .textFieldStyle(.plain)
                            .padding(10)
                            .background(Color.white)
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                        Button("SEND") {
                            workspace.sendMissionControlTaskMessage(message)
                            message = ""
                        }
                        .buttonStyle(MissionRouteSecondaryButtonStyle())
                        .disabled(message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || workspace.missionControlRouteIsMutating)
                    }
                }

                actionRow(task)
            }
            .padding(22)
        }
    }

    private func review(_ task: ForgeTask) -> some View {
        Group {
            if let proposal = task.editProposal, !proposal.fileChanges.isEmpty {
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        ScrollView {
                            VStack(spacing: 0) {
                                ForEach(proposal.fileChanges) { change in
                                    Button {
                                        selectedFileChangeID = change.id
                                    } label: {
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(change.path).font(ForgeDesign.mono(10, weight: .bold)).lineLimit(2)
                                            HStack {
                                                Text(change.changeType.uppercased())
                                                Spacer()
                                                Text(fileDecision(proposal, changeID: change.id)?.decision.uppercased() ?? "PENDING")
                                            }
                                            .font(ForgeDesign.mono(8.5))
                                            .foregroundStyle(ForgeDesign.muted)
                                        }
                                        .padding(12)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(activeChange(proposal)?.id == change.id ? ForgeDesign.accent.opacity(0.28) : Color.white)
                                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        .frame(width: 245)
                        .background(Color.white)

                        Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)

                        if let change = activeChange(proposal) {
                            VStack(spacing: 0) {
                                HStack {
                                    Text(change.path).font(ForgeDesign.mono(10, weight: .bold))
                                    Spacer()
                                    Text(proposal.status.uppercased()).font(ForgeDesign.mono(8.5, weight: .bold))
                                }
                                .padding(.horizontal, 14).frame(height: 38).background(Color.white)
                                .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

                                ScrollView([.horizontal, .vertical]) {
                                    Text(change.diffPreview.isEmpty ? "No diff preview stored." : change.diffPreview)
                                        .font(ForgeDesign.mono(10))
                                        .textSelection(.enabled)
                                        .frame(maxWidth: .infinity, alignment: .topLeading)
                                        .padding(16)
                                }
                                .background(Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255))
                                .foregroundStyle(Color(red: 226 / 255, green: 226 / 255, blue: 220 / 255))

                                VStack(alignment: .leading, spacing: 10) {
                                    Text(change.rationale).font(.system(size: 11.5)).foregroundStyle(ForgeDesign.muted)
                                    if authorized && proposal.status == "Proposed" {
                                        TextField("Optional review note", text: $reviewNote)
                                            .textFieldStyle(.plain).padding(8).background(Color.white)
                                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1))
                                        HStack {
                                            Button("REQUEST CHANGES") {
                                                workspace.reviewMissionControlFile(
                                                    fileChangeID: change.id,
                                                    decision: "ChangesRequested",
                                                    note: reviewNote.isEmpty ? "Changes requested from Mission Control" : reviewNote
                                                )
                                            }
                                            .buttonStyle(MissionRouteSecondaryButtonStyle())
                                            Spacer()
                                            Button("APPROVE FILE") {
                                                workspace.reviewMissionControlFile(
                                                    fileChangeID: change.id,
                                                    decision: "Approved",
                                                    note: reviewNote.isEmpty ? nil : reviewNote
                                                )
                                            }
                                            .buttonStyle(MissionRoutePrimaryButtonStyle())
                                        }
                                        .disabled(workspace.missionControlRouteIsMutating)
                                    }
                                }
                                .padding(14)
                                .background(Color.white)
                                .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
                            }
                        }
                    }

                    if authorized && proposal.status == "Proposed" && allFilesApproved(proposal) {
                        HStack {
                            Text("All \(proposal.fileChanges.count) files approved. Apply remains an explicit reviewed mutation.")
                                .font(ForgeDesign.mono(9.5)).foregroundStyle(ForgeDesign.muted)
                            Spacer()
                            Button("APPLY APPROVED PROPOSAL") { workspace.applyMissionControlEditProposal() }
                                .buttonStyle(MissionRoutePrimaryButtonStyle())
                                .disabled(workspace.missionControlRouteIsMutating)
                        }
                        .padding(12)
                        .background(Color.white)
                        .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
                    }
                }
            } else {
                emptyPanel("No edit proposal is ready for review.")
                    .padding(22)
            }
        }
    }

    private func activity(_ task: ForgeTask) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                sectionTitle("VALIDATION EVIDENCE")
                if task.validationRuns.isEmpty {
                    emptyPanel("No validation runs recorded.")
                } else {
                    ForEach(task.validationRuns.reversed()) { run in
                        HStack(alignment: .top) {
                            Text(run.status.uppercased()).font(ForgeDesign.mono(8, weight: .bold))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(run.presetName).font(.system(size: 12.5, weight: .bold))
                                Text(run.summary).font(.system(size: 11.5)).foregroundStyle(ForgeDesign.muted)
                            }
                            Spacer()
                        }
                        .routePanel()
                    }
                }

                sectionTitle("LATEST EVENTS")
                ForEach(task.events.suffix(20).reversed()) { event in
                    HStack(alignment: .top, spacing: 10) {
                        Text(event.type).font(ForgeDesign.mono(9, weight: .bold)).frame(width: 155, alignment: .leading)
                        Text(event.message).font(.system(size: 11.5)).textSelection(.enabled)
                        Spacer()
                    }
                    .routePanel()
                }
            }
            .padding(22)
        }
    }

    @ViewBuilder
    private func actionRow(_ task: ForgeTask) -> some View {
        if authorized {
            HStack(spacing: 10) {
                if !task.planRevisions.isEmpty && task.editProposal == nil && task.status == "Human Review" {
                    Button("REGENERATE PLAN") { workspace.generateMissionControlPlanRevision() }
                        .buttonStyle(MissionRouteSecondaryButtonStyle())
                    Spacer()
                    Button("APPROVE & RUN") { workspace.approveMissionControlPlanAndRun() }
                        .buttonStyle(MissionRoutePrimaryButtonStyle())
                } else if let proposal = task.editProposal, proposal.status == "Proposed", allFilesApproved(proposal) {
                    Spacer()
                    Button("APPLY APPROVED PROPOSAL") { workspace.applyMissionControlEditProposal() }
                        .buttonStyle(MissionRoutePrimaryButtonStyle())
                } else if task.editProposal?.status == "Applied" && task.status == "Testing" {
                    Spacer()
                    Button("RUN VALIDATION") { workspace.runMissionControlValidation() }
                        .buttonStyle(MissionRoutePrimaryButtonStyle())
                }
            }
            .disabled(workspace.missionControlRouteIsMutating)
        }
    }

    private var routeStatusBar: some View {
        HStack(spacing: 10) {
            Circle().fill(authorized ? ForgeDesign.accent : ForgeDesign.warning).frame(width: 7, height: 7)
            Text(authorized ? "AUTHORIZED ROUTE" : "READ-ONLY ROUTE")
                .font(ForgeDesign.mono(9, weight: .bold))
            Text(route.repositoryPath)
                .font(ForgeDesign.mono(9))
                .foregroundStyle(ForgeDesign.muted)
                .lineLimit(1)
            Spacer()
            if workspace.missionControlRouteIsMutating {
                ProgressView().controlSize(.small)
                Text("Revalidating and sending scoped request…").font(ForgeDesign.mono(9))
            } else if let error = workspace.missionControlRouteError {
                Text(error).font(ForgeDesign.mono(9)).foregroundStyle(ForgeDesign.danger).lineLimit(1)
            } else {
                Text("No primary-workspace switch required").font(ForgeDesign.mono(9)).foregroundStyle(ForgeDesign.muted)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 40)
        .background(Color.white)
        .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private func activeChange(_ proposal: EditProposal) -> ProposedFileChange? {
        proposal.fileChanges.first(where: { $0.id == selectedFileChangeID }) ?? proposal.fileChanges.first
    }

    private func fileDecision(_ proposal: EditProposal, changeID: String) -> EditProposalFileDecision? {
        proposal.fileDecisions?.last(where: { $0.fileChangeID == changeID })
    }

    private func allFilesApproved(_ proposal: EditProposal) -> Bool {
        let approved = Set((proposal.fileDecisions ?? []).filter { $0.decision == "Approved" }.map(\.fileChangeID))
        return !proposal.fileChanges.isEmpty && proposal.fileChanges.allSatisfy { approved.contains($0.id) }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(ForgeDesign.mono(9, weight: .bold)).foregroundStyle(ForgeDesign.muted)
            Spacer()
            Text(value).font(ForgeDesign.mono(9.5, weight: .bold)).multilineTextAlignment(.trailing)
        }
    }

    private func sectionTitle(_ value: String) -> some View {
        Text(value).font(ForgeDesign.mono(9, weight: .bold)).tracking(1).foregroundStyle(ForgeDesign.muted)
    }

    private func emptyPanel(_ message: String) -> some View {
        Text(message)
            .font(ForgeDesign.mono(10))
            .foregroundStyle(ForgeDesign.muted)
            .frame(maxWidth: .infinity, minHeight: 90, alignment: .center)
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }
}

private func routingHeader(title: String, close: @escaping () -> Void) -> some View {
    HStack(spacing: 12) {
        ForgeLogo(size: 18)
        Text(title).font(ForgeDesign.mono(11, weight: .bold)).tracking(0.5)
        Spacer()
        Text("SESSION-SCOPED · LOOPBACK ONLY")
            .font(ForgeDesign.mono(8.5))
            .foregroundStyle(ForgeDesign.muted)
        Button("BACK", action: close)
            .buttonStyle(MissionRouteSecondaryButtonStyle())
            .keyboardShortcut(.cancelAction)
    }
    .padding(.horizontal, 16)
    .frame(height: 46)
    .background(Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255))
    .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
}

private extension View {
    func routePanel() -> some View {
        padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }
}

private struct MissionRoutePrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(ForgeDesign.mono(9.5, weight: .bold))
            .foregroundStyle(configuration.isPressed ? ForgeDesign.muted : ForgeDesign.accent)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(ForgeDesign.ink)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }
}

private struct MissionRouteSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(ForgeDesign.mono(9, weight: .bold))
            .foregroundStyle(configuration.isPressed ? ForgeDesign.muted : ForgeDesign.ink)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }
}

private struct MissionRouteTabButtonStyle: ButtonStyle {
    var selected: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(ForgeDesign.mono(8.5, weight: .bold))
            .foregroundStyle(selected ? ForgeDesign.paper : ForgeDesign.ink)
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background(selected ? ForgeDesign.ink : Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1))
    }
}
