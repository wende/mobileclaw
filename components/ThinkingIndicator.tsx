"use client";

import { useEffect, useState, useRef } from "react";

interface ThinkingIndicatorProps {
  isExiting?: boolean;
  onExitComplete?: () => void;
}

export function ThinkingIndicator({ isExiting, onExitComplete }: ThinkingIndicatorProps) {
  const text = "Thinking...";
  const [visibleCount, setVisibleCount] = useState(text.length);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
    };
  }, []);

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
    <div className="flex gap-3">
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
    </div>
  );
}
