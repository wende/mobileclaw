import { useCallback, startTransition } from "react";

import { parseServerCommands } from "@/components/CommandSheet";
import { PIN_LOCK_MS } from "@/hooks/useScrollManager";
import { SPAWN_TOOL_NAME, STOP_REASON_INJECTED } from "@/lib/constants";
import { getTextFromContent } from "@/lib/messageUtils";
import { mergeAndNormalizeToolResults } from "@/lib/chat/messageTransforms";
import { mergeHistoryWithOptimistic } from "@/lib/chat/historyResponse";
import { upsertChatEventMessage } from "@/lib/chat/chatEventUpsert";
import type { BridgeMessage } from "@/lib/nativeBridge";
import type { AgentEventPayload, ChatEventPayload, Message } from "@/types/chat";
import type { useSubagentStore } from "@/hooks/useSubagentStore";

interface UseNativeBridgeMessageOptions {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setHistoryLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  pinnedToBottomRef: React.MutableRefObject<boolean>;
  pinLockUntilRef: React.MutableRefObject<number>;
  setIsStreaming: (value: boolean) => void;
  setStreamingId: React.Dispatch<React.SetStateAction<string | null>>;
  setAwaitingResponse: (value: boolean) => void;
  setThinkingStartTime: React.Dispatch<React.SetStateAction<number | null>>;
  appendContentDelta: (runId: string, delta: string, ts: number) => void;
  appendThinkingDelta: (runId: string, delta: string, ts: number) => void;
  startThinkingBlock: (runId: string, ts: number) => void;
  addToolCall: (runId: string, name: string, ts: number, toolCallId?: string, args?: string) => void;
  resolveToolCall: (runId: string, name: string, toolCallId?: string, result?: string, isError?: boolean) => void;
  setZenModeEnabled: (enabled: boolean) => void;
  scrollToBottom: () => void;
  subagentStore: ReturnType<typeof useSubagentStore>;
}

