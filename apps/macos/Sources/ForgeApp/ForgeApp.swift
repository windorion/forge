import SwiftUI

extension Notification.Name {
    static let forgeToggleCommandPalette = Notification.Name("forge.toggleCommandPalette")
    static let forgeNewTask = Notification.Name("forge.newTask")
    static let forgeSwitchRepository = Notification.Name("forge.switchRepository")
    static let forgeToggleMissionControl = Notification.Name("forge.toggleMissionControl")
    static let forgeToggleTaskQueue = Notification.Name("forge.toggleTaskQueue")
    static let forgeToggleHistory = Notification.Name("forge.toggleHistory")
    static let forgeOpenSelectedDiff = Notification.Name("forge.openSelectedDiff")
    static let forgeOpenSelectedAudit = Notification.Name("forge.openSelectedAudit")
    static let forgePrefillComposer = Notification.Name("forge.prefillComposer")
    static let forgeToggleTemplates = Notification.Name("forge.toggleTemplates")
    static let forgeApplicationWillTerminate = Notification.Name("forge.applicationWillTerminate")
}

@main
struct ForgeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var workspace = WorkspaceModel()

    var body: some Scene {
        WindowGroup("Forge") {
            WorkspaceView()
                .environmentObject(workspace)
                .frame(minWidth: 900, minHeight: 480)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 980, height: 520)
        .windowResizability(.contentMinSize)
        .commands {
            CommandMenu("Forge") {
                Button("Command Palette") {
                    NotificationCenter.default.post(name: .forgeToggleCommandPalette, object: nil)
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("commandPalette"))

                Divider()

                Button("New Task") {
                    NotificationCenter.default.post(name: .forgeNewTask, object: nil)
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("newTask"))

                Button("Approve Plan & Run") {
                    if let task = workspace.selectedTask {
                        workspace.approvePlan(for: task)
                    }
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("approvePlan"))
                .disabled(workspace.selectedTask.map { $0.status != "Human Review" || $0.currentPhase != "Plan Review" } ?? true)

                Button("Pause / Resume Agent") {
                    if let task = workspace.selectedTask, let loop = task.agentRunLoops.last {
                        if loop.status == "Running" {
                            workspace.pauseAgentLoop(for: task, loop: loop)
                        } else {
                            workspace.resumeAgentLoop(for: task, loop: loop)
                        }
                    }
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("pauseResume"))
                .disabled(workspace.selectedTask?.agentRunLoops.last == nil)

                Button("Abort Task") {
                    if let task = workspace.selectedTask, let loop = task.agentRunLoops.last {
                        workspace.abortAgentLoop(for: task, loop: loop)
                    }
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("abortTask"))
                .disabled(workspace.selectedTask?.agentRunLoops.last == nil)

                Divider()

                Button("Mission Control") {
                    NotificationCenter.default.post(name: .forgeToggleMissionControl, object: nil)
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("missionControl"))

                Button("Task Queue") {
                    NotificationCenter.default.post(name: .forgeToggleTaskQueue, object: nil)
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("taskQueue"))

                Button("Task History") {
                    NotificationCenter.default.post(name: .forgeToggleHistory, object: nil)
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("taskHistory"))

                Button("Task Templates") {
                    NotificationCenter.default.post(name: .forgeToggleTemplates, object: nil)
                }

                Button("Switch Repository…") {
                    NotificationCenter.default.post(name: .forgeSwitchRepository, object: nil)
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("switchRepo"))

                Divider()

                Button("Open Full Diff") {
                    NotificationCenter.default.post(name: .forgeOpenSelectedDiff, object: nil)
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("openDiff"))
                .disabled(workspace.selectedTask == nil)

                Button("Export Audit Log") {
                    NotificationCenter.default.post(name: .forgeOpenSelectedAudit, object: nil)
                }
                .keyboardShortcut(ForgeShortcuts.shortcut("exportAudit"))
                .disabled(workspace.selectedTask == nil)
            }
        }

        Settings {
            SettingsView()
                .environmentObject(workspace)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 980, height: 602)
        .windowResizability(.contentSize)
    }
}
