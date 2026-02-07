# AGENTS.md — AI Agent Instructions for MobileClaw

## Architecture

MobileClaw is a **single-page** Next.js app. All UI lives in `app/page.tsx` (~2100 lines). This is intentional — do not refactor into separate component files.

### Message Flow

```
User types → sendMessage() → WebSocket req:chat.send
                             ↓
Server streams → event:agent (content/tool/reasoning deltas)
              → event:chat (delta/final/aborted/error)
                             ↓
handleWSMessage() → setMessages() state updates → React re-render
```

In demo mode, `sendMessage()` routes to `demoHandlerRef.current.sendMessage()` which simulates the same flow via `setTimeout` chains.

### State Management

All state is in the `Home` component (React `useState`/`useRef`):

| State | Purpose |
|-------|---------|
| `messages` | Array of `Message` objects — the chat history |
| `isStreaming` | Whether an assistant response is being streamed |
| `streamingId` | ID of the message currently streaming (for cursor) |
| `isDemoMode` | Whether demo mode is active |
| `connectionState` | WebSocket connection status |
| `currentModel` | Display name of the current AI model |
| `showSetup` | Whether the setup dialog is visible |
| `scrollPhase` | "input" or "pill" — controls morph bar animation |

### Streaming Mechanics

1. **StreamingText component**: reveals text character-by-character via `requestAnimationFrame` loop
2. **Auto-scroll**: rAF loop during streaming closes 40% of the gap to bottom per frame
3. **Morph bar**: `--sp` CSS custom property (0=bottom, 1=scrolled) drives smooth input↔pill transition

### Content Parts

Messages use a `ContentPart[]` array with these types:
- `text` — markdown text
- `tool_call` / `toolCall` — tool invocation with name, args, status, result
- `image` / `image_url` — image attachments
- `thinking` — reasoning content (extracted to `message.reasoning`)

## Common Patterns

### Adding a new tool display

Edit `lib/toolDisplay.ts` — add a case to the `switch` in `getToolDisplay()`:

```typescript
case "my_tool": {
  const arg = parsed?.someArg;
  return { label: typeof arg === "string" ? arg : "my_tool", icon: "tool" };
}
```

### Adding a new message type

In `MessageRow` component in `page.tsx`, add handling before the user/assistant rendering:

```typescript
if (message.role === "my_role") {
  return <div>...</div>;
}
```

### Adding a demo response

In `lib/demoMode.ts`, add to the `RESPONSES` object and update `matchResponse()`:

```typescript
myKeyword: {
  text: "Response with **markdown**",
  toolCalls: [{ name: "tool", args: {}, result: "...", delayMs: 1000 }],
  thinking: "Optional reasoning text",
},
```

## Testing Approach

- No test framework is configured — verify by building (`npm run build`) and manual testing
- Demo mode (`?demo`) is the primary way to test UI features without a backend
- Key things to verify: markdown rendering, tool call lifecycle, streaming cursor, scroll behavior, mobile viewport
