import Foundation

/// Simulates an OpenClaw backend with keyword-matched streaming responses.
/// Sends the same bridge messages as OpenClawProtocol so the WebView renders identically.
@MainActor
final class DemoModeHandler {
    let bridge: WebViewBridge
    let appState: AppState
    private var timers: [DispatchWorkItem] = []

    init(bridge: WebViewBridge, appState: AppState) {
        self.bridge = bridge
        self.appState = appState
    }

    // MARK: - History

    func loadDemoHistory() {
        let ts = Int(Date().timeIntervalSince1970 * 1000) - 300_000

        let history: [[String: Any]] = [
            [
                "role": "system",
                "content": [["type": "text", "text": "Model changed to **claude-sonnet-4-5**"]],
                "timestamp": ts,
                "id": "demo-sys-1",
            ],
            [
                "role": "user",
                "content": [["type": "text", "text": "Show me what MobileClaw can do!"]],
                "timestamp": ts + 1000,
                "id": "demo-u-1",
            ],
            [
                "role": "assistant",
                "content": [
                    ["type": "thinking", "text": "The user wants to see all UI features. Let me demonstrate with a tool call and rich markdown."],
                    ["type": "tool_call", "name": "web_search", "arguments": "{\"query\":\"MobileClaw chat UI features\"}", "status": "success", "result": "{\"results\":[{\"title\":\"MobileClaw — Mobile-First Chat UI\",\"url\":\"https://github.com/user/mobileclaw\"}]}"],
                    ["type": "text", "text": "## Demo Response\n\n```typescript\nconsole.log(\"Hello from MobileClaw!\");\n```\n\nYou're absolutely right!\n\nRun **/help** to discover all the features."],
                ],
                "timestamp": ts + 5000,
                "id": "demo-a-1",
                "thinkingDuration": 3.2,
            ],
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: history),
              let json = String(data: data, encoding: .utf8) else { return }

        let js = """
        (function() {
            var msgs = \(json);
            window.__bridge?.receive({ type: 'messages:history', payload: msgs });
            setTimeout(function() {
                window.__bridge?.receive({ type: 'scroll:toBottom' });
            }, 100);
        })()
        """
        Task { @MainActor in
            _ = try? await bridge.webView?.evaluateJavaScript(js) as Any?
        }
    }

    // MARK: - Send message

    func sendMessage(text: String) {
        cancelTimers()
        let runId = "demo-run-\(Int(Date().timeIntervalSince1970 * 1000))"
        let response = matchResponse(text)
        let ts = { Int(Date().timeIntervalSince1970 * 1000) }

        appState.isRunActive = true
        appState.isStreaming = true

        var delay: TimeInterval = 0.3

        // Stream start
        schedule(after: delay) { [self] in
            bridge.send(.streamStart(runId: runId, ts: ts()))
        }
        delay += 0.2

        // Thinking — send each word as an incremental delta (not accumulated)
        if let thinking = response.thinking {
            let chunks = splitForStreaming(thinking)
            for chunk in chunks {
                let delta = chunk
                schedule(after: delay) { [self] in
                    bridge.send(.streamReasoningDelta(runId: runId, delta: delta, ts: ts(), blockStart: false))
                }
                let trimmed = chunk.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { delay += 0.02 }
            }
            delay += 0.4
        }

        // Tool calls
        if let toolCalls = response.toolCalls {
            for tc in toolCalls {
                let name = tc.name
                let args = tc.args
                let result = tc.result
                let isError = tc.isError
                let toolCallId = tc.toolCallId ?? "demo-tc-\(Int.random(in: 1000...9999))"

                schedule(after: delay) { [self] in
                    bridge.send(.streamToolStart(runId: runId, name: name, args: args, toolCallId: toolCallId, ts: ts()))
                }
                delay += tc.delayMs
                schedule(after: delay) { [self] in
                    bridge.send(.streamToolResult(runId: runId, name: name, toolCallId: toolCallId, result: result, isError: isError))
                }
                delay += 0.3
            }
        }

        // Extra delay
        delay += response.extraDelay

        // Text content — stream word by word or instant
        if response.instant {
            schedule(after: delay) { [self] in
                bridge.send(.streamContentDelta(runId: runId, delta: response.text, ts: ts()))
            }
        } else {
            let words = splitForStreaming(response.text)
            for word in words {
                schedule(after: delay) { [self] in
                    bridge.send(.streamContentDelta(runId: runId, delta: word, ts: ts()))
                }
                let trimmed = word.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty { continue }
                if trimmed.hasSuffix(".") || trimmed.hasSuffix("!") || trimmed.hasSuffix("?") {
                    delay += 0.08 + Double.random(in: 0...0.06)
                } else if trimmed.hasSuffix(",") || trimmed.hasSuffix(";") || trimmed.hasSuffix(":") {
                    delay += 0.04 + Double.random(in: 0...0.03)
                } else {
                    delay += 0.02 + Double.random(in: 0...0.025)
                }
            }
        }

        delay += 0.2
        schedule(after: delay) { [self] in
            appState.isRunActive = false
            appState.isStreaming = false
            bridge.send(.streamEnd)
        }
    }

