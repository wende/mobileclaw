"use client";

import { useCallback, useState, useEffect } from "react";
import { SubagentActivityFeed } from "@/components/SubagentActivityFeed";
import { SlideContent } from "@/components/SlideContent";
import type { SubagentStore } from "@/hooks/useSubagentStore";
import { useSwipeAction } from "@/hooks/useSwipeAction";

interface FloatingSubagentPanelProps {
  toolCallId: string | null;
  childSessionKey: string | null;
  taskName: string;
  model: string | null;
  subagentStore: SubagentStore;
  onUnpin: () => void;
}

export function FloatingSubagentPanel({
  toolCallId,
  childSessionKey,
  taskName,
  model,
  subagentStore,
  onUnpin,
}: FloatingSubagentPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const getEntries = useCallback(() => {
    if (toolCallId) {
      const via = subagentStore.getEntriesForToolCall(toolCallId);
      if (via) return via;
    }
    if (childSessionKey) {
      return subagentStore.getEntriesForSession(childSessionKey);
    }
    return null;
  }, [toolCallId, childSessionKey, subagentStore]);

  // Swipe left to unpin
  const { offset, animating, pastThreshold, handlers } = useSwipeAction(onUnpin);

  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out mb-2"
      style={{ gridTemplateRows: mounted ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden min-h-0">
        <div className="rounded-xl border border-border overflow-hidden relative" {...handlers}>
          {/* Swipe action indicator (behind content) */}
          {offset !== 0 && (
            <div className="absolute right-0 inset-y-0 w-20 flex items-center justify-center">
              <div className={`flex flex-col items-center gap-0.5 text-[10px] font-medium transition-colors ${pastThreshold ? "text-foreground" : "text-muted-foreground/50"}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
                  <path d="M12 17v5" /><path d="M9 2h6l-1.5 4.5L18 9l-1 1h-5.5L9 17H7l2.5-7H4l-1-1 4.5-2.5L9 2z" transform="rotate(45 12 12)" />
                </svg>
                <span>Unpin</span>
              </div>
            </div>
          )}
          {/* Sliding content */}
          <div
            className="rounded-[inherit] bg-secondary"
            style={{
              transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
              transition: animating ? "transform 200ms ease-out" : "none",
            }}
          >
            {/* Header — click to collapse/expand */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="cursor-pointer rounded-[inherit] w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
                <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
              </svg>
              <span className="truncate flex-1 text-left">{taskName}</span>
              {model && (
                <span className="text-[10px] text-muted-foreground/40 font-normal shrink-0">{model}</span>
              )}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-30">
                <path d="M12 17v5" /><path d="M9 2h6l-1.5 4.5L18 9l-1 1h-5.5L9 17H7l2.5-7H4l-1-1 4.5-2.5L9 2z" transform="rotate(45 12 12)" />
              </svg>
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="shrink-0 opacity-40 transition-transform duration-200"
                style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <SlideContent open={expanded}>
              <SubagentActivityFeed getEntries={getEntries} storeVersion={subagentStore.versionRef} />
            </SlideContent>
          </div>
        </div>
      </div>
    </div>
  );
}
