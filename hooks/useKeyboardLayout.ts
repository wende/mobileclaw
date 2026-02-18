import { useState, useRef, useEffect } from "react";

/**
 * iOS Safari height fix — tracks visualViewport.height to compute keyboard offset
 * and keeps the floating bar positioned above the virtual keyboard.
 */
export function useKeyboardLayout(
  appRef: React.RefObject<HTMLDivElement | null>,
  floatingBarRef: React.RefObject<HTMLDivElement | null>,
  bottomRef: React.RefObject<HTMLDivElement | null>,
) {
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;

    // Lock the container to the initial full-screen height
    if (appRef.current) {
      appRef.current.style.height = `${window.innerHeight}px`;
    }

    const onViewportResize = () => {
      if (!vv) return;
      const offset = Math.round(window.innerHeight - vv.height);
      if (floatingBarRef.current) {
        floatingBarRef.current.style.bottom = offset > 0 ? `${offset}px` : "0";
      }
      setKeyboardOffset((prev) => (prev === offset ? prev : offset));
    };

    vv?.addEventListener("resize", onViewportResize);
    return () => {
      vv?.removeEventListener("resize", onViewportResize);
    };
  }, [appRef, floatingBarRef]);

  // When the keyboard opens, scroll messages to bottom (once)
  const prevKeyboardOffsetRef = useRef(0);
  useEffect(() => {
    const wasOpen = prevKeyboardOffsetRef.current > 0;
    const isOpen = keyboardOffset > 0;
    prevKeyboardOffsetRef.current = keyboardOffset;
    if (isOpen && !wasOpen) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [keyboardOffset, bottomRef]);

  return { keyboardOffset };
}
