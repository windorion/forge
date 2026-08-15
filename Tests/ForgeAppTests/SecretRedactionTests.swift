import Foundation
import XCTest
@testable import ForgeApp

final class SecretRedactionTests: XCTestCase {
    func testKnownStructuredAndEncodedCredentialsAreRedacted() {
        let githubToken = ["ghp", "1234567890abcdefghijklmnop"].joined(separator: "_")
        let openAIToken = ["sk", "1234567890abcdefghijklmnop"].joined(separator: "-")
        let encoded = Data("access_token=\(githubToken)".utf8).base64EncodedString()
        let percentEncoded = "api_key=\(openAIToken)".addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        let input = [
            "Authorization: Bearer \(githubToken)",
            "password=correct-horse-battery-staple",
            "encoded=\(encoded)",
            "percent=\(percentEncoded)",
            "https://forge:database-password@example.test/path",
            "https://credential-username-value@example.test/token-userinfo"
        ].joined(separator: "\n")

        let redacted = SecretRedaction.redact(input)

        XCTAssertFalse(redacted.contains(githubToken))
        XCTAssertFalse(redacted.contains(openAIToken))
        XCTAssertFalse(redacted.contains("correct-horse-battery-staple"))
        XCTAssertFalse(redacted.contains("database-password"))
        XCTAssertFalse(redacted.contains("credential-username-value"))
        XCTAssertGreaterThanOrEqual(redacted.components(separatedBy: SecretRedaction.replacement).count - 1, 5)
        XCTAssertEqual(SecretRedaction.redact(redacted), redacted)
        XCTAssertEqual(SecretRedaction.policyVersion, 1)
    }

    func testConfigurationLanguageAndPublicIdentifiersAvoidFalsePositives() {
        let values = [
            "API key is configured through Settings.",
            "api_key=configured",
            "password=required",
            "secret sauce belongs in the recipe",
            "OPENAI_API_KEY=${OPENAI_API_KEY}",
            "OAuth Client ID Iv1.1234567890abcdef is public configuration.",
            "sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        ]

        for value in values {
            XCTAssertEqual(SecretRedaction.redact(value), value)
        }
    }

    @MainActor
    func testCopiedRuntimeDiagnosticsApplyTheSharedPolicy() {
        let suiteName = "SecretRedactionTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let token = ["ghp", "diagnosticfixture1234567890"].joined(separator: "_")
        let model = WorkspaceModel(userDefaults: defaults)
        model.runtimeProcessLastOutput = "child stderr: access_token=\(token)"
        model.runtimeLastError = "provider failed with Bearer \(token)"

        let diagnostics = model.runtimeDiagnosticsText()

        XCTAssertFalse(diagnostics.contains(token))
        XCTAssertTrue(diagnostics.contains("[REDACTED]"))
        XCTAssertTrue(diagnostics.contains("Secret redaction policy: forge-secret-redaction v1"))
    }
}
