import AppKit
import Foundation
import SwiftUI

enum ForgeDesign {
    static let appVersion = "v0.4.2"
    static let paper = Color(red: 244 / 255, green: 244 / 255, blue: 241 / 255)
    static let ink = Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255)
    static let muted = Color(red: 106 / 255, green: 106 / 255, blue: 100 / 255)
    static let dashedBorder = Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255)
    static let border = Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255)
    static let divider = Color(red: 226 / 255, green: 225 / 255, blue: 220 / 255)
    static let accent = Color(red: 166 / 255, green: 116 / 255, blue: 255 / 255)
    static let warning = Color(red: 254 / 255, green: 188 / 255, blue: 46 / 255)
    static let success = Color(red: 40 / 255, green: 200 / 255, blue: 64 / 255)
    static let danger = Color(red: 192 / 255, green: 57 / 255, blue: 43 / 255)

    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("JetBrains Mono", fixedSize: size).weight(weight)
    }
}

/// Hard offset shadow matching the handoff's `box-shadow: Xpx Ypx 0 color`.
/// Implemented as an offset filled rectangle behind the view (the box
/// silhouette), not SwiftUI `.shadow`, which projects per-layer content
/// silhouettes and mis-renders under `cacheDisplay`-based capture.
extension View {
    func forgeShadow(_ color: Color, x: CGFloat, y: CGFloat) -> some View {
        background(Rectangle().fill(color).offset(x: x, y: y))
    }
}

private extension View {
    func forgeCard(shadow: Bool = true) -> some View {
        self
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.border, lineWidth: 1.5))
            .forgeShadow(shadow ? ForgeDesign.ink : .clear, x: 4, y: 4)
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
            .font(ForgeDesign.mono(11, weight: .bold))
            .textCase(.uppercase)
            .foregroundStyle(foreground)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(fill)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            .forgeShadow(ForgeDesign.ink, x: configuration.isPressed ? 1 : 3, y: configuration.isPressed ? 1 : 3)
            .offset(x: configuration.isPressed ? 2 : 0, y: configuration.isPressed ? 2 : 0)
    }
}

private struct ForgeSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(ForgeDesign.mono(11, weight: .bold))
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

private enum WorkspaceSurface: Equatable {
    case missionControl
    case history
    case answerQueue
    case taskQueue
    case diff(taskID: ForgeTask.ID)
    case audit(taskID: ForgeTask.ID)
    case fullPlan(taskID: ForgeTask.ID, revisionID: PlanRevision.ID)
    case cost(taskID: ForgeTask.ID)

    var windowMode: WorkspaceWindowMode {
        switch self {
        case .history, .audit:
            return .recovery
        case .missionControl, .answerQueue, .taskQueue, .fullPlan:
            return .review
        case .diff:
            return .session
        case .cost:
            return .cost
        }
    }
}

@MainActor
private final class WorkspaceSurfaceCoordinator: ObservableObject {
    @Published private(set) var surface: WorkspaceSurface?

    func present(_ surface: WorkspaceSurface) {
        self.surface = surface
    }

    func dismiss() {
        surface = nil
    }
}

struct WorkspaceView: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @Environment(\.openSettings) private var openSettings
    @StateObject private var surfaceCoordinator = WorkspaceSurfaceCoordinator()
    @State private var recoveryDismissed = false
    @State private var showCommandPalette = false
    @AppStorage("forge.didShowFirstTaskSuccess") private var didShowFirstTaskSuccess = false

    var body: some View {
        ZStack {
            workspaceContent
                .opacity(surfaceCoordinator.surface == nil ? 1 : 0)
                .allowsHitTesting(surfaceCoordinator.surface == nil)
                .accessibilityHidden(surfaceCoordinator.surface != nil)

            if let surface = surfaceCoordinator.surface {
                exclusiveSurface(surface)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(ForgeDesign.paper.ignoresSafeArea())
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .background(ForgeDesign.paper)
        .environmentObject(surfaceCoordinator)
        .task {
            if workspace.runtimeState == .unchecked {
                workspace.refreshRuntimeHealth()
            }
        }
        .onChange(of: workspace.selectedTaskID) { _, taskID in
            workspace.refreshValidationPermissions(for: taskID)
        }
        .onReceive(NotificationCenter.default.publisher(for: .forgeToggleCommandPalette)) { _ in
            showCommandPalette.toggle()
        }
        .onReceive(NotificationCenter.default.publisher(for: .forgeNewTask)) { _ in
            surfaceCoordinator.dismiss()
            workspace.selectedTaskID = nil
            showCommandPalette = false
        }
        .onReceive(NotificationCenter.default.publisher(for: .forgeSwitchRepository)) { _ in
            surfaceCoordinator.dismiss()
            showCommandPalette = false
            workspace.connectRepository()
        }
        .onReceive(NotificationCenter.default.publisher(for: .forgeToggleMissionControl)) { _ in
            showCommandPalette = false
            surfaceCoordinator.present(.missionControl)
            workspace.refreshMissionControl()
        }
        .onReceive(NotificationCenter.default.publisher(for: .forgeApplicationWillTerminate)) { _ in
            workspace.stopMissionControlObservers()
        }
        #if DEBUG
        .onReceive(NotificationCenter.default.publisher(for: .forgeDebugPresentSurface)) { note in
            presentDebugSurface(note.object as? String)
        }
        #endif
        .overlay {
            if showCommandPalette {
                CommandPaletteView(isPresented: $showCommandPalette)
                    .environmentObject(workspace)
                    .transition(.opacity)
            }
        }
        .background(
            WindowSizingView(
                mode: surfaceCoordinator.surface?.windowMode ?? (!recoveryDismissed && !recoveryTasks.isEmpty
                    ? .recovery
                    : shouldShowNoRepository
                        ? .compact
                    : shouldShowOffline
                        ? .review
                        : workspace.gitConflictSnapshot?.files.isEmpty == false
                            ? .review
                        : workspace.selectedTask.map(shouldShowFirstTaskSuccess) == true
                            ? .recovery
                        : windowMode(for: workspace.selectedTask))
            )
        )
        .onExitCommand {
            if surfaceCoordinator.surface != nil {
                surfaceCoordinator.dismiss()
            }
        }
    }

    #if DEBUG
    /// Resolve a verification-script surface spec. Formats:
    /// `missionControl` `history` `answerQueue` `taskQueue` `palette`
    /// `dismiss` `diff:<taskID>` `audit:<taskID>` `fullPlan:<taskID>:<revisionID>`
    private func presentDebugSurface(_ spec: String?) {
        guard let spec, !spec.isEmpty else { return }
        let parts = spec.split(separator: ":").map(String.init)
        switch parts[0] {
        case "missionControl":
            surfaceCoordinator.present(.missionControl)
            workspace.refreshMissionControl()
        case "history":
            surfaceCoordinator.present(.history)
        case "answerQueue":
            surfaceCoordinator.present(.answerQueue)
        case "taskQueue":
            surfaceCoordinator.present(.taskQueue)
        case "palette":
            showCommandPalette = true
        case "settings":
            openSettings()
        case "dismiss":
            surfaceCoordinator.dismiss()
            showCommandPalette = false
        case "recoveryDismiss":
            recoveryDismissed = true
        case "diff" where parts.count >= 2:
            surfaceCoordinator.present(.diff(taskID: parts[1]))
        case "audit" where parts.count >= 2:
            surfaceCoordinator.present(.audit(taskID: parts[1]))
        case "cost" where parts.count >= 2:
            surfaceCoordinator.present(.cost(taskID: parts[1]))
        case "fullPlan" where parts.count >= 3:
            surfaceCoordinator.present(.fullPlan(taskID: parts[1], revisionID: parts[2]))
        default:
            break
        }
    }
    #endif

    @ViewBuilder
    private var workspaceContent: some View {
        VStack(spacing: 0) {
            ForgeTitleBar()

            if !recoveryDismissed && !recoveryTasks.isEmpty {
                CrashRecoveryState(
                    tasks: recoveryTasks,
                    resumeAll: resumeRecoveredTasks,
                    reviewFirst: reviewFirstRecoveredTask
                )
            } else if shouldShowNoRepository {
                NoRepositoryState()
            } else if shouldShowOffline {
                OfflineWorkspaceState(tasks: workspace.tasks, retry: workspace.refreshRuntimeHealth)
            } else if let conflicts = workspace.gitConflictSnapshot, !conflicts.files.isEmpty {
                MergeConflictState(snapshot: conflicts)
            } else if let task = workspace.selectedTask {
                if shouldShowFirstTaskSuccess(task) {
                    FirstTaskSuccessState(task: task) {
                        didShowFirstTaskSuccess = true
                        workspace.selectedTaskID = nil
                    } viewOnGitHub: {
                        didShowFirstTaskSuccess = true
                        workspace.openRepositoryOnGitHub()
                    }
                } else if task.status == "Completed" {
                    RunCompleteState(task: task)
                } else if task.status == "Failed" {
                    TaskFailureState(task: task)
                } else if needsDetailedQuestionLayout(task) {
                    AgentQuestionState(task: task)
                } else if needsDecisionLayout(task) {
                    NeedsDecisionState(task: task)
                } else if let revision = compactApprovalRevision(task) {
                    CompactPlanApprovalState(task: task, revision: revision)
                } else if usesNewSessionLayout(task) {
                    TaskWorkspaceView(task: task)
                } else {
                    HStack(spacing: 0) {
                        SidebarView()
                            .frame(width: 300)

                        Rectangle()
                            .fill(ForgeDesign.ink)
                            .frame(width: 1.5)

                        RunningTaskWorkspaceView(task: task)
                    }
                }
            } else {
                NewTaskEmptyState()
            }
        }
        .background(ForgeDesign.paper)
    }

    @ViewBuilder
    private func exclusiveSurface(_ surface: WorkspaceSurface) -> some View {
        switch surface {
        case .missionControl:
            MissionControlView(
                newTask: {
                    workspace.selectedTaskID = nil
                    surfaceCoordinator.dismiss()
                },
                openTask: { taskID in
                    workspace.selectedTaskID = taskID
                    surfaceCoordinator.dismiss()
                },
                close: surfaceCoordinator.dismiss
            )
        case .history:
            TaskHistoryView(tasks: workspace.tasks) { task in
                workspace.selectedTaskID = task.id
                surfaceCoordinator.dismiss()
            }
        case .answerQueue:
            AgentAnswerQueueView(tasks: waitingQuestionTasks)
        case .taskQueue:
            TaskQueueView { taskID in
                workspace.selectedTaskID = taskID
                surfaceCoordinator.dismiss()
            }
        case let .diff(taskID):
            if let task = workspace.tasks.first(where: { $0.id == taskID }) {
                FullscreenDiffReview(task: task, close: surfaceCoordinator.dismiss)
            } else {
                unavailableSurface("The task for this diff is no longer available.")
            }
        case let .audit(taskID):
            if let task = workspace.tasks.first(where: { $0.id == taskID }) {
                TaskAuditLogView(task: task)
            } else {
                unavailableSurface("The task for this audit log is no longer available.")
            }
        case let .fullPlan(taskID, revisionID):
            if let task = workspace.tasks.first(where: { $0.id == taskID }),
               let revision = task.planRevisions.first(where: { $0.id == revisionID }) {
                FullPlanApprovalView(task: task, revision: revision, close: surfaceCoordinator.dismiss)
            } else {
                unavailableSurface("The plan revision is no longer available.")
            }
        case let .cost(taskID):
            if let task = workspace.tasks.first(where: { $0.id == taskID }) {
                TaskCostBreakdownView(task: task, close: surfaceCoordinator.dismiss)
            } else {
                unavailableSurface("The task for this cost breakdown is no longer available.")
            }
        }
    }

    private func unavailableSurface(_ message: String) -> some View {
        VStack(spacing: 16) {
            ContentUnavailableView("Surface unavailable", systemImage: "rectangle.slash", description: Text(message))
            Button("CLOSE", action: surfaceCoordinator.dismiss)
                .buttonStyle(ForgeSecondaryButtonStyle())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ForgeDesign.paper)
    }

    private var waitingQuestionTasks: [ForgeTask] {
        workspace.tasks.filter {
            $0.status == "Human Review" &&
                $0.currentPhase != "Plan Review" &&
                $0.agentRunSteps.last?.action == "WaitForHumanReview"
        }
    }

    private func usesNewSessionLayout(_ task: ForgeTask) -> Bool {
        task.agentRunLoops.isEmpty &&
            task.editProposal == nil &&
            !["Running", "Testing", "Completed", "Failed"].contains(task.status)
    }

    /// `1b` standalone plan approval: a proposed plan exists, nothing has
    /// run yet, and there is no real back-and-forth conversation — approval
    /// is the single next action, so the compact window takes over. Tasks
    /// with an actual user dialog stay in the `32a` chat session, where the
    /// plan appears as an embedded conversation card instead.
    private func compactApprovalRevision(_ task: ForgeTask) -> PlanRevision? {
        guard task.status == "Human Review",
              task.currentPhase == "Plan Review",
              task.agentRunLoops.isEmpty,
              task.editProposal == nil,
              task.messages.filter({ $0.role == "User" }).count <= 1
        else { return nil }
        return task.planRevisions.last
    }

    private func needsDecisionLayout(_ task: ForgeTask) -> Bool {
        task.status == "Human Review" &&
            task.currentPhase != "Plan Review" &&
            task.agentRunSteps.last?.action == "WaitForHumanReview"
    }

    private func needsDetailedQuestionLayout(_ task: ForgeTask) -> Bool {
        guard needsDecisionLayout(task), let step = task.agentRunSteps.last else { return false }
        return !(step.contextFilePaths ?? []).isEmpty ||
            !(step.readPaths ?? []).isEmpty ||
            !(step.searchTerms ?? []).isEmpty
    }

    private func windowMode(for task: ForgeTask?) -> WorkspaceWindowMode {
        guard let task else { return .compact }
        if needsDetailedQuestionLayout(task) { return .review }
        if task.status == "Completed" || needsDecisionLayout(task) { return .compact }
        if task.status == "Failed" { return .review }
        if compactApprovalRevision(task) != nil { return .compact }
        return .session
    }

    private var recoveryTasks: [ForgeTask] {
        workspace.tasks.filter { task in
            task.currentPhase.localizedCaseInsensitiveContains("recover") ||
                task.events.contains { $0.type.localizedCaseInsensitiveContains("startup_recover") }
        }
    }

    private var shouldShowOffline: Bool {
        switch workspace.runtimeState {
        case .disconnected, .wrongVersion:
            return true
        case .unchecked, .checking, .running, .needsProviderConfiguration:
            return false
        }
    }

    private var shouldShowNoRepository: Bool {
        workspace.runtimeHealth?.workspace == nil &&
            workspace.tasks.isEmpty &&
            !workspace.hasSelectedRepository &&
            [.unchecked, .checking, .disconnected].contains(workspace.runtimeState)
    }

    private func shouldShowFirstTaskSuccess(_ task: ForgeTask) -> Bool {
        guard !didShowFirstTaskSuccess, task.status == "Completed" else { return false }
        let firstCompleted = workspace.tasks
            .filter { $0.status == "Completed" }
            .sorted { $0.updatedAt < $1.updatedAt }
            .first
        return firstCompleted?.id == task.id
    }

    private func reviewFirstRecoveredTask() {
        workspace.selectedTaskID = recoveryTasks.first?.id
        recoveryDismissed = true
    }

    private func resumeRecoveredTasks() {
        for task in recoveryTasks {
            guard let loop = task.agentRunLoops.last,
                  ["Paused", "Aborted", "Failed"].contains(loop.status) else { continue }
            workspace.resumeAgentLoop(for: task, loop: loop)
        }
        if workspace.selectedTaskID == nil {
            workspace.selectedTaskID = recoveryTasks.first?.id
        }
        recoveryDismissed = true
    }
}

private struct ForgeTitleBar: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        ZStack {
            HStack(spacing: 10) {
                ForgeLogo(size: 18)
                Text("FORGE — \(workspaceLabel)")
                    .font(.custom("JetBrains Mono", fixedSize: 12).weight(.bold))
                    .tracking(0.5)
            }

            HStack {
                Spacer()
                Text(ForgeDesign.appVersion)
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(ForgeDesign.muted)
                    .padding(.trailing, 16)
            }
        }
        .frame(height: 42)
        .background(Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255))
        .overlay(alignment: .bottom) {
            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
        }
    }

    private var workspaceLabel: String {
        guard let path = workspace.runtimeHealth?.workspace?.repoRoot else {
            return "LOCAL WORKSPACE"
        }
        let components = URL(fileURLWithPath: path).pathComponents.suffix(2)
        return components.joined(separator: "/")
    }
}

struct ForgeLogo: View {
    var size: CGFloat

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
            } else {
                Text("F")
                    .font(.custom("JetBrains Mono", fixedSize: size * 0.62).weight(.black))
                    .foregroundStyle(ForgeDesign.ink)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(ForgeDesign.accent)
            }
        }
        .frame(width: size, height: size)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private var image: NSImage? {
        guard let url = Bundle.main.url(forResource: "forge-logo", withExtension: "png") else {
            return nil
        }
        return NSImage(contentsOf: url)
    }
}

private enum WorkspaceWindowMode: Equatable {
    case compact
    case recovery
    case review
    case session
    case cost

    var contentSize: NSSize {
        switch self {
        case .compact:
            return NSSize(width: 980, height: 520)
        case .cost:
            return NSSize(width: 1100, height: 663)
        case .recovery:
            return NSSize(width: 980, height: 620)
        case .review:
            return NSSize(width: 1240, height: 680)
        case .session:
            return NSSize(width: 1380, height: 720)
        }
    }
}

private struct WindowSizingView: NSViewRepresentable {
    var mode: WorkspaceWindowMode

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSView {
        NSView(frame: .zero)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        guard context.coordinator.lastMode != mode else { return }
        context.coordinator.lastMode = mode
        DispatchQueue.main.async {
            guard let window = nsView.window else { return }
            switch mode {
            case .compact:
                window.contentMinSize = NSSize(width: 900, height: 480)
            case .cost:
                window.contentMinSize = NSSize(width: 1000, height: 600)
            case .recovery:
                window.contentMinSize = NSSize(width: 900, height: 580)
            case .review:
                window.contentMinSize = NSSize(width: 1100, height: 640)
            case .session:
                window.contentMinSize = NSSize(width: 1180, height: 680)
            }
            window.setContentSize(mode.contentSize)
            window.center()
        }
    }

    final class Coordinator {
        var lastMode: WorkspaceWindowMode?
    }
}

private enum CommandPaletteAction: Hashable {
    case task(ForgeTask.ID)
    case newTask
    case switchRepository
    case refreshRuntime
    case settings
}

private struct CommandPaletteItem: Identifiable, Hashable {
    var id: String
    var group: String
    var glyph: String
    var title: String
    var metadata: String
    var shortcut: String?
    var action: CommandPaletteAction
}