    func stop() {
        cancelTimers()
        appState.isRunActive = false
        appState.isStreaming = false
        bridge.send(.streamEnd)
    }

    // MARK: - Response matching

    private struct DemoResponse {
        var thinking: String?
        var toolCalls: [DemoToolCall]?
        var text: String
        var extraDelay: TimeInterval = 0
        var instant: Bool = false
    }

    private struct DemoToolCall {
        let name: String
        let args: String
        let result: String
        var isError: Bool = false
        var delayMs: TimeInterval = 1.0
        var toolCallId: String?
    }

    private func matchResponse(_ input: String) -> DemoResponse {
        let lower = input.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

        // Slash commands
        if lower.hasPrefix("/help") { return helpResponse }
        if lower.hasPrefix("/commands") { return commandsResponse }
        if lower.hasPrefix("/status") { return statusResponse }
        if lower.hasPrefix("/model") { return modelResponse }
        if lower.hasPrefix("/") { return DemoResponse(text: "Command not available in demo mode. Try /help to see available commands.", instant: true) }

        // Keywords
        if lower.contains("weather") || lower.contains("forecast") { return weatherResponse }
        if lower.contains("code") || lower.contains("function") { return codeResponse }
        if lower.contains("think") || lower.contains("reason") { return thinkResponse }
        if lower.contains("error") || lower.contains("fail") { return errorResponse }
        if lower.contains("research") || lower.contains("search") { return researchResponse }
        if lower.contains("help") || lower.contains("demo") { return helpResponse }

        return defaultResponse
    }

    // MARK: - Responses

    private var weatherResponse: DemoResponse {
        DemoResponse(
            thinking: "The user is asking about weather. I'll use the weather tool to get current conditions.",
            toolCalls: [
                DemoToolCall(
                    name: "weather",
                    args: "{\"location\":\"San Francisco, CA\",\"units\":\"imperial\"}",
                    result: "{\"location\":\"San Francisco, CA\",\"temperature\":\"64°F\",\"condition\":\"Foggy\",\"humidity\":\"82%\"}",
                    delayMs: 1.5
                ),
            ],
            text: "Here's the current weather in **San Francisco, CA**:\n\n- **Temperature:** 64°F — Foggy\n- **Humidity:** 82%\n- **Wind:** 15 mph from the west\n\n**3-day forecast:**\n\n| Day | High | Low | Condition |\n|-----|------|-----|-----------|\n| Tomorrow | 68°F | 55°F | Partly Cloudy |\n| Wednesday | 71°F | 58°F | Sunny |\n| Thursday | 63°F | 52°F | Rain |\n\nTypical Karl the Fog morning — should clear up by midweek!"
        )
    }

    private var codeResponse: DemoResponse {
        DemoResponse(
            thinking: "The user wants to see code. I'll read an example file and show a utility function.",
            toolCalls: [
                DemoToolCall(
                    name: "read",
                    args: "{\"file_path\":\"/projects/app/src/hooks/useSearch.ts\"}",
                    result: "import { useState, useCallback } from 'react';\nimport { debounce } from '../utils/debounce';",
                    delayMs: 0.6
                ),
            ],
            text: "Here's a `debounce` utility:\n\n```typescript\nfunction debounce<T extends (...args: unknown[]) => void>(\n  fn: T,\n  delayMs: number\n): (...args: Parameters<T>) => void {\n  let timer: ReturnType<typeof setTimeout>;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), delayMs);\n  };\n}\n```\n\nIt avoids firing API calls on every keystroke — only triggers after the user stops typing for 300ms.\n\n> **Tip:** Wrap with `useCallback` so the debounced instance is stable across renders."
        )
    }

    private var thinkResponse: DemoResponse {
        DemoResponse(
            thinking: "Let me think through this step by step.\n\nThe user wants to see the thinking/reasoning feature. I should demonstrate it with an interesting problem.\n\nThe 8 balls problem: Split into groups of 3. Weigh 3 vs 3. If balanced: heavy ball is in the remaining 2. If unbalanced: take the heavier group, weigh 1 vs 1. Answer: 2 weighings.",
            text: "## The 8 Balls Problem\n\n**Given:** 8 identical-looking balls, one is heavier. You have a balance scale.\n\n**Answer: 2 weighings** — here's why:\n\n1. **Divide into groups:** 3 | 3 | 2\n2. **Weigh the two groups of 3:**\n   - If balanced → heavy ball is in the group of 2 → weigh them → **done in 2**\n   - If unbalanced → take the heavier group → weigh 1 vs 1 → **done in 2**\n\nThis is the same principle behind *ternary search*!"
        )
    }

