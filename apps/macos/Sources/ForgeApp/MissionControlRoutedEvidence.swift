import Foundation

struct MissionControlGitReviewEvidence: Hashable {
    var status: GitStatusSnapshot
    var commit: GitCommitPreview
    var branch: GitBranchPreview
    var branchPublish: GitBranchPublishPreview
    var push: GitPushPreview
    var pullRequest: GitPullRequestPreview
}

struct MissionControlRoutedEvidence: Hashable {
    var validation: ValidationPermissionEnvelope
    var git: MissionControlGitReviewEvidence
}

enum MissionControlGitActionRequestFactory {
    static func commit(
        taskID: ForgeTask.ID,
        preview: GitCommitPreview
    ) throws -> GitCreateCommitRequest {
        guard let expectedHead = preview.expectedHead else {
            throw MissionControlGitActionRequestError.missingEvidence("expected Git HEAD")
        }
        let paths = preview.includedFiles.map(\.path)
        guard !paths.isEmpty else {
            throw MissionControlGitActionRequestError.missingEvidence("reviewed commit paths")
        }
        return GitCreateCommitRequest(
            taskID: taskID,
            expectedHead: expectedHead,
            title: preview.suggestedTitle,
            body: preview.suggestedBody,
            paths: paths,
            confirmation: "CreateLocalCommit"
        )
    }

    static func branch(
        taskID: ForgeTask.ID,
        preview: GitBranchPreview
    ) throws -> GitBranchRequest {
        guard let expectedHead = preview.expectedHead,
              let currentBranch = preview.currentBranch
        else {
            throw MissionControlGitActionRequestError.missingEvidence("current branch or expected Git HEAD")
        }
        return GitBranchRequest(
            taskID: taskID,
            expectedHead: expectedHead,
            expectedCurrentBranch: currentBranch,
            targetBranch: preview.targetBranch,
            mode: preview.mode,
            confirmation: preview.mode
        )
    }

    static func branchPublish(
        taskID: ForgeTask.ID,
        preview: GitBranchPublishPreview
    ) throws -> GitBranchPublishRequest {
        guard let expectedHead = preview.expectedHead,
              let branch = preview.branch,
              let remote = preview.remote,
              let remoteBranch = preview.remoteBranch
        else {
            throw MissionControlGitActionRequestError.missingEvidence("branch, remote, or expected Git HEAD")
        }
        return GitBranchPublishRequest(
            taskID: taskID,
            expectedHead: expectedHead,
            expectedBranch: branch,
            remote: remote,
            remoteBranch: remoteBranch,
            confirmation: "PublishCurrentBranch"
        )
    }

    static func push(
        taskID: ForgeTask.ID,
        preview: GitPushPreview
    ) throws -> GitPushRequest {
        guard let expectedHead = preview.expectedHead,
              let branch = preview.branch,
              let upstream = preview.upstream
        else {
            throw MissionControlGitActionRequestError.missingEvidence("branch, upstream, or expected Git HEAD")
        }
        return GitPushRequest(
            taskID: taskID,
            expectedHead: expectedHead,
            expectedBranch: branch,
            expectedUpstream: upstream,
            confirmation: "PushCurrentBranch"
        )
    }
}

enum MissionControlGitActionRequestError: LocalizedError, Equatable {
    case missingEvidence(String)

    var errorDescription: String? {
        switch self {
        case .missingEvidence(let value):
            return "The background Git review is missing \(value). Refresh the review before continuing."
        }
    }
}