private struct CommandPaletteView: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @Binding var isPresented: Bool
    @State private var query = ""
    @State private var selectedIndex = 0
    @FocusState private var searchFocused: Bool

    var body: some View {
        ZStack(alignment: .top) {
            ForgeDesign.ink.opacity(0.45)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { isPresented = false }

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Text("⌕")
                        .font(ForgeDesign.mono(16, weight: .heavy))
                        .foregroundStyle(ForgeDesign.muted)
                    TextField("Search tasks and commands…", text: $query)
                        .textFieldStyle(.plain)
                        .font(ForgeDesign.mono(14))
                        .focused($searchFocused)
                    Text("ESC")
                        .font(ForgeDesign.mono(9, weight: .bold))
                        .foregroundStyle(ForgeDesign.muted)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1.5))
                }
                .padding(.horizontal, 18)
                .frame(height: 54)
                .background(Color.white)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                }

                if visibleItems.isEmpty {
                    VStack(spacing: 8) {
                        Text("NO MATCHES")
                            .font(ForgeDesign.mono(10, weight: .bold))
                            .tracking(1)
                        Text("Press ↵ to create a new task from “\(query)”")
                            .font(ForgeDesign.mono(10))
                            .foregroundStyle(ForgeDesign.muted)
                    }
                    .frame(maxWidth: .infinity, minHeight: 120)
                    .background(ForgeDesign.paper)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(groupNames, id: \.self) { group in
                                Text(group)
                                    .font(ForgeDesign.mono(9, weight: .bold))
                                    .tracking(1)
                                    .foregroundStyle(ForgeDesign.muted)
                                    .padding(.horizontal, 18)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .frame(height: 32)
                                    .background(ForgeDesign.paper)

                                ForEach(Array(visibleItems.enumerated()).filter { $0.element.group == group }, id: \.element.id) { index, item in
                                    Button {
                                        execute(item)
                                    } label: {
                                        paletteRow(item, selected: index == selectedIndex)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .frame(maxHeight: 330)
                    .background(ForgeDesign.paper)
                }

                HStack(spacing: 16) {
                    Text("↑↓ navigate")
                    Text("↵ open")
                    Text("⌘↵ run")
                    Spacer()
                    Text("fuzzy across tasks and commands")
                }
                .font(ForgeDesign.mono(9.5))
                .foregroundStyle(ForgeDesign.muted)
                .padding(.horizontal, 18)
                .frame(height: 40)
                .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                .overlay(alignment: .top) {
                    Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                }
            }
            .frame(width: 620)
            .background(ForgeDesign.paper)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            .forgeShadow(ForgeDesign.ink, x: 8, y: 8)
            .padding(.top, 56)
        }
        .onAppear { searchFocused = true }
        .onChange(of: query) { _, _ in selectedIndex = 0 }
        .onKeyPress(.downArrow) {
            moveSelection(1)
            return .handled
        }
        .onKeyPress(.upArrow) {
            moveSelection(-1)
            return .handled
        }
        .onKeyPress(.return) {
            executeSelection()
            return .handled
        }
        .onExitCommand { isPresented = false }
    }

    private func paletteRow(_ item: CommandPaletteItem, selected: Bool) -> some View {
        HStack(spacing: 12) {
            Text(item.glyph)
                .font(ForgeDesign.mono(11, weight: .heavy))
                .foregroundStyle(selected ? ForgeDesign.ink : Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                .frame(width: 16)
            Text(item.title)
                .font(.system(size: 13, weight: selected ? .bold : .regular))
                .lineLimit(1)
            Spacer()
            Text(item.metadata)
                .font(ForgeDesign.mono(9, weight: selected ? .bold : .regular))
                .foregroundStyle(selected ? ForgeDesign.ink : Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                .lineLimit(1)
            if let shortcut = item.shortcut {
                Text(shortcut)
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(ForgeDesign.paper)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            }
        }
        .padding(.horizontal, 18)
        .frame(height: 42)
        .foregroundStyle(ForgeDesign.ink)
        .background(selected ? ForgeDesign.accent : Color.white)
        .overlay(alignment: .bottom) {
            Rectangle().fill(selected ? ForgeDesign.ink : ForgeDesign.divider).frame(height: 1.5)
        }
    }

    private var allItems: [CommandPaletteItem] {
        let taskItems = workspace.tasks.map { task in
            CommandPaletteItem(
                id: "task-\(task.id)",
                group: "TASKS",
                glyph: "▸",
                title: task.title,
                metadata: "#\(task.id.prefix(6)) · \(task.status.uppercased())",
                shortcut: nil,
                action: .task(task.id)
            )
        }
        let commandItems = [
            CommandPaletteItem(id: "new", group: "COMMANDS", glyph: "＋", title: "New task", metadata: "OPEN COMPOSER", shortcut: "⌘N", action: .newTask),
            CommandPaletteItem(id: "repo", group: "COMMANDS", glyph: "⌥", title: "Switch repo…", metadata: "LOCAL WORKSPACE", shortcut: "⌘⇧K", action: .switchRepository),
            CommandPaletteItem(id: "refresh", group: "COMMANDS", glyph: "↻", title: "Refresh runtime", metadata: workspace.runtimeState.rawValue.uppercased(), shortcut: nil, action: .refreshRuntime),
            CommandPaletteItem(id: "settings", group: "COMMANDS", glyph: "⚙", title: "Open settings", metadata: "GUARDRAILS · MODEL", shortcut: "⌘,", action: .settings)
        ]
        return taskItems + commandItems
    }

    private var visibleItems: [CommandPaletteItem] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return Array(allItems.prefix(10)) }
        return allItems.filter {
            fuzzyMatch(trimmed, in: "\($0.title) \($0.metadata)")
        }.prefix(10).map { $0 }
    }

    private var groupNames: [String] {
        var seen = Set<String>()
        return visibleItems.map(\.group).filter { seen.insert($0).inserted }
    }

    private func fuzzyMatch(_ needle: String, in haystack: String) -> Bool {
        var remainder = haystack.lowercased()[...]
        for character in needle.lowercased() {
            guard let index = remainder.firstIndex(of: character) else { return false }
            remainder = remainder[remainder.index(after: index)...]
        }
        return true
    }

    private func moveSelection(_ delta: Int) {
        guard !visibleItems.isEmpty else { return }
        selectedIndex = (selectedIndex + delta + visibleItems.count) % visibleItems.count
    }

    private func executeSelection() {
        if visibleItems.isEmpty {
            workspace.selectedTaskID = nil
            isPresented = false
            return
        }
        execute(visibleItems[min(selectedIndex, visibleItems.count - 1)])
    }

    private func execute(_ item: CommandPaletteItem) {
        switch item.action {
        case .task(let id):
            workspace.selectedTaskID = id
        case .newTask:
            workspace.selectedTaskID = nil
        case .switchRepository:
            workspace.connectRepository()
        case .refreshRuntime:
            workspace.refreshRuntimeHealth()
        case .settings:
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        }
        isPresented = false
    }
}

private struct SidebarView: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @EnvironmentObject private var surfaceCoordinator: WorkspaceSurfaceCoordinator

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Text("⌥")
                    .font(.custom("JetBrains Mono", fixedSize: 12).weight(.black))
                Text(workspaceLabel)
                    .font(.custom("JetBrains Mono", fixedSize: 12).weight(.bold))
                    .lineLimit(1)
                Spacer()
                Button("⌘K") {
                    NotificationCenter.default.post(name: .forgeToggleCommandPalette, object: nil)
                }
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                .foregroundStyle(ForgeDesign.muted)
                .buttonStyle(.plain)
                .help("Open Command Palette")
            }
            .padding(.horizontal, 16)
            .frame(height: 42)
            .background(Color.white)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            TaskComposer()
                .padding(14)

            Text("TASKS — \(workspace.tasks.count)")
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
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

            if !waitingQuestionTasks.isEmpty {
                Button {
                    surfaceCoordinator.present(.answerQueue)
                } label: {
                    HStack {
                        Text("NEEDS YOU")
                        Text("\(waitingQuestionTasks.count)")
                            .foregroundStyle(ForgeDesign.ink)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(ForgeDesign.warning)
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1))
                        Spacer()
                        Text("ANSWER QUEUE")
                            .foregroundStyle(ForgeDesign.muted)
                    }
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .padding(.horizontal, 16)
                    .frame(height: 36)
                    .background(Color.white)
                    .overlay(alignment: .top) {
                        Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                    }
                }
                .buttonStyle(.plain)
            }

            Button {
                surfaceCoordinator.present(.missionControl)
                workspace.refreshMissionControl()
            } label: {
                HStack {
                    Text("MISSION CONTROL")
                    Spacer()
                    Text("⌘⇧M").foregroundStyle(ForgeDesign.muted)
                }
                .font(ForgeDesign.mono(9, weight: .bold))
                .padding(.horizontal, 16)
                .frame(height: 36)
                .background(Color.white)
                .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
            }
            .buttonStyle(.plain)
            .keyboardShortcut(ForgeShortcuts.shortcut("missionControl"))

            Button {
                surfaceCoordinator.present(.taskQueue)
                workspace.refreshTaskQueue()
            } label: {
                HStack {
                    Text("QUEUE")
                    if let queue = workspace.taskQueueSnapshot {
                        Text("\(queue.running.count) RUN · \(queue.queued.count) WAIT")
                            .foregroundStyle(ForgeDesign.muted)
                    }
                    Spacer()
                    Text("⌘⇧Q").foregroundStyle(ForgeDesign.muted)
                }
                .font(ForgeDesign.mono(9, weight: .bold))
                .padding(.horizontal, 16)
                .frame(height: 36)
                .background(Color.white)
                .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
            }
            .buttonStyle(.plain)
            .keyboardShortcut(ForgeShortcuts.shortcut("taskQueue"))

            Button {
                surfaceCoordinator.present(.history)
            } label: {
                HStack {
                    Text("HISTORY")
                    Spacer()
                    Text("⌘Y")
                        .foregroundStyle(ForgeDesign.muted)
                }
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                .padding(.horizontal, 16)
                .frame(height: 36)
                .background(Color.white)
                .overlay(alignment: .top) {
                    Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                }
            }
            .buttonStyle(.plain)

            RuntimeBadge()
                .padding(.horizontal, 16)
                .frame(height: 42)
                .overlay(alignment: .top) {
                    Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                }
        }
        .background(ForgeDesign.paper)
    }

    private var waitingQuestionTasks: [ForgeTask] {
        workspace.tasks.filter {
            $0.status == "Human Review" &&
                $0.currentPhase != "Plan Review" &&
                $0.agentRunSteps.last?.action == "WaitForHumanReview"
        }
    }

    private var workspaceLabel: String {
        guard let path = workspace.runtimeHealth?.workspace?.repoRoot else {
            return "LOCAL WORKSPACE"
        }
        return URL(fileURLWithPath: path).lastPathComponent
    }
}

private struct RuntimeBadge: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @AppStorage("forge.monthlyBudgetCap") private var monthlyBudgetCap = 40

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(runtimeColor)
                .frame(width: 8, height: 8)
            Text(statusLabel)
                .font(.custom("JetBrains Mono", fixedSize: 9.5))
                .lineLimit(1)
            Spacer()
            Text(String(format: "$%.2f / $%d", estimatedSpend, monthlyBudgetCap))
                .font(.custom("JetBrains Mono", fixedSize: 9.5))
                .foregroundStyle(ForgeDesign.muted)
            Button {
                workspace.refreshRuntimeHealth()
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.plain)
            .help("Refresh local runtime status")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusLabel: String {
        guard workspace.runtimeState == .running else {
            return workspace.runtimeState.rawValue.uppercased()
        }
        let running = workspace.tasks.filter {
            workspace.isRunningAgentLoop(taskID: $0.id) ||
                ["Running", "Testing"].contains($0.status)
        }.count
        return "\(running) running"
    }

    private var estimatedSpend: Double {
        workspace.tasks.compactMap { $0.planRevisions.last?.estimatedCostUSD }.reduce(0, +)
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

private enum HistoryFilter: String, CaseIterable, Identifiable {
    case all = "ALL"
    case complete = "COMPLETE"
    case review = "IN REVIEW"
    case failed = "FAILED"

    var id: String { rawValue }
}

private struct HandoffSurfaceTitleBar: View {
    @EnvironmentObject private var surfaceCoordinator: WorkspaceSurfaceCoordinator
    var title: String

    var body: some View {
        ZStack {
            HStack(spacing: 10) {
                ForgeLogo(size: 18)
                Text("FORGE — \(title)")
                    .font(.custom("JetBrains Mono", fixedSize: 12).weight(.bold))
                    .tracking(0.5)
            }
            HStack {
                Spacer()
                Text(ForgeDesign.appVersion)
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(ForgeDesign.muted)
                Button("CLOSE") {
                    surfaceCoordinator.dismiss()
                }
                .font(ForgeDesign.mono(9, weight: .bold))
                .buttonStyle(.plain)
                .keyboardShortcut(.cancelAction)
            }
            .padding(.trailing, 16)
        }
        .frame(height: 42)
        .background(Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255))
        .overlay(alignment: .bottom) {
            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
        }
    }
}

private struct TaskQueueView: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    let openTask: (ForgeTask.ID) -> Void

    private var snapshot: TaskQueueSnapshot? { workspace.taskQueueSnapshot }

    var body: some View {
        VStack(spacing: 0) {
            HandoffSurfaceTitleBar(title: "QUEUE")
            queueHeader

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    laneTitle("RUNNING — \(snapshot?.running.count ?? 0) OF \(snapshot?.concurrencyLimit ?? 2)")
                    if snapshot?.running.isEmpty != false {
                        emptyLane("No agent loop is active.")
                    } else {
                        ForEach(snapshot?.running ?? []) { entry in runningRow(entry) }
                    }

                    HStack {
                        laneTitle("QUEUED — \(snapshot?.queued.count ?? 0) · STARTS WHEN A SLOT FREES")
                        Spacer()
                        Text("↑ ↓ reorder").font(ForgeDesign.mono(9)).foregroundStyle(ForgeDesign.muted)
                    }
                    if snapshot?.queued.isEmpty != false {
                        emptyLane("Queue is clear — approved runs start immediately when the repository slot is free.")
                    } else {
                        ForEach(Array((snapshot?.queued ?? []).enumerated()), id: \.element.id) { index, entry in
                            queuedRow(entry, index: index)
                        }
                    }

                    if snapshot?.needsAttention.isEmpty == false {
                        laneTitle("NEEDS YOU — \(snapshot?.needsAttention.count ?? 0)")
                        ForEach((snapshot?.needsAttention ?? []).prefix(4)) { entry in
                            Button { openTask(entry.taskID) } label: {
                                HStack(spacing: 10) {
                                    Text("⏸ NEEDS YOU").font(ForgeDesign.mono(8.5, weight: .bold))
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(ForgeDesign.warning)
                                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                                    Text(entry.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                                    Spacer()
                                    Text(entry.currentPhase).font(ForgeDesign.mono(9)).foregroundStyle(ForgeDesign.muted)
                                    Text("→").font(ForgeDesign.mono(11, weight: .black))
                                }
                                .padding(.horizontal, 16).frame(height: 44)
                                .background(Color(red: 1, green: 0.99, blue: 0.94))
                                .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1))
                                .padding(.horizontal, 24).padding(.bottom, 8)
                            }.buttonStyle(.plain)
                        }
                    }

                    if let error = workspace.taskQueueLastError {
                        Label(error, systemImage: "exclamationmark.octagon.fill")
                            .font(ForgeDesign.mono(10, weight: .bold)).foregroundStyle(ForgeDesign.danger)
                            .padding(.horizontal, 24).padding(.vertical, 12)
                    }
                }
                .padding(.bottom, 12)
            }

            queueFooter
        }
        .background(ForgeDesign.paper)
        .onAppear { workspace.refreshTaskQueue() }
    }

    private var queueHeader: some View {
        HStack(spacing: 16) {
            Text("CONCURRENCY").font(ForgeDesign.mono(10, weight: .bold)).tracking(1).foregroundStyle(ForgeDesign.muted)
            HStack(spacing: 0) {
                ForEach(1...3, id: \.self) { limit in
                    Button("\(limit)") { workspace.updateTaskQueueConcurrency(limit) }
                        .font(ForgeDesign.mono(10, weight: .bold))
                        .foregroundStyle(snapshot?.concurrencyLimit == limit ? ForgeDesign.paper : ForgeDesign.ink)
                        .frame(width: 44, height: 32)
                        .background(snapshot?.concurrencyLimit == limit ? ForgeDesign.ink : Color.white)
                        .overlay(alignment: .trailing) { if limit < 3 { Rectangle().fill(ForgeDesign.ink).frame(width: 1.5) } }
                        .buttonStyle(.plain)
                }
            }.overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

            Text("global ceiling · this repository stays serialized")
                .font(ForgeDesign.mono(9.5)).foregroundStyle(ForgeDesign.muted)
            Spacer()
            Circle().fill(ForgeDesign.accent).frame(width: 7, height: 7)
            Text(snapshot?.summary ?? "Loading real queue state…")
                .font(ForgeDesign.mono(10, weight: .bold))
            Button { workspace.refreshTaskQueue() } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.plain)
        }
        .padding(.horizontal, 24).frame(height: 58).background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private func laneTitle(_ title: String) -> some View {
        Text(title).font(ForgeDesign.mono(9, weight: .bold)).tracking(1.5).foregroundStyle(ForgeDesign.muted)
            .padding(.horizontal, 24).padding(.top, 14).padding(.bottom, 7)
    }

    private func runningRow(_ entry: TaskQueueEntry) -> some View {
        HStack(spacing: 14) {
            Text("▸ RUN").font(ForgeDesign.mono(8.5, weight: .bold)).padding(.horizontal, 6).padding(.vertical, 2)
                .background(ForgeDesign.accent).overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            Text("#\(entry.taskID.prefix(6))").font(ForgeDesign.mono(9)).foregroundStyle(ForgeDesign.muted)
            Button(entry.title) { openTask(entry.taskID) }.buttonStyle(.plain).font(.system(size: 13, weight: .bold)).lineLimit(1)
            Spacer()
            Text(workspace.gitStatus?.root.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "local repo")
                .font(ForgeDesign.mono(9.5)).foregroundStyle(ForgeDesign.muted)
            ProgressView(value: Double(entry.loop?.stepsRun ?? 0), total: Double(max(1, entry.loop?.maxSteps ?? 1))).frame(width: 130)
            Text("step \(entry.loop?.stepsRun ?? 0)/\(entry.loop?.maxSteps ?? 0)").font(ForgeDesign.mono(9.5)).frame(width: 70)
            Button("⏸") {
                if let task = workspace.tasks.first(where: { $0.id == entry.taskID }), let loop = entry.loop {
                    workspace.pauseAgentLoop(for: task, loop: loop)
                }
            }.buttonStyle(ForgeSecondaryButtonStyle()).disabled(entry.loop == nil)
        }
        .padding(.horizontal, 16).frame(height: 54).background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5)).padding(.horizontal, 24).padding(.bottom, 8)
    }

    private func queuedRow(_ entry: TaskQueueEntry, index: Int) -> some View {
        HStack(spacing: 12) {
            Text("⠿").font(ForgeDesign.mono(12)).foregroundStyle(ForgeDesign.muted)
            Text("\(entry.position ?? index + 1)").font(ForgeDesign.mono(9, weight: .black)).frame(width: 22, height: 22)
                .background(index == 0 ? ForgeDesign.warning : Color.white).overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            Text("#\(entry.taskID.prefix(6))").font(ForgeDesign.mono(9)).foregroundStyle(ForgeDesign.muted)
            Button(entry.title) { openTask(entry.taskID) }.buttonStyle(.plain).font(.system(size: 13, weight: .semibold)).lineLimit(1)
            Spacer()
            if index == 0 { Text("NEXT").font(ForgeDesign.mono(8, weight: .bold)).padding(.horizontal, 6).padding(.vertical, 2).background(ForgeDesign.warning).overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5)) }
            Text(entry.estimatedMinutes.map { "~\($0)m" } ?? "—").font(ForgeDesign.mono(9.5)).foregroundStyle(ForgeDesign.muted).frame(width: 56)
            Button("↑") { workspace.moveQueuedTask(taskID: entry.taskID, offset: -1) }.buttonStyle(.plain).disabled(index == 0)
            Button("↓") { workspace.moveQueuedTask(taskID: entry.taskID, offset: 1) }.buttonStyle(.plain).disabled(index + 1 >= (snapshot?.queued.count ?? 0))
            Button("✕") { workspace.removeQueuedTask(taskID: entry.taskID) }.buttonStyle(ForgeSecondaryButtonStyle())
        }
        .padding(.horizontal, 16).frame(height: 50).background(Color.white)
        .overlay(Rectangle().stroke(index == 0 ? ForgeDesign.ink : ForgeDesign.divider, lineWidth: 1.5))
        .padding(.horizontal, 24).padding(.bottom, 8)
    }

    private func emptyLane(_ text: String) -> some View {
        Text(text).font(ForgeDesign.mono(10)).foregroundStyle(ForgeDesign.muted)
            .frame(maxWidth: .infinity, alignment: .leading).padding(16).background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1)).padding(.horizontal, 24).padding(.bottom, 8)
    }

    private var queueFooter: some View {
        HStack {
            Text("▸ same-repo tasks never run in parallel — queue serializes workspace mutation")
            Spacer()
            Text("limit \(snapshot?.concurrencyLimit ?? 2) · effective here \(snapshot?.effectiveRepositoryLimit ?? 1)")
        }.font(ForgeDesign.mono(9.5)).foregroundStyle(ForgeDesign.muted)
            .padding(.horizontal, 24).frame(height: 46).background(ForgeDesign.paper)
            .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }
}

private struct TaskHistoryView: View {
    var tasks: [ForgeTask]
    var openTask: (ForgeTask) -> Void

    @State private var filter = HistoryFilter.all
    @State private var search = ""

