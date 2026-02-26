import { useEffect, useRef } from "react";

import { createDemoHandler, type DemoCallbacks } from "@/lib/demoMode";
import type { AgentEventPayload, ContentPart, Message } from "@/types/chat";
import type { useSubagentStore } from "@/hooks/useSubagentStore";

interface UseDemoRuntimeOptions {
  isDemoMode: boolean;
  notifyForRun: (runId: string) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsStreaming: (value: boolean) => void;
  setStreamingId: React.Dispatch<React.SetStateAction<string | null>>;
  subagentStore: ReturnType<typeof useSubagentStore>;
}

export function useDemoRuntime({
  isDemoMode,
  notifyForRun,
  setMessages,
  setIsStreaming,
  setStreamingId,
  subagentStore,
}: UseDemoRuntimeOptions) {
  const demoHandlerRef = useRef<ReturnType<typeof createDemoHandler> | null>(null);

  useEffect(() => {
    if (!isDemoMode) {
      demoHandlerRef.current = null;
      return;
    }

    const callbacks: DemoCallbacks = {
      onStreamStart: (runId) => {
        setIsStreaming(true);
        setStreamingId(runId);
        setMessages((prev) => [...prev, { role: "assistant", content: [], id: runId, timestamp: Date.now() }]);
      },
      onThinking: (runId, text) => {
        setMessages((prev) => prev.map((m) => m.id === runId ? { ...m, reasoning: text } : m));
      },
      onTextDelta: (runId, _delta, fullText) => {
        setMessages((prev) => prev.map((target) => {
          if (target.id !== runId) return target;
          const existingParts = Array.isArray(target.content) ? target.content : [];
          const nonTextParts = existingParts.filter((p: ContentPart) => p.type !== "text");
          return { ...target, content: [...nonTextParts, { type: "text" as const, text: fullText }] };
        }));
      },
      onToolStart: (runId, name, args, toolCallId) => {
        setMessages((prev) => prev.map((target) => {
          if (target.id !== runId) return target;
          const parts = Array.isArray(target.content) ? target.content : [];
          return {
            ...target,
            content: [...parts, { type: "tool_call" as const, name, arguments: args, toolCallId, status: "running" as const }],
          };
        }));
      },
      onToolEnd: (runId, name, result, isError) => {
        setMessages((prev) => prev.map((target) => {
          if (target.id !== runId || !Array.isArray(target.content)) return target;
          return {
            ...target,
            content: target.content.map((p: ContentPart) =>
              p.type === "tool_call" && p.name === name && p.status === "running"
                ? { ...p, status: (isError ? "error" : "success"), result, resultError: isError }
                : p,
            ),
          };
        }));
      },
      onStreamEnd: (runId) => {
        notifyForRun(runId);
        setIsStreaming(false);
        setStreamingId(null);
      },
      onRegisterSpawn: (toolCallId) => {
        subagentStore.registerSpawn(toolCallId);
      },
      onSubagentEvent: (sessionKey, stream, data, ts) => {
        subagentStore.ingestAgentEvent(sessionKey, {
          runId: "demo-subagent-run",
          sessionKey,
          stream: stream as AgentEventPayload["stream"],
          data,
          seq: 0,
          ts,
        });
      },
    };

    demoHandlerRef.current = createDemoHandler(callbacks);
  }, [isDemoMode, notifyForRun, setIsStreaming, setMessages, setStreamingId, subagentStore]);

  return {
    demoHandlerRef,
  };
}
