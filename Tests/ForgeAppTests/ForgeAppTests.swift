import Foundation
import XCTest
@testable import ForgeApp

final class ForgeAppTests: XCTestCase {
    func testCoreRuntimePayloadsDecodeIntoSwiftModels() throws {
        let taskJSON = """
        {
          "id":"task-1","title":"Coverage","objective":"Add tests",
          "status":"Human Review","currentPhase":"Plan Review",
          "createdAt":"2026-07-31T12:00:00Z","updatedAt":"2026-07-31T12:01:00Z",
          "agentStates":[],"planSteps":[],"events":[],"approvals":[],"toolCalls":[],
          "agentRunLoops":[],"agentRunSteps":[],"taskCommandRuns":[],
          "commandRerunEvidence":[],"validationRuns":[],"validationRepairBriefs":[],
          "messages":[],"planRevisions":[],"editProposalRevisions":[],"contextFiles":[],
          "changedFiles":["runtime/src/taskStore.ts"],"reviewSummary":"Ready",
          "queueRequest":null,"pullRequest":null
        }
        """
        let task = try JSONDecoder().decode(ForgeTask.self, from: Data(taskJSON.utf8))
        XCTAssertEqual(task.id, "task-1")
        XCTAssertEqual(task.changedFiles, ["runtime/src/taskStore.ts"])
        XCTAssertNil(task.executionProposal)
        XCTAssertNil(task.editProposal)

        let healthJSON = """
        {
          "ok":true,"service":"forge-runtime","version":"0.1.0","uptimeSeconds":12.5,
          "runtimeMode":"observer","readOnly":true,
          "runtimeAuthorization":{"id":"auth-1","authorizedAt":"2026-07-31T12:00:00Z","scope":"repository-active"},
          "modelProvider":{"id":"local","name":"Local Deterministic","model":"local-deterministic-v0","mode":"local"},
          "workspace":{"runtimeDir":"/runtime","repoRoot":"/repo","repoRootSource":"FORGE_REPO_ROOT"},
          "persistence":{"databasePath":"/repo/.forge/forge.sqlite","taskCount":2},
          "index":{"fileCount":10,"lastIndexedAt":"2026-07-31T12:00:00Z","inSync":true}
        }
        """
        let health = try JSONDecoder().decode(RuntimeHealth.self, from: Data(healthJSON.utf8))
        XCTAssertTrue(health.ok)
        XCTAssertEqual(health.runtimeMode, "observer")
        XCTAssertEqual(health.runtimeAuthorization?.scope, "repository-active")
        XCTAssertEqual(health.workspace?.repoRoot, "/repo")
        XCTAssertEqual(health.persistence?.taskCount, 2)
        XCTAssertEqual(health.index?.fileCount, 10)
    }