    var body: some View {
        VStack(spacing: 0) {
            HandoffSurfaceTitleBar(title: "HISTORY")

            HStack(spacing: 12) {
                HStack(spacing: 0) {
                    ForEach(HistoryFilter.allCases) { item in
                        Button {
                            filter = item
                        } label: {
                            HStack(spacing: 7) {
                                Text(item.rawValue)
                                Text("\(count(for: item))").opacity(0.55)
                            }
                            .font(.custom("JetBrains Mono", fixedSize: 10.5).weight(.bold))
                            .foregroundStyle(filter == item ? Color.white : ForgeDesign.ink)
                            .padding(.horizontal, 14)
                            .frame(height: 34)
                            .background(filter == item ? ForgeDesign.ink : Color.white)
                            .overlay(alignment: .trailing) {
                                if item != HistoryFilter.allCases.last {
                                    Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

                HStack(spacing: 8) {
                    Text("⌕").foregroundStyle(ForgeDesign.muted)
                    TextField("Search tasks", text: $search)
                        .textFieldStyle(.plain)
                        .font(.custom("JetBrains Mono", fixedSize: 11))
                }
                .padding(.horizontal, 12)
                .frame(height: 34)
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            }
            .padding(.horizontal, 20)
            .frame(height: 58)
            .background(Color.white)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            HStack(spacing: 0) {
                Text("ID").frame(width: 62, alignment: .leading)
                Text("TASK").frame(maxWidth: .infinity, alignment: .leading)
                Text("DIFF").frame(width: 96, alignment: .leading)
                Text("UPDATED").frame(width: 120, alignment: .leading)
                Text("STATUS").frame(width: 100, alignment: .trailing)
            }
            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
            .tracking(1)
            .foregroundStyle(ForgeDesign.muted)
            .padding(.horizontal, 20)
            .frame(height: 32)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(filteredTasks) { task in
                        Button { openTask(task) } label: {
                            HStack(spacing: 0) {
                                Text("#\(task.id.prefix(6))")
                                    .font(.custom("JetBrains Mono", fixedSize: 10.5))
                                    .foregroundStyle(ForgeDesign.muted)
                                    .frame(width: 62, alignment: .leading)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(task.title)
                                        .font(.system(size: 13, weight: .bold))
                                        .lineLimit(1)
                                    Text("\(task.currentPhase) · \(task.planSteps.count) steps")
                                        .font(.custom("JetBrains Mono", fixedSize: 9.5))
                                        .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text("\(task.changedFiles.count) files")
                                    .font(.custom("JetBrains Mono", fixedSize: 10.5).weight(.bold))
                                    .frame(width: 96, alignment: .leading)
                                Text(shortTimestamp(task.updatedAt))
                                    .font(.custom("JetBrains Mono", fixedSize: 10.5))
                                    .foregroundStyle(ForgeDesign.muted)
                                    .frame(width: 120, alignment: .leading)
                                StatusPill(label: task.status, color: statusColor(task.status))
                                    .frame(width: 100, alignment: .trailing)
                            }
                            .padding(.horizontal, 20)
                            .frame(height: 60)
                            .background(Color.white)
                            .overlay(alignment: .bottom) {
                                Rectangle().fill(ForgeDesign.divider).frame(height: 1.5)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            HStack {
                Text("\(filteredTasks.count) tasks · \(completedCount) complete · \(failedCount) failed")
                Spacer()
                Text("lifetime changed files \(tasks.flatMap(\.changedFiles).count)")
            }
            .font(.custom("JetBrains Mono", fixedSize: 10))
            .foregroundStyle(ForgeDesign.muted)
            .padding(.horizontal, 20)
            .frame(height: 42)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .top) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }
        }
        .background(ForgeDesign.paper)
    }

    private var filteredTasks: [ForgeTask] {
        tasks.filter { task in
            let statusMatches: Bool
            switch filter {
            case .all: statusMatches = true
            case .complete: statusMatches = task.status == "Completed"
            case .review: statusMatches = task.status == "Human Review"
            case .failed: statusMatches = task.status == "Failed"
            }
            let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return statusMatches && (query.isEmpty || task.title.lowercased().contains(query) || task.objective.lowercased().contains(query))
        }
    }
    private var completedCount: Int { tasks.filter { $0.status == "Completed" }.count }
    private var failedCount: Int { tasks.filter { $0.status == "Failed" }.count }

    private func count(for filter: HistoryFilter) -> Int {
        switch filter {
        case .all: return tasks.count
        case .complete: return completedCount
        case .review: return tasks.filter { $0.status == "Human Review" }.count
        case .failed: return failedCount
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "Completed": return ForgeDesign.success
        case "Failed": return ForgeDesign.danger
        case "Human Review": return ForgeDesign.warning
        case "Running", "Testing": return ForgeDesign.accent
        default: return Color.white
        }
    }

    private func shortTimestamp(_ value: String) -> String {
        value.replacingOccurrences(of: "T", with: " ").prefix(16).description
    }
}

private struct TaskAuditLogView: View {
    var task: ForgeTask

    var body: some View {
        VStack(spacing: 0) {
            HandoffSurfaceTitleBar(title: "#\(task.id.prefix(6)) AUDIT LOG")
            HStack(spacing: 12) {
                StatusPill(label: task.status, color: statusColor)
                Text(task.title)
                    .font(.system(size: 15, weight: .heavy))
                    .lineLimit(1)
                Spacer()
                Text(shortTimestamp(task.updatedAt))
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(ForgeDesign.muted)
                Button("⤓ EXPORT LOG", action: exportLog)
                    .buttonStyle(ForgeSecondaryButtonStyle())
            }
            .padding(.horizontal, 24)
            .frame(height: 58)
            .background(Color.white)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(task.events.enumerated()), id: \.offset) { _, event in
                        HStack(alignment: .top, spacing: 12) {
                            Text(timeOnly(event.createdAt))
                                .foregroundStyle(Color(red: 106 / 255, green: 106 / 255, blue: 100 / 255))
                                .frame(width: 70, alignment: .leading)
                            Text("[\(eventCategory(event.type))]")
                                .foregroundStyle(Color(red: 106 / 255, green: 106 / 255, blue: 100 / 255))
                                .frame(width: 72, alignment: .leading)
                            Text(event.message)
                                .foregroundStyle(event.type.contains("approval") ? ForgeDesign.accent : Color(red: 232 / 255, green: 232 / 255, blue: 228 / 255))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .font(.custom("JetBrains Mono", fixedSize: 11.5))
                        .padding(.horizontal, 24)
                        .padding(.vertical, 7)
                    }
                }
            }
            .background(ForgeDesign.ink)

            HStack {
                Text("every file read, command run, and human action — timestamped")
                Spacer()
                Text("\(task.approvals.count) human touchpoints · \(directPushCount) direct pushes")
            }
            .font(.custom("JetBrains Mono", fixedSize: 10))
            .foregroundStyle(ForgeDesign.muted)
            .padding(.horizontal, 24)
            .frame(height: 42)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .top) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }
        }
    }

    private var statusColor: Color {
        switch task.status {
        case "Completed": return ForgeDesign.success
        case "Failed": return ForgeDesign.danger
        case "Human Review": return ForgeDesign.warning
        default: return ForgeDesign.accent
        }
    }
    private var directPushCount: Int {
        task.approvals.filter { $0.action.lowercased().contains("push") }.count
    }

    private func shortTimestamp(_ value: String) -> String {
        value.replacingOccurrences(of: "T", with: " ").prefix(19).description
    }
    private func timeOnly(_ value: String) -> String {
        let normalized = value.replacingOccurrences(of: "Z", with: "")
        return normalized.split(separator: "T").last.map { String($0.prefix(8)) } ?? String(value.prefix(8))
    }
    private func eventCategory(_ type: String) -> String {
        if type.contains("conversation") || type.contains("approval") { return "human" }
        if type.contains("validation") || type.contains("command") { return "cmd" }
        if type.contains("edit") || type.contains("proposal") { return "write" }
        if type.contains("git") { return "git" }
        if type.contains("context") || type.contains("inspection") { return "read" }
        if type.contains("plan") { return "plan" }
        return "agent"
    }
    private func exportLog() {
        let lines = task.events.map { "\($0.createdAt) [\(eventCategory($0.type))] \($0.message)" }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(lines.joined(separator: "\n"), forType: .string)
    }
}

private struct TaskComposer: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @State private var objective = ""

    var body: some View {
        HStack(spacing: 0) {
            TextField("describe a task… (↵ to plan)", text: $objective)
                .textFieldStyle(.plain)
                .font(.custom("JetBrains Mono", fixedSize: 11))
                .padding(.horizontal, 9)
                .onSubmit(createTask)
            Button {
                createTask()
            } label: {
                Text("⌘N")
                    .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                    .foregroundStyle(ForgeDesign.muted)
                    .frame(width: 38, height: 34)
            }
            .buttonStyle(.plain)
            .background(Color.white)
            .overlay(alignment: .leading) {
                Rectangle().fill(ForgeDesign.divider).frame(width: 1.5)
            }
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
                    .font(.custom("JetBrains Mono", fixedSize: 8).weight(.bold))
                    .foregroundStyle(statusForeground)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(statusColor)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                Spacer()
                Text("#\(task.id.prefix(4).uppercased())")
                    .font(.custom("JetBrains Mono", fixedSize: 8))
                    .foregroundStyle(ForgeDesign.muted)
            }

            Text(task.title)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(ForgeDesign.ink)
                .lineLimit(2)
            Text(task.currentPhase.uppercased())
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.medium))
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
    @EnvironmentObject private var surfaceCoordinator: WorkspaceSurfaceCoordinator
    var task: ForgeTask
    @State private var selectedTab: SessionTab = .log

    var body: some View {
        GeometryReader { proxy in
            HStack(alignment: .top, spacing: 0) {
                TaskConversationPanel(task: task)
                    .frame(width: max(430, proxy.size.width / 2.1))
                    .frame(maxHeight: .infinity)

                VStack(spacing: 0) {
                    LiveWorkStatusHeader(task: task)
                    PlanProgressStrip(task: task)
                    SessionTabContent(
                        tab: selectedTab,
                        task: task,
                        openDiffReview: {
                            surfaceCoordinator.present(.diff(taskID: task.id))
                        }
                    )
                    HStack(spacing: 0) {
                        SessionTabs(selectedTab: $selectedTab, task: task)
                            .frame(width: 330)
                        LiveRunControlBar(
                            task: task,
                            openDiffReview: {
                                surfaceCoordinator.present(.diff(taskID: task.id))
                            }
                        )
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .background(ForgeDesign.paper)
    }
}

private struct LiveWorkStatusHeader: View {
    var task: ForgeTask

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(ForgeDesign.accent)
                .frame(width: 7, height: 7)
            Text(statusLabel)
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                .tracking(1)
            Spacer()
            Text(task.agentRunLoops.last.map { "\($0.stepsRun)/\($0.maxSteps) STEPS" } ?? "GUARDRAILS ON")
                .font(.custom("JetBrains Mono", fixedSize: 9))
                .foregroundStyle(ForgeDesign.muted)
        }
        .padding(.horizontal, 18)
        .frame(height: 36)
        .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
        .overlay(alignment: .bottom) {
            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
        }
    }

    private var statusLabel: String {
        if let loop = task.agentRunLoops.last {
            return "AGENT \(loop.status.uppercased()) — STEP \(loop.stepsRun)/\(loop.maxSteps)"
        }
        return "AGENT READY — \(task.currentPhase.uppercased())"
    }
}

private struct RunningTaskWorkspaceView: View {
    @EnvironmentObject private var surfaceCoordinator: WorkspaceSurfaceCoordinator
    var task: ForgeTask
    @State private var selectedTab: SessionTab = .log

    var body: some View {
        VStack(spacing: 0) {
            RunningTaskHeader(task: task, openDiffReview: { surfaceCoordinator.present(.diff(taskID: task.id)) })
            PlanProgressStrip(task: task)
            SessionTabContent(
                tab: selectedTab,
                task: task,
                openDiffReview: { surfaceCoordinator.present(.diff(taskID: task.id)) }
            )
            RunningSessionFooter(selectedTab: $selectedTab, task: task)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.white)
    }
}

private struct FirstTaskSuccessState: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    let task: ForgeTask
    let queueNext: () -> Void
    let viewOnGitHub: () -> Void

    var body: some View {
        ZStack {
            FirstSuccessPattern()
            FirstSuccessConfetti()

            VStack(spacing: 0) {
                Text("✓")
                    .font(ForgeDesign.mono(42, weight: .black))
                    .frame(width: 88, height: 88)
                    .background(ForgeDesign.accent)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    .forgeShadow(ForgeDesign.ink, x: 6, y: 6)
                    .padding(.bottom, 24)

                Text("FIRST TASK SHIPPED")
                    .font(ForgeDesign.mono(11, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(ForgeDesign.muted)
                    .padding(.bottom, 10)

                Text("You just shipped without typing code.")
                    .font(.system(size: 28, weight: .heavy))
                    .tracking(-0.6)
                    .padding(.bottom, 12)

                Text("\"\(task.title)\" is complete on \(branchName). Reviewed by you, written by the agent — that's the whole idea.")
                    .font(.system(size: 14))
                    .foregroundStyle(ForgeDesign.muted)
                    .multilineTextAlignment(.center)
                    .lineSpacing(5)
                    .frame(maxWidth: 440)
                    .padding(.bottom, 26)

                receipt
                    .frame(width: 600)
                    .padding(.bottom, 26)

                HStack(spacing: 12) {
                    Button("＋ QUEUE THE NEXT ONE", action: queueNext)
                        .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.ink, foreground: ForgeDesign.accent))

                    Button("VIEW ON GITHUB ↗", action: viewOnGitHub)
                        .buttonStyle(ForgeSecondaryButtonStyle())
                        .disabled(workspace.gitStatus?.repositoryWebURL == nil)
                        .help(workspace.gitStatus?.repositoryWebURL == nil
                              ? "No GitHub remote is configured for this workspace."
                              : "Open the configured GitHub repository.")
                }

                Text("shown once — after this, completions are just a notification")
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                    .padding(.top, 18)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ForgeDesign.paper)
    }

    private var receipt: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                Text("RECEIPT — TASK #\(task.id.prefix(6).uppercased())")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                Spacer()
                Text("completed \(completionTime)")
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
            }
            .padding(.horizontal, 16)
            .frame(height: 38)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))

            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)

            HStack(spacing: 0) {
                receiptMetric(label: "ELAPSED", value: "\(elapsedMinutes) min")
                receiptMetric(label: "AGENT TIME", value: "\(agentMinutes) min")
                receiptMetric(label: "DIFF", value: "+\(diffStats.additions) −\(diffStats.deletions)")
                receiptMetric(label: "COST", value: costLabel, drawsDivider: false)
            }
            .frame(height: 66)

            Rectangle().fill(ForgeDesign.divider).frame(height: 1)

            Text("\(passedTestCount) checks ✓ · \(reviewChangeCount) review change request\(reviewChangeCount == 1 ? "" : "s") · completed by you")
                .font(ForgeDesign.mono(10))
                .foregroundStyle(ForgeDesign.muted)
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 36)
        }
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private func receiptMetric(label: String, value: String, drawsDivider: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(ForgeDesign.mono(8.5, weight: .bold))
                .tracking(1)
                .foregroundStyle(ForgeDesign.muted)
            Text(value)
                .font(ForgeDesign.mono(17, weight: .black))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .overlay(alignment: .trailing) {
            if drawsDivider { Rectangle().fill(ForgeDesign.divider).frame(width: 1) }
        }
    }

    private var branchName: String { workspace.gitStatus?.branch ?? "the local workspace" }

    private var completionTime: String {
        guard let date = ISO8601DateFormatter().date(from: task.updatedAt) else { return "locally" }
        return date.formatted(date: .omitted, time: .shortened)
    }

    private var elapsedMinutes: Int {
        guard let start = ISO8601DateFormatter().date(from: task.createdAt),
              let end = ISO8601DateFormatter().date(from: task.updatedAt)
        else { return 1 }
        return max(1, Int(ceil(end.timeIntervalSince(start) / 60)))
    }

    private var agentMinutes: Int {
        let seconds = task.agentRunLoops.reduce(0.0) { partial, loop in
            guard let start = ISO8601DateFormatter().date(from: loop.startedAt),
                  let completedAt = loop.completedAt,
                  let end = ISO8601DateFormatter().date(from: completedAt)
            else { return partial }
            return partial + max(0, end.timeIntervalSince(start))
        }
        return max(1, Int(ceil(seconds / 60)))
    }

    private var diffStats: (additions: Int, deletions: Int) {
        let proposal = task.editProposalRevisions.last(where: { $0.status == "Applied" }) ?? task.editProposal
        return proposal?.fileChanges.reduce(into: (additions: 0, deletions: 0)) { result, change in
            for line in change.diffPreview.split(separator: "\n", omittingEmptySubsequences: false) {
                if line.hasPrefix("+") && !line.hasPrefix("+++") { result.additions += 1 }
                if line.hasPrefix("-") && !line.hasPrefix("---") { result.deletions += 1 }
            }
        } ?? (0, 0)
    }

    private var costLabel: String {
        guard let cost = task.planRevisions.last?.estimatedCostUSD else { return "LOCAL" }
        return String(format: "$%.2f", cost)
    }

    private var passedTestCount: Int {
        let validationCommands = task.validationRuns.flatMap(\.commands).filter { $0.status == "Passed" }.count
        let taskCommands = task.taskCommandRuns.filter { $0.status == "Passed" }.count
        return validationCommands + taskCommands
    }

    private var reviewChangeCount: Int {
        task.editProposalRevisions
            .flatMap { $0.fileDecisions ?? [] }
            .filter { $0.decision == "ChangesRequested" }
            .count
    }
}

private struct FirstSuccessPattern: View {
    var body: some View {
        Canvas { context, size in
            var path = Path()
            for offset in stride(from: -size.height, through: size.width, by: 12) {
                path.move(to: CGPoint(x: offset, y: size.height))
                path.addLine(to: CGPoint(x: offset + size.height, y: 0))
            }
            context.stroke(path, with: .color(ForgeDesign.accent.opacity(0.05)), lineWidth: 1)
        }
        .allowsHitTesting(false)
    }
}

private struct FirstSuccessConfetti: View {
    private let pieces: [(CGFloat, CGFloat, CGFloat, Double, Bool)] = [
        (-360, -220, 12, 18, true), (-245, -150, 8, -12, false),
        (330, -200, 12, 30, false), (390, -100, 9, -25, true),
        (-320, 190, 10, 45, true), (260, 220, 8, 10, false),
        (-410, 20, 7, -40, false), (415, 70, 11, 60, true)
    ]

    var body: some View {
        ZStack {
            ForEach(Array(pieces.enumerated()), id: \.offset) { _, piece in
                Rectangle()
                    .fill(piece.4 ? ForgeDesign.accent : ForgeDesign.ink)
                    .frame(width: piece.2, height: piece.2)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: piece.4 ? 1.5 : 0))
                    .rotationEffect(.degrees(piece.3))
                    .offset(x: piece.0, y: piece.1)
            }
        }
        .allowsHitTesting(false)
    }
}

private struct RunCompleteState: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @EnvironmentObject private var surfaceCoordinator: WorkspaceSurfaceCoordinator

    var task: ForgeTask

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                StatusPill(label: "✓ ALL STEPS PASSED", color: ForgeDesign.accent)
                Text(task.title)
                    .font(.system(size: 16, weight: .heavy))
                    .tracking(-0.3)
                    .lineLimit(1)
                Spacer()
                Text("#\(task.id.prefix(6)) · finished in \(completionDuration)")
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(ForgeDesign.muted)
            }
            .padding(.horizontal, 28)
            .frame(height: 62)
            .background(Color.white)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            HStack(spacing: 0) {
                completionMetric(
                    label: "DIFF",
                    value: "+\(additionCount) −\(deletionCount)",
                    detail: "\(filePaths.count) files · \(newFileCount) new"
                )
                completionMetric(
                    label: "TESTS",
                    value: "\(passedCommandCount) passed",
                    detail: "\(newTestCount) runs · \(task.commandRerunEvidence.count) self-fix"
                )
                completionMetric(
                    label: "REVIEW LOAD",
                    value: "~\(reviewMinutes) min",
                    detail: "reasoning attached per diff",
                    drawsDivider: false
                )
            }
            .frame(height: 88)
            .background(Color.white)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(filePaths.prefix(4).enumerated()), id: \.element) { index, path in
                    HStack(spacing: 8) {
                        Text("✓")
                            .foregroundStyle(ForgeDesign.accent)
                            .fontWeight(.bold)
                        Text(path)
                            .foregroundStyle(ForgeDesign.ink)
                        Text(fileDetail(path))
                            .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                        Spacer()
                    }
                    .font(.custom("JetBrains Mono", fixedSize: 11.5))
                    .frame(height: 30)

                    if index < min(filePaths.count, 4) - 1 {
                        Rectangle().fill(ForgeDesign.divider).frame(height: 1)
                    }
                }

                if filePaths.isEmpty {
                    Text("✓ reviewed workspace diff · validation evidence attached")
                        .font(.custom("JetBrains Mono", fixedSize: 11.5))
                        .foregroundStyle(ForgeDesign.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(height: 60)
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 126, alignment: .topLeading)
            .background(Color.white)

            Spacer(minLength: 0)

            HStack(spacing: 10) {
                (Text("branch ")
                    + Text(branchName).fontWeight(.bold).foregroundStyle(ForgeDesign.ink)
                    + Text(" · PR body ready for reviewed handoff"))
                    .font(.custom("JetBrains Mono", fixedSize: 10.5))
                    .foregroundStyle(ForgeDesign.muted)
                    .lineLimit(1)
                Spacer()
                Button("VIEW FULL DIFF") {
                    surfaceCoordinator.present(.diff(taskID: task.id))
                }
                .buttonStyle(ForgeSecondaryButtonStyle())
                Button("⇡ OPEN PR ON GITHUB →") {
                    workspace.prepareGitPullRequestReview(for: task)
                }
                .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
                .disabled(workspace.isPreparingGitPullRequestReview(taskID: task.id))
            }
            .padding(.horizontal, 28)
            .frame(height: 62)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .top) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }
        }
        .background(ForgeDesign.paper)
    }

    /// Real elapsed time from creation to the final update.
    private var completionDuration: String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let created = parser.date(from: task.createdAt),
              let updated = parser.date(from: task.updatedAt)
        else { return "under review" }
        let minutes = max(Int(updated.timeIntervalSince(created) / 60), 0)
        switch minutes {
        case ..<1: return "<1m"
        case ..<90: return "\(minutes)m"
        default: return "\(minutes / 60)h \(minutes % 60)m"
        }
    }

    private func completionMetric(
        label: String,
        value: String,
        detail: String,
        drawsDivider: Bool = true
    ) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                .tracking(1)
                .foregroundStyle(ForgeDesign.muted)
            Text(value)
                .font(.custom("JetBrains Mono", fixedSize: 18).weight(.bold))
            Text(detail)
                .font(.custom("JetBrains Mono", fixedSize: 9.5))
                .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .overlay(alignment: .trailing) {
            if drawsDivider {
                Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
            }
        }
    }

    private var changedFiles: [GitFileChange] {
        workspace.gitStatus?.changedFiles ?? []
    }

    private var filePaths: [String] {
        let proposalPaths = task.editProposal?.fileChanges.map(\.path) ?? []
        let paths = changedFiles.map(\.path) + proposalPaths + task.changedFiles
        return paths.reduce(into: [String]()) { result, path in
            if !result.contains(path) { result.append(path) }
        }
    }

    private var additionCount: Int { changedFiles.compactMap(\.additions).reduce(0, +) }
    private var deletionCount: Int { changedFiles.compactMap(\.deletions).reduce(0, +) }
    private var newFileCount: Int { changedFiles.filter { $0.status == "Added" || $0.untracked }.count }
    private var passedCommandCount: Int {
        task.validationRuns.flatMap(\.commands).filter { $0.status == "Passed" }.count +
            task.taskCommandRuns.filter { $0.status == "Passed" }.count
    }
    private var newTestCount: Int { task.validationRuns.last?.commands.count ?? task.taskCommandRuns.count }
    private var reviewMinutes: Int { max(3, filePaths.count * 2) }
    private var branchName: String { workspace.gitStatus?.branch ?? "local worktree" }

    private func fileDetail(_ path: String) -> String {
        guard let file = changedFiles.first(where: { $0.path == path }) else {
            return "reviewed"
        }
        let prefix = file.status == "Added" || file.untracked ? "new · " : ""
        return "\(prefix)+\(file.additions ?? 0) −\(file.deletions ?? 0)"
    }
}

