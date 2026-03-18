import { useEffect, useRef } from "react";

import { createDemoHandler } from "@mc/lib/demoMode";
import type { AgentEventPayload, PluginContentPart } from "@mc/types/chat";
import type { useSubagentStore } from "@mc/hooks/useSubagentStore";
import { SPAWN_TOOL_NAME } from "@mc/lib/constants";

interface UseDemoRuntimeOptions {
  isDemoMode: boolean;
  appendContentDelta: (runId: string, delta: string, ts: number) => void;
  appendThinkingDelta: (runId: string, delta: string, ts: number) => void;
  startThinkingBlock: (runId: string, ts: number) => void;
  addToolCall: (runId: string, name: string, ts: number, toolCallId?: string, args?: string, narration?: string) => void;
  resolveToolCall: (runId: string, name: string, toolCallId?: string, result?: string, isError?: boolean) => void;
  mountPluginPart: (runId: string, part: PluginContentPart, ts: number, index?: number) => void;
  replacePluginPart: (runId: string, partId: string, next: Pick<PluginContentPart, "state" | "data" | "revision">) => void;
  removePluginPart: (runId: string, partId: string, tombstone?: boolean) => void;
  markRunStart: () => void;
  markRunEnd: () => number;
  setIsStreaming: (value: boolean) => void;
  setAwaitingResponse: (value: boolean) => void;
  setThinkingStartTime: (value: number) => void;
  notifyForRun: (runId: string) => void;
  applyRunDuration: (runId: string, duration: number) => void;
  subagentStore: ReturnType<typeof useSubagentStore>;
}

export function useDemoRuntime({
  isDemoMode,
  appendContentDelta,
  appendThinkingDelta,
  startThinkingBlock,
  addToolCall,
  resolveToolCall,
  mountPluginPart,
  replacePluginPart,
  removePluginPart,
  markRunStart,
  markRunEnd,
  setIsStreaming,
  setAwaitingResponse,
  setThinkingStartTime,
  notifyForRun,
  applyRunDuration,
  subagentStore,
}: UseDemoRuntimeOptions) {
  const demoHandlerRef = useRef<ReturnType<typeof createDemoHandler> | null>(null);

  useEffect(() => {
    if (!isDemoMode) {
      demoHandlerRef.current = null;
      return;
    }

    const handleEvent = (payload: AgentEventPayload) => {
      if (payload.stream === "lifecycle") {
        const phase = payload.data.phase as string;
        if (phase === "start") {
          markRunStart();
          setIsStreaming(true);
          setAwaitingResponse(true);
          setThinkingStartTime(Date.now());
        } else if (phase === "end") {
          const runDuration = markRunEnd();
          notifyForRun(payload.runId);
          applyRunDuration(payload.runId, runDuration);
          setIsStreaming(false);
          setAwaitingResponse(false);
        }
        return;
      }

      if (payload.stream === "reasoning") {
        const delta = (payload.data.delta ?? "") as string;
        if (delta) {
          appendThinkingDelta(payload.runId, delta, payload.ts);
        }
      }

      if (payload.stream === "content") {
        const delta = (payload.data.delta ?? "") as string;
        if (delta) {
          appendContentDelta(payload.runId, delta, payload.ts);
        }
      }

      if (payload.stream === "tool") {
        const phase = payload.data.phase as string;
        const toolName = payload.data.name as string;
        const toolCallId = payload.data.toolCallId as string | undefined;

        if (phase === "start" && toolName) {
          if (toolName === SPAWN_TOOL_NAME && toolCallId) {
            subagentStore.registerSpawn(toolCallId);
          }
          const narration = typeof payload.data.narration === "string" ? payload.data.narration : undefined;
          addToolCall(payload.runId, toolName, payload.ts, toolCallId, payload.data.args ? JSON.stringify(payload.data.args) : undefined, narration);
        } else if (phase === "result" && toolName) {
          const resultText = typeof payload.data.result === "string"
            ? payload.data.result
            : JSON.stringify(payload.data.result, null, 2);
          resolveToolCall(payload.runId, toolName, toolCallId, resultText, !!payload.data.isError);
        }
      }

      if (payload.stream === "plugin") {
        const phase = payload.data.phase as string | undefined;
        if (phase === "mount" && payload.data.part && typeof payload.data.part === "object") {
          mountPluginPart(payload.runId, payload.data.part as PluginContentPart, payload.ts, typeof payload.data.index === "number" ? payload.data.index : undefined);
        } else if (phase === "replace") {
          const partId = payload.data.partId as string | undefined;
          if (partId) {
            replacePluginPart(payload.runId, partId, {
              state: (payload.data.state as PluginContentPart["state"]) || "active",
              data: payload.data.data,
              revision: typeof payload.data.revision === "number" ? payload.data.revision : undefined,
            });
          }
        } else if (phase === "remove") {
          const partId = payload.data.partId as string | undefined;
          if (partId) {
            removePluginPart(payload.runId, partId, !!payload.data.tombstone);
          }
        }
      }
    };

    demoHandlerRef.current = createDemoHandler({
      onEvent: handleEvent,
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
    });
  }, [
    isDemoMode,
    appendContentDelta,
    appendThinkingDelta,
    startThinkingBlock,
    addToolCall,
    resolveToolCall,
    mountPluginPart,
    replacePluginPart,
    removePluginPart,
    markRunStart,
    markRunEnd,
    setIsStreaming,
    setAwaitingResponse,
    setThinkingStartTime,
    notifyForRun,
    applyRunDuration,
    subagentStore,
  ]);

  return {
    demoHandlerRef,
  };
}
