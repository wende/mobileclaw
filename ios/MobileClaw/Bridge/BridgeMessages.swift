import Foundation

// Messages sent from Swift → WebView (via evaluateJavaScript)
enum SwiftToWebMessage {
    // Kept: optimistic user message append (native input adds this before web sends)
    case messagesAppend(ChatMessage)

    // UI commands
    case themeSet(theme: String)
    case zenSet(enabled: Bool)
    case scrollToBottom

    // Identity signing response (Phase 0)
    case identitySignResponse(callbackId: String, deviceId: String, publicKey: String, signature: String, signedAt: Int, nonce: String)

    // Config bridge — tell web to open its own connection (Phase 1)
    case configConnection(mode: String, url: String, token: String?, model: String?)

    // Actions routed from native UI through web (Phase 3)
    case actionSend(text: String)
    case actionAbort
    case actionSwitchSession(key: String)

    func toJSON() -> String {
        var dict: [String: Any] = [:]

        switch self {
        case .messagesAppend(let message):
            dict["type"] = "messages:append"
            dict["payload"] = encodeMessage(message)

        case .themeSet(let theme):
            dict["type"] = "theme:set"
            dict["payload"] = ["theme": theme]
        case .zenSet(let enabled):
            dict["type"] = "zen:set"
            dict["payload"] = ["enabled": enabled]
        case .scrollToBottom:
            dict["type"] = "scroll:toBottom"

        case .identitySignResponse(let callbackId, let deviceId, let publicKey, let signature, let signedAt, let nonce):
            dict["type"] = "identity:signResponse"
            dict["payload"] = [
                "callbackId": callbackId,
                "deviceId": deviceId,
                "publicKey": publicKey,
                "signature": signature,
                "signedAt": signedAt,
                "nonce": nonce,
            ]

        case .configConnection(let mode, let url, let token, let model):
            dict["type"] = "config:connection"
            var payload: [String: Any] = ["mode": mode, "url": url]
            if let token { payload["token"] = token }
            if let model { payload["model"] = model }
            dict["payload"] = payload

        case .actionSend(let text):
            dict["type"] = "action:send"
            dict["payload"] = ["text": text]

        case .actionAbort:
            dict["type"] = "action:abort"

        case .actionSwitchSession(let key):
            dict["type"] = "action:switchSession"
            dict["payload"] = ["key": key]
        }

        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let json = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return json
    }

    private func encodeMessage(_ msg: ChatMessage) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(msg),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return dict
    }
}
