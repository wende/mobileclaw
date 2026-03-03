# MobileClaw — Concepts Reference

## 1. Modes

### Dark Mode / Light Mode
- **Hook**: `hooks/useTheme.ts` — provides `theme` and `toggleTheme()`
- **Persistence**: `localStorage("theme")`
- **Mechanism**: Toggles `.dark` class on `<html>`, CSS variables in `globals.css` switch via `:root` / `.dark` selectors
- **Toggle**: Moon/sun icon in `ChatHeader.tsx`

### Zen Mode
- **Hook**: `hooks/useZenMode.ts` — provides `zenExpanded` and `toggleZen()`
- **Persistence**: `localStorage("mobileclaw-zen")`; URL override `?zen` forces it on
- **Effect**: Collapses assistant step blocks (tool calls, thinking) in `ChatViewport.tsx`
- **Toggle**: `ZenToggle.tsx` (circle icon in header)
- **Animation**: Timings in `lib/chat/zenUi.ts` (`ZEN_SLIDE_MS`, `ZEN_FADE_MS`)

### Detached Mode
- **Hook**: `hooks/useAppMode.ts` — provides `isDetached`, `isDetachedRef`, `hideChrome`
- **Activation**: URL param `?detached=true`
- **Effect**: Hides chrome (header, settings), transparent background, adjusted bottom padding — designed for iframe embedding

### Native Mode (iOS)
- **Hook**: `hooks/useAppMode.ts` — provides `isNative`, `isNativeRef`
- **Activation**: URL param `?native=true` or `window.__nativeMode === true`
- **Effect**: Adds `"native"` class to body, hides chrome, transparent background, uses `lib/nativeBridge.ts` for Swift ↔ WebView communication
- **Bootstrap**: Native bridge handler registered in `hooks/chat/useModeBootstrap.ts`

---

## 2. Elements

### A) Blocks

All blocks are rendered inside `MessageRow.tsx`. Block data is represented as `ContentPart` entries in `types/chat.ts`.

#### Thinking Block
- **Type**: `ContentPart` with `type: "thinking"`, or legacy `message.reasoning` field
- **Component**: `ThinkingPill` (inside `MessageRow.tsx`)
- **Behavior**: Collapsible if > 5 lines, animated dots while streaming, extracted from `<think>...</think>` XML tags via `stripThinkTags()`

#### Tool Call Block
- **Type**: `ContentPart` with `type: "tool_call" | "toolCall"` (normalized by `isToolCallPart()`)
- **Component**: `ToolCallPill.tsx`
- **Fields**: `name`, `toolCallId`, `arguments`, `status` (`"running" | "success" | "error"`), `result`, `resultError`
- **Categories**: Terminal, file, robot, gear, globe — each with distinct icon
- **Behavior**: Collapsible results, status animation, context-aware display

#### SubAgent Block
- **Type**: Tool call where `name === SPAWN_TOOL_NAME` (`"sessions_spawn"`)
- **Components**: `ToolCallPill.tsx` (inline) / `FloatingSubagentPanel.tsx` (pinned)
- **Store**: `hooks/useSubagentStore.ts` — tracks subagent lifecycle
- **Behavior**: Shows task name, model, collapsible activity feed (text/tool/reasoning events), swipe-to-unpin gesture

#### Context Block
- **Type**: `Message` with `isContext: true`
- **Component**: `ContextPill` (inside `MessageRow.tsx`)
- **Detection**: `isContextText()` checks against prefixes in `shared/contextPrefixes.json`
- **Subtypes**: System context, system message context, queued announcement context
- **Display**: Collapsible pill with info icon

#### User Injected Block
- **Type**: `Message` with `role: "user"` and `isContext: true`
- **Rendering**: Treated as a context pill (context prepended to user messages)

#### [Assistant] Injected Block
- **Type**: `Message` with `role: "assistant"` and `stopReason === STOP_REASON_INJECTED`
- **Component**: `InjectedPill` (inside `MessageRow.tsx`)
- **Subtypes**:
  - **Heartbeat**: Contains `HEARTBEAT_MARKER` — heartbeat icon
  - **No-Reply**: Contains `NO_REPLY_MARKER` — no-reply icon
  - **Info**: Default — info icon
- **Behavior**: Collapsible, shows first-line summary, can expand to show thinking + tool calls

#### Image Block
- **Type**: `ContentPart` with `type: "image" | "image_url"`
- **Components**: `ImageThumbnails.tsx` (grid) / `ImageLightbox.tsx` (modal)

#### File Block
- **Type**: `ContentPart` with `type: "file"`
- **Component**: `FileThumbnails` (inside `MessageRow.tsx`)
- **Display**: Icon badge with extension, file name, optional upload spinner

#### Text Block
- **Type**: `ContentPart` with `type: "text"`
- **Component**: `markdown/MarkdownContent.tsx`
- **Behavior**: Auto-detects and strips `<think>` tags

### B) Other Elements

#### Thinking Indicator
- **Component**: `ThinkingIndicator.tsx`
- **Props**: `visible`, `startTime`, `label` ("Thinking" or "Compacting")
- **Display**: 3-dot animation (1.4s cycle), elapsed-time counter (1s updates), fade in (200ms) / fade out (800ms)

