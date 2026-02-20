# Fix: Chat delta destroying streamed text across tool boundaries

**Date:** 2026-02-19
**File:** `app/page.tsx` (handleChatEvent, delta case)

## Bug

Partially streamed text from OpenClaw would disappear after a tool use event. In a "text -> tool -> text" flow, the pre-tool text vanished when post-tool text started streaming.

## Root Cause

The `handleChatEvent` delta handler stripped ALL text parts from the existing message content and replaced them with a single text part from the incoming delta:

```javascript
const newText = getTextFromContent(msg.content);
const nonTextParts = existing.content.filter(p => p.type !== "text");
return {
  ...existing,
  content: [...nonTextParts, { type: "text", text: newText }],
};
```

This destroys the interleaved content structure. A message with content like `[text("pre-tool"), tool_call(...)]` would lose its text when the next delta arrived — whether that delta had empty text (wiped to "") or post-tool text (replaced pre-tool text entirely).

**Trigger sequence:**
1. Chat deltas stream in with accumulated text — text appears correctly
2. Agent tool call starts (via agent event) — tool pill appended, text still there
3. Post-tool chat delta arrives — server sends only the new text segment (not including pre-tool text)
4. Handler strips ALL text parts, replaces with just the post-tool text — pre-tool text vanishes

## Fix

Instead of collapsing all text into one part, only update/add the **trailing** text part (after the last tool call). This preserves the interleaved structure:

```javascript
const parts = Array.isArray(existing.content) ? [...existing.content] : [];

if (newText) {
  const lastToolIdx = parts.findLastIndex(p => p.type === "tool_call" || p.type === "toolCall");
  const lastTextIdx = parts.findLastIndex(p => p.type === "text");

  if (lastTextIdx > lastToolIdx) {
    // Update existing trailing text part
    parts[lastTextIdx] = { ...parts[lastTextIdx], text: newText };
  } else {
    // Add new text part after the last tool call
    parts.push({ type: "text", text: newText });
  }
}

return { ...existing, content: parts };
```

Result: content stays as `[text("pre-tool"), tool_call(...), text("post-tool")]` with each text segment preserved independently. When `newText` is empty (tool-only delta), no text parts are touched at all.
