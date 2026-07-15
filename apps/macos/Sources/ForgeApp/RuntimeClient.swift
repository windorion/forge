import Foundation

struct RuntimeClient {
    var baseURL = URL(string: "http://127.0.0.1:17373")!

    func health() async throws -> RuntimeHealth {
        let url = baseURL.appending(path: "health")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response, data: data)
        return try JSONDecoder().decode(RuntimeHealth.self, from: data)
    }

    func listTasks() async throws -> [ForgeTask] {
        let url = baseURL.appending(path: "tasks")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response, data: data)
        let envelope = try JSONDecoder().decode(TaskListEnvelope.self, from: data)
        return envelope.tasks
    }

    func listValidationPresets() async throws -> ValidationPresetListEnvelope {
        let url = baseURL.appending(path: "validation-presets")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response, data: data)
        return try JSONDecoder().decode(ValidationPresetListEnvelope.self, from: data)
    }

    func gitStatus() async throws -> GitStatusSnapshot {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "status")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitStatusSnapshot.self, from: data)
    }

    func gitFileDiff(path: String) async throws -> GitFileDiff {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "diff")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "path", value: path)
        ]

        guard let requestURL = components?.url else {
            throw RuntimeClientError.invalidResponse
        }

        let (data, response) = try await URLSession.shared.data(from: requestURL)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitFileDiff.self, from: data)
    }

    func gitConflicts() async throws -> GitConflictSnapshot {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "conflicts")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitConflictSnapshot.self, from: data)
    }

    func resolveGitConflict(_ requestBody: GitConflictResolutionRequest) async throws -> GitConflictResolutionResult {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "conflicts")
            .appending(path: "resolve")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitConflictResolutionResult.self, from: data)
    }

    func gitCommitPreview(taskID: ForgeTask.ID?) async throws -> GitCommitPreview {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "commit-preview")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if let taskID {
            components?.queryItems = [
                URLQueryItem(name: "taskID", value: taskID)
            ]
        }

        guard let requestURL = components?.url else {
            throw RuntimeClientError.invalidResponse
        }

        let (data, response) = try await URLSession.shared.data(from: requestURL)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitCommitPreview.self, from: data)
    }

    func createGitCommit(_ requestBody: GitCreateCommitRequest) async throws -> GitCreateCommitResult {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "commit")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitCreateCommitResult.self, from: data)
    }

    func gitBranchPreview(taskID: ForgeTask.ID?, targetBranch: String? = nil) async throws -> GitBranchPreview {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "branch-preview")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var queryItems: [URLQueryItem] = []
        if let taskID {
            queryItems.append(URLQueryItem(name: "taskID", value: taskID))
        }
        if let targetBranch, !targetBranch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            queryItems.append(URLQueryItem(name: "targetBranch", value: targetBranch))
        }
        if !queryItems.isEmpty {
            components?.queryItems = queryItems
        }

        guard let requestURL = components?.url else {
            throw RuntimeClientError.invalidResponse
        }

        let (data, response) = try await URLSession.shared.data(from: requestURL)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitBranchPreview.self, from: data)
    }

    func createOrSwitchGitBranch(_ requestBody: GitBranchRequest) async throws -> GitBranchResult {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "branch")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitBranchResult.self, from: data)
    }

    func gitBranchPublishPreview(
        taskID: ForgeTask.ID?,
        remote: String? = nil,
        remoteBranch: String? = nil
    ) async throws -> GitBranchPublishPreview {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "branch-publish-preview")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var queryItems: [URLQueryItem] = []
        if let taskID {
            queryItems.append(URLQueryItem(name: "taskID", value: taskID))
        }
        if let remote, !remote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            queryItems.append(URLQueryItem(name: "remote", value: remote))
        }
        if let remoteBranch, !remoteBranch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            queryItems.append(URLQueryItem(name: "remoteBranch", value: remoteBranch))
        }
        if !queryItems.isEmpty {
            components?.queryItems = queryItems
        }

        guard let requestURL = components?.url else {
            throw RuntimeClientError.invalidResponse
        }

        let (data, response) = try await URLSession.shared.data(from: requestURL)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitBranchPublishPreview.self, from: data)
    }

    func publishGitBranch(_ requestBody: GitBranchPublishRequest) async throws -> GitBranchPublishResult {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "branch-publish")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitBranchPublishResult.self, from: data)
    }

    func gitPushPreview(taskID: ForgeTask.ID?) async throws -> GitPushPreview {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "push-preview")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if let taskID {
            components?.queryItems = [
                URLQueryItem(name: "taskID", value: taskID)
            ]
        }

        guard let requestURL = components?.url else {
            throw RuntimeClientError.invalidResponse
        }

        let (data, response) = try await URLSession.shared.data(from: requestURL)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitPushPreview.self, from: data)
    }

    func pushGitBranch(_ requestBody: GitPushRequest) async throws -> GitPushResult {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "push")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitPushResult.self, from: data)
    }

    func gitPullRequestPreview(taskID: ForgeTask.ID?) async throws -> GitPullRequestPreview {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "pr-preview")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if let taskID {
            components?.queryItems = [
                URLQueryItem(name: "taskID", value: taskID)
            ]
        }

        guard let requestURL = components?.url else {
            throw RuntimeClientError.invalidResponse
        }

        let (data, response) = try await URLSession.shared.data(from: requestURL)
        try validate(response, data: data)
        return try JSONDecoder().decode(GitPullRequestPreview.self, from: data)
    }

    func modelProviderSettings() async throws -> ModelProviderSettingsEnvelope {
        let url = baseURL
            .appending(path: "settings")
            .appending(path: "model-provider")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response, data: data)
        return try JSONDecoder().decode(ModelProviderSettingsEnvelope.self, from: data)
    }

    func updateModelProviderSettings(_ update: UpdateModelProviderSettingsRequest) async throws -> ModelProviderSettingsEnvelope {
        let url = baseURL
            .appending(path: "settings")
            .appending(path: "model-provider")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(update)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ModelProviderSettingsEnvelope.self, from: data)
    }

    func validationPermissions(taskID: ForgeTask.ID) async throws -> ValidationPermissionEnvelope {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "validation-permissions")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response, data: data)
        return try JSONDecoder().decode(ValidationPermissionEnvelope.self, from: data)
    }

    func createTask(title: String, objective: String) async throws -> ForgeTask {
        let url = baseURL.appending(path: "tasks")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(CreateTaskRequest(title: title, objective: objective))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func sendTaskMessage(taskID: ForgeTask.ID, content: String) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "messages")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(CreateTaskMessageRequest(content: content))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func generatePlanRevision(taskID: ForgeTask.ID) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "generate-plan-revision")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func approvePlan(taskID: ForgeTask.ID, note: String? = nil) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "approve-plan")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(ApprovePlanRequest(note: note))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func approvePlanAndRun(
        taskID: ForgeTask.ID,
        note: String? = nil,
        preferredCommandID: String? = nil,
        maxSteps: Int? = 6
    ) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "approve-plan-and-run")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            ApprovePlanAndRunRequest(
                note: note,
                preferredCommandID: preferredCommandID,
                maxSteps: maxSteps
            )
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func generateEditProposal(taskID: ForgeTask.ID) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "generate-edit-proposal")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func reviseEditProposal(taskID: ForgeTask.ID) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "revise-edit-proposal")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func generateValidationRepairProposal(taskID: ForgeTask.ID) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "generate-validation-repair-proposal")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func validateEditProposal(taskID: ForgeTask.ID) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "validate-edit-proposal")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func reviewEditProposalFile(
        taskID: ForgeTask.ID,
        fileChangeID: String,
        decision: String,
        note: String? = nil
    ) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "review-edit-proposal-file")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            EditProposalFileReviewRequest(fileChangeID: fileChangeID, decision: decision, note: note)
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func applyEditProposal(taskID: ForgeTask.ID, note: String? = nil) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "apply-edit-proposal")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(EditProposalDecisionRequest(note: note))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func rollbackEditProposal(taskID: ForgeTask.ID, note: String? = nil) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "rollback-edit-proposal")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(EditProposalDecisionRequest(note: note))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func rejectEditProposal(taskID: ForgeTask.ID, note: String? = nil) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "reject-edit-proposal")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(EditProposalDecisionRequest(note: note))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func approveValidationPreset(
        taskID: ForgeTask.ID,
        presetID: ValidationPreset.ID,
        note: String? = nil
    ) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "approve-validation-preset")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(ApproveValidationPresetRequest(presetID: presetID, note: note))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func runValidation(taskID: ForgeTask.ID, presetID: ValidationPreset.ID? = nil) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "run-validation")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RunValidationRequest(presetID: presetID))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func runTaskCommand(taskID: ForgeTask.ID, commandID: String) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "run-task-command")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RunTaskCommandRequest(commandID: commandID))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func runAgentStep(taskID: ForgeTask.ID, preferredCommandID: String? = nil) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "run-agent-step")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RunAgentStepRequest(preferredCommandID: preferredCommandID))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func runAgentLoop(taskID: ForgeTask.ID, preferredCommandID: String? = nil, maxSteps: Int? = nil) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "run-agent-loop")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            RunAgentLoopRequest(preferredCommandID: preferredCommandID, maxSteps: maxSteps, resumeLoopID: nil)
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func pauseAgentLoop(taskID: ForgeTask.ID, loopID: AgentRunLoop.ID, note: String? = nil) async throws -> ForgeTask {
        try await controlAgentLoop(taskID: taskID, loopID: loopID, action: "pause-agent-loop", note: note)
    }

    func abortAgentLoop(taskID: ForgeTask.ID, loopID: AgentRunLoop.ID, note: String? = nil) async throws -> ForgeTask {
        try await controlAgentLoop(taskID: taskID, loopID: loopID, action: "abort-agent-loop", note: note)
    }

    func resumeAgentLoop(
        taskID: ForgeTask.ID,
        loopID: AgentRunLoop.ID,
        preferredCommandID: String? = nil,
        maxSteps: Int? = nil
    ) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "resume-agent-loop")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            RunAgentLoopRequest(preferredCommandID: preferredCommandID, maxSteps: maxSteps, resumeLoopID: loopID)
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    private func controlAgentLoop(
        taskID: ForgeTask.ID,
        loopID: AgentRunLoop.ID,
        action: String,
        note: String?
    ) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: action)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(AgentRunLoopControlRequest(loopID: loopID, note: note))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func rerunRepairCommand(
        taskID: ForgeTask.ID,
        commandRerunEvidenceID: CommandRerunEvidence.ID?
    ) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "rerun-repair-command")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            RerunRepairCommandRequest(commandRerunEvidenceID: commandRerunEvidenceID)
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func cancelTaskCommand(taskID: ForgeTask.ID, taskCommandRunID: TaskCommandRun.ID?, note: String? = nil) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "cancel-task-command")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(CancelTaskCommandRequest(taskCommandRunID: taskCommandRunID, note: note))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(ForgeTask.self, from: data)
    }

    func events() -> AsyncThrowingStream<RuntimeStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let streamTask = Task {
                do {
                    let url = baseURL.appending(path: "events")
                    let (bytes, response) = try await URLSession.shared.bytes(from: url)
                    try validate(response)
                    continuation.yield(RuntimeStreamEvent(type: "stream.connected", data: ""))

                    var eventType = "message"
                    var eventData = ""

                    for try await line in bytes.lines {
                        if line.hasPrefix("event: ") {
                            eventType = String(line.dropFirst("event: ".count))
                        } else if line.hasPrefix("data: ") {
                            eventData += String(line.dropFirst("data: ".count))
                        } else if line.isEmpty, !eventData.isEmpty {
                            continuation.yield(RuntimeStreamEvent(type: eventType, data: eventData))
                            eventType = "message"
                            eventData = ""
                        }
                    }

                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                streamTask.cancel()
            }
        }
    }

    private func validate(_ response: URLResponse, data: Data? = nil) throws {
        guard let http = response as? HTTPURLResponse else {
            throw RuntimeClientError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            throw RuntimeClientError.httpStatus(http.statusCode, responseMessage(from: data))
        }
    }

    private func responseMessage(from data: Data?) -> String? {
        guard let data, !data.isEmpty else {
            return nil
        }

        if let envelope = try? JSONDecoder().decode(RuntimeErrorEnvelope.self, from: data) {
            return envelope.error.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        return String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct TaskListEnvelope: Decodable {
    var tasks: [ForgeTask]
}

private struct RuntimeErrorEnvelope: Decodable {
    var error: String
}

struct ValidationPresetListEnvelope: Decodable {
    var presets: [ValidationPreset]
    var workspaceConfig: WorkspaceValidationPresetConfig
}

enum RuntimeClientError: LocalizedError {
    case invalidResponse
    case httpStatus(Int, String?)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Runtime returned an invalid response."
        case .httpStatus(let status, let message):
            if let message, !message.isEmpty {
                return "Runtime returned HTTP \(status): \(message)"
            }

            return "Runtime returned HTTP \(status)."
        }
    }
}
