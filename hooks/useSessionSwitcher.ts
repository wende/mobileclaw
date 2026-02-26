import { useState, useRef, useCallback } from "react";
import type { SessionInfo, BackendMode } from "@/types/chat";

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Human-friendly session name. */
export function formatSessionName(session: SessionInfo): string {
  if (session.kind === "main") return "Main Session";
  if (session.displayName) return session.displayName;
  // Humanize last segment of key: "peer/alice" → "alice", "cron/daily-backup" → "daily-backup"
  const lastSegment = session.key.split("/").pop() ?? session.key;
  return lastSegment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Relative time string: "just now", "2m ago", "3h ago", "5d ago". */
export function formatRelativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseSessionSwitcherOptions {
  sendWS: (msg: { type: string; [key: string]: unknown }) => void;
  sessionKeyRef: React.RefObject<string>;
  backendMode: BackendMode;
}

export function useSessionSwitcher({ sendWS, sessionKeyRef, backendMode }: UseSessionSwitcherOptions) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [currentSessionKey, setCurrentSessionKey] = useState("main");
  const [sessionSwitching, setSessionSwitching] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const lastFetchTimeRef = useRef(0);

  const requestSessionsList = useCallback(() => {
    if (backendMode !== "openclaw") return;
    setSessionsLoading(true);
    sendWS({
      type: "req",
      id: `sessions-list-${Date.now()}`,
      method: "sessions.list",
      params: { limit: 50 },
    });
  }, [sendWS, backendMode]);

  const handleSessionsListResponse = useCallback((payload: Record<string, unknown>) => {
    setSessionsLoading(false);
    lastFetchTimeRef.current = Date.now();
    const raw = (payload.sessions ?? payload.items ?? payload.list ?? (Array.isArray(payload) ? payload : undefined)) as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(raw)) return;
    const parsed: SessionInfo[] = raw.map((s) => ({
      key: s.key as string,
      kind: (s.kind as SessionInfo["kind"]) ?? "other",
      channel: (s.channel as string) ?? "",
      displayName: s.displayName as string | undefined,
      updatedAt: (s.updatedAt as number) ?? 0,
      sessionId: s.sessionId as string | undefined,
      model: s.model as string | undefined,
      contextTokens: s.contextTokens as number | undefined,
      totalTokens: s.totalTokens as number | undefined,
    }));
    // Sort by updatedAt descending (most recent first)
    parsed.sort((a, b) => b.updatedAt - a.updatedAt);
    setSessions(parsed);
  }, []);

  const openSheet = useCallback(() => {
    if (backendMode !== "openclaw") return;
    setSheetOpen(true);
    // Re-fetch if stale (>10s)
    if (Date.now() - lastFetchTimeRef.current > 10_000) {
      requestSessionsList();
    }
  }, [backendMode, requestSessionsList]);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  const switchSession = useCallback((key: string) => {
    (sessionKeyRef as React.MutableRefObject<string>).current = key;
    setCurrentSessionKey(key);
    setSessionSwitching(true);
  }, [sessionKeyRef]);

  const onHistoryLoadedAfterSwitch = useCallback(() => {
    setSessionSwitching(false);
  }, []);

  /** Sync key from hello-ok without triggering switch animation. */
  const syncSessionKey = useCallback((key: string) => {
    (sessionKeyRef as React.MutableRefObject<string>).current = key;
    setCurrentSessionKey(key);
  }, [sessionKeyRef]);

  return {
    sessions,
    sessionsLoading,
    currentSessionKey,
    sessionSwitching,
    sheetOpen,
    requestSessionsList,
    handleSessionsListResponse,
    openSheet,
    closeSheet,
    switchSession,
    onHistoryLoadedAfterSwitch,
    syncSessionKey,
  };
}
