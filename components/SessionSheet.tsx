"use client";

import { useState, useRef, useEffect } from "react";
import type { SessionInfo } from "@/types/chat";
import { formatSessionName, formatRelativeTime } from "@/hooks/useSessionSwitcher";

const KIND_LABELS: Record<SessionInfo["kind"], string> = {
  main: "main",
  group: "group",
  cron: "cron",
  hook: "hook",
  node: "node",
  other: "other",
};

export function SessionSheet({
  open,
  onClose,
  sessions,
  loading,
  currentSessionKey,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  sessions: SessionInfo[];
  loading: boolean;
  currentSessionKey: string;
  onSelect: (key: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [mounted, setMounted] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Two-phase mount: render off-screen, then slide in on next frame
  useEffect(() => {
    if (!open) { setMounted(false); return; }
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Reset search when sheet closes
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const filtered = sessions.filter((s) => {
    if (!search) return true;
    const term = search.toLowerCase();
    const name = formatSessionName(s).toLowerCase();
    return (
      name.includes(term) ||
      s.key.toLowerCase().includes(term) ||
      s.kind.toLowerCase().includes(term) ||
      (s.model?.toLowerCase().includes(term) ?? false)
    );
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-foreground/10 backdrop-blur-sm transition-opacity duration-200 ${mounted ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        onMouseDown={onClose}
        role="button"
        tabIndex={-1}
        aria-label="Close sessions"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Sessions"
        className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[70dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-lg transition-transform duration-300 ease-out ${mounted ? "translate-y-0" : "translate-y-full"}`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        {/* Search */}
        <div className="px-4 pb-3 pt-1">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sessions..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus={open}
            />
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
          {loading && sessions.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Loading sessions...
            </div>
          )}
          {!loading && filtered.length === 0 && sessions.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No sessions found</p>
          )}
          {!loading && filtered.length === 0 && sessions.length > 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No sessions match &ldquo;{search}&rdquo;
            </p>
          )}
          {filtered.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {filtered.map((session) => {
                const isCurrent = session.key === currentSessionKey;
                return (
                  <button
                    key={session.key}
                    type="button"
                    onClick={() => onSelect(session.key)}
                    className={`flex items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors ${isCurrent ? "bg-accent/30" : "hover:bg-accent active:bg-accent"}`}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {formatSessionName(session)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-2xs">
                          {KIND_LABELS[session.kind] ?? session.kind}
                        </span>
                        {session.model && (
                          <>
                            <span>&middot;</span>
                            <span className="truncate">{session.model}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                      <span className="text-2xs text-muted-foreground">
                        {session.updatedAt ? formatRelativeTime(session.updatedAt) : ""}
                      </span>
                      {isCurrent && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
