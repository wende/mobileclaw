"use client";

import { useEffect, useState, useRef } from "react";

interface ThinkingIndicatorProps {
  isExiting?: boolean;
  onExitComplete?: () => void;
  startTime?: number; // Timestamp when thinking started
}

export function ThinkingIndicator({ isExiting, onExitComplete, startTime }: ThinkingIndicatorProps) {
  const text = "Thinking...";
  const [visibleCount, setVisibleCount] = useState(text.length);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Track mounted state for safe state updates
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clear any running interval on unmount
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Update elapsed time every second
  useEffect(() => {
    if (!startTime || isExiting) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Initial calculation
    const updateElapsed = () => {
      if (mountedRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      }
    };
    updateElapsed();

    timerRef.current = setInterval(updateElapsed, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [startTime, isExiting]);

  useEffect(() => {
    // Clear any existing interval first
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!isExiting) {
      // Reset to full text when not exiting
      setVisibleCount(text.length);
      return;
    }

    // Start dissolve animation
    let count = text.length;
    intervalRef.current = setInterval(() => {
      if (!mountedRef.current) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }
      count--;
      setVisibleCount(count);
      if (count <= 0) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (mountedRef.current) {
          onExitComplete?.();
        }
      }
    }, 35); // ~35ms per char = ~350ms total for 11 chars

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isExiting, onExitComplete]);

  const visibleText = text.slice(0, visibleCount);
  const hasDots = visibleCount > 8; // "Thinking." ends at index 8

  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-sm text-muted-foreground flex items-center">
        {hasDots ? (
          <>
            <span>Thinking</span>
            <span className="inline-flex w-5">
              {visibleCount > 8 && <span className={isExiting ? "" : "animate-[dotFade_1.4s_ease-in-out_infinite]"}>.</span>}
              {visibleCount > 9 && <span className={isExiting ? "" : "animate-[dotFade_1.4s_ease-in-out_0.2s_infinite]"}>.</span>}
              {visibleCount > 10 && <span className={isExiting ? "" : "animate-[dotFade_1.4s_ease-in-out_0.4s_infinite]"}>.</span>}
            </span>
          </>
        ) : (
          <span>{visibleText}</span>
        )}
      </div>
      {startTime && elapsedSeconds > 0 && !isExiting && (
        <div className="text-[10px] text-muted-foreground/50 tabular-nums">{elapsedSeconds}s</div>
      )}
    </div>
  );
}
