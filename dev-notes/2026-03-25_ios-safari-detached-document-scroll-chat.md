# iOS Safari Detached Chat Uses Document Scroll

## Goal

Make detached mobile web chat behave like a normal body-scrolling page on iPhone Safari:

- content can extend under Safari chrome
- the bottom chrome stays visually hidden in the idle state
- the chat input no longer uses the old morphing/fixed-shell behavior

## What Finally Worked

Detached mobile web now switches to a document-scroll mode instead of the old `100dvh` locked shell.

Key pieces:

1. `app/page.tsx` enables `useDocumentScroll` only for detached, non-native, mobile-width chat.
2. `html` / `body` scrolling is unlocked for that mode.
3. `ChatViewport` stops owning `overflow-y-auto` in that mode and becomes normal document content.
4. The composer stays in normal flow instead of switching to `fixed` on focus.
5. The old textarea ↔ scroll-pill morph is disabled; the jump affordance is now a separate floating control.

## Important Safari Findings

### 1. Bottom-pinned controls wake the Safari chrome back up

Any fixed control too close to the bottom edge caused Safari's bottom chrome to reappear.

The separate `Scroll to bottom` pill only stayed compatible once it was moved up to:

```css
bottom: calc(env(safe-area-inset-bottom, 0px) + 0.8rem)
```

This was found empirically. Lower values eventually re-triggered the bottom chrome.

### 2. A focused bottom input is not a good experiment primitive

Replacing the jump pill with a real text input showed that Safari auto-pans the document to accommodate focused text fields. Near the page bottom this can hit the document end, snap, and collapse the interaction. So the jump control should stay a button-like control, not a text field.

### 3. The first tap during momentum is Safari behavior

While momentum scrolling is active, the first tap on a floating control often only cancels inertia. This also happens with other floating utilities on the page. Multiple event-handler workarounds did not change that reliably, so the current implementation accepts it as a platform limitation.

### 4. The old focus/resize restore logic became actively harmful

Once document scroll owned the page, the previous `visualViewport.resize` / `focusout` restore hook started snapping the page back to bottom after normal Safari chrome transitions. That hook was removed.

## Current Stable Shape

- detached mobile web: document scroll
- composer: static, in-flow, no morph
- jump pill: separate fixed control above the bottom edge
- desktop / native / non-detached paths: existing behavior preserved

## Files

- `app/page.tsx`
- `components/ChatInput.tsx`
- `components/chat/ChatComposerBar.tsx`
- `components/chat/ChatViewport.tsx`
- `hooks/useScrollManager.ts`
- `lib/chat/layout.ts`

## Known Limitation

On iOS Safari, tapping the floating jump pill during active momentum scroll may require a second tap because the first tap is consumed by inertia cancellation. This appears to be browser behavior rather than a chat-specific bug.

## Desktop Follow-Up

Detached desktop stays on the old shell path.

- standalone `?detached` desktop now uses a declarative `100dvh` shell instead of relying on an imperative height override
- embedded/widget detached desktop still uses `height: 100%` so it honors the host container
- mobile detached still uses document scroll
