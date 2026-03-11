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

## Development

```bash
pnpm install
pnpm run dev         # http://localhost:3000 (Turbopack)
pnpm run build       # production build
pnpm test            # run Vitest tests (63 tests)
```

- Whenever making web changes for purposes of iOS ALWAYS run `make build-web` after completing the task.
- Run `make pr-comments` to review current PR comments.

## Logging

- **Debug log**: `lib/debugLog.ts` posts structured entries to `/api/log` (route: `app/api/log/route.ts`) which appends to `logs.jsonl` in the project root
- **What's logged**: chat events (`logChatEvent`), agent events (`logAgentEvent`), and WS frames (`logWsFrame`) — structured one-line JSONL with timestamps
- **WS frame logging**: `logWsFrame(direction, frame)` in `debugLog.ts`, called from `lib/useWebSocket.ts` on every send/receive; noisy content/reasoning deltas are suppressed
- **Agent-side logging**: `~/.8claw/agent.jsonl` captures full exchange — WS frames, run_start (with full message history), tool_call/result, run_end with text+stats
- **WS connection lifecycle**: logged to browser console (`[WS] Connection opened`, `[WS] Connection closed`, etc.) via `lib/useWebSocket.ts`

## Key Conventions

- **Modular components**: UI split into focused components in `components/`
- **Shared types**: all types in `types/chat.ts`
- **No component library**: use raw HTML elements + Tailwind classes
- **Inline SVG icons**: no icon library — copy SVG directly into JSX
- **OKLch colors**: all color tokens in `globals.css` use `oklch()` — never use hex or named colors
- **Mobile-first**: `h-dvh` viewport, touch handlers, iOS Safari fixes
- **CSS variable animations**: scroll morph bar uses `--sp` CSS custom property for 60fps animations

## iOS App

MobileClaw has a native iOS app that wraps the webapp in a WKWebView. See [`ios/CLAUDE.md`](ios/CLAUDE.md) for details.

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
