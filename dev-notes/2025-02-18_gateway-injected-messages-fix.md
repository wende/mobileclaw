# Gateway-Injected Messages Rendering Fix

**Date:** 2025-02-18
**Issue:** System status bubbles for gateway-injected messages stopped rendering correctly

## Problem

Gateway-injected messages (e.g., "Model reset to default", model status messages) were rendering as regular assistant messages instead of centered system status bubbles.

## Root Cause

The OpenClaw gateway changed its API for identifying injected messages:

- **Before:** Server sent `stopReason: "injected"`
- **After:** Server sends `model: "gateway-injected"` with `provider: "openclaw"`

The client code in `MessageRow.tsx` was checking for `stopReason === "injected"`, which no longer matched the new server response format.

## Investigation

Using Chrome DevTools to inspect raw WebSocket messages revealed:

```json
{
  "role": "assistant",
  "stopReason": "stop",
  "model": "gateway-injected",
  "provider": "openclaw",
  "content": "Model reset to default (kimi-coding/kimi-for-coding)."
}
```

The `stopReason` field now contains `"stop"` for all messages, while the `model` field identifies gateway-injected messages.

## Fix

Updated `handleHistoryResponse` in `app/page.tsx` to detect the new pattern and normalize it:

```typescript
// Detect gateway-injected messages (model="gateway-injected")
const isGatewayInjected = m.model === "gateway-injected";
const effectiveStopReason = isGatewayInjected ? "injected" : m.stopReason;

return {
  // ...
  stopReason: effectiveStopReason,
  // ...
} as Message;
```

This maps `model: "gateway-injected"` to `stopReason: "injected"` so the existing rendering logic in `MessageRow.tsx` continues to work without changes:

```tsx
if (message.role === "system" || message.stopReason === "injected") {
  // Render as centered system bubble
}
```

## Files Changed

- `app/page.tsx` - Added gateway-injected detection in history processing

## Result

Gateway-injected messages now correctly render as centered system status bubbles with:
- `flex justify-center py-2` container
- `bg-secondary` background
- `text-muted-foreground` text color
- `text-xs` font size
