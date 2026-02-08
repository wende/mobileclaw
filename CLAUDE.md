# MobileClaw — Project Instructions

## Overview

MobileClaw is a mobile-first chat UI for the [OpenClaw](https://github.com/user/openclaw) agent platform. Built with Next.js 16, Tailwind CSS v4, and zero component libraries — everything is in a single `app/page.tsx` file.

## Tech Stack

- **Next.js 16** (App Router, single page)
- **Tailwind CSS v4** with OKLch color tokens
- **TypeScript** (strict mode disabled for speed)
- No component library — all UI is hand-rolled with inline SVG icons
- WebSocket client for real-time OpenClaw gateway protocol

## File Layout

```
app/
  page.tsx          — entire UI (types, components, state, render)
  layout.tsx        — root layout, fonts, metadata
  globals.css       — Tailwind config, OKLch color tokens, dark mode
  LocatorProvider.tsx — dev-only tree locator (v0 tooling)
lib/
  useWebSocket.ts   — WebSocket hook with reconnect backoff
  toolDisplay.ts    — maps tool names/args to human-friendly labels
  demoMode.ts       — demo mode handler, mock history, keyword responses
```

## Development

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
```

### Demo mode
- Visit `localhost:3000?demo` — auto-enters demo mode, skips setup
- Or leave the URL field empty in the setup dialog and click "Start Demo"

## Key Conventions

- **Single-file UI**: all components live in `page.tsx` — do not split into separate component files unless absolutely necessary
- **No component library**: use raw HTML elements + Tailwind classes
- **Inline SVG icons**: no icon library — copy SVG directly into JSX
- **OKLch colors**: all color tokens in `globals.css` use `oklch()` — never use hex or named colors
- **Mobile-first**: `h-dvh` viewport, touch handlers, iOS Safari fixes
- **CSS variable animations**: scroll morph bar uses `--sp` CSS custom property for 60fps animations without React re-renders

## WebSocket Protocol

MobileClaw connects to OpenClaw's gateway WebSocket. Protocol frames:

1. **Server sends** `event:connect.challenge` with nonce
2. **Client responds** with `req:connect` including auth token, capabilities
3. **Server responds** with `res:hello-ok` including server info, session snapshot
4. **Client requests** `req:chat.history` to load message history
5. **Messages flow** via `event:chat` (delta/final/aborted/error) and `event:agent` (content/tool/reasoning/lifecycle streams)
6. **Client sends** `req:chat.send` with user messages

## Demo Mode

`lib/demoMode.ts` provides a fully client-side simulation:
- `DEMO_HISTORY` — curated conversation showcasing all UI features
- `createDemoHandler(callbacks)` — returns `sendMessage`/`stop` that simulate streaming via `setTimeout` chains
- Keyword matching: "weather", "code", "think", "error", "research", "agent", "help" trigger different response types
- Activated by `?demo` URL param or empty URL in setup dialog