    func testPullRequestStateLabelsAndPublishedResultBridge() throws {
        XCTAssertEqual(try pullRequest(state: "open", merged: false, draft: false).stateLabel, "OPEN")
        XCTAssertEqual(try pullRequest(state: "open", merged: false, draft: true).stateLabel, "DRAFT")
        XCTAssertEqual(try pullRequest(state: "closed", merged: false, draft: false).stateLabel, "CLOSED")
        XCTAssertEqual(try pullRequest(state: "closed", merged: true, draft: false).stateLabel, "MERGED")

        let result = GitPullRequestResult(
            generatedAt: "2026-07-31T12:00:00Z",
            number: 42,
            url: "https://github.com/acme/forge/pull/42",
            state: "open",
            draft: true,
            baseBranch: "main",
            headBranch: "codex/tests",
            title: "Add tests",
            remote: "origin",
            headRemote: "origin",
            headOwner: "contributor",
            forkDetected: true,
            owner: "acme",
            repo: "forge",
            pushedCommits: [],
            relatedTask: nil,
            summary: "Published draft pull request.",
            outputSummary: "Created #42.",
            operationBoundary: "No merge was attempted."
        )
        let bridged = TaskPullRequest(result: result)
        XCTAssertEqual(bridged.number, 42)
        XCTAssertEqual(bridged.stateLabel, "DRAFT")
        XCTAssertEqual(bridged.openedAt, result.generatedAt)
        XCTAssertEqual(bridged.lastCheckedAt, result.generatedAt)
        XCTAssertFalse(bridged.merged)
        XCTAssertEqual(bridged.headOwner, "contributor")
        XCTAssertEqual(bridged.headRemote, "origin")
        XCTAssertEqual(bridged.forkDetected, true)
        XCTAssertEqual(bridged.reviewLabel, "REVIEW UNKNOWN")
        XCTAssertEqual(bridged.checksLabel, "CHECKS UNKNOWN")

        let evidenceJSON = """
        {
          "number":42,"url":"https://github.com/acme/forge/pull/42",
          "state":"open","merged":false,"draft":false,
          "owner":"acme","repo":"forge","baseBranch":"main","headBranch":"codex/tests",
          "openedAt":"2026-07-31T12:00:00Z","lastCheckedAt":"2026-07-31T12:01:00Z",
          "mergeable":true,"mergeableState":"clean","reviewStatus":"Approved",
          "approvalCount":2,"changesRequestedCount":0,"requestedReviewerCount":0,
          "checksStatus":"Passing","checkRunCount":3,"passedCheckCount":3,
          "failedCheckCount":0,"pendingCheckCount":0,"skippedCheckCount":0,
          "headSha":"abc123","reviewSummary":"Review: approved by 2 reviewers.",
          "checksSummary":"Checks: 3 passed.",
          "refreshAttempts":[{
            "id":"refresh-1","source":"Background","status":"Succeeded",
            "startedAt":"2026-07-31T12:01:00Z","completedAt":"2026-07-31T12:01:01Z",
            "requestCount":3,"changed":true,"summary":"Review and checks changed."
          }]
        }
        """
        let evidence = try JSONDecoder().decode(TaskPullRequest.self, from: Data(evidenceJSON.utf8))
        XCTAssertEqual(evidence.reviewLabel, "REVIEW APPROVED")
        XCTAssertEqual(evidence.checksLabel, "CHECKS PASSING")
        XCTAssertEqual(evidence.approvalCount, 2)
        XCTAssertEqual(evidence.passedCheckCount, 3)
        XCTAssertEqual(evidence.mergeableState, "clean")
        XCTAssertEqual(evidence.refreshAttempts?.last?.source, "Background")
        XCTAssertEqual(evidence.refreshAttempts?.last?.requestCount, 3)
        XCTAssertEqual(evidence.refreshAttempts?.last?.changed, true)
    }

    func testModelProviderSettingsEncodingDistinguishesClearFromNoUpdate() throws {
        let clearing = UpdateModelProviderSettingsRequest(
            providerID: nil,
            modelName: nil,
            openAIBaseURL: nil,
            openAITimeoutMs: nil,
            openAIMaxOutputTokens: nil,
            openAIAPIKey: nil,
            clearOpenAIAPIKey: nil
        )
        let clearingJSON = try jsonObject(clearing)
        XCTAssertNil(clearingJSON["providerID"])
        XCTAssertEqual(clearingJSON["modelName"] as? NSNull, NSNull())
        XCTAssertEqual(clearingJSON["openAIBaseURL"] as? NSNull, NSNull())
        XCTAssertEqual(clearingJSON["openAITimeoutMs"] as? NSNull, NSNull())
        XCTAssertEqual(clearingJSON["openAIMaxOutputTokens"] as? NSNull, NSNull())
        XCTAssertNil(clearingJSON["openAIAPIKey"])
        XCTAssertNil(clearingJSON["clearOpenAIAPIKey"])

        let update = UpdateModelProviderSettingsRequest(
            providerID: "openai",
            modelName: "gpt-test",
            openAIBaseURL: "https://example.test/v1",
            openAITimeoutMs: 12_000,
            openAIMaxOutputTokens: 900,
            openAIAPIKey: "test-key",
            clearOpenAIAPIKey: false
        )
        let updateJSON = try jsonObject(update)
        XCTAssertEqual(updateJSON["providerID"] as? String, "openai")
        XCTAssertEqual(updateJSON["modelName"] as? String, "gpt-test")
        XCTAssertEqual(updateJSON["openAITimeoutMs"] as? Int, 12_000)
        XCTAssertEqual(updateJSON["openAIMaxOutputTokens"] as? Int, 900)
        XCTAssertEqual(updateJSON["openAIAPIKey"] as? String, "test-key")
        XCTAssertEqual(updateJSON["clearOpenAIAPIKey"] as? Bool, false)
    }

