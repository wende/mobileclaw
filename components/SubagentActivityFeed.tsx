"use client";

import { useState, useEffect, useRef } from "react";
import type { SubagentEntry, SubagentSession } from "@/types/chat";

interface SubagentActivityFeedProps {
  getEntries: () => { entries: SubagentEntry[]; status: SubagentSession["status"] } | null;
  storeVersion: React.RefObject<number>;
}

export function SubagentActivityFeed({ getEntries, storeVersion }: SubagentActivityFeedProps) {
  const [entries, setEntries] = useState<SubagentEntry[]>([]);
  const [status, setStatus] = useState<SubagentSession["status"]>("active");
  const lastVersionRef = useRef(-1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentVersion = storeVersion.current;
      if (currentVersion === lastVersionRef.current) return;
      lastVersionRef.current = currentVersion;

      const data = getEntries();
      if (!data) return;
      setEntries([...data.entries]);
      setStatus(data.status);
    }, 200);
    return () => clearInterval(interval);
  }, [getEntries, storeVersion]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  };

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="h-28 overflow-y-auto border-t border-border px-3 py-1.5 space-y-0.5 scrollbar-hide"
    >
      {entries.length === 0 && status === "active" && (
        <div className="h-full flex items-center gap-1.5 text-[11px] text-muted-foreground/40">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin opacity-50">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>starting...</span>
        </div>
      )}
      {entries.map((entry, i) => {
        if (entry.type === "tool") {
          return (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
              {entry.toolStatus === "running" ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 animate-spin opacity-50">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : entry.toolStatus === "error" ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-destructive">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-40">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              <span className="truncate">{entry.text}</span>
            </div>
          );
        }

        if (entry.type === "reasoning") {
          return (
            <div key={i} className="text-[11px] text-muted-foreground/30 italic truncate">
              {entry.text.slice(0, 120)}
            </div>
          );
        }

        // text
        return (
          <div key={i} className="text-[11px] text-muted-foreground/60 truncate">
            {entry.text.slice(0, 200)}
          </div>
        );
      })}
      {status === "active" && entries.length > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40 pt-0.5">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin opacity-50">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>working...</span>
        </div>
      )}
    </div>
  );
}