    private var errorResponse: DemoResponse {
        DemoResponse(
            thinking: "The user wants to see error states. I'll attempt commands that will fail.",
            toolCalls: [
                DemoToolCall(name: "exec", args: "{\"command\":\"cat /etc/shadow\"}", result: "Error: Permission denied", isError: true, delayMs: 0.8),
                DemoToolCall(name: "exec", args: "{\"command\":\"sudo cat /etc/shadow\"}", result: "Error: sudo requires a TTY", isError: true, delayMs: 1.0),
            ],
            text: "Both attempts failed — the first due to **file permissions**, the second because `sudo` requires an interactive terminal.\n\nIn a real OpenClaw session, sensitive operations go through the **approval system**.\n\n> Use `/approve` to manage execution permissions for your agent."
        )
    }

    private var researchResponse: DemoResponse {
        DemoResponse(
            thinking: "I'll search the web for information and synthesize the findings.",
            toolCalls: [
                DemoToolCall(name: "web_search", args: "{\"query\":\"OpenClaw AI agent platform\"}", result: "{\"results\":[{\"title\":\"OpenClaw — Open-Source AI Agent Platform\"}]}", delayMs: 1.8),
                DemoToolCall(name: "read", args: "{\"file_path\":\"https://openclaw.dev/docs/overview\"}", result: "# OpenClaw Overview\nSelf-hosted AI agent platform with tool execution.", delayMs: 1.2),
            ],
            text: "## OpenClaw — AI Agent Platform\n\n- **Multi-model** — supports OpenAI, Anthropic, Google\n- **Real-time streaming** — WebSocket protocol\n- **Tool execution** — extensible skill system\n- **Cross-platform** — Telegram, Discord, Slack, Web\n- **Sub-agents** — spawn child agents for parallel work\n\n> MobileClaw is the mobile-first client for OpenClaw's gateway protocol."
        )
    }

    private var helpResponse: DemoResponse {
        DemoResponse(
            text: "## Demo Mode Commands\n\nTry these keywords:\n\n| Keyword | What it shows |\n|---------|---------------|\n| **weather** | Thinking + tool call + formatted result |\n| **code** | Thinking + file read + code blocks |\n| **think** | Extended reasoning + markdown |\n| **error** | Tool calls that error |\n| **research** | Multi-step web search |\n| **help** | This list |\n\nSlash commands: **/commands**, **/status**, **/model**\n\nTo connect to a real server, tap the claw icon.",
            instant: true
        )
    }

    private var commandsResponse: DemoResponse {
        DemoResponse(text: "/help · /commands · /status · /model · /compact · /whoami · /context", instant: true)
    }

    private var statusResponse: DemoResponse {
        DemoResponse(text: "**Session Status**\n\nModel: claude-sonnet-4-5 (Anthropic)\nSession: demo-ios\nMode: demo", instant: true)
    }

    private var modelResponse: DemoResponse {
        DemoResponse(text: "Current model: **claude-sonnet-4-5** (Anthropic)\n\nAvailable models:\n- claude-sonnet-4-5 (Anthropic) · 200k context\n- claude-opus-4-5 (Anthropic) · 200k context · reasoning\n- gpt-4o (OpenAI) · 128k context", instant: true)
    }

    private var defaultResponse: DemoResponse {
        DemoResponse(
            thinking: "The user sent a message that doesn't match a demo trigger.",
            text: "I'm running in **demo mode** — no backend server is connected.\n\nTry:\n- `weather` — thinking + tool call + formatted result\n- `code` — file reading + code blocks\n- `research` — multi-step web search\n- `think` — extended reasoning\n- `error` — tool failures\n- `help` — full command list"
        )
    }

    // MARK: - Timer helpers

    private func schedule(after seconds: TimeInterval, action: @escaping () -> Void) {
        let item = DispatchWorkItem(block: action)
        timers.append(item)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
    }

    private func cancelTimers() {
        timers.forEach { $0.cancel() }
        timers.removeAll()
    }

    private func splitForStreaming(_ text: String) -> [String] {
        // Split on whitespace boundaries, keeping the whitespace
        var result: [String] = []
        var current = ""
        for char in text {
            if char.isWhitespace && !current.isEmpty {
                result.append(current + String(char))
                current = ""
            } else {
                current += String(char)
            }
        }
        if !current.isEmpty { result.append(current) }
        return result
    }
}
