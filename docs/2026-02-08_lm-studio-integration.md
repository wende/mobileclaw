# LM Studio Integration Session — 2026-02-08

## Summary

Added full LM Studio backend support to MobileClaw, including CORS proxying, thinking block parsing, server-side tool execution, and production deployment via Tailscale.

## What was done

### 1. Branch setup & remote cleanup

- Fetched the `claude/add-lm-studio-support-dOooD` branch from the `mobileclaw` remote
- Removed the old `origin` (v0-mobileclaw) and renamed `mobileclaw` to `origin`
- Checked out the branch and verified it builds

### 2. CORS proxy (`app/api/lmstudio/route.ts`)

The browser can't call LM Studio directly due to CORS. Created a Next.js API route that proxies requests:

- **GET** `/api/lmstudio?url=<baseUrl>&path=<apiPath>` — proxies model listing
- **POST** `/api/lmstudio` — proxies chat completions with SSE streaming

Updated `lib/lmStudio.ts` to route all requests through `/api/lmstudio` instead of hitting LM Studio directly.

### 3. Thinking block parsing (`<think>` tags)

Qwen3 and similar models output reasoning inside `<think>...</think>` tags in the content stream (rather than using the `reasoning_content` field). Added a streaming parser in `lib/lmStudio.ts` that:

- Detects `<think>` and `</think>` tags across chunk boundaries
- Routes thinking content to `onThinking` callback (renders in collapsible reasoning UI)
- Routes regular content to `onTextDelta` callback
- Handles partial tag matches at chunk boundaries via `partialTagSuffix()` helper

### 4. Model switching fix

The `useEffect` that creates the LM Studio handler only depended on `[backendMode]`. Changing the model in settings updated the config ref but didn't recreate the handler. Fixed by adding `currentModel` to the dependency array.

### 5. Server-side tool execution (`app/api/lmstudio/tools.ts`)

LM Studio's built-in chat UI has DuckDuckGo and web browsing tools (via `danielsig/duckduckgo` and `danielsig/visit-website` plugins). These don't execute when using the API directly. Implemented server-side equivalents:

**Tool definitions** (injected into the `tools` array of chat completion requests):
- `Web_Search` — DuckDuckGo web search, returns ranked links
- `Image_Search` — DuckDuckGo image search
- `Visit_Website` — fetches a URL, extracts title/headings/links/text

**Agentic loop** in the proxy route:
1. Sends request to LM Studio with tool definitions
2. Streams response to client (text, thinking, tool call deltas)
3. If `finish_reason: "tool_calls"`, executes tools server-side
4. Sends custom `tool_execution` SSE events so client shows tool pills
5. Feeds tool results back to LM Studio as `role: "tool"` messages
6. Loops (up to 5 rounds) until model produces a final text response

### 6. Tool pill UI fixes

- Moved tool pills to render **above** text content in assistant messages (was below)
- Fixed duplicate spinning pills: removed `onToolStart` from `delta.tool_calls` handler — now only server-side `tool_execution` events drive tool pill creation/finalization
- Tool pills now show tool name and arguments (server sends `args` in the running event)

### 7. Production deployment via Tailscale

- Built production bundle (`pnpm run build`)
- Started production server on port 3100 (`PORT=3100 pnpm run start`)
- Configured Tailscale serve to proxy HTTPS :3000 to localhost:3100
- Accessible at `https://krzysztofs-mac-studio.tail657ea.ts.net:3000/`

### 8. Split thinking blocks around tool calls

When a Qwen model thinks, uses a tool, then thinks again, both thinking segments were rendered as a single merged thinking pill. Fixed by modeling thinking as content parts interleaved with tool calls:

**`lib/lmStudio.ts`** — segment tracking:
- Added `thinkingSegment` counter alongside `fullThinking`
- On `tool_execution` with `status === "running"`: reset `fullThinking = ""` and increment `thinkingSegment++`
- Updated `onThinking` callback signature to `(runId, text, segment)` so the UI can track which segment to update

**`app/page.tsx`** — LM Studio `onThinking` callback:
- Instead of setting `message.reasoning`, manages `{ type: "thinking", text }` content parts in the content array, indexed by segment number
- New segments always push to the end of the array (not before text parts — that was causing ordering bugs where all thinking clustered before tool calls)

**`app/page.tsx`** — message renderer:
- Checks for `thinking` content parts in the content array
- If found, renders them interleaved with `tool_call` parts in array order (each thinking segment gets its own collapsible pill)
- Filters out empty/whitespace-only thinking parts (residue from `<think>` tag boundaries)
- Falls back to `message.reasoning` for OpenClaw/demo messages (backward compat)

**Bug fix during implementation**: The initial version inserted new thinking parts *before the text part* in the content array. But whitespace between `</think>` and `<think>` tags leaked as text deltas, placing a text part before tool_calls — so new thinking segments ended up before tool_calls too, breaking the interleaved order.

## Files changed

| File | Change |
|------|--------|
| `app/api/lmstudio/route.ts` | New — CORS proxy + agentic tool loop |
| `app/api/lmstudio/tools.ts` | New — tool definitions + server-side implementations |
| `lib/lmStudio.ts` | Proxy routing, `<think>` parser, tool_execution event handling |
| `app/page.tsx` | Tool pills above text, model switch effect dependency |

## Architecture

```
Browser (MobileClaw UI)
  |
  |-- GET /api/lmstudio?url=...&path=/v1/models  (model list)
  |-- POST /api/lmstudio                          (chat + tools)
  |
Next.js API Route (proxy + tool executor)
  |
  |-- GET  LM Studio /v1/models
  |-- POST LM Studio /v1/chat/completions (streaming)
  |     |
  |     |-- if finish_reason: "tool_calls"
  |     |     |-- execute Web_Search / Image_Search / Visit_Website
  |     |     |-- send tool_execution SSE events to client
  |     |     |-- feed results back to LM Studio
  |     |     |-- loop until text response
  |     |
  |     |-- stream text/thinking/tool deltas to client
  |
LM Studio (localhost:1234)
```
