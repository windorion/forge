import Foundation

// `forge` CLI companion (27a): light interactions against the same local
// runtime the app manages; heavy lifting (diff review, conflicts) deep-links
// back into Forge.app via the forge:// URL scheme.

let base = URL(string: ProcessInfo.processInfo.environment["FORGE_RUNTIME_URL"] ?? "http://127.0.0.1:17373")!

struct TaskEnvelope: Decodable { let tasks: [RemoteTask] }
struct RemoteTask: Decodable {
    struct Step: Decodable { let title: String; let status: String }
    struct Revision: Decodable {
        let id: String
        let steps: [Step]
        let estimatedMinutes: Int?
        let estimatedCostUSD: Double?
    }
    let id: String
    let title: String
    let status: String
    let currentPhase: String
    let planSteps: [Step]
    let planRevisions: [Revision]
}

enum Ansi {
    static let dim = "\u{1B}[2m"
    static let reset = "\u{1B}[0m"
    static let bold = "\u{1B}[1m"
    static let accent = "\u{1B}[38;5;141m"
    static let green = "\u{1B}[38;5;114m"
    static let yellow = "\u{1B}[38;5;221m"
    static let gray = "\u{1B}[38;5;245m"
}

func request(_ method: String, _ path: String, body: [String: Any]? = nil) throws -> Data {
    var req = URLRequest(url: base.appendingPathComponent(path))
    req.httpMethod = method
    if let body {
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<Data, Error> = .failure(URLError(.unknown))
    URLSession.shared.dataTask(with: req) { data, response, error in
        if let error {
            result = .failure(error)
        } else if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            let message = data.flatMap { String(data: $0, encoding: .utf8) } ?? "HTTP \(http.statusCode)"
            result = .failure(NSError(domain: "forge", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: message]))
        } else {
            result = .success(data ?? Data())
        }
        semaphore.signal()
    }.resume()
    semaphore.wait()
    return try result.get()
}

func fetchTasks() throws -> [RemoteTask] {
    try JSONDecoder().decode(TaskEnvelope.self, from: request("GET", "tasks")).tasks
}

func resolve(_ prefix: String) throws -> RemoteTask {
    let tasks = try fetchTasks()
    guard let match = tasks.first(where: { $0.id.hasPrefix(prefix) || $0.id.prefix(6).hasPrefix(prefix) }) else {
        fail("no task matches #\(prefix) — run `forge status`")
    }
    return match
}

func fail(_ message: String) -> Never {
    print("\(Ansi.yellow)✗\(Ansi.reset) \(message)")
    exit(1)
}

func statusGlyph(_ task: RemoteTask) -> String {
    switch task.status {
    case "Completed": return "\(Ansi.green)✓\(Ansi.reset)"
    case "Failed": return "\(Ansi.yellow)✗\(Ansi.reset)"
    case "Human Review": return "\(Ansi.yellow)⏸\(Ansi.reset)"
    default: return "\(Ansi.accent)▸\(Ansi.reset)"
    }
}

func statusLine(_ task: RemoteTask) -> String {
    let done = task.planSteps.filter { $0.status == "Done" }.count
    let total = max(task.planSteps.count, 1)
    let percent = Int(Double(done) / Double(total) * 100)
    let short = String(task.id.prefix(6))
    let title = task.title.count > 28 ? String(task.title.prefix(27)) + "…" : task.title
    let padded = title.padding(toLength: 30, withPad: " ", startingAt: 0)
    let detail: String
    switch task.status {
    case "Human Review" where task.currentPhase == "Plan Review":
        detail = "plan ready — run `forge answer \(short)` or approve in app"
    case "Human Review":
        detail = "needs you — run `forge answer \(short)`"
    case "Completed":
        detail = "done — run `forge review \(short)`"
    case "Failed":
        detail = "failed — open in app for recovery"
    default:
        detail = "\(task.status.lowercased()) · step \(min(done + 1, total))/\(total) · \(percent)%"
    }
    return "\(statusGlyph(task)) \(Ansi.accent)#\(short)\(Ansi.reset) \(padded) \(Ansi.gray)\(detail)\(Ansi.reset)"
}

