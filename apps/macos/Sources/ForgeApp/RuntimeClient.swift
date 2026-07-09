import Foundation

struct RuntimeClient {
    var baseURL = URL(string: "http://127.0.0.1:17373")!

    func health() async throws -> RuntimeHealth {
        let url = baseURL.appending(path: "health")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response)
        return try JSONDecoder().decode(RuntimeHealth.self, from: data)
    }

    func listTasks() async throws -> [ForgeTask] {
        let url = baseURL.appending(path: "tasks")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response)
        let envelope = try JSONDecoder().decode(TaskListEnvelope.self, from: data)
        return envelope.tasks
    }

    func listValidationPresets() async throws -> ValidationPresetListEnvelope {
        let url = baseURL.appending(path: "validation-presets")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response)
        return try JSONDecoder().decode(ValidationPresetListEnvelope.self, from: data)
    }

    func gitStatus() async throws -> GitStatusSnapshot {
        let url = baseURL
            .appending(path: "git")
            .appending(path: "status")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response)
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
        try validate(response)
        return try JSONDecoder().decode(GitFileDiff.self, from: data)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
        return try JSONDecoder().decode(GitPullRequestPreview.self, from: data)
    }

    func modelProviderSettings() async throws -> ModelProviderSettingsEnvelope {
        let url = baseURL
            .appending(path: "settings")
            .appending(path: "model-provider")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response)
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
        try validate(response)
        return try JSONDecoder().decode(ModelProviderSettingsEnvelope.self, from: data)
    }

    func validationPermissions(taskID: ForgeTask.ID) async throws -> ValidationPermissionEnvelope {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "validation-permissions")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response)
        return try JSONDecoder().decode(ValidationPermissionEnvelope.self, from: data)
    }

    func createTask(title: String, objective: String) async throws -> ForgeTask {
        let url = baseURL.appending(path: "tasks")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(CreateTaskRequest(title: title, objective: objective))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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
        try validate(response)
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

    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw RuntimeClientError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            throw RuntimeClientError.httpStatus(http.statusCode)
        }
    }
}

private struct TaskListEnvelope: Decodable {
    var tasks: [ForgeTask]
}

struct ValidationPresetListEnvelope: Decodable {
    var presets: [ValidationPreset]
    var workspaceConfig: WorkspaceValidationPresetConfig
}

enum RuntimeClientError: LocalizedError {
    case invalidResponse
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Runtime returned an invalid response."
        case .httpStatus(let status):
            return "Runtime returned HTTP \(status)."
        }
    }
}
