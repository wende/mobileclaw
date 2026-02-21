import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import type { Message } from "@/types/chat";

/**
 * Manages scroll tracking, auto-scroll pinning, morph bar animation,
 * and ResizeObserver-based content tracking.
 */
export function useScrollManager(
  messages: Message[],
  isStreamingRef: React.RefObject<boolean>,
) {
  const [scrollPhase, setScrollPhase] = useState<"input" | "pill">("input");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const morphRef = useRef<HTMLDivElement>(null);
  const scrollRafId = useRef<number | null>(null);
  const scrollPhaseRef = useRef<"input" | "pill">("input");
  const pinnedToBottomRef = useRef(true);
  const hasScrolledInitialRef = useRef(false);

  // Lerp state for smooth morph animation at constant speed
  const morphCurrentSp = useRef(0);
  const morphTargetSp = useRef(0);
  const morphLerpRafId = useRef<number | null>(null);

  // Grace period: when streaming ends while pinned, keep force-scrolling for
  // a short window so the final content snap doesn't get stranded above the fold.
  const scrollGraceRef = useRef(false);
  const scrollGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Activate/deactivate grace period based on streaming transitions. */
  const updateGraceForStreamingChange = useCallback((wasStreaming: boolean, nowStreaming: boolean) => {
    if (wasStreaming && !nowStreaming && pinnedToBottomRef.current) {
      scrollGraceRef.current = true;
      if (scrollGraceTimerRef.current) clearTimeout(scrollGraceTimerRef.current);
      scrollGraceTimerRef.current = setTimeout(() => {
        scrollGraceRef.current = false;
        scrollGraceTimerRef.current = null;
      }, 500);
    } else if (nowStreaming) {
      scrollGraceRef.current = false;
      if (scrollGraceTimerRef.current) {
        clearTimeout(scrollGraceTimerRef.current);
        scrollGraceTimerRef.current = null;
      }
    }
  }, []);

  // Exponential lerp tick: each frame moves 20% of remaining distance to target.
  // Produces smooth deceleration — no discrete steps visible.
  const morphLerpTick = useCallback(() => {
    morphLerpRafId.current = null;
    const morph = morphRef.current;
    if (!morph) return;

    const current = morphCurrentSp.current;
    const target = morphTargetSp.current;
    const diff = target - current;

    if (Math.abs(diff) < 0.002) {
      morphCurrentSp.current = target;
      morph.style.setProperty("--sp", target.toFixed(3));
      const newPhase: "input" | "pill" = target > 0.4 ? "pill" : "input";
      if (newPhase !== scrollPhaseRef.current) {
        scrollPhaseRef.current = newPhase;
        setScrollPhase(newPhase);
      }
      return;
    }

    const next = current + diff * 0.2;
    morphCurrentSp.current = next;
    morph.style.setProperty("--sp", next.toFixed(3));

    const newPhase: "input" | "pill" = next > 0.4 ? "pill" : "input";
    if (newPhase !== scrollPhaseRef.current) {
      scrollPhaseRef.current = newPhase;
      setScrollPhase(newPhase);
    }

    morphLerpRafId.current = requestAnimationFrame(morphLerpTick);
  }, []);

  const setMorphTarget = useCallback((target: number) => {
    morphTargetSp.current = target;
    if (morphLerpRafId.current == null) {
      morphLerpRafId.current = requestAnimationFrame(morphLerpTick);
    }
  }, [morphLerpTick]);

  // Track scroll position — sets lerp target, React state for pointer-events phase.
  const handleScroll = useCallback(() => {
    if (scrollRafId.current != null) return;
    scrollRafId.current = requestAnimationFrame(() => {
      scrollRafId.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

      // During streaming, don't update pinning from scroll position —
      // only the wheel/touch handlers can unpin, and scrollToBottom re-pins.
      if (!isStreamingRef.current && !scrollGraceRef.current) {
        pinnedToBottomRef.current = distanceFromBottom < 80;
      }

      // When streaming and pinned, lock morph to input mode (--sp = 0)
      if (isStreamingRef.current && pinnedToBottomRef.current) {
        setMorphTarget(0);
        return;
      }

      const range = 60;
      const progress = Math.min(Math.max(distanceFromBottom / range, 0), 1);
      setMorphTarget(progress);
    });
  }, [isStreamingRef, setMorphTarget]);

  const scrollToBottom = useCallback(() => {
    pinnedToBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Auto-scroll: whenever messages change, snap to bottom if pinned.
  useLayoutEffect(() => {
    if (!pinnedToBottomRef.current || messages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    if (!hasScrolledInitialRef.current) {
      hasScrolledInitialRef.current = true;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ResizeObserver: catch content-height changes from StreamingText typewriter, etc.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const content = el.firstElementChild;
    if (!content) return;

    const ro = new ResizeObserver(() => {
      if ((pinnedToBottomRef.current || scrollGraceRef.current) && el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
        pinnedToBottomRef.current = true;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // Unpin auto-scroll when user actively scrolls up (wheel or touch)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onTouchEnd = () => {
      if (isStreamingRef.current) {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (dist < 80) pinnedToBottomRef.current = true;
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && isStreamingRef.current) {
        pinnedToBottomRef.current = false;
      }
    };
    let lastScrollTop = el.scrollTop;
    const onScroll = () => {
      if (isStreamingRef.current && el.scrollTop < lastScrollTop - 3) {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (dist > 150) {
          pinnedToBottomRef.current = false;
        }
      }
      lastScrollTop = el.scrollTop;
    };
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
    };
  }, [isStreamingRef]);

  return {
    scrollRef,
    bottomRef,
    morphRef,
    scrollPhase,
    pinnedToBottomRef,
    scrollGraceRef,
    handleScroll,
    scrollToBottom,
    updateGraceForStreamingChange,
  };
}