private struct AgentQuestionState: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @EnvironmentObject private var surfaceCoordinator: WorkspaceSurfaceCoordinator

    var task: ForgeTask
    @State private var selectedAnswer: String?
    @State private var ownAnswer = ""
    @State private var confirmAbort = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text("⏸ PAUSED — WAITING FOR YOUR ANSWER")
                    .font(ForgeDesign.mono(10, weight: .heavy))
                    .tracking(0.5)
                Text("timer runs, budget doesn't — no model calls while paused")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.ink.opacity(0.65))
                Spacer()
                if waitingQuestionTasks.count > 1 {
                    Button("ANSWER QUEUE · \(waitingQuestionTasks.count)") {
                        surfaceCoordinator.present(.answerQueue)
                    }
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(Color.white.opacity(0.65))
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    .buttonStyle(.plain)
                }
                Text(otherTaskNote)
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(ForgeDesign.ink.opacity(0.65))
            }
            .padding(.horizontal, 24)
            .frame(height: 43)
            .background(ForgeDesign.warning)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            HStack(spacing: 0) {
                questionColumn
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)

                contextColumn
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.white)
        .alert("Abort this task?", isPresented: $confirmAbort) {
            Button("Cancel", role: .cancel) {}
            Button("Abort Task", role: .destructive, action: abort)
        } message: {
            Text("The paused loop will stop. Existing reviewed changes and audit evidence remain local.")
        }
    }

    private var questionColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                ForgeLogo(size: 26)
                Text("QUESTION — \(stepProgress) · \(task.currentPhase.uppercased())")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                    .lineLimit(1)
            }
            .padding(.bottom, 16)

            Text(question)
                .font(.system(size: 20, weight: .heavy))
                .tracking(-0.4)
                .lineSpacing(3)
                .padding(.bottom, 10)

            Text(questionContext)
                .font(.system(size: 13))
                .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                .lineSpacing(5)
                .padding(.bottom, 18)

            AgentQuestionChoice(
                title: "FOLLOW RECOMMENDATION",
                detail: recommendation,
                badge: "AGENT LEANS THIS WAY",
                selected: selectedAnswer == recommendation
            ) {
                selectedAnswer = recommendation
                ownAnswer = ""
            }
            .padding(.bottom, 12)

            AgentQuestionChoice(
                title: "REQUEST A SAFER ALTERNATIVE",
                detail: alternative,
                badge: nil,
                selected: selectedAnswer == alternative
            ) {
                selectedAnswer = alternative
                ownAnswer = ""
            }
            .padding(.bottom, 18)

            TextField("or answer in your own words…", text: $ownAnswer)
                .textFieldStyle(.plain)
                .font(ForgeDesign.mono(12))
                .padding(.horizontal, 15)
                .frame(height: 44)
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                .onChange(of: ownAnswer) { _, value in
                    if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        selectedAnswer = nil
                    }
                }

            Spacer(minLength: 16)

            HStack(spacing: 12) {
                Button("▸ ANSWER & RESUME", action: answerAndResume)
                    .buttonStyle(ForgePrimaryButtonStyle(foreground: ForgeDesign.accent))
                    .disabled(resolvedAnswer.isEmpty || workspace.isSendingTaskMessage(taskID: task.id))

                Text(answerStatus)
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                    .lineLimit(1)

                Spacer()

                Button("✕ ABORT TASK") { confirmAbort = true }
                    .font(ForgeDesign.mono(10, weight: .bold))
                    .foregroundStyle(ForgeDesign.danger)
                    .padding(.horizontal, 14)
                    .frame(height: 38)
                    .background(Color.white)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    .buttonStyle(.plain)
                    .disabled(task.agentRunLoops.last == nil)
            }
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 26)
        .background(Color.white)
    }

    private var contextColumn: some View {
        VStack(spacing: 0) {
            Text("WHY IT'S ASKING — CONTEXT")
                .font(ForgeDesign.mono(9, weight: .bold))
                .tracking(1)
                .foregroundStyle(ForgeDesign.muted)
                .padding(.horizontal, 18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 36)
                .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                .overlay(alignment: .bottom) {
                    Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                }

            VStack(alignment: .leading, spacing: 7) {
                ForEach(recentContextEvents) { event in
                    Text("\(OfflineWorkspaceState.clockTime(event.createdAt))  \(event.message)")
                }
                Text("⏸ decision point reached — asking instead of guessing")
                    .foregroundStyle(ForgeDesign.warning)
            }
            .font(ForgeDesign.mono(10.5))
            .foregroundStyle(Color(red: 232 / 255, green: 232 / 255, blue: 228 / 255))
            .padding(.horizontal, 20)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, minHeight: 122, alignment: .topLeading)
            .background(ForgeDesign.ink)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("WHAT EACH ANSWER CHANGES")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)

                VStack(spacing: 0) {
                    comparisonRow("", "RECOMMENDED", "ALTERNATIVE", header: true)
                    comparisonRow("next action", "resume reviewed path", "return for revision")
                    comparisonRow("context", contextSummary, contextSummary)
                    comparisonRow("mutation", "review gates remain", "no work resumes")
                }
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

                Text("INSPECTED CONTEXT")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                    .padding(.top, 4)

                if contextSources.isEmpty {
                    Text("No stored file paths — the question is based on the persisted task rationale.")
                        .font(ForgeDesign.mono(10))
                        .foregroundStyle(ForgeDesign.muted)
                } else {
                    ForEach(contextSources.prefix(5), id: \.self) { path in
                        HStack(spacing: 8) {
                            Text("▸").foregroundStyle(ForgeDesign.accent)
                            Text(path).lineLimit(1).truncationMode(.middle)
                        }
                        .font(ForgeDesign.mono(10))
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .topLeading)

            Spacer()

            Text("▸ the task remains paused until an explicit answer\n▸ this question card and its answer are retained in the local audit trail")
                .font(ForgeDesign.mono(9.5))
                .foregroundStyle(ForgeDesign.muted)
                .lineSpacing(4)
                .padding(.horizontal, 20)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                .overlay(alignment: .top) {
                    Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                }
        }
        .background(Color.white)
    }

    private var latestStep: AgentRunStep? { task.agentRunSteps.last }

    private var pausedElapsed: String {
        Self.minutesLabel(from: task.createdAt, to: nil)
    }

    private var blockedDuration: String {
        Self.minutesLabel(from: latestStep?.createdAt ?? task.updatedAt, to: nil)
    }

    static func minutesLabel(from startISO: String, to endISO: String?) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let start = parser.date(from: startISO) else { return "<1m" }
        let end = endISO.flatMap { parser.date(from: $0) } ?? Date()
        let minutes = max(Int(end.timeIntervalSince(start) / 60), 0)
        switch minutes {
        case ..<1: return "<1m"
        case ..<90: return "\(minutes)m"
        default: return "\(minutes / 60)h \(minutes % 60)m"
        }
    }
    private var question: String {
        latestStep?.summary ?? task.reviewSummary ?? "Forge reached a decision point. Which direction should it take?"
    }
    private var questionContext: String {
        latestStep?.rationale ?? "The choice changes the next reviewed step, so Forge paused instead of guessing."
    }
    private var recommendation: String {
        "Follow the inspected repository evidence: \(latestStep?.rationale ?? "continue with the narrow reviewed approach")"
    }
    private var alternative: String {
        "Keep the task paused and produce a revised approach with narrower risk before continuing."
    }
    private var resolvedAnswer: String {
        let own = ownAnswer.trimmingCharacters(in: .whitespacesAndNewlines)
        return own.isEmpty ? (selectedAnswer ?? "") : own
    }
    private var answerStatus: String {
        if workspace.isSendingTaskMessage(taskID: task.id) { return "recording answer…" }
        return resolvedAnswer.isEmpty ? "choose one or write your own" : "selected · explicit approval required"
    }
    private var stepProgress: String {
        guard let loop = task.agentRunLoops.last else { return task.currentPhase.uppercased() }
        return "STEP \(max(loop.stepsRun, 1))/\(loop.maxSteps)"
    }
    private var otherTaskNote: String {
        let active = workspace.tasks.filter { $0.id != task.id && ["Running", "Testing"].contains($0.status) }.count
        return active == 0 ? "other tasks unaffected" : "other tasks unaffected: \(active) still running"
    }
    private var waitingQuestionTasks: [ForgeTask] {
        workspace.tasks.filter {
            $0.status == "Human Review" &&
                $0.currentPhase != "Plan Review" &&
                $0.agentRunSteps.last?.action == "WaitForHumanReview"
        }
    }
    private var recentContextEvents: [RuntimeEvent] {
        Array(task.events.suffix(3))
    }
    private var contextSources: [String] {
        guard let step = latestStep else { return [] }
        var seen = Set<String>()
        return ((step.contextFilePaths ?? []) + (step.readPaths ?? [])).filter { seen.insert($0).inserted }
    }
    private var contextSummary: String {
        let count = contextSources.count
        return count == 0 ? "persisted rationale" : "\(count) inspected file\(count == 1 ? "" : "s")"
    }

    private func comparisonRow(_ label: String, _ recommended: String, _ alternative: String, header: Bool = false) -> some View {
        HStack(spacing: 0) {
            Text(label)
                .foregroundStyle(header ? ForgeDesign.ink : ForgeDesign.muted)
                .frame(width: 90, alignment: .leading)
                .padding(.horizontal, 10)
            Text(recommended)
                .fontWeight(header ? .bold : .regular)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .overlay(alignment: .leading) { Rectangle().fill(header ? ForgeDesign.ink : ForgeDesign.divider).frame(width: 1.5) }
            Text(alternative)
                .fontWeight(header ? .bold : .regular)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .overlay(alignment: .leading) { Rectangle().fill(header ? ForgeDesign.ink : ForgeDesign.divider).frame(width: 1.5) }
        }
        .font(ForgeDesign.mono(9.5))
        .frame(minHeight: 34)
        .background(header ? Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255) : Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
    }

    private func answerAndResume() {
        guard !resolvedAnswer.isEmpty else { return }
        workspace.answerAgentQuestion(for: task, content: resolvedAnswer)
    }

    private func abort() {
        guard let loop = task.agentRunLoops.last else { return }
        workspace.abortAgentLoop(for: task, loop: loop)
    }
}

private struct AgentAnswerQueueView: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @EnvironmentObject private var surfaceCoordinator: WorkspaceSurfaceCoordinator

    var tasks: [ForgeTask]
    @State private var answers: [ForgeTask.ID: String] = [:]
    @State private var ownWordsTaskIDs = Set<ForgeTask.ID>()
    @State private var submittedTaskIDs = Set<ForgeTask.ID>()

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                Text("⏸ \(tasks.count) TASK\(tasks.count == 1 ? "" : "S") WAITING ON \(remainingCount) ANSWER\(remainingCount == 1 ? "" : "S")")
                    .font(ForgeDesign.mono(11, weight: .heavy))
                    .tracking(0.5)
                Text("answer each decision without reopening every task")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.ink.opacity(0.65))
                Spacer()
                Text("↹ tab between questions · each resumes on its own")
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(ForgeDesign.ink.opacity(0.65))
                Button("CLOSE") {
                    surfaceCoordinator.dismiss()
                }
                .font(ForgeDesign.mono(9, weight: .bold))
                .buttonStyle(.plain)
                .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 24)
            .frame(height: 44)
            .background(ForgeDesign.warning)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(tasks) { task in
                        answerRow(task)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
            }

            HStack(spacing: 14) {
                Button(submitLabel, action: submitAnswers)
                    .buttonStyle(ForgePrimaryButtonStyle(foreground: ForgeDesign.accent))
                    .disabled(answeredCount == 0)
                Text(submitStatus)
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
                Spacer()
                Text("unanswered tasks stay paused — nothing is guessed")
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
            }
            .padding(.horizontal, 24)
            .frame(height: 66)
            .background(Color.white)
            .overlay(alignment: .top) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }
        }
        .background(ForgeDesign.paper)
    }

    private func answerRow(_ task: ForgeTask) -> some View {
        let step = task.agentRunSteps.last
        let answer = answers[task.id]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let isSubmitted = submittedTaskIDs.contains(task.id)

        return VStack(spacing: 0) {
            HStack(spacing: 10) {
                StatusPill(
                    label: isSubmitted ? "✓ RESUMING" : "⏸ NEEDS YOU",
                    color: isSubmitted ? ForgeDesign.accent : ForgeDesign.warning
                )
                Text("#\(task.id.prefix(6))")
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                Text(task.title)
                    .font(ForgeDesign.mono(11, weight: .bold))
                    .lineLimit(1)
                Text("· \(task.currentPhase.lowercased())")
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                Spacer()
                Text(stepProgress(task))
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(ForgeDesign.muted)
            }
            .padding(.horizontal, 16)
            .frame(height: 40)
            .background(isSubmitted ? Color(red: 247 / 255, green: 242 / 255, blue: 255 / 255) : Color.white)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(step?.summary ?? task.reviewSummary ?? "Forge needs an explicit decision before continuing.")
                        .font(.system(size: 14, weight: .bold))
                        .lineSpacing(3)
                    Text(step?.rationale ?? "The next action changes the reviewed approach, so the agent paused.")
                        .font(ForgeDesign.mono(10))
                        .foregroundStyle(ForgeDesign.muted)
                        .lineSpacing(3)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if ownWordsTaskIDs.contains(task.id) {
                    TextField("answer in your own words…", text: answerBinding(for: task.id))
                        .textFieldStyle(.plain)
                        .font(ForgeDesign.mono(10.5))
                        .padding(.horizontal, 12)
                        .frame(width: 330, height: 38)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                } else {
                    HStack(spacing: 8) {
                        queueChoiceButton(
                            "FOLLOW AGENT",
                            selected: answer.hasPrefix("Follow the inspected"),
                            disabled: isSubmitted
                        ) {
                            answers[task.id] = "Follow the inspected repository evidence: \(step?.rationale ?? "continue with the narrow reviewed approach")"
                        }
                        queueChoiceButton(
                            "REVISE",
                            selected: answer.hasPrefix("Keep this task paused"),
                            disabled: isSubmitted
                        ) {
                            answers[task.id] = "Keep this task paused and produce a revised approach with narrower risk before continuing."
                        }
                        Button("✎ OWN WORDS") {
                            answers[task.id] = ""
                            ownWordsTaskIDs.insert(task.id)
                        }
                        .font(ForgeDesign.mono(9.5, weight: .semibold))
                        .padding(.horizontal, 11)
                        .frame(height: 36)
                        .background(Color.clear)
                        .overlay(Rectangle().stroke(ForgeDesign.divider, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])))
                        .buttonStyle(.plain)
                        .disabled(isSubmitted)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private func queueChoiceButton(_ title: String, selected: Bool, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(ForgeDesign.mono(10, weight: .bold))
                .padding(.horizontal, 13)
                .frame(height: 36)
                .foregroundStyle(selected ? ForgeDesign.accent : ForgeDesign.ink)
                .background(selected ? ForgeDesign.ink : Color.white)
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                .forgeShadow(selected ? ForgeDesign.ink : .clear, x: 3, y: 3)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private func answerBinding(for taskID: ForgeTask.ID) -> Binding<String> {
        Binding(
            get: { answers[taskID] ?? "" },
            set: { answers[taskID] = $0 }
        )
    }

    private var answeredTasks: [ForgeTask] {
        tasks.filter {
            !(answers[$0.id]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) &&
                !submittedTaskIDs.contains($0.id)
        }
    }
    private var answeredCount: Int { answeredTasks.count }
    private var remainingCount: Int { max(tasks.count - submittedTaskIDs.count, 0) }
    private var submitLabel: String {
        submittedTaskIDs.isEmpty ? "▸ SUBMIT \(answeredCount) ANSWER\(answeredCount == 1 ? "" : "S")" : "✓ SUBMITTED"
    }
    private var submitStatus: String {
        if !submittedTaskIDs.isEmpty { return "\(submittedTaskIDs.count) task\(submittedTaskIDs.count == 1 ? "" : "s") resuming independently" }
        if answeredCount == tasks.count { return "all answered · ready to resume" }
        return "\(answeredCount) of \(tasks.count) answered"
    }

    private func stepProgress(_ task: ForgeTask) -> String {
        guard let loop = task.agentRunLoops.last else { return task.currentPhase.lowercased() }
        return "step \(max(loop.stepsRun, 1))/\(loop.maxSteps)"
    }

    private func submitAnswers() {
        let ready = answeredTasks
        guard !ready.isEmpty else { return }
        for task in ready {
            guard let answer = answers[task.id]?.trimmingCharacters(in: .whitespacesAndNewlines), !answer.isEmpty else { continue }
            submittedTaskIDs.insert(task.id)
            workspace.answerAgentQuestion(for: task, content: answer)
        }
    }
}

private struct AgentQuestionChoice: View {
    var title: String
    var detail: String
    var badge: String?
    var selected: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 10) {
                    Rectangle()
                        .fill(selected ? ForgeDesign.accent : Color.white)
                        .frame(width: 15, height: 15)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    Text(title)
                        .font(ForgeDesign.mono(12.5, weight: .heavy))
                    if let badge {
                        Text(badge)
                            .font(ForgeDesign.mono(8.5, weight: .bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.white)
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    }
                }
                Text(detail)
                    .font(ForgeDesign.mono(10.5))
                    .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                    .lineSpacing(4)
                    .padding(.leading, 25)
                    .lineLimit(3)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Color(red: 247 / 255, green: 242 / 255, blue: 255 / 255) : Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            .forgeShadow(selected ? ForgeDesign.ink : .clear, x: 4, y: 4)
        }
        .buttonStyle(.plain)
    }
}

private struct NeedsDecisionState: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                StatusPill(label: "⏸ WAITING FOR YOU", color: ForgeDesign.warning)
                Text(task.title)
                    .font(.system(size: 16, weight: .heavy))
                    .tracking(-0.3)
                    .lineLimit(1)
                Spacer()
                Text("paused at \(stepProgress) · \(pausedElapsed) elapsed")
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(ForgeDesign.muted)
            }
            .padding(.horizontal, 28)
            .frame(height: 62)
            .background(Color.white)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            VStack(alignment: .leading, spacing: 0) {
                Text("? FORGE NEEDS A DECISION")
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                    .padding(.horizontal, 20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(height: 42)
                    .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                    }

                VStack(alignment: .leading, spacing: 16) {
                    Text(question)
                        .font(.system(size: 14.5))
                        .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                        .lineSpacing(5)

                    HStack(alignment: .top, spacing: 14) {
                        DecisionOption(
                            title: "A · FOLLOW RECOMMENDATION",
                            detail: recommendation,
                            note: "recommended · based on inspected context"
                        ) {
                            draft = "Follow Forge's recommendation: \(recommendation)"
                        }
                        DecisionOption(
                            title: "B · KEEP CURRENT APPROACH",
                            detail: alternative,
                            note: "safer · request another reviewed step"
                        ) {
                            draft = "Keep the current approach and propose a safer reviewed alternative."
                        }
                    }

                    HStack(spacing: 0) {
                        TextField("or type your own instruction…", text: $draft)
                            .textFieldStyle(.plain)
                            .font(.system(size: 12))
                            .padding(.horizontal, 14)
                            .frame(height: 44)
                            .background(Color.white)
                        Button("SEND", action: send)
                            .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                            .foregroundStyle(ForgeDesign.accent)
                            .frame(width: 76, height: 44)
                            .background(ForgeDesign.ink)
                            .buttonStyle(.plain)
                            .disabled(trimmedDraft.isEmpty || workspace.isSendingTaskMessage(taskID: task.id))
                    }
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 18)
            }
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            .forgeShadow(ForgeDesign.ink, x: 5, y: 5)
            .padding(.horizontal, 28)
            .padding(.top, 26)

            Text("▸ blocked \(blockedDuration) · the agent never guesses on architecture — it asks")
                .font(.custom("JetBrains Mono", fixedSize: 10))
                .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 28)
                .padding(.top, 16)
            Spacer()
        }
        .background(ForgeDesign.paper)
    }

    private var latestStep: AgentRunStep? { task.agentRunSteps.last }

    private var pausedElapsed: String {
        Self.minutesLabel(from: task.createdAt, to: nil)
    }

    private var blockedDuration: String {
        Self.minutesLabel(from: latestStep?.createdAt ?? task.updatedAt, to: nil)
    }

    static func minutesLabel(from startISO: String, to endISO: String?) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let start = parser.date(from: startISO) else { return "<1m" }
        let end = endISO.flatMap { parser.date(from: $0) } ?? Date()
        let minutes = max(Int(end.timeIntervalSince(start) / 60), 0)
        switch minutes {
        case ..<1: return "<1m"
        case ..<90: return "\(minutes)m"
        default: return "\(minutes / 60)h \(minutes % 60)m"
        }
    }
    private var question: String {
        latestStep?.summary ?? task.reviewSummary ?? "Forge reached a decision point and needs your instruction before continuing."
    }
    private var recommendation: String {
        latestStep?.rationale ?? "Continue only with the reviewed, repository-aligned approach."
    }
    private var alternative: String {
        task.reviewSummary ?? "Pause here and request a revised approach before any more work runs."
    }
    private var stepProgress: String {
        task.agentRunLoops.last.map { "step \($0.stepsRun) of \($0.maxSteps)" } ?? task.currentPhase.lowercased()
    }
    private var trimmedDraft: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func send() {
        guard !trimmedDraft.isEmpty else { return }
        let content = trimmedDraft
        draft = ""
        workspace.sendTaskMessage(for: task, content: content)
    }
}

