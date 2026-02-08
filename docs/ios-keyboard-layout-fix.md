# iOS Safari Virtual Keyboard Layout Fix

## The Problem

On iOS Safari, when the user taps a text input and the virtual keyboard appears, the chat messages disappear or the layout breaks. The view appears "cut off" from the bottom by the height of the keyboard.

## Root Cause

iOS Safari handles the virtual keyboard differently from other browsers:

1. **`window.innerHeight` does NOT shrink** when the keyboard opens
2. **`visualViewport.height` DOES shrink** to reflect the visible area above the keyboard
3. **iOS scrolls the `<body>`** to bring the focused input into view, changing `visualViewport.offsetTop`
4. **`position: fixed; bottom: 0`** anchors to the layout viewport (behind the keyboard), not the visible area

## What Does NOT Work

### Resizing the container to `visualViewport.height`
```js
// DON'T DO THIS
appRef.current.style.height = `${visualViewport.height}px`;
```
This causes the flex layout to recompute, the scroll area shrinks, and messages jump around. When combined with scroll-to-bottom logic it creates an oscillation loop where the view bounces up and down.

### Listening to `visualViewport` scroll events for height adjustments
```js
// DON'T DO THIS
visualViewport.addEventListener("scroll", setHeight);
```
The scroll event fires continuously as iOS adjusts the page position. If the handler triggers React state updates or smooth scrolling, it creates a feedback loop (bouncing).

### Using `behavior: "smooth"` for scroll-to-bottom on keyboard open
Smooth scrolling animates over multiple frames, which can trigger additional viewport events and cause oscillation.

## What Works

### Lock container height once on mount, never change it
```js
useEffect(() => {
  if (appRef.current) {
    appRef.current.style.height = `${window.innerHeight}px`;
  }
}, []);
```
The container stays full-screen. The keyboard overlays on top. The scroll area inside doesn't change size, so messages stay where they are.

### Move the floating input bar via DOM in the `visualViewport` resize handler
```js
const onViewportResize = () => {
  const offset = Math.round(window.innerHeight - vv.height);
  if (floatingBarRef.current) {
    floatingBarRef.current.style.bottom = offset > 0 ? `${offset}px` : "0";
  }
};
visualViewport.addEventListener("resize", onViewportResize);
```
Update the bar position directly via DOM (not React state) to avoid render delay. The bar moves instantly with the keyboard.

### Scroll to bottom only once on keyboard open, using `behavior: "instant"`
```js
const prevKeyboardOffsetRef = useRef(0);
useEffect(() => {
  const wasOpen = prevKeyboardOffsetRef.current > 0;
  const isOpen = keyboardOffset > 0;
  prevKeyboardOffsetRef.current = keyboardOffset;
  if (isOpen && !wasOpen) {
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }
}, [keyboardOffset]);
```
Only fire on the 0→positive transition (keyboard just opened), and use `instant` to avoid triggering more layout events.

## Key Values (iPhone)

| State | `window.innerHeight` | `visualViewport.height` | Difference (keyboard height) |
|-------|---------------------|------------------------|------------------------------|
| Keyboard closed | 746px | 746px | 0px |
| Keyboard open | 746px | 399px | 347px |

`window.innerHeight` stays constant. `visualViewport.height` reflects the actual visible area.

## Dialogs and `position: fixed` on iOS

`position: fixed` elements anchor to the layout viewport, not the visual viewport. When the keyboard opens, iOS scrolls the page (`visualViewport.offsetTop` changes), pushing fixed dialogs out of view.

### What does NOT work

- **Resizing the dialog container via `visualViewport`** — introduces animation mismatches, the backdrop breaks, and the dialog jumps around.
- **Making the dialog scrollable (`overflow-y-auto`)** — the dialog ends up scrolled to the wrong position.

### What works

**Use `position: absolute` inside the locked-height container** instead of `position: fixed`:
```jsx
<div ref={appRef} className="relative" style={{ height: `${window.innerHeight}px` }}>
  <div className="absolute inset-0 z-50 flex items-center justify-center">
    {/* dialog card */}
  </div>
</div>
```
The dialog is positioned relative to the locked container, not the viewport. The keyboard can't move it because the container doesn't move.

---

## Scroll-Driven Morph Animation (Input ↔ Pill)

The floating input bar morphs into a "Scroll to bottom" pill based on scroll distance from bottom, driven by a `--sp` CSS custom property (0 = at bottom/input, 1 = scrolled/pill).

### Width overshoot during morph

**Problem:** When morphing from pill (200px) back to input, the bar temporarily expanded wider than its final width before shrinking back.

**Root cause:** The morph container's `maxWidth` was interpolated between `200px` and a hardcoded `672px`. On mobile (~366px screen), `672px` is unreachable — the `maxWidth` stopped constraining early, and the `flex-1` center element filled the entire parent before buttons grew enough to push it back.

**Fix:** Interpolate to `100%` (actual available width) instead of a hardcoded value:
```css
max-width: min(calc(200px + (100% - 200px) * (1 - var(--sp))), 42rem);
```
`100%` resolves to actual parent width, so the morph is always tight. `42rem` caps it on desktop.

### Morph flickering during streaming

**Problem:** While the AI streams a response, new content pushes `scrollHeight` up. The auto-scroll loop chases it but `distanceFromBottom` fluctuates between frames, causing `--sp` to flicker and the input bar to morph rapidly.

**Fix:** Lock `--sp` to `0` when streaming and pinned to bottom:
```js
if (isStreamingRef.current && pinnedToBottomRef.current) {
  morph.style.setProperty("--sp", "0");
  return;
}
```
The user can still scroll up freely (which unpins), and the morph resumes normally when they scroll back.

### Pull-to-refresh spinner clipping

**Problem:** The refresh spinner inside `pullContentRef` (which has `overflow-hidden`) was vertically clipped when the content translated upward during the pull gesture.

**Fix:** Remove `overflow-hidden` from `pullContentRef` (use `min-h-0` instead for flex containment). The parent `appRef` still has `overflow-hidden` to clip content that slides above the viewport, but the spinner at the bottom is free to render via `overflow-visible`.

Position the spinner behind the floating bar using a `translateY` offset matching the bar's padding and height:
```css
transform: translateY(calc(-3dvh - 23px));
```

---

## Summary

The principle is: **don't resize the layout when the keyboard opens**. Only reposition the floating input bar. Let iOS handle the rest.

For dialogs, use `absolute` inside the locked container instead of `fixed`.

For scroll-driven animations, interpolate against actual available width (`100%`) not hardcoded values, and suppress morph updates during auto-scroll.
