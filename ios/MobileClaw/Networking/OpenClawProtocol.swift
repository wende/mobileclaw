import Foundation

@MainActor
final class OpenClawProtocol {
    let bridge: WebViewBridge
    let appState: AppState
    var sendMessage: ((String) -> Void)?
    var markEstablished: (() -> Void)?
    var token: String?

    private var activeRunId: String?
    private var sessionKey: String = "main"
    private var pendingHistoryJSON: String?

    init(bridge: WebViewBridge, appState: AppState) {
        self.bridge = bridge
        self.appState = appState
    }

    // MARK: - Incoming message router

    func handleMessage(_ data: Data) {
        if let raw = String(data: data, encoding: .utf8) {
            print("[Protocol] RAW: \(raw)")
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            print("[Protocol] Invalid message")
            return
        }

        switch type {
        case "event":
            handleEvent(json)
        case "res":
            handleResponse(json)
        case "hello":
            if let sessionId = json["sessionId"] as? String {
                appState.sessionId = sessionId
            }
        default:
            break
        }
    }

    // MARK: - Events

    private func handleEvent(_ json: [String: Any]) {
        guard let event = json["event"] as? String else { return }

        if event == "connect.challenge" {
            let payload = json["payload"] as? [String: Any]
            let nonce = payload?["nonce"] as? String
            handleConnectChallenge(nonce: nonce)
            return
        }

        guard let payload = json["payload"] as? [String: Any] else { return }

        if event == "chat" {
            handleChatEvent(payload)
        } else if event == "agent" {
            handleAgentEvent(payload)
        }
    }

    // MARK: - Connect Challenge

    private func handleConnectChallenge(nonce: String?) {
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
            nonce: nonce
        )
        let signature = DeviceIdentityManager.signPayload(payload, privateKeyBase64URL: identity.privateKey)

        var device: [String: Any] = [
            "id": identity.deviceId,
            "publicKey": identity.publicKey,
            "signature": signature,
            "signedAt": signedAtMs,
        ]
        if let nonce { device["nonce"] = nonce }

