import Foundation
import WebKit
import Observation

@Observable
final class WebViewBridge: NSObject, WKScriptMessageHandler {
    private let gatewayAuthCacheKey = "mc-openclaw-device-auth-v1"

    weak var webView: WKWebView? {
        didSet { wsProxy.webView = webView }
    }
    var isReady = false
    let wsProxy = WebSocketProxy()

    // Callbacks for messages from the web
    var onLinkTap: ((URL) -> Void)?
    var onImageTap: ((URL) -> Void)?
    var onScrollPosition: ((CGFloat) -> Void)?
    var onTextSelected: ((String) -> Void)?
    var onTextDeselected: (() -> Void)?
    var onSubagentPin: ((String, String?, String) -> Void)?
    var onSubagentUnpin: (() -> Void)?
    var onWebViewReady: (() -> Void)?

    // Action callbacks (web → Swift native actions)
    var onActionSend: ((String) -> Void)?
    var onActionAbort: (() -> Void)?
    var onActionSwitchSession: ((String) -> Void)?
    var onActionRequestHistory: (() -> Void)?
    var onActionRequestSessionsList: (() -> Void)?

    // MARK: - Send message to WebView

    func send(_ message: SwiftToWebMessage) {
        guard let webView, isReady else {
            print("[Bridge] send() skipped — webView=\(self.webView != nil) isReady=\(isReady)")
            return
        }
        let json = message.toJSON()
        // Inject JSON directly as a JS expression — valid JSON is valid JS.
        // This avoids the error-prone string-escaping path (JSON.parse('...'))
        // that breaks on newlines, carriage returns, and other characters
        // not handled by simple backslash/quote escaping.
        let js = "window.__bridge?.receive(\(json))"
        DispatchQueue.main.async {
            webView.evaluateJavaScript(js) { _, error in
                if let error {
                    print("[Bridge] JS error: \(error.localizedDescription)")
                }
            }
        }
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        guard message.name == "bridge" else { return }

        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else {
            print("[Bridge] Invalid message from web: \(message.body)")
            return
        }

        let payload = body["payload"] as? [String: Any]

        switch type {
        case "console":
            let level = payload?["level"] as? String ?? "log"
            let msg = payload?["message"] as? String ?? ""
            print("[JS:\(level)] \(msg)")
            return

        case "webview:ready":
            print("[Bridge] Received webview:ready from web")
            isReady = true
            onWebViewReady?()

        case "link:tap":
            if let urlString = payload?["url"] as? String,
               let url = URL(string: urlString) {
                onLinkTap?(url)
            }

        case "image:tap":
            if let src = payload?["src"] as? String,
               let url = URL(string: src) {
                onImageTap?(url)
            }

        case "scroll:position":
            if let dist = payload?["distanceFromBottom"] as? CGFloat {
                onScrollPosition?(dist)
            }

        case "text:selected":
            if let text = payload?["text"] as? String {
                onTextSelected?(text)
            }

        case "text:deselected":
            onTextDeselected?()

        case "subagent:pin":
            if let toolCallId = payload?["toolCallId"] as? String,
               let taskName = payload?["taskName"] as? String {
                let childSessionKey = payload?["childSessionKey"] as? String
                onSubagentPin?(toolCallId, childSessionKey, taskName)
            }

        case "subagent:unpin":
            onSubagentUnpin?()

        // WebSocket proxy — route JS WebSocket through Swift's URLSessionWebSocketTask
        case "ws:connect":
            if let url = payload?["url"] as? String {
                wsProxy.connect(urlString: url)
            }
        case "ws:send":
            if let data = payload?["data"] as? String {
                wsProxy.send(data)
            }
        case "ws:close":
            let code = payload?["code"] as? Int ?? 1000
            let reason = payload?["reason"] as? String ?? ""
            wsProxy.close(code: code, reason: reason)

        // Phase 0: Identity signing — web asks Swift to sign a connect challenge
        case "identity:sign":
            if let nonce = payload?["nonce"] as? String,
               let callbackId = payload?["callbackId"] as? String,
               let platform = payload?["platform"] as? String,
               let deviceFamily = payload?["deviceFamily"] as? String {
                let token = payload?["token"] as? String
                handleIdentitySign(
                    nonce: nonce,
                    token: token,
                    platform: platform,
                    deviceFamily: deviceFamily,
                    callbackId: callbackId
                )
            }

        case "gatewayAuth:get":
            if let callbackId = payload?["callbackId"] as? String {
                send(.gatewayAuthGetResponse(
                    callbackId: callbackId,
                    raw: KeychainHelper.load(key: gatewayAuthCacheKey)
                ))
            }
        case "gatewayAuth:set":
            if let raw = payload?["raw"] as? String {
                KeychainHelper.save(key: gatewayAuthCacheKey, value: raw)
            }
        case "gatewayAuth:delete":
            KeychainHelper.delete(key: gatewayAuthCacheKey)

        // Phase 2: State reporting from web
        case "state:connection":
            if let state = payload?["state"] as? String {
                onConnectionState?(state)
            }
        case "state:run":
            let isActive = payload?["isActive"] as? Bool ?? false
            let isStreaming = payload?["isStreaming"] as? Bool ?? false
            onRunState?(isActive, isStreaming)
        case "state:model":
            let model = payload?["model"] as? String
            onModelState?(model)
        case "state:sessions":
            if let raw = payload?["sessions"] as? [[String: Any]] {
                onSessionsState?(raw, payload?["currentKey"] as? String)
            }

        // Phase 3: Actions routed from native UI through web
        case "action:send":
            if let text = payload?["text"] as? String {
                onActionSend?(text)
            }
        case "action:abort":
            onActionAbort?()
        case "action:switchSession":
            if let key = payload?["key"] as? String {
                onActionSwitchSession?(key)
            }
        case "action:requestHistory":
            onActionRequestHistory?()
        case "action:requestSessionsList":
            onActionRequestSessionsList?()

        default:
            print("[Bridge] Unhandled web message: \(type)")
        }
    }

