import SwiftUI
import WebKit

struct ChatWebView: UIViewRepresentable {
    let bridge: WebViewBridge

    func makeCoordinator() -> Coordinator {
        Coordinator(bridge: bridge)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(bridge, name: "bridge")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = true

        // Pull-to-refresh
        let refreshControl = UIRefreshControl()
        refreshControl.addTarget(context.coordinator, action: #selector(Coordinator.handleRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        webView.scrollView.keyboardDismissMode = .interactive
        webView.navigationDelegate = context.coordinator

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        bridge.webView = webView
        context.coordinator.webView = webView

        let urlString: String
        #if DEBUG
        urlString = "http://192.168.1.18:3000?native"
        #else
        if let bundleURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            webView.loadFileURL(bundleURL, allowingReadAccessTo: bundleURL.deletingLastPathComponent())
            return webView
        }
        urlString = "http://localhost:3000?native"
        #endif

        if let url = URL(string: urlString) {
            webView.load(URLRequest(url: url))
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "bridge")
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        let bridge: WebViewBridge
        weak var webView: WKWebView?
        private var keyboardHeight: CGFloat = 0

        init(bridge: WebViewBridge) {
            self.bridge = bridge
            super.init()
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChangeFrame(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        }

        deinit {
            NotificationCenter.default.removeObserver(self)
        }

        @objc func handleRefresh(_ sender: UIRefreshControl) {
            bridge.isReady = false
            webView?.reload()
        }

        @objc private func keyboardWillChangeFrame(_ notification: Notification) {
            guard let webView,
                  let endFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
                  let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double,
                  let curve = notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt else { return }

            let screenHeight = UIScreen.main.bounds.height
            let newKeyboardHeight = max(0, screenHeight - endFrame.origin.y)
            let delta = newKeyboardHeight - keyboardHeight
            guard abs(delta) > 1 else { return }

            let scrollView = webView.scrollView
            let currentOffset = scrollView.contentOffset.y

            keyboardHeight = newKeyboardHeight

            // Adjust content inset so scrollable area accounts for keyboard
            var insets = scrollView.contentInset
            insets.bottom = newKeyboardHeight
            scrollView.contentInset = insets
            scrollView.verticalScrollIndicatorInsets.bottom = newKeyboardHeight

            // Shift scroll position by the keyboard delta to keep visible content in place
            let newOffset = max(0, currentOffset + delta)

            UIView.animate(
                withDuration: duration,
                delay: 0,
                options: UIView.AnimationOptions(rawValue: curve << 16),
                animations: {
                    scrollView.contentOffset = CGPoint(x: 0, y: newOffset)
                }
            )
        }

        @objc private func keyboardWillHide(_ notification: Notification) {
            guard let webView,
                  let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double,
                  let curve = notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt else { return }

            let scrollView = webView.scrollView
            let currentOffset = scrollView.contentOffset.y
            let delta = keyboardHeight

            keyboardHeight = 0

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

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.scrollView.refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            webView.scrollView.refreshControl?.endRefreshing()
        }
    }
}
