import { useState, useRef, useEffect, useCallback } from "react";
import type { BackendMode } from "@/types/chat";

interface PullToRefreshOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  backendMode: BackendMode;
  sendWS: (msg: { type: string; [key: string]: unknown }) => void;
  sessionKeyRef: React.RefObject<string>;
}

/**
 * Pull-up-to-refresh gesture handling with direct DOM transforms.
 * Returns refs for the pull content wrapper and spinner, plus the refreshing state.
 */
export function usePullToRefresh({
  scrollRef,
  backendMode,
  sendWS,
  sessionKeyRef,
}: PullToRefreshOptions) {
  const PULL_THRESHOLD = 60;
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
      if (svg) (svg as HTMLElement).style.animation = dist > 0 ? "spin 1s linear infinite" : "none";
    }
  }, []);
  setPullTransformRef.current = setPullTransform;

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

  // Touch handlers — direct DOM transforms, no React re-renders
  useEffect(() => {
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

    const onTouchMove = (e: TouchEvent) => {
      if (pullStartYRef.current === null || refreshingRef.current) return;
      if (!isAtBottom() && !isPullingRef.current) {
        pullStartYRef.current = null;
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
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
        if (dist >= PULL_THRESHOLD && !didVibrateRef.current) {
          didVibrateRef.current = true;
          navigator.vibrate?.(10);
        }
        setPullTransform(dist, false);
        e.preventDefault();
      } else {
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
      }
    };

    const onTouchEnd = () => {
      if (pullStartYRef.current === null) return;
      pullStartYRef.current = null;
      const wasPulling = isPullingRef.current;
      const dist = pullDistanceRef.current;
      isPullingRef.current = false;
      pullDistanceRef.current = 0;

      if (wasPulling && dist >= PULL_THRESHOLD) {
        doRefresh();
      } else {
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
    };
  }, [scrollRef, doRefresh, setPullTransform]);

  return {
    pullContentRef,
    pullSpinnerRef,
    isPullingRef,
    refreshing,
    onHistoryReceived,
  };
}
