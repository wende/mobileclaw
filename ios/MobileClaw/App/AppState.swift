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
    var isRefreshing = false
    var zenMode: Bool = UserDefaults.standard.bool(forKey: "zenMode") {
        didSet { UserDefaults.standard.set(zenMode, forKey: "zenMode") }
    }

    // Queued message
    var queuedMessage: QueuedMessage?

    // Quote
    var quoteText: String?

    // Subagent
    var pinnedSubagent: PinnedSubagent?

    // Session
    var sessionKey: String = "main"
    var sessionId: String?
    var sessions: [SessionInfo] = []
    var sessionsLoading = false
    var sessionSwitching = false

    // Scroll state — distance from bottom in points (drives input→pill morph)
    var scrollDistanceFromBottom: CGFloat = 0

    // Input draft — stored property so @Observable tracks changes in real time.
    // Persisted to UserDefaults via didSet so it survives app restarts.
    var inputDraft: String = UserDefaults.standard.string(forKey: "inputDraft") ?? "" {
        didSet { UserDefaults.standard.set(inputDraft, forKey: "inputDraft") }
    }
}

struct QueuedMessage {
    let text: String
    let attachments: [ImageAttachmentData]?
}

struct PinnedSubagent: Identifiable {
    let id: String
    let toolCallId: String?
    let childSessionKey: String?
    let taskName: String
    let model: String?

    init(toolCallId: String?, childSessionKey: String?, taskName: String, model: String? = nil) {
        self.id = toolCallId ?? UUID().uuidString
        self.toolCallId = toolCallId
        self.childSessionKey = childSessionKey
        self.taskName = taskName
        self.model = model
    }
}

struct ImageAttachmentData {
    let mimeType: String
    let fileName: String
    let data: Data
    let previewURL: URL?
}
