import Foundation

final class WebSocketManager: NSObject, @unchecked Sendable, URLSessionWebSocketDelegate {
    private let url: String
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var reconnectAttempt = 0
    private var reconnectTimer: Timer?
    private var intentionalClose = false
    private var everEstablished = false

    private let reconnectDelays: [TimeInterval] = [1, 2, 4, 8, 15]

    var onMessage: ((Data) -> Void)?
    var onStateChange: ((ConnectionState) -> Void)?

    init(url: String,
         onMessage: @escaping (Data) -> Void,
         onStateChange: @escaping (ConnectionState) -> Void) {
        self.url = url
        self.onMessage = onMessage
        self.onStateChange = onStateChange
        super.init()
    }

    func connect() {
        cancelReconnect()
        intentionalClose = false
        everEstablished = false
        reconnectAttempt = 0

        guard URL(string: url) != nil else {
            print("[WS] Invalid URL: \(url)")
            onStateChange?(.error)
            return
        }

        onStateChange?(.connecting)

        let config = URLSessionConfiguration.default
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        connectInternal()
    }

    func disconnect() {
        cancelReconnect()
        intentionalClose = true
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        onStateChange?(.disconnected)
    }

    func markEstablished() {
        everEstablished = true
        reconnectAttempt = 0
    }

    func send(_ data: Data) {
        guard let task, task.state == .running else {
            print("[WS] Cannot send — not connected")
            return
        }
        task.send(.data(data)) { error in
            if let error {
                print("[WS] Send error: \(error.localizedDescription)")
            }
        }
    }

    func send(_ string: String) {
        guard let task, task.state == .running else {
            print("[WS] Cannot send — not connected")
            return
        }
        task.send(.string(string)) { error in
            if let error {
                print("[WS] Send error: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Private

    private func listen() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    if let data = text.data(using: .utf8) {
                        self.onMessage?(data)
                    }
                case .data(let data):
                    self.onMessage?(data)
                @unknown default:
                    break
                }
                self.listen()
            case .failure(let error):
                print("[WS] Receive error: \(error.localizedDescription)")
                // Connection will close, handled by delegate
            }
        }
    }

    private func scheduleReconnect() {
        guard !intentionalClose, everEstablished else {
            if !everEstablished {
                print("[WS] Connection never established — not reconnecting")
                onStateChange?(.disconnected)
            }
            return
        }

        let delay = reconnectDelays[min(reconnectAttempt, reconnectDelays.count - 1)]
        print("[WS] Reconnecting in \(delay)s (attempt \(reconnectAttempt + 1))")
        onStateChange?(.reconnecting)

        reconnectTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.reconnectAttempt += 1
            self.connectInternal()
        }
    }

    private func connectInternal() {
        guard let wsURL = URL(string: url) else { return }
        onStateChange?(.connecting)
        var request = URLRequest(url: wsURL)
        let origin = wsURL.scheme == "wss"
            ? "https://\(wsURL.host ?? "localhost")"
            : "http://\(wsURL.host ?? "localhost"):\(wsURL.port ?? 80)"
        request.setValue(origin, forHTTPHeaderField: "Origin")
        task = session?.webSocketTask(with: request)
        task?.resume()
        listen()
    }

    private func cancelReconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
    }

    // MARK: - URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        print("[WS] Connection opened")
        reconnectAttempt = 0
        onStateChange?(.connected)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        print("[WS] Connection closed: \(closeCode.rawValue)")

        if intentionalClose {
            onStateChange?(.disconnected)
            return
        }

        scheduleReconnect()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        if let error {
            print("[WS] Task error: \(error.localizedDescription)")
        }
        if !intentionalClose {
            scheduleReconnect()
        }
    }
}
