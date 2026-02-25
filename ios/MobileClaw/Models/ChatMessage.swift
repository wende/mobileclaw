import Foundation

// MARK: - Chat Message Types (matching types/chat.ts)

enum ContentPartType: String, Codable {
    case text
    case toolCall = "tool_call"
    case thinking
    case image
    case imageURL = "image_url"
    case file
}

struct ContentPart: Codable, Identifiable {
    var id: String { "\(type.rawValue)-\(name ?? "")-\(toolCallId ?? UUID().uuidString)" }

    let type: ContentPartType
    var text: String?
    var thinking: String?
    var name: String?
    var toolCallId: String?
    var arguments: String?
    var status: ToolCallStatus?
    var result: String?
    var resultError: Bool?
    var imageURL: ImageURLContent?
    var fileURL: String?
    var fileName: String?
    var fileMime: String?

    enum CodingKeys: String, CodingKey {
        case type, text, thinking, name, toolCallId, arguments, status, result, resultError
        case imageURL = "image_url"
        case fileURL = "file_url"
        case fileName = "file_name"
        case fileMime = "file_mime"
    }
}

struct ImageURLContent: Codable {
    let url: String?
}

enum ToolCallStatus: String, Codable {
    case running
    case success
    case error
}

enum MessageRole: String, Codable {
    case user
    case assistant
    case system
    case tool
    case toolResult
    case tool_result = "tool_result"
}

struct ChatMessage: Codable, Identifiable {
    var id: String { msgId ?? UUID().uuidString }

    let role: MessageRole
    var content: [ContentPart]
    var timestamp: Int?
    var msgId: String?
    var reasoning: String?
    var toolName: String?
    var isError: Bool?
    var stopReason: String?
    var isContext: Bool?
    var isCommandResponse: Bool?
    var isHidden: Bool?
    var thinkingDuration: Int?
    var runDuration: Int?

    enum CodingKeys: String, CodingKey {
        case role, content, timestamp
        case msgId = "id"
        case reasoning, toolName, isError, stopReason, isContext
        case isCommandResponse, isHidden, thinkingDuration, runDuration
    }
}

// MARK: - WebSocket Protocol Types

enum ConnectionState: String {
    case connecting
    case connected
    case disconnected
    case error
    case reconnecting
}

enum BackendMode: String, Codable {
    case openclaw
    case lmstudio
    case demo
}

struct ConnectionConfig {
    let mode: BackendMode
    let url: String
    let token: String?
    let model: String?
}

struct ModelChoice: Codable, Identifiable {
    let id: String
    let name: String
    let provider: String
    var contextWindow: Int?
    var reasoning: Bool?
}

// MARK: - WS Frame Types

struct WSRequest: Encodable {
    let type: String = "req"
    let id: String
    let method: String
    let params: [String: AnyCodable]?
}

struct ConnectChallengePayload: Decodable {
    let nonce: String
    let ts: Int?
}

struct ChatEventPayload: Decodable {
    let runId: String
    let sessionKey: String
    let state: String // delta, final, aborted, error
    let message: ChatEventMessage?
    let errorMessage: String?
}

struct ChatEventMessage: Decodable {
    let role: String
    let content: AnyCodable
    let timestamp: Int?
    let reasoning: String?
}

struct AgentEventPayload: Decodable {
    let runId: String
    let sessionKey: String
    let stream: String // lifecycle, content, tool, reasoning
    let data: [String: AnyCodable]
    let seq: Int?
    let ts: Int?
}

// MARK: - AnyCodable helper

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}
