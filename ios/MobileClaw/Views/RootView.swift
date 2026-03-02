import SwiftUI
import SafariServices

struct RootView: View {
    @Environment(AppState.self) private var appState
    @State private var bridge = WebViewBridge()
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
                bridge.send(.scrollToBottom)
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
                    onRefresh: { },
                    onSelect: { key in
                        showSessionDropdown = false
                        guard key != appState.sessionKey else { return }
                        appState.pinnedSubagent = nil
                        appState.sessionSwitching = true
                        appState.sessionKey = key
                        bridge.send(.actionSwitchSession(key: key))
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
            print("[Bridge] webview:ready received, isReady=\(bridge.isReady)")
            // WebView is initialized, send current theme and then connection config
            let isDark = UITraitCollection.current.userInterfaceStyle == .dark
            bridge.send(.themeSet(theme: isDark ? "dark" : "light"))
            bridge.send(.zenSet(enabled: appState.zenMode))
            // Send pending config so web opens its own connection.
            // Read from bridge (a class) to avoid SwiftUI @State closure capture issues.
            if let pending = bridge.pendingConnectionConfig {
                print("[Bridge] Sending pending config: mode=\(pending.mode) url=\(pending.url)")
                bridge.pendingConnectionConfig = nil
                bridge.send(.configConnection(
                    mode: pending.mode,
                    url: pending.url,
                    token: pending.token,
                    model: pending.model
                ))
            } else {
                print("[Bridge] No pending config to send!")
            }
        }

        // Phase 2: State reporting — web tells Swift about state changes
        bridge.onConnectionState = { state in
            print("[Bridge] state:connection -> \(state)")
            appState.connectionState = ConnectionState(rawValue: state) ?? .disconnected
            if state != "connected" {
                showSessionDropdown = false
                appState.sessionsLoading = false
            }
        }
        bridge.onRunState = { isActive, isStreaming in
            appState.isRunActive = isActive
            appState.isStreaming = isStreaming
        }
        bridge.onModelState = { model in
            appState.currentModel = model
        }
        bridge.onSessionsState = { rawSessions, currentKey in
            appState.sessions = rawSessions.compactMap(parseSessionInfo)
            if let currentKey {
                appState.sessionKey = currentKey
            }
            appState.sessionsLoading = false
            appState.sessionSwitching = false
        }
    }

    // MARK: - Connection

    private func restoreConnection() {
        print("[Bridge] restoreConnection()")
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
        // Reset UI state
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

        // Save credentials
        UserDefaults.standard.set(config.mode.rawValue, forKey: "backend-mode")
        if config.mode == .openclaw {
            UserDefaults.standard.set(config.url, forKey: "gateway-url")
            if let token = config.token {
                KeychainHelper.save(key: "gateway-token", value: token)
            }
            appState.gatewayURL = config.url
            appState.gatewayToken = config.token ?? ""
        } else if config.mode == .lmstudio {
            UserDefaults.standard.set(config.url, forKey: "gateway-url")
            if let token = config.token {
                KeychainHelper.save(key: "lmstudio-apikey", value: token)
            }
            if let model = config.model {
                UserDefaults.standard.set(model, forKey: "lmstudio-model")
            }
        }

        // Store on bridge (class) so onWebViewReady can read it reliably.
        let configTuple = (mode: config.mode.rawValue, url: config.url, token: config.token, model: config.model)
        print("[Bridge] handleConnect: mode=\(configTuple.mode) url=\(configTuple.url) bridgeReady=\(bridge.isReady)")

        if bridge.isReady {
            bridge.send(.configConnection(
                mode: configTuple.mode,
                url: configTuple.url,
                token: configTuple.token,
                model: configTuple.model
            ))
        } else {
            bridge.pendingConnectionConfig = configTuple
        }
    }

    // MARK: - Send (routes through web protocol stack)

    private func handleSend(text: String, attachments: [ImageAttachmentData]?) {
        if appState.isRunActive {
            if appState.queuedMessage == nil {
                appState.queuedMessage = QueuedMessage(text: text, attachments: attachments)
            }
            return
        }

        // Add optimistic user message via bridge
        let userMsg = ChatMessage(
            role: .user,
            content: [ContentPart(type: .text, text: text)],
            timestamp: Int(Date().timeIntervalSince1970 * 1000),
            msgId: "u-\(Int(Date().timeIntervalSince1970 * 1000))"
        )
        bridge.send(.messagesAppend(userMsg))

        // Tell web to send via its protocol stack
        bridge.send(.actionSend(text: text))
    }

    private func handleAbort() {
        if let queued = appState.queuedMessage {
            appState.inputDraft = queued.text
            appState.queuedMessage = nil
        }

        // Tell web to abort via its protocol stack
        bridge.send(.actionAbort)
    }

    // MARK: - Helpers

    private func parseSessionInfo(_ raw: [String: Any]) -> SessionInfo? {
        guard let key = raw["key"] as? String, !key.isEmpty else { return nil }

        let kind = SessionKind(rawValueOrFallback: raw["kind"] as? String)
        let channel = raw["channel"] as? String ?? ""
        let displayName = raw["displayName"] as? String
        let updatedAt = toEpochMilliseconds(raw["updatedAt"])
        let sessionId = raw["sessionId"] as? String
        let model = raw["model"] as? String
        let contextTokens = toInt(raw["contextTokens"])
        let totalTokens = toInt(raw["totalTokens"])

        return SessionInfo(
            key: key,
            kind: kind,
            channel: channel,
            displayName: displayName,
            updatedAt: updatedAt,
            sessionId: sessionId,
            model: model,
            contextTokens: contextTokens,
            totalTokens: totalTokens
        )
    }

    private func toInt(_ any: Any?) -> Int? {
        if let value = any as? Int { return value }
        if let value = any as? Double { return Int(value) }
        if let value = any as? NSNumber { return value.intValue }
        if let value = any as? String { return Int(value) }
        return nil
    }

    private func toEpochMilliseconds(_ any: Any?) -> Int {
        guard let raw = toInt(any) else { return 0 }
        if raw > 0 && raw < 10_000_000_000 { return raw * 1000 }
        return raw
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
