import Foundation
import WebKit
import Observation

@Observable
final class WebViewBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    var isReady = false

    // Callbacks for messages from the web
    var onLinkTap: ((URL) -> Void)?
    var onImageTap: ((URL) -> Void)?
    var onScrollPosition: ((CGFloat) -> Void)?
    var onTextSelected: ((String) -> Void)?
    var onTextDeselected: (() -> Void)?
    var onSubagentPin: ((String, String?, String) -> Void)?
    var onSubagentUnpin: (() -> Void)?
    var onWebViewReady: (() -> Void)?

    // MARK: - Send message to WebView

    func send(_ message: SwiftToWebMessage) {
        guard let webView, isReady else { return }
        let json = message.toJSON()
        let escaped = json.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        let js = "window.__bridge?.receive(JSON.parse('\(escaped)'))"
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
        case "webview:ready":
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

        default:
            print("[Bridge] Unhandled web message: \(type)")
        }
    }
}
