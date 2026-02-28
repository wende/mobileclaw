import { useRef, useEffect, useCallback } from "react";

import { parseServerCommands, ALL_COMMANDS, type Command } from "@/components/CommandSheet";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useSessionSwitcher } from "@/hooks/useSessionSwitcher";
import {
  HEARTBEAT_MARKER,
  SPAWN_TOOL_NAME,
  SYSTEM_MESSAGE_PREFIX,
  SYSTEM_PREFIX,
  WS_HELLO_OK,
  isToolCallPart,
} from "@/lib/constants";
import { loadOrCreateDeviceIdentity, signDevicePayload, buildDeviceAuthPayload } from "@/lib/deviceIdentity";
import { logAgentEvent, logChatEvent } from "@/lib/debugLog";
import { getTextFromContent, updateAt } from "@/lib/messageUtils";
import { mergeModels, parseConfigProviders, type ConfigParseResult } from "@/lib/parseBackendModels";
import { useWebSocket, type WebSocketMessage } from "@/lib/useWebSocket";
import { mergeAndNormalizeToolResults } from "@/lib/chat/messageTransforms";
import {
  buildHistoryMessages,
  extractSpawnChildSessionKeys,
  inferCurrentModel,
  isRunInProgressFromHistory,
  mergeHistoryWithOptimistic,
  prepareHistoryMessages,
} from "@/lib/chat/historyResponse";
import { upsertFinalRunMessage } from "@/lib/chat/streamMutations";
import type {
  AgentEventPayload,
  BackendMode,
  ChatEventPayload,
  ConnectChallengePayload,
  ContentPart,
  Message,
  ModelChoice,
  WSIncomingMessage,
} from "@/types/chat";
import type { useSubagentStore } from "@/hooks/useSubagentStore";

interface StreamActions {
  appendContentDelta: (runId: string, delta: string, ts: number) => void;
  appendThinkingDelta: (runId: string, delta: string, ts: number) => void;
  startThinkingBlock: (runId: string, ts: number) => void;
  addToolCall: (runId: string, name: string, ts: number, toolCallId?: string, args?: string) => void;
  resolveToolCall: (runId: string, name: string, toolCallId?: string, result?: string, isError?: boolean) => void;
}

interface UseOpenClawRuntimeOptions extends StreamActions {
  backendMode: BackendMode;
  isNative: boolean;
  isDetachedRef: React.MutableRefObject<boolean>;
  isNativeRef: React.MutableRefObject<boolean>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  setConnectionError: React.Dispatch<React.SetStateAction<string | null>>;
  setShowSetup: React.Dispatch<React.SetStateAction<boolean>>;
  setServerInfo: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  setCurrentModel: React.Dispatch<React.SetStateAction<string | null>>;
  setAvailableModels: React.Dispatch<React.SetStateAction<ModelChoice[]>>;
  setModelsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setServerCommands: React.Dispatch<React.SetStateAction<Command[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setAwaitingResponse: (value: boolean) => void;
  setIsStreaming: (value: boolean) => void;
  setStreamingId: React.Dispatch<React.SetStateAction<string | null>>;
  setHistoryLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  beginContentArrival: () => void;
  setThinkingStartTime: React.Dispatch<React.SetStateAction<number | null>>;
  markRunStart: () => void;
  markRunEnd: () => number;
  notifyForRun: (runId: string | null) => void;
  handleUnpinSubagent: () => void;
  queuedMessageRef: React.RefObject<{ text: string; attachments?: unknown[] } | null>;
  subagentStore: ReturnType<typeof useSubagentStore>;
}

function isReasoningBlockStart(data: Record<string, unknown>): boolean {
  const directFlags = [
    data["newBlock"],
    data["new_block"],
    data["blockStart"],
    data["block_start"],
    data["segmentStart"],
    data["segment_start"],
  ];
  if (directFlags.some((v) => v === true)) return true;

  const markers = [data["phase"], data["type"], data["kind"], data["event"], data["action"], data["state"]]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim().toLowerCase());

  if (markers.some((v) => v === "start" || v === "begin")) return true;

  const joined = markers.join(" ");
  return /new[_ -]?block|block[_ -]?start|new[_ -]?segment|segment[_ -]?start|start[_ -]?block|start[_ -]?segment/.test(joined);
}