    // MARK: - Identity Signing (Phase 0)

    private func handleIdentitySign(
        nonce: String,
        token: String?,
        platform: String,
        deviceFamily: String,
        callbackId: String
    ) {
        let identity = DeviceIdentityManager.loadOrCreate()
        let scopes = ["operator.read", "operator.write", "operator.admin", "operator.approvals", "operator.pairing"]
        let role = "operator"
        let clientId = "openclaw-control-ui"
        let clientMode = "webchat"
        let signedAtMs = Int(Date().timeIntervalSince1970 * 1000)

        let payload = DeviceIdentityManager.buildAuthPayload(
            deviceId: identity.deviceId,
            clientId: clientId,
            clientMode: clientMode,
            role: role,
            scopes: scopes,
            signedAtMs: signedAtMs,
            token: token,
            nonce: nonce,
            platform: platform,
            deviceFamily: deviceFamily
        )
        let signature = DeviceIdentityManager.signPayload(payload, privateKeyBase64URL: identity.privateKey)

        send(.identitySignResponse(
            callbackId: callbackId,
            deviceId: identity.deviceId,
            publicKey: identity.publicKey,
            signature: signature,
            signedAt: signedAtMs,
            nonce: nonce
        ))
    }

    // Pending config to send when the WebView becomes ready.
    // Stored on the bridge (a class) so closures always see the latest value,
    // avoiding SwiftUI @State value-type closure capture issues.
    var pendingConnectionConfig: (mode: String, url: String, token: String?, model: String?)?

    // Phase 2: State reporting callbacks
    var onConnectionState: ((String) -> Void)?
    var onRunState: ((Bool, Bool) -> Void)?
    var onModelState: ((String?) -> Void)?
    var onSessionsState: (([[String: Any]], String?) -> Void)?
}
