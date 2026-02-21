# Context Pills, Injected Pills & Animated Width Expand/Collapse

**Date:** 2026-02-21
**Files:** `components/MessageRow.tsx`, `app/page.tsx`

## Summary

New expandable pill system for system-injected messages on both user and assistant sides, with smooth animated width + height transitions. Added HEARTBEAT_OK / NO_REPLY message handling with notification suppression and message merging.

## Context Pill (`ContextPill` component)

Extracted the user-side `isContext` pill into its own component. Expandable dark pill on the right (user bubble style) with animated width + height.

Detection in `page.tsx` — `isContext` flag set when user message text starts with:
- `"System: ["` (legacy format)
- `"[System Message]"` (new format)
- Contains `"HEARTBEAT_OK"`

Icon varies by content type:
- **Gear** — default context messages
- **Heart** — HEARTBEAT_OK messages (title always "Heartbeat")

Summary text has markdown characters (`#`, `*`, `_`, `~`, `` ` ``, `>`) stripped.

## Injected Pill (`InjectedPill` component)

Centered expandable pill for assistant-side messages. Triggered by:
- `stopReason === "injected"` (gateway-injected messages)
- Assistant text containing `HEARTBEAT_OK` or `NO_REPLY`

Three variants detected by `getInjectedSummary()`:
- **HEARTBEAT_OK** — heart icon, title "Heartbeat"
- **NO_REPLY** — decorative icon, last sentence before marker as title
- **info** (default) — circle-i icon, first line as title

Accepts optional `message` + `subagentStore` props — on expand, renders full content parts (ThinkingPill, ToolCallPill, MarkdownContent) instead of just plain text. Handles both `message.reasoning` (string field) and `type: "thinking"` content parts.

## Message Merging (`displayMessages` in `page.tsx`)

`useMemo` that produces `displayMessages` from raw `messages` before rendering:
- When a HEARTBEAT_OK/NO_REPLY assistant message immediately follows another assistant message, merges the previous message's content parts (thinking blocks, tool calls, text) into the HEARTBEAT_OK message
- The previous message is removed from the list
- Reasoning field preserved from either message
- Rendering loop uses `displayMessages` instead of `messages`

## Animated Width Expand/Collapse Pattern

Used by both `InjectedPill` and `ContextPill`. Solves the problem of smoothly animating between `fit-content` (narrow pill) and content-driven width.

### Three states

- `open` — user intent (toggle on click)
- `mounted` — whether content is in the DOM
- `expanded` — drives the grid `0fr → 1fr` height transition

### Open sequence

1. Lock current narrow width as explicit px (`getBoundingClientRect().width` + `Math.ceil` for subpixel precision)
2. `setMounted(true)` — content renders in DOM (width locked, no visual jump)
3. `requestAnimationFrame`:
   - Unlock width (`el.style.width = ""`) — content flows to natural width
   - Measure `el.scrollWidth` — captures target width
   - Pin content at target via `contentRef.style.minWidth` — prevents text reflow during animation
   - Re-lock at narrow width
   - `void el.offsetWidth` — force reflow (registers narrow as transition "from" value)
   - Set target width — CSS `transition-[width]` animates narrow → wide
   - `setExpanded(true)` — grid transitions `0fr → 1fr` simultaneously

### Close sequence

1. Lock current wide width as explicit px
2. `void el.offsetWidth` — force reflow
3. Set narrow target — CSS transition animates wide → narrow
4. `setExpanded(false)` — grid transitions `1fr → 0fr`
5. After 220ms timeout: `setMounted(false)` + clear explicit width

### Key details

- `overflow-hidden` on outer div clips content during width animation
- `contentRef.style.minWidth` pins content layout at target width so text doesn't reflow at intermediate widths
- `onTransitionEnd` clears explicit width after expand so `w-fit` takes over naturally
- `Math.ceil(getBoundingClientRect().width)` prevents subpixel rounding issues (e.g., last letter clipping)

## Notification Suppression

`notifyForRun` in `page.tsx` returns early (no push notification) when the message text contains `HEARTBEAT_OK` or `NO_REPLY`.