private struct DecisionOption: View {
    var title: String
    var detail: String
    var note: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                Text(title)
                    .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                Text(detail)
                    .font(.system(size: 12.5))
                    .foregroundStyle(ForgeDesign.muted)
                    .lineSpacing(3)
                    .lineLimit(3)
                Text(note)
                    .font(.custom("JetBrains Mono", fixedSize: 9.5))
                    .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
            }
            .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
            .padding(.horizontal, 17)
            .padding(.vertical, 15)
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }
}

private struct TaskFailureState: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask
    @State private var selectedDirection = 0
    @State private var confirmDiscard = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                StatusPill(label: "✕ FAILED", color: ForgeDesign.danger, foreground: .white)
                Text(task.title)
                    .font(.system(size: 14, weight: .bold))
                    .lineLimit(1)
                Spacer()
                Text("\(failureAttempts.count) failed attempt(s) · \(task.currentPhase.lowercased())")
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(ForgeDesign.muted)
            }
            .padding(.horizontal, 24)
            .frame(height: 52)
            .background(Color(red: 253 / 255, green: 240 / 255, blue: 238 / 255))
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            HStack(spacing: 0) {
                VStack(spacing: 0) {
                    sectionHeader("WHAT HAPPENED")
                    ScrollView {
                        VStack(alignment: .leading, spacing: 13) {
                            ForEach(Array(failureAttempts.enumerated()), id: \.offset) { index, attempt in
                                HStack(alignment: .top, spacing: 11) {
                                    Text("\(index + 1)")
                                        .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                                        .foregroundStyle(index == failureAttempts.count - 1 ? Color.white : ForgeDesign.ink)
                                        .frame(width: 20, height: 20)
                                        .background(index == failureAttempts.count - 1 ? ForgeDesign.danger : Color.white)
                                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                                    Text(attempt)
                                        .font(.custom("JetBrains Mono", fixedSize: 11))
                                        .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                                        .lineSpacing(3)
                                }
                            }
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 170)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(ForgeDesign.divider).frame(height: 1.5)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("AI DIAGNOSIS")
                            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                            .foregroundStyle(ForgeDesign.accent)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(ForgeDesign.ink)
                        Text(diagnosis)
                            .font(.system(size: 13))
                            .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                            .lineSpacing(4)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(ForgeDesign.divider).frame(height: 1.5)
                    }

                    ScrollView {
                        Text(lastErrorOutput)
                            .font(.custom("JetBrains Mono", fixedSize: 11))
                            .foregroundStyle(Color(red: 255 / 255, green: 138 / 255, blue: 128 / 255))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 14)
                    }
                    .background(ForgeDesign.ink)
                }
                .frame(maxWidth: .infinity)
                .overlay(alignment: .trailing) {
                    Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
                }

                VStack(spacing: 0) {
                    sectionHeader("YOUR REPO IS \(repoIsClean ? "CLEAN" : "PRESERVED")")
                    VStack(alignment: .leading, spacing: 12) {
                        cleanupCheck(repoIsClean ? "working tree reports clean" : "current changes remain visible for review")
                        cleanupCheck("main is never mutated without the explicit git policy path")
                        cleanupCheck("reviewed proposal and rollback evidence remain persisted")
                        cleanupCheck("no hosted PR publication happens automatically")
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(ForgeDesign.divider).frame(height: 1.5)
                    }

                    VStack(alignment: .leading, spacing: 9) {
                        Text("PICK A DIRECTION, THEN RETRY")
                            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                            .tracking(1)
                            .foregroundStyle(ForgeDesign.muted)
                        failureDirection(index: 0, text: recommendedDirection)
                        failureDirection(index: 1, text: "keep the branch and request a revised plan")
                        failureDirection(index: 2, text: "stop here and roll back the applied proposal")
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)

                    Spacer(minLength: 8)

                    VStack(spacing: 8) {
                        Button("↻ GENERATE REVIEWED SELF-FIX") {
                            workspace.generateValidationRepairProposal(for: task)
                        }
                        .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.ink, foreground: ForgeDesign.accent))
                        .disabled(!canGenerateRepair)
                        .frame(maxWidth: .infinity)

                        HStack(spacing: 8) {
                            Button("KEEP BRANCH", action: keepBranch)
                                .buttonStyle(ForgeSecondaryButtonStyle())
                                .frame(maxWidth: .infinity)
                            Button("✕ DISCARD ALL") { confirmDiscard = true }
                                .buttonStyle(ForgeSecondaryButtonStyle())
                                .foregroundStyle(ForgeDesign.danger)
                                .frame(maxWidth: .infinity)
                                .disabled(!canDiscard)
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 16)
                }
                .frame(width: 450)
            }
        }
        .background(Color.white)
        .confirmationDialog("Discard the reviewed task changes?", isPresented: $confirmDiscard) {
            Button("Discard Task Changes", role: .destructive, action: discardChanges)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This only uses Forge's proposal rollback/reject boundary. It does not reset unrelated work or mutate main.")
        }
    }

    private var failureAttempts: [String] {
        let repairs = task.validationRepairBriefs.suffix(3).map { "\($0.summary) — \($0.likelyCause)" }
        if !repairs.isEmpty { return repairs }
        let failedCommands = task.taskCommandRuns.filter { $0.status == "Failed" }.suffix(3).map { "\($0.name) — \($0.outputSummary)" }
        if !failedCommands.isEmpty { return failedCommands }
        let failedValidations = task.validationRuns.filter { $0.status == "Failed" }.suffix(3).map(\.summary)
        return failedValidations.isEmpty ? [task.reviewSummary ?? "The task stopped at a guarded failure boundary."] : failedValidations
    }
    private var diagnosis: String {
        task.validationRepairBriefs.last?.likelyCause ?? task.reviewSummary ?? "Forge stopped safely and preserved the evidence for human review."
    }
    private var recommendedDirection: String {
        task.validationRepairBriefs.last?.recommendedActions.first ?? "generate one bounded, reviewed self-fix from the latest evidence"
    }
    private var lastErrorOutput: String {
        if let run = task.taskCommandRuns.last(where: { $0.status == "Failed" }) {
            let output = run.outputChunks.suffix(10).map(\.text).joined()
            return output.isEmpty ? "$ \(run.command)\n\(run.outputSummary)" : "$ \(run.command)\n\(output)"
        }
        if let run = task.validationRuns.last(where: { $0.status == "Failed" }) {
            return run.commands.map { "$ \($0.command)\n\($0.outputSummary)" }.joined(separator: "\n")
        }
        return task.reviewSummary ?? "Failure evidence is available in the audit log."
    }
    private var repoIsClean: Bool { workspace.gitStatus?.isDirty == false }
    private var canGenerateRepair: Bool {
        !task.validationRepairBriefs.isEmpty && !workspace.isGeneratingValidationRepairProposal(taskID: task.id)
    }
    private var canDiscard: Bool {
        task.editProposal?.status == "Applied" || task.editProposal?.status == "Proposed"
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
            .tracking(1)
            .foregroundStyle(ForgeDesign.muted)
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 36)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }
    }
    private func cleanupCheck(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("✓").foregroundStyle(ForgeDesign.success).fontWeight(.bold)
            Text(text)
        }
        .font(.custom("JetBrains Mono", fixedSize: 11))
    }
    private func failureDirection(index: Int, text: String) -> some View {
        Button { selectedDirection = index } label: {
            HStack(alignment: .top, spacing: 10) {
                Rectangle()
                    .fill(selectedDirection == index ? ForgeDesign.accent : Color.white)
                    .frame(width: 14, height: 14)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                Text(text)
                    .font(.custom("JetBrains Mono", fixedSize: 10.5))
                    .lineSpacing(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 9)
            .background(selectedDirection == index ? Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255) : Color.white)
            .overlay(Rectangle().stroke(selectedDirection == index ? ForgeDesign.ink : ForgeDesign.divider, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }
    private func keepBranch() {
        let branch = workspace.gitStatus?.branch ?? "local worktree"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(branch, forType: .string)
    }
    private func discardChanges() {
        guard let proposal = task.editProposal else { return }
        if proposal.status == "Applied" {
            workspace.rollbackEditProposal(for: task)
        } else if proposal.status == "Proposed" {
            workspace.rejectEditProposal(for: task)
        }
    }
}

private struct CrashRecoveryState: View {
    var tasks: [ForgeTask]
    var resumeAll: () -> Void
    var reviewFirst: () -> Void

    @AppStorage("forge.sendCrashReports") private var sendCrashReports = true

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 16) {
                    Text("↻")
                        .font(.custom("JetBrains Mono", fixedSize: 26).weight(.bold))
                        .frame(width: 56, height: 56)
                        .background(ForgeDesign.warning)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                        .forgeShadow(ForgeDesign.ink, x: 4, y: 4)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Forge quit unexpectedly. Your work didn't.")
                            .font(.system(size: 22, weight: .heavy))
                            .tracking(-0.5)
                        Text("the local runtime reconciled persisted checkpoints before reopening this window")
                            .font(.custom("JetBrains Mono", fixedSize: 10.5))
                            .foregroundStyle(ForgeDesign.muted)
                    }
                }

                VStack(spacing: 0) {
                    Text("RECOVERED FROM CHECKPOINTS")
                        .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                        .tracking(1)
                        .foregroundStyle(ForgeDesign.muted)
                        .padding(.horizontal, 16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(height: 38)
                        .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                        }
                    ForEach(tasks.prefix(5)) { task in
                        HStack(spacing: 12) {
                            Text("#\(task.id.prefix(6))")
                                .font(.custom("JetBrains Mono", fixedSize: 9))
                                .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                            Text(task.title)
                                .font(.system(size: 13, weight: .bold))
                                .lineLimit(1)
                            Spacer()
                            Text(task.currentPhase.lowercased())
                                .font(.custom("JetBrains Mono", fixedSize: 9.5))
                                .foregroundStyle(ForgeDesign.muted)
                                .lineLimit(1)
                            Text(task.currentPhase.localizedCaseInsensitiveContains("required") ? "⚠ REVIEW" : "✓ FULL")
                                .font(.custom("JetBrains Mono", fixedSize: 8.5).weight(.bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(task.currentPhase.localizedCaseInsensitiveContains("required") ? ForgeDesign.warning : ForgeDesign.accent)
                                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                        }
                        .padding(.horizontal, 16)
                        .frame(height: 48)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(ForgeDesign.divider).frame(height: 1.5)
                        }
                    }
                }
                .background(Color.white)
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

                Text("⚠ REVIEW = automatic recovery stopped without overwriting unverified content — no file was left half-written and branches remain intact")
                    .font(.custom("JetBrains Mono", fixedSize: 10.5))
                    .foregroundStyle(Color(red: 201 / 255, green: 201 / 255, blue: 196 / 255))
                    .lineSpacing(3)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(ForgeDesign.ink)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

                HStack(spacing: 12) {
                    Button("▸ RESUME ALL", action: resumeAll)
                        .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.ink, foreground: ForgeDesign.accent))
                    Button("REVIEW FIRST", action: reviewFirst)
                        .buttonStyle(ForgeSecondaryButtonStyle())
                    Spacer()
                    Button {
                        sendCrashReports.toggle()
                    } label: {
                        HStack(spacing: 8) {
                            Rectangle()
                                .fill(sendCrashReports ? ForgeDesign.accent : Color.white)
                                .frame(width: 13, height: 13)
                                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                            Text("send crash report")
                                .font(.custom("JetBrains Mono", fixedSize: 10))
                                .foregroundStyle(ForgeDesign.muted)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: 620)
            Spacer(minLength: 24)
        }
        .padding(.horizontal, 24)
        .background(ForgeDesign.paper)
    }
}

private struct MergeConflictState: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    let snapshot: GitConflictSnapshot

    @State private var selectedPath: String?
    @State private var draft = ""
    @State private var editingDraft = false
    @State private var pendingStrategy: String?

    private var selectedFile: GitConflictFile? {
        let path = selectedPath ?? snapshot.files.first?.path
        return snapshot.files.first { $0.path == path }
    }

    var body: some View {
        VStack(spacing: 0) {
            conflictHeader

            HStack(spacing: 0) {
                conflictSidebar
                    .frame(width: 250)

                Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)

                if let selectedFile {
                    conflictDetail(selectedFile)
                } else {
                    ContentUnavailableView("No unresolved conflicts", systemImage: "checkmark.circle")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }

            conflictFooter
        }
        .background(ForgeDesign.paper)
        .onAppear(perform: synchronizeSelection)
        .onChange(of: selectedPath) { _, _ in loadWorkingDraft() }
        .onChange(of: snapshot.files.map(\.path)) { _, _ in synchronizeSelection() }
        .confirmationDialog(
            resolutionConfirmationTitle,
            isPresented: Binding(
                get: { pendingStrategy != nil },
                set: { if !$0 { pendingStrategy = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let pendingStrategy, let selectedFile {
                Button("Resolve and Stage \(selectedFile.path)") {
                    let content = pendingStrategy == "Manual" ? draft : nil
                    workspace.resolveGitConflict(file: selectedFile, strategy: pendingStrategy, content: content)
                    self.pendingStrategy = nil
                }
                Button("Cancel", role: .cancel) { self.pendingStrategy = nil }
            }
        } message: {
            Text("This writes the selected resolution and stages only this file. Forge will not continue or abort the \(snapshot.operation.lowercased()).")
        }
    }

    private var conflictHeader: some View {
        HStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(ForgeDesign.warning)

            VStack(alignment: .leading, spacing: 4) {
                Text("\(snapshot.files.count) CONFLICT\(snapshot.files.count == 1 ? "" : "S")")
                    .font(ForgeDesign.mono(17, weight: .black))
                Text("\(snapshot.operation.uppercased()) IN PROGRESS · \(snapshot.branch?.uppercased() ?? "DETACHED HEAD")")
                    .font(ForgeDesign.mono(10, weight: .bold))
                    .foregroundStyle(ForgeDesign.muted)
            }

            Spacer()

            Button {
                workspace.refreshGitConflicts()
            } label: {
                Label("REFRESH", systemImage: "arrow.clockwise")
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
        }
        .padding(.horizontal, 22)
        .frame(height: 74)
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private var conflictSidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("CONFLICTED FILES")
                .font(ForgeDesign.mono(10, weight: .black))
                .tracking(0.8)
                .padding(.horizontal, 16)
                .frame(height: 42)

            Rectangle().fill(ForgeDesign.divider).frame(height: 1)

            List(selection: $selectedPath) {
                ForEach(snapshot.files) { file in
                    HStack(spacing: 9) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(ForgeDesign.warning)
                            .frame(width: 15)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(URL(fileURLWithPath: file.path).lastPathComponent)
                                .font(ForgeDesign.mono(11, weight: .bold))
                                .lineLimit(1)
                            Text(file.path)
                                .font(ForgeDesign.mono(9))
                                .foregroundStyle(ForgeDesign.muted)
                                .lineLimit(1)
                        }
                    }
                    .padding(.vertical, 5)
                    .tag(file.path)
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
        .background(Color(nsColor: .controlBackgroundColor))
    }

    private func conflictDetail(_ file: GitConflictFile) -> some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(file.path)
                        .font(ForgeDesign.mono(13, weight: .black))
                    Text("INDEX \(file.indexStatus)\(file.worktreeStatus) · REVIEW ALL VERSIONS BEFORE RESOLVING")
                        .font(ForgeDesign.mono(9, weight: .bold))
                        .foregroundStyle(ForgeDesign.muted)
                }
                Spacer()
                if workspace.isResolvingGitConflict(path: file.path) {
                    ProgressView().controlSize(.small)
                    Text("RESOLVING…").font(ForgeDesign.mono(9, weight: .bold))
                }
            }
            .padding(.horizontal, 18)
            .frame(height: 58)
            .background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1) }

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: 12) {
                        ConflictSourcePane(title: snapshot.oursLabel, stage: file.ours, tint: ForgeDesign.accent)
                        ConflictSourcePane(title: snapshot.theirsLabel, stage: file.theirs, tint: ForgeDesign.warning)
                    }

                    resolutionDraft(file)

                    if let error = workspace.gitConflictLastError {
                        Label(error, systemImage: "xmark.octagon.fill")
                            .font(ForgeDesign.mono(10, weight: .bold))
                            .foregroundStyle(ForgeDesign.danger)
                            .textSelection(.enabled)
                    } else if let result = workspace.gitConflictLastResult {
                        Label(result.summary, systemImage: "checkmark.circle.fill")
                            .font(ForgeDesign.mono(10, weight: .bold))
                            .foregroundStyle(ForgeDesign.success)
                    }
                }
                .padding(18)
            }

            actionBar(file)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func resolutionDraft(_ file: GitConflictFile) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("RESOLUTION DRAFT", systemImage: "wand.and.stars")
                    .font(ForgeDesign.mono(10, weight: .black))
                Spacer()
                Text(editingDraft ? "EDITING" : "WORKING FILE")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .foregroundStyle(ForgeDesign.muted)
            }

            Text("Forge starts from the current working conflict file. Remove every conflict marker and review the complete result before accepting it.")
                .font(ForgeDesign.mono(10))
                .foregroundStyle(ForgeDesign.muted)

            if editingDraft {
                TextEditor(text: $draft)
                    .font(ForgeDesign.mono(10))
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: 150)
                    .background(Color.white)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            } else {
                ScrollView([.horizontal, .vertical]) {
                    Text(file.working.content ?? file.working.summary)
                        .font(ForgeDesign.mono(10))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 100, maxHeight: 170)
                .padding(10)
                .background(Color.white)
                .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1))
            }
        }
        .padding(14)
        .background(ForgeDesign.accent.opacity(0.10))
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private func actionBar(_ file: GitConflictFile) -> some View {
        HStack(spacing: 10) {
            Button("✓ ACCEPT DRAFT") { pendingStrategy = "Manual" }
                .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.success, foreground: ForgeDesign.ink))
                .disabled(!draftIsResolvable || workspace.isResolvingGitConflict(path: file.path))

            Button("TAKE \(snapshot.oursLabel)") { pendingStrategy = "Ours" }
                .buttonStyle(ForgeSecondaryButtonStyle())
                .disabled(!stageCanBeSelected(file.ours) || workspace.isResolvingGitConflict(path: file.path))

            Button("TAKE \(snapshot.theirsLabel)") { pendingStrategy = "Theirs" }
                .buttonStyle(ForgeSecondaryButtonStyle())
                .disabled(!stageCanBeSelected(file.theirs) || workspace.isResolvingGitConflict(path: file.path))

            Spacer()

            Button(editingDraft ? "CANCEL EDIT" : "EDIT MANUALLY") {
                editingDraft.toggle()
                if !editingDraft { loadWorkingDraft() }
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
        }
        .padding(.horizontal, 18)
        .frame(height: 62)
        .background(Color.white)
        .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private var conflictFooter: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.shield.fill")
                .foregroundStyle(ForgeDesign.accent)
            Text(snapshot.operationBoundary)
                .font(ForgeDesign.mono(9, weight: .bold))
                .foregroundStyle(ForgeDesign.muted)
                .lineLimit(2)
            Spacer()
            Text("NEXT: REVIEW · CONTINUE IN GIT · TEST · PR")
                .font(ForgeDesign.mono(9, weight: .black))
        }
        .padding(.horizontal, 16)
        .frame(height: 46)
        .background(ForgeDesign.paper)
        .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private var resolutionConfirmationTitle: String {
        guard let pendingStrategy else { return "Resolve conflict?" }
        return pendingStrategy == "Manual" ? "Accept the edited resolution?" : "Take the \(pendingStrategy.lowercased()) version?"
    }

    private var draftIsResolvable: Bool {
        !draft.contains("<<<<<<<") && !draft.contains("=======") && !draft.contains(">>>>>>>")
    }

    private func stageCanBeSelected(_ stage: GitConflictStage) -> Bool {
        stage.available || stage.unavailableReason == "Missing"
    }

    private func synchronizeSelection() {
        if let selectedPath, snapshot.files.contains(where: { $0.path == selectedPath }) {
            loadWorkingDraft()
            return
        }
        selectedPath = snapshot.files.first?.path
        loadWorkingDraft()
    }

    private func loadWorkingDraft() {
        guard let selectedFile else {
            draft = ""
            editingDraft = false
            return
        }
        draft = selectedFile.working.content ?? selectedFile.ours.content ?? selectedFile.theirs.content ?? ""
        editingDraft = false
    }
}

