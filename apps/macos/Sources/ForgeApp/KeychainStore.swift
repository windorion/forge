import Foundation
import Security

enum KeychainStore {
    static let openAIAPIKeyAccount = "openai-api-key"

    private static var service: String {
        Bundle.main.bundleIdentifier ?? "com.windorion.forge"
    }

    static func readOpenAIAPIKey() throws -> String? {
        var query = baseQuery(account: openAIAPIKeyAccount)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess else {
            throw KeychainStoreError.keychainStatus(status)
        }

        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw KeychainStoreError.invalidData
        }

        return value
    }

    static func saveOpenAIAPIKey(_ value: String) throws {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            try deleteOpenAIAPIKey()
            return
        }

        let data = Data(trimmed.utf8)
        let query = baseQuery(account: openAIAPIKeyAccount)
        let updateAttributes: [String: Any] = [
            kSecValueData as String: data
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, updateAttributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }

        guard updateStatus == errSecItemNotFound else {
            throw KeychainStoreError.keychainStatus(updateStatus)
        }

        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainStoreError.keychainStatus(addStatus)
        }
    }

    static func deleteOpenAIAPIKey() throws {
        let status = SecItemDelete(baseQuery(account: openAIAPIKeyAccount) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return
        }

        throw KeychainStoreError.keychainStatus(status)
    }

    private static func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

enum KeychainStoreError: LocalizedError {
    case invalidData
    case keychainStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidData:
            return "Keychain returned unreadable data."
        case .keychainStatus(let status):
            return SecCopyErrorMessageString(status, nil) as String? ?? "Keychain returned status \(status)."
        }
    }
}
