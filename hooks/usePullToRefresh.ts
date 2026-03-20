import { useState, useRef, useEffect, useCallback } from "react";
import type { BackendMode } from "@mc/types/chat";

interface PullToRefreshOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  backendMode: BackendMode;
  sendWS: (msg: { type: string; [key: string]: unknown }) => void;
  sessionKeyRef: React.RefObject<string>;
  enabled?: boolean;
}

/**
 * Pull-up-to-refresh gesture handling with direct DOM transforms.
 * Requires holding past threshold for 1 second before triggering.
 * The lobster wobbles during the hold period.
 */
export function usePullToRefresh({
  scrollRef,
  backendMode,
  sendWS,
  sessionKeyRef,
  enabled = true,
}: PullToRefreshOptions) {
  const PULL_THRESHOLD = 60;
  const HOLD_DURATION = 1000;
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;
  const refreshStartRef = useRef(0);

  const pullStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const didVibrateRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const pullContentRef = useRef<HTMLDivElement>(null);
  const pullSpinnerRef = useRef<HTMLDivElement>(null);
  const setPullTransformRef = useRef<(dist: number, animate: boolean) => void>(() => {});

  // Hold timer state
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartRef = useRef<number>(0);
  const holdLockedRef = useRef(false);
  const holdRafRef = useRef<number | null>(null);

  const setPullTransform = useCallback((dist: number, animate: boolean) => {
    const wrapper = pullContentRef.current;
    const spinner = pullSpinnerRef.current;
    if (!wrapper) return;
    const transition = animate ? "transform 0.45s cubic-bezier(0.22, 0.68, 0.35, 1)" : "none";
    wrapper.style.transition = transition;
    wrapper.style.transform = dist > 0 ? `translateY(${-dist}px)` : "";
    if (spinner) {
      spinner.style.transition = animate ? "opacity 0.3s ease" : "none";
      spinner.style.opacity = dist > 0 ? String(Math.min(dist / (PULL_THRESHOLD * 0.5), 1)) : "0";
      const svg = spinner.querySelector("svg");
      if (svg) svg.style.animation = dist > 0 ? "spin 1s linear infinite" : "none";
    }
  }, []);
  setPullTransformRef.current = setPullTransform;

  /** Set the wobble animation on the lobster emoji. */
  const setLobsterWobble = useCallback((active: boolean) => {
    const spinner = pullSpinnerRef.current;
    if (!spinner) return;
    const lobster = spinner.querySelector("span");
    if (!lobster) return;
    if (active) {
      (lobster as HTMLElement).style.animation = "lobsterWobble 300ms ease-in-out infinite";
      (lobster as HTMLElement).style.display = "inline-block";
    } else {
      (lobster as HTMLElement).style.animation = "none";
    }
  }, []);

  /** Update the progress ring around the spinner to show hold progress. */
  const updateHoldProgress = useCallback((progress: number) => {
    const spinner = pullSpinnerRef.current;
    if (!spinner) return;
    const svg = spinner.querySelector("svg");
    if (!svg) return;
    const path = svg.querySelector("path");
    if (!path) return;
    // Use stroke-dasharray/offset to show progress on the arc
    // The arc path length is approximately 51.8 (270° of r=9 circle ≈ 3/4 * 2π * 9)
    const arcLen = 42.4; // actual rendered length of the 270° arc
    const dashOffset = arcLen * (1 - progress);
    (path as SVGElement).style.strokeDasharray = `${arcLen}`;
    (path as SVGElement).style.strokeDashoffset = `${dashOffset}`;
  }, []);

  const clearHoldState = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdRafRef.current) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
    holdStartRef.current = 0;
    holdLockedRef.current = false;
    setLobsterWobble(false);
    updateHoldProgress(0);
    // Reset stroke-dasharray so the spinner looks normal when not in hold mode
    const spinner = pullSpinnerRef.current;
    if (spinner) {
      const path = spinner.querySelector<SVGElement>("svg path");
      if (path) {
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
      }
    }
  }, [setLobsterWobble, updateHoldProgress]);

  const doRefresh = useCallback(() => {
    setRefreshing(true);
    refreshStartRef.current = Date.now();
    setPullTransform(40, true);
    if (backendMode === "lmstudio" || backendMode === "demo") {
      setTimeout(() => {
        requestAnimationFrame(() => {
          setPullTransform(0, true);
          setRefreshing(false);
        });
      }, 300);
      return;
    }
    sendWS({
      type: "req",
      id: `history-${Date.now()}`,
      method: "chat.history",
      params: { sessionKey: sessionKeyRef.current },
    });
  }, [setPullTransform, backendMode, sendWS, sessionKeyRef]);

  /** Called by history response handler to bounce back the pull indicator. */
  const onHistoryReceived = useCallback(() => {
    if (!refreshingRef.current) return;
    const elapsed = Date.now() - refreshStartRef.current;
    const remaining = Math.max(0, 150 - elapsed);
    setTimeout(() => {
      requestAnimationFrame(() => {
        setPullTransformRef.current(0, true);
        setRefreshing(false);
      });
    }, remaining);
  }, []);

  // Reset pull state when app resumes from background
  useEffect(() => {
    if (!enabled) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !refreshingRef.current) {
        pullStartYRef.current = null;
        isPullingRef.current = false;
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
        clearHoldState();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [enabled, setPullTransform, clearHoldState]);

  // Touch handlers — direct DOM transforms, no React re-renders
  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    const isAtBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 5;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (isAtBottom()) {
        pullStartYRef.current = e.touches[0].clientY;
        isPullingRef.current = false;
        didVibrateRef.current = false;
      }
    };

    /** Animate the hold progress ring via rAF. */
    const animateHoldProgress = () => {
      if (!holdStartRef.current || holdLockedRef.current) return;
      const elapsed = Date.now() - holdStartRef.current;
      const progress = Math.min(elapsed / HOLD_DURATION, 1);
      updateHoldProgress(progress);
      if (progress < 1) {
        holdRafRef.current = requestAnimationFrame(animateHoldProgress);
      }
    };

    /** Start the hold timer when pull exceeds threshold. */
    const startHoldTimer = () => {
      if (holdTimerRef.current || holdLockedRef.current) return;
      holdStartRef.current = Date.now();
      setLobsterWobble(true);
      // Start progress animation
      holdRafRef.current = requestAnimationFrame(animateHoldProgress);
      holdTimerRef.current = setTimeout(() => {
        holdLockedRef.current = true;
        holdTimerRef.current = null;
        if (holdRafRef.current) {
          cancelAnimationFrame(holdRafRef.current);
          holdRafRef.current = null;
        }
        updateHoldProgress(1);
        navigator.vibrate?.(15);
        // Lock in — trigger refresh immediately
        setLobsterWobble(false);
        doRefresh();
        // Clean up pull state
        pullStartYRef.current = null;
        isPullingRef.current = false;
        pullDistanceRef.current = 0;
      }, HOLD_DURATION);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (pullStartYRef.current === null || refreshingRef.current) return;
      if (holdLockedRef.current) return;
      if (!isAtBottom() && !isPullingRef.current) {
        pullStartYRef.current = null;
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
        clearHoldState();
        return;
      }
      const deltaY = pullStartYRef.current - e.touches[0].clientY;
      if (deltaY > 0) {
        isPullingRef.current = true;
        const raw = deltaY * 0.4;
        const dist = raw < PULL_THRESHOLD
          ? raw
          : PULL_THRESHOLD + (raw - PULL_THRESHOLD) * 0.15;
        pullDistanceRef.current = dist;

        if (dist >= PULL_THRESHOLD) {
          if (!didVibrateRef.current) {
            didVibrateRef.current = true;
            navigator.vibrate?.(10);
          }
          startHoldTimer();
        } else {
          // Dropped below threshold — cancel hold
          if (holdTimerRef.current) {
            clearHoldState();
          }
        }

        setPullTransform(dist, false);
        e.preventDefault();
      } else {
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
        if (holdTimerRef.current) {
          clearHoldState();
        }
      }
    };

    const onTouchEnd = () => {
      if (pullStartYRef.current === null) return;
      pullStartYRef.current = null;
      const wasPulling = isPullingRef.current;
      isPullingRef.current = false;
      pullDistanceRef.current = 0;

      // If hold already locked in (refresh triggered), nothing to do
      if (holdLockedRef.current) {
        clearHoldState();
        return;
      }

      // Released before hold completed — snap back
      clearHoldState();
      if (wasPulling) {
        setPullTransform(0, true);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (holdRafRef.current) cancelAnimationFrame(holdRafRef.current);
    };
  }, [enabled, scrollRef, doRefresh, setPullTransform, clearHoldState, setLobsterWobble, updateHoldProgress]);

  return {
    pullContentRef,
    pullSpinnerRef,
    isPullingRef,
    refreshing,
    onHistoryReceived,
  };
}
