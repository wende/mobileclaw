import Foundation
import Observation

@Observable
final class AppState {
    // Connection
    var connectionState: ConnectionState = .disconnected
    var backendMode: BackendMode = .openclaw
    var gatewayURL: String = ""
    var gatewayToken: String = ""
    var currentModel: String?
    var availableModels: [ModelChoice] = []
    var connectionError: String?

    // UI state
    var showSetup = false
    var showCommands = false
    var lightboxURL: URL?
    var isRunActive = false
    var isStreaming = false

    // Messages — stored here so Swift can forward to WebView
    var messages: [ChatMessage] = []
    var streamingRunId: String?

    // Queued message
    var queuedMessage: QueuedMessage?

    // Quote
    var quoteText: String?

    // Subagent
    var pinnedSubagent: PinnedSubagent?

    // Session
    var sessionKey: String = "main"
    var sessionId: String?

    // Input draft persistence
    var inputDraft: String {
        get { UserDefaults.standard.string(forKey: "inputDraft") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "inputDraft") }
    }
}

struct QueuedMessage {
    let text: String
    let attachments: [ImageAttachmentData]?
}

struct PinnedSubagent: Identifiable {
    var id: String { toolCallId ?? UUID().uuidString }
    let toolCallId: String?
    let childSessionKey: String?
    let taskName: String
    let model: String?
}

struct ImageAttachmentData {
    let mimeType: String
    let fileName: String
    let data: Data
    let previewURL: URL?
}
