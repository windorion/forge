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
                    Label("Create Demo Task", systemImage: "plus.circle")
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
        HStack(spacing: 8) {
            Circle()
                .fill(workspace.runtimeHealth?.ok == true ? Color.green : Color.orange)
                .frame(width: 8, height: 8)
            Text(workspace.statusMessage)
                .font(.caption)
                .lineLimit(2)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
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

    private let steps = [
        "Understand task objective",
        "Inspect repository context",
        "Prepare implementation plan",
        "Run validation",
        "Request human review"
    ]

    var body: some View {
        Panel(title: "Planner", systemImage: "checklist") {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(steps, id: \.self) { step in
                    HStack(spacing: 10) {
                        Image(systemName: step == "Understand task objective" ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(step == "Understand task objective" ? .green : .secondary)
                        Text(step)
                    }
                }
            }
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
    var task: ForgeTask

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Review", systemImage: "doc.text.magnifyingglass")
                .font(.title3.weight(.semibold))

            VStack(alignment: .leading, spacing: 8) {
                Text("Changed files")
                    .font(.headline)
                Text("No file changes yet. The first runtime slice only creates tasks and streams events.")
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Approval")
                    .font(.headline)
                Button("Approve Plan") {}
                    .disabled(true)
                Button("Request Changes") {}
                    .disabled(true)
            }

            Spacer()

            Text("Task ID: \(task.id)")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(20)
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
