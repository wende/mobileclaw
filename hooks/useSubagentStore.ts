import { useRef, useCallback } from "react";
import type { SubagentEntry, SubagentSession, AgentEventPayload } from "@/types/chat";
import { isToolCallPart } from "@/lib/constants";

const TEXT_COALESCE_GAP_MS = 2000;
/** Grace period after lifecycle:end before marking "done" — if lifecycle:start fires within this window, cancel. */
const DONE_GRACE_MS = 5000;

export interface SubagentStore {
  /** Ingest an agent event from a non-main session. Auto-links unknown sessions to pending spawns. */
  ingestAgentEvent: (sessionKey: string, payload: AgentEventPayload) => void;
  /** Mark a subagent session as done/error when its chat event fires final/aborted/error. */
  ingestChatEvent: (sessionKey: string, state: "final" | "aborted" | "error") => void;
  /** Register a sessions_spawn tool call so we can auto-link it to the subagent session. */
  registerSpawn: (toolCallId: string) => void;
  /** Get entries and status for a given toolCallId (returns null if no linked session). */
  getEntriesForToolCall: (toolCallId: string) => { entries: SubagentEntry[]; status: SubagentSession["status"] } | null;
  /** Get entries and status directly by session key (for when toolCallId is unavailable, e.g. history). */
  getEntriesForSession: (sessionKey: string) => { entries: SubagentEntry[]; status: SubagentSession["status"] } | null;
  /** Populate a subagent session from chat.history response messages. */
  loadFromHistory: (sessionKey: string, rawMessages: Array<Record<string, unknown>>) => void;
  /** Version counter — bumped on every mutation. Poll this to detect changes. */
  versionRef: React.RefObject<number>;
  /** Clear all subagent data (call on main run end). */
  clearAll: () => void;
}