func openInApp(_ task: RemoteTask, surface: String) {
    print("\(Ansi.gray)▸ opening \(surface) in Forge.app… (heavy lifting stays in the app)\(Ansi.reset)")
    let url = "forge://task/\(task.id)"
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = [url]
    try? process.run()
    process.waitUntilExit()
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard let command = arguments.first else {
    print("""
    \(Ansi.bold)forge\(Ansi.reset) — Forge CLI companion

      forge task "objective"   create a task, review the plan, y/n approve
      forge status             list tasks with live state
      forge answer <id> "…"    answer a waiting question / clarification
      forge review <id>        open diff review in Forge.app
      forge open <id>          open the task in Forge.app
    """)
    exit(0)
}

switch command {
case "task":
    guard arguments.count >= 2 else { fail("usage: forge task \"objective\"") }
    let objective = arguments[1]
    let repoData = try request("GET", "health")
    if let health = try JSONSerialization.jsonObject(with: repoData) as? [String: Any],
       let workspace = health["workspace"] as? [String: Any],
       let root = workspace["repoRoot"] as? String {
        let name = root.split(separator: "/").suffix(2).joined(separator: "/")
        print("\(Ansi.green)✔\(Ansi.reset) repo detected: \(name) \(Ansi.gray)(runtime workspace)\(Ansi.reset)")
    }
    let created = try request("POST", "tasks", body: ["title": String(objective.prefix(60)), "objective": objective])
    let task = try JSONDecoder().decode(RemoteTask.self, from: created)
    _ = try? request("POST", "tasks/\(task.id)/generate-plan-revision", body: [:])
    guard let refreshed = try? resolve(String(task.id.prefix(6))),
          let revision = refreshed.planRevisions.last else {
        print("\(Ansi.yellow)?\(Ansi.reset) plan needs clarification — run \(Ansi.bold)forge answer \(task.id.prefix(6)) \"…\"\(Ansi.reset) or open the app")
        exit(0)
    }
    let est = revision.estimatedMinutes.map { "~\($0)m" } ?? "—"
    let cost = revision.estimatedCostUSD.map { String(format: "~$%.2f", $0) } ?? "—"
    print("\(Ansi.green)✔\(Ansi.reset) plan ready — \(revision.steps.count) steps · est \(est) · \(cost)")
    print("  " + revision.steps.enumerated().map { "\($0.offset + 1). \($0.element.title)" }.joined(separator: "  "))
    print("\(Ansi.yellow)?\(Ansi.reset) approve & run? \(Ansi.accent)[y]\(Ansi.reset)es / \(Ansi.gray)[e]\(Ansi.reset)dit in app / \(Ansi.gray)[n]\(Ansi.reset)o ", terminator: "")
    let answer = readLine()?.lowercased() ?? "n"
    switch answer {
    case "y", "yes":
        do {
            _ = try request("POST", "tasks/\(task.id)/approve-plan-and-run", body: ["maxSteps": 6])
            print("\(Ansi.gray)▸ queued as \(Ansi.accent)#\(task.id.prefix(6))\(Ansi.gray) — running in background, you can close this shell\(Ansi.reset)")
        } catch {
            print("\(Ansi.yellow)?\(Ansi.reset) the plan still has open questions — run \(Ansi.bold)forge answer \(task.id.prefix(6)) \"…\"\(Ansi.reset) first, or press [e] next time to edit in app")
        }
    case "e", "edit":
        openInApp(task, surface: "plan review")
    default:
        print("\(Ansi.gray)▸ left as a draft plan — \(Ansi.reset)forge status\(Ansi.gray) to revisit\(Ansi.reset)")
    }

case "status":
    let tasks = try fetchTasks()
    if tasks.isEmpty { print("\(Ansi.gray)no tasks yet — forge task \"…\" to start one\(Ansi.reset)") }
    for task in tasks.sorted(by: { $0.id < $1.id }) {
        print(statusLine(task))
    }

case "answer":
    guard arguments.count >= 3 else { fail("usage: forge answer <id> \"reply\"") }
    let task = try resolve(arguments[1])
    _ = try request("POST", "tasks/\(task.id)/messages", body: ["content": arguments[2]])
    print("\(Ansi.green)✔\(Ansi.reset) answer sent to \(Ansi.accent)#\(task.id.prefix(6))\(Ansi.reset) — agent resumes from the gate")

case "review":
    guard arguments.count >= 2 else { fail("usage: forge review <id>") }
    let task = try resolve(arguments[1])
    openInApp(task, surface: "diff review")

case "open":
    guard arguments.count >= 2 else { fail("usage: forge open <id>") }
    let task = try resolve(arguments[1])
    openInApp(task, surface: "task")

default:
    fail("unknown command \(command) — run `forge` for help")
}
