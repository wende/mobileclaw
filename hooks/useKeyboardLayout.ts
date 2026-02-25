import { useState, useRef, useEffect } from "react";

/**
 * iOS Safari height fix — tracks visualViewport.height to compute keyboard offset
 * and keeps the floating bar positioned above the virtual keyboard.
 */
export function useKeyboardLayout(
  appRef: React.RefObject<HTMLDivElement | null>,
  floatingBarRef: React.RefObject<HTMLDivElement | null>,
  bottomRef: React.RefObject<HTMLDivElement | null>,
  enabled = true,
) {
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;

    // Lock the container to the initial full-screen height
    if (appRef.current) {
      appRef.current.style.height = `${window.innerHeight}px`;
    }

    let debounceTimer = 0;

    const applyResize = () => {
      if (!vv) return;
      const offset = Math.round(window.innerHeight - vv.height);
      console.log(
        "[keyboard] apply vv.height:", vv.height,
        "| innerHeight:", window.innerHeight,
        "| keyboard ~", offset,
        "| vv.offsetTop:", vv.offsetTop,
      );
      // On iOS the layout viewport shrinks with the keyboard, so
      // bottom:0 on a fixed element is already above the keyboard.
      // innerHeight occasionally lags behind vv.height, producing a
      // bogus offset — never apply it on iOS.
      if (floatingBarRef.current) {
        const isIOS = /iPad|iPhone/.test(navigator.userAgent);
        const safeOffset = isIOS ? 0 : offset;
        floatingBarRef.current.style.bottom = safeOffset > 0 ? `${safeOffset}px` : "0";
      }
      setKeyboardOffset((prev) => (prev === offset ? prev : offset));
    };

    const onViewportResize = () => {
      // Debounce: third-party keyboards (SwiftKey) fire multiple rapid
      // resize events, overshooting then settling. Wait for them to
      // stabilize before reacting.
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(applyResize, 120);
    };

    vv?.addEventListener("resize", onViewportResize);
    return () => {
      vv?.removeEventListener("resize", onViewportResize);
      clearTimeout(debounceTimer);
    };
  }, [enabled, appRef, floatingBarRef]);

  // When the keyboard opens, scroll messages to bottom (once)
  const prevKeyboardOffsetRef = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const wasOpen = prevKeyboardOffsetRef.current > 0;
    const isOpen = keyboardOffset > 0;
    prevKeyboardOffsetRef.current = keyboardOffset;
    if (isOpen && !wasOpen) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [enabled, keyboardOffset, bottomRef]);

  return { keyboardOffset };
}