export function useSubagentStore(): SubagentStore {
  // sessionKey -> session data
  const storeRef = useRef<Map<string, SubagentSession>>(new Map());
  // toolCallId -> sessionKey
  const linkMapRef = useRef<Map<string, string>>(new Map());
  // toolCallIds of running sessions_spawn calls (FIFO for auto-linking)
  const pendingSpawnsRef = useRef<string[]>([]);
  // Monotonic version counter
  const versionRef = useRef<number>(0);
  // Pending "done" timers per session (debounced lifecycle:end)
  const doneTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const bump = () => { versionRef.current += 1; };

  const ensureSession = (sessionKey: string): SubagentSession => {
    let session = storeRef.current.get(sessionKey);
    if (!session) {
      session = { entries: [], status: "active" };
      storeRef.current.set(sessionKey, session);
    }
    return session;
  };

  /** Cancel any pending "done" timer for a session. */
  const cancelDoneTimer = (sessionKey: string) => {
    const timer = doneTimersRef.current.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      doneTimersRef.current.delete(sessionKey);
    }
  };

  /** Try to auto-link an unknown sessionKey to the oldest pending spawn. */
  const autoLink = (sessionKey: string) => {
    // Already linked from some toolCallId?
    for (const [, sk] of linkMapRef.current) {
      if (sk === sessionKey) return;
    }
    // Pop oldest pending spawn
    if (pendingSpawnsRef.current.length > 0) {
      const toolCallId = pendingSpawnsRef.current.shift()!;
      linkMapRef.current.set(toolCallId, sessionKey);
    }
  };

  const ingestAgentEvent = useCallback((sessionKey: string, payload: AgentEventPayload) => {
    const { stream, data, ts } = payload;

    if (stream === "lifecycle") {
      const phase = typeof data.phase === "string" ? data.phase.toLowerCase() : "";
      const isStart = phase === "start" || phase === "begin";
      const isEnd = phase === "end" || phase === "done" || phase === "complete" || phase === "completed" || phase === "stop" || phase === "finish" || phase === "finished";
      const isError = phase === "error" || phase === "failed" || phase === "abort" || phase === "aborted";

      if (isStart) {
        // New turn starting — cancel any pending "done" timer and reset to active
        cancelDoneTimer(sessionKey);
        autoLink(sessionKey);
        const session = ensureSession(sessionKey);
        session.status = "active";
        bump();
      } else if (isEnd) {
        // lifecycle:end fires per-turn. Debounce: schedule "done" after a grace period.
        // If a new lifecycle:start fires within the window, the timer is cancelled.
        cancelDoneTimer(sessionKey);
        const timer = setTimeout(() => {
          doneTimersRef.current.delete(sessionKey);
          const session = storeRef.current.get(sessionKey);
          if (session && session.status === "active") {
            session.status = "done";
            bump();
          }
        }, DONE_GRACE_MS);
        doneTimersRef.current.set(sessionKey, timer);
        bump();
      } else if (isError) {
        cancelDoneTimer(sessionKey);
        const session = storeRef.current.get(sessionKey);
        if (session) session.status = "error";
        bump();
      }
      return;
    }

    // Any non-lifecycle event means the session is still active — cancel pending "done"
    cancelDoneTimer(sessionKey);

    // Auto-link even if we missed the lifecycle:start
    autoLink(sessionKey);
    const session = ensureSession(sessionKey);
    // Ensure status is active if we're receiving events
    if (session.status !== "active") session.status = "active";

    if (stream === "content" || stream === "assistant") {
      const delta = (data.delta || data.text || data.content || "") as string;
      if (!delta) return;
      const last = session.entries[session.entries.length - 1];
      if (last && last.type === "text" && ts - last.ts < TEXT_COALESCE_GAP_MS) {
        last.text += delta;
        last.ts = ts;
      } else {
        session.entries.push({ type: "text", text: delta, ts });
      }
      bump();
    } else if (stream === "reasoning") {
      const delta = (data.delta || data.text || data.content || "") as string;
      if (!delta) return;
      const last = session.entries[session.entries.length - 1];
      if (last && last.type === "reasoning" && ts - last.ts < TEXT_COALESCE_GAP_MS) {
        last.text += delta;
        last.ts = ts;
      } else {
        session.entries.push({ type: "reasoning", text: delta, ts });
      }
      bump();
    } else if (stream === "tool") {
      const phase = data.phase as string;
      const toolName = data.name as string;

      if (phase === "start" && toolName) {
        session.entries.push({ type: "tool", text: toolName, toolStatus: "running", ts });
        bump();
      } else if (phase === "result" && toolName) {
        // Find the matching running tool entry (by name, last match)
        for (let i = session.entries.length - 1; i >= 0; i--) {
          const e = session.entries[i];
          if (e.type === "tool" && e.text === toolName && e.toolStatus === "running") {
            e.toolStatus = data.isError ? "error" : "success";
            break;
          }
        }
        bump();
      }
    }
  }, []);

  const ingestChatEvent = useCallback((sessionKey: string, state: "final" | "aborted" | "error") => {
    const session = ensureSession(sessionKey);
    if (state === "final") {
      // Some runtimes don't emit lifecycle:end for child sessions.
      // Mirror lifecycle:end behavior: mark done after grace unless activity resumes.
      cancelDoneTimer(sessionKey);
      const timer = setTimeout(() => {
        doneTimersRef.current.delete(sessionKey);
        const current = storeRef.current.get(sessionKey);
        if (current && current.status === "active") {
          current.status = "done";
          bump();
        }
      }, DONE_GRACE_MS);
      doneTimersRef.current.set(sessionKey, timer);
    } else if (state === "error") {
      cancelDoneTimer(sessionKey);
      session.status = "error";
    } else if (state === "aborted") {
      cancelDoneTimer(sessionKey);
      session.status = "done";
    }
    bump();
  }, []);

  const registerSpawn = useCallback((toolCallId: string) => {
    pendingSpawnsRef.current.push(toolCallId);
  }, []);

  const getEntriesForToolCall = useCallback((toolCallId: string) => {
    const sessionKey = linkMapRef.current.get(toolCallId);
    if (!sessionKey) return null;
    const session = storeRef.current.get(sessionKey);
    if (!session) return null;
    return { entries: session.entries, status: session.status };
  }, []);

  const getEntriesForSession = useCallback((sessionKey: string) => {
    const session = storeRef.current.get(sessionKey);
    if (!session) return null;
    return { entries: session.entries, status: session.status };
  }, []);

  const loadFromHistory = useCallback((sessionKey: string, rawMessages: Array<Record<string, unknown>>) => {
    const existedBefore = storeRef.current.has(sessionKey);
    const session = ensureSession(sessionKey);
    // Only populate if the session is empty (avoid duplicating on re-fetch)
    if (session.entries.length > 0) return;

    let hasStopReason = false;
    for (const m of rawMessages) {
      const ts = (m.timestamp as number) || 0;

      // Tool result messages: mark the matching "running" tool entry as done
      if (m.role === "tool" || m.role === "toolResult" || m.role === "tool_result") {
        const toolName = (m.name as string) || (m.toolName as string);
        if (toolName) {
          let isErr = !!m.isError;
          if (!isErr && typeof m.content === "string") {
            try { const p = JSON.parse(m.content); isErr = p?.status === "error" || !!p?.isError; } catch {}
          }
          for (let i = session.entries.length - 1; i >= 0; i--) {
            const e = session.entries[i];
            if (e.type === "tool" && e.text === toolName && e.toolStatus === "running") {
              e.toolStatus = isErr ? "error" : "success";
              break;
            }
          }
        }
        continue;
      }

      if (m.role !== "assistant") continue;
      const content = m.content as Array<Record<string, unknown>> | string | null;
      if (m.stopReason) hasStopReason = true;

      if (typeof content === "string") {
        if (content) session.entries.push({ type: "text", text: content, ts });
        continue;
      }
      if (!Array.isArray(content)) continue;

      for (const part of content as Array<{ type: string;[key: string]: unknown }>) {
        if (part.type === "thinking" && part.thinking) {
          session.entries.push({ type: "reasoning", text: part.thinking as string, ts });
        } else if (part.type === "thinking" && part.text) {
          session.entries.push({ type: "reasoning", text: part.text as string, ts });
        } else if (part.type === "text" && part.text) {
          session.entries.push({ type: "text", text: part.text as string, ts });
        } else if (isToolCallPart(part)) {
          const toolName = (part.name as string) || "tool";
          const isErr = !!part.resultError;
          const status = part.result != null ? (isErr ? "error" : "success") : "running";
          session.entries.push({ type: "tool", text: toolName, toolStatus: status as SubagentEntry["toolStatus"], ts });
        }
      }
    }

    // Determine status:
    // - Any tool still running → active (mid-turn, waiting for tool result)
    // - stopReason present, no running tools → done
    // - entries populated, no stopReason → active
    // - entries empty, new session → done (completed empty session)
    // - entries empty, existing session → keep current (e.g., "active" from lifecycle:start)
    const hasRunningTools = session.entries.some((e) => e.type === "tool" && e.toolStatus === "running");
    if (hasRunningTools) {
      session.status = "active";
    } else if (hasStopReason) {
      session.status = "done";
    } else if (session.entries.length > 0) {
      session.status = "active";
    } else if (!existedBefore) {
      session.status = "done";
    }
    // else: keep current status (e.g., "active" from lifecycle:start)
    bump();
  }, []);

  const clearAll = useCallback(() => {
    // Cancel all pending done timers
    for (const timer of doneTimersRef.current.values()) clearTimeout(timer);
    doneTimersRef.current.clear();
    storeRef.current.clear();
    linkMapRef.current.clear();
    pendingSpawnsRef.current = [];
    bump();
  }, []);

  return { ingestAgentEvent, ingestChatEvent, registerSpawn, getEntriesForToolCall, getEntriesForSession, loadFromHistory, versionRef, clearAll };
}
