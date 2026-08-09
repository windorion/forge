import XCTest
@testable import ForgeApp

final class MissionControlGitActionRequestTests: XCTestCase {
    func testReviewedBackgroundGitEvidenceBuildsExactConfirmationRequests() throws {
        let commit = try decode(GitCommitPreview.self, from: Self.commitPreviewJSON)
        let branch = try decode(GitBranchPreview.self, from: Self.branchPreviewJSON)
        let publish = try decode(GitBranchPublishPreview.self, from: Self.branchPublishPreviewJSON)
        let push = try decode(GitPushPreview.self, from: Self.pushPreviewJSON)

        let commitRequest = try MissionControlGitActionRequestFactory.commit(taskID: "task-bg", preview: commit)
        XCTAssertEqual(commitRequest.taskID, "task-bg")
        XCTAssertEqual(commitRequest.expectedHead, "abc123")
        XCTAssertEqual(commitRequest.paths, ["Sources/Worker.swift"])
        XCTAssertEqual(commitRequest.confirmation, "CreateLocalCommit")

        let branchRequest = try MissionControlGitActionRequestFactory.branch(taskID: "task-bg", preview: branch)
        XCTAssertEqual(branchRequest.expectedCurrentBranch, "main")
        XCTAssertEqual(branchRequest.targetBranch, "forge/background-route")
        XCTAssertEqual(branchRequest.mode, "CreateBranch")
        XCTAssertEqual(branchRequest.confirmation, "CreateBranch")

        let publishRequest = try MissionControlGitActionRequestFactory.branchPublish(taskID: "task-bg", preview: publish)
        XCTAssertEqual(publishRequest.remote, "origin")
        XCTAssertEqual(publishRequest.remoteBranch, "forge/background-route")
        XCTAssertEqual(publishRequest.confirmation, "PublishCurrentBranch")

        let pushRequest = try MissionControlGitActionRequestFactory.push(taskID: "task-bg", preview: push)
        XCTAssertEqual(pushRequest.expectedBranch, "forge/background-route")
        XCTAssertEqual(pushRequest.expectedUpstream, "origin/forge/background-route")
        XCTAssertEqual(pushRequest.confirmation, "PushCurrentBranch")
    }

    func testMissingReviewedEvidenceFailsBeforeARepositoryMutationRequest() throws {
        var commit = try decode(GitCommitPreview.self, from: Self.commitPreviewJSON)
        commit.expectedHead = nil
        XCTAssertThrowsError(try MissionControlGitActionRequestFactory.commit(taskID: "task-bg", preview: commit)) {
            XCTAssertTrue($0.localizedDescription.contains("expected Git HEAD"))
        }

        var push = try decode(GitPushPreview.self, from: Self.pushPreviewJSON)
        push.upstream = nil
        XCTAssertThrowsError(try MissionControlGitActionRequestFactory.push(taskID: "task-bg", preview: push)) {
            XCTAssertTrue($0.localizedDescription.contains("upstream"))
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    private static let file = """
    {"path":"Sources/Worker.swift","status":"Modified","indexStatus":" ","worktreeStatus":"M","staged":false,"unstaged":true,"untracked":false,"additions":2,"deletions":1}
    """

    private static let relatedTask = """
    {"id":"task-bg","title":"Route background actions","status":"Human Review","currentPhase":"Review","summary":"Ready"}
    """

    private static let commitPreviewJSON = """
    {
      "generatedAt":"2026-08-09T00:00:00Z","readiness":"Ready","summary":"One reviewed file is ready.",
      "expectedHead":"abc123","suggestedTitle":"Route background actions","suggestedBody":["Validated locally."],
      "includedFiles":[\(file)],"relatedTask":\(relatedTask),"validationSummary":"Passed","validationCommands":["swift test"],
      "riskNotes":[],"blockers":[],"operationBoundary":"Creates one local commit and does not push."
    }
    """

    private static let branchPreviewJSON = """
    {
      "generatedAt":"2026-08-09T00:00:00Z","readiness":"Ready","summary":"Create the reviewed task branch.",
      "expectedHead":"abc123","currentBranch":"main","baseBranch":"main","targetBranch":"forge/background-route",
      "mode":"CreateBranch","branchExists":false,"isDirty":true,"changedFiles":[\(file)],"relatedTask":\(relatedTask),
      "riskNotes":[],"blockers":[],"operationBoundary":"Creates a local branch only."
    }
    """

    private static let branchPublishPreviewJSON = """
    {
      "generatedAt":"2026-08-09T00:00:00Z","readiness":"Ready","summary":"Publish the current task branch.",
      "expectedHead":"abc123","branch":"forge/background-route","baseBranch":"main","remote":"origin",
      "remoteBranch":"forge/background-route","isDirty":false,"commitsToPublish":[],"changedFiles":[],
      "relatedTask":\(relatedTask),"riskNotes":[],"blockers":[],"operationBoundary":"Pushes without force and sets upstream."
    }
    """

    private static let pushPreviewJSON = """
    {
      "generatedAt":"2026-08-09T00:00:00Z","readiness":"Ready","summary":"Push one reviewed commit.",
      "expectedHead":"abc123","branch":"forge/background-route","upstream":"origin/forge/background-route",
      "remote":"origin","remoteBranch":"forge/background-route","ahead":1,"behind":0,"isDirty":false,
      "commitsToPush":[],"changedFiles":[],"relatedTask":\(relatedTask),"riskNotes":[],"blockers":[],
      "operationBoundary":"Pushes the current branch without force."
    }
    """
}
