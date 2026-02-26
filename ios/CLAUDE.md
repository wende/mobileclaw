# MobileClaw iOS App

## Overview

The iOS app is a thin native SwiftUI wrapper around a WKWebView that loads the MobileClaw webapp with the `?native` query parameter. The webapp acts as a pure message rendering surface while Swift handles all native chrome: input bar, header, keyboard management, pull-to-refresh, scroll tracking, and backend connections.

## How it works

- The WKWebView loads the webapp at `http://<host>:<port>?native`
- The `?native` flag tells the webapp to hide all its own UI chrome (header, input bar, setup dialog, gradients, scroll-to-bottom pill) and skip backend initialization
- An inline `<script>` in the webapp's `<head>` detects `?native` before React hydrates and sets `html.native-loading` to prevent any flash of web chrome
- Swift and the webapp communicate over a two-way JavaScript bridge (`window.webkit.messageHandler` from web to Swift, `evaluateJavaScript` from Swift to web)
- Native SwiftUI views overlay the WebView: input bar with morphing pill, chat header, subagent panel, setup dialog, command sheet, queue pill
- Swift manages the WebSocket/HTTP connection to backends (OpenClaw, LM Studio, Demo) and forwards messages to the webapp for rendering
- Keyboard insets are handled natively via `keyboardWillChangeFrame` notifications on the WKWebView's scroll view — the webapp's keyboard layout hook is disabled in native mode
- Pull-to-refresh is handled by the native `UIScrollViewDelegate` on the WKWebView — the webapp's touch-based pull-to-refresh is disabled in native mode
- Scroll position is posted from the webapp to Swift via the bridge so the native input bar can morph between textarea and scroll-to-bottom pill

## Development

The iOS project uses [XcodeGen](https://github.com/yonaskolb/XcodeGen) with `project.yml` to generate the Xcode project. Open `ios/MobileClaw.xcodeproj` in Xcode.

In DEBUG builds, the WebView points to the local dev server (currently `http://192.168.1.18:3100?native`). In RELEASE builds, it loads a bundled `index.html` from the app bundle, falling back to `localhost:3000`.

Run the webapp dev server on the same network before launching the app:

```bash
PORT=3100 pnpm run dev
```

## Building

**NEVER run `xcodebuild` or build the iOS project from the command line.** The user builds manually in Xcode (Cmd+R). After making Swift changes, just ask the user to build and test.
