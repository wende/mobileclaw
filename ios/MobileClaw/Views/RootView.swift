import SwiftUI
import SafariServices

struct RootView: View {
    @Environment(AppState.self) private var appState
    @State private var bridge = WebViewBridge()
    @State private var wsManager: WebSocketManager?
    @State private var protocol_: OpenClawProtocol?
    @State private var safariURL: URL?

    var body: some View {
        @Bindable var state = appState

        ZStack(alignment: .bottom) {
            ChatWebView(bridge: bridge)
                .ignoresSafeArea(.container)

            VStack(spacing: 0) {
                if let pinned = appState.pinnedSubagent {
                    NativeSubagentPanel(
                        taskName: pinned.taskName,
                        model: pinned.model,
                        onUnpin: { appState.pinnedSubagent = nil }
                    )
                }

                if let queued = appState.queuedMessage {
                    NativeQueuePill(
                        text: queued.text,
                        onDismiss: {
                            appState.inputDraft = queued.text
                            appState.queuedMessage = nil
                        }
                    )
                }

                NativeChatInput(
                    onSend: { text, attachments in handleSend(text: text, attachments: attachments) },
                    onAbort: { handleAbort() },
                    isRunActive: appState.isRunActive,
                    hasQueued: appState.queuedMessage != nil,
                    quoteText: $state.quoteText,
                    draft: $state.inputDraft
                )
            }
            .padding(.bottom, 4)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            NativeChatHeader(
                currentModel: appState.currentModel,
                connectionState: appState.connectionState,
                onOpenSetup: { appState.showSetup = true },
                onToggleTheme: { toggleTheme() }
            )
        }
        .sheet(isPresented: $state.showSetup) {
            NativeSetupDialog(
                onConnect: { config in
                    appState.showSetup = false
                    handleConnect(config: config)
                }
            )
        }
        .sheet(isPresented: $state.showCommands) {
            NativeCommandSheet(
                onSelect: { command in
                    appState.showCommands = false
                    appState.inputDraft = command + " "
                }
            )
        }
        .fullScreenCover(item: $state.lightboxURL) { url in
            NativeImageLightbox(url: url)
        }
        .sheet(item: $safariURL) { url in
            SafariView(url: url)
        }
        .onAppear {
            setupBridge()
            restoreConnection()
        }
    }

    // MARK: - Bridge Setup

    private func setupBridge() {
        bridge.onLinkTap = { url in
            safariURL = url
        }
        bridge.onImageTap = { url in
            appState.lightboxURL = url
        }
        bridge.onScrollPosition = { distance in
            // Could drive a scroll-to-bottom pill
        }
        bridge.onTextSelected = { text in
            appState.quoteText = text
        }
        bridge.onTextDeselected = {
            appState.quoteText = nil
        }
        bridge.onWebViewReady = {
            // WebView is initialized, send current theme
            let isDark = UITraitCollection.current.userInterfaceStyle == .dark
            bridge.send(.themeSet(theme: isDark ? "dark" : "light"))
            // Flush any history that arrived before WebView was ready
            protocol_?.flushPendingHistory()
        }
    }

    // MARK: - Connection

    private func restoreConnection() {
        guard let savedURL = UserDefaults.standard.string(forKey: "gateway-url"),
              !savedURL.isEmpty else {
            appState.showSetup = true
            return
        }
        let token = KeychainHelper.load(key: "gateway-token")
        let config = ConnectionConfig(mode: .openclaw, url: savedURL, token: token, model: nil)
        handleConnect(config: config)
    }

    private func handleConnect(config: ConnectionConfig) {
        appState.connectionError = nil

        // Save config
        UserDefaults.standard.set(config.url, forKey: "gateway-url")
        if let token = config.token {
            KeychainHelper.save(key: "gateway-token", value: token)
        }
        appState.gatewayURL = config.url
        appState.gatewayToken = config.token ?? ""

        let wsURL = toWSURL(config.url)
        print("[RootView] Connecting to: \(wsURL)")

        // Create protocol handler and connect
        let proto = OpenClawProtocol(bridge: bridge, appState: appState)
        protocol_ = proto

        let manager = WebSocketManager(
            url: wsURL,
            onMessage: { data in
                print("[RootView] WS message received: \(data.count) bytes")
                Task { @MainActor in
                    proto.handleMessage(data)
                }
            },
            onStateChange: { state in
                print("[RootView] Connection state: \(state)")
                Task { @MainActor in
                    appState.connectionState = state
                    bridge.send(.connectionState(state))
                }
            }
        )
        wsManager = manager
        proto.sendMessage = { msg in
            print("[RootView] Sending WS: \(String(msg.prefix(100)))")
            manager.send(msg)
        }
        proto.markEstablished = { manager.markEstablished() }
        proto.token = config.token

        manager.connect()
    }

    private func toWSURL(_ url: String) -> String {
        if url.hasPrefix("ws://") || url.hasPrefix("wss://") { return url }
        return url
            .replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "https://", with: "wss://")
    }

    // MARK: - Send

    private func handleSend(text: String, attachments: [ImageAttachmentData]?) {
        if appState.isRunActive {
            if appState.queuedMessage == nil {
                appState.queuedMessage = QueuedMessage(text: text, attachments: attachments)
            }
            return
        }

        guard let proto = protocol_ else { return }

        appState.isRunActive = true
        appState.isStreaming = true
        bridge.send(.thinkingShow)

        // Add optimistic user message
        let userMsg = ChatMessage(
            role: .user,
            content: [ContentPart(type: .text, text: text)],
            timestamp: Int(Date().timeIntervalSince1970 * 1000),
            msgId: "u-\(Int(Date().timeIntervalSince1970 * 1000))"
        )
        bridge.send(.messagesAppend(userMsg))

        proto.sendChatMessage(text: text)
    }

    private func handleAbort() {
        if let queued = appState.queuedMessage {
            appState.inputDraft = queued.text
            appState.queuedMessage = nil
        }
        protocol_?.sendAbort()
        appState.isRunActive = false
        appState.isStreaming = false
        bridge.send(.streamEnd)
    }

    // MARK: - Theme

    private func toggleTheme() {
        // Toggle between light and dark
        let isDark = UITraitCollection.current.userInterfaceStyle == .dark
        let newTheme = isDark ? "light" : "dark"
        bridge.send(.themeSet(theme: newTheme))
        // Note: To actually change the app's appearance, would need to override
        // UIWindow's overrideUserInterfaceStyle
    }
}

// MARK: - URL extension for Identifiable

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

// MARK: - Safari View

struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