private struct ConflictSourcePane: View {
    let title: String
    let stage: GitConflictStage
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Circle().fill(tint).frame(width: 8, height: 8)
                Text(title)
                    .font(ForgeDesign.mono(10, weight: .black))
                    .lineLimit(1)
                Spacer()
                Text(stage.available ? "\(stage.lineCount) LINES" : (stage.unavailableReason ?? "UNAVAILABLE").uppercased())
                    .font(ForgeDesign.mono(8, weight: .bold))
                    .foregroundStyle(ForgeDesign.muted)
            }
            .padding(.horizontal, 10)
            .frame(height: 36)
            .background(tint.opacity(0.14))

            Rectangle().fill(ForgeDesign.divider).frame(height: 1)

            ScrollView([.horizontal, .vertical]) {
                Text(stage.content ?? stage.summary)
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(stage.available ? ForgeDesign.ink : ForgeDesign.muted)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
            }
            .frame(minHeight: 170, maxHeight: 220)
        }
        .frame(maxWidth: .infinity)
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }
}

private struct NoRepositoryState: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var body: some View {
        ZStack {
            NoRepositoryPattern()
                .opacity(0.55)

            VStack(spacing: 0) {
                Text("⌥")
                    .font(ForgeDesign.mono(34))
                    .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                    .frame(width: 88, height: 88)
                    .background(Color.white)
                    .overlay(
                        Rectangle().stroke(
                            Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255),
                            style: StrokeStyle(lineWidth: 1.5, dash: [6, 5])
                        )
                    )
                    .padding(.bottom, 22)

                Text("No repos yet. The agent is bored.")
                    .font(.system(size: 24, weight: .heavy))
                    .tracking(-0.5)
                    .padding(.bottom, 10)

                Text("Connect a repository and drop your first task — Forge plans before it touches anything, so nothing happens without your OK.")
                    .font(.system(size: 14))
                    .foregroundStyle(ForgeDesign.muted)
                    .multilineTextAlignment(.center)
                    .lineSpacing(5)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 430)
                    .padding(.bottom, 28)

                HStack(spacing: 12) {
                    Button("⌥ CONNECT A REPO", action: workspace.connectRepository)
                        .buttonStyle(ForgePrimaryButtonStyle(foreground: ForgeDesign.accent))
                    Button("TRY THE DEMO REPO", action: workspace.useDemoRepository)
                        .buttonStyle(ForgeSecondaryButtonStyle())
                }
                .padding(.bottom, 32)

                HStack(spacing: 10) {
                    noRepoStep("01", "CONNECT\nLOCAL REPO")
                    Text("→").foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                    noRepoStep("02", "DESCRIBE\nA TASK")
                    Text("→").foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                    noRepoStep("03", "REVIEW\nTHE PR", accent: true)
                }
                .padding(.horizontal, 18)
                .frame(width: 560, height: 82)
                .background(Color.white)
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

                Text(workspace.repositorySelectionMessage ?? "demo repo = a sandboxed todo app · nothing leaves your machine")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                    .multilineTextAlignment(.center)
                    .padding(.top, 16)
                    .lineLimit(2)
            }
            .frame(maxWidth: 620)
            .padding(.horizontal, 24)
            .padding(.vertical, 30)
        }
        .background(ForgeDesign.paper)
    }

    private func noRepoStep(_ number: String, _ label: String, accent: Bool = false) -> some View {
        VStack(spacing: 4) {
            Text(number)
                .font(ForgeDesign.mono(16, weight: .heavy))
                .foregroundStyle(accent ? ForgeDesign.accent : ForgeDesign.ink)
            Text(label)
                .font(ForgeDesign.mono(9.5, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(ForgeDesign.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct NoRepositoryPattern: View {
    var body: some View {
        GeometryReader { proxy in
            Path { path in
                let span = proxy.size.width + proxy.size.height
                var offset: CGFloat = -proxy.size.height
                while offset < span {
                    path.move(to: CGPoint(x: offset, y: 0))
                    path.addLine(to: CGPoint(x: offset - proxy.size.height, y: proxy.size.height))
                    offset += 24
                }
            }
            .stroke(ForgeDesign.ink.opacity(0.035), lineWidth: 1)
        }
    }
}

private struct OfflineWorkspaceState: View {
    var tasks: [ForgeTask]
    var retry: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                HStack(spacing: 8) {
                    Circle().fill(ForgeDesign.warning).frame(width: 7, height: 7)
                    Text("OFFLINE")
                        .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                        .tracking(0.5)
                        .foregroundStyle(ForgeDesign.warning)
                }
                Text("no runtime connection — local state is preserved · nothing was lost")
                    .font(.custom("JetBrains Mono", fixedSize: 11))
                    .foregroundStyle(Color(red: 201 / 255, green: 201 / 255, blue: 196 / 255))
                Spacer()
                Button("RETRY NOW", action: retry)
                    .font(.custom("JetBrains Mono", fixedSize: 9.5).weight(.bold))
                    .foregroundStyle(ForgeDesign.paper)
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .overlay(Rectangle().stroke(ForgeDesign.paper, lineWidth: 1.5))
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 24)
            .frame(height: 46)
            .background(ForgeDesign.ink)

            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("TASKS — \(tasks.count)")
                        .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                        .tracking(1.5)
                        .foregroundStyle(ForgeDesign.muted)
                        .padding(.horizontal, 16)
                        .frame(height: 38)
                    ForEach(tasks.prefix(5)) { task in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                StatusPill(label: offlineStatus(task), color: offlineColor(task))
                                Spacer()
                                Text("#\(task.id.prefix(6))")
                                    .font(.custom("JetBrains Mono", fixedSize: 9))
                                    .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                            }
                            Text(task.title)
                                .font(.system(size: 12.5, weight: .bold))
                                .lineLimit(2)
                            Text(task.status == "Completed" ? "diff cached — readable offline" : "checkpoint persisted · resumes after reconnect")
                                .font(.custom("JetBrains Mono", fixedSize: 9.5))
                                .foregroundStyle(ForgeDesign.muted)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .background(task.id == activeTask?.id ? Color.white : Color.clear)
                        .overlay(alignment: .leading) {
                            if task.id == activeTask?.id { Rectangle().fill(ForgeDesign.warning).frame(width: 3) }
                        }
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(ForgeDesign.divider).frame(height: 1.5)
                        }
                    }
                    Spacer()
                    Text("agent state checkpointed\nevery step — safe to lose power too")
                        .font(.custom("JetBrains Mono", fixedSize: 9.5))
                        .foregroundStyle(ForgeDesign.muted)
                        .lineSpacing(3)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(alignment: .top) {
                            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                        }
                }
                .frame(width: 300)
                .background(ForgeDesign.paper)
                .overlay(alignment: .trailing) {
                    Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
                }

                VStack(spacing: 0) {
                    HStack(spacing: 12) {
                        StatusPill(label: "⏸ WAITING FOR NETWORK", color: ForgeDesign.warning)
                        Text(activeTask?.title ?? "Local workspace")
                            .font(.system(size: 15, weight: .heavy))
                            .lineLimit(1)
                        Spacer()
                        Text("checkpoint saved locally")
                            .font(.custom("JetBrains Mono", fixedSize: 10))
                            .foregroundStyle(ForgeDesign.muted)
                    }
                    .padding(.horizontal, 22)
                    .frame(height: 54)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                    }

                    HStack(spacing: 0) {
                        offlineCapability(
                            title: "STILL WORKS OFFLINE",
                            marker: "✓",
                            color: ForgeDesign.success,
                            values: ["read cached diffs & task history", "draft new tasks locally", "browse audit logs"]
                        )
                        offlineCapability(
                            title: "WAITING ON RECONNECT",
                            marker: "⏸",
                            color: ForgeDesign.warning,
                            values: ["remote model calls", "GitHub push / PR sync", "hosted notifications"]
                        )
                    }
                    .frame(height: 146)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                    }

                    ScrollView {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("— thinking stream · frozen at checkpoint —")
                                .foregroundStyle(Color(red: 85 / 255, green: 85 / 255, blue: 79 / 255))
                            ForEach(activeTask?.events.suffix(8) ?? []) { event in
                                Text("\(Self.clockTime(event.createdAt))  \(event.message)")
                            }
                            Text("⏸ runtime unavailable — retry only on explicit refresh")
                                .foregroundStyle(ForgeDesign.warning)
                        }
                        .font(.custom("JetBrains Mono", fixedSize: 11.5))
                        .foregroundStyle(Color(red: 232 / 255, green: 232 / 255, blue: 228 / 255))
                        .padding(.horizontal, 22)
                        .padding(.vertical, 16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .background(ForgeDesign.ink)
                }
                .background(Color.white)
            }
        }
    }

    private var activeTask: ForgeTask? {
        tasks.first(where: { ["Running", "Testing", "Human Review"].contains($0.status) }) ?? tasks.first
    }

    static func clockTime(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: iso) else { return String(iso.prefix(19)) }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }

    private func offlineStatus(_ task: ForgeTask) -> String {
        if task.status == "Completed" { return "✓ CACHED" }
        if task.status == "Running" || task.status == "Testing" { return "⏸ WAITING NET" }
        return "◌ LOCAL"
    }
    private func offlineColor(_ task: ForgeTask) -> Color {
        task.status == "Completed" ? ForgeDesign.success : task.status == "Running" || task.status == "Testing" ? ForgeDesign.warning : Color.white
    }
    private func offlineCapability(title: String, marker: String, color: Color, values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                .tracking(1)
                .foregroundStyle(ForgeDesign.muted)
            ForEach(values, id: \.self) { value in
                HStack(spacing: 8) {
                    Text(marker).foregroundStyle(color).fontWeight(.bold)
                    Text(value)
                }
                .font(.custom("JetBrains Mono", fixedSize: 11))
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .overlay(alignment: .trailing) {
            Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
        }
    }
}

private struct RunningTaskHeader: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @EnvironmentObject private var surfaceCoordinator: WorkspaceSurfaceCoordinator

    var task: ForgeTask
    var openDiffReview: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            StatusPill(label: statusLabel, color: statusColor)
            Text(task.title)
                .font(.system(size: 15, weight: .heavy))
                .lineLimit(1)
            Spacer()

            if diffCount > 0 {
                Button("FULL DIFF", action: openDiffReview)
                    .buttonStyle(ForgeSecondaryButtonStyle())
            }

            Button("AUDIT") { surfaceCoordinator.present(.audit(taskID: task.id)) }
                .buttonStyle(ForgeSecondaryButtonStyle())

            if canStartLoop {
                Button("RUN") { workspace.runAgentLoop(for: task, maxSteps: 6) }
                    .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
            }
            if canResumeLoop, let loop = latestLoop {
                Button("RESUME") { workspace.resumeAgentLoop(for: task, loop: loop) }
                    .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
            }
            if canPauseLoop, let loop = latestLoop {
                Button("⏸ PAUSE") { workspace.pauseAgentLoop(for: task, loop: loop) }
                    .buttonStyle(ForgeSecondaryButtonStyle())
            }
            if canAbortLoop, let loop = latestLoop {
                Button("✕ ABORT") { workspace.abortAgentLoop(for: task, loop: loop) }
                    .buttonStyle(ForgeSecondaryButtonStyle())
                    .foregroundStyle(ForgeDesign.danger)
            }
        }
        .padding(.horizontal, 22)
        .frame(height: 58)
        .background(Color.white)
        .overlay(alignment: .bottom) {
            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
        }
    }

    private var latestLoop: AgentRunLoop? { task.agentRunLoops.last }
    private var diffCount: Int { max(task.changedFiles.count, task.editProposal?.fileChanges.count ?? 0) }
    private var canStartLoop: Bool {
        task.executionProposal != nil && task.editProposal?.status != "Proposed" && latestLoop?.status != "Running" && !workspace.isRunningAgentLoop(taskID: task.id)
    }
    private var canPauseLoop: Bool { latestLoop?.status == "Running" && latestLoop?.controlState == nil }
    private var canAbortLoop: Bool { latestLoop?.status == "Running" && latestLoop?.controlState != "AbortRequested" }
    private var canResumeLoop: Bool {
        guard let status = latestLoop?.status else { return false }
        return ["Paused", "Aborted", "Failed"].contains(status) && !workspace.isRunningAgentLoop(taskID: task.id)
    }
    private var statusLabel: String { task.status == "Running" ? "▸ RUNNING" : task.status }
    private var statusColor: Color {
        switch task.status {
        case "Completed": return ForgeDesign.success
        case "Failed": return ForgeDesign.danger
        case "Human Review": return ForgeDesign.warning
        case "Running", "Testing": return ForgeDesign.accent
        default: return Color.white
        }
    }
}

private struct RunningSessionFooter: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    @Binding var selectedTab: SessionTab
    var task: ForgeTask

    var body: some View {
        HStack(spacing: 0) {
            SessionTabs(selectedTab: $selectedTab, task: task)
                .frame(width: 330)
            Spacer()
            Text("\(workspace.gitStatus?.branch ?? "LOCAL WORKTREE") · GUARDRAILS ON")
                .font(.custom("JetBrains Mono", fixedSize: 9))
                .foregroundStyle(ForgeDesign.muted)
                .padding(.trailing, 20)
        }
        .frame(height: 38)
        .background(Color.white)
        .overlay(alignment: .top) {
            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
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
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
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
        VStack(spacing: 0) {
            Spacer()

            ForgeLogo(size: 56)
                .forgeShadow(ForgeDesign.ink, x: 4, y: 4)
                .padding(.bottom, 22)
            Text("What should Forge build?")
                .font(.system(size: 28, weight: .heavy))
                .tracking(-0.8)

            Text("one outcome per task · something your tests can verify")
                .font(.custom("JetBrains Mono", fixedSize: 12))
                .foregroundStyle(ForgeDesign.muted)
                .padding(.top, 10)
                .padding(.bottom, 26)

            HStack(spacing: 0) {
                TextField("e.g. \"add rate limiting to the public API\"", text: $prompt)
                    .font(.system(size: 13))
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 18)
                    .frame(height: 50)
                    .background(Color.white)
                    .onSubmit(createTask)

                Button(action: createTask) {
                    Text("PLAN IT →")
                        .font(.custom("JetBrains Mono", fixedSize: 12.5).weight(.bold))
                        .tracking(0.5)
                        .foregroundStyle(ForgeDesign.accent)
                        .padding(.horizontal, 22)
                        .frame(height: 50)
                        .background(ForgeDesign.ink)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: 640)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))

            HStack(spacing: 8) {
                ExampleTaskButton(title: "fix flaky test in auth.spec.ts") {
                    prompt = "Fix the flaky test in auth.spec.ts"
                }
                ExampleTaskButton(title: "add input validation to signup") {
                    prompt = "Add input validation to signup"
                }
                ExampleTaskButton(title: "upgrade eslint + fix warnings") {
                    prompt = "Upgrade eslint and fix the resulting warnings"
                }
            }
            .padding(.top, 18)

            Spacer()

            HStack {
                Text("⌘N new task · ⌘K switch repo")
                Spacer()
                Text("indexed ")
                    + Text("1,204").fontWeight(.bold).foregroundStyle(ForgeDesign.ink)
                    + Text(" files · in sync")
            }
            .font(.custom("JetBrains Mono", fixedSize: 10))
            .foregroundStyle(ForgeDesign.muted)
            .padding(.horizontal, 20)
            .padding(.vertical, 11)
            .overlay(alignment: .top) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var objective: String {
        prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var title: String {
        String(objective.prefix(60))
    }

    private func createTask() {
        guard !objective.isEmpty else { return }
        workspace.createTask(title: title, objective: objective)
        prompt = ""
    }
}

private struct CompactPlanApprovalState: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @EnvironmentObject private var surfaceCoordinator: WorkspaceSurfaceCoordinator

    var task: ForgeTask
    var revision: PlanRevision

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 10) {
                    Text("PLAN PROPOSED")
                        .font(ForgeDesign.mono(9, weight: .bold))
                        .tracking(0.5)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Color.white)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    Text("#\(taskNumber) · nothing has run yet")
                        .font(ForgeDesign.mono(10.5))
                        .foregroundStyle(ForgeDesign.muted)
                }
                Text(task.title)
                    .font(.system(size: 17, weight: .heavy))
                    .tracking(-0.3)
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 22)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            ScrollView {
                VStack(spacing: 0) {
                    ForEach(Array(revision.steps.enumerated()), id: \.element.id) { index, step in
                        HStack(alignment: .center, spacing: 14) {
                            Text("\(index + 1)")
                                .font(ForgeDesign.mono(10, weight: .heavy))
                                .frame(width: 20, height: 20)
                                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(step.title)
                                    .font(ForgeDesign.mono(12, weight: .bold))
                                Text(step.summary)
                                    .font(ForgeDesign.mono(10))
                                    .foregroundStyle(ForgeDesign.dashedBorder)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            Button("✎ EDIT") {
                                surfaceCoordinator.present(.fullPlan(taskID: task.id, revisionID: revision.id))
                            }
                            .font(ForgeDesign.mono(10, weight: .bold))
                            .tracking(0.5)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.white)
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, 28)
                        .padding(.vertical, 14)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(ForgeDesign.divider).frame(height: 1.5)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .background(Color.white)

            HStack(spacing: 14) {
                (Text("est. ")
                    + Text(estimateText).fontWeight(.bold).foregroundStyle(ForgeDesign.ink)
                    + Text(" · touches ")
                    + Text(touchesText).fontWeight(.bold).foregroundStyle(ForgeDesign.ink)
                    + Text(" · runs tests after each step"))
                    .font(ForgeDesign.mono(10.5))
                    .foregroundStyle(ForgeDesign.muted)
                Spacer()
                HStack(spacing: 10) {
                    Button {
                        workspace.generatePlanRevision(for: task)
                    } label: {
                        Text(workspace.isGeneratingPlanRevision(taskID: task.id) ? "↻ REGENERATING…" : "↻ REGENERATE")
                            .font(ForgeDesign.mono(11.5, weight: .bold))
                            .tracking(0.5)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 11)
                            .background(Color.white)
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                    .disabled(workspace.isGeneratingPlanRevision(taskID: task.id))

                    Button {
                        workspace.approvePlan(for: task)
                    } label: {
                        Text(workspace.isApprovingPlan(taskID: task.id) ? "✓ APPROVING…" : "✓ APPROVE & RUN")
                            .font(ForgeDesign.mono(11.5, weight: .bold))
                            .tracking(0.5)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 11)
                            .background(ForgeDesign.accent)
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                            .forgeShadow(ForgeDesign.ink, x: 3, y: 3)
                    }
                    .buttonStyle(.plain)
                    .disabled(workspace.isApprovingPlan(taskID: task.id))
                    .keyboardShortcut(.return, modifiers: [.command])
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 14)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .top) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var taskNumber: Int {
        let ordered = workspace.tasks.sorted { $0.createdAt < $1.createdAt }
        return (ordered.firstIndex { $0.id == task.id }).map { $0 + 1 } ?? 1
    }

    private var estimateText: String {
        revision.estimatedMinutes.map { "~\($0) min" } ?? "time pending"
    }

    private var touchesText: String {
        let count = revision.expectedFileAreas?.count ?? 0
        return count == 1 ? "1 file area" : "\(count) file areas"
    }
}

private struct ExampleTaskButton: View {
    var title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.custom("JetBrains Mono", fixedSize: 10.5))
                .foregroundStyle(ForgeDesign.muted)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .overlay(
                    Rectangle()
                        .stroke(ForgeDesign.dashedBorder, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                )
                .lineLimit(2)
        }
        .buttonStyle(.plain)
    }
}

private struct StatusPill: View {
    var label: String
    var color: Color
    var foreground: Color = ForgeDesign.ink

    var body: some View {
        Text(label.uppercased())
            .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
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
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                .foregroundStyle(ForgeDesign.muted)
            Spacer()
            Text(value)
                .font(.custom("JetBrains Mono", fixedSize: 10).weight(.semibold))
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
                Text("PLAN — STEP \(currentStepNumber) OF \(max(task.planSteps.count, 1))")
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                    .foregroundStyle(ForgeDesign.muted)
                Spacer()
                Text(timingSummary)
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(ForgeDesign.muted)
            }

