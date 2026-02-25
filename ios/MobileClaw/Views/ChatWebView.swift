import SwiftUI
import WebKit

private let devServerURL = "http://192.168.1.18:3100?native"

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

        let urlString: String
        #if DEBUG
        urlString = devServerURL
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

    class Coordinator: NSObject, WKNavigationDelegate, UIScrollViewDelegate {
        let bridge: WebViewBridge
        weak var webView: WKWebView?
        private var keyboardHeight: CGFloat = 0
        private var lastKeyboardChangeTime: CFTimeInterval = 0

        // Pull-up-to-refresh state
        private var pullUpTriggered = false
        private let pullUpThreshold: CGFloat = 80

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
            let contentHeight = scrollView.contentSize.height
            let frameHeight = scrollView.frame.height
            let offsetY = scrollView.contentOffset.y
            let bottomInset = scrollView.contentInset.bottom

            // How far past the bottom edge the user has dragged
            let overscroll = offsetY - (contentHeight - frameHeight + bottomInset)

            if overscroll > pullUpThreshold && !pullUpTriggered && scrollView.isDragging {
                pullUpTriggered = true
            }
        }

        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            if pullUpTriggered {
                pullUpTriggered = false
                bridge.isReady = false
                webView?.reload()
            }
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
