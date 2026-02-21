import { useRef, useCallback } from "react";
import type { SubagentEntry, SubagentSession, AgentEventPayload } from "@/types/chat";
import { isToolCallPart } from "@/lib/constants";

const TEXT_COALESCE_GAP_MS = 2000;

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

  const bump = () => { versionRef.current += 1; };

  const ensureSession = (sessionKey: string): SubagentSession => {
    let session = storeRef.current.get(sessionKey);
    if (!session) {
      session = { entries: [], status: "active" };
      storeRef.current.set(sessionKey, session);
    }
    return session;
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
      const phase = data.phase as string;
      if (phase === "start") {
        autoLink(sessionKey);
        ensureSession(sessionKey);
        bump();
      } else if (phase === "end") {
        const session = storeRef.current.get(sessionKey);
        if (session) session.status = "done";
        bump();
      } else if (phase === "error") {
        const session = storeRef.current.get(sessionKey);
        if (session) session.status = "error";
        bump();
      }
      return;
    }

    // Auto-link even if we missed the lifecycle:start
    autoLink(sessionKey);
    const session = ensureSession(sessionKey);

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
      const toolCallId = data.toolCallId as string | undefined;

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
    const session = storeRef.current.get(sessionKey);
    if (!session) return;
    // Don't mark "done" on chat:final — it fires after each turn in an agent loop,
    // not just at the end. The real "done" signal is lifecycle:end in ingestAgentEvent.
    if (state === "error") session.status = "error";
    else if (state === "aborted") session.status = "done";
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
    const session = ensureSession(sessionKey);
    // Only populate if the session is empty (avoid duplicating on re-fetch)
    if (session.entries.length > 0) return;

    let hasStopReason = false;
    for (const m of rawMessages) {
      if (m.role !== "assistant") continue;
      const ts = (m.timestamp as number) || 0;
      const content = m.content as Array<Record<string, unknown>> | string | null;
      if (m.stopReason) hasStopReason = true;

      if (typeof content === "string") {
        if (content) session.entries.push({ type: "text", text: content, ts });
        continue;
      }
      if (!Array.isArray(content)) continue;

      for (const part of content) {
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

    session.status = hasStopReason || session.entries.length === 0 ? "done" : "active";
    bump();
  }, []);

  const clearAll = useCallback(() => {
    storeRef.current.clear();
    linkMapRef.current.clear();
    pendingSpawnsRef.current = [];
    bump();
  }, []);

  return { ingestAgentEvent, ingestChatEvent, registerSpawn, getEntriesForToolCall, getEntriesForSession, loadFromHistory, versionRef, clearAll };
}
