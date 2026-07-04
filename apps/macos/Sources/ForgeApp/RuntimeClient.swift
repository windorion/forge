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

    func runValidation(taskID: ForgeTask.ID) async throws -> ForgeTask {
        let url = baseURL
            .appending(path: "tasks")
            .appending(path: taskID)
            .appending(path: "run-validation")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)

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
