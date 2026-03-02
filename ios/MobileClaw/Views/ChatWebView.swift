import SwiftUI
import WebKit

private let devServerURL = "http://192.168.1.18:3100?native"

struct ChatWebView: UIViewRepresentable {
    let bridge: WebViewBridge
    var onRefresh: (() -> Void)?
    var onPullProgress: ((CGFloat) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(bridge: bridge)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(bridge, name: "bridge")

        let nativeModeScript = WKUserScript(
            source: "window.__nativeMode = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(nativeModeScript)

        // WebSocket polyfill: route WebSocket through Swift's URLSessionWebSocketTask
        // to avoid CORS/Origin issues when loading from file:// or bundled content.
        let wsPolyfill = WKUserScript(
            source: """
            (function() {
                if (!window.__nativeMode) return;
                const OrigWebSocket = window.WebSocket;
                const bridge = () => window.webkit?.messageHandlers?.bridge;

                function NativeWebSocket(url, protocols) {
                    this.url = url;
                    this.readyState = 0; // CONNECTING
                    this.bufferedAmount = 0;
                    this.extensions = '';
                    this.protocol = '';
                    this.binaryType = 'blob';
                    this._listeners = { open: [], message: [], close: [], error: [] };
                    this.onopen = null;
                    this.onmessage = null;
                    this.onclose = null;
                    this.onerror = null;

                    // Register as current instance
                    window.__nativeWSInstance = this;
                    window.__nativeWSCallback = {
                        open: () => {
                            this.readyState = 1; // OPEN
                            const evt = new Event('open');
                            this._listeners.open.forEach(fn => fn(evt));
                            if (this.onopen) this.onopen(evt);
                        },
                        message: (data) => {
                            const evt = new MessageEvent('message', { data: data });
                            this._listeners.message.forEach(fn => fn(evt));
                            if (this.onmessage) this.onmessage(evt);
                        },
                        close: (code, reason) => {
                            this.readyState = 3; // CLOSED
                            const evt = new CloseEvent('close', { code: code || 1000, reason: reason || '', wasClean: code === 1000 });
                            this._listeners.close.forEach(fn => fn(evt));
                            if (this.onclose) this.onclose(evt);
                        },
                        error: () => {
                            const evt = new Event('error');
                            this._listeners.error.forEach(fn => fn(evt));
                            if (this.onerror) this.onerror(evt);
                        }
                    };

                    bridge()?.postMessage({ type: 'ws:connect', payload: { url: url } });
                }

                NativeWebSocket.CONNECTING = 0;
                NativeWebSocket.OPEN = 1;
                NativeWebSocket.CLOSING = 2;
                NativeWebSocket.CLOSED = 3;

                NativeWebSocket.prototype.send = function(data) {
                    if (this.readyState !== 1) throw new DOMException('WebSocket is not open', 'InvalidStateError');
                    bridge()?.postMessage({ type: 'ws:send', payload: { data: String(data) } });
                };

                NativeWebSocket.prototype.close = function(code, reason) {
                    if (this.readyState >= 2) return;
                    this.readyState = 2; // CLOSING
                    bridge()?.postMessage({ type: 'ws:close', payload: { code: code || 1000, reason: reason || '' } });
                };

                NativeWebSocket.prototype.addEventListener = function(type, fn) {
                    if (this._listeners[type]) this._listeners[type].push(fn);
                };

                NativeWebSocket.prototype.removeEventListener = function(type, fn) {
                    if (this._listeners[type]) {
                        this._listeners[type] = this._listeners[type].filter(f => f !== fn);
                    }
                };

                NativeWebSocket.prototype.dispatchEvent = function(evt) {
                    const fns = this._listeners[evt.type] || [];
                    fns.forEach(fn => fn(evt));
                    return true;
                };

                window.WebSocket = NativeWebSocket;
            })();
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(wsPolyfill)

        // Forward JS console to Xcode console for debugging
        #if DEBUG
        let consoleForwarder = WKUserScript(
            source: """
            (function() {
                const origLog = console.log, origWarn = console.warn, origErr = console.error;
                function fwd(level, args) {
                    try {
                        const msg = Array.from(args).map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
                        window.webkit?.messageHandlers?.bridge?.postMessage({ type: 'console', payload: { level: level, message: msg } });
                    } catch {}
                }
                console.log = function() { fwd('log', arguments); origLog.apply(console, arguments); };
                console.warn = function() { fwd('warn', arguments); origWarn.apply(console, arguments); };
                console.error = function() { fwd('error', arguments); origErr.apply(console, arguments); };
            })();
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(consoleForwarder)
        #endif

        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = true

        // Pull-up-to-refresh: detect overscroll at bottom via delegate
        webView.scrollView.delegate = context.coordinator

        webView.scrollView.keyboardDismissMode = .interactive
        webView.navigationDelegate = context.coordinator

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        bridge.webView = webView
        context.coordinator.webView = webView

        // Try bundled webapp first (built by ios/build-web.sh)
        if let bundleURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            webView.loadFileURL(bundleURL, allowingReadAccessTo: bundleURL.deletingLastPathComponent())
            return webView
        }

        // Fall back to dev server in DEBUG, localhost in RELEASE
        let urlString: String
        #if DEBUG
        urlString = devServerURL
        #else
        urlString = "http://localhost:3000?native"
        #endif

        if let url = URL(string: urlString) {
            webView.load(URLRequest(url: url))
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.onRefresh = onRefresh
        context.coordinator.onPullProgress = onPullProgress
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "bridge")
    }

    class Coordinator: NSObject, WKNavigationDelegate, UIScrollViewDelegate {
        let bridge: WebViewBridge
        weak var webView: WKWebView?
        private var keyboardHeight: CGFloat = 0
        private var lastKeyboardChangeTime: CFTimeInterval = 0

        // Pull-up-to-refresh state
        private var pullUpTriggered = false
        private let pullUpThreshold: CGFloat = 60

        init(bridge: WebViewBridge) {
            self.bridge = bridge
            super.init()
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChangeFrame(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        }

        deinit {
            NotificationCenter.default.removeObserver(self)
        }

        // MARK: - Pull-up-to-refresh (bottom overscroll)

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            let inset = scrollView.adjustedContentInset
            let maxOffsetY = max(
                -inset.top,
                scrollView.contentSize.height - scrollView.bounds.height + inset.bottom
            )
            // How far past the bottom edge the user has dragged.
            let overscroll = max(0, scrollView.contentOffset.y - maxOffsetY)
            let progress = min(1, max(0, overscroll / pullUpThreshold))
            onPullProgress?(progress)

            if overscroll > pullUpThreshold && !pullUpTriggered && scrollView.isDragging {
                pullUpTriggered = true
            }
        }

        var onRefresh: (() -> Void)?
        var onPullProgress: ((CGFloat) -> Void)?

        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            if pullUpTriggered {
                pullUpTriggered = false
                // Hard stop: kill any scroll deceleration
                scrollView.setContentOffset(scrollView.contentOffset, animated: false)
                onRefresh?()
            }
            onPullProgress?(0)
        }

        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
            onPullProgress?(0)
        }

