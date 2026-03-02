import { useRef, useEffect } from "react";

/**
 * iOS Safari height fix — tracks visualViewport.height to compute keyboard offset
 * and keeps the floating bar positioned above the virtual keyboard.
 *
 * The container height is locked to `window.innerHeight` on mount so it doesn't
 * shrink with the keyboard (iOS Safari shrinks the layout viewport). This keeps
 * `innerHeight` constant and makes `innerHeight - vv.height` a reliable keyboard
 * height signal.
 */
export function useKeyboardLayout(
  appRef: React.RefObject<HTMLDivElement | null>,
  floatingBarRef: React.RefObject<HTMLDivElement | null>,
  bottomRef: React.RefObject<HTMLDivElement | null>,
  enabled = true,
) {
  const keyboardWasOpenRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;

    // Lock the container to the initial full-screen height so it doesn't
    // shrink when the keyboard opens (iOS Safari resizes layout viewport).
    if (appRef.current) {
      appRef.current.style.height = `${window.innerHeight}px`;
    }

    let debounceTimer = 0;

    // Debounced handler for floating bar positioning — SwiftKey fires
    // multiple rapid resize events that overshoot then settle.
    const applyBarPosition = () => {
      if (!vv) return;
      const offset = Math.round(window.innerHeight - vv.height);
      if (floatingBarRef.current) {
        const isIOS = /iPad|iPhone/.test(navigator.userAgent);
        const safeOffset = isIOS ? 0 : offset;
        floatingBarRef.current.style.bottom = safeOffset > 0 ? `${safeOffset}px` : "0";
      }
    };

    const onViewportResize = () => {
      if (!vv) return;
      const offset = Math.round(window.innerHeight - vv.height);
      const keyboardOpen = offset > 100;

      // Scroll to bottom immediately when keyboard opens — no debounce.
      if (keyboardOpen && !keyboardWasOpenRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: "instant" });
      }
      keyboardWasOpenRef.current = keyboardOpen;

      // Debounce floating bar repositioning (SwiftKey overshoot)
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(applyBarPosition, 120);
    };

    vv?.addEventListener("resize", onViewportResize);
    return () => {
      vv?.removeEventListener("resize", onViewportResize);
      clearTimeout(debounceTimer);
    };
  }, [enabled, appRef, floatingBarRef, bottomRef]);
}
