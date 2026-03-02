import SwiftUI
import SafariServices

struct RootView: View {
    @Environment(AppState.self) private var appState
    @State private var bridge = WebViewBridge()
    @State private var wsManager: WebSocketManager?
    @State private var protocol_: OpenClawProtocol?
    @State private var demoHandler: DemoModeHandler?
    @State private var safariURL: URL?
    @State private var showSessionDropdown = false
    @State private var pullRefreshProgress: CGFloat = 0
    private let refreshHaptic = UIImpactFeedbackGenerator(style: .medium)

    private var currentSessionName: String {
        if let current = appState.sessions.first(where: { $0.key == appState.sessionKey }) {
            return current.name
        }
        if appState.sessionKey == "main" { return "Main Session" }
        return SessionInfo.humanizeSessionKey(appState.sessionKey)
    }

    var body: some View {
        @Bindable var state = appState
        let showPullIndicator = appState.isRefreshing || pullRefreshProgress > 0.01
        let indicatorOpacity = appState.isRefreshing ? 1 : Double(pullRefreshProgress)
        let indicatorScale = appState.isRefreshing ? 1 : (0.75 + pullRefreshProgress * 0.25)

        ZStack(alignment: .bottom) {
            ChatWebView(bridge: bridge, onRefresh: {
                refreshHaptic.impactOccurred()
                appState.isRefreshing = true
                pullRefreshProgress = 1
                if appState.backendMode == .demo {
                    demoHandler?.loadDemoHistory()
                } else {
                    protocol_?.requestHistory()
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    appState.isRefreshing = false
                    pullRefreshProgress = 0
                }
            }, onPullProgress: { progress in
                guard !appState.isRefreshing else { return }
                pullRefreshProgress = progress
            })
                .ignoresSafeArea(.container)

            // Top fade: blur + gradient below header
            VStack {
                ZStack {
                    FadingBlurView(direction: .topToBottom)
                    LinearGradient(
                        stops: [
                            .init(color: Color(.systemBackground), location: 0),
                            .init(color: Color(.systemBackground).opacity(0.5), location: 0.4),
                            .init(color: Color(.systemBackground).opacity(0), location: 1),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
                .frame(height: 180)
                Spacer()
            }
            .ignoresSafeArea(.container)
            .allowsHitTesting(false)

            // Bottom fade: blur + gradient above input
            VStack {
                Spacer()
                ZStack {
                    FadingBlurView(direction: .bottomToTop)
                    LinearGradient(
                        stops: [
                            .init(color: Color(.systemBackground).opacity(0), location: 0),
                            .init(color: Color(.systemBackground).opacity(0.5), location: 0.6),
                            .init(color: Color(.systemBackground), location: 1),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
                .frame(height: 80)
            }
            .ignoresSafeArea(.container)
            .allowsHitTesting(false)

            // Pull-to-refresh spinner
            if showPullIndicator {
                VStack {
                    Spacer()
                    ProgressView()
                        .tint(.secondary)
                        .scaleEffect(indicatorScale)
                        .opacity(indicatorOpacity)
                        .animation(.easeOut(duration: 0.12), value: pullRefreshProgress)
                        .animation(.easeOut(duration: 0.12), value: appState.isRefreshing)
                }
                .padding(.bottom, 140)
                .allowsHitTesting(false)
            }

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
                    onScrollToBottom: { bridge.send(.scrollToBottom) },
                    isRunActive: appState.isRunActive,
                    hasQueued: appState.queuedMessage != nil,
                    scrollDistance: appState.scrollDistanceFromBottom,
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
                backendMode: appState.backendMode,
                sessionName: currentSessionName,
                sessionSwitching: appState.sessionSwitching,
                isSessionDropdownOpen: showSessionDropdown,
                zenMode: appState.zenMode,
                onOpenSetup: {
                    showSessionDropdown = false
                    appState.showSetup = true
                },
                onToggleZenMode: {
                    appState.zenMode.toggle()
                    bridge.send(.zenSet(enabled: appState.zenMode))
                },
                onToggleSessionDropdown: {
                    guard appState.backendMode == .openclaw else { return }
                    showSessionDropdown.toggle()
                    if showSessionDropdown {
                        protocol_?.requestSessionsList()
                    }
                }
            )
        }
        .overlay {
            if showSessionDropdown && appState.backendMode == .openclaw {
                NativeSessionDropdown(
                    sessions: appState.sessions,
                    loading: appState.sessionsLoading,
                    currentSessionKey: appState.sessionKey,
                    sessionSwitching: appState.sessionSwitching,
                    onRefresh: { protocol_?.requestSessionsList() },
                    onSelect: { key in
                        showSessionDropdown = false
                        appState.pinnedSubagent = nil
                        protocol_?.switchSession(to: key)
                    },
                    onDismiss: { showSessionDropdown = false }
                )
            }
        }
        .overlay {
            NativeSetupDialog(
                onConnect: { config in
                    appState.showSetup = false
                    handleConnect(config: config)
                },
                onClose: { appState.showSetup = false },
                visible: appState.showSetup,
                connectionError: appState.connectionError
            )
            .ignoresSafeArea()
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
            appState.scrollDistanceFromBottom = CGFloat(distance)
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
            bridge.send(.zenSet(enabled: appState.zenMode))
            // Flush any history that arrived before WebView was ready
            if appState.backendMode == .demo {
                demoHandler?.loadDemoHistory()
            } else {
                protocol_?.flushPendingHistory()
            }
        }
    }

    // MARK: - Connection

    private func restoreConnection() {
        let savedMode = UserDefaults.standard.string(forKey: "backend-mode") ?? "openclaw"

        if savedMode == "demo" {
            handleConnect(config: ConnectionConfig(mode: .demo, url: "", token: nil, model: nil))
            return
        }

        guard let savedURL = UserDefaults.standard.string(forKey: "gateway-url"),
              !savedURL.isEmpty else {
            appState.showSetup = true
            return
        }

        if savedMode == "lmstudio" {
            let model = UserDefaults.standard.string(forKey: "lmstudio-model")
            let apiKey = KeychainHelper.load(key: "lmstudio-apikey")
            let config = ConnectionConfig(mode: .lmstudio, url: savedURL, token: apiKey, model: model)
            handleConnect(config: config)
        } else {
            let token = KeychainHelper.load(key: "gateway-token")
            let config = ConnectionConfig(mode: .openclaw, url: savedURL, token: token, model: nil)
            handleConnect(config: config)
        }
    }

    private func handleConnect(config: ConnectionConfig) {
        // Tear down previous connections
        wsManager = nil
        protocol_ = nil
        demoHandler = nil
        showSessionDropdown = false
        appState.connectionError = nil
        appState.isRunActive = false
        appState.isStreaming = false
        appState.pinnedSubagent = nil
        appState.backendMode = config.mode
        appState.sessionKey = "main"
        appState.sessionId = nil
        appState.sessions = []
        appState.sessionsLoading = false
        appState.sessionSwitching = false

        // Clear messages from the WebView so stale content from the previous mode doesn't linger
        bridge.send(.messagesClear)

        UserDefaults.standard.set(config.mode.rawValue, forKey: "backend-mode")

        switch config.mode {
        case .demo:
            handleDemoConnect()
        case .openclaw:
            handleOpenClawConnect(config: config)
        case .lmstudio:
            handleLMStudioConnect(config: config)
        }
    }

    // MARK: - Demo Mode

    private func handleDemoConnect() {
        appState.connectionState = .connected
        appState.currentModel = "claude-sonnet-4-5 (demo)"
        appState.sessionKey = "main"
        appState.sessions = []
        bridge.send(.connectionState(.connected))

        let handler = DemoModeHandler(bridge: bridge, appState: appState)
        demoHandler = handler

        // History will be loaded when WebView is ready (via onWebViewReady)
        if bridge.isReady {
            handler.loadDemoHistory()
        }
    }

    // MARK: - OpenClaw

    private func handleOpenClawConnect(config: ConnectionConfig) {
        UserDefaults.standard.set(config.url, forKey: "gateway-url")
        if let token = config.token {
            KeychainHelper.save(key: "gateway-token", value: token)
        }
        appState.gatewayURL = config.url
        appState.gatewayToken = config.token ?? ""
        appState.sessionsLoading = false
        appState.sessionSwitching = false

        let wsURL = toWSURL(config.url)
        print("[RootView] Connecting to: \(wsURL)")

        let proto = OpenClawProtocol(bridge: bridge, appState: appState)
        protocol_ = proto

        let manager = WebSocketManager(
            url: wsURL,
            onMessage: { data in
                Task { @MainActor in
                    proto.handleMessage(data)
                }
            },
            onStateChange: { state in
                Task { @MainActor in
                    appState.connectionState = state
                    if state != .connected {
                        showSessionDropdown = false
                        appState.sessionsLoading = false
                    }
                    bridge.send(.connectionState(state))
                }
            }
        )
        wsManager = manager
        proto.sendMessage = { msg in manager.send(msg) }
        proto.markEstablished = { manager.markEstablished() }
        proto.token = config.token

        manager.connect()
    }

    // MARK: - LM Studio (placeholder)

    private func handleLMStudioConnect(config: ConnectionConfig) {
        // TODO: Implement LM Studio HTTP/SSE connection
        appState.connectionState = .connected
        appState.currentModel = config.model ?? "unknown"
        appState.sessionKey = "main"
        appState.sessions = []
        appState.sessionsLoading = false
        appState.sessionSwitching = false
        bridge.send(.connectionState(.connected))
        print("[RootView] LM Studio mode — not yet implemented")
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

        // Add optimistic user message
        let userMsg = ChatMessage(
            role: .user,
            content: [ContentPart(type: .text, text: text)],
            timestamp: Int(Date().timeIntervalSince1970 * 1000),
            msgId: "u-\(Int(Date().timeIntervalSince1970 * 1000))"
        )
        bridge.send(.messagesAppend(userMsg))

        if appState.backendMode == .demo {
            demoHandler?.sendMessage(text: text)
        } else {
            protocol_?.sendChatMessage(text: text)
        }
    }

    private func handleAbort() {
        if let queued = appState.queuedMessage {
            appState.inputDraft = queued.text
            appState.queuedMessage = nil
        }

        if appState.backendMode == .demo {
            demoHandler?.stop()
        } else {
            protocol_?.sendAbort()
        }
        appState.isRunActive = false
        appState.isStreaming = false
        bridge.send(.streamEnd)
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