            HStack(alignment: .top, spacing: 6) {
                ForEach(Array(task.planSteps.prefix(6).enumerated()), id: \.element.id) { index, step in
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
                        Text("\(String(format: "%02d", index + 1)) \(step.title.lowercased())")
                            .font(.custom("JetBrains Mono", fixedSize: 8).weight(step.status == "Active" ? .bold : .regular))
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

    private var currentStepNumber: Int {
        if let active = task.planSteps.firstIndex(where: { $0.status == "Active" }) {
            return active + 1
        }
        return min(doneCount + 1, max(task.planSteps.count, 1))
    }

    /// Real elapsed time since task creation, plus remaining estimate when
    /// the latest plan revision carries one.
    private var timingSummary: String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let created = parser.date(from: task.createdAt) else { return "" }
        let elapsedMinutes = max(Int(Date().timeIntervalSince(created) / 60), 0)
        let elapsed: String
        switch elapsedMinutes {
        case ..<1: elapsed = "<1m elapsed"
        case ..<90: elapsed = "\(elapsedMinutes)m elapsed"
        default: elapsed = "\(elapsedMinutes / 60)h \(elapsedMinutes % 60)m elapsed"
        }
        if let estimate = task.planRevisions.last?.estimatedMinutes {
            let left = max(estimate - elapsedMinutes, 0)
            return "\(elapsed) · ~\(left)m left"
        }
        return elapsed
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
                Text(streamHeading)
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(Color.gray)
                Spacer()
            }
            .padding(10)
            .background(Color(red: 26 / 255, green: 26 / 255, blue: 23 / 255))

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(streamRows) { row in
                        HStack(alignment: .top, spacing: 10) {
                            Text(row.time)
                                .font(.custom("JetBrains Mono", fixedSize: 10))
                                .foregroundStyle(Color.gray)
                                .frame(width: 64, alignment: .leading)
                            Text(row.message)
                                .font(.custom("JetBrains Mono", fixedSize: 12))
                                .foregroundStyle(row.color)
                                .textSelection(.enabled)
                            Spacer(minLength: 0)
                        }
                    }

                    HStack(spacing: 8) {
                        Text("now")
                            .font(.custom("JetBrains Mono", fixedSize: 10))
                            .foregroundStyle(Color.gray)
                            .frame(width: 64, alignment: .leading)
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

    private var streamHeading: String {
        let stepLabel: String
        if let active = task.planSteps.enumerated().first(where: { $0.element.status == "Active" }) {
            stepLabel = "step \(active.offset + 1): \(active.element.title.lowercased())"
        } else {
            stepLabel = task.currentPhase.lowercased()
        }
        return "— thinking stream · \(stepLabel) —"
    }

    private var streamRows: [AgentStreamRow] {
        var rows: [AgentStreamRow] = []

        rows.append(AgentStreamRow(kind: "TASK", message: task.objective, color: ForgeDesign.accent, time: shortTime(task.createdAt)))

        for message in task.messages.suffix(4) {
            rows.append(AgentStreamRow(kind: message.role.uppercased(), message: message.intentBrief?.summary ?? message.content, color: message.role == "User" ? ForgeDesign.paper : ForgeDesign.warning, time: shortTime(message.createdAt)))
        }

        for call in task.toolCalls.suffix(6) {
            rows.append(AgentStreamRow(kind: call.name.uppercased(), message: "\(call.name.lowercased()) — \(call.outputSummary)", color: toolColor(call.status), time: shortTime(call.startedAt)))
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
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = parser.date(from: value) {
            return Self.clockFormatter.string(from: date)
        }
        return value.count > 8 ? String(value.suffix(8)) : value
    }

    private static let clockFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()
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
                        .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
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
                        .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
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
                                .font(.custom("JetBrains Mono", fixedSize: 11))
                                .lineLimit(1)
                            Spacer()
                            Text("REVIEW")
                                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
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
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
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

    var task: ForgeTask
    var close: () -> Void

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
        HStack(spacing: 14) {
            StatusPill(label: validationState, color: validationColor)

            Text(task.title)
                .font(.system(size: 15, weight: .heavy))
                .tracking(-0.3)
                .lineLimit(1)

            if !reviewFiles.isEmpty {
                Text("file \(activeFileIndex + 1) of \(reviewFiles.count) · +\(totalAdditions) −\(totalDeletions)")
                    .font(ForgeDesign.mono(10.5))
                    .foregroundStyle(ForgeDesign.muted)
            }

            Spacer()

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
                close()
            } label: {
                Label("Close", systemImage: "xmark")
            }
            .buttonStyle(ForgeSecondaryButtonStyle())
            .keyboardShortcut(.cancelAction)
        }
        .padding(14)
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private var fileTree: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("FILES — \(reviewFiles.count)")
                Spacer()
            }
            .font(ForgeDesign.mono(9, weight: .bold))
            .tracking(1)
            .foregroundStyle(ForgeDesign.muted)
            .padding(.horizontal, 16)
            .frame(height: 36)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            if reviewFiles.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("NO DIFF READY")
                        .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
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
                    Text("✓ \(approvedFileCount) reviewed · \(max(reviewFiles.count - approvedFileCount, 0)) to go")
                    Spacer()
                }
                .font(ForgeDesign.mono(9.5))
                .foregroundStyle(ForgeDesign.muted)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .overlay(alignment: .top) {
                    Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                }
            }
        }
        .background(Color.white)
    }

    private var diffPane: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                if let activePath {
                    Text(activePath)
                        .font(.custom("JetBrains Mono", fixedSize: 10.5).weight(.bold))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let file = selectedFile, let additions = file.additions, let deletions = file.deletions {
                        Text("+\(additions) −\(deletions)")
                            .font(ForgeDesign.mono(9.5))
                            .foregroundStyle(ForgeDesign.muted)
                    }
                }

                Spacer()

                HStack(spacing: 0) {
                    ForEach(DiffReviewMode.allCases) { item in
                        Button {
                            mode = item
                        } label: {
                            Text(item.rawValue)
                                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                                .foregroundStyle(mode == item ? ForgeDesign.paper : ForgeDesign.ink)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 3)
                                .background(mode == item ? ForgeDesign.ink : Color.white)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            }
            .padding(.horizontal, 18)
            .frame(height: 36)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

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
        HStack(spacing: 10) {
            Text("this file:")
                .font(ForgeDesign.mono(9.5))
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

            Spacer()

            Text(selectedHunkCount > 1 ? "J/K next hunk · ⌘↵ approve file" : "⌘↵ approve file")
                .font(ForgeDesign.mono(9))
                .foregroundStyle(ForgeDesign.dashedBorder)

            // Hidden hunk-navigation bindings behind the J/K hint above.
            Button("") { selectedHunkIndex = max(selectedHunkIndex - 1, 0) }
                .keyboardShortcut("k", modifiers: [])
                .disabled(selectedHunkIndex <= 0 || selectedHunkCount == 0)
                .frame(width: 0, height: 0)
                .opacity(0)
            Button("") { selectedHunkIndex = min(selectedHunkIndex + 1, max(selectedHunkCount - 1, 0)) }
                .keyboardShortcut("j", modifiers: [])
                .disabled(selectedHunkIndex >= selectedHunkCount - 1 || selectedHunkCount == 0)
                .frame(width: 0, height: 0)
                .opacity(0)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
        .overlay(alignment: .top) {
            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
        }
    }

    private var reasoningPane: some View {
        VStack(spacing: 0) {
            HStack {
                Text("WHY THIS CHANGE")
                Spacer()
            }
            .font(ForgeDesign.mono(9, weight: .bold))
            .tracking(1)
            .foregroundStyle(ForgeDesign.muted)
            .padding(.horizontal, 16)
            .frame(height: 36)
            .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(selectedRationale)
                            .font(.system(size: 13))
                            .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                            .lineSpacing(4)
                            .textSelection(.enabled)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("TESTS COVERING THIS FILE")
                            .font(ForgeDesign.mono(9, weight: .bold))
                            .tracking(1)
                            .foregroundStyle(ForgeDesign.muted)

                        if fileTestEvidence.isEmpty && taskWideTestEvidence.isEmpty {
                            Text("no validation evidence recorded yet")
                                .font(ForgeDesign.mono(11))
                                .foregroundStyle(ForgeDesign.muted)
                        } else {
                            ForEach(Array(fileTestEvidence.prefix(4).enumerated()), id: \.offset) { _, evidence in
                                (Text("✓ ").foregroundStyle(ForgeDesign.accent).fontWeight(.bold)
                                    + Text(evidence))
                                    .font(ForgeDesign.mono(11))
                                    .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                                    .textSelection(.enabled)
                            }

                            if !taskWideTestEvidence.isEmpty {
                                Text("TASK-WIDE — NOT CLAIMED AS FILE COVERAGE")
                                    .font(ForgeDesign.mono(9, weight: .bold))
                                    .foregroundStyle(ForgeDesign.muted)
                                    .padding(.top, 4)

                                ForEach(Array(taskWideTestEvidence.prefix(3).enumerated()), id: \.offset) { _, evidence in
                                    Text(evidence)
                                        .font(ForgeDesign.mono(9))
                                        .foregroundStyle(ForgeDesign.muted)
                                        .textSelection(.enabled)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }

                    if let proposal = task.editProposal,
                       proposal.applyTransaction != nil || proposal.rollbackTransaction != nil {
                        ProposalTransactionEvidenceCard(proposal: proposal)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 12)
                    }

                    CompactCommitHandoffCard(task: task)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 12)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("FILE REVIEW")
                            .font(ForgeDesign.mono(9, weight: .bold))
                            .tracking(1)
                            .foregroundStyle(ForgeDesign.muted)

                        if let selectedFile {
                            MetricRow(label: "Status", value: selectedFile.status)
                            MetricRow(label: "Validation", value: selectedFile.validationStatus ?? "Unknown")
                            MetricRow(label: "Review", value: selectedFileDecision?.decision ?? "Pending")
                            MetricRow(label: "Lines", value: "+\(selectedFile.additions ?? 0) −\(selectedFile.deletions ?? 0)")
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
                    .padding(.horizontal, 18)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .background(Color.white)
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
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
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
                    .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                    .textSelection(.enabled)
                Text(result.summary)
                    .font(.caption)
                    .foregroundStyle(ForgeDesign.muted)
            } else if let preview {
                Text(preview.suggestedTitle)
                    .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
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
        HStack(alignment: .center, spacing: 9) {
            Text(statusToken)
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.heavy))
                .foregroundStyle(statusColor)
                .frame(width: 12, alignment: .leading)

            Text(file.path)
                .font(.custom("JetBrains Mono", fixedSize: 10.5).weight(isSelected ? .bold : .regular))
                .foregroundStyle(ForgeDesign.ink)
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer(minLength: 6)

            if let additions = file.additions, let deletions = file.deletions {
                Text("+\(additions) −\(deletions)")
                    .font(.custom("JetBrains Mono", fixedSize: 9))
                    .foregroundStyle(ForgeDesign.dashedBorder)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(isSelected ? Color(red: 247 / 255, green: 242 / 255, blue: 255 / 255) : Color.white)
        .overlay(alignment: .leading) {
            if isSelected {
                Rectangle().fill(ForgeDesign.accent).frame(width: 3)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(ForgeDesign.divider).frame(height: 1.5)
        }
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
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask

    var body: some View {
        VStack(spacing: 0) {
            testsControlStrip

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
        }
        .background(ForgeDesign.paper)
    }

    private var testsControlStrip: some View {
        HStack(spacing: 8) {
            Text("APPROVED COMMANDS")
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                .foregroundStyle(ForgeDesign.muted)
            Spacer()

            if let activeRun {
                Button(workspace.isCancellingTaskCommand(runID: activeRun.id) ? "CANCELLING…" : "✕ CANCEL COMMAND") {
                    workspace.cancelTaskCommand(for: task, run: activeRun)
                }
                .buttonStyle(ForgeSecondaryButtonStyle())
                .disabled(workspace.isCancellingTaskCommand(runID: activeRun.id))
            } else if let readyEvidence {
                Button(workspace.isRerunningRepairCommand(evidenceID: readyEvidence.id) ? "RERUNNING…" : "↻ RERUN SELF-FIX") {
                    workspace.rerunRepairCommand(for: task, evidence: readyEvidence)
                }
                .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
                .disabled(workspace.isRerunningRepairCommand(evidenceID: readyEvidence.id))
            } else if let permissionToApprove {
                Button(workspace.isApprovingValidationPreset(taskID: task.id, presetID: permissionToApprove.id) ? "APPROVING…" : "APPROVE \(permissionToApprove.preset.name)") {
                    workspace.approveValidationPreset(for: task, presetID: permissionToApprove.id)
                }
                .buttonStyle(ForgeSecondaryButtonStyle())
                .disabled(workspace.isApprovingValidationPreset(taskID: task.id, presetID: permissionToApprove.id))
            } else if let runnableCommand {
                Button(workspace.isRunningTaskCommand(taskID: task.id) ? "RUNNING…" : "RUN \(runnableCommand.command.name)") {
                    workspace.runTaskCommand(for: task, commandID: runnableCommand.id)
                }
                .buttonStyle(ForgePrimaryButtonStyle(fill: ForgeDesign.accent, foreground: ForgeDesign.ink))
                .disabled(workspace.isRunningTaskCommand(taskID: task.id))
            }

            if canGenerateSelfFix {
                Button(workspace.isGeneratingValidationRepairProposal(taskID: task.id) ? "GENERATING…" : "GENERATE SELF-FIX") {
                    workspace.generateValidationRepairProposal(for: task)
                }
                .buttonStyle(ForgeSecondaryButtonStyle())
                .disabled(workspace.isGeneratingValidationRepairProposal(taskID: task.id))
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 46)
        .background(Color.white)
        .overlay(alignment: .bottom) {
            Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
        }
    }

    private var activeRun: TaskCommandRun? {
        task.taskCommandRuns.reversed().first { $0.status == "Running" }
    }

    private var readyEvidence: CommandRerunEvidence? {
        task.commandRerunEvidence.reversed().first { $0.status == "Ready" }
    }

    private var permissionToApprove: ValidationPresetPermission? {
        workspace.validationPermissions(for: task.id).first { $0.canApprove }
    }

    private var runnableCommand: TaskCommandPermission? {
        workspace.taskCommandPermissions(for: task.id).first { $0.canRun }
    }

    private var canGenerateSelfFix: Bool {
        guard let latestBrief = task.validationRepairBriefs.last else { return false }
        return task.editProposal?.validationRepairBriefID != latestBrief.id &&
            task.editProposal?.status != "Proposed"
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
                .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                .foregroundStyle(ForgeDesign.accent)
            Text(message)
                .font(.custom("JetBrains Mono", fixedSize: 11))
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
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                    .foregroundStyle(statusColor)
                Spacer()
                Text(run.endedAt ?? run.startedAt)
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(Color.gray)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("$ \(run.command)")
                    .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                    .foregroundStyle(ForgeDesign.accent)
                if let cwd = run.cwd {
                    Text("cwd: \(cwd)")
                        .font(.custom("JetBrains Mono", fixedSize: 10))
                        .foregroundStyle(Color.gray)
                }
                Text(run.presetName ?? "Approved command")
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(Color.gray)
            }

            if run.outputChunks.isEmpty {
                Text(run.outputSummary)
                    .font(.custom("JetBrains Mono", fixedSize: 11))
                    .foregroundStyle(ForgeDesign.paper)
                    .textSelection(.enabled)
            } else {
                ForEach(run.outputChunks) { chunk in
                    HStack(alignment: .top, spacing: 8) {
                        Text(chunk.stream.uppercased())
                            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                            .foregroundStyle(streamColor(chunk.stream))
                            .frame(width: 48, alignment: .leading)
                        Text(chunk.text.trimmingCharacters(in: .newlines))
                            .font(.custom("JetBrains Mono", fixedSize: 11))
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
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                    .foregroundStyle(statusColor)

                Spacer(minLength: 8)

                Text(evidence.updatedAt)
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(Color.gray)
            }

            Text(evidence.summary)
                .font(.custom("JetBrains Mono", fixedSize: 11))
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
                .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                .foregroundStyle(ForgeDesign.muted)
                .frame(width: 54, alignment: .leading)
            Text(value)
                .font(.custom("JetBrains Mono", fixedSize: 11))
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
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                    .foregroundStyle(statusColor)
                Spacer()
                Text(run.endedAt ?? run.startedAt)
                    .font(.custom("JetBrains Mono", fixedSize: 10))
                    .foregroundStyle(Color.gray)
            }

            Text(run.summary)
                .font(.custom("JetBrains Mono", fixedSize: 11))
                .foregroundStyle(ForgeDesign.paper)
                .textSelection(.enabled)

            ForEach(run.commands) { command in
                VStack(alignment: .leading, spacing: 4) {
                    Text("$ \(command.command)")
                        .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                        .foregroundStyle(ForgeDesign.accent)
                    Text(command.outputSummary)
                        .font(.custom("JetBrains Mono", fixedSize: 11))
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
                    .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                Text(conversationState)
                    .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
                    .foregroundStyle(clarificationQuestions.isEmpty ? ForgeDesign.muted : ForgeDesign.danger)
                Spacer()
                Text(task.messages.last?.provider?.model ?? "GUARDRAILS ON")
                    .font(.custom("JetBrains Mono", fixedSize: 8))
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
                        EmbeddedConversationPlanCard(task: task, revision: revision, draft: $draft)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color.white)

            HStack(alignment: .bottom, spacing: 0) {
                TextField(replyPlaceholder, text: $draft, axis: .vertical)
                    .lineLimit(2...5)
                    .textFieldStyle(.plain)
                    .font(.custom("JetBrains Mono", fixedSize: 13))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)

                Button {
                    send()
                } label: {
                    Text("\(sendButtonTitle.uppercased()) ↵")
                        .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                        .foregroundStyle(ForgeDesign.accent)
                        .frame(minWidth: 82, minHeight: 46)
                        .background(ForgeDesign.ink)
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
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

private struct FullPlanApprovalView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask
    var revision: PlanRevision
    var close: () -> Void
    @State private var selectedStepID: PlanStep.ID?
    @State private var revisionInstruction = ""
    @State private var approvalMode = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                ForgeLogo(size: 18)
                Text("FORGE — PLAN REVIEW · #\(task.id.prefix(6))")
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
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            HStack(spacing: 14) {
                StatusPill(label: "PLAN READY", color: ForgeDesign.accent)
                Text("\u{201C}\(task.title)\u{201D}")
                    .font(.system(size: 15, weight: .heavy))
                    .lineLimit(1)
                Spacer()
                Text("planned in \(planningDuration) · nothing executed yet")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
            }
            .padding(.horizontal, 24)
            .frame(height: 54)
            .background(Color.white)
            .overlay(alignment: .bottom) {
                Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
            }

            HStack(spacing: 0) {
                VStack(spacing: 0) {
                    HStack {
                        Text("PROPOSED STEPS — \(revision.steps.count)")
                        Spacer()
                        Text("✎ click a step to edit it")
                            .fontWeight(.regular)
                            .foregroundStyle(ForgeDesign.dashedBorder)
                    }
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                    .padding(.horizontal, 18)
                    .frame(height: 36)
                    .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                    }

                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(revision.steps.enumerated()), id: \.element.id) { index, step in
                                Button {
                                    selectedStepID = step.id
                                    revisionInstruction = "Change step \(index + 1) — \(step.title): "
                                } label: {
                                    HStack(alignment: .top, spacing: 14) {
                                        Text(String(format: "%02d", index + 1))
                                            .font(ForgeDesign.mono(10, weight: .heavy))
                                            .frame(width: 24, height: 24)
                                            .background(selectedStepID == step.id ? ForgeDesign.accent : Color.white)
                                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(step.title)
                                                .font(.system(size: 13.5, weight: .bold))
                                            Text(step.summary)
                                                .font(ForgeDesign.mono(10))
                                                .foregroundStyle(ForgeDesign.muted)
                                                .lineLimit(2)
                                        }
                                        Spacer()
                                        Text(step.status.uppercased())
                                            .font(ForgeDesign.mono(9))
                                            .foregroundStyle(Color(red: 154 / 255, green: 154 / 255, blue: 146 / 255))
                                    }
                                    .padding(.horizontal, 18)
                                    .padding(.vertical, 13)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(selectedStepID == step.id ? Color(red: 247 / 255, green: 242 / 255, blue: 255 / 255) : Color.white)
                                    .overlay(alignment: .bottom) {
                                        Rectangle().fill(ForgeDesign.divider).frame(height: 1.5)
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    HStack(spacing: 10) {
                        Text("risk \(revision.riskLevel.lowercased())")
                        Spacer()
                        Text("est. total:")
                        Text(estimateSummary).fontWeight(.bold).foregroundStyle(ForgeDesign.ink)
                    }
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
                    .padding(.horizontal, 18)
                    .frame(height: 42)
                    .background(ForgeDesign.paper)
                    .overlay(alignment: .top) {
                        Rectangle().fill(ForgeDesign.ink).frame(height: 1.5)
                    }
                }
                .frame(maxWidth: .infinity)

                Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)

                VStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("AI · HOW I READ YOUR TASK")
                            .font(ForgeDesign.mono(9, weight: .bold))
                            .tracking(1)
                            .foregroundStyle(ForgeDesign.muted)
                        Text(revision.intentSummary)
                            .font(.system(size: 12.5))
                            .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                            .lineSpacing(4)
                        HStack(spacing: 4) {
                            Text("wrong?")
                                .foregroundStyle(ForgeDesign.dashedBorder)
                            Button {
                                close()
                            } label: {
                                Text("rephrase the task")
                                    .underline()
                                    .foregroundStyle(ForgeDesign.muted)
                            }
                            .buttonStyle(.plain)
                        }
                        .font(ForgeDesign.mono(9.5))
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }

                    planListSection("DELIBERATELY OUT OF SCOPE", values: revision.riskNotes ?? ["No work outside the reviewed plan and repository boundary."])

                    VStack(alignment: .leading, spacing: 7) {
                        Text("GUARDRAILS ON THIS RUN")
                            .font(ForgeDesign.mono(9, weight: .bold))
                            .tracking(1)
                            .foregroundStyle(ForgeDesign.muted)
                        ForEach(runGuardrails, id: \.self) { value in
                            Text("✓ \(value)")
                                .font(ForgeDesign.mono(10))
                                .foregroundStyle(ForgeDesign.muted)
                                .lineLimit(1)
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }

                    if selectedStepID != nil {
                        VStack(alignment: .leading, spacing: 9) {
                            Text("REVISE SELECTED STEP")
                                .font(ForgeDesign.mono(9, weight: .bold))
                                .tracking(1)
                                .foregroundStyle(ForgeDesign.muted)
                            HStack(spacing: 0) {
                                TextField("describe the change…", text: $revisionInstruction)
                                    .textFieldStyle(.plain)
                                    .font(ForgeDesign.mono(10.5))
                                    .padding(.horizontal, 11)
                                    .frame(height: 38)
                                Button("REQUEST") { requestRevision() }
                                    .font(ForgeDesign.mono(9.5, weight: .bold))
                                    .foregroundStyle(ForgeDesign.accent)
                                    .padding(.horizontal, 12)
                                    .frame(height: 38)
                                    .background(ForgeDesign.ink)
                                    .buttonStyle(.plain)
                                    .disabled(trimmedInstruction.isEmpty)
                            }
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 13)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(ForgeDesign.divider).frame(height: 1.5)
                        }
                    }

                    VStack(alignment: .leading, spacing: 9) {
                        Text("APPROVAL MODE")
                            .font(ForgeDesign.mono(9, weight: .bold))
                            .tracking(1)
                            .foregroundStyle(ForgeDesign.muted)
                        HStack(spacing: 0) {
                            approvalModeButton("RUN ALL \(revision.steps.count)", mode: 0)
                            approvalModeButton("STEP BY STEP", mode: 1)
                        }
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                        Text(approvalMode == 0 ? "agent runs the whole plan, pauses only on guardrails" : "runs one agent step, then returns control to you")
                            .font(ForgeDesign.mono(9.5))
                            .foregroundStyle(ForgeDesign.dashedBorder)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 13)

                    Spacer(minLength: 6)

                    VStack(spacing: 10) {
                        Button {
                            workspace.approvePlan(for: task, maxSteps: approvalMode == 0 ? 6 : 1)
                        } label: {
                            Text(approvalMode == 0 ? "✓ APPROVE & RUN ⌘↵" : "✓ APPROVE NEXT STEP ⌘↵")
                                .font(ForgeDesign.mono(11.5, weight: .bold))
                                .tracking(0.5)
                                .foregroundStyle(ForgeDesign.accent)
                                .frame(maxWidth: .infinity)
                                .frame(height: 46)
                                .background(ForgeDesign.ink)
                                .forgeShadow(ForgeDesign.ink.opacity(0.35), x: 3, y: 3)
                        }
                        .buttonStyle(.plain)
                        .disabled(!canApprove)
                        .keyboardShortcut(.return, modifiers: [.command])

                        HStack(spacing: 10) {
                            Button {
                                workspace.generatePlanRevision(for: task)
                            } label: {
                                Text(workspace.isGeneratingPlanRevision(taskID: task.id) ? "↻ REPLANNING…" : "↻ REPLAN")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(ForgeSecondaryButtonStyle())
                            .disabled(workspace.isGeneratingPlanRevision(taskID: task.id))

                            Button {
                                workspace.statusMessage = "Plan not approved — revise a step or replan before running."
                                close()
                            } label: {
                                Text("✗ REJECT")
                                    .foregroundStyle(ForgeDesign.danger)
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(ForgeSecondaryButtonStyle())
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 16)
                }
                .frame(width: 470)
                .background(Color.white)
            }
        }
        .background(ForgeDesign.paper)
    }

    private func planContextSection(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(ForgeDesign.mono(9, weight: .bold))
                .tracking(1)
                .foregroundStyle(ForgeDesign.muted)
            Text(value)
                .font(.system(size: 12.5))
                .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                .lineSpacing(4)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
    }

    private func planListSection(_ title: String, values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(ForgeDesign.mono(9, weight: .bold))
                .tracking(1)
                .foregroundStyle(ForgeDesign.muted)
            ForEach(values.prefix(3), id: \.self) { value in
                Text("− \(value)")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
    }

    private func approvalModeButton(_ title: String, mode: Int) -> some View {
        Button(title) { approvalMode = mode }
            .font(ForgeDesign.mono(10, weight: .bold))
            .foregroundStyle(approvalMode == mode ? ForgeDesign.accent : ForgeDesign.ink)
            .frame(maxWidth: .infinity)
            .frame(height: 36)
            .background(approvalMode == mode ? ForgeDesign.ink : Color.white)
            .buttonStyle(.plain)
            .overlay(alignment: .leading) {
                if mode == 1 { Rectangle().fill(ForgeDesign.ink).frame(width: 1.5) }
            }
    }

    private var canApprove: Bool {
        task.status == "Human Review" &&
            task.currentPhase == "Plan Review" &&
            !workspace.isApprovingPlan(taskID: task.id)
    }
    private var trimmedInstruction: String { revisionInstruction.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var estimateSummary: String {
        let minutes = revision.estimatedMinutes.map { "~\($0) min" } ?? "time pending"
        let cost = revision.estimatedCostUSD.map { String(format: "~$%.2f", $0) } ?? "cost pending"
        return "\(minutes) · \(cost)"
    }

    private func shortTime(_ value: String) -> String {
        value.count > 8 ? String(value.suffix(8)) : value
    }

    /// Real elapsed time between task creation and this revision.
    private var planningDuration: String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let created = parser.date(from: task.createdAt),
              let planned = parser.date(from: revision.generatedAt)
        else { return shortTime(revision.generatedAt) }
        let seconds = max(Int(planned.timeIntervalSince(created).rounded()), 0)
        return seconds < 90 ? "\(seconds)s" : "\(seconds / 60)m"
    }

    /// Accurate statements of the runtime's actual execution boundaries.
    private var runGuardrails: [String] {
        [
            "no file changes before your review",
            "approved validation presets only",
            "stops at every trust gate"
        ]
    }

    private func requestRevision() {
        guard !trimmedInstruction.isEmpty else { return }
        workspace.sendTaskMessage(for: task, content: trimmedInstruction)
        revisionInstruction = ""
    }
}

private struct EmbeddedConversationPlanCard: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @EnvironmentObject private var surfaceCoordinator: WorkspaceSurfaceCoordinator

    var task: ForgeTask
    var revision: PlanRevision
    @Binding var draft: String

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("PLAN")
                    .font(.custom("JetBrains Mono", fixedSize: 9).weight(.black))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(ForgeDesign.accent)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                Text(revision.summary)
                    .font(.callout.weight(.bold))
                    .lineLimit(2)
                Spacer()
                Button("EXPAND") {
                    surfaceCoordinator.present(.fullPlan(taskID: task.id, revisionID: revision.id))
                }
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .buttonStyle(.plain)
            }

            ForEach(Array(revision.steps.prefix(6).enumerated()), id: \.element.id) { index, step in
                HStack(alignment: .center, spacing: 10) {
                    Text("\(index + 1)")
                        .font(.custom("JetBrains Mono", fixedSize: 9).weight(.black))
                        .frame(width: 20, height: 20)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(step.title)
                            .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
                        Text(step.summary)
                            .font(.custom("JetBrains Mono", fixedSize: 9))
                            .foregroundStyle(ForgeDesign.muted)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 6)
                    Button("✎ EDIT") {
                        draft = "Change plan step \(index + 1) — \(step.title): "
                    }
                    .buttonStyle(ForgeSecondaryButtonStyle())
                }
                .padding(.vertical, 3)
            }

            HStack(spacing: 12) {
                Text("est ~\(revision.estimatedMinutes ?? 0)m")
                Text(revision.estimatedCostUSD == 0 ? "local $0" : String(format: "~$%.2f", revision.estimatedCostUSD ?? 0))
                Text("risk \(revision.riskLevel.lowercased())")
                if let areas = revision.expectedFileAreas, !areas.isEmpty {
                    Text("\(areas.count) area(s)")
                }
            }
            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.bold))
            .foregroundStyle(ForgeDesign.muted)

            HStack(spacing: 10) {
                Button {
                    workspace.generatePlanRevision(for: task)
                } label: {
                    Text(workspace.isGeneratingPlanRevision(taskID: task.id) ? "REGENERATING…" : "↻ REGENERATE")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(ForgeSecondaryButtonStyle())
                .disabled(!canRegenerate)

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
        }
        .padding(11)
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        .forgeShadow(ForgeDesign.ink, x: 4, y: 4)
    }

    private var approved: Bool {
        task.approvals.contains {
            $0.action == "Approve Plan" && $0.decision == "Approved" && $0.targetID == revision.id
        }
    }

    private var canApprove: Bool {
        task.status == "Human Review" && task.currentPhase == "Plan Review" && !approved && !workspace.isApprovingPlan(taskID: task.id)
    }

    private var canRegenerate: Bool {
        !workspace.isGeneratingPlanRevision(taskID: task.id) &&
            task.messages.last(where: { $0.role == "Assistant" })?.intentBrief?.openQuestions.isEmpty != false &&
            task.editProposal?.status != "Proposed" &&
            task.editProposal?.status != "Applied"
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
                        .font(.custom("JetBrains Mono", fixedSize: 8))
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
        Group {
            if message.role == "User" {
                Text("YOU")
                    .font(.custom("JetBrains Mono", fixedSize: 8).weight(.black))
                    .foregroundStyle(ForgeDesign.ink)
                    .frame(width: 28, height: 28)
                    .background(ForgeDesign.accent)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            } else {
                ForgeLogo(size: 28)
            }
        }
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
                            .font(.custom("JetBrains Mono", fixedSize: 10))
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
                            .font(.custom("JetBrains Mono", fixedSize: 11).weight(.bold))
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
        .font(.custom("JetBrains Mono", fixedSize: 10))
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
            .font(.custom("JetBrains Mono", fixedSize: 11))
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
            .font(.custom("JetBrains Mono", fixedSize: 9).weight(.black))
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
        .font(.custom("JetBrains Mono", fixedSize: 11))
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
                .font(.custom("JetBrains Mono", fixedSize: 9))
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
                                .font(.custom("JetBrains Mono", fixedSize: 9))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white)
                    .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1))
                }
            } else {
                Label(isLoading ? "Loading diff..." : "Select Load to inspect this file.", systemImage: isLoading ? "hourglass" : "doc.text.magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
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
        .font(.custom("JetBrains Mono", fixedSize: 9))
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
                    .background(ForgeDesign.paper)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1))
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
                    .font(.custom("JetBrains Mono", fixedSize: 11))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(ForgeDesign.paper)
                    .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1))
            }

            Text(brief.generatedAt)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(10)
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
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
                    .background(ForgeDesign.paper)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1))

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
                .font(.custom("JetBrains Mono", fixedSize: 11))
                .textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(ForgeDesign.paper)
                .overlay(Rectangle().stroke(ForgeDesign.divider, lineWidth: 1))
        }
        .padding(10)
        .background(Color.white)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
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
                .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
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
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
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
                    .font(.custom("JetBrains Mono", fixedSize: 10).weight(.bold))
                    .foregroundStyle(transactionColor(transaction))
            }
            Text(transaction.summary)
                .font(.caption)
                .foregroundStyle(ForgeDesign.ink)
            Text("\(transaction.paths.count) file(s) / \(transaction.verifiedAt == nil ? "verification pending" : "hash verified")")
                .font(.custom("JetBrains Mono", fixedSize: 9))
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

