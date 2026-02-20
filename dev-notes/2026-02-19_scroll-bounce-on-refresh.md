# Scroll Bounce-Back on Desktop Refresh

## The Problem (Unresolved)

Refreshing the chat on desktop sometimes doesn't scroll fully to the bottom. It scrolls partway down then bounces back up a significant margin. Observed on the deployed site but not consistently reproducible.

## Suspected Code Path

The bug is likely in the **history restore flow**, not demo mode or streaming:

1. Page loads → WebSocket connects → `connect.challenge` → `connect` → `hello-ok`
2. `handleHelloOk` calls `requestHistory()`
3. Server responds with full message history
4. `handleHistoryResponse` (page.tsx ~L290) processes and calls `setMessages()`
5. `useLayoutEffect([messages])` fires `el.scrollTop = el.scrollHeight`
6. **Something** causes the scroll to not stick — content renders after the scroll snap, and `pinnedToBottomRef` gets set to `false` by `handleScroll`

## Why It Might Happen

The `handleScroll` callback (useScrollManager.ts ~L45) has this logic:

```typescript
if (!isStreamingRef.current && !scrollGraceRef.current) {
  pinnedToBottomRef.current = distanceFromBottom < 80;
}
```

After history load, `isStreaming` is false and `scrollGrace` is false. If content height changes after the initial scroll snap (fonts loading, markdown/code blocks rendering, images), the scroll event fires with `distanceFromBottom > 80`, unpinning the view. The ResizeObserver should re-scroll, but if `pinnedToBottomRef` was already set to `false` by the scroll handler, it won't.

**Race condition sequence:**
1. `useLayoutEffect` → `scrollTop = scrollHeight` (correct)
2. Font/CSS/markdown finishes rendering → content gets taller
3. `handleScroll` fires → sees gap > 80px → sets `pinned = false`
4. `ResizeObserver` fires → checks `pinned` → it's `false` → does nothing
5. View is stranded partway up

## What We Tried

Built an e2e test (`e2e/scroll-on-refresh.spec.ts`) that:
- Mocks the OpenClaw WebSocket protocol with `page.routeWebSocket`
- Serves 10 exchanges of rich history (code blocks, tables, tool calls, thinking)
- Checks scroll on initial load, after reload, and multi-sample bounce detection

Could not reproduce the bug — scroll was always at bottom in Playwright (headless and headed). Tried manually in the headed browser as well. The deployed site also stopped showing the issue during testing.

## Mock WebSocket Setup (for future tests)

The test infrastructure for mocking OpenClaw is ready to reuse. Key pattern:

```typescript
await page.routeWebSocket(/ws:\/\/localhost:59999/, (ws) => {
  // 1. Send challenge
  ws.send(JSON.stringify({
    type: "event", event: "connect.challenge",
    payload: { nonce: "test-nonce" },
  }));

  ws.onMessage((raw) => {
    const msg = JSON.parse(raw as string);

    // 2. Respond to connect → hello-ok
    if (msg.method === "connect") {
      ws.send(JSON.stringify({
        type: "res", id: msg.id, ok: true,
        payload: {
          type: "hello-ok",
          server: { connId: "test" },
          snapshot: { sessionDefaults: { mainSessionKey: "main" } },
        },
      }));
    }

    // 3. Respond to history request
    if (msg.method === "chat.history") {
      ws.send(JSON.stringify({
        type: "res", id: msg.id, ok: true,
        payload: { messages: [...] },
      }));
    }
  });
});
```

## Potential Fixes to Try When Reproduced

1. **Add a grace period after history load** — similar to `scrollGraceRef` for streaming end, keep `pinned = true` for ~500ms after `handleHistoryResponse`
2. **Ignore handleScroll unpinning during initial load** — use a `historyJustLoadedRef` flag
3. **Re-scroll in a rAF after setMessages** — double-tap scroll in `handleHistoryResponse` to catch late layout
4. **Move history setMessages into a startTransition** — let React batch the render before scrolling
