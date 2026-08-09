#if DEBUG
import Foundation

@MainActor
extension WorkspaceModel {
    func installMissionControlRoutedActionDebugFixture(initialTab: String) {
        installMissionControlDebugFixture("review")
        missionControlDebugDetailTab = initialTab.lowercased() == "git" ? "git" : "commands"

        let route = MissionControlTaskRoute(
            repositoryPath: "/tmp/forge-ui-alpha",
            taskID: "ui-routed-actions"
        )
        missionControlTaskRoute = route
        missionControlRouteError = nil
        missionControlRouteEvidenceError = nil
        missionControlGitActionResult = nil

        var task = ForgeTask.sample
        task.id = route.taskID
        task.title = "Route background commands and Git review"
        task.objective = "Prove repository-scoped permission and Git action routing without switching the primary workspace."
        task.status = "Human Review"
        task.currentPhase = "Command Review"
        task.updatedAt = "2026-08-09T08:00:00Z"
        task.taskCommandRuns = [
            TaskCommandRun(
                id: "ui-command-failed",
                commandID: "runtime-npm-check",
                name: "Runtime type-check",
                command: "npm run check",
                kind: "ProjectCommand",
                riskLevel: "Medium",
                cwd: "runtime",
                presetID: "runtime-typescript",
                presetName: "Runtime TypeScript Checks",
                status: "Failed",
                outputSummary: "TypeScript reported one fixture error; reviewed self-fix is ready to rerun.",
                outputChunks: [],
                exitCode: 2,
                startedAt: "2026-08-09T07:55:00Z",
                endedAt: "2026-08-09T07:55:08Z"
            ),
            TaskCommandRun(
                id: "ui-command-running",
                commandID: "smoke-long-task-command",
                name: "Background checkpoint test",
                command: "node checkpoint-fixture.mjs",
                kind: "ProjectCommand",
                riskLevel: "Medium",
                cwd: "runtime",
                presetID: "smoke-task-commands",
                presetName: "Smoke Task Commands",
                status: "Running",
                outputSummary: "Checkpoint 3/5 · cancellation remains scoped to this runtime-owned child.",
                outputChunks: [],
                exitCode: nil,
                startedAt: "2026-08-09T07:59:00Z",
                endedAt: nil
            )
        ]
        task.commandRerunEvidence = [
            CommandRerunEvidence(
                id: "ui-rerun-ready",
                sourceTaskCommandRunID: "ui-command-failed",
                validationRepairBriefID: "ui-repair-brief",
                repairProposalID: "ui-repair-proposal",
                repairAppliedAt: "2026-08-09T07:58:00Z",
                rerunTaskCommandRunID: nil,
                commandID: "runtime-npm-check",
                commandName: "Runtime type-check",
                status: "Ready",
                summary: "Reviewed self-fix applied; rerun the original approved command ID.",
                createdAt: "2026-08-09T07:57:00Z",
                updatedAt: "2026-08-09T07:58:00Z"
            )
        ]
        task.validationRuns = [
            ValidationRun(
                id: "ui-validation-passed",
                trigger: "User",
                presetID: "forge-post-apply",
                presetName: "Forge Post-Apply Checks",
                presetSource: "BuiltIn",
                riskLevel: "Low",
                status: "Passed",
                summary: "3 built-in checks passed.",
                startedAt: "2026-08-09T07:50:00Z",
                endedAt: "2026-08-09T07:50:01Z",
                commands: []
            )
        ]
        missionControlRoutedTask = task

        let runtimeCheck = ValidationCommandDefinition(
            id: "runtime-npm-check",
            name: "Runtime type-check",
            command: "npm run check",
            kind: "ProjectCommand",
            riskLevel: "Medium",
            cwd: "runtime",
            executionMode: "spawn · shell:false",
            boundary: "Runtime-known command ID only; repository-local cwd; bounded output."
        )
        let swiftBuild = ValidationCommandDefinition(
            id: "macos-swift-build",
            name: "macOS SwiftPM build",
            command: "swift build",
            kind: "ProjectCommand",
            riskLevel: "Medium",
            cwd: nil,
            executionMode: "spawn · shell:false",
            boundary: "Runtime-known command ID only; no arbitrary shell input."
        )
        let approval = ValidationPermissionApproval(
            id: "ui-approval",
            decidedAt: "2026-08-09T07:54:00Z",
            summary: "Approved for this task from Mission Control."
        )
        let runtimePreset = ValidationPreset(
            id: "runtime-typescript",
            name: "Runtime TypeScript Checks",
            description: "Run repository-local TypeScript checks through the runtime catalog.",
            source: "BuiltIn",
            riskLevel: "Medium",
            requiresApproval: true,
            commands: [runtimeCheck]
        )
        let swiftPreset = ValidationPreset(
            id: "macos-swiftpm",
            name: "macOS SwiftPM Build",
            description: "Build the native Swift package after explicit task-level approval.",
            source: "BuiltIn",
            riskLevel: "Medium",
            requiresApproval: true,
            commands: [swiftBuild]
        )
        let validation = ValidationPermissionEnvelope(
            taskID: task.id,
            taskStatus: task.status,
            currentPhase: task.currentPhase,
            permissions: [
                ValidationPresetPermission(
                    preset: runtimePreset,
                    approvalState: "Approved",
                    executionState: "Ready",
                    canApprove: false,
                    canRun: true,
                    blockedReasons: [],
                    approval: approval,
                    lastRun: ValidationPermissionLastRun(
                        id: "ui-validation-passed",
                        status: "Passed",
                        summary: "Latest approved preset passed.",
                        startedAt: "2026-08-09T07:50:00Z",
                        endedAt: "2026-08-09T07:50:01Z"
                    )
                ),
                ValidationPresetPermission(
                    preset: swiftPreset,
                    approvalState: "NeedsApproval",
                    executionState: "NeedsApproval",
                    canApprove: true,
                    canRun: false,
                    blockedReasons: ["Preset requires task-level approval before execution."],
                    approval: nil,
                    lastRun: nil
                )
            ],
            taskCommands: [
                TaskCommandPermission(
                    command: runtimeCheck,
                    presetID: runtimePreset.id,
                    presetName: runtimePreset.name,
                    presetSource: runtimePreset.source,
                    presetRiskLevel: runtimePreset.riskLevel,
                    approvalState: "Approved",
                    executionState: "Ready",
                    canRun: true,
                    blockedReasons: [],
                    approval: approval,
                    lastRun: TaskCommandPermissionLastRun(
                        id: "ui-command-failed",
                        status: "Failed",
                        summary: "One fixture error; reviewed repair ready.",
                        startedAt: "2026-08-09T07:55:00Z",
                        endedAt: "2026-08-09T07:55:08Z"
                    )
                )
            ]
        )

        let change = GitFileChange(
            path: "Sources/BackgroundRouter.swift",
            status: "Modified",
            indexStatus: " ",
            worktreeStatus: "M",
            staged: false,
            unstaged: true,
            untracked: false,
            oldPath: nil,
            additions: 42,
            deletions: 6
        )
        let status = GitStatusSnapshot(
            isRepository: true,
            root: route.repositoryPath,
            branch: "forge/background-routing",
            upstream: nil,
            repositoryWebURL: nil,
            head: "abc123",
            ahead: 2,
            behind: 0,
            isDirty: true,
            summary: "1 changed file on forge/background-routing.",
            generatedAt: "2026-08-09T08:00:00Z",
            changedFiles: [change],
            error: nil
        )
        let related = GitCommitRelatedTask(
            id: task.id,
            title: task.title,
            status: task.status,
            currentPhase: task.currentPhase,
            summary: task.objective
        )
        let commit = GitCommitPreview(
            generatedAt: status.generatedAt,
            readiness: "NeedsReview",
            summary: "1 reviewed file can become one local commit after confirmation.",
            expectedHead: status.head,
            suggestedTitle: "Route background commands and Git review",
            suggestedBody: ["Keep repository identity and approval gates explicit."],
            includedFiles: [change],
            relatedTask: related,
            validationSummary: "Latest built-in validation passed; one command self-fix awaits rerun.",
            validationCommands: ["npm run check", "swift test"],
            preflight: nil,
            riskNotes: ["The file is unstaged; Forge will stage only the reviewed path."],
            blockers: [],
            operationBoundary: "Creates one local commit. Does not push or publish."
        )
        let branch = GitBranchPreview(
            generatedAt: status.generatedAt,
            readiness: "NeedsReview",
            summary: "Create forge/background-routing while carrying the reviewed working tree.",
            preflight: nil,
            expectedHead: status.head,
            currentBranch: "main",
            baseBranch: "main",
            targetBranch: "forge/background-routing",
            mode: "CreateBranch",
            branchExists: false,
            isDirty: true,
            changedFiles: [change],
            relatedTask: related,
            riskNotes: ["Uncommitted changes move with the new local branch."],
            blockers: [],
            operationBoundary: "Creates a local branch only."
        )
        let branchPublish = GitBranchPublishPreview(
            generatedAt: status.generatedAt,
            readiness: "Blocked",
            summary: "First publish is blocked until a remote is configured.",
            preflight: nil,
            expectedHead: status.head,
            branch: status.branch,
            baseBranch: "main",
            remote: nil,
            remoteBranch: status.branch,
            upstream: nil,
            isDirty: true,
            commitsToPublish: [],
            changedFiles: [change],
            relatedTask: related,
            riskNotes: [],
            blockers: ["No configured Git remote is available."],
            operationBoundary: "Would use non-force push and set upstream after review."
        )
        let push = GitPushPreview(
            generatedAt: status.generatedAt,
            readiness: "Blocked",
            summary: "Push is blocked because this branch has no upstream.",
            preflight: nil,
            expectedHead: status.head,
            branch: status.branch,
            upstream: nil,
            remote: nil,
            remoteBranch: nil,
            ahead: status.ahead,
            behind: status.behind,
            isDirty: status.isDirty,
            commitsToPush: [],
            changedFiles: [change],
            relatedTask: related,
            riskNotes: [],
            blockers: ["Current branch has no upstream."],
            operationBoundary: "Would push the current branch without force."
        )
        let pullRequest = GitPullRequestPreview(
            generatedAt: status.generatedAt,
            readiness: "Blocked",
            summary: "PR handoff remains read-only until branch publication and GitHub authorization.",
            preflight: nil,
            baseBranch: "main",
            headBranch: status.branch,
            head: status.head,
            upstream: nil,
            remote: nil,
            headRemote: nil,
            baseOwner: nil,
            baseRepository: nil,
            headOwner: nil,
            forkDetected: nil,
            forkSummary: nil,
            remoteBranch: nil,
            suggestedBranchName: "forge/background-routing",
            title: task.title,
            body: [task.objective],
            testPlan: ["npm run check", "swift test"],
            commits: [],
            changedFiles: [change],
            relatedTask: related,
            riskNotes: [],
            blockers: ["Publish the branch before preparing a pull request."],
            operationBoundary: "Review artifact only; no GitHub request was made."
        )

        missionControlRoutedEvidence = MissionControlRoutedEvidence(
            validation: validation,
            git: MissionControlGitReviewEvidence(
                status: status,
                commit: commit,
                branch: branch,
                branchPublish: branchPublish,
                push: push,
                pullRequest: pullRequest
            )
        )
        missionControlRoutedGitDiff = GitFileDiff(
            path: change.path,
            oldPath: nil,
            status: change.status,
            generatedAt: status.generatedAt,
            diff: "@@ -12,6 +12,16 @@\n+func routeApprovedCommand() async throws {\n+    try await supervisor.revalidateAuthorization()\n+    try await runtime.runKnownCommandID()\n+}\n",
            truncated: false,
            displayMode: "Text",
            unavailableReason: nil,
            byteCount: 196,
            lineCount: 5,
            appPreviewLineLimit: 800,
            summary: "Bounded background diff loaded from fixtures/alpha."
        )
    }
}
#endif
