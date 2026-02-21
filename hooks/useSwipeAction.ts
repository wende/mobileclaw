import { useRef, useState, useCallback } from "react";

/**
 * Hook for swipe-left-to-reveal-action gesture (iOS mail style).
 * Returns offset for translateX, animation state, and touch handlers.
 */
export function useSwipeAction(
  onAction: () => void,
  opts?: { threshold?: number; disabled?: boolean }
) {
  const threshold = opts?.threshold ?? 80;
  const disabled = opts?.disabled ?? false;

  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);

  // Mutable state — avoids stale closures in touch handlers
  const stateRef = useRef({
    startX: 0,
    startY: 0,
    committed: false, // locked into horizontal swipe
    cancelled: false, // vertical scroll detected, bail out
    currentOffset: 0,
  });
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const t = e.touches[0];
      const s = stateRef.current;
      s.startX = t.clientX;
      s.startY = t.clientY;
      s.committed = false;
      s.cancelled = false;
      setAnimating(false);
    },
    [disabled]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const s = stateRef.current;
      if (disabled || s.cancelled) return;
      const t = e.touches[0];
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;

      // First significant movement — decide horizontal or vertical
      if (!s.committed) {
        if (Math.abs(dy) > 10) {
          s.cancelled = true;
          return;
        }
        if (Math.abs(dx) > 10) s.committed = true;
        else return;
      }

      // Only allow left swipe (negative dx)
      if (dx >= 0) {
        s.currentOffset = 0;
        setOffset(0);
        return;
      }

      // Rubber-band past threshold
      const abs = Math.abs(dx);
      const val = -(
        abs > threshold ? threshold + (abs - threshold) * 0.3 : abs
      );
      s.currentOffset = val;
      setOffset(val);
    },
    [disabled, threshold]
  );

  const onTouchEnd = useCallback(() => {
    if (disabled) return;
    const s = stateRef.current;
    if (s.committed && !s.cancelled && Math.abs(s.currentOffset) >= threshold) {
      try {
        navigator.vibrate?.(30);
      } catch {}
      onActionRef.current();
    }
    s.currentOffset = 0;
    setAnimating(true);
    setOffset(0);
  }, [disabled, threshold]);

  return {
    offset,
    animating,
    pastThreshold: Math.abs(offset) >= threshold,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
