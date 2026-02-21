# MobileClaw — Project Instructions

## Overview

MobileClaw is a mobile-first chat UI for the [OpenClaw](https://github.com/user/openclaw) agent platform. Built with Next.js 16, Tailwind CSS v4, and zero component libraries. The UI has been modularized into focused components.

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **Tailwind CSS v4** with OKLch color tokens
- **TypeScript** (strict mode disabled for speed)
- **Geist font** via `geist` package (sans + mono)
- **pnpm** — package manager (do NOT use npm or create package-lock.json)
- **Vitest** for unit testing
- No component library — all UI is hand-rolled with inline SVG icons

## File Layout

```
app/
  page.tsx            — main page, state management, backend switching
  layout.tsx          — root layout, fonts, metadata
  globals.css         — Tailwind config, OKLch color tokens, dark mode
  LocatorProvider.tsx — dev-only tree locator (v0 tooling)
  api/lmstudio/       — proxy for LM Studio API calls

components/
  ChatInput.tsx       — message input with command autocomplete
  CommandSheet.tsx    — slash command picker
  MessageRow.tsx      — individual message rendering
  SetupDialog.tsx     — backend selection (OpenClaw/LM Studio/Demo)
  StreamingText.tsx   — animated text streaming
  ThinkingIndicator.tsx — reasoning/thinking display
  ToolCallPill.tsx    — tool call status badges
  ImageThumbnails.tsx — image attachment previews

lib/
  lmStudio.ts         — LM Studio OpenAI-compatible client with SSE streaming
  useWebSocket.ts     — WebSocket hook for OpenClaw with reconnect backoff
  demoMode.ts         — demo mode handler, mock history, keyword responses
  toolDisplay.ts      — maps tool names/args to human-friendly labels
  messageUtils.ts     — message content helpers
  notifications.ts    — push notification support
  utils.ts            — general utilities

types/
  chat.ts             — shared TypeScript types (Message, ContentPart, etc.)

dev-notes/            — per-session dev notes documenting implementation decisions,
                        animation patterns, and non-obvious technical details.
                        One markdown file per session, named YYYY-MM-DD_topic.md.
```

## Development

```bash
pnpm install
pnpm run dev         # http://localhost:3000 (Turbopack)
pnpm run build       # production build
pnpm test            # run Vitest tests (63 tests)
```

## Backend Modes

MobileClaw supports three backend modes, selectable in the setup dialog:

### 1. OpenClaw (WebSocket)
- Connects to OpenClaw gateway via WebSocket
- Full agent capabilities, tool execution, reasoning streams
- Requires URL and optional auth token

### 2. LM Studio (HTTP/SSE)
- Connects to local LM Studio server (OpenAI-compatible API)
- Supports `<think>...</think>` tag parsing for reasoning models
- Auto-detects models that skip opening `<think>` tag
- `onStreamStart` fires after HTTP 200 (confirms server is processing)

### 3. Demo Mode
- Fully client-side simulation, no server required
- Visit `localhost:3000?demo` to auto-enter
- Or leave URL empty in setup dialog and click "Start Demo"
- Keywords trigger different responses: "weather", "code", "think", "error", "research", "agent", "help"

## Testing LM Studio Locally

1. Start LM Studio and load a model
2. Enable the local server (default: `http://localhost:1234`)
3. Run `pnpm run dev`
4. In setup dialog, select "LM Studio", enter `http://localhost:1234`
5. Select your model from the dropdown
6. Send a message — "Thinking..." appears when server accepts request

## Logging

- **Debug log**: `lib/debugLog.ts` posts structured entries to `/api/log` (route: `app/api/log/route.ts`) which appends to `logs.jsonl` in the project root
- **What's logged**: chat events (`logChatEvent`) and agent events (`logAgentEvent`) — structured one-line JSONL with timestamps
- **What's NOT logged**: raw WS message frames, `res:` responses (e.g. subhistory responses, config responses) — these are only visible in browser DevTools WS frames tab
- **WS connection lifecycle**: logged to browser console (`[WS] Connection opened`, `[WS] Connection closed`, etc.) via `lib/useWebSocket.ts`

## Key Conventions

- **Modular components**: UI split into focused components in `components/`
- **Shared types**: all types in `types/chat.ts`
- **No component library**: use raw HTML elements + Tailwind classes
- **Inline SVG icons**: no icon library — copy SVG directly into JSX
- **OKLch colors**: all color tokens in `globals.css` use `oklch()` — never use hex or named colors
- **Mobile-first**: `h-dvh` viewport, touch handlers, iOS Safari fixes
- **CSS variable animations**: scroll morph bar uses `--sp` CSS custom property for 60fps animations

## Recent Changes (Feb 2025)

### Merged PRs
- **PR #3**: Expandable ChatInput textarea (auto-grows with content)
- **PR #4**: Comprehensive test suite (63 Vitest tests covering components, utils, handlers)
- **PR #5**: Push notifications when agent completes (with iOS PWA safety)
- **PR #6**: Migrated from next/font/google to `geist` package

### Other Improvements
- LM Studio `onStreamStart` now fires after HTTP 200 (accurate "Thinking..." timing)
- WebSocket handler refactored into sub-handlers for cleaner code
- iOS keyboard layout fixes for Safari PWA
- Font CSS variables properly reference geist package vars

## Push Notifications

- Requests permission on first message send
- Notifies when agent finishes responding (if tab not focused)
- Safe try/catch wrapper for iOS PWA edge cases
- See `lib/notifications.ts`

## WebSocket Protocol (OpenClaw)

MobileClaw connects to OpenClaw's gateway WebSocket. Protocol frames:

1. **Server sends** `event:connect.challenge` with nonce
2. **Client responds** with `req:connect` including auth token, capabilities
3. **Server responds** with `res:hello-ok` including server info, session snapshot
4. **Client requests** `req:chat.history` to load message history
5. **Messages flow** via `event:chat` (delta/final/aborted/error) and `event:agent` (content/tool/reasoning/lifecycle streams)
6. **Client sends** `req:chat.send` with user messages

<cicada>
  **ALWAYS use cicada-mcp tools for Elixir and Python code searches. NEVER use Grep/Find for these tasks.**

  ### Use cicada tools for:
  - YOUR PRIMARY TOOL - Start here for ALL code exploration and discovery. `mcp__cicada__query`
  - DEEP-DIVE TOOL: View a module's complete API and dependencies after discovering it with query. `mcp__cicada__search_module`
  - DEEP-DIVE TOOL: Find function definitions and call sites after discovering with query. `mcp__cicada__search_function`
  - UNIFIED HISTORY TOOL: One tool for all git history queries - replaces get_blame, get_commit_history, find_pr_for_line, and get_file_pr_history. `mcp__cicada__git_history`
  - DRILL-DOWN TOOL: Expand a query result to see complete details. `mcp__cicada__expand_result`
  - Force refresh the code index to pick up recent file changes. `mcp__cicada__refresh_index`
  - ADVANCED: Execute jq queries directly against the Cicada index for custom analysis and data exploration. `mcp__cicada__query_jq`

  ### DO NOT use Grep for:
  - ❌ Searching for module structure
  - ❌ Searching for function definitions
  - ❌ Searching for module imports/usage

  ### You can still use Grep for:
  - ✓ Non-code files (markdown, JSON, config)
  - ✓ String literal searches
  - ✓ Pattern matching in single line comments
</cicada>
