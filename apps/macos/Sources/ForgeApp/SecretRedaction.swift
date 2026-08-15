import Foundation

enum SecretRedaction {
    static let policyID = "forge-secret-redaction"
    static let policyVersion = 1
    static let replacement = "[REDACTED]"

    static func redact(_ value: String) -> String {
        var result = redactDirect(value)
        result = replaceEncodedCandidates(in: result, pattern: #"(?=[A-Za-z0-9_.~%-]*%[0-9A-Fa-f]{2})[A-Za-z0-9_.~%-]{12,}"#) { candidate in
            candidate.removingPercentEncoding
        }
        result = replaceEncodedCandidates(in: result, pattern: #"(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9+/=])"#) { candidate in
            Data(base64Encoded: candidate).flatMap { String(data: $0, encoding: .utf8) }
        }
        return result
    }

    private static func redactDirect(_ value: String) -> String {
        var result = value
        result = replacing(
            in: result,
            pattern: #"-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----"#,
            template: replacement
        )
        result = replacing(
            in: result,
            pattern: #"\b(Bearer|Basic)\s+(?!\[REDACTED\])([A-Za-z0-9._~+/\-]{8,}={0,2})"#,
            template: "$1 \(replacement)"
        )
        result = replacing(
            in: result,
            pattern: #"\b(?:github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{12,}|glpat-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16})\b"#,
            template: replacement
        )
        result = replacing(
            in: result,
            pattern: #"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"#,
            template: replacement
        )
        result = replacing(
            in: result,
            pattern: #"(https?://)([^\s/@]{4,})(@[^\s]+)"#,
            template: "$1\(replacement)$3"
        )
        result = replaceStructuredSecrets(in: result)
        return result
    }

    private static func replaceStructuredSecrets(in value: String) -> String {
        let key = #"(?:api[_-]?key|access[_-]?token|auth(?:orization)?[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret|session[_-]?token|github[_-]?token|openai[_-]?api[_-]?key)"#
        var result = replacingStructured(
            in: value,
            pattern: "((?:[\"']?\(key)[\"']?)\\s*[:=]\\s*)([\"'])([^\"'\\r\\n]{4,})\\2",
            valueCapture: 3
        )
        result = replacingStructured(
            in: result,
            pattern: "((?:[\"']?\(key)[\"']?)\\s*[:=]\\s*)(?![\"']|\\[REDACTED\\])([^\\s,;}\\]]{4,})",
            valueCapture: 2
        )
        return result
    }

    private static func replacingStructured(in value: String, pattern: String, valueCapture: Int) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return value }
        let source = value as NSString
        var result = value
        for match in regex.matches(in: value, range: NSRange(location: 0, length: source.length)).reversed() {
            let candidate = source.substring(with: match.range(at: valueCapture))
            guard shouldRedactAssignedValue(candidate) else { continue }
            let range = Range(match.range(at: valueCapture), in: result)!
            result.replaceSubrange(range, with: replacement)
        }
        return result
    }

    private static func shouldRedactAssignedValue(_ candidate: String) -> Bool {
        let normalized = candidate.trimmingCharacters(in: CharacterSet(charactersIn: "<> ")).lowercased()
        let safeValues: Set<String> = [
            "configured", "missing", "required", "optional", "present", "absent",
            "enabled", "disabled", "true", "false", "null", "none", "unknown",
            "placeholder", "example", "sample", "test", "redacted"
        ]
        if normalized == replacement.lowercased() || safeValues.contains(normalized) { return false }
        if candidate.range(of: #"^\$\{?[A-Z][A-Z0-9_]*\}?$"#, options: .regularExpression) != nil { return false }
        return candidate.count >= 8 || redactDirectToken(candidate) != candidate
    }

    private static func redactDirectToken(_ value: String) -> String {
        var result = value
        for pattern in [
            #"\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/\-]{8,}={0,2}"#,
            #"\b(?:github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{12,}|glpat-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16})\b"#,
            #"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"#,
            #"(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^\s,;]{8,}"#
        ] {
            result = replacing(in: result, pattern: pattern, template: replacement)
        }
        return result
    }

    private static func replaceEncodedCandidates(
        in value: String,
        pattern: String,
        decode: (String) -> String?
    ) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return value }
        let source = value as NSString
        var result = value
        for match in regex.matches(in: value, range: NSRange(location: 0, length: source.length)).reversed() {
            let candidate = source.substring(with: match.range)
            guard let decoded = decode(candidate), decoded.utf8.count <= 8_192 else { continue }
            let printable = decoded.unicodeScalars.filter { scalar in
                scalar.value == 9 || scalar.value == 10 || scalar.value == 13 || (32...126).contains(scalar.value)
            }.count
            guard !decoded.isEmpty, Double(printable) / Double(decoded.unicodeScalars.count) >= 0.85 else { continue }
            guard redactDirectToken(decoded) != decoded else { continue }
            let range = Range(match.range, in: result)!
            result.replaceSubrange(range, with: replacement)
        }
        return result
    }

    private static func replacing(in value: String, pattern: String, template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return value }
        return regex.stringByReplacingMatches(
            in: value,
            range: NSRange(location: 0, length: (value as NSString).length),
            withTemplate: template
        )
    }
}