export function useOpenClawRuntime({
  backendMode,
  isNative,
  isDetachedRef,
  isNativeRef,
  scrollRef,
  setConnectionError,
  setShowSetup,
  setServerInfo,
  setCurrentModel,
  setAvailableModels,
  setModelsLoading,
  setServerCommands,
  setMessages,
  setAwaitingResponse,
  setIsStreaming,
  setStreamingId,
  setHistoryLoaded,
  beginContentArrival,
  setThinkingStartTime,
  markRunStart,
  markRunEnd,
  notifyForRun,
  handleUnpinSubagent,
  queuedMessageRef,
  subagentStore,
  appendContentDelta,
  appendThinkingDelta,
  startThinkingBlock,
  addToolCall,
  resolveToolCall,
}: UseOpenClawRuntimeOptions) {
  const sessionIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef<string>("main");
  const activeRunIdRef = useRef<string | null>(null);

  const sendWSMessageRef = useRef<((message: WebSocketMessage) => boolean) | null>(null);
  const markEstablishedRef = useRef<(() => void) | null>(null);
  const gatewayTokenRef = useRef<string | null>(null);
  const connectNonceRef = useRef<string | null>(null);

  const historyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pendingSubhistoryRef = useRef<Map<string, string>>(new Map());
  const fetchedSubhistoryRef = useRef<Set<string>>(new Set());

  const modelsRequestedRef = useRef(false);
  const commandsFetchActiveRef = useRef(false);
  const commandsFetchBufferRef = useRef("");

  const thinkTagStateRef = useRef<{
    insideThinkTag: boolean;
    tagBuffer: string;
  }>({ insideThinkTag: false, tagBuffer: "" });

  const sendWS = useCallback((msg: { type: string; [key: string]: unknown }) => {
    sendWSMessageRef.current?.(msg as WebSocketMessage);
  }, []);

  const {
    sessions,
    sessionsLoading,
    currentSessionKey,
    sessionSwitching,
    sheetOpen: isSessionSheetOpen,
    requestSessionsList,
    handleSessionsListResponse,
    openSheet: openSessionSheet,
    closeSheet: closeSessionSheet,
    switchSession,
    onHistoryLoadedAfterSwitch,
    syncSessionKey,
  } = useSessionSwitcher({ sendWS, sessionKeyRef, backendMode });

  const {
    pullContentRef,
    pullSpinnerRef,
    isPullingRef,
    onHistoryReceived,
  } = usePullToRefresh({
    scrollRef,
    backendMode,
    sendWS,
    sessionKeyRef,
    enabled: !isNative,
  });

  const requestHistory = useCallback(() => {
    sendWS({
      type: "req",
      id: `history-${Date.now()}`,
      method: "chat.history",
      params: { sessionKey: sessionKeyRef.current },
    });
  }, [sendWS]);

  const startHistoryPolling = useCallback(() => {
    if (historyPollRef.current) return;
    historyPollRef.current = setInterval(() => {
      requestHistory();
    }, 3000);
  }, [requestHistory]);

  const stopHistoryPolling = useCallback(() => {
    if (!historyPollRef.current) return;
    clearInterval(historyPollRef.current);
    historyPollRef.current = null;
  }, []);

  const clearStreamingRuntimeState = useCallback((opts?: { clearRunId?: boolean }) => {
    setAwaitingResponse(false);
    setIsStreaming(false);
    setStreamingId(null);
    if (opts?.clearRunId) {
      activeRunIdRef.current = null;
    }
  }, [setAwaitingResponse, setIsStreaming, setStreamingId]);

  const configResultRef = useRef<ConfigParseResult | null>(null);
  const modelsCatalogRef = useRef<Array<Record<string, unknown>> | null>(null);

  const fetchModels = useCallback(() => {
    if (backendMode !== "openclaw") return;
    if (modelsRequestedRef.current) return;
    modelsRequestedRef.current = true;
    setModelsLoading(true);
    const ts = Date.now();
    sendWS({ type: "req", id: `config-providers-${ts}`, method: "config.get", params: {} });
    sendWS({ type: "req", id: `models-catalog-${ts}`, method: "models.list", params: {} });
  }, [backendMode, sendWS, setModelsLoading]);

  const requestServerCommands = useCallback(() => {
    if (backendMode !== "openclaw") return;
    commandsFetchActiveRef.current = true;
    commandsFetchBufferRef.current = "";
    const ts = Date.now();
    sendWS({
      type: "req",
      id: `cmdfetch-${ts}`,
      method: "chat.send",
      params: {
        sessionKey: sessionKeyRef.current,
        message: "/commands",
        deliver: true,
        idempotencyKey: `cmdfetch-${ts}`,
      },
    });
  }, [backendMode, sendWS]);

  const cancelCommandFetch = useCallback(() => {
    commandsFetchActiveRef.current = false;
    commandsFetchBufferRef.current = "";
  }, []);

  const handleConnectChallenge = useCallback(async (nonce?: string) => {
    connectNonceRef.current = nonce ?? null;

    const scopes = ["operator.read", "operator.write", "operator.admin", "operator.approvals", "operator.pairing"];
    const role = "operator";
    const clientId = "openclaw-control-ui";
    const clientMode = "webchat";
    const authToken = gatewayTokenRef.current ?? undefined;

    let device: { id: string; publicKey: string; signature: string; signedAt: number; nonce?: string } | undefined;
    try {
      const identity = await loadOrCreateDeviceIdentity();
      const signedAtMs = Date.now();
      const payload = buildDeviceAuthPayload({
        deviceId: identity.deviceId,
        clientId,
        clientMode,
        role,
        scopes,
        signedAtMs,
        token: authToken ?? null,
        nonce,
      });
      const signature = await signDevicePayload(identity.privateKey, payload);
      device = {
        id: identity.deviceId,
        publicKey: identity.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    } catch (err) {
      console.warn("[Connect] Device identity failed, connecting without:", err);
    }

    sendWS({
      type: "req",
      id: `conn-${Date.now()}`,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: clientId, version: "1.0.0", platform: navigator.platform ?? "web", mode: clientMode },
        role,
        scopes,
        device,
        caps: ["tool-events"],
        auth: authToken ? { token: authToken } : undefined,
      },
    });
  }, [sendWS]);

  const handleHelloOk = useCallback((resPayload: Record<string, unknown>) => {
    markEstablishedRef.current?.();
    modelsRequestedRef.current = false;
    configResultRef.current = null;
    modelsCatalogRef.current = null;
    setModelsLoading(false);
    setAvailableModels([]);
    setServerCommands([]);

    const server = resPayload.server as Record<string, unknown> | undefined;
    if (server) setServerInfo(server);
    sessionIdRef.current = (server as Record<string, string> | undefined)?.connId ?? null;

    const snapshot = resPayload.snapshot as Record<string, unknown> | undefined;
    const sessionDefaults = snapshot?.sessionDefaults as Record<string, string> | undefined;
    const sessionKey = sessionDefaults?.mainSessionKey || sessionDefaults?.mainKey || "main";
    syncSessionKey(sessionKey);

    requestHistory();
    requestServerCommands();
    requestSessionsList();
  }, [
    requestHistory,
    requestServerCommands,
    requestSessionsList,
    setAvailableModels,
    setModelsLoading,
    setServerCommands,
    setServerInfo,
    syncSessionKey,
  ]);

  const handleHistoryResponse = useCallback((resPayload: Record<string, unknown>) => {
    const allRawMsgs = Array.isArray(resPayload.messages) ? resPayload.messages as Array<Record<string, unknown>> : [];
    const { rawMessages, inferredServerCommands } = prepareHistoryMessages({
      allRawMessages: allRawMsgs,
      parseServerCommands,
      coreCommandNames: new Set(ALL_COMMANDS.map((cmd) => cmd.name)),
    });
    if (inferredServerCommands && inferredServerCommands.length > 0) {
      setServerCommands(inferredServerCommands);
      try { localStorage.setItem("mc-server-commands", JSON.stringify(inferredServerCommands)); } catch {}
    }

    const historyMessages = buildHistoryMessages(rawMessages);
    const finalMessages = mergeAndNormalizeToolResults(historyMessages);

    const inferredModel = inferCurrentModel(rawMessages);
    if (inferredModel) setCurrentModel(inferredModel);

    setMessages((prev: Message[]) => mergeHistoryWithOptimistic(finalMessages, prev));

    const runInProgress = isRunInProgressFromHistory(rawMessages);
    if (runInProgress) {
      setAwaitingResponse(true);
      setIsStreaming(true);
      startHistoryPolling();
    } else {
      stopHistoryPolling();
      clearStreamingRuntimeState();
    }

    for (const childKey of extractSpawnChildSessionKeys(rawMessages)) {
      if (!childKey || fetchedSubhistoryRef.current.has(childKey)) continue;
      fetchedSubhistoryRef.current.add(childKey);
      const reqId = `subhistory-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      pendingSubhistoryRef.current.set(reqId, childKey);
      sendWS({
        type: "req",
        id: reqId,
        method: "chat.history",
        params: { sessionKey: childKey },
      });
    }

    onHistoryReceived();
    onHistoryLoadedAfterSwitch();
    setHistoryLoaded(true);
  }, [
    clearStreamingRuntimeState,
    onHistoryLoadedAfterSwitch,
    onHistoryReceived,
    sendWS,
    setAwaitingResponse,
    setCurrentModel,
    setHistoryLoaded,
    setIsStreaming,
    setMessages,
    setServerCommands,
    startHistoryPolling,
    stopHistoryPolling,
  ]);

  const handleChatEvent = useCallback((payload: ChatEventPayload) => {
    logChatEvent(payload);

    if (commandsFetchActiveRef.current && payload.sessionKey === sessionKeyRef.current) {
      if (payload.state === "delta" && payload.message) {
        const text = typeof payload.message.content === "string"
          ? payload.message.content
          : getTextFromContent(payload.message.content);
        commandsFetchBufferRef.current += text;
      }
      if (payload.state === "final") {
        if (payload.message) {
          const text = typeof payload.message.content === "string"
            ? payload.message.content
            : getTextFromContent(payload.message.content);
          commandsFetchBufferRef.current += text;
        }
        const parsed = parseServerCommands(commandsFetchBufferRef.current);
        const coreNames = new Set(ALL_COMMANDS.map((c) => c.name));
        const extra = parsed.filter((c) => !coreNames.has(c.name));
        setServerCommands(extra);
        try { localStorage.setItem("mc-server-commands", JSON.stringify(extra)); } catch {}
        commandsFetchActiveRef.current = false;
        commandsFetchBufferRef.current = "";
      }
      if (payload.state === "error" || payload.state === "aborted") {
        commandsFetchActiveRef.current = false;
        commandsFetchBufferRef.current = "";
      }
      return;
    }

    if (payload.sessionKey !== sessionKeyRef.current) {
      if (payload.state === "final" || payload.state === "aborted" || payload.state === "error") {
        subagentStore.ingestChatEvent(payload.sessionKey, payload.state);
      }
      return;
    }

    switch (payload.state) {
      case "delta":
        if (payload.message) {
          beginContentArrival();
          setIsStreaming(true);
          activeRunIdRef.current = payload.runId;
          const msg = payload.message;

          setMessages((prev: Message[]) => {
            const existingIdx = prev.findIndex((m) => m.id === payload.runId);
            const newContent = typeof msg.content === "string"
              ? [{ type: "text" as const, text: msg.content }]
              : msg.content;

            if (existingIdx >= 0) {
              return updateAt(prev, existingIdx, (existing) => {
                const newText = typeof msg.content === "string"
                  ? msg.content
                  : getTextFromContent(msg.content);
                const parts = Array.isArray(existing.content) ? [...existing.content] : [];

                if (newText) {
                  const lastToolIdx = parts.findLastIndex((p: ContentPart) => isToolCallPart(p));
                  const lastTextIdx = parts.findLastIndex((p: ContentPart) => p.type === "text");

                  if (lastTextIdx > lastToolIdx) {
                    parts[lastTextIdx] = { ...parts[lastTextIdx], text: newText };
                  } else {
                    parts.push({ type: "text" as const, text: newText });
                  }
                }

                return {
                  ...existing,
                  content: parts,
                  reasoning: msg.reasoning || existing.reasoning,
                };
              });
            }

            if (msg.role === "user") {
              const newText = typeof msg.content === "string"
                ? msg.content
                : getTextFromContent(msg.content);
              const norm = (t: string) => t.replace(/\s+/g, " ").trim();
              const normNew = norm(newText);
              const isDuplicate = prev.some(
                (m) => m.role === "user" && norm(getTextFromContent(m.content)) === normNew,
              );
              if (isDuplicate) return prev;
              const isCtx = !!(newText && (newText.startsWith(SYSTEM_PREFIX) || newText.startsWith(SYSTEM_MESSAGE_PREFIX) || newText.includes(HEARTBEAT_MARKER)));
              return [...prev, {
                role: "user",
                content: newContent,
                id: payload.runId,
                timestamp: msg.timestamp,
                isContext: isCtx,
              } as Message];
            }

            setStreamingId(payload.runId);
            return [...prev, {
              role: msg.role,
              content: newContent,
              id: payload.runId,
              timestamp: msg.timestamp,
              reasoning: msg.reasoning,
            } as Message];
          });
        }
        break;

      case "final": {
        if (payload.runId && payload.message) {
          setMessages((prev) => upsertFinalRunMessage(prev, payload.runId, payload.message));
        }

        const runDuration = markRunEnd();
        notifyForRun(activeRunIdRef.current);
        if (runDuration > 0 && payload.runId) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === payload.runId);
            if (idx < 0) return prev;
            return updateAt(prev, idx, (m) => ({ ...m, runDuration }));
          });
        }

        stopHistoryPolling();
        clearStreamingRuntimeState({ clearRunId: true });
        thinkTagStateRef.current = { insideThinkTag: false, tagBuffer: "" };
        subagentStore.clearAll();
        handleUnpinSubagent();
        fetchedSubhistoryRef.current.clear();

        if (!queuedMessageRef.current) {
          requestHistory();
        }
        break;
      }

      case "aborted":
        markRunEnd();
        stopHistoryPolling();
        clearStreamingRuntimeState({ clearRunId: true });
        subagentStore.clearAll();
        handleUnpinSubagent();
        fetchedSubhistoryRef.current.clear();
        break;

      case "error": {
        markRunEnd();
        stopHistoryPolling();
        clearStreamingRuntimeState({ clearRunId: true });
        const errorText = payload.errorMessage || "Chat error";
        const errorMsg: Message = {
          role: "system",
          content: [{ type: "text", text: errorText }],
          id: `err-${Date.now()}`,
          timestamp: Date.now(),
          isError: true,
        };
        setMessages((prev) => [...prev, errorMsg]);
        subagentStore.clearAll();
        handleUnpinSubagent();
        fetchedSubhistoryRef.current.clear();
        break;
      }
    }
  }, [
    beginContentArrival,
    clearStreamingRuntimeState,
    handleUnpinSubagent,
    markRunEnd,
    notifyForRun,
    queuedMessageRef,
    requestHistory,
    setIsStreaming,
    setMessages,
    setServerCommands,
    setStreamingId,
    stopHistoryPolling,
    subagentStore,
  ]);

  const handleAgentEvent = useCallback((payload: AgentEventPayload) => {
    logAgentEvent(payload);

    if (payload.sessionKey !== sessionKeyRef.current) {
      subagentStore.ingestAgentEvent(payload.sessionKey, payload);
      return;
    }

    if (payload.stream === "lifecycle") {
      const phase = payload.data.phase as string;
      if (phase === "start") {
        const isExternalRun = !activeRunIdRef.current;
        markRunStart();
        setIsStreaming(true);
        activeRunIdRef.current = payload.runId;
        thinkTagStateRef.current = { insideThinkTag: false, tagBuffer: "" };
        if (isExternalRun) {
          setAwaitingResponse(true);
          setThinkingStartTime(Date.now());
          startHistoryPolling();
        }
      } else if (phase === "end" || phase === "error") {
        const runDuration = markRunEnd();
        if (runDuration > 0 && payload.runId) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === payload.runId);
            if (idx < 0) return prev;
            return updateAt(prev, idx, (m) => ({ ...m, runDuration }));
          });
        }
        if (historyPollRef.current) {
          requestHistory();
        }
      }
      return;
    }

    if (payload.stream === "tool") {
      const phase = payload.data.phase as string;
      const toolName = payload.data.name as string;
      const rawToolCallId = (payload.data.toolCallId || payload.data.tool_call_id) as string | undefined;
      const toolCallId = rawToolCallId || (toolName === SPAWN_TOOL_NAME ? `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` : undefined);

      if (phase === "start" && toolName) {
        if (toolName === SPAWN_TOOL_NAME && toolCallId) {
          subagentStore.registerSpawn(toolCallId);
        }
        addToolCall(payload.runId, toolName, payload.ts, toolCallId, payload.data.args ? JSON.stringify(payload.data.args) : undefined);
      } else if (phase === "result" && toolName) {
        const resultText = typeof payload.data.result === "string"
          ? payload.data.result
          : JSON.stringify(payload.data.result, null, 2);
        resolveToolCall(payload.runId, toolName, toolCallId, resultText, !!payload.data.isError);
      }
    }

    if (payload.stream === "reasoning") {
      if (isReasoningBlockStart(payload.data)) {
        startThinkingBlock(payload.runId, payload.ts);
      }
      const deltaRaw = payload.data.delta ?? payload.data.text ?? payload.data.content;
      const delta = typeof deltaRaw === "string" ? deltaRaw : "";
      if (delta.length > 0) {
        appendThinkingDelta(payload.runId, delta, payload.ts);
      }
    }

    if (payload.stream === "content") {
      const delta = (payload.data.delta || payload.data.text || payload.data.content || "") as string;
      if (!delta) return;
      appendContentDelta(payload.runId, delta, payload.ts);
    }
  }, [
    addToolCall,
    appendContentDelta,
    appendThinkingDelta,
    startThinkingBlock,
    markRunEnd,
    markRunStart,
    requestHistory,
    resolveToolCall,
    setAwaitingResponse,
    setIsStreaming,
    setMessages,
    setThinkingStartTime,
    startHistoryPolling,
    subagentStore,
  ]);

  const handleWSMessage = useCallback((data: WebSocketMessage) => {
    const msg = data as unknown as WSIncomingMessage;

    if (msg.type === "event" && msg.event === "connect.challenge") {
      const payload = msg.payload as ConnectChallengePayload | undefined;
      void handleConnectChallenge(payload?.nonce);
      return;
    }

    if (msg.type === "hello") {
      sessionIdRef.current = msg.sessionId;
      return;
    }

    if (msg.type === "res") {
      const resPayload = msg.payload as Record<string, unknown> | undefined;
      if (msg.ok && resPayload?.type === WS_HELLO_OK) {
        handleHelloOk(resPayload);
        return;
      }
      if (msg.id?.startsWith("run-")) {
        if (!msg.ok && msg.error) {
          const errorText = typeof msg.error === "string" ? msg.error : msg.error?.message || "Request failed";
          clearStreamingRuntimeState({ clearRunId: true });
          const errorMsg: Message = {
            role: "system",
            content: [{ type: "text", text: errorText }],
            id: `err-${Date.now()}`,
            timestamp: Date.now(),
            isError: true,
          };
          setMessages((prev) => [...prev, errorMsg]);
        }
        return;
      }
      if (msg.id?.startsWith("sessions-list-")) {
        handleSessionsListResponse(msg.ok && resPayload ? resPayload : {});
        return;
      }
      if (msg.id?.startsWith("cmdfetch-")) return;
      if (msg.ok && msg.id?.startsWith("subhistory-") && resPayload?.messages) {
        const sessionKey = pendingSubhistoryRef.current.get(msg.id);
        pendingSubhistoryRef.current.delete(msg.id);
        if (sessionKey) {
          subagentStore.loadFromHistory(sessionKey, resPayload.messages as Array<Record<string, unknown>>);
        }
        return;
      }
      if (msg.ok && msg.id?.startsWith("history-") && resPayload?.messages) {
        handleHistoryResponse(resPayload);
        return;
      }
      if (msg.id?.startsWith("config-providers-")) {
        if (msg.ok && resPayload) {
          const result = parseConfigProviders(resPayload);
          configResultRef.current = result;
          if (result.authOnlyProviders.size === 0) {
            setAvailableModels(result.explicitModels);
            setModelsLoading(false);
          } else if (modelsCatalogRef.current) {
            setAvailableModels(mergeModels(result, modelsCatalogRef.current));
            setModelsLoading(false);
          }
        } else {
          configResultRef.current = null;
          setModelsLoading(false);
        }
        return;
      }
      if (msg.id?.startsWith("models-catalog-")) {
        if (msg.ok && resPayload) {
          const catalog = Array.isArray(resPayload.models) ? resPayload.models : [];
          modelsCatalogRef.current = catalog;
          if (configResultRef.current) {
            setAvailableModels(mergeModels(configResultRef.current, catalog));
            setModelsLoading(false);
          }
        } else {
          modelsCatalogRef.current = null;
          setModelsLoading(false);
        }
        return;
      }
      if (!msg.ok && msg.error) {
        const errorMsg = typeof msg.error === "string" ? msg.error : msg.error?.message || "Unknown error";
        setConnectionError(errorMsg);
      }
      return;
    }

    if (msg.type === "event") {
      if (msg.event === "chat") {
        handleChatEvent(msg.payload as ChatEventPayload);
        return;
      }
      if (msg.event === "agent") {
        handleAgentEvent(msg.payload as AgentEventPayload);
      }
    }
  }, [
    clearStreamingRuntimeState,
    handleAgentEvent,
    handleChatEvent,
    handleConnectChallenge,
    handleHelloOk,
    handleHistoryResponse,
    handleSessionsListResponse,
    setAvailableModels,
    setConnectionError,
    setMessages,
    setModelsLoading,
    subagentStore,
  ]);

  const { connectionState, connect, disconnect, sendMessage: sendWSMessage, isConnected, markEstablished } = useWebSocket({
    onMessage: handleWSMessage,
    onOpen: () => {
      setConnectionError(null);
    },
    onError: () => {
      setConnectionError("Connection error");
    },
    onInitialConnectFail: () => {
      setConnectionError("Could not reach server");
      if (!isDetachedRef.current && !isNativeRef.current) setShowSetup(true);
    },
    onClose: () => {
      stopHistoryPolling();
      clearStreamingRuntimeState();
    },
    onReconnecting: (attempt, delay) => {
      setConnectionError(null);
      console.log(`[Page] Reconnecting (attempt ${attempt}, ${delay}ms delay)`);
    },
    onReconnected: () => {
      console.log("[Page] Reconnected — re-handshake will follow via connect.challenge");
    },
  });

  useEffect(() => {
    sendWSMessageRef.current = sendWSMessage;
  }, [sendWSMessage]);

  useEffect(() => {
    markEstablishedRef.current = markEstablished;
  }, [markEstablished]);

  const clearForSessionSwitch = useCallback(() => {
    stopHistoryPolling();
    clearStreamingRuntimeState({ clearRunId: true });
    setMessages([]);
    setHistoryLoaded(false);
    setCurrentModel(null);
    subagentStore.clearAll();
    handleUnpinSubagent();
    fetchedSubhistoryRef.current.clear();
  }, [
    clearStreamingRuntimeState,
    handleUnpinSubagent,
    setCurrentModel,
    setHistoryLoaded,
    setMessages,
    stopHistoryPolling,
    subagentStore,
  ]);

  const handleSessionSelect = useCallback((key: string) => {
    closeSessionSheet();
    if (backendMode !== "openclaw") return;
    if (key === currentSessionKey) return;
    switchSession(key);
    clearForSessionSwitch();
    requestHistory();
    requestServerCommands();
  }, [
    backendMode,
    clearForSessionSwitch,
    closeSessionSheet,
    currentSessionKey,
    requestHistory,
    requestServerCommands,
    switchSession,
  ]);

  return {
    connectionState,
    connect,
    disconnect,
    isConnected,
    sendWS,
    fetchModels,
    requestHistory,
    requestServerCommands,
    cancelCommandFetch,
    sessionIdRef,
    sessionKeyRef,
    activeRunIdRef,
    gatewayTokenRef,
    historyPollRef,
    fetchedSubhistoryRef,
    sessions,
    sessionsLoading,
    currentSessionKey,
    sessionSwitching,
    isSessionSheetOpen,
    openSessionSheet,
    closeSessionSheet,
    handleSessionSelect,
    requestSessionsList,
    pullContentRef,
    pullSpinnerRef,
    isPullingRef,
  };
}
