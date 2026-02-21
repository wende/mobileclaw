"use client";

import { useEffect, useState, useRef } from "react";

interface ThinkingIndicatorProps {
  visible: boolean;
  startTime?: number; // Timestamp when thinking started
}

export function ThinkingIndicator({ visible, startTime }: ThinkingIndicatorProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset elapsed when hidden
  useEffect(() => {
    if (!visible) setElapsedSeconds(0);
  }, [visible]);

  // Update elapsed time every second
  useEffect(() => {
    if (!startTime || !visible) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    };
    updateElapsed();

    timerRef.current = setInterval(updateElapsed, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [startTime, visible]);

  return (
    <div
      className="flex flex-col gap-0.5 transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0.01 }}
    >
      <div className="text-sm text-muted-foreground flex items-center">
        <span>Thinking</span>
        <span className="inline-flex w-5">
          <span className="animate-[dotFade_1.4s_ease-in-out_infinite]">.</span>
          <span className="animate-[dotFade_1.4s_ease-in-out_0.2s_infinite]">.</span>
          <span className="animate-[dotFade_1.4s_ease-in-out_0.4s_infinite]">.</span>
        </span>
      </div>
      {startTime && elapsedSeconds > 0 && visible && (
        <div className="text-[10px] text-muted-foreground/50 tabular-nums">{elapsedSeconds}s</div>
      )}
    </div>
  );
}
