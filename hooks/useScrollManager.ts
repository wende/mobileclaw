import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import type { Message } from "@/types/chat";

/** After pinning, ignore scroll-based unpin checks for this long (ms).
 *  Prevents layout reflows from immediately unpinning after send. */
export const PIN_LOCK_MS = 500;

/**
 * Manages scroll tracking, auto-scroll pinning, morph bar animation,
 * and ResizeObserver-based content tracking.
 */
export function useScrollManager(
  messages: Message[],
  isStreamingRef: React.RefObject<boolean>,
  isNativeRef?: React.RefObject<boolean>,
) {
  const [scrollPhase, setScrollPhase] = useState<"input" | "pill">("input");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const morphRef = useRef<HTMLDivElement>(null);
  const scrollRafId = useRef<number | null>(null);
  const scrollPhaseRef = useRef<"input" | "pill">("input");
  const pinnedToBottomRef = useRef(true);
  const pinLockUntilRef = useRef(0); // timestamp — don't unpin until after this
  const hasScrolledInitialRef = useRef(false);

  // Suppress morph during initial page load: expanding thinking blocks
  // and rendering content causes transient scroll events where
  // distanceFromBottom spikes briefly, making the input bar glitch.
  const morphSuppressedRef = useRef(true);

  // Track container height to detect keyboard open/close (vs user scroll)
  const lastClientHeightRef = useRef(0);

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

  // Un-suppress morph after initial render settles
  useEffect(() => {
    const timer = setTimeout(() => {
      morphSuppressedRef.current = false;
    }, 600);
    return () => clearTimeout(timer);
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

      // Detect container resize (keyboard open/close, viewport change).
      // When clientHeight changes while pinned to bottom, the stale scrollTop
      // makes distanceFromBottom spike — but it's not a real user scroll.
      // Let the browser handle the scroll adjustment naturally; just keep
      // the morph locked at 0 so the input bar doesn't glitch.
      // (Third-party keyboards like SwiftKey resize in multiple discrete steps,
      // so this can fire several times during a single keyboard animation.)
      const currentHeight = el.clientHeight;
      const heightChanged = Math.abs(currentHeight - lastClientHeightRef.current) > 2;
      lastClientHeightRef.current = currentHeight;

      if (heightChanged && pinnedToBottomRef.current) {
        el.scrollTop = el.scrollHeight;
        setMorphTarget(0);
        return;
      }

      // During initial page load, expanding content (thinking blocks, images)
      // causes transient scroll events — suppress morph to avoid glitch.
      if (morphSuppressedRef.current) {
        setMorphTarget(0);
        return;
      }

      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

      // During streaming or pin-lock window, don't unpin from scroll position —
      // only the wheel/touch handlers can unpin. But DO allow re-pinning when
      // the user scrolls back near the bottom during streaming.
      if (!isStreamingRef.current && !scrollGraceRef.current && Date.now() > pinLockUntilRef.current) {
        pinnedToBottomRef.current = distanceFromBottom < 80;
      } else if (isStreamingRef.current && !pinnedToBottomRef.current && distanceFromBottom < 80) {
        pinnedToBottomRef.current = true;
        pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;
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

  /** Clear any stuck bounce transform on the content div. */
  const clearBounceTransform = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const content = el.firstElementChild as HTMLElement | null;
    if (content && content.style.transform) {
      content.style.transition = "";
      content.style.transform = "";
    }
  }, []);

  // Flag to prevent ResizeObserver from snapping scrollTop mid-animation
  const isAnimatingScrollRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    pinnedToBottomRef.current = true;
    pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;
    clearBounceTransform();
    const el = scrollRef.current;
    if (!el) return;

    const target = el.scrollHeight - el.clientHeight;
    const start = el.scrollTop;
    const distance = target - start;
    if (distance <= 0) return;

    // During streaming/grace the rAF loop pins us to bottom every frame,
    // so just snap — a smooth animation would be overridden anyway.
    if (isStreamingRef.current || scrollGraceRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }

    isAnimatingScrollRef.current = true;

    // Adaptive duration: short scrolls feel snappy, long scrolls don't drag.
    // sqrt(distance) * 18 gives ~180ms for 100px, ~360ms for 400px, capped at 420ms.
    const duration = Math.min(Math.max(Math.sqrt(distance) * 18, 160), 420);
    const startTime = performance.now();

    // Ease-out quart: aggressive initial speed with a long tail — matches
    // the deceleration feel of native iOS momentum scrolling.
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      el.scrollTop = start + distance * easeOut(progress);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Delay clearing by one frame so the final scroll events
        // (which fire async) still see the flag and don't trigger
        // the momentum bounce.
        requestAnimationFrame(() => { isAnimatingScrollRef.current = false; });
      }
    };

    requestAnimationFrame(animate);
  }, [clearBounceTransform, isStreamingRef]);

  // Auto-scroll: whenever messages change, snap to bottom if pinned.
  useLayoutEffect(() => {
    if (!pinnedToBottomRef.current || messages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    if (!hasScrolledInitialRef.current) {
      hasScrolledInitialRef.current = true;
    }
    clearBounceTransform();
    el.scrollTop = el.scrollHeight;
  }, [messages, clearBounceTransform]);

  // ResizeObserver: catch content-height changes when NOT streaming (e.g. images loading).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const content = el.firstElementChild;
    if (!content) return;

    const ro = new ResizeObserver(() => {
      if (isAnimatingScrollRef.current) return;
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
    // Momentum bounce: delayed spring-back timer
    const momentumTimer: ReturnType<typeof setTimeout> | null = null;

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
      // Match pull-to-refresh snap-back: same duration + easing
      content.style.transition = "transform 0.45s cubic-bezier(0.22, 0.68, 0.35, 1)";
      content.style.transform = "";
      bounceOffset = 0;
      isBouncing = false;
      bounceRafId = null;
    };

    // Rubber-band curve matching pull-to-refresh: linear up to threshold,
    // then heavy diminishing returns past it.
    const BOUNCE_THRESHOLD = 60;
    const rubberBand = (raw: number) =>
      raw < BOUNCE_THRESHOLD
        ? raw
        : BOUNCE_THRESHOLD + (raw - BOUNCE_THRESHOLD) * 0.15;

    const isAtBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 2;

    // ── Touch tracking ────────────────────────────────────────────────
    let touchStartY = 0; // always captured, for unpin detection

    // ── Touch bounce (skipped in native — WebKit handles rubber-band) ──
    const native = !!isNativeRef?.current;

    const onBounceStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
      if (native) return;
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
      if (native) return;
      if (!isAtBottom() && !isBouncing) return;
      const dy = bounceTouchStartY - e.touches[0].clientY;
      if (dy > 0 && isAtBottom()) {
        isBouncing = true;
        // Same multiplier + rubber-band curve as pull-to-refresh
        const raw = dy * 0.4;
        bounceOffset = -rubberBand(raw);
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
      bounceOffset = -rubberBand(wheelAccum * 0.4);
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
      // Bounce on wheel scroll past bottom (skipped in native)
      if (!native && e.deltaY > 0 && isAtBottom()) {
        isBouncing = true;
        wheelAccum += e.deltaY;
        wheelAccum = Math.min(wheelAccum, 400);
        bounceOffset = -rubberBand(wheelAccum * 0.4);
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

      if (atBottom && !wasAtBottomLast && velocity > 0.3 && !isBouncing && Date.now() > pinLockUntilRef.current && !isStreamingRef.current && !isNativeRef?.current && !isAnimatingScrollRef.current && !morphSuppressedRef.current) {
        // Arrived at bottom with momentum — smooth rAF-driven bounce
        // Scale velocity to a generous displacement matching pull-to-refresh feel
        const raw = Math.min(velocity * 150, 120);
        const peak = -rubberBand(raw);
        isBouncing = true;
        const content = el.firstElementChild as HTMLElement | null;
        if (content) {
          content.style.transition = "none";
          const bounceStart = performance.now();
          // Adaptive duration: small bounces are snappy, large ones slower
          const duration = Math.min(200 + Math.abs(peak) * 3, 500);
          const PEAK_FRAC = 0.25;
          const easeOutCub = (t: number) => 1 - Math.pow(1 - t, 3);

          const animateMomentumBounce = (ts: number) => {
            const t = Math.min((ts - bounceStart) / duration, 1);
            let offset: number;
            if (t < PEAK_FRAC) {
              offset = peak * easeOutCub(t / PEAK_FRAC);
            } else {
              offset = peak * (1 - easeOutCub((t - PEAK_FRAC) / (1 - PEAK_FRAC)));
            }
            content.style.transform = Math.abs(offset) > 0.5 ? `translateY(${offset.toFixed(1)}px)` : "";
            if (t < 1) {
              bounceRafId = requestAnimationFrame(animateMomentumBounce);
            } else {
              content.style.transform = "";
              bounceOffset = 0;
              isBouncing = false;
              bounceRafId = null;
            }
          };

          if (bounceRafId) cancelAnimationFrame(bounceRafId);
          bounceRafId = requestAnimationFrame(animateMomentumBounce);
        }
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
    const onCombinedTouchMove = (e: TouchEvent) => {
      onBounceMove(e);
      // Unpin when user swipes up during streaming (finger moves down → clientY increases)
      if (isStreamingRef.current && pinnedToBottomRef.current) {
        const dy = e.touches[0].clientY - touchStartY;
        if (dy > 15) {
          pinnedToBottomRef.current = false;
        }
      }
    };
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
      if (momentumTimer) clearTimeout(momentumTimer);
      // Clear any stuck bounce transform
      const content = el.firstElementChild as HTMLElement | null;
      if (content) { content.style.transition = ""; content.style.transform = ""; }
    };
  }, [isStreamingRef]);

  return {
    scrollRef,
    bottomRef,
    morphRef,
    scrollPhase,
    pinnedToBottomRef,
    pinLockUntilRef,
    scrollGraceRef,
    handleScroll,
    scrollToBottom,
    updateGraceForStreamingChange,
  };
}
