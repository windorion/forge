import SwiftUI

/// `25a` first-run onboarding: a 4-step wizard that orchestrates existing
/// capability — GitHub connect (15a device flow), repo selection, guardrails
/// preview (real settings), and the first task (real 1a compose flow).
struct OnboardingView: View {
    @EnvironmentObject private var workspace: WorkspaceModel
    var close: () -> Void

    @AppStorage("forge.monthlyBudgetCap") private var monthlyBudgetCap = 40
    @State private var step = 1
    @State private var firstTask = ""

    private let steps = ["CONNECT GITHUB", "PICK A REPO", "SET THE LEASH", "FIRST TASK"]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ForgeLogo(size: 20)
                VStack(alignment: .leading, spacing: 1) {
                    Text("SET UP FORGE")
                        .font(ForgeDesign.mono(12, weight: .bold))
                        .tracking(0.5)
                    Text("first launch · ~3 minutes total")
                        .font(ForgeDesign.mono(9))
                        .foregroundStyle(ForgeDesign.muted)
                }
                Spacer()
                Text("everything can be changed later in Settings")
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(ForgeDesign.dashedBorder)
            }
            .padding(.horizontal, 22)
            .frame(height: 56)
            .background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            HStack(spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, title in
                    Button {
                        step = index + 1
                    } label: {
                        HStack(spacing: 8) {
                            Text(String(format: "%02d", index + 1))
                                .font(ForgeDesign.mono(10, weight: .heavy))
                                .frame(width: 22, height: 22)
                                .background(step == index + 1 ? ForgeDesign.accent : Color.white)
                                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                            Text(title)
                                .font(ForgeDesign.mono(9, weight: step == index + 1 ? .bold : .regular))
                                .foregroundStyle(step == index + 1 ? ForgeDesign.ink : ForgeDesign.muted)
                        }
                        .padding(.horizontal, 14)
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                        .background(step == index + 1 ? Color(red: 247 / 255, green: 242 / 255, blue: 255 / 255) : Color.white)
                        .overlay(alignment: .trailing) {
                            if index < steps.count - 1 { Rectangle().fill(ForgeDesign.divider).frame(width: 1.5) }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            ScrollView {
                Group {
                    switch step {
                    case 1: stepConnect
                    case 2: stepRepo
                    case 3: stepLeash
                    default: stepFirstTask
                    }
                }
                .padding(24)
            }
            .frame(maxHeight: .infinity)
            .background(ForgeDesign.paper)

            HStack {
                Button("skip setup") { finish() }
                    .font(ForgeDesign.mono(9.5))
                    .foregroundStyle(ForgeDesign.muted)
                    .buttonStyle(.plain)
                Spacer()
                if step > 1 {
                    Button("← BACK") { step -= 1 }
                        .font(ForgeDesign.mono(9.5, weight: .bold))
                        .foregroundStyle(ForgeDesign.ink)
                        .buttonStyle(.plain)
                }
                Button {
                    if step < 4 { step += 1 } else { planFirstTask() }
                } label: {
                    Text(step < 4 ? "NEXT →" : "▸ PLAN")
                        .font(ForgeDesign.mono(10.5, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(ForgeDesign.accent)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(ForgeDesign.ink)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 22)
            .frame(height: 54)
            .background(Color.white)
            .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
        }
        .frame(width: 720, height: 560)
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private var stepConnect: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading("STEP 1 — CONNECT GITHUB", "Your code stays yours.")
            VStack(spacing: 0) {
                scopeRow("repo:read", "plan against real code")
                scopeRow("branch:write", "forge/* only")
                scopeRow("pr:open", "its own PRs")
            }
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            Button {
                NotificationCenter.default.post(name: .forgeShowSignIn, object: nil)
            } label: {
                Text("⌥ CONNECT WITH GITHUB")
                    .font(ForgeDesign.mono(11, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(ForgeDesign.accent)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(ForgeDesign.ink)
            }
            .buttonStyle(.plain)
        }
    }

    private var stepRepo: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading("STEP 2 — PICK A REPO", "Start with one repo.")
            Text("Repos you don't enable are invisible to the agent — not even read. Add more later.")
                .font(ForgeDesign.mono(10))
                .foregroundStyle(ForgeDesign.muted)
            VStack(spacing: 0) {
                if workspace.missionControlRepositories.isEmpty {
                    repoRow(name: "Connect a local repository", detail: "opens the native picker", enabled: false)
                        .onTapGesture { workspace.connectRepository() }
                } else {
                    ForEach(workspace.missionControlRepositories, id: \.path) { repo in
                        repoRow(name: repo.name, detail: repo.path.split(separator: "/").suffix(1).joined(), enabled: true)
                    }
                }
            }
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            Text("▸ repos with tests get the most out of Forge — it runs them after every step")
                .font(ForgeDesign.mono(9.5))
                .foregroundStyle(ForgeDesign.dashedBorder)
        }
    }

    private var stepLeash: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading("STEP 3 — SET THE LEASH", "The agent works, you decide.")
            Text("Defaults are conservative. Loosen them per-task when you trust the pattern.")
                .font(ForgeDesign.mono(10))
                .foregroundStyle(ForgeDesign.muted)
            VStack(spacing: 0) {
                leashRow("Plan approval before any code", value: "ALWAYS")
                leashRow("Branch-only writes (forge/*)", value: "LOCKED")
                leashRow("Monthly budget cap", value: "$\(monthlyBudgetCap)")
                leashRow("Self-fix attempts before stopping", value: "2")
            }
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        }
    }

    private var stepFirstTask: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading("STEP 4 — FIRST TASK", "Give it something real.")
            Text("Small and annoying beats big and vague. Pick one, or type your own.")
                .font(ForgeDesign.mono(10))
                .foregroundStyle(ForgeDesign.muted)
            VStack(spacing: 8) {
                suggestion("Fix the flakiest test in the suite")
                suggestion("Add input validation to the signup endpoint")
                suggestion("Upgrade eslint and fix what breaks")
            }
            TextField("or describe your own…", text: $firstTask)
                .textFieldStyle(.plain)
                .font(ForgeDesign.mono(12))
                .padding(.horizontal, 14)
                .frame(height: 44)
                .background(Color.white)
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                .onSubmit(planFirstTask)
        }
    }

    private func heading(_ label: String, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(ForgeDesign.mono(9, weight: .bold))
                .tracking(1)
                .foregroundStyle(ForgeDesign.muted)
            Text(title)
                .font(.system(size: 20, weight: .heavy))
                .tracking(-0.4)
        }
    }

    private func scopeRow(_ scope: String, _ hint: String) -> some View {
        HStack(spacing: 10) {
            Text("✓ \(scope)")
                .font(ForgeDesign.mono(11, weight: .bold))
                .foregroundStyle(ForgeDesign.accent)
            Text(hint)
                .font(ForgeDesign.mono(10))
                .foregroundStyle(ForgeDesign.muted)
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
    }

    private func repoRow(name: String, detail: String, enabled: Bool) -> some View {
        HStack(spacing: 10) {
            Text(name)
                .font(.system(size: 12.5, weight: .bold))
            Text(detail)
                .font(ForgeDesign.mono(9.5))
                .foregroundStyle(ForgeDesign.muted)
            Spacer()
            Text(enabled ? "ENABLED" : "SELECT")
                .font(ForgeDesign.mono(8.5, weight: .bold))
                .foregroundStyle(enabled ? ForgeDesign.ink : ForgeDesign.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(enabled ? ForgeDesign.accent : ForgeDesign.ink)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
    }

    private func leashRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12.5, weight: .semibold))
            Spacer()
            Text(value)
                .font(ForgeDesign.mono(10, weight: .bold))
                .foregroundStyle(ForgeDesign.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.divider).frame(height: 1.5) }
    }

    private func suggestion(_ text: String) -> some View {
        Button {
            firstTask = text
        } label: {
            HStack {
                Text("\u{201C}\(text)\u{201D}")
                    .font(ForgeDesign.mono(11))
                    .foregroundStyle(ForgeDesign.ink)
                Spacer()
                Text("USE")
                    .font(ForgeDesign.mono(8.5, weight: .bold))
                    .foregroundStyle(ForgeDesign.accent)
            }
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(Color.white)
            .overlay(Rectangle().stroke(firstTask == text ? ForgeDesign.ink : ForgeDesign.divider, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }

    private func planFirstTask() {
        let objective = firstTask.trimmingCharacters(in: .whitespacesAndNewlines)
        finish()
        guard !objective.isEmpty else { return }
        workspace.createTask(title: String(objective.prefix(60)), objective: objective)
    }

    private func finish() {
        UserDefaults.standard.set(true, forKey: "forge.hasCompletedOnboarding")
        close()
    }
}
