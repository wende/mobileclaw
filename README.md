# OpenClaw Chat UI

A minimal, animated chat interface for [OpenClaw](https://github.com/user/openclaw) with real-time streaming simulation. Built with Next.js 16, Tailwind CSS v4, and zero external UI dependencies beyond shadcn primitives.

---

## What Works

### Chat Interface
- Mobile-first layout with `h-dvh` viewport, sticky header, sticky footer
- User messages (right-aligned bubble) and assistant messages (left-aligned with avatar)
- System messages (centered pill)
- Unknown / non-standard roles render gracefully as muted centered pills
- Auto-scroll to bottom on new messages

### Markdown Rendering (assistant messages)
- Headings (`#`, `##`, `###`)
- **Bold** and *italic* inline formatting
- `Inline code` spans
- Fenced code blocks with language label and copy-to-clipboard button
- Unordered lists (with nesting support)
- Ordered / numbered lists
- Blockquotes
- Tables with header row
- `[Links](url)` opening in new tab

### Tool Calls and Results
- Tool call pills with expandable JSON arguments
- Tool call lifecycle animation: `running` (spinner) -> `success` (wrench icon) / `error` (x icon)
- Tool result blocks with success/error styling, expandable output
- Visual linking via indented layout under assistant messages

### Agent Event / Tool Stream Simulation
- Streamed responses simulate word-by-word typing with variable delay (20-60ms)
- Streaming cursor (pulsing caret) during generation
- Tool calls appear mid-stream with animated `running` -> `success` transition
- Stop button to abort streaming mid-generation

### Thinking / Reasoning
- Collapsible `<details>` block showing reasoning text when present on a message

### Image Support (structural)
- `ImageThumbnails` component handles `image` and `image_url` content parts
- Renders placeholder thumbnails when no valid `src` is available

### Command Palette
- Slide-up bottom sheet with all OpenClaw slash commands
- Grouped by category: Status, Management, Media, Tools, Docks
- Search/filter across command names and descriptions
- Tap to fill command into input, tap backdrop to dismiss
- Keyboard dismiss with Escape, body scroll lock when open

### Other
- Dark mode support via CSS custom properties
- Frosted glass header/footer with `backdrop-blur-xl`
- Responsive: mobile-first, scales to desktop with `max-w-2xl` content width

---

## What Is Mocked

| Feature | How it's mocked |
|---------|----------------|
| **Message history** | Hardcoded `INITIAL_MESSAGES` array (based on `complexMultiToolConversation` from dummy data JSON) |
| **Streaming responses** | `setTimeout` chain simulating word-by-word delivery; keyword-matched response sets (`weather`, `code`, `error`, `markdown`, `thinking`) |
| **Tool execution** | Tool call status transitions (`running` -> `success`) are time-delayed, not driven by real events |
| **WebSocket protocol** | Not implemented. No `requestFrame` / `responseFrame` / `eventFrame` handling. All data is client-side |
| **Agent events** | The `agent` event stream (`toolStart`, `toolComplete`, `assistantStream`, `lifecycleStart/End`) from the dummy data spec is simulated via the tool lifecycle animation, not via real event processing |
| **chat.send / chat.history** | No API calls. `sendMessage` creates a local user message and triggers the mock streamed response |

---

## What's Still To Do

### Connectivity (requires local deployment)
- [ ] WebSocket client connecting to OpenClaw gateway (`ws://localhost:PORT`)
- [ ] Implement `requestFrame` / `responseFrame` / `eventFrame` protocol parsing
- [ ] `chat.history` API call on load to fetch real message history
- [ ] `chat.send` API call to send user messages
- [ ] Real-time `chat` event processing (`delta`, `final`, `aborted`, `error` states)
- [ ] Real-time `agent` event processing (`tool` stream, `assistant` stream, `lifecycle` stream)
- [ ] SSE fallback if WebSocket is unavailable

### Message Types
- [ ] `userWithImage` -- render base64 image data inline in user bubbles
- [ ] `userWithMultipleImages` -- grid layout for multiple attached images
- [ ] `image_url` content parts with actual image loading
- [ ] `toolResultWithJson` -- formatted JSON viewer for structured tool results
- [ ] `stringContent` (legacy format) -- already handled by `getTextFromContent` but not tested end-to-end
- [ ] `emptyContent` / `nullContent` -- graceful empty state rendering

### UI Features
- [ ] `toolCallId` linking -- visually connect a tool result back to the specific tool call that triggered it
- [ ] `usage` display -- show input/output/total token counts on assistant messages
- [ ] `stopReason` indicator -- surface `end_turn` vs other stop reasons
- [ ] `thinkingLevel` from `chatHistoryResponse` -- adjust UI based on thinking level
- [ ] Error state banner for `chat` error events (e.g., "Rate limit exceeded")
- [ ] Aborted state indicator when a stream is cancelled server-side
- [ ] `seq` tracking for ordering and deduplication of events
- [ ] `runId` / `sessionKey` management for multi-session support
- [ ] Message timestamps display
- [ ] Message pagination / virtual scrolling for long histories

### Polish
- [ ] Syntax highlighting in code blocks (e.g., via Shiki or Prism)
- [ ] Copy full message button
- [ ] Message retry / regenerate
- [ ] Input history (up arrow to recall previous messages)
- [ ] Haptic feedback on mobile interactions
- [ ] Swipe-to-dismiss on command palette
- [ ] Keyboard shortcuts (Cmd+K for commands, etc.)

---

## Running Locally

```bash
# Clone from v0
npx shadcn@latest init

# Or download ZIP and:
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Connecting to Local OpenClaw

1. Start your OpenClaw instance locally
2. Replace the mock streaming logic in `app/page.tsx` (the `sendMessage` function and `STREAMED_RESPONSES`) with a real WebSocket client
3. The WebSocket protocol frames are documented in the dummy data JSON (`requestFrame`, `responseFrame`, `eventFrame`)
4. All message types and content part structures are already typed in the `ContentPart` and `Message` interfaces
