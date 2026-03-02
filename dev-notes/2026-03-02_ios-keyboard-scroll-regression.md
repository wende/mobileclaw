# iOS Keyboard Scroll-to-Bottom Regression

## Symptom

Opening the keyboard on iOS did not scroll to the bottom of the chat. The viewport shifted to show the input area but messages stayed at their previous scroll position, requiring manual scrolling.

## Root Cause

The `useKeyboardLayout` hook detected keyboard opening via `keyboardOffset > 0`, where `keyboardOffset = window.innerHeight - visualViewport.height`. This relies on `innerHeight` staying constant when the keyboard opens.

The container height lock that made this work was:
```js
appRef.current.style.height = `${window.innerHeight}px`;
```

Without this lock, iOS Safari shrinks both `innerHeight` and `vv.height` together when the keyboard opens, making the offset ~0 and the scroll-to-bottom effect never fire.

Additionally, the scroll-to-bottom was routed through React state (`setKeyboardOffset`) and a `useEffect`, adding a full render cycle of latency on top of the 120ms debounce. Total delay: ~150-200ms after keyboard appears.

## Fix

1. **Restored the container height lock** — `appRef.current.style.height = ${window.innerHeight}px` pins the layout viewport so `innerHeight` stays constant.

2. **Scroll-to-bottom fires immediately** in the `visualViewport` resize handler, before the debounce. Only the floating bar repositioning is debounced (for SwiftKey overshoot). This eliminates the React state/effect round-trip delay.

3. **Keyboard detection uses a 100px threshold** (`offset > 100`) instead of `offset > 0` to avoid false positives from minor viewport fluctuations.

## Key Lesson

The height lock and the offset-based keyboard detection are coupled — removing or losing the lock silently breaks keyboard detection because the offset goes to zero. The `2025-02-08_ios-keyboard-layout-fix.md` dev note documents this dependency but it was easy to lose when refactoring.

## Related

- `dev-notes/2025-02-08_ios-keyboard-layout-fix.md` — original implementation and rationale
- `hooks/useKeyboardLayout.ts` — the hook
- `hooks/useScrollManager.ts` — scroll pinning / morph bar logic
