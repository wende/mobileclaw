# MobileClaw — Features

## Chat

- **Streaming text** — adaptive-rate typewriter animation with learned timing, block cursor, `SmoothGrow` height transitions to avoid layout jumps
- **Markdown rendering** — hand-rolled renderer: headings, bold/italic, inline code, fenced code blocks with copy button, blockquotes, lists, tables, links, images
- **Thinking indicator** — live "Thinking... Ns" elapsed timer, collapsible thinking pills per message, duration stamped on completed messages
- **Tool call pills** — expandable pills with type-specific icons and labels: exec (command), read/edit/write (path + inline diff), web_search (query), web_fetch (URL), gateway, spawn (subagent)
- **Subagent activity** — `SpawnPill` with live activity feed (reasoning/tool/text events), swipe-left to pin, `FloatingSubagentPanel` above input for pinned subagents
- **Message queue** — send while agent is running, `QueuePill` preview with dismiss, auto-sends on run completion
- **Quote selection** — text select on assistant messages shows floating "Quote" button, inserts `> blockquote` prefix in input
- **ArrowUp recall** — press Up in empty input to restore last sent message
- **Image attachments** — file picker (paperclip), paste from clipboard, thumbnail strip in composer, fullscreen `ImageLightbox` on tap, base64 upload (up to 50MB)
- **Image thumbnails** — `image_url` content parts rendered as 64x64 thumbnails in messages, tap to lightbox
- **File attachment badges** — non-image files shown as pill badges with extension label
- **Push notifications** — browser Notification API, fires when agent finishes and tab not focused, iOS PWA safe (16.4+)
- **Unread tab indicator** — browser tab title updates when messages arrive while unfocused

## Model & Commands

- **Model switching** — `/model <name>` with autocomplete dropdown showing provider, context window, reasoning flag; also accessible via CommandSheet model sub-view
- **Current model display** — shown in header below session name
- **Slash commands** — autocomplete in input, CommandSheet bottom sheet picker
  - Session: `/new`, `/reset`, `/compact`, `/stop`
  - Options: `/think`, `/model`, `/verbose`, `/config`
  - Status: `/status`, `/whoami` (`/id`), `/context`
  - Skills: `/skill`
  - More: `/commands`, `/help`
- **Server commands** — additional commands fetched from gateway, merged into autocomplete

## Sessions

- **Session switcher** — tappable header pill opens `SessionSheet` bottom sheet with search
- **Session kinds** — main, group, cron, hook, node, other — each with badge label
- **Session metadata** — model name, relative time display
- **Pull-to-refresh** — gesture with spinner, re-fetches history

## Backends

- **OpenClaw** (WebSocket) — full agent capabilities, tool execution, reasoning streams, session management, subagent streaming
- **LM Studio** (HTTP/SSE) — local OpenAI-compatible server, model list in setup dialog, `<think>` tag parsing
- **Demo** (client-only) — keyword-matched responses, simulated thinking/tools/subagent activity, no server required (`?demo` URL param)
- **Saved connections** — up to 10 saved OpenClaw configs in localStorage

## UI & Polish

- **Dark/light theme** — toggle in header (sun/moon icon), localStorage persistence, OKLch color tokens
- **Zen mode** — collapses intermediate assistant turns in multi-turn responses, slide+fade animations, localStorage + `?zen` URL param
- **Liquid glass pill** — SVG displacement + specular maps on chat input for glass refraction effect (CSS blur fallback on mobile)
- **Scroll morph bar** — `--sp` CSS custom property animation at 60fps
- **Draft persistence** — input text saved to localStorage, survives page reload
- **Expandable textarea** — auto-grows with content
- **iOS keyboard layout** — virtual keyboard height adjustments for Safari PWA

## iOS App

- **WKWebView wrapper** — native iOS app
- **Swift/JS bridge** — identity signing (Keychain), connection/run/model/session state posting, link/image tap routing to Swift, subagent pin events
- **Device identity** — Ed25519 key management for native pairing
- **Cloudflare Turnstile** — optional bot protection gate (env-configured)

## Networking

- **WebSocket reconnect** — exponential backoff with ping/pong
- **Challenge/auth handshake** — `connect.challenge` nonce flow
- **Event streams** — `event:chat` (delta/final/aborted/error), `event:agent` (content/tool/reasoning/lifecycle)
- **Structured logging** — JSONL debug log to `/api/log`, chat and agent events with timestamps
