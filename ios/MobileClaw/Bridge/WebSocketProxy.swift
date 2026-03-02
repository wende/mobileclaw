import Foundation
import WebKit

/// Lightweight WebSocket proxy that forwards raw frames between Swift and the WKWebView.
/// Swift handles the transport (URLSessionWebSocketTask — no Origin header, no CORS issues).
/// JavaScript handles all protocol logic via a polyfilled WebSocket class.
final class WebSocketProxy: NSObject, URLSessionWebSocketDelegate {
    private var task: URLSessionWebSocketTask?
    private lazy var session: URLSession = {
        URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    }()
    weak var webView: WKWebView?
    private var didSendClose = false

    func connect(urlString: String) {
        // Tear down any existing connection
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        didSendClose = false

        guard let url = URL(string: urlString) else {
            print("[WSProxy] Invalid URL: \(urlString)")
            return
        }

        // Build a URLRequest and set Origin to the gateway's own HTTP origin
        // so the server's allowedOrigins check passes (wss → https, ws → http).
        var request = URLRequest(url: url)
        if var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            components.scheme = url.scheme == "wss" ? "https" : "http"
            components.path = ""
            components.query = nil
            components.fragment = nil
            if let origin = components.url?.absoluteString {
                let cleaned = origin.hasSuffix("/") ? String(origin.dropLast()) : origin
                request.setValue(cleaned, forHTTPHeaderField: "Origin")
            }
        }

        print("[WSProxy] Connecting to \(urlString)")
        let newTask = session.webSocketTask(with: request)
        newTask.maximumMessageSize = 16 * 1024 * 1024 // 16 MB
        task = newTask
        newTask.resume()
    }

    func send(_ text: String) {
        task?.send(.string(text)) { error in
            if let error { print("[WSProxy] send error: \(error)") }
        }
    }

    func close(code: Int = 1000, reason: String = "") {
        didSendClose = true
        let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
        task?.cancel(with: closeCode, reason: reason.data(using: .utf8))
        task = nil
    }

    // MARK: - Receive loop

    private func receiveLoop() {
        guard let currentTask = task else { return }
        currentTask.receive { [weak self] result in
            guard let self, self.task === currentTask else { return }
            switch result {
            case .success(let message):
                let text: String
                switch message {
                case .string(let str): text = str
                case .data(let data): text = String(data: data, encoding: .utf8) ?? ""
                @unknown default: return
                }
                self.postToJS("message", text)
                self.receiveLoop()
            case .failure:
                // Connection closed or error — delegate methods handle notification
                break
            }
        }
    }

    // MARK: - URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        guard webSocketTask === task else { return }
        print("[WSProxy] Opened")
        evalJS("window.__nativeWSCallback?.open()")
        receiveLoop()
    }

    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                    reason: Data?) {
        guard webSocketTask === task else { return }
        let code = closeCode.rawValue
        let reasonStr = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        print("[WSProxy] Closed: \(code) \(reasonStr)")
        sendCloseToJS(code: code, reason: reasonStr)
    }

    func urlSession(_ session: URLSession,
                    task sessionTask: URLSessionTask,
                    didCompleteWithError error: (any Error)?) {
        guard sessionTask === task else { return }
        guard let error else { return }
        let nsError = error as NSError
        // Ignore cancellation we triggered ourselves
        if nsError.code == NSURLErrorCancelled && didSendClose { return }

        print("[WSProxy] Error: \(error.localizedDescription)")
        evalJS("window.__nativeWSCallback?.error()")
        let code = nsError.code == NSURLErrorCancelled ? 1000 : 1006
        sendCloseToJS(code: code, reason: error.localizedDescription)
    }

    // MARK: - JS helpers

    private func sendCloseToJS(code: Int, reason: String) {
        guard !didSendClose else { return }
        didSendClose = true
        let reasonEscaped = jsStringLiteral(reason)
        evalJS("window.__nativeWSCallback?.close(\(code), \(reasonEscaped))")
    }

    /// Post a WebSocket message payload to JS. The text is JSON (from the server),
    /// so we JSON-encode it as a JS string literal to safely embed in evaluateJavaScript.
    private func postToJS(_ event: String, _ text: String) {
        let escaped = jsStringLiteral(text)
        evalJS("window.__nativeWSCallback?.\(event)(\(escaped))")
    }

    private func evalJS(_ js: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js) { _, error in
                if let error { print("[WSProxy] JS error: \(error.localizedDescription)") }
            }
        }
    }

    /// Produce a JS string literal (with quotes) that safely embeds any string.
    private func jsStringLiteral(_ str: String) -> String {
        if let data = try? JSONSerialization.data(withJSONObject: str, options: .fragmentsAllowed),
           let escaped = String(data: data, encoding: .utf8) {
            return escaped
        }
        // Fallback: manual escaping
        let escaped = str
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
        return "\"\(escaped)\""
    }
}
