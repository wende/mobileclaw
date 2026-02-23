"use client";

import { useEffect, useState, useRef } from "react";

interface ThinkingIndicatorProps {
  visible: boolean;
  startTime?: number; // Timestamp when thinking started
  label?: string; // Override label (e.g. "Compacting")
}

export function ThinkingIndicator({ visible, startTime, label }: ThinkingIndicatorProps) {
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

  const isCompacting = label === "Compacting";
  const displayLabel = label || "Thinking";

  return (
    <div
      className="flex flex-col gap-0.5 transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0.01 }}
    >
      <div className="text-sm text-muted-foreground flex items-center">
        {isCompacting && visible && <span className="mr-1.5"><CompactingIcon /></span>}
        <span>{displayLabel}</span>
        <span className="inline-flex w-5">
          <span className="animate-[dotFade_1.4s_ease-in-out_infinite]">.</span>
          <span className="animate-[dotFade_1.4s_ease-in-out_0.2s_infinite]">.</span>
          <span className="animate-[dotFade_1.4s_ease-in-out_0.4s_infinite]">.</span>
        </span>
      </div>
      {startTime && elapsedSeconds > 0 && visible && (
        <div className={`text-[10px] text-muted-foreground/50 tabular-nums ${isCompacting ? "ml-6" : ""}`}>{elapsedSeconds}s</div>
      )}
    </div>
  );
}

function CompactingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
      {/* Outer box shrinks in */}
      <rect
        x="2" y="2" width="12" height="12" rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="animate-[compactShrink_1.6s_ease-in-out_infinite]"
        style={{ transformOrigin: "center" }}
      />
      {/* Inner arrows pointing inward */}
      <g className="animate-[compactArrows_1.6s_ease-in-out_infinite]" style={{ transformOrigin: "center" }}>
        {/* Top arrow */}
        <line x1="8" y1="4" x2="8" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <polyline points="6.5,5.5 8,4 9.5,5.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Bottom arrow */}
        <line x1="8" y1="12" x2="8" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <polyline points="6.5,10.5 8,12 9.5,10.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