    @MainActor
    func testAppcastParsingCoversReleaseNotesAndFallbacks() {
        let xml = """
        <?xml version="1.0" encoding="utf-8"?>
        <rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
          <channel><item>
            <sparkle:releaseNotesLink>https://example.test/changelog</sparkle:releaseNotesLink>
            <description>
        NEW: Added coverage reporting
        FIX: Preserved review gates
        OTHER: Ignored
            </description>
            <enclosure sparkle:shortVersionString="1.2.3" length="1572864"
                       sparkle:edSignature="fixture-signature" />
          </item></channel>
        </rss>
        """
        let available = ForgeUpdater.parse(Data(xml.utf8))
        XCTAssertEqual(available?.version, "1.2.3")
        XCTAssertEqual(available?.sizeMB, 1.5)
        XCTAssertEqual(available?.changelogURL, "https://example.test/changelog")
        XCTAssertEqual(available?.signedNote, "update signature present · notarization not verified here")
        XCTAssertEqual(available?.updateSignaturePresent, true)
        XCTAssertEqual(available?.installEnabled, false)
        XCTAssertEqual(available?.notes.map(\.kind), ["NEW", "FIX"])
        XCTAssertEqual(available?.notes.map(\.text), ["Added coverage reporting", "Preserved review gates"])

        let fallbackXML = """
        <rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
          <channel><item><enclosure sparkle:version="7" length="invalid" /></item></channel>
        </rss>
        """
        let fallback = ForgeUpdater.parse(Data(fallbackXML.utf8))
        XCTAssertEqual(fallback?.version, "7")
        XCTAssertEqual(fallback?.sizeMB, 0)
        XCTAssertEqual(fallback?.changelogURL, "https://windorion.com/changelog")
        XCTAssertEqual(fallback?.signedNote, "unsigned placeholder feed · install disabled")
        XCTAssertEqual(fallback?.updateSignaturePresent, false)
        XCTAssertEqual(fallback?.installEnabled, false)
        XCTAssertNil(ForgeUpdater.parse(Data("<rss><channel /></rss>".utf8)))

        if let available {
            ForgeUpdater.shared.dismiss()
            ForgeUpdater.shared.download(available)
            XCTAssertEqual(
                ForgeUpdater.shared.state,
                .failed("Signed update download and installation are not connected yet.")
            )
            ForgeUpdater.shared.dismiss()
        }
    }

    func testRuntimeClientErrorsRemainActionable() {
        XCTAssertEqual(RuntimeClientError.invalidResponse.errorDescription, "Runtime returned an invalid response.")
        XCTAssertEqual(RuntimeClientError.httpStatus(409, "Stale review").errorDescription, "Runtime returned HTTP 409: Stale review")
        XCTAssertEqual(RuntimeClientError.httpStatus(500, nil).errorDescription, "Runtime returned HTTP 500.")
        XCTAssertEqual(RuntimeClientError.httpStatus(400, "").errorDescription, "Runtime returned HTTP 400.")
    }

    private func pullRequest(state: String, merged: Bool, draft: Bool) throws -> TaskPullRequest {
        let object: [String: Any] = [
            "number": 7,
            "url": "https://github.com/acme/forge/pull/7",
            "state": state,
            "merged": merged,
            "draft": draft,
            "owner": "acme",
            "repo": "forge",
            "baseBranch": "main",
            "headBranch": "codex/tests",
            "openedAt": "2026-07-31T12:00:00Z",
            "lastCheckedAt": "2026-07-31T12:01:00Z"
        ]
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return try JSONDecoder().decode(TaskPullRequest.self, from: data)
    }

    private func jsonObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
