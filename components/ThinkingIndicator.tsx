"use client";

import { useElapsedSeconds } from "@/hooks/useElapsedSeconds";

interface ThinkingIndicatorProps {
  visible: boolean;
  startTime?: number; // Timestamp when thinking started
  label?: string; // Override label (e.g. "Compacting")
}

export function ThinkingIndicator({ visible, startTime, label }: ThinkingIndicatorProps) {
  const elapsedSeconds = useElapsedSeconds({ startTime, active: visible });

  const isCompacting = label === "Compacting";
  const displayLabel = label || "Thinking";

  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity ${visible ? "200ms" : "800ms"}`,
        transform: "translateZ(0)",
      }}
    >
      <div className="text-xs text-muted-foreground/50 flex items-baseline">
        {isCompacting && visible && <span className="mr-1.5 self-center"><CompactingIcon /></span>}
        <span>{displayLabel}</span>
        <span className="inline-flex w-5">
          <span className="animate-[dotFade_1.4s_ease-in-out_infinite]">.</span>
          <span className="animate-[dotFade_1.4s_ease-in-out_0.2s_infinite]">.</span>
          <span className="animate-[dotFade_1.4s_ease-in-out_0.4s_infinite]">.</span>
        </span>
        {startTime && elapsedSeconds > 0 && visible && (
          <span>{elapsedSeconds}s</span>
        )}
      </div>
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