        // MARK: - Keyboard handling

        @objc private func keyboardWillChangeFrame(_ notification: Notification) {
            guard let webView,
                  let endFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
                  let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double,
                  let curve = notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt else { return }

            let screenHeight = UIScreen.main.bounds.height
            let newKeyboardHeight = max(0, screenHeight - endFrame.origin.y)
            let delta = newKeyboardHeight - keyboardHeight
            guard abs(delta) > 1 else { return }

            let now = CACurrentMediaTime()
            let timeSinceLast = now - lastKeyboardChangeTime
            lastKeyboardChangeTime = now

            let scrollView = webView.scrollView
            let currentOffset = scrollView.contentOffset.y

            // Cancel any in-flight animations before starting new ones
            scrollView.layer.removeAllAnimations()

            keyboardHeight = newKeyboardHeight

            var insets = scrollView.contentInset
            insets.bottom = newKeyboardHeight
            scrollView.contentInset = insets
            scrollView.verticalScrollIndicatorInsets.bottom = newKeyboardHeight

            let newOffset = max(0, currentOffset + delta)

            // If keyboard resized again within 150ms (SwiftKey, third-party keyboards),
            // snap immediately without animation to avoid fighting
            if timeSinceLast < 0.15 {
                scrollView.contentOffset = CGPoint(x: 0, y: newOffset)
            } else {
                UIView.animate(
                    withDuration: duration,
                    delay: 0,
                    options: UIView.AnimationOptions(rawValue: curve << 16),
                    animations: {
                        scrollView.contentOffset = CGPoint(x: 0, y: newOffset)
                    }
                )
            }
        }

        @objc private func keyboardWillHide(_ notification: Notification) {
            guard let webView,
                  let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double,
                  let curve = notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt else { return }

            let scrollView = webView.scrollView
            let currentOffset = scrollView.contentOffset.y
            let delta = keyboardHeight

            scrollView.layer.removeAllAnimations()

            keyboardHeight = 0
            lastKeyboardChangeTime = CACurrentMediaTime()

            var insets = scrollView.contentInset
            insets.bottom = 0
            let newOffset = max(0, currentOffset - delta)

            UIView.animate(
                withDuration: duration,
                delay: 0,
                options: UIView.AnimationOptions(rawValue: curve << 16),
                animations: {
                    scrollView.contentInset = insets
                    scrollView.verticalScrollIndicatorInsets.bottom = 0
                    scrollView.contentOffset = CGPoint(x: 0, y: newOffset)
                }
            )
        }

        // MARK: - Navigation delegate

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {}

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {}
    }
}