        var params: [String: Any] = [
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": [
                "id": clientId,
                "version": "1.0.0",
                "platform": "ios",
                "mode": clientMode,
            ],
            "role": role,
            "scopes": scopes,
            "device": device,
            "caps": ["tool-events"],
        ]
        if let token, !token.isEmpty {
            params["auth"] = ["token": token]
        }

        let req: [String: Any] = [
            "type": "req",
            "id": "conn-\(Int(Date().timeIntervalSince1970 * 1000))",
            "method": "connect",
            "params": params,
        ]
        send(req)
    }

    // MARK: - Response handling

    private func handleResponse(_ json: [String: Any]) {
        let ok = json["ok"] as? Bool ?? false
        let id = json["id"] as? String ?? ""
        let payload = json["payload"] as? [String: Any]

        // hello-ok
        if ok, let p = payload, p["type"] as? String == "hello-ok" {
            markEstablished?()
            handleHelloOk(p)
            return
        }

        // chat.history response
        if ok, id.hasPrefix("history-"), let p = payload, p["messages"] != nil {
            handleHistoryResponse(p)
            return
        }

        // Run errors
        if id.hasPrefix("run-"), !ok {
            let errorMsg = extractError(json)
            appState.isRunActive = false
            appState.isStreaming = false
            bridge.send(.streamError(errorMessage: errorMsg))
            return
        }

        // General errors
        if !ok, let error = extractError(json) as String? {
            appState.connectionError = error
        }
    }

    private func handleHelloOk(_ payload: [String: Any]) {
        let snapshot = payload["snapshot"] as? [String: Any]
        let sessionDefaults = snapshot?["sessionDefaults"] as? [String: String]
        sessionKey = sessionDefaults?["mainSessionKey"] ?? sessionDefaults?["mainKey"] ?? "main"
        appState.sessionKey = sessionKey
        requestHistory()
    }

    private func handleHistoryResponse(_ payload: [String: Any]) {
        guard let rawMessages = payload["messages"] as? [[String: Any]] else { return }

        // Set stopReason: "injected" on gateway-injected messages so the webapp renders them as pills
        let processedMessages = rawMessages.map { msg -> [String: Any] in
            var m = msg
            if m["model"] as? String == "gateway-injected" {
                m["stopReason"] = "injected"
            }
            return m
        }

        guard let data = try? JSONSerialization.data(withJSONObject: processedMessages),
              let json = String(data: data, encoding: .utf8) else { return }

        if bridge.isReady {
            forwardHistoryToWeb(json)
        } else {
            print("[Protocol] WebView not ready, queuing history (\(rawMessages.count) messages)")
            pendingHistoryJSON = json
        }
    }

    func flushPendingHistory() {
        guard let json = pendingHistoryJSON else { return }
        pendingHistoryJSON = nil
        print("[Protocol] Flushing queued history to WebView")
        forwardHistoryToWeb(json)
    }

    private func forwardHistoryToWeb(_ json: String) {
        let js = """
        (function() {
            var msgs = \(json);
            window.__bridge?.receive({ type: 'messages:history', payload: msgs });
            // Scroll to bottom after history loads
            setTimeout(function() {
                window.__bridge?.receive({ type: 'scroll:toBottom' });
            }, 100);
        })()
        """
        Task {
            do {
                _ = try await bridge.webView?.evaluateJavaScript(js)
            } catch {
                print("[Protocol] History forward error: \(error)")
            }
        }
    }

    // MARK: - Chat Events

    private func handleChatEvent(_ payload: [String: Any]) {
        guard let state = payload["state"] as? String,
              let runId = payload["runId"] as? String,
              let payloadSessionKey = payload["sessionKey"] as? String else { return }

        // Skip subagent events for now
        guard payloadSessionKey == sessionKey else { return }

        let ts = Int(Date().timeIntervalSince1970 * 1000)

        switch state {
        case "delta":
            if let message = payload["message"] as? [String: Any] {
                let content = message["content"]
                let role = message["role"] as? String ?? "assistant"
                let reasoning = message["reasoning"] as? String

                if role == "user" { return }

                appState.isStreaming = true
                appState.isRunActive = true
                activeRunId = runId

                if let text = extractText(from: content) {
                    bridge.send(.streamContentDelta(runId: runId, delta: text, ts: ts))
                }
                if let reasoning, !reasoning.isEmpty {
                    bridge.send(.streamReasoningDelta(runId: runId, delta: reasoning, ts: ts))
                }
            }

        case "final":
            appState.isRunActive = false
            appState.isStreaming = false
            bridge.send(.streamEnd)
            activeRunId = nil

            if let queued = appState.queuedMessage {
                appState.queuedMessage = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [self] in
                    self.sendChatMessage(text: queued.text)
                }
            } else {
                requestHistory()
            }

        case "aborted":
            appState.isRunActive = false
            appState.isStreaming = false
            bridge.send(.streamEnd)
            activeRunId = nil

        case "error":
            let errorMsg = payload["errorMessage"] as? String ?? "Chat error"
            appState.isRunActive = false
            appState.isStreaming = false
            bridge.send(.streamError(errorMessage: errorMsg))
            activeRunId = nil

        default:
            break
        }
    }

    // MARK: - Agent Events

    private func handleAgentEvent(_ payload: [String: Any]) {
        guard let stream = payload["stream"] as? String,
              let runId = payload["runId"] as? String,
              let payloadSessionKey = payload["sessionKey"] as? String,
              let data = payload["data"] as? [String: Any] else { return }

        guard payloadSessionKey == sessionKey else { return }

        let ts = payload["ts"] as? Int ?? Int(Date().timeIntervalSince1970 * 1000)

        switch stream {
        case "lifecycle":
            let phase = data["phase"] as? String
            if phase == "start" {
                appState.isStreaming = true
                appState.isRunActive = true
                activeRunId = runId
                bridge.send(.streamStart(runId: runId, ts: ts))
            }

        case "content":
            let delta = (data["delta"] ?? data["text"] ?? data["content"]) as? String ?? ""
            if !delta.isEmpty {
                bridge.send(.streamContentDelta(runId: runId, delta: delta, ts: ts))
            }

        case "reasoning":
            let delta = (data["delta"] ?? data["text"] ?? data["content"]) as? String ?? ""
            if !delta.isEmpty {
                bridge.send(.streamReasoningDelta(runId: runId, delta: delta, ts: ts))
            }

        case "tool":
            let phase = data["phase"] as? String ?? ""
            let toolName = data["name"] as? String ?? ""
            let toolCallId = (data["toolCallId"] ?? data["tool_call_id"]) as? String

            if phase == "start" && !toolName.isEmpty {
                let argsRaw = data["args"]
                let args: String?
                if let dict = argsRaw as? [String: Any],
                   let jsonData = try? JSONSerialization.data(withJSONObject: dict),
                   let str = String(data: jsonData, encoding: .utf8) {
                    args = str
                } else {
                    args = argsRaw as? String
                }
                bridge.send(.streamToolStart(runId: runId, name: toolName, args: args, toolCallId: toolCallId, ts: ts))
            } else if phase == "result" && !toolName.isEmpty {
                let resultRaw = data["result"]
                let result: String?
                if let str = resultRaw as? String {
                    result = str
                } else if let dict = resultRaw,
                          let jsonData = try? JSONSerialization.data(withJSONObject: dict),
                          let str = String(data: jsonData, encoding: .utf8) {
                    result = str
                } else {
                    result = nil
                }
                let isError = data["isError"] as? Bool ?? false
                bridge.send(.streamToolResult(runId: runId, name: toolName, toolCallId: toolCallId, result: result, isError: isError))
            }

        default:
            break
        }
    }

    // MARK: - Outgoing

    func sendChatMessage(text: String) {
        let runId = "run-\(Int(Date().timeIntervalSince1970 * 1000))-\(randomHex(4))"
        activeRunId = runId
        appState.isRunActive = true
        appState.isStreaming = true
        bridge.send(.thinkingShow)

        let req: [String: Any] = [
            "type": "req",
            "id": runId,
            "method": "chat.send",
            "params": [
                "sessionKey": sessionKey,
                "message": text,
                "deliver": true,
                "idempotencyKey": runId,
            ],
        ]
        send(req)
    }

    func sendAbort() {
        let req: [String: Any] = [
            "type": "req",
            "id": "abort-\(Int(Date().timeIntervalSince1970 * 1000))",
            "method": "chat.abort",
            "params": [
                "sessionKey": sessionKey,
                "runId": activeRunId as Any,
            ].compactMapValues { $0 },
        ]
        send(req)
    }

    func requestHistory() {
        let req: [String: Any] = [
            "type": "req",
            "id": "history-\(Int(Date().timeIntervalSince1970 * 1000))",
            "method": "chat.history",
            "params": ["sessionKey": sessionKey],
        ]
        send(req)
    }

    // MARK: - Helpers

    private func send(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let string = String(data: data, encoding: .utf8) else { return }
        sendMessage?(string)
    }

    private func extractText(from content: Any?) -> String? {
        if let str = content as? String { return str }
        if let parts = content as? [[String: Any]] {
            return parts.compactMap { part -> String? in
                guard part["type"] as? String == "text" else { return nil }
                return part["text"] as? String
            }.joined()
        }
        return nil
    }

    private func extractError(_ json: [String: Any]) -> String {
        if let error = json["error"] as? String { return error }
        if let error = json["error"] as? [String: Any] {
            return error["message"] as? String ?? "Unknown error"
        }
        return "Unknown error"
    }

    private func randomHex(_ bytes: Int) -> String {
        (0..<bytes).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }
}