private struct TaskCostBreakdownView: View {
    @EnvironmentObject private var workspace: WorkspaceModel

    var task: ForgeTask
    var close: () -> Void
    @State private var openStepIDs: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                ForgeLogo(size: 18)
                Text("FORGE — COST · #\(task.id.prefix(6))")
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

            HStack(alignment: .center, spacing: 22) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("TASK TOTAL")
                        .font(ForgeDesign.mono(9, weight: .bold))
                        .tracking(1)
                        .foregroundStyle(ForgeDesign.muted)
                    Text(String(format: "$%.2f", totalCost))
                        .font(ForgeDesign.mono(34, weight: .heavy))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title)
                        .font(.system(size: 14, weight: .heavy))
                        .lineLimit(1)
                    Text(headerMeta)
                        .font(ForgeDesign.mono(10))
                        .foregroundStyle(ForgeDesign.muted)
                }
                .padding(.leading, 22)
                .overlay(alignment: .leading) { Rectangle().fill(ForgeDesign.divider).frame(width: 1.5) }
                Spacer()
                HStack(spacing: 16) {
                    headerMetric(value: "\(totalCalls)", label: "model calls")
                    headerMetric(value: "\(task.agentRunSteps.count)", label: "agent steps")
                    headerMetric(value: String(format: "$%.2f", averageStepCost), label: "avg / step")
                }
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 18)
            .background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("COST BY STEP")
                            .font(ForgeDesign.mono(9, weight: .bold))
                            .tracking(1)
                            .foregroundStyle(ForgeDesign.muted)
                        GeometryReader { proxy in
                            HStack(spacing: 0) {
                                ForEach(Array(costSteps.enumerated()), id: \.element.id) { index, step in
                                    Rectangle()
                                        .fill(barColor(index: index, step: step))
                                        .frame(width: max(proxy.size.width * barFraction(step), 8))
                                        .overlay(alignment: .trailing) {
                                            if index < costSteps.count - 1 {
                                                Rectangle().fill(ForgeDesign.ink).frame(width: 1.5)
                                            }
                                        }
                                }
                            }
                            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                        }
                        .frame(height: 26)
                        HStack(spacing: 0) {
                            ForEach(Array(costSteps.enumerated()), id: \.element.id) { index, step in
                                Text(index == heaviestIndex ? "\(shortLabel(step)) ← heaviest" : shortLabel(step))
                                    .font(ForgeDesign.mono(8.5, weight: index == heaviestIndex ? .bold : .regular))
                                    .foregroundStyle(index == heaviestIndex ? ForgeDesign.ink : ForgeDesign.muted)
                                    .lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .padding(.horizontal, 26)
                    .padding(.top, 16)
                    .padding(.bottom, 8)

                    VStack(spacing: 10) {
                        ForEach(Array(costSteps.enumerated()), id: \.element.id) { index, step in
                            stepRow(index: index, step: step)
                        }
                    }
                    .padding(.horizontal, 26)
                    .padding(.top, 12)
                }
            }
            .background(ForgeDesign.paper)

            HStack(spacing: 14) {
                Text(footerInsight)
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
                    .lineLimit(1)
                Spacer()
                Button("⤓ EXPORT CSV") { exportCSV() }
                    .buttonStyle(ForgeSecondaryButtonStyle())
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 13)
            .background(Color.white)
            .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
        }
        .background(ForgeDesign.paper)
    }

    private func stepRow(index: Int, step: AgentRunStep) -> some View {
        let isOpen = openStepIDs.contains(step.id)
        return VStack(spacing: 0) {
            Button {
                if isOpen { openStepIDs.remove(step.id) } else { openStepIDs.insert(step.id) }
            } label: {
                HStack(spacing: 13) {
                    Text(isOpen ? "▾" : "▸")
                        .font(ForgeDesign.mono(10, weight: .heavy))
                        .frame(width: 14)
                    Text("\(index + 1)")
                        .font(ForgeDesign.mono(10, weight: .heavy))
                        .frame(width: 24, height: 24)
                        .background(index == heaviestIndex ? ForgeDesign.accent : Color.white)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    Text(stepLabel(step))
                        .font(.system(size: 13, weight: .bold))
                        .lineLimit(1)
                    Spacer()
                    Text("\(callCount(step)) call\(callCount(step) == 1 ? "" : "s") · \(step.provider.model)")
                        .font(ForgeDesign.mono(9.5))
                        .foregroundStyle(ForgeDesign.dashedBorder)
                    Text(String(format: "$%.2f", stepCost(step)))
                        .font(ForgeDesign.mono(13, weight: .heavy))
                        .frame(width: 64, alignment: .trailing)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
            }
            .buttonStyle(.plain)

            if isOpen {
                VStack(spacing: 0) {
                    ForEach(0..<callCount(step), id: \.self) { call in
                        HStack(spacing: 12) {
                            Text(OfflineWorkspaceState.clockTime(step.createdAt))
                                .foregroundStyle(ForgeDesign.dashedBorder)
                                .frame(width: 60, alignment: .leading)
                            Text(call == 0 ? step.summary : "retry attempt \(call + 1) — recovered provider output")
                                .foregroundStyle(Color(red: 42 / 255, green: 42 / 255, blue: 38 / 255))
                                .lineLimit(1)
                            Spacer()
                            Text(step.provider.mode == "local" ? "local · $0" : "provider call")
                                .foregroundStyle(ForgeDesign.dashedBorder)
                            Text(String(format: "$%.2f", stepCost(step) / Double(max(callCount(step), 1))))
                                .fontWeight(.bold)
                                .frame(width: 52, alignment: .trailing)
                        }
                        .font(ForgeDesign.mono(10))
                        .padding(.vertical, 7)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255)).frame(height: 1.5)
                        }
                    }
                }
                .padding(.leading, 59)
                .padding(.trailing, 16)
                .padding(.bottom, 10)
                .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
            }
        }
        .background(Color.white)
        .overlay(Rectangle().stroke(index == heaviestIndex ? ForgeDesign.ink : ForgeDesign.divider, lineWidth: 1.5))
    }

    private func headerMetric(value: String, label: String) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(value)
                .font(ForgeDesign.mono(15, weight: .heavy))
            Text(label)
                .font(ForgeDesign.mono(10))
                .foregroundStyle(ForgeDesign.muted)
        }
    }

    private var costSteps: [AgentRunStep] { task.agentRunSteps }
    private func callCount(_ step: AgentRunStep) -> Int { max(step.providerAttemptCount ?? 1, 1) }
    private var totalCalls: Int { costSteps.reduce(0) { $0 + callCount($1) } }
    private var totalCost: Double { task.planRevisions.last?.estimatedCostUSD ?? 0 }
    private var averageStepCost: Double { costSteps.isEmpty ? 0 : totalCost / Double(costSteps.count) }
    private func stepCost(_ step: AgentRunStep) -> Double {
        totalCalls == 0 ? 0 : totalCost * Double(callCount(step)) / Double(totalCalls)
    }
    private var heaviestIndex: Int {
        costSteps.enumerated().max { callCount($0.element) < callCount($1.element) }?.offset ?? 0
    }
    private func barFraction(_ step: AgentRunStep) -> CGFloat {
        totalCalls == 0 ? 0 : CGFloat(callCount(step)) / CGFloat(totalCalls)
    }
    private func barColor(index: Int, step: AgentRunStep) -> Color {
        index == heaviestIndex ? ForgeDesign.accent : (index % 2 == 0 ? Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255) : Color(red: 201 / 255, green: 201 / 255, blue: 196 / 255))
    }
    private func shortLabel(_ step: AgentRunStep) -> String {
        stepLabel(step).lowercased()
    }
    private func stepLabel(_ step: AgentRunStep) -> String {
        switch step.action {
        case "GenerateEditProposal": return "Write + self-fix"
        case "RepositoryInspection": return "Read code"
        case "RunTaskCommand": return "Tests"
        case "RunValidation": return "Tests"
        case "RequestPlanApproval": return "Plan"
        case "WaitForHumanReview": return "Review gate"
        default: return step.action
        }
    }

    private var headerMeta: String {
        let minutes = NeedsDecisionState.minutesLabel(from: task.createdAt, to: task.updatedAt)
        let provider = costSteps.last?.provider.model ?? task.planRevisions.last?.provider.model ?? "local"
        let stepsText = costSteps.count == 1 ? "1 step" : "\(costSteps.count) steps"
        let callsText = totalCalls == 1 ? "1 model call" : "\(totalCalls) model calls"
        return "\(task.status.lowercased()) · \(minutes) runtime · \(stepsText) · \(callsText) · \(provider)"
    }

    private var footerInsight: String {
        let retries = costSteps.reduce(0) { $0 + max(callCount($1) - 1, 0) }
        if retries > 0 {
            return "▸ provider retries cost \(String(format: "$%.2f", totalCost == 0 ? 0 : totalCost * Double(retries) / Double(max(totalCalls, 1)))) — \(retries) malformed output(s) recovered before you ever saw them"
        }
        return "▸ every model call ran inside the reviewed loop — no hidden work, no unreviewed spend"
    }

    private func exportCSV() {
        var rows = ["step,action,summary,calls,model,cost_usd,created_at,completed_at"]
        for (index, step) in costSteps.enumerated() {
            let summary = step.summary.replacingOccurrences(of: "\"", with: "'")
            rows.append("\(index + 1),\(step.action),\"\(summary)\",\(callCount(step)),\(step.provider.model),\(String(format: "%.4f", stepCost(step))),\(step.createdAt),\(step.completedAt ?? "")")
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "forge-task-\(task.id.prefix(6))-cost.csv"
        if panel.runModal() == .OK, let url = panel.url {
            try? rows.joined(separator: "\n").write(to: url, atomically: true, encoding: .utf8)
        }
    }
}
