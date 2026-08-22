import Foundation
import XCTest
@testable import ForgeApp

final class RuntimeClientTests: XCTestCase {
    func testHealthUsesInjectedSessionAndDecodesRuntimeContract() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(
                request,
                status: 200,
                body: """
                {"ok":true,"service":"forge-runtime","version":"0.1.0","uptimeSeconds":3.5}
                """
            )
        }
        defer { session.invalidateAndCancel() }

        let health = try await client.health()

        XCTAssertTrue(health.ok)
        XCTAssertEqual(health.service, "forge-runtime")
        XCTAssertEqual(health.uptimeSeconds, 3.5)
        XCTAssertEqual(recorder.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/health")
    }

    func testCreateTaskUsesPostJSONContractAndDecodesTask() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(request, status: 201, data: Self.taskResponseData())
        }
        defer { session.invalidateAndCancel() }

        let task = try await client.createTask(title: "Coverage", objective: "Test the client")

        XCTAssertEqual(task.id, "task-1")
        let request = try XCTUnwrap(recorder.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/tasks")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["title"] as? String, "Coverage")
        XCTAssertEqual(body["objective"] as? String, "Test the client")
    }

    func testTaskDetailUsesRepositoryScopedReadContract() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(request, status: 200, data: Self.taskResponseData())
        }
        defer { session.invalidateAndCancel() }

        let task = try await client.task(taskID: "task-1")

        XCTAssertEqual(task.id, "task-1")
        XCTAssertEqual(recorder.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1")
        XCTAssertNil(recorder.lastBody)
    }

    func testSupervisedQueueDispatchKeepsAuthorizationInPostBody() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(
                request,
                status: 202,
                body: """
                {
                  "accepted":true,"taskID":"task-1","reason":"dispatched",
                  "queue":{
                    "generatedAt":"2026-08-09T12:00:00Z","concurrencyLimit":2,
                    "effectiveRepositoryLimit":1,"running":[],"queued":[],
                    "needsAttention":[],"completed":[],"summary":"0 running",
                    "operationBoundary":"Supervisor grants only.","dispatchMode":"supervised"
                  }
                }
                """
            )
        }
        defer { session.invalidateAndCancel() }

        let result = try await client.dispatchNextQueuedAgentRun(authorizationID: "session-secret")

        XCTAssertTrue(result.accepted)
        XCTAssertEqual(result.taskID, "task-1")
        XCTAssertEqual(result.queue.dispatchMode, "supervised")
        XCTAssertEqual(recorder.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/queue/dispatch-next")
        XCTAssertNil(recorder.lastRequest?.url?.query)
        let body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["authorizationID"] as? String, "session-secret")
    }

    func testGitDiffPercentEncodesPathQuery() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(
                request,
                status: 200,
                body: """
                {
                  "path":"Sources/Feature A.swift","status":" M","generatedAt":"2026-07-31T12:00:00Z",
                  "diff":"@@ -1 +1 @@","truncated":false,"summary":"Text diff ready."
                }
                """
            )
        }
        defer { session.invalidateAndCancel() }

        let diff = try await client.gitFileDiff(path: "Sources/Feature A.swift")

        XCTAssertEqual(diff.path, "Sources/Feature A.swift")
        let components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(recorder.lastRequest?.url), resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.path, "/api/git/diff")
        XCTAssertEqual(components.queryItems, [URLQueryItem(name: "path", value: "Sources/Feature A.swift")])
    }

    func testAuditExportUsesReadOnlyFormatQueryAndDecodesFileEnvelope() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(
                request,
                status: 200,
                body: """
                {
                  "filename":"forge-task-task-1-audit.md",
                  "contentType":"text/markdown",
                  "content":"# Forge Task Audit",
                  "generatedAt":"2026-08-08T12:00:00Z",
                  "contentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "sourceTaskUpdatedAt":"2026-08-08T11:59:00Z",
                  "sourceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  "redactionSummary":"Known credential patterns are redacted."
                }
                """
            )
        }
        defer { session.invalidateAndCancel() }

        let export = try await client.taskAuditExport(taskID: "task-1", format: "markdown")

        XCTAssertEqual(export.filename, "forge-task-task-1-audit.md")
        XCTAssertEqual(export.content, "# Forge Task Audit")
        XCTAssertEqual(export.sourceTaskUpdatedAt, "2026-08-08T11:59:00Z")
        XCTAssertEqual(export.sourceSha256, String(repeating: "b", count: 64))
        let components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(recorder.lastRequest?.url), resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.path, "/api/tasks/task-1/audit-export")
        XCTAssertEqual(components.queryItems, [URLQueryItem(name: "format", value: "markdown")])
        XCTAssertEqual(recorder.lastRequest?.httpMethod, "GET")
    }

    func testHistoryRetentionPreviewAndPurgeKeepReceiptInPostBody() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            if request.httpMethod == "GET" {
                return Self.response(
                    request,
                    status: 200,
                    body: """
                    {
                      "policy":{"taskHistory":"KeepByDefault","automaticPurge":false,"supportedScopes":["CommandOutput"],"exportRequired":true},
                      "eligible":true,"taskID":"task-1","taskStatus":"Completed","taskUpdatedAt":"2026-08-08T11:59:00Z",
                      "commandRunsWithOutput":1,"commandOutputChunks":2,"validationCommandsWithOutput":1,
                      "removableBytes":1024,"priorPurges":0
                    }
                    """
                )
            }
            return Self.response(request, status: 409, body: #"{"error":"contract probe"}"#)
        }
        defer { session.invalidateAndCancel() }

        let preview = try await client.taskHistoryRetentionPreview(taskID: "task-1")
        XCTAssertTrue(preview.eligible)
        XCTAssertFalse(preview.policy.automaticPurge)
        XCTAssertEqual(preview.removableBytes, 1024)
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/history-retention-preview")
        XCTAssertEqual(recorder.lastRequest?.httpMethod, "GET")

        let receipt = TaskHistoryPurgeRequest.ExportReceipt(
            generatedAt: "2026-08-08T12:00:00Z",
            sourceTaskUpdatedAt: preview.taskUpdatedAt,
            sourceSha256: String(repeating: "a", count: 64)
        )
        _ = try? await client.purgeTaskHistory(
            taskID: "task-1",
            requestBody: .init(expectedUpdatedAt: preview.taskUpdatedAt, exportReceipt: receipt)
        )
        let request = try XCTUnwrap(recorder.lastRequest)
        XCTAssertEqual(request.url?.path, "/api/tasks/task-1/purge-history")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.httpMethod, "POST")
        let body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["confirmation"] as? String, "PurgeTaskHistory")
        XCTAssertEqual(body["expectedUpdatedAt"] as? String, preview.taskUpdatedAt)
        XCTAssertEqual(body["scope"] as? String, "CommandOutput")
        let exportReceipt = try XCTUnwrap(body["exportReceipt"] as? [String: Any])
        XCTAssertEqual(exportReceipt["sourceSha256"] as? String, String(repeating: "a", count: 64))
        XCTAssertEqual(exportReceipt["sourceTaskUpdatedAt"] as? String, preview.taskUpdatedAt)
    }

    func testWorkspaceHistoryPreviewExportAndPurgeUseVersionedReceiptContract() async throws {
        let recorder = RequestRecorder()
        let scopes = ["TaskEvents", "ToolCalls", "TaskMessages", "RepositoryIndexes"]
        let (client, session) = makeClient { request in
            recorder.record(request)
            switch (request.httpMethod, request.url?.path) {
            case ("GET", "/api/workspace/history-retention-preview"):
                return Self.response(request, status: 200, body: """
                {
                  "policy":{"id":"forge-workspace-retention","version":1,"history":"KeepByDefault","defaultDuration":"IndefiniteUntilExplicitPurge","automaticPurge":false,"exportRequired":true,"terminalTaskDataOnly":true,"repositoryIndexes":"RebuildableDerivedData","supportedScopes":["TaskEvents","ToolCalls","TaskMessages","RepositoryIndexes"]},
                  "scopes":["TaskEvents","ToolCalls","TaskMessages","RepositoryIndexes"],"eligible":true,
                  "taskCount":3,"terminalTaskCount":2,"nonterminalTaskCount":1,"removableRecords":12,
                  "preservedNonterminalRecords":4,"removableBytes":2048,
                  "scopePreviews":[{"scope":"TaskEvents","retainedRecords":5,"removableRecords":4,"preservedNonterminalRecords":1,"removableBytes":512,"exportMode":"FullEvidence"}],
                  "priorPurges":0
                }
                """)
            case ("GET", "/api/workspace/history-export"):
                return Self.response(request, status: 200, body: """
                {
                  "filename":"forge-workspace-history.json","contentType":"application/json","content":"{}\\n",
                  "generatedAt":"2026-08-22T12:00:00Z","policyID":"forge-workspace-retention","policyVersion":1,
                  "scopes":["TaskEvents","ToolCalls","TaskMessages","RepositoryIndexes"],
                  "sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "contentSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  "redactionSummary":"Known credentials are replaced.","recoveryBoundary":"Evidence export, not a restore bundle."
                }
                """)
            default:
                return Self.response(request, status: 200, body: """
                {
                  "receipt":{"id":"purge-1","policyID":"forge-workspace-retention","policyVersion":1,
                    "scopes":["TaskEvents","ToolCalls","TaskMessages","RepositoryIndexes"],
                    "exportedAt":"2026-08-22T12:00:00Z",
                    "exportSourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "exportContentSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "purgedAt":"2026-08-22T12:01:00Z","taskRecordsAffected":8,"indexRecordsAffected":4,
                    "recordsAffectedByScope":{"TaskEvents":4,"ToolCalls":2,"TaskMessages":2,"RepositoryIndexes":4},
                    "bytesRemoved":2048,"preservedNonterminalRecords":4,"summary":"Purged exported history."},
                  "changedTaskIDs":["task-1"],"repositoryIndexesCleared":true
                }
                """)
            }
        }
        defer { session.invalidateAndCancel() }

        let preview = try await client.workspaceHistoryRetentionPreview(scopes: scopes)
        XCTAssertEqual(preview.policy.version, 1)
        XCTAssertEqual(preview.preservedNonterminalRecords, 4)
        var components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(recorder.lastRequest?.url), resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.path, "/api/workspace/history-retention-preview")
        XCTAssertEqual(components.queryItems, [URLQueryItem(name: "scopes", value: scopes.joined(separator: ","))])

        let export = try await client.workspaceHistoryExport(scopes: scopes)
        XCTAssertEqual(export.policyID, preview.policy.id)
        XCTAssertEqual(export.contentSha256, String(repeating: "b", count: 64))
        components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(recorder.lastRequest?.url), resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.path, "/api/workspace/history-export")

        let receipt = WorkspaceHistoryPurgeRequest.ExportReceipt(
            generatedAt: export.generatedAt,
            policyID: export.policyID,
            policyVersion: export.policyVersion,
            scopes: export.scopes,
            sourceSha256: export.sourceSha256,
            contentSha256: export.contentSha256
        )
        let result = try await client.purgeWorkspaceHistory(
            requestBody: .init(policyVersion: export.policyVersion, scopes: export.scopes, exportReceipt: receipt)
        )
        XCTAssertTrue(result.repositoryIndexesCleared)
        let request = try XCTUnwrap(recorder.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/workspace/purge-history")
        XCTAssertNil(request.url?.query)
        let body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["confirmation"] as? String, "PurgeWorkspaceHistory")
        XCTAssertEqual(body["policyVersion"] as? Int, 1)
        XCTAssertEqual(body["scopes"] as? [String], scopes)
        let exportReceipt = try XCTUnwrap(body["exportReceipt"] as? [String: Any])
        XCTAssertEqual(exportReceipt["contentSha256"] as? String, export.contentSha256)
        XCTAssertEqual(exportReceipt["policyID"] as? String, export.policyID)
    }

    func testHTTPFailuresPreferJSONErrorThenPlainText() async throws {
        let (jsonClient, jsonSession) = makeClient { request in
            Self.response(request, status: 409, body: #"{"error":"  stale review  "}"#)
        }
        defer { jsonSession.invalidateAndCancel() }

        await assertHTTPError(from: jsonClient, status: 409, message: "stale review")

        let (textClient, textSession) = makeClient { request in
            Self.response(request, status: 503, body: " runtime unavailable \n")
        }
        defer { textSession.invalidateAndCancel() }

        await assertHTTPError(from: textClient, status: 503, message: "runtime unavailable")
    }

    func testNonHTTPResponseFailsClosed() async throws {
        let (client, session) = makeClient { request in
            let response = URLResponse(
                url: try XCTUnwrap(request.url),
                mimeType: "application/json",
                expectedContentLength: 2,
                textEncodingName: "utf-8"
            )
            return (response, Data("{}".utf8))
        }
        defer { session.invalidateAndCancel() }

        do {
            _ = try await client.health()
            XCTFail("Expected a non-HTTP response to fail closed.")
        } catch let error as RuntimeClientError {
            guard case .invalidResponse = error else {
                return XCTFail("Expected invalidResponse, got \(error).")
            }
        }
    }

    func testPullRequestTokenStaysInPostBodyAndOutOfURL() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(request, status: 401, body: #"{"error":"authentication failed"}"#)
        }
        defer { session.invalidateAndCancel() }

        let publish = GitPullRequestPublishRequest(
            taskID: "task-1",
            expectedHead: "abc123",
            expectedHeadBranch: "codex/tests",
            baseBranch: "main",
            headBranch: "codex/tests",
            title: "Add tests",
            body: "Test plan included.",
            draft: true,
            headOwner: "fork-owner",
            githubToken: "github-secret-token",
            confirmation: "PublishPullRequest"
        )

        do {
            _ = try await client.publishPullRequest(publish)
            XCTFail("Expected the mock authentication failure.")
        } catch let error as RuntimeClientError {
            guard case .httpStatus(401, _) = error else {
                return XCTFail("Expected HTTP 401, got \(error).")
            }
        }

        let request = try XCTUnwrap(recorder.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/git/pr-publish")
        XCTAssertNil(request.url?.query)
        XCTAssertFalse(request.url?.absoluteString.contains("github-secret-token") ?? true)
        let body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["githubToken"] as? String, "github-secret-token")
        XCTAssertEqual(body["headOwner"] as? String, "fork-owner")
        XCTAssertEqual(body["confirmation"] as? String, "PublishPullRequest")

        do {
            _ = try await client.pullRequestStatus(
                GitPullRequestStatusRequest(
                    taskID: "task-1",
                    githubToken: "github-refresh-token",
                    source: "Background"
                )
            )
            XCTFail("Expected the mock authentication failure.")
        } catch let error as RuntimeClientError {
            guard case .httpStatus(401, _) = error else {
                return XCTFail("Expected HTTP 401, got \(error).")
            }
        }
        let refreshRequest = try XCTUnwrap(recorder.lastRequest)
        XCTAssertEqual(refreshRequest.url?.path, "/api/git/pr-status")
        XCTAssertNil(refreshRequest.url?.query)
        XCTAssertFalse(refreshRequest.url?.absoluteString.contains("github-refresh-token") ?? true)
        let refreshBody = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(refreshBody["githubToken"] as? String, "github-refresh-token")
        XCTAssertEqual(refreshBody["source"] as? String, "Background")
    }

    func testReviewAndValidationActionsPreserveExplicitApprovalParameters() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(request, status: 200, data: Self.taskResponseData())
        }
        defer { session.invalidateAndCancel() }

        _ = try await client.approvePlanAndRun(
            taskID: "task-1",
            note: "Plan reviewed",
            preferredCommandID: "runtime-check",
            maxSteps: 4
        )
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/approve-plan-and-run")
        var body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["note"] as? String, "Plan reviewed")
        XCTAssertEqual(body["preferredCommandID"] as? String, "runtime-check")
        XCTAssertEqual(body["maxSteps"] as? Int, 4)

        _ = try await client.reviewEditProposalFile(
            taskID: "task-1",
            fileChangeID: "change-7",
            decision: "Approve",
            note: "Expected change"
        )
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/review-edit-proposal-file")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["fileChangeID"] as? String, "change-7")
        XCTAssertEqual(body["decision"] as? String, "Approve")
        XCTAssertEqual(body["note"] as? String, "Expected change")

        _ = try await client.applyEditProposal(taskID: "task-1", note: "Apply approved files")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/apply-edit-proposal")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["note"] as? String, "Apply approved files")

        _ = try await client.approveValidationPreset(
            taskID: "task-1",
            presetID: "swift-tests",
            note: "Approved command"
        )
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/approve-validation-preset")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["presetID"] as? String, "swift-tests")
        XCTAssertEqual(body["note"] as? String, "Approved command")
        XCTAssertEqual(body["scope"] as? String, "Task")
        XCTAssertEqual(body["durationSeconds"] as? Int, 3_600)

        _ = try await client.revokeValidationPresetApproval(
            taskID: "task-1",
            presetID: "swift-tests",
            note: "Stop future command starts"
        )
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/revoke-validation-preset-approval")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["presetID"] as? String, "swift-tests")
        XCTAssertEqual(body["note"] as? String, "Stop future command starts")

        _ = try await client.runValidation(taskID: "task-1", presetID: "swift-tests")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/run-validation")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["presetID"] as? String, "swift-tests")
    }

    func testAgentControlActionsEncodeLoopAndCommandIdentifiers() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(request, status: 200, data: Self.taskResponseData())
        }
        defer { session.invalidateAndCancel() }

        _ = try await client.runAgentLoop(
            taskID: "task-1",
            preferredCommandID: "runtime-check",
            maxSteps: 5
        )
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/run-agent-loop")
        var body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["preferredCommandID"] as? String, "runtime-check")
        XCTAssertEqual(body["maxSteps"] as? Int, 5)
        XCTAssertNil(body["resumeLoopID"])

        _ = try await client.pauseAgentLoop(taskID: "task-1", loopID: "loop-2", note: "Inspect output")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/pause-agent-loop")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["loopID"] as? String, "loop-2")
        XCTAssertEqual(body["note"] as? String, "Inspect output")

        _ = try await client.abortAgentLoop(taskID: "task-1", loopID: "loop-2", note: "Stop safely")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/abort-agent-loop")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["loopID"] as? String, "loop-2")
        XCTAssertEqual(body["note"] as? String, "Stop safely")

        _ = try await client.resumeAgentLoop(
            taskID: "task-1",
            loopID: "loop-2",
            preferredCommandID: "swift-tests",
            maxSteps: 3
        )
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/resume-agent-loop")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["resumeLoopID"] as? String, "loop-2")
        XCTAssertEqual(body["preferredCommandID"] as? String, "swift-tests")
        XCTAssertEqual(body["maxSteps"] as? Int, 3)

        _ = try await client.rerunRepairCommand(taskID: "task-1", commandRerunEvidenceID: "evidence-4")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/rerun-repair-command")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["commandRerunEvidenceID"] as? String, "evidence-4")

        _ = try await client.cancelTaskCommand(
            taskID: "task-1",
            taskCommandRunID: "run-6",
            note: "User cancelled"
        )
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/cancel-task-command")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["taskCommandRunID"] as? String, "run-6")
        XCTAssertEqual(body["note"] as? String, "User cancelled")

        _ = try await client.cancelTask(taskID: "task-1", note: "Stop all task work")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-1/cancel")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["note"] as? String, "Stop all task work")
    }

    func testBackgroundCommandAndGitReviewContractsStayRepositoryScoped() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(request, status: 503, body: #"{"error":"contract probe"}"#)
        }
        defer { session.invalidateAndCancel() }

        _ = try? await client.validationPermissions(taskID: "task-bg")
        XCTAssertEqual(recorder.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-bg/validation-permissions")

        _ = try? await client.runTaskCommand(taskID: "task-bg", commandID: "swift-tests")
        XCTAssertEqual(recorder.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/tasks/task-bg/run-task-command")
        var body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["commandID"] as? String, "swift-tests")

        _ = try? await client.gitCommitPreview(taskID: "task-bg")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/git/commit-preview")
        XCTAssertEqual(URLComponents(url: try XCTUnwrap(recorder.lastRequest?.url), resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "task-bg")

        _ = try? await client.gitBranchPreview(taskID: "task-bg", targetBranch: "forge/background")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/git/branch-preview")
        let branchItems = URLComponents(url: try XCTUnwrap(recorder.lastRequest?.url), resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(branchItems?.first(where: { $0.name == "taskID" })?.value, "task-bg")
        XCTAssertEqual(branchItems?.first(where: { $0.name == "targetBranch" })?.value, "forge/background")

        _ = try? await client.gitBranchPublishPreview(taskID: "task-bg")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/git/branch-publish-preview")

        _ = try? await client.gitPushPreview(taskID: "task-bg")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/git/push-preview")

        _ = try? await client.gitPullRequestPreview(taskID: "task-bg")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/git/pr-preview")

        _ = try? await client.createGitCommit(GitCreateCommitRequest(
            taskID: "task-bg",
            expectedHead: "abc123",
            title: "Background commit",
            body: [],
            paths: ["Sources/Worker.swift"],
            confirmation: "CreateLocalCommit"
        ))
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/git/commit")
        body = try jsonObject(try XCTUnwrap(recorder.lastBody))
        XCTAssertEqual(body["taskID"] as? String, "task-bg")
        XCTAssertEqual(body["confirmation"] as? String, "CreateLocalCommit")
    }

    func testValidationPermissionEnvelopeDecodesApprovalLifecycleEvidence() async throws {
        let (client, session) = makeClient { request in
            XCTAssertEqual(request.url?.path, "/api/tasks/task-1/validation-permissions")
            let json = """
            {
              "taskID":"task-1","taskStatus":"Human Review","currentPhase":"Command Review",
              "permissions":[{
                "preset":{"id":"swift-tests","name":"Swift tests","description":"Run checks.","source":"BuiltIn","riskLevel":"Medium","requiresApproval":true,"commands":[]},
                "approvalState":"Revoked","executionState":"NeedsApproval","canApprove":true,"canRevoke":false,"canRun":false,
                "blockedReasons":["Approval was revoked."],
                "approval":{"id":"approval-1","decidedAt":"2026-08-15T10:00:00Z","summary":"Approved.","scope":"Task","expiresAt":"2026-08-15T11:00:00Z","state":"Revoked","revokedAt":"2026-08-15T10:30:00Z","revocationID":"revocation-1","revocationNote":"Stop future starts"}
              }],
              "taskCommands":[],
              "approvalPolicy":{"defaultDurationSeconds":3600,"maxDurationSeconds":86400,"supportedDurationSeconds":[900,3600,14400,28800,86400],"scopes":[
                {"scope":"Task","grantable":true,"persistence":"TaskRecord","summary":"Bound to one task."},
                {"scope":"Repository","grantable":false,"persistence":"RepositoryRecord","summary":"Reserved."},
                {"scope":"Session","grantable":false,"persistence":"RuntimeMemory","summary":"Memory only."}
              ]}
            }
            """
            return Self.response(request, status: 200, data: Data(json.utf8))
        }
        defer { session.invalidateAndCancel() }

        let envelope = try await client.validationPermissions(taskID: "task-1")

        XCTAssertEqual(envelope.permissions.first?.approvalState, "Revoked")
        XCTAssertEqual(envelope.permissions.first?.canRevoke, false)
        XCTAssertEqual(envelope.permissions.first?.approval?.expiresAt, "2026-08-15T11:00:00Z")
        XCTAssertEqual(envelope.permissions.first?.approval?.revocationID, "revocation-1")
        XCTAssertEqual(envelope.approvalPolicy?.defaultDurationSeconds, 3_600)
        XCTAssertEqual(envelope.approvalPolicy?.scopes.map(\.scope), ["Task", "Repository", "Session"])
    }

    func testEventsUsesInjectedSessionAndParsesSSEFrames() async throws {
        let recorder = RequestRecorder()
        let (client, session) = makeClient { request in
            recorder.record(request)
            return Self.response(
                request,
                status: 200,
                body: "event: task.updated\r\ndata: {\"taskID\":\"task-1\"}\r\n\r\n"
            )
        }
        defer { session.invalidateAndCancel() }

        var received: [RuntimeStreamEvent] = []
        for try await event in client.events() {
            received.append(event)
        }

        XCTAssertEqual(received.count, 2)
        XCTAssertEqual(received[0], RuntimeStreamEvent(type: "stream.connected", data: ""))
        XCTAssertEqual(received[1], RuntimeStreamEvent(type: "task.updated", data: #"{"taskID":"task-1"}"#))
        XCTAssertEqual(recorder.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(recorder.lastRequest?.url?.path, "/api/events")
    }

    private func assertHTTPError(
        from client: RuntimeClient,
        status expectedStatus: Int,
        message expectedMessage: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            _ = try await client.health()
            XCTFail("Expected HTTP error.", file: file, line: line)
        } catch let error as RuntimeClientError {
            guard case .httpStatus(let status, let message) = error else {
                return XCTFail("Expected httpStatus, got \(error).", file: file, line: line)
            }
            XCTAssertEqual(status, expectedStatus, file: file, line: line)
            XCTAssertEqual(message, expectedMessage, file: file, line: line)
        } catch {
            XCTFail("Expected RuntimeClientError, got \(error).", file: file, line: line)
        }
    }

    private func makeClient(
        handler: @escaping MockURLProtocol.Handler
    ) -> (RuntimeClient, URLSession) {
        MockURLProtocol.install(handler)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = RuntimeClient(
            baseURL: URL(string: "https://forge.test/api")!,
            session: session
        )
        return (client, session)
    }

    private func jsonObject(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private static func response(
        _ request: URLRequest,
        status: Int,
        body: String
    ) -> (URLResponse, Data) {
        response(request, status: status, data: Data(body.utf8))
    }

    private static func response(
        _ request: URLRequest,
        status: Int,
        data: Data
    ) -> (URLResponse, Data) {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (response, data)
    }

    private static func taskResponseData() -> Data {
        Data(
            """
            {
              "id":"task-1","title":"Coverage","objective":"Test the client",
              "status":"Human Review","currentPhase":"Plan Review",
              "createdAt":"2026-07-31T12:00:00Z","updatedAt":"2026-07-31T12:01:00Z",
              "agentStates":[],"planSteps":[],"events":[],"approvals":[],"toolCalls":[],
              "agentRunLoops":[],"agentRunSteps":[],"taskCommandRuns":[],
              "commandRerunEvidence":[],"validationRuns":[],"validationRepairBriefs":[],
              "messages":[],"planRevisions":[],"editProposalRevisions":[],"contextFiles":[],
              "changedFiles":[],"queueRequest":null,"pullRequest":null
            }
            """.utf8
        )
    }
}

private final class RequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var request: URLRequest?
    private var body: Data?

    var lastRequest: URLRequest? {
        lock.withLock { request }
    }

    var lastBody: Data? {
        lock.withLock { body }
    }

    func record(_ request: URLRequest) {
        let capturedBody = request.httpBody ?? readBody(from: request.httpBodyStream)
        lock.withLock {
            self.request = request
            body = capturedBody
        }
    }

    private func readBody(from stream: InputStream?) -> Data? {
        guard let stream else { return nil }
        stream.open()
        defer { stream.close() }

        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4_096)
        defer { buffer.deallocate() }
        var data = Data()

        while true {
            let count = stream.read(buffer, maxLength: 4_096)
            if count < 0 { return nil }
            if count == 0 { return data }
            data.append(buffer, count: count)
        }
    }
}

private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) throws -> (URLResponse, Data)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: Handler?

    static func install(_ handler: @escaping Handler) {
        lock.withLock { self.handler = handler }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.lock.withLock({ Self.handler }) else {
            client?.urlProtocol(self, didFailWithError: RuntimeClientError.invalidResponse)
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
