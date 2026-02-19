# Fix: Chat delta replacing streamed text with empty string

**Date:** 2026-02-19
**File:** `app/page.tsx` (handleChatEvent, delta case)

## Bug

Partially streamed text from OpenClaw would disappear after a tool use event. The assistant's text response would be visible during streaming, then vanish when the agent invoked a tool.

## Root Cause

The `handleChatEvent` delta handler unconditionally replaced all text content parts on an existing message with whatever text the incoming delta carried — even if that was empty.

```javascript
const newText = getTextFromContent(msg.content); // "" when delta has no text parts
const nonTextParts = existing.content.filter(p => p.type !== "text");
return {
  ...existing,
  content: [...nonTextParts, { type: "text", text: newText }], // wipes existing text
};
```

**Trigger sequence:**
1. Chat deltas stream in with accumulated text — text appears correctly
2. Agent tool call starts (via agent event) — tool pill appended, text still there
3. Another chat delta arrives where `msg.content` contains tool-related parts but no text (server resets text accumulator at tool boundary)
4. `getTextFromContent()` returns `""`, handler replaces existing text with empty string

## Fix

Preserve existing text when the incoming delta carries no text:

```javascript
const existingText = Array.isArray(existing.content)
  ? getTextFromContent(existing.content)
  : "";
const textToUse = newText || existingText;
return {
  ...existing,
  content: textToUse
    ? [...nonTextParts, { type: "text", text: textToUse }]
    : nonTextParts,
};
```

When `newText` is falsy (empty string), the existing text is kept. When `newText` has content, it replaces as before (server sends full accumulated text in each delta).
