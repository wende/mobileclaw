import Foundation
import CryptoKit

struct DeviceIdentity {
    let deviceId: String
    let publicKey: String   // base64url encoded
    let privateKey: String  // base64url encoded
}

enum DeviceIdentityManager {
    private static let keychainKey = "mobileclaw-device-private-key"

    static func loadOrCreate() -> DeviceIdentity {
        // Try to load existing key from Keychain
        if let existingKeyData = KeychainHelper.loadData(key: keychainKey),
           existingKeyData.count == 32,
           let privateKey = try? Curve25519.Signing.PrivateKey(rawRepresentation: existingKeyData) {
            let publicKeyBytes = privateKey.publicKey.rawRepresentation
            let deviceId = sha256Hex(publicKeyBytes)
            return DeviceIdentity(
                deviceId: deviceId,
                publicKey: base64URLEncode(publicKeyBytes),
                privateKey: base64URLEncode(existingKeyData)
            )
        }

        // Generate new keypair
        let privateKey = Curve25519.Signing.PrivateKey()
        let privateKeyData = privateKey.rawRepresentation
        let publicKeyBytes = privateKey.publicKey.rawRepresentation
        let deviceId = sha256Hex(publicKeyBytes)

        // Save to Keychain
        KeychainHelper.saveData(key: keychainKey, data: Data(privateKeyData))

        return DeviceIdentity(
            deviceId: deviceId,
            publicKey: base64URLEncode(publicKeyBytes),
            privateKey: base64URLEncode(Data(privateKeyData))
        )
    }

    static func signPayload(_ payload: String, privateKeyBase64URL: String) -> String {
        guard let keyData = base64URLDecode(privateKeyBase64URL) else {
            print("[DeviceIdentity] Failed to decode private key")
            return ""
        }

        do {
            let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: keyData)
            let data = Data(payload.utf8)
            let signature = try privateKey.signature(for: data)
            return base64URLEncode(signature)
        } catch {
            print("[DeviceIdentity] Signing failed: \(error)")
            return ""
        }
    }

    static func buildAuthPayload(
        deviceId: String,
        clientId: String,
        clientMode: String,
        role: String,
        scopes: [String],
        signedAtMs: Int,
        token: String?,
        nonce: String?
    ) -> String {
        let version = nonce != nil ? "v2" : "v1"
        var parts = [
            version,
            deviceId,
            clientId,
            clientMode,
            role,
            scopes.joined(separator: ","),
            String(signedAtMs),
            token ?? ""
        ]
        if version == "v2" {
            parts.append(nonce ?? "")
        }
        return parts.joined(separator: "|")
    }

    // MARK: - Helpers

    private static func sha256Hex(_ data: Data) -> String {
        let hash = SHA256.hash(data: data)
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private static func base64URLEncode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func base64URLDecode(_ input: String) -> Data? {
        var base64 = input
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: base64)
    }
}
