import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import type { Message } from "@mc/types/chat";

/** After pinning, ignore scroll-based unpin checks for this long (ms).
 *  Prevents layout reflows from immediately unpinning after send. */
export const PIN_LOCK_MS = 500;
const STREAM_UNPIN_DISTANCE_PX = 100;
const STREAM_WHEEL_UNPIN_DELTA_PX = 20;
const STREAM_TOUCH_UNPIN_DELTA_PX = 18;
const STREAM_REPIN_DISTANCE_PX = 32;

/**
 * Manages scroll tracking, auto-scroll pinning, morph bar animation,
 * and ResizeObserver-based content tracking.
 */
export function useScrollManager({
  messages,
  isStreamingRef,
  isNativeRef,
  useDocumentScroll = false,
}: {
  messages: Message[];
  isStreamingRef: React.RefObject<boolean>;
  isNativeRef?: React.RefObject<boolean>;
  useDocumentScroll?: boolean;
}) {
  const [scrollPhase, setScrollPhase] = useState<"input" | "pill">("input");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const footerReserveRef = useRef<HTMLDivElement>(null);
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
  // Sticky manual-unpin mode: once user strongly scrolls up during streaming,
  // keep auto-scroll off until they intentionally return to bottom.
  const manualStreamUnpinRef = useRef(false);
  const wheelUpIntentRef = useRef(0);

  const getScrollElement = useCallback(() => {
    if (typeof document === "undefined") return null;
    return (useDocumentScroll ? (document.scrollingElement ?? document.documentElement) : scrollRef.current) as HTMLElement | null;
  }, [useDocumentScroll]);

  const getViewportHeight = useCallback((el: HTMLElement | null) => {
    if (!el) return 0;
    return el.clientHeight;
  }, []);

  const getDocumentChromeOffset = useCallback(() => {
    if (!useDocumentScroll || typeof document === "undefined" || typeof window === "undefined") return 0;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:-9999px;top:0;height:100vh;width:0;pointer-events:none;";
    document.body.appendChild(probe);
    const layoutViewportHeight = probe.getBoundingClientRect().height;
    probe.remove();
    return Math.max(0, layoutViewportHeight - window.innerHeight);
  }, [useDocumentScroll]);

  const getDocumentBottomTarget = useCallback((el: HTMLElement | null) => {
    if (!el || !useDocumentScroll || !bottomRef.current) return null;
    const footerReserveHeight = footerReserveRef.current?.getBoundingClientRect().height ?? 0;
    const viewportHeight = getViewportHeight(el);
    const bottomTop = bottomRef.current.getBoundingClientRect().top + el.scrollTop;
    const chromeOffset = getDocumentChromeOffset();
    return Math.max(0, bottomTop - (viewportHeight - footerReserveHeight) + chromeOffset);
  }, [getDocumentChromeOffset, getViewportHeight, useDocumentScroll]);

  const getDistanceFromBottom = useCallback((el: HTMLElement | null) => {
    if (!el) return 0;
    const documentTarget = getDocumentBottomTarget(el);
    if (documentTarget != null) {
      return Math.max(0, documentTarget - el.scrollTop);
    }
    return el.scrollHeight - el.scrollTop - getViewportHeight(el);
  }, [getDocumentBottomTarget, getViewportHeight]);

  const clearManualStreamUnpin = useCallback(() => {
    manualStreamUnpinRef.current = false;
    wheelUpIntentRef.current = 0;
  }, []);

  const disengageStreamingAutoscroll = useCallback(() => {
    pinnedToBottomRef.current = false;
    manualStreamUnpinRef.current = true;
    wheelUpIntentRef.current = 0;
    scrollGraceRef.current = false;
    if (scrollGraceTimerRef.current) {
      clearTimeout(scrollGraceTimerRef.current);
      scrollGraceTimerRef.current = null;
    }
  }, []);

  /** Activate/deactivate grace period based on streaming transitions. */
  const updateGraceForStreamingChange = useCallback((wasStreaming: boolean, nowStreaming: boolean) => {
    if (wasStreaming && !nowStreaming) {
      clearManualStreamUnpin();
      if (pinnedToBottomRef.current) {
        scrollGraceRef.current = true;
        if (scrollGraceTimerRef.current) clearTimeout(scrollGraceTimerRef.current);
        scrollGraceTimerRef.current = setTimeout(() => {
          scrollGraceRef.current = false;
          scrollGraceTimerRef.current = null;
        }, 500);
      }
    } else if (nowStreaming) {
      wheelUpIntentRef.current = 0;
      scrollGraceRef.current = false;
      if (scrollGraceTimerRef.current) {
        clearTimeout(scrollGraceTimerRef.current);
        scrollGraceTimerRef.current = null;
      }
    }
  }, [clearManualStreamUnpin]);

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
      const el = getScrollElement();
      if (!el) return;

      // Detect container resize (keyboard open/close, viewport change).
      // When clientHeight changes while pinned to bottom, the stale scrollTop
      // makes distanceFromBottom spike — but it's not a real user scroll.
      // Let the browser handle the scroll adjustment naturally; just keep
      // the morph locked at 0 so the input bar doesn't glitch.
      // (Third-party keyboards like SwiftKey resize in multiple discrete steps,
      // so this can fire several times during a single keyboard animation.)
      const currentHeight = getViewportHeight(el);
      const heightChanged = Math.abs(currentHeight - lastClientHeightRef.current) > 2;
      lastClientHeightRef.current = currentHeight;

      if (heightChanged && pinnedToBottomRef.current) {
        if (!useDocumentScroll) {
          el.scrollTop = el.scrollHeight;
        }
        setMorphTarget(0);
        return;
      }

      // During initial page load, expanding content (thinking blocks, images)
      // causes transient scroll events — suppress morph to avoid glitch.
      if (morphSuppressedRef.current) {
        setMorphTarget(0);
        return;
      }

      const distanceFromBottom = getDistanceFromBottom(el);

      // During streaming or pin-lock window, don't unpin from scroll position —
      // only the wheel/touch handlers can unpin. But DO allow re-pinning when
      // the user scrolls back near the bottom during streaming.
      if (!isStreamingRef.current && !scrollGraceRef.current && Date.now() > pinLockUntilRef.current) {
        pinnedToBottomRef.current = distanceFromBottom < 80;
        if (pinnedToBottomRef.current) clearManualStreamUnpin();
      } else if (isStreamingRef.current && !manualStreamUnpinRef.current && !pinnedToBottomRef.current && distanceFromBottom < 80) {
        pinnedToBottomRef.current = true;
        pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;
        clearManualStreamUnpin();
      }

      // When streaming (or grace period) and pinned, lock morph to input mode (--sp = 0)
      if ((isStreamingRef.current || scrollGraceRef.current) && pinnedToBottomRef.current) {
        setMorphTarget(0);
        return;
      }

      const range = 60;
      const progress = Math.min(Math.max(distanceFromBottom / range, 0), 1);
      setMorphTarget(progress);
    });
  }, [clearManualStreamUnpin, getDistanceFromBottom, getScrollElement, getViewportHeight, isStreamingRef, setMorphTarget, useDocumentScroll]);

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

  const scrollToBottom = useCallback((opts?: { instant?: boolean }) => {
    pinnedToBottomRef.current = true;
    pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;
    clearManualStreamUnpin();
    clearBounceTransform();
    const el = getScrollElement();
    if (!el) return;

    const target = getDocumentBottomTarget(el) ?? (el.scrollHeight - getViewportHeight(el));
    const start = el.scrollTop;
    const distance = target - start;
    if (distance <= 0) {
      // Already at bottom — reset morph so a stale pill clears immediately.
      setMorphTarget(0);
      return;
    }

    if (opts?.instant) {
      el.scrollTop = target;
      setMorphTarget(0);
      return;
    }

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
        // (which fire async) still see the flag.
        requestAnimationFrame(() => { isAnimatingScrollRef.current = false; });
      }
    };

    requestAnimationFrame(animate);
  }, [clearBounceTransform, clearManualStreamUnpin, getDocumentBottomTarget, getScrollElement, getViewportHeight, isStreamingRef, setMorphTarget]);

  // Auto-scroll: whenever messages change, snap to bottom if pinned.
  // During streaming, the rAF loop handles smooth scrolling instead.
  useLayoutEffect(() => {
    if (!pinnedToBottomRef.current || messages.length === 0) return;
    if (isStreamingRef.current) return;
    const el = getScrollElement();
    if (!el) return;
    if (!hasScrolledInitialRef.current) {
      hasScrolledInitialRef.current = true;
    }
    clearBounceTransform();
    el.scrollTop = getDocumentBottomTarget(el) ?? el.scrollHeight;
  }, [messages, clearBounceTransform, getDocumentBottomTarget, getScrollElement]);

  // ResizeObserver: catch content-height changes (e.g. images loading, zen collapses).
  useEffect(() => {
    const el = getScrollElement();
    const surface = scrollRef.current;
    if (!el || !surface) return;
    const content = surface.firstElementChild as HTMLElement | null;
    if (!content) return;

    const ro = new ResizeObserver(() => {
      if (isAnimatingScrollRef.current) return;

      if (isStreamingRef.current) {
        // During streaming, only allow content to grow — never shrink.
        // This prevents zen collapses from reducing scrollHeight and causing
        // the scroll position to jump back up.
        const currentHeight = content.offsetHeight;
        const prevMin = parseFloat(content.style.minHeight) || 0;
        if (currentHeight > prevMin) {
          content.style.minHeight = `${currentHeight}px`;
        }
        return;
      }

      // During grace period, keep the streaming height lock and let the rAF
      // momentum loop handle scroll smoothly. The rAF tick will clear minHeight
      // once grace expires.
      if (!scrollGraceRef.current) {
        content.style.minHeight = "";
      }

      if ((pinnedToBottomRef.current || scrollGraceRef.current) && el.scrollHeight > getViewportHeight(el)) {
        // During grace period the rAF momentum loop is still running —
        // let it smoothly catch up instead of hard-snapping.
        if (!scrollGraceRef.current) {
          el.scrollTop = getDocumentBottomTarget(el) ?? el.scrollHeight;
        }
        pinnedToBottomRef.current = true;
      } else if (!pinnedToBottomRef.current && !scrollGraceRef.current) {
        // Content shrank (e.g. collapsing a tool call) while unpinned.
        // If we're now back at the bottom, re-pin and clear the pill.
        const dist = getDistanceFromBottom(el);
        if (dist < 80) {
          pinnedToBottomRef.current = true;
          setMorphTarget(Math.min(Math.max(dist / 60, 0), 1));
        }
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [getDistanceFromBottom, getDocumentBottomTarget, getScrollElement, getViewportHeight, setMorphTarget]);

  // rAF loop: during streaming, smoothly scroll toward bottom.
  // Uses velocity with momentum — desired speed scales with gap size,
  // actual velocity smoothly blends toward desired. No stutters on retarget.
  // All constants are normalized to 60fps so behavior is consistent at any refresh rate.
  useEffect(() => {
    const el = getScrollElement();
    if (!el) return;
    let id: number;
    // velocity in px-per-60fps-frame; multiplied by frameScale before applying
    let velocity = 0;
    let lastTime = 0;
    let wasStreaming = isStreamingRef.current;

    // Tuning constants (normalized to 60fps baseline)
    const TARGET_FRAME_MS = 16.67;      // 60fps reference frame duration
    const SCROLL_MIN_DIFF = 0.5;        // px — gap below which we consider "at bottom"
    const SCROLL_VELOCITY_FACTOR = 0.04; // desired velocity as fraction of remaining gap
    const SCROLL_MOMENTUM_FACTOR = 0.12; // per-frame blend toward desired velocity (60fps)
    const SCROLL_MIN_VELOCITY = 0.5;     // px/frame minimum while actively scrolling

    let pendingMinHeightClear = false;

    const tick = (timestamp: number) => {
      if (wasStreaming && !isStreamingRef.current) {
        // Don't clear minHeight immediately — defer until after the grace period
        // so content height stays stable during smooth scroll wind-down.
        pendingMinHeightClear = true;
      }
      if (pendingMinHeightClear && !scrollGraceRef.current) {
        const content = el.firstElementChild as HTMLElement | null;
        if (content) content.style.minHeight = "";
        pendingMinHeightClear = false;
      }
      wasStreaming = isStreamingRef.current;

      const rawDelta = lastTime ? timestamp - lastTime : TARGET_FRAME_MS;
      // Clamp to 50ms to prevent huge jumps after tab switch or system sleep
      const deltaTime = Math.min(rawDelta, 50);
      lastTime = timestamp;
      // Scale factors: 1.0 at 60fps, 0.5 at 120fps, 2.0 at 30fps
      const frameScale = deltaTime / TARGET_FRAME_MS;

      if (
        (pinnedToBottomRef.current || scrollGraceRef.current) &&
        (isStreamingRef.current || scrollGraceRef.current) &&
        el.scrollHeight > getViewportHeight(el)
      ) {
        const target = getDocumentBottomTarget(el) ?? (el.scrollHeight - getViewportHeight(el));
        const diff = target - el.scrollTop;

        if (diff > SCROLL_MIN_DIFF) {
          if (scrollGraceRef.current && !isStreamingRef.current) {
            // Grace wind-down: no new content arriving, just close the gap.
            // Skip momentum smoothing — move 20% of remaining distance each
            // frame for a smooth exponential decay that fully settles in ~200ms.
            const step = Math.max(diff * 0.2 * frameScale, 1);
            el.scrollTop = Math.min(el.scrollTop + step, target);
            velocity = 0;
          } else {
            // Desired velocity proportional to gap: more lines behind = faster
            const desiredVelocity = diff * SCROLL_VELOCITY_FACTOR;
            // Exponential smoothing toward desired velocity, frame-rate independent
            velocity += (desiredVelocity - velocity) * (1 - Math.pow(1 - SCROLL_MOMENTUM_FACTOR, frameScale));
            velocity = Math.max(velocity, SCROLL_MIN_VELOCITY);
            el.scrollTop = Math.min(el.scrollTop + velocity * frameScale, target);
          }
        } else {
          velocity = 0;
        }
      } else {
        velocity = 0;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [getDocumentBottomTarget, getScrollElement, getViewportHeight, isStreamingRef]);

  // Unpin auto-scroll when user actively scrolls up (wheel or touch).
  useEffect(() => {
    const el = getScrollElement();
    const eventTarget: Window | HTMLElement | null = useDocumentScroll ? window : scrollRef.current;
    if (!el || !eventTarget) return;

    let touchStartY = 0;

    const onTouchStart = (event: Event) => {
      const e = event as TouchEvent;
      touchStartY = e.touches[0].clientY;
    };
    const onTouchMove = (event: Event) => {
      const e = event as TouchEvent;
      if (isStreamingRef.current && pinnedToBottomRef.current) {
        const dy = e.touches[0].clientY - touchStartY;
        if (dy > STREAM_TOUCH_UNPIN_DELTA_PX) {
          disengageStreamingAutoscroll();
        }
      }
    };
    const onTouchEnd = () => {
      if (isStreamingRef.current && !manualStreamUnpinRef.current) {
        const dist = getDistanceFromBottom(getScrollElement());
        if (dist < 80) pinnedToBottomRef.current = true;
      }
    };
    const onWheel = (event: Event) => {
      const e = event as WheelEvent;
      if (isStreamingRef.current && pinnedToBottomRef.current) {
        if (e.deltaY < 0) {
          wheelUpIntentRef.current += Math.abs(e.deltaY);
          const dist = getDistanceFromBottom(getScrollElement());
          if (dist > STREAM_UNPIN_DISTANCE_PX || wheelUpIntentRef.current >= STREAM_WHEEL_UNPIN_DELTA_PX) {
            disengageStreamingAutoscroll();
          }
        } else if (e.deltaY > 0) {
          wheelUpIntentRef.current = 0;
        }
      }
    };
    let lastScrollTop = el.scrollTop;
    const onScroll = () => {
      const metricsEl = getScrollElement();
      if (!metricsEl) return;
      const currentScrollTop = metricsEl.scrollTop;
      // Unpin during streaming if user scrolls up
      if (isStreamingRef.current && currentScrollTop < lastScrollTop - 3) {
        const dist = getDistanceFromBottom(metricsEl);
        if (dist > STREAM_UNPIN_DISTANCE_PX) {
          disengageStreamingAutoscroll();
        }
      }
      // Re-pin during streaming/grace if user scrolls near bottom
      if ((isStreamingRef.current || scrollGraceRef.current) && !pinnedToBottomRef.current) {
        const dist = getDistanceFromBottom(metricsEl);
        const scrollingDown = currentScrollTop > lastScrollTop + 1;
        const canRepin = !manualStreamUnpinRef.current
          ? dist < 80
          : scrollingDown && dist < STREAM_REPIN_DISTANCE_PX;
        if (canRepin) {
          pinnedToBottomRef.current = true;
          pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;
          clearManualStreamUnpin();
        }
      }
      lastScrollTop = currentScrollTop;
    };

    eventTarget.addEventListener("touchstart", onTouchStart, { passive: true });
    eventTarget.addEventListener("touchmove", onTouchMove, { passive: true });
    eventTarget.addEventListener("touchend", onTouchEnd, { passive: true });
    eventTarget.addEventListener("touchcancel", onTouchEnd, { passive: true });
    eventTarget.addEventListener("wheel", onWheel, { passive: true });
    eventTarget.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      eventTarget.removeEventListener("touchstart", onTouchStart);
      eventTarget.removeEventListener("touchmove", onTouchMove);
      eventTarget.removeEventListener("touchend", onTouchEnd);
      eventTarget.removeEventListener("touchcancel", onTouchEnd);
      eventTarget.removeEventListener("wheel", onWheel);
      eventTarget.removeEventListener("scroll", onScroll);
    };
  }, [clearManualStreamUnpin, disengageStreamingAutoscroll, getDistanceFromBottom, getScrollElement, isNativeRef, isStreamingRef, useDocumentScroll]);

  useEffect(() => {
    if (!useDocumentScroll) return;
    const onWindowScroll = () => handleScroll();
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    return () => window.removeEventListener("scroll", onWindowScroll);
  }, [handleScroll, useDocumentScroll]);

  return {
    scrollRef,
    bottomRef,
    footerReserveRef,
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
