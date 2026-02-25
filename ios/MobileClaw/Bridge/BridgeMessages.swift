import Foundation

// Messages sent from Swift → WebView (via evaluateJavaScript)
enum SwiftToWebMessage {
    case messagesHistory([ChatMessage])
    case messagesAppend(ChatMessage)
    case messagesUpdate(id: String, patch: [String: Any])
    case messagesClear
    case streamStart(runId: String, ts: Int)
    case streamContentDelta(runId: String, delta: String, ts: Int)
    case streamReasoningDelta(runId: String, delta: String, ts: Int)
    case streamToolStart(runId: String, name: String, args: String?, toolCallId: String?, ts: Int)
    case streamToolResult(runId: String, name: String, toolCallId: String?, result: String?, isError: Bool)
    case streamEnd
    case streamError(errorMessage: String)
    case thinkingShow
    case thinkingHide
    case themeSet(theme: String)
    case scrollToBottom
    case connectionState(ConnectionState)
    case subagentClear

    func toJSON() -> String {
        var dict: [String: Any] = [:]

        switch self {
        case .messagesHistory(let messages):
            dict["type"] = "messages:history"
            dict["payload"] = messages.map { encodeMessage($0) }
        case .messagesAppend(let message):
            dict["type"] = "messages:append"
            dict["payload"] = encodeMessage(message)
        case .messagesUpdate(let id, let patch):
            dict["type"] = "messages:update"
            dict["payload"] = ["id": id, "patch": patch]
        case .messagesClear:
            dict["type"] = "messages:clear"
        case .streamStart(let runId, let ts):
            dict["type"] = "stream:start"
            dict["payload"] = ["runId": runId, "ts": ts]
        case .streamContentDelta(let runId, let delta, let ts):
            dict["type"] = "stream:contentDelta"
            dict["payload"] = ["runId": runId, "delta": delta, "ts": ts]
        case .streamReasoningDelta(let runId, let delta, let ts):
            dict["type"] = "stream:reasoningDelta"
            dict["payload"] = ["runId": runId, "delta": delta, "ts": ts]
        case .streamToolStart(let runId, let name, let args, let toolCallId, let ts):
            var payload: [String: Any] = ["runId": runId, "name": name, "ts": ts]
            if let args { payload["args"] = args }
            if let toolCallId { payload["toolCallId"] = toolCallId }
            dict["type"] = "stream:toolStart"
            dict["payload"] = payload
        case .streamToolResult(let runId, let name, let toolCallId, let result, let isError):
            var payload: [String: Any] = ["runId": runId, "name": name, "isError": isError]
            if let toolCallId { payload["toolCallId"] = toolCallId }
            if let result { payload["result"] = result }
            dict["type"] = "stream:toolResult"
            dict["payload"] = payload
        case .streamEnd:
            dict["type"] = "stream:end"
        case .streamError(let errorMessage):
            dict["type"] = "stream:error"
            dict["payload"] = ["errorMessage": errorMessage]
        case .thinkingShow:
            dict["type"] = "thinking:show"
        case .thinkingHide:
            dict["type"] = "thinking:hide"
        case .themeSet(let theme):
            dict["type"] = "theme:set"
            dict["payload"] = ["theme": theme]
        case .scrollToBottom:
            dict["type"] = "scroll:toBottom"
        case .connectionState(let state):
            dict["type"] = "connection:state"
            dict["payload"] = ["state": state.rawValue]
        case .subagentClear:
            dict["type"] = "subagent:clear"
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

// Messages received from WebView → Swift (via WKScriptMessageHandler)
struct WebToSwiftMessage: Decodable {
    let type: String
    let payload: [String: AnyCodable]?
}
