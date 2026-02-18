# MobileClaw
<img width="412" height="888" alt="Screenshot 2026-02-17 at 19 22 02" src="https://github.com/user-attachments/assets/2ad0a316-26c8-420f-87c4-9320d8024286" />
<img width="412" height="892" alt="Screenshot 2026-02-17 at 19 22 40" src="https://github.com/user-attachments/assets/3578223d-8b2f-4d8e-b379-cb997dac4452" />

A mobile-first chat UI for [OpenClaw](https://github.com/user/openclaw) as well as LM Studio models (with tooling) — Built with Next.js, Tailwind CSS v4, and zero UI dependencies.

## Features

- **Real-time streaming** — word-by-word text streaming with animated cursor
- **Rich markdown** — headings, lists, tables, code blocks with syntax labels and copy button
- **Tool calls** — live tool execution with running/success/error lifecycle
- **Thinking/reasoning** — expandable reasoning blocks on assistant messages
- **Command palette** — slide-up sheet with all OpenClaw slash commands, search and autocomplete
- **Demo mode** — fully functional without a backend server
- **Mobile-first** — optimized for iOS Safari with pull-to-refresh, viewport fixes, and smooth scroll animations
- **Dark mode** — automatic theme via CSS custom properties

## Quick Start

```bash
git clone https://github.com/wende/mobileclaw && cd mobileclaw && pnpm install && pnpm prod
```

Open [localhost:3000?demo](http://localhost:3000?demo) to try it out.

## Demo Mode

Try the UI without a backend:

- Visit **`localhost:3000?demo`** — auto-enters demo mode with sample conversation
- Or open the app, **leave the URL field empty**, and click **"Start Demo"**

In demo mode, send messages with these keywords to see different features:

| Keyword | What it shows |
|---------|--------------|
| `weather` | Tool call with JSON result |
| `code` / `function` | Syntax-highlighted code blocks |
| `think` / `reason` | Expandable reasoning block |
| `error` | Failed tool call |
| `help` | List of demo commands |

## Connecting to OpenClaw

1. Start your OpenClaw instance
2. Open MobileClaw and enter the server URL (e.g. `ws://127.0.0.1:18789`)
3. Optionally enter a gateway auth token
4. Click **Connect**

The connection persists across page reloads via localStorage.

## Tech Stack

- **Next.js 16** — App Router, single-page architecture
- **Tailwind CSS v4** — utility-first styling with OKLch color tokens
- **TypeScript** — type-safe WebSocket protocol handling
- **Zero UI dependencies** — no component library, hand-rolled components with inline SVG icons

## Architecture

The entire UI lives in a single file (`app/page.tsx`) — this is intentional for rapid iteration. Supporting modules:

| File | Purpose |
|------|---------|
| `app/page.tsx` | All components, state, and rendering |
| `lib/useWebSocket.ts` | WebSocket hook with auto-reconnect |
| `lib/toolDisplay.ts` | Tool name → human-friendly label mapping |
| `lib/demoMode.ts` | Demo mode handler with mock data |
| `app/globals.css` | Tailwind config and OKLch color tokens |

## Contributing

1. Read `CLAUDE.md` for project conventions
2. Read `AGENTS.md` for architecture details
3. Test changes in demo mode (`?demo`) before testing with a live server
4. Run `npm run build` to verify no build errors