export function useNativeBridgeMessage({
  setMessages,
  setHistoryLoaded,
  pinnedToBottomRef,
  pinLockUntilRef,
  setIsStreaming,
  setStreamingId,
  setAwaitingResponse,
  setThinkingStartTime,
  appendContentDelta,
  appendThinkingDelta,
  startThinkingBlock,
  addToolCall,
  resolveToolCall,
  setZenModeEnabled,
  scrollToBottom,
  subagentStore,
}: UseNativeBridgeMessageOptions) {
  return useCallback((msg: BridgeMessage) => {
    switch (msg.type) {
      case "messages:history": {
        const allMsgs = msg.payload as Message[];
        const skip = new Set<number>();
        for (let i = 0; i < allMsgs.length; i++) {
          const m = allMsgs[i];
          const text = getTextFromContent(m.content);
          if (m.role === "user" && text.trim() === "/commands") {
            skip.add(i);
            if (i + 1 < allMsgs.length && allMsgs[i + 1].role === "assistant") skip.add(i + 1);
          }
          if (m.role === "assistant" && m.stopReason === STOP_REASON_INJECTED && !skip.has(i)) {
            const parsed = parseServerCommands(text);
            if (parsed.length >= 8) skip.add(i);
          }
        }
        const filtered = skip.size > 0 ? allMsgs.filter((_, i) => !skip.has(i)) : allMsgs;
        // Use startTransition so React can yield to the browser during rendering,
        // keeping scroll responsive while large histories render progressively.
        pinnedToBottomRef.current = true;
        pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;
        startTransition(() => {
          setMessages((prev) => {
            const normalized = mergeAndNormalizeToolResults(filtered);
            return mergeHistoryWithOptimistic(normalized, prev);
          });
          setHistoryLoaded(true);
        });
        // Safety: re-snap scroll to bottom after post-render animations settle
        // (e.g. slide-open transitions that increase content height).
        setTimeout(() => scrollToBottom(), 350);
        break;
      }
      case "messages:append": {
        const newMsg = msg.payload as Message;
        pinnedToBottomRef.current = true;
        pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;
        setMessages((prev) => [...prev, newMsg]);
        break;
      }
      case "messages:update": {
        const update = msg.payload as { id: string; patch: Partial<Message> };
        setMessages((prev) => prev.map((m) => (m.id === update.id ? { ...m, ...update.patch } : m)));
        break;
      }
      case "chat:event": {
        const payload = msg.payload as ChatEventPayload;
        setMessages((prev) => upsertChatEventMessage(prev, payload));
        break;
      }
      case "messages:clear":
        setMessages([]);
        break;
      case "stream:start": {
        const { runId, ts } = msg.payload as { runId: string; ts: number };
        pinnedToBottomRef.current = true;
        pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;
        setIsStreaming(true);
        setStreamingId(runId);
        setAwaitingResponse(true);
        setMessages((prev) => [...prev, { role: "assistant", content: [], id: runId, timestamp: ts } as Message]);
        break;
      }
      case "stream:contentDelta": {
        const { runId, delta, ts } = msg.payload as { runId: string; delta: string; ts: number };
        appendContentDelta(runId, delta, ts);
        break;
      }
      case "stream:reasoningDelta": {
        const { runId, delta, ts, blockStart } = msg.payload as { runId: string; delta: string; ts: number; blockStart?: boolean };
        if (blockStart) {
          startThinkingBlock(runId, ts);
        }
        if (delta.length > 0) {
          appendThinkingDelta(runId, delta, ts);
        }
        break;
      }
      case "stream:toolStart": {
        const { runId, name, args, toolCallId, ts } = msg.payload as { runId: string; name: string; args?: string; toolCallId?: string; ts: number };
        if (name === SPAWN_TOOL_NAME && toolCallId) {
          subagentStore.registerSpawn(toolCallId);
        }
        addToolCall(runId, name, ts, toolCallId, args);
        break;
      }
      case "stream:toolResult": {
        const { runId, name, toolCallId, result, isError } = msg.payload as { runId: string; name: string; toolCallId?: string; result?: string; isError?: boolean };
        resolveToolCall(runId, name, toolCallId, result, isError);
        break;
      }
      case "stream:end":
        setIsStreaming(false);
        setStreamingId(null);
        setAwaitingResponse(false);
        break;
      case "stream:error": {
        const { errorMessage } = (msg.payload || {}) as { errorMessage?: string };
        setIsStreaming(false);
        setStreamingId(null);
        setAwaitingResponse(false);
        setMessages((prev) => [...prev, {
          role: "system",
          content: [{ type: "text", text: errorMessage || "Error" }],
          id: `err-${Date.now()}`,
          timestamp: Date.now(),
          isError: true,
        } as Message]);
        break;
      }
      case "thinking:show":
        pinnedToBottomRef.current = true;
        pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;
        setAwaitingResponse(true);
        setThinkingStartTime(Date.now());
        break;
      case "thinking:hide":
        setAwaitingResponse(false);
        break;
      case "theme:set": {
        const { theme: newTheme } = msg.payload as { theme: "light" | "dark" };
        const html = document.documentElement;
        if (newTheme === "dark") html.classList.add("dark");
        else html.classList.remove("dark");
        break;
      }
      case "zen:set": {
        const { enabled } = (msg.payload ?? {}) as { enabled?: unknown };
        if (typeof enabled === "boolean") {
          setZenModeEnabled(enabled);
        }
        break;
      }
      case "scroll:toBottom":
        scrollToBottom();
        break;
      case "subagent:clear":
        subagentStore.clearAll();
        break;
      case "subagent:agentEvent": {
        const payload = (msg.payload || {}) as {
          runId?: unknown;
          sessionKey?: unknown;
          stream?: unknown;
          data?: unknown;
          seq?: unknown;
          ts?: unknown;
        };
        if (typeof payload.runId !== "string" || typeof payload.sessionKey !== "string" || typeof payload.stream !== "string") break;
        if (typeof payload.ts !== "number" || typeof payload.data !== "object" || payload.data === null || Array.isArray(payload.data)) break;
        const agentPayload: AgentEventPayload = {
          runId: payload.runId,
          sessionKey: payload.sessionKey,
          stream: payload.stream,
          data: payload.data as Record<string, unknown>,
          seq: typeof payload.seq === "number" ? payload.seq : 0,
          ts: payload.ts,
        };
        subagentStore.ingestAgentEvent(payload.sessionKey, agentPayload);
        break;
      }
      case "subagent:chatEvent": {
        const payload = (msg.payload || {}) as {
          sessionKey?: unknown;
          state?: unknown;
        };
        if (typeof payload.sessionKey !== "string") break;
        if (payload.state === "final" || payload.state === "aborted" || payload.state === "error") {
          subagentStore.ingestChatEvent(payload.sessionKey, payload.state);
        }
        break;
      }
      case "subagent:history": {
        const payload = (msg.payload || {}) as {
          sessionKey?: unknown;
          messages?: unknown;
        };
        if (typeof payload.sessionKey !== "string" || !Array.isArray(payload.messages)) break;
        subagentStore.loadFromHistory(payload.sessionKey, payload.messages as Array<Record<string, unknown>>);
        break;
      }
    }
  }, [
    addToolCall,
    appendContentDelta,
    appendThinkingDelta,
    startThinkingBlock,
    pinLockUntilRef,
    pinnedToBottomRef,
    resolveToolCall,
    scrollToBottom,
    setAwaitingResponse,
    setHistoryLoaded,
    setIsStreaming,
    setMessages,
    setStreamingId,
    setZenModeEnabled,
    setThinkingStartTime,
    subagentStore,
  ]);
}
