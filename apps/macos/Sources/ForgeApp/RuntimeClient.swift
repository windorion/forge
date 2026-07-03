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
