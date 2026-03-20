import { useEffect } from "react";

import { createLmStudioHandler, type LmStudioCallbacks, type LmStudioConfig } from "@mc/lib/lmStudio";
import type { ContentPart, Message } from "@mc/types/chat";

interface UseLmStudioRuntimeOptions {
  backendMode: "openclaw" | "lmstudio" | "demo";
  currentModel: string | null;
  lmStudioConfigRef: React.MutableRefObject<LmStudioConfig | null>;
  lmStudioHandlerRef: React.MutableRefObject<ReturnType<typeof createLmStudioHandler> | null>;
  beginContentArrival: () => void;
  notifyForRun: (runId: string) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setStreamingId: React.Dispatch<React.SetStateAction<string | null>>;
  setAwaitingResponse: (value: boolean) => void;
  setIsStreaming: (value: boolean) => void;
  setConnectionError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useLmStudioRuntime({
  backendMode,
  currentModel,
  lmStudioConfigRef,
  lmStudioHandlerRef,
  beginContentArrival,
  notifyForRun,
  setMessages,
  setStreamingId,
  setAwaitingResponse,
  setIsStreaming,
  setConnectionError,
}: UseLmStudioRuntimeOptions) {
  useEffect(() => {
    if (backendMode !== "lmstudio" || !lmStudioConfigRef.current) {
      lmStudioHandlerRef.current = null;
      return;
    }

    const config = lmStudioConfigRef.current;
    const callbacks: LmStudioCallbacks = {
      onStreamStart: (_runId) => {
        setIsStreaming(true);
      },
      onThinking: (runId, text, segment) => {
        if (text) beginContentArrival();
        setStreamingId(runId);
        setMessages((prev: Message[]) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) {
            return [...prev, { role: "assistant", content: [{ type: "thinking", text }], id: runId, timestamp: Date.now() } as Message];
          }
          return prev.map((target) => {
            if (target.id !== runId) return target;
            let parts = Array.isArray(target.content) ? [...target.content] : [];
            let segIdx = 0;
            const thinkPartIdx = parts.findIndex((p) => {
              if (p.type === "thinking") {
                if (segIdx === segment) return true;
                segIdx++;
              }
              return false;
            });
            if (thinkPartIdx >= 0) {
              parts[thinkPartIdx] = { ...parts[thinkPartIdx], text };
            } else {
              parts = parts.filter((p) => !(p.type === "text" && text.includes(p.text || "")));
              parts.push({ type: "thinking", text });
            }
            return { ...target, content: parts };
          });
        });
      },
      onTextDelta: (runId, _delta, fullText) => {
        if (fullText) beginContentArrival();
        setStreamingId(runId);
        setMessages((prev: Message[]) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) {
            return [...prev, { role: "assistant", content: [{ type: "text", text: fullText }], id: runId, timestamp: Date.now() } as Message];
          }
          return prev.map((target) => {
            if (target.id !== runId) return target;
            const parts = Array.isArray(target.content) ? [...target.content] : [];
            const lastIdx = parts.length - 1;
            if (lastIdx >= 0 && parts[lastIdx].type === "text") {
              parts[lastIdx] = { ...parts[lastIdx], text: fullText };
            } else {
              parts.push({ type: "text", text: fullText });
            }
            return { ...target, content: parts };
          });
        });
      },
      onToolStart: (runId, name, args) => {
        beginContentArrival();
        setStreamingId(runId);
        setMessages((prev: Message[]) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) {
            return [...prev, { role: "assistant", content: [{ type: "tool_call", name, arguments: args, status: "running" as const }], id: runId, timestamp: Date.now() } as Message];
          }
          return prev.map((target) => {
            if (target.id !== runId) return target;
            const parts = Array.isArray(target.content) ? target.content : [];
            return { ...target, content: [...parts, { type: "tool_call" as const, name, arguments: args, status: "running" as const }] };
          });
        });
      },
      onToolEnd: (runId, name, result, isError) => {
        setMessages((prev: Message[]) => prev.map((target) => {
          if (target.id !== runId || !Array.isArray(target.content)) return target;
          return {
            ...target,
            content: target.content.map((p: ContentPart) =>
              p.type === "tool_call" && p.name === name && p.status === "running"
                ? { ...p, status: (isError ? "error" : "success"), result: result || undefined, resultError: isError }
                : p,
            ),
          };
        }));
      },
      onStreamEnd: (runId) => {
        notifyForRun(runId);
        setAwaitingResponse(false);
        setIsStreaming(false);
        setStreamingId(null);
        setMessages((prev) => {
          try { window.localStorage.setItem("lmstudio-messages", JSON.stringify(prev)); } catch {}
          return prev;
        });
      },
      onError: (_runId, error) => {
        setAwaitingResponse(false);
        setConnectionError(error);
      },
    };

    const activeConfig = { ...config, model: currentModel || config.model };
    lmStudioConfigRef.current = activeConfig;
    const handler = createLmStudioHandler(activeConfig, callbacks);
    lmStudioHandlerRef.current = handler;

    return () => {
      handler.stop();
    };
  }, [
    backendMode,
    beginContentArrival,
    currentModel,
    lmStudioConfigRef,
    lmStudioHandlerRef,
    notifyForRun,
    setAwaitingResponse,
    setConnectionError,
    setIsStreaming,
    setMessages,
    setStreamingId,
  ]);
}