#### Text Input / Chat Input
- **Component**: `ChatInput.tsx` (exposes `ChatInputHandle` via `forwardRef`)
- **Features**: Multi-line auto-grow textarea, file attachment preview strip, quote preview, draft persistence (`localStorage("chatInputDraft")`), morph glass pill (transforms to "Scroll to bottom"), model suggestions dropdown, command autocomplete (`CommandSheet.tsx`)
- **States**: Idle ("Send a message..."), active run ("Queue a message..." / "Replace queued message..."), streaming (input disabled)

#### Send Button
- **Location**: Right side of `ChatInput.tsx`
- **Modes** (crossfade between overlays):
  1. **Send** — idle + has text → blue primary, up-arrow icon
  2. **Abort/Stop** — streaming + no text → red destructive, square icon
  3. **Queue** — streaming + has text + no queued → secondary, append icon
  4. **Disabled** — text present but already queued

#### Attach Files Button
- **Location**: Left of text input pill
- **Icon**: Paperclip SVG
- **Constraints**: Max 50 MB file size, handles paste-from-clipboard, hidden when `uploadDisabled` (native app can disable)

### C) ChatBox (Main Body)
- **Component**: `chat/ChatViewport.tsx`
- **Features**: Scrollable container (`scrollRef`), pull-to-refresh spinner, message list via `displayMessages` array, bottom sentinel for scroll tracking, zen mode group collapse/expand with slide animation, quote popup for text selection, time gap indicators (10+ min gaps)

### D) Header
- **Component**: `ChatHeader.tsx`
- **Elements** (left to right):
  1. Settings button (logo) — opens `SetupDialog`
  2. Session pill (center) — session name, model name, loading spinner
  3. Theme toggle — moon/sun icon
  4. Zen toggle — zen circle icon
  5. Connection status dot — green (connected), yellow pulsing (connecting), red (disconnected), blue (demo)
- **Backdrop**: Semi-transparent blur with OKLch color at 70% opacity

### E) Settings Dialog
- **Component**: `SetupDialog.tsx`
- **Sections** (one per meta mode):
  - **OpenClaw**: WS URL + token, saved config history (localStorage FIFO, limit 10)
  - **LM Studio**: HTTP base URL, API key, model dropdown
  - **Demo**: Pre-loaded demo history, no connection needed
- **Features**: Phase-based animation (idle → entering → open → closing → closed), form validation, connection error display, model selection, remember checkbox

---

## 3. Meta Modes (Backend Selection)

`BackendMode = "openclaw" | "lmstudio" | "demo"` — defined in `types/chat.ts`

### OpenClaw (Default)
- **Runtime**: `hooks/chat/useOpenClawRuntime.ts`
- **Protocol**: WebSocket (`lib/useWebSocket.ts`)
- **Flow**: Challenge → connect → hello-ok → history → event streams (`event:chat`, `event:agent`)
- **Features**: Session switching, model selection, slash commands, full agent protocol

### LM Studio
- **Runtime**: `hooks/chat/useLmStudioRuntime.ts`
- **Client**: `lib/lmStudio.ts`
- **Protocol**: HTTP REST (`/v1/models`, `/v1/chat/completions`)
- **Features**: Streaming JSON chunks, local-only message history (`localStorage("lmstudio-messages")`)
- **Config**: `localStorage("lmstudio-url")`, `"lmstudio-model"`, `"lmstudio-apikey"`

### Demo
- **Runtime**: `hooks/chat/useDemoRuntime.ts`
- **Simulator**: `lib/demoMode.ts`
- **Activation**: URL param `?demo=true`
- **Features**: Pre-loaded `DEMO_HISTORY`, simulated agent responses with configurable timing, demonstrates tool calls/thinking/subagents — no backend required

### Mode Bootstrap
- **Hook**: `hooks/chat/useModeBootstrap.ts`
- **Init flow**: `?demo` → demo | native → wait for Swift config | `?detached&url=` → auto-connect | saved mode from localStorage | fallback → show setup dialog

---

## 4. State Management

No global state library — pure React hooks + localStorage + refs.

| Concern | Location |
|---|---|
| Messages, streaming, connection | `app/page.tsx` |
| Subagent lifecycle | `hooks/useSubagentStore.ts` |
| Scroll position, morph animation | `hooks/useScrollManager.ts` |
| Zen mode | `hooks/useZenMode.ts` |
| Theme | `hooks/useTheme.ts` |
| Detached / Native detection | `hooks/useAppMode.ts` |
| Thinking indicator | `hooks/useThinkingState.ts` |
| Message send / queue | `hooks/chat/useMessageSender.ts` |

---

## 5. Key Types

Defined in `types/chat.ts`:

```
ContentPartType = "text" | "tool_call" | "toolCall" | "thinking" | "image" | "image_url" | "file"
MessageRole     = "user" | "assistant" | "system" | "tool" | "toolResult" | "tool_result"
BackendMode     = "openclaw" | "lmstudio" | "demo"
AgentStreamType = "lifecycle" | "content" | "tool" | "reasoning" | "assistant" | "error"
```
