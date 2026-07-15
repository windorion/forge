import Foundation
import SwiftUI

struct MissionControlTaskSnapshot: Identifiable, Codable, Hashable {
    var id: String { taskID }
    var taskID: String
    var title: String
    var tag: String
    var phase: String
    var meta: String
    var progress: Double?
    var rank: Int
}

struct MissionControlRepositorySnapshot: Identifiable, Codable, Hashable {
    var id: String { path }
    var path: String
    var name: String
    var state: String
    var footer: String
    var capturedAt: Date
    var tasks: [MissionControlTaskSnapshot]
    var runtimeState: String? = nil
    var runtimePort: Int? = nil
    var runtimeProcessID: Int32? = nil
    var observerReadOnly: Bool? = nil
    var runtimeAuthorizationID: String? = nil
}

struct MissionControlView: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    @State private var runtimePrompt: MissionControlRuntimePrompt?
    let newTask: () -> Void
    let openTask: (ForgeTask.ID) -> Void
    let close: () -> Void

    private var repositories: [MissionControlRepositorySnapshot] {
        Array(workspace.missionControlRepositories.prefix(3))
    }

    private var currentPath: String? { workspace.missionControlCurrentRepositoryPath }
    private var liveRepositories: [MissionControlRepositorySnapshot] {
        repositories.filter { $0.path == currentPath || isLiveObserver($0) || isActiveRuntime($0) }
    }
    private var liveTasks: [MissionControlTaskSnapshot] {
        liveRepositories.flatMap(\.tasks)
    }

    var body: some View {
        VStack(spacing: 0) {
            missionTitleBar
            summaryStrip
            repositoryColumns
            bottomBar
        }
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        .onAppear { workspace.refreshMissionControl() }
        .alert(item: $runtimePrompt) { prompt in
            runtimeAuthorizationAlert(prompt)
        }
    }

    private var missionTitleBar: some View {
        ZStack {
            HStack(spacing: 6) {
                Circle().fill(Color(red: 1, green: 95 / 255, blue: 87 / 255)).frame(width: 12, height: 12)
                Circle().fill(Color(red: 254 / 255, green: 188 / 255, blue: 46 / 255)).frame(width: 12, height: 12)
                Circle().fill(Color(red: 40 / 255, green: 200 / 255, blue: 64 / 255)).frame(width: 12, height: 12)
                Spacer()
            }
            .padding(.leading, 16)
            HStack(spacing: 10) {
                ForgeLogo(size: 18)
                Text("FORGE — MISSION CONTROL").font(ForgeDesign.mono(12, weight: .bold)).tracking(0.5)
            }
            HStack {
                Spacer()
                Text(ForgeDesign.appVersion).font(ForgeDesign.mono(10)).foregroundStyle(ForgeDesign.muted)
                Button("CLOSE", action: close)
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .buttonStyle(.plain)
                    .keyboardShortcut(.cancelAction)
            }.padding(.trailing, 16)
        }
        .frame(height: 42)
        .background(Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255))
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private var summaryStrip: some View {
        HStack(spacing: 18) {
            Circle().fill(currentRunningCount > 0 ? ForgeDesign.accent : ForgeDesign.muted).frame(width: 7, height: 7)
            Text("\(currentRunningCount) AGENT\(currentRunningCount == 1 ? "" : "S") RUNNING")
                .font(ForgeDesign.mono(11, weight: .bold))
            Text("\(currentNeedsYouCount) waiting for you · \(currentQueuedCount) queued · \(readyCount) ready")
                .font(ForgeDesign.mono(10.5)).foregroundStyle(ForgeDesign.muted)
            Spacer()
            Button("⏸ PAUSE ALL") { workspace.pauseAllMissionControlLoops() }
                .buttonStyle(MissionSecondaryButtonStyle())
                .disabled(currentRunningCount == 0)
            Button("+ NEW TASK", action: newTask)
                .buttonStyle(MissionPrimaryButtonStyle())
                .keyboardShortcut("n", modifiers: [.command, .shift])
        }
        .padding(.horizontal, 22).frame(height: 58).background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private var repositoryColumns: some View {
        HStack(spacing: 0) {
            ForEach(Array(repositories.enumerated()), id: \.element.id) { index, repository in
                repositoryColumn(repository, index: index)
                if index < 2 { Rectangle().fill(ForgeDesign.ink).frame(width: 1.5) }
            }
            if repositories.count < 3 {
                ForEach(repositories.count..<3, id: \.self) { index in
                    emptyRepositoryColumn(index: index)
                    if index < 2 { Rectangle().fill(ForgeDesign.ink).frame(width: 1.5) }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func repositoryColumn(_ repository: MissionControlRepositorySnapshot, index: Int) -> some View {
        let isCurrent = repository.path == currentPath
        let hasLiveData = isCurrent || isLiveObserver(repository) || isActiveRuntime(repository)
        return VStack(spacing: 0) {
            Button { workspace.activateMissionControlRepository(repository.path) } label: {
                HStack(spacing: 10) {
                    Text("⌥").font(ForgeDesign.mono(12, weight: .black))
                    Text(repository.name).font(ForgeDesign.mono(12, weight: .bold)).lineLimit(1)
                    Spacer()
                    Text(hasLiveData ? repository.state : observerLabel(repository))
                        .font(ForgeDesign.mono(8.5, weight: .bold)).tracking(0.5)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .foregroundStyle(stateForeground(repository.state, hasLiveData: hasLiveData))
                        .background(stateBackground(repository.state, hasLiveData: hasLiveData))
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                }
                .padding(.horizontal, 18).frame(height: 48).background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
            }
            .buttonStyle(.plain)
            .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: [.command])
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            ScrollView {
                LazyVStack(spacing: 10) {
                    if repository.tasks.isEmpty {
                        Text(hasLiveData ? "NO TASKS IN THIS REPOSITORY" : "NO CACHED TASKS")
                            .font(ForgeDesign.mono(9, weight: .bold)).foregroundStyle(ForgeDesign.muted)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                    } else {
                        ForEach(repository.tasks.prefix(4)) { task in
                            taskCard(task, repositoryPath: repository.path, isCurrent: isCurrent, hasLiveData: hasLiveData)
                        }
                    }
                }.padding(14)
            }
            .background(Color.white)

            HStack(spacing: 8) {
                Text(repositoryFooter(repository, isCurrent: isCurrent))
                    .font(ForgeDesign.mono(9.5)).foregroundStyle(ForgeDesign.muted)
                    .lineLimit(1)
                Spacer(minLength: 4)
                runtimeAccessButton(repository, isCurrent: isCurrent)
            }
                .padding(.horizontal, 12).frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
                .background(Color.white)
                .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func taskCard(_ task: MissionControlTaskSnapshot, repositoryPath: String, isCurrent: Bool, hasLiveData: Bool) -> some View {
        Button {
            if isCurrent { openTask(task.taskID) }
            else { workspace.activateMissionControlRepositoryForTask(path: repositoryPath, taskID: task.taskID) }
        } label: {
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text(hasLiveData ? task.tag : "CACHED \(task.tag)")
                        .font(ForgeDesign.mono(8.5, weight: .bold)).tracking(0.5)
                        .foregroundStyle(taskTagForeground(task.tag, hasLiveData: hasLiveData))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(taskTagBackground(task.tag, hasLiveData: hasLiveData))
                        .overlay(Rectangle().stroke(hasLiveData ? ForgeDesign.ink : ForgeDesign.divider, lineWidth: 1.5))
                    Spacer()
                    Text("#\(task.taskID.prefix(6))").font(ForgeDesign.mono(9)).foregroundStyle(ForgeDesign.muted)
                }
                Text(task.title).font(.system(size: 12.5, weight: .bold)).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                if let progress = task.progress {
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Rectangle().fill(ForgeDesign.paper)
                            Rectangle().fill(hasLiveData ? ForgeDesign.accent : ForgeDesign.divider).frame(width: geometry.size.width * progress)
                        }.overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    }.frame(height: 9)
                }
                Text(task.meta).font(ForgeDesign.mono(9.5)).foregroundStyle(ForgeDesign.muted).lineLimit(1)
            }
            .padding(12).background(task.tag.contains("WAIT") ? Color(red: 1, green: 253 / 255, blue: 244 / 255) : Color.white)
            .overlay(Rectangle().stroke(hasLiveData ? ForgeDesign.ink : ForgeDesign.divider, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }

    private func emptyRepositoryColumn(index: Int) -> some View {
        VStack(spacing: 12) {
            Spacer()
            Text("REPOSITORY SLOT \(index + 1)").font(ForgeDesign.mono(9, weight: .bold)).foregroundStyle(ForgeDesign.muted)
            Button("+ ADD REPOSITORY") { workspace.connectRepository() }.buttonStyle(MissionSecondaryButtonStyle())
            Text("Local path only · opens with explicit access").font(ForgeDesign.mono(9)).foregroundStyle(ForgeDesign.muted)
            Spacer()
        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.white)
    }

    private var bottomBar: some View {
        HStack {
            Text("\(activeRuntimeCount) active runtime\(activeRuntimeCount == 1 ? "" : "s") · other repos read-only · authorization lasts this app session")
            Spacer()
            Text("Pause All covers authorized runtimes · ⌘1–3 focus repo")
        }
        .font(ForgeDesign.mono(10)).foregroundStyle(ForgeDesign.muted)
        .padding(.horizontal, 22).frame(height: 42)
        .background(Color(red: 247 / 255, green: 247 / 255, blue: 244 / 255))
        .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private var currentRunningCount: Int { liveTasks.filter { $0.tag == "RUNNING" }.count }
    private var activeRuntimeCount: Int { 1 + repositories.filter(isActiveRuntime).count }
    private var currentNeedsYouCount: Int { liveTasks.filter { $0.tag.contains("WAIT") }.count }
    private var currentQueuedCount: Int { liveTasks.filter { $0.tag == "QUEUED" }.count }
    private var readyCount: Int { liveTasks.filter { $0.tag == "COMPLETE" || $0.tag == "REVIEW" }.count }

    private func stateBackground(_ state: String, hasLiveData: Bool) -> Color {
        guard hasLiveData else { return ForgeDesign.paper }
        if state == "NEEDS YOU" { return ForgeDesign.warning }
        if state == "RUNNING" { return ForgeDesign.accent }
        if state == "READY" { return ForgeDesign.ink }
        return Color.white
    }
    private func stateForeground(_ state: String, hasLiveData: Bool) -> Color {
        hasLiveData && state == "READY" ? ForgeDesign.paper : ForgeDesign.ink
    }
    private func taskTagBackground(_ tag: String, hasLiveData: Bool) -> Color {
        guard hasLiveData else { return ForgeDesign.paper }
        if tag.contains("WAIT") { return ForgeDesign.warning }
        if tag == "RUNNING" { return ForgeDesign.accent }
        if tag == "COMPLETE" { return ForgeDesign.ink }
        return Color.white
    }
    private func taskTagForeground(_ tag: String, hasLiveData: Bool) -> Color {
        hasLiveData && tag == "COMPLETE" ? ForgeDesign.paper : ForgeDesign.ink
    }
    private func isLiveObserver(_ repository: MissionControlRepositorySnapshot) -> Bool {
        repository.runtimeState == "LIVE OBSERVER" && repository.observerReadOnly == true
    }
    private func isActiveRuntime(_ repository: MissionControlRepositorySnapshot) -> Bool {
        repository.runtimeState == "ACTIVE RUNTIME" && repository.observerReadOnly == false
    }
    private func observerLabel(_ repository: MissionControlRepositorySnapshot) -> String {
        switch repository.runtimeState {
        case "STARTING", "CONNECTING": return "CONNECTING"
        case "AUTHORIZING", "ACTIVATING": return "AUTHORIZING"
        case "RETURNING READ-ONLY": return "READ-ONLY"
        case "FAILED", "UNAVAILABLE", "STOPPED": return "OFFLINE"
        default: return "CACHED"
        }
    }
    private func repositoryFooter(_ repository: MissionControlRepositorySnapshot, isCurrent: Bool) -> String {
        if isCurrent { return repository.footer }
        if isActiveRuntime(repository) {
            let authorization = repository.runtimeAuthorizationID.map { "auth \($0.prefix(8))" } ?? "authorization pending"
            return "active · \(authorization) · \(repository.footer)"
        }
        if isLiveObserver(repository) { return "live read-only · \(repository.footer)" }
        if let error = repository.runtimeState, ["FAILED", "UNAVAILABLE", "STOPPED"].contains(error) {
            return "observer \(error.lowercased()) · showing last snapshot"
        }
        return "cached \(relativeDate(repository.capturedAt)) · observer connecting"
    }

    @ViewBuilder
    private func runtimeAccessButton(_ repository: MissionControlRepositorySnapshot, isCurrent: Bool) -> some View {
        if !isCurrent && isLiveObserver(repository) {
            Button("AUTHORIZE ACTIVE") {
                runtimePrompt = MissionControlRuntimePrompt(repository: repository, action: .authorize)
            }
            .buttonStyle(MissionRuntimeButtonStyle(fill: ForgeDesign.ink, foreground: ForgeDesign.accent))
        } else if !isCurrent && isActiveRuntime(repository) {
            let hasRunningTask = repository.tasks.contains { $0.tag == "RUNNING" }
            Button(hasRunningTask ? "PAUSE BEFORE READ-ONLY" : "RETURN READ-ONLY") {
                runtimePrompt = MissionControlRuntimePrompt(repository: repository, action: .revoke)
            }
            .buttonStyle(MissionRuntimeButtonStyle(fill: Color.white, foreground: ForgeDesign.ink))
            .disabled(hasRunningTask)
        }
    }

    private func runtimeAuthorizationAlert(_ prompt: MissionControlRuntimePrompt) -> Alert {
        let port = prompt.repository.runtimePort ?? 0
        switch prompt.action {
        case .authorize:
            return Alert(
                title: Text("Authorize active runtime?"),
                message: Text("Repository: \(prompt.repository.path)\nPort: \(port)\n\nForge will replace the read-only observer with a writable local runtime for this app session. It may recover interrupted work and dispatch persisted queued Agent Loops. Background runtimes use the local deterministic provider and remain isolated to this repository."),
                primaryButton: .default(Text("Authorize Active Runtime")) {
                    workspace.setMissionControlRuntimeActive(path: prompt.repository.path, isActive: true)
                },
                secondaryButton: .cancel()
            )
        case .revoke:
            return Alert(
                title: Text("Return repository to read-only?"),
                message: Text("Forge will stop the writable runtime for \(prompt.repository.path) and restart its read-only observer. Queued work remains persisted but will not dispatch until active access is authorized again."),
                primaryButton: .destructive(Text("Return to Read-Only")) {
                    workspace.setMissionControlRuntimeActive(path: prompt.repository.path, isActive: false)
                },
                secondaryButton: .cancel()
            )
        }
    }
    private func relativeDate(_ date: Date) -> String {
        RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }
}

private struct MissionControlRuntimePrompt: Identifiable {
    enum Action: String {
        case authorize
        case revoke
    }

    var id: String { "\(repository.path):\(action.rawValue)" }
    var repository: MissionControlRepositorySnapshot
    var action: Action
}

private struct MissionPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(ForgeDesign.mono(10.5, weight: .bold)).tracking(0.5)
            .foregroundStyle(ForgeDesign.accent).padding(.horizontal, 13).padding(.vertical, 8)
            .background(ForgeDesign.ink).overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }
}

private struct MissionSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(ForgeDesign.mono(10.5, weight: .bold)).tracking(0.5)
            .foregroundStyle(configuration.isPressed ? ForgeDesign.muted : ForgeDesign.ink)
            .padding(.horizontal, 13).padding(.vertical, 8).background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }
}

private struct MissionRuntimeButtonStyle: ButtonStyle {
    var fill: Color
    var foreground: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(ForgeDesign.mono(8, weight: .bold))
            .tracking(0.3)
            .foregroundStyle(configuration.isPressed ? ForgeDesign.muted : foreground)
            .padding(.horizontal, 7)
            .padding(.vertical, 5)
            .background(fill)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }
}
