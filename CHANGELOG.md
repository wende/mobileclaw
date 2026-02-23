# Changelog

All notable changes to MobileClaw are documented in this file.

## 2026-02-23

### Added
- Command response pills — slash commands render as expandable pills with spinner and auto-expand animation
- `CommandResponsePill` component with CSS-only `gridSlideOpen` animation (no JS timing needed)
- `isCommandResponse` and `isHidden` flags on `Message` type for slash command UX
- `getEffectiveRunId` — maps server run IDs to client placeholder IDs for seamless command response filling
- `parseServerCommands()` — parses `/commands` text output into structured `Command[]`
- `formatCommandsText()` — renders command groups as human-readable text for local `/commands` response
- Demo mode slash command responses (`/commands`, `/status`, `/whoami`, `/context`, `/model`) with instant delivery
- `--lp` CSS variable (layout progress) — deadzone-adjusted `--sp` that stays 0 until scroll > 5%, prevents subpixel rounding shifts at the start of morph transitions
- Message send pop animation (scale 0.6→1.04→1 with spring easing, origin bottom-right)
- GitHub Actions CI workflow (#10)

### Fixed
- Morph bar subpixel jitter — layout-affecting properties (`width`, `height`, `gap`, `padding`) now use `--lp` (deadzone) instead of raw `--sp`
- Pull-to-refresh state stuck after backgrounding app — reset on visibilitychange
- Hidden slash command messages filtered from display loop (no stale timestamps)
- Tool call parts normalized from server history (status, toolCallId, arguments)
- HEARTBEAT_OK now requires its own line to trigger heartbeat handling (#9)

### Changed
- Command palette trimmed — reorganized into Session / Options / Status / Skills / More groups with fewer commands
- `/compact` command label shown in thinking indicator and tab title
- Persist run-active state across page refresh
- Server-echoed user messages and system-injected context handling
- File uploads switched from catbox.moe (permanent) to Litterbox (temporary, 72h expiry)
- Attachment picker accepts all file types (was image-only); non-image files show as named pills
- Attach button icon changed from image to paperclip
- Upload size limit raised to 50MB (was 5MB)
- Native `attachments` field sent alongside URL text for vision-capable models
- Notifications only fire when app is backgrounded (visibility check was bypassed by debug code)
- Notifications suppressed for slash command and injected responses

## 2026-02-22

### Added
- Version API route (`/api/version`)

### Fixed
- `/model` picker now shows all configured providers including auth-only ones
- Strip outermost `<final>` tags from assistant message text
- rAF scroll-pinning loop during streaming (prevents tool call pills appearing below viewport)

### Changed
- Renamed page title from "OpenClaw Chat" to "MobileClaw"

## 2026-02-21

### Added
- Context pills — expandable dark pills on user messages for system-injected context
- Injected pills — centered expandable pills for heartbeat/no-reply assistant messages
- Message merging — heartbeat/no-reply messages absorb preceding assistant content
- Animated width expand/collapse for context and injected pills
- Quote-reply — select assistant text to quote it into the input (desktop pointer-up + mobile long-press)
- Abort run — stop button in ChatInput sends `chat.abort` to OpenClaw
- Image attachments — paste, drag-and-drop, or pick images; base64 preview with lightbox
- Image upload API — `/api/upload` proxies to catbox.moe for public image URLs
- Image lightbox — full-screen overlay with click/Escape to dismiss
- Floating subagent panel — pinnable panel with live activity feed and swipe-to-dismiss
- Message queue — type while the agent is running; message auto-sends when the run ends
- QueuePill UI with dismiss button (restores text to input)
- `/compact` slash command in command palette
- `hasUnquotedMarker` utility — detects markers outside double-quoted strings (prevents false positives on quoted NO_REPLY text)
- Demo mode "long"/"essay" keyword for long-form streaming demo
- `SlideContent` component — reusable CSS grid slide animation extracted from ToolCallPill
- `useExpandablePanel` hook — shared width + height animation logic for expandable pills
- `useSwipeAction` hook — swipe-left-to-reveal gesture (iOS mail style)
- `lib/constants.ts` — shared string constants and tool name helpers
- PWA manifest with icons (192px, 512px) and service worker
- Global keydown capture — typing anywhere focuses the input
- `ImageAttachment` type and `chat.abort` WebSocket method

### Fixed
- Service worker only registers on non-localhost (prevents dev caching issues)
- Edit tool pills start expanded when loaded from history (no re-animation)
- Tool pill expand toggle no longer shows for pills with no visible content
- Mobile Enter key detection uses `maxTouchPoints` + UA check (more reliable than `ontouchstart`)
- History enrichment preserves client-side text content (fixes quote-reply newlines lost by server)
- Session reset detection compares against server message count only (prevents false resets from queued messages)
- Subagent history tool results now properly mark tool entries as success/error
- Subagent session status distinguishes new (history-only) vs existing (lifecycle:start) sessions
- Morph bar animation smoothed with exponential lerp (20% per frame) instead of discrete steps
- Draft restore moved to `useEffect` to avoid SSR hydration mismatch
- Removed duplicate `getTextFromContent` in lmStudio.ts (now imported from messageUtils)

### Changed
- Injected pills left-aligned with `bg-card` styling (was centered with `bg-secondary`)
- Context pill text uses `text-primary-foreground/70` for softer contrast
- ChatInput min-height simplified to fixed `46px` (was `calc` with `--sp`)
- ChatInput converted to `forwardRef` with imperative `setValue` handle
- Send button has three crossfading states: stop, queue, send
- `@treelocator/runtime` bumped to 0.3.1 (lazy-imported in dev)
- Notification suppression for heartbeat and no-reply messages
- `toolDisplay.ts` refactored — shared `getFilePath` helper, `parseArgs` exported, tool matching uses `constants.ts` helpers
- `ToolCallPill` accepts `isPinned`/`onPin`/`onUnpin` props for subagent pinning
- `ChatInput` accepts `quoteText`, `isRunActive`, `hasQueued`, `onAbort`, and image attachments
- `SlideContent` extracted from `ToolCallPill` into standalone component
- Removed `CommandSheet` integration from page (commands handled inline)
- Removed mid-stream silence detection timer (replaced by simpler run duration tracking)
- `ToolIcon` gains "gear" icon variant for gateway tools

## 2026-02-20

### Added
- Subagent history panel — view past subagent runs with full activity feed
- Markdown image rendering in assistant messages
- Subagent activity feed with live streaming status
- Mid-run WebSocket reconnect — resumes in-progress agent streams
- Smooth streaming height transitions (`SmoothGrow` component)
- Slide-open animations for tool call pills, spawn pills, and thinking blocks
- Edit tool pills auto-expand with inline diff view on mount
- Read tool pills show path directly in title
- Demo mode "edit"/"fix" keyword with read + edit tool call simulation

### Fixed
- Morph bar width growth regression on wider screens
- Tool call pill icons never showing (JSX element always truthy — now checks status explicitly)
- `scrollbar-hide` utility for subagent activity feed

### Changed
- ThinkingPill rewritten from `<details>` to button + state + grid animation
- README overhauled with updated architecture and feature documentation

## 2026-02-19

### Fixed
- Streamed text vanishing after tool use events
- WebSocket reconnect state tracking

### Changed
- Web search and web fetch tool icons updated to globe (#8)

## 2026-02-18

### Added
- Model selection dropdown in ChatInput with LM Studio model list
- Custom logo in header and favicon
- Gateway-injected message handling
- One-liner `pnpm prod` quick start command

### Fixed
- OpenClaw streaming: device auth flow, tool event parsing, content handling
- Scroll stability improvements during streaming

### Changed
- Extracted scroll, thinking, theme, and pull-to-refresh into custom hooks (#7)
- Improved model selector UX in ChatInput
- Cleaned up artifact files and reorganized docs

## 2026-02-17

### Added
- Dark mode with OKLch color tokens
- Block cursor animation
- Thinking duration tracking and display
- Push notifications when agent completes responding (#5)
- Comprehensive test suite — 63 Vitest tests covering components, utils, handlers (#4)
- Expandable ChatInput textarea with max height constraint (#3)

### Changed
- Migrated from `next/font/google` to `geist` package (#6)
- Refactored WebSocket handler into sub-handlers, consolidated type definitions (#2)
- Improved streaming UX with thinking indicator transitions

## 2026-02-08

### Added
- LM Studio backend support with OpenAI-compatible API and SSE streaming
- `<think>` tag parsing for reasoning models
- iOS keyboard layout fixes for Safari PWA

### Changed
- Split monolithic `page.tsx` into modular components and shared types
- Demo mode enhanced with richer keyword responses
- Content parts now render in array order

## 2026-02-07

### Added
- Demo mode — fully client-side simulation with keyword triggers
- LM Studio backend alongside OpenClaw (#8e736c7)
- Settings dialog with backend selection (OpenClaw / LM Studio / Demo)
- Timestamps on messages
- Merged tool call pills
- Gateway token auth for OpenClaw WebSocket
- Vercel deployment configuration

### Changed
- Major UI overhaul — settings, timestamps, merged tool pills

## 2026-02-06

### Added
- Initial release — mobile-first chat UI for OpenClaw
- WebSocket streaming for OpenClaw API
- Markdown rendering and agent tool stream display
- Setup dialog gating main chat
- Animated dialog open/close transitions
- Morph bar with continuous scroll-based interpolation
- Command sheet with swipe-up and scroll-up detection
- Pill animations with opacity transitions
- PostCSS config for Tailwind CSS v4

### Fixed
- Chat stream rendering issues
- Sheet backdrop interaction on close
