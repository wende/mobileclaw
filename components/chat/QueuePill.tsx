"use client";

import { useEffect, useState } from "react";

interface QueuePillProps {
  text: string;
  onDismiss: () => void;
}

export function QueuePill({ text, onDismiss }: QueuePillProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out mb-2"
      style={{ gridTemplateRows: mounted ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden min-h-0">
        <div className="rounded-xl border border-border bg-secondary overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
              <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
            </svg>
            <span className="font-medium shrink-0">Queued</span>
            <span className="truncate text-muted-foreground/50">{text}</span>
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 ml-auto rounded-full p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
