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
    let id: String
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

    init(type: ContentPartType, text: String? = nil, thinking: String? = nil,
         name: String? = nil, toolCallId: String? = nil, arguments: String? = nil,
         status: ToolCallStatus? = nil, result: String? = nil, resultError: Bool? = nil,
         imageURL: ImageURLContent? = nil, fileURL: String? = nil,
         fileName: String? = nil, fileMime: String? = nil) {
        self.id = toolCallId ?? "\(type.rawValue)-\(name ?? "")-\(UUID().uuidString)"
        self.type = type
        self.text = text
        self.thinking = thinking
        self.name = name
        self.toolCallId = toolCallId
        self.arguments = arguments
        self.status = status
        self.result = result
        self.resultError = resultError
        self.imageURL = imageURL
        self.fileURL = fileURL
        self.fileName = fileName
        self.fileMime = fileMime
    }

    enum CodingKeys: String, CodingKey {
        case type, text, thinking, name, toolCallId, arguments, status, result, resultError
        case imageURL = "image_url"
        case fileURL = "file_url"
        case fileName = "file_name"
        case fileMime = "file_mime"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(ContentPartType.self, forKey: .type)
        text = try c.decodeIfPresent(String.self, forKey: .text)
        thinking = try c.decodeIfPresent(String.self, forKey: .thinking)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        toolCallId = try c.decodeIfPresent(String.self, forKey: .toolCallId)
        arguments = try c.decodeIfPresent(String.self, forKey: .arguments)
        status = try c.decodeIfPresent(ToolCallStatus.self, forKey: .status)
        result = try c.decodeIfPresent(String.self, forKey: .result)
        resultError = try c.decodeIfPresent(Bool.self, forKey: .resultError)
        imageURL = try c.decodeIfPresent(ImageURLContent.self, forKey: .imageURL)
        fileURL = try c.decodeIfPresent(String.self, forKey: .fileURL)
        fileName = try c.decodeIfPresent(String.self, forKey: .fileName)
        fileMime = try c.decodeIfPresent(String.self, forKey: .fileMime)
        id = toolCallId ?? "\(type.rawValue)-\(name ?? "")-\(UUID().uuidString)"
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
    case tool_result = "tool_result"
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let role: MessageRole
    var content: [ContentPart]
    var timestamp: Int?
    var reasoning: String?
    var toolName: String?
    var isError: Bool?
    var stopReason: String?
    var isContext: Bool?
    var isCommandResponse: Bool?
    var isHidden: Bool?
    var thinkingDuration: Int?
    var runDuration: Int?

    init(role: MessageRole, content: [ContentPart], timestamp: Int? = nil,
         msgId: String? = nil, reasoning: String? = nil, toolName: String? = nil,
         isError: Bool? = nil, stopReason: String? = nil, isContext: Bool? = nil,
         isCommandResponse: Bool? = nil, isHidden: Bool? = nil,
         thinkingDuration: Int? = nil, runDuration: Int? = nil) {
        self.id = msgId ?? UUID().uuidString
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.reasoning = reasoning
        self.toolName = toolName
        self.isError = isError
        self.stopReason = stopReason
        self.isContext = isContext
        self.isCommandResponse = isCommandResponse
        self.isHidden = isHidden
        self.thinkingDuration = thinkingDuration
        self.runDuration = runDuration
    }

    enum CodingKeys: String, CodingKey {
        case role, content, timestamp
        case id
        case reasoning, toolName, isError, stopReason, isContext
        case isCommandResponse, isHidden, thinkingDuration, runDuration
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = try c.decode(MessageRole.self, forKey: .role)
        content = try c.decode([ContentPart].self, forKey: .content)
        timestamp = try c.decodeIfPresent(Int.self, forKey: .timestamp)
        let decodedId = try c.decodeIfPresent(String.self, forKey: .id)
        id = decodedId ?? UUID().uuidString
        reasoning = try c.decodeIfPresent(String.self, forKey: .reasoning)
        toolName = try c.decodeIfPresent(String.self, forKey: .toolName)
        isError = try c.decodeIfPresent(Bool.self, forKey: .isError)
        stopReason = try c.decodeIfPresent(String.self, forKey: .stopReason)
        isContext = try c.decodeIfPresent(Bool.self, forKey: .isContext)
        isCommandResponse = try c.decodeIfPresent(Bool.self, forKey: .isCommandResponse)
        isHidden = try c.decodeIfPresent(Bool.self, forKey: .isHidden)
        thinkingDuration = try c.decodeIfPresent(Int.self, forKey: .thinkingDuration)
        runDuration = try c.decodeIfPresent(Int.self, forKey: .runDuration)
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

enum SessionKind: String, Codable, CaseIterable {
    case main
    case group
    case cron
    case hook
    case node
    case other

    init(rawValueOrFallback value: String?) {
        if let value, let parsed = SessionKind(rawValue: value) {
            self = parsed
        } else {
            self = .other
        }
    }
}

struct SessionInfo: Identifiable, Hashable {
    let key: String
    let kind: SessionKind
    let channel: String
    let displayName: String?
    let updatedAt: Int
    let sessionId: String?
    let model: String?
    let contextTokens: Int?
    let totalTokens: Int?

    var id: String { key }

    var name: String {
        if kind == .main { return "Main Session" }
        if let displayName, !displayName.isEmpty { return displayName }
        return SessionInfo.humanizeSessionKey(key)
    }

    var kindLabel: String {
        kind.rawValue
    }

    var relativeUpdatedAt: String {
        guard updatedAt > 0 else { return "" }
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let delta = max(0, now - updatedAt)
        if delta < 60_000 { return "just now" }
        let minutes = delta / 60_000
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        return "\(days)d ago"
    }

    static func humanizeSessionKey(_ key: String) -> String {
        let last = key.split(separator: "/").last.map(String.init) ?? key
        let normalized = last
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")
        let words = normalized.split(separator: " ").map(String.init)
        if words.isEmpty { return key }
        return words.map { word in
            guard let first = word.first else { return word }
            return first.uppercased() + word.dropFirst()
        }.joined(separator: " ")
    }
}
