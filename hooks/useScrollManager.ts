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

    // Layout progress with deadzone: stays 0 until --sp > 0.05, prevents
    // subpixel rounding shifts at the very start of the morph.
    const toLp = (sp: number) => sp < 0.05 ? 0 : (sp - 0.05) / 0.95;

    if (Math.abs(diff) < 0.002) {
      morphCurrentSp.current = target;
      morph.style.setProperty("--sp", target.toFixed(3));
      morph.style.setProperty("--lp", toLp(target).toFixed(3));
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
    morph.style.setProperty("--lp", toLp(next).toFixed(3));

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

  // ResizeObserver: catch content-height changes when NOT streaming (e.g. images loading).
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

  // rAF loop: during streaming, continuously pin scroll to bottom.
  // SmoothGrow uses explicit height + CSS transition which delays scrollHeight
  // updates by ~150ms. The ResizeObserver on the content div only fires once
  // SmoothGrow's transition propagates, so tool call pills (which add height
  // in a single jump) can appear below the viewport before the scroll catches up.
  // This loop checks every frame and scrolls immediately, costing only a few
  // ref reads per frame when idle.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let id: number;
    const tick = () => {
      if (
        (pinnedToBottomRef.current || scrollGraceRef.current) &&
        (isStreamingRef.current || scrollGraceRef.current) &&
        el.scrollHeight > el.clientHeight
      ) {
        el.scrollTop = el.scrollHeight;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [isStreamingRef]);

  // Unpin auto-scroll when user actively scrolls up (wheel or touch),
  // and apply elastic bounce when scrolling past the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // ── Bottom bounce state ──────────────────────────────────────────
    let bounceTouchStartY = 0;
    let isBouncing = false;
    let bounceOffset = 0;
    let bounceRafId: number | null = null;

    // Wheel bounce: accumulated overscroll + decay timer
    let wheelAccum = 0;
    let wheelDecayRaf: number | null = null;

    const applyBounce = (offset: number) => {
      const content = el.firstElementChild as HTMLElement | null;
      if (!content) return;
      if (offset === 0) {
        content.style.transform = "";
        content.style.transition = "";
      } else {
        content.style.transition = "none";
        content.style.transform = `translateY(${offset}px)`;
      }
    };

    const springBack = () => {
      if (bounceRafId) cancelAnimationFrame(bounceRafId);
      const content = el.firstElementChild as HTMLElement | null;
      if (!content) return;
      content.style.transition = "transform 0.45s cubic-bezier(0.25, 1, 0.5, 1)";
      content.style.transform = "";
      bounceOffset = 0;
      isBouncing = false;
      bounceRafId = null;
    };

    const isAtBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 2;

    // ── Touch bounce ─────────────────────────────────────────────────
    const onBounceStart = (e: TouchEvent) => {
      if (isAtBottom()) {
        bounceTouchStartY = e.touches[0].clientY;
        const content = el.firstElementChild as HTMLElement | null;
        if (content) {
          content.style.transition = "none";
          content.style.transform = "";
        }
      }
    };

    const onBounceMove = (e: TouchEvent) => {
      if (!isAtBottom() && !isBouncing) return;
      const dy = bounceTouchStartY - e.touches[0].clientY;
      if (dy > 0 && isAtBottom()) {
        isBouncing = true;
        const raw = dy * 0.35;
        bounceOffset = -(raw / (1 + raw / 200));
        applyBounce(bounceOffset);
      } else if (isBouncing && dy <= 0) {
        bounceOffset = 0;
        applyBounce(0);
        isBouncing = false;
      }
    };

    const onBounceEnd = () => {
      if (isBouncing) springBack();
    };

    // ── Wheel bounce (desktop) ───────────────────────────────────────
    const wheelDecayTick = () => {
      wheelAccum *= 0.75;
      if (Math.abs(wheelAccum) < 0.5) {
        wheelAccum = 0;
        springBack();
        wheelDecayRaf = null;
        return;
      }
      const raw = wheelAccum * 0.35;
      bounceOffset = -(raw / (1 + raw / 200));
      applyBounce(bounceOffset);
      wheelDecayRaf = requestAnimationFrame(wheelDecayTick);
    };

    // ── Momentum bounce (scroll-event based, catches inertial scroll) ──
    let prevScrollTop = el.scrollTop;
    let prevScrollTime = performance.now();
    let wasAtBottomLast = isAtBottom();

    // ── Existing scroll/unpin logic ──────────────────────────────────
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
      // Bounce on wheel scroll past bottom
      if (e.deltaY > 0 && isAtBottom()) {
        isBouncing = true;
        wheelAccum += e.deltaY;
        // Cap accumulation so the bounce feels bounded
        wheelAccum = Math.min(wheelAccum, 300);
        const raw = wheelAccum * 0.35;
        bounceOffset = -(raw / (1 + raw / 200));
        applyBounce(bounceOffset);
        // Restart decay — each new wheel event resets the timer
        if (wheelDecayRaf) cancelAnimationFrame(wheelDecayRaf);
        wheelDecayRaf = requestAnimationFrame(wheelDecayTick);
      }
    };
    let lastScrollTop = el.scrollTop;
    const onScroll = () => {
      // ── Momentum bounce: detect arrival at bottom with velocity ──
      const now = performance.now();
      const currentScrollTop = el.scrollTop;
      const dt = now - prevScrollTime;
      // Velocity in px/ms (positive = scrolling down). Ignore stale gaps > 200ms.
      const velocity = dt > 0 && dt < 200 ? (currentScrollTop - prevScrollTop) / dt : 0;
      const atBottom = isAtBottom();

      if (atBottom && !wasAtBottomLast && velocity > 0.3 && !isBouncing) {
        // Arrived at bottom with momentum — apply rubber-band bounce
        const raw = Math.min(velocity * 60, 50);
        isBouncing = true;
        bounceOffset = -(raw / (1 + raw / 200));
        applyBounce(bounceOffset);
        requestAnimationFrame(() => springBack());
      }

      wasAtBottomLast = atBottom;
      prevScrollTop = currentScrollTop;
      prevScrollTime = now;

      // ── Unpin during streaming if user scrolls up ──
      if (isStreamingRef.current && currentScrollTop < lastScrollTop - 3) {
        const dist = el.scrollHeight - currentScrollTop - el.clientHeight;
        if (dist > 150) {
          pinnedToBottomRef.current = false;
        }
      }
      lastScrollTop = currentScrollTop;
    };

    // Combine bounce + unpin touch handlers
    const onCombinedTouchStart = (e: TouchEvent) => onBounceStart(e);
    const onCombinedTouchMove = (e: TouchEvent) => onBounceMove(e);
    const onCombinedTouchEnd = () => { onBounceEnd(); onTouchEnd(); };

    el.addEventListener("touchstart", onCombinedTouchStart, { passive: true });
    el.addEventListener("touchmove", onCombinedTouchMove, { passive: true });
    el.addEventListener("touchend", onCombinedTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onCombinedTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onCombinedTouchStart);
      el.removeEventListener("touchmove", onCombinedTouchMove);
      el.removeEventListener("touchend", onCombinedTouchEnd);
      el.removeEventListener("touchcancel", onCombinedTouchEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
      if (bounceRafId) cancelAnimationFrame(bounceRafId);
      if (wheelDecayRaf) cancelAnimationFrame(wheelDecayRaf);
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
