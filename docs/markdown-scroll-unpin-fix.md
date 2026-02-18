# Markdown Rendering Breaks Auto-Scroll During Streaming

## The Problem

When the AI streams a response containing markdown elements (e.g. tables), the chat view stops auto-scrolling and gets stuck partway through the response. The "Scroll to bottom" pill appears and the last lines of text are hidden below the fold.

**Repro:** Send "weather" in demo mode. The response includes a markdown table — the view freezes ~80px from the bottom once the table renders.

## How Auto-Scroll Works

During streaming, three mechanisms keep the view pinned to the bottom:

1. **`useLayoutEffect([messages])`** — snaps `scrollTop = scrollHeight` whenever `messages` state changes (each streaming delta).
2. **`ResizeObserver`** — catches content-height changes that DON'T come from a `messages` update (e.g. typewriter revealing enough text for Markdown to parse as a table).
3. **`pinnedToBottomRef`** — a ref that tracks whether the user is "at the bottom." When `true`, the above two mechanisms scroll. When `false`, they don't, so the user can read earlier content without being yanked down.

## Root Cause

There's a scroll listener designed to detect when the user **scrolls up** during streaming (to unpin and let them read history):

```js
// On mobile, detect scroll-up by watching scroll direction during streaming
let lastScrollTop = el.scrollTop;
const onScroll = () => {
  if (isStreamingRef.current && el.scrollTop < lastScrollTop - 3) {
    pinnedToBottomRef.current = false;  // ← THE BUG
  }
  lastScrollTop = el.scrollTop;
};
```

This checks if `scrollTop` **decreased** (user scrolled up). The problem: when a markdown table renders, the browser performs a layout shift that can **transiently decrease `scrollTop`** — not because the user scrolled, but because the content above the viewport changed shape. The listener misinterprets this as a user scroll-up and unpins.

Once unpinned:
- The `useLayoutEffect` stops scrolling (it checks `pinnedToBottomRef.current`)
- The `ResizeObserver` stops scrolling (same check)
- The view is stuck, 80px from the bottom
- `handleScroll` won't re-pin because `distanceFromBottom >= 80` (the threshold is `< 80`)

### Timeline

```
1. Demo streams words into `messages` → useLayoutEffect scrolls to bottom ✓
2. StreamingText typewriter reveals text character-by-character
3. Typewriter reveals enough chars for markdown parser to recognize a table
4. Table renders → large height jump → browser adjusts scrollTop transiently
5. onScroll fires: el.scrollTop < lastScrollTop → pinnedToBottomRef = false
6. Streaming continues, but nothing scrolls anymore
7. Streaming ends with setIsStreaming(false), but pinned is already false
8. Grace period doesn't activate (requires pinned = true)
9. View stuck at dist = 80px, "Scroll to bottom" pill visible
```

## The Fix

Added a `distanceFromBottom` guard to the scroll-direction unpin logic. A transient `scrollTop` decrease from a layout shift keeps the user near the bottom (small `dist`), while a genuine scroll-away puts them far from the bottom (large `dist`):

```js
const onScroll = () => {
  if (isStreamingRef.current && el.scrollTop < lastScrollTop - 3) {
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist > 150) {
      pinnedToBottomRef.current = false;
    }
  }
  lastScrollTop = el.scrollTop;
};
```

**Why 150px?** The markdown table height jump is typically 80–120px. A threshold of 150px ensures layout shifts don't false-positive, while a user who swipes up even slightly will exceed it.

## What Did NOT Work

### ResizeObserver alone
The `ResizeObserver` observes the content wrapper and scrolls to bottom on height changes. However, it fires *after* the `onScroll` listener has already unpinned, so it checks `pinnedToBottomRef.current` → `false` and does nothing.

### Grace period in `setIsStreaming`
A "grace period" (`scrollGraceRef`) was added to prevent unpinning for 500ms after streaming ends. This was meant to handle the typewriter catch-up phase. The problem: the unpin happens **during** streaming (not after), so the grace period never activates — its condition requires `pinnedToBottomRef.current === true` at the moment streaming ends, but it's already `false`.

### rAF snap loop in `setIsStreaming`
A `requestAnimationFrame` loop was added inside `setIsStreaming` to continuously scroll to bottom during the grace period. This failed because `scrollRef.current` was `null` at the time the rAF callback ran — the callback closed over a ref that wasn't yet attached to the DOM (component re-mount timing issue).

## Defense in Depth

The codebase retains two additional safety mechanisms that remain useful for edge cases:

1. **`ResizeObserver`** — still catches height changes from typewriter reveals even if `messages` hasn't changed. Active whenever `pinnedToBottomRef.current || scrollGraceRef.current` is true.

2. **Grace period (`scrollGraceRef`)** — still protects the 500ms after streaming ends. If the user is pinned when streaming stops, `handleScroll` won't unpin during this window, and the `ResizeObserver` will keep scrolling. This handles the `StreamingText` snap (where `displayLen` jumps to `text.length` when `isStreaming` becomes `false`).

## Files Changed

- **`app/page.tsx`** — `onScroll` handler inside the "Unpin auto-scroll" `useEffect` (~line 1134)
