"use client";

import React from "react";

import { useState, useRef, useEffect, useCallback } from "react";
import { useWebSocket, type WebSocketMessage } from "@/lib/useWebSocket";
import { DEMO_HISTORY, createDemoHandler, type DemoCallbacks } from "@/lib/demoMode";
import { createLmStudioHandler, type LmStudioConfig, type LmStudioCallbacks } from "@/lib/lmStudio";
import type {
  ContentPart,
  Message,
  WSIncomingMessage,
  ConnectChallengePayload,
  ChatEventPayload,
  AgentEventPayload,
  BackendMode,
  ConnectionConfig,
  ModelChoice,
} from "@/types/chat";
import { getTextFromContent, getMessageSide, formatMessageTime, updateAt, updateMessageById } from "@/lib/messageUtils";
import { requestNotificationPermission, notifyMessageComplete } from "@/lib/notifications";
import { loadOrCreateDeviceIdentity, signDevicePayload, buildDeviceAuthPayload } from "@/lib/deviceIdentity";
import { parseBackendModels } from "@/lib/parseBackendModels";
import { logChatEvent, logAgentEvent } from "@/lib/debugLog";
import { MessageRow } from "@/components/MessageRow";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { CommandSheet } from "@/components/CommandSheet";
import { ChatInput } from "@/components/ChatInput";
import { SetupDialog } from "@/components/SetupDialog";
import { ChatHeader } from "@/components/ChatHeader";
import { useThinkingState } from "@/hooks/useThinkingState";
import { useScrollManager } from "@/hooks/useScrollManager";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useKeyboardLayout } from "@/hooks/useKeyboardLayout";
import { useTheme } from "@/hooks/useTheme";
import { useSubagentStore } from "@/hooks/useSubagentStore";

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  console.log('[HMR-CHECK] Home component rendering with GRACE code v2');
  const [openclawUrl, setOpenclawUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, _setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);

  // Sync ref immediately so scroll/wheel handlers see the correct value
  // without waiting for React's async render cycle.
  const {
    scrollRef, bottomRef, morphRef, scrollPhase, pinnedToBottomRef,
    scrollGraceRef, handleScroll, scrollToBottom, updateGraceForStreamingChange,
  } = useScrollManager(messages, isStreamingRef);

  const setIsStreaming = useCallback((value: boolean) => {
    const wasStreaming = isStreamingRef.current;
    isStreamingRef.current = value;
    updateGraceForStreamingChange(wasStreaming, value);
    _setIsStreaming(value);
  }, [updateGraceForStreamingChange]);

  // ── Thinking state ──────────────────────────────────────────────────────────
  const {
    awaitingResponse, setAwaitingResponse,
    thinkingExiting, showThinkingIndicator,
    justRevealedId,
    thinkingStartTime, setThinkingStartTime,
    beginContentArrival, onThinkingExitComplete,
    resetThinkingState,
  } = useThinkingState(streamingId, messages, setMessages);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<Record<string, unknown> | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelChoice[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const modelsRequestedRef = useRef(false);
  const appRef = useRef<HTMLDivElement>(null);
  const floatingBarRef = useRef<HTMLDivElement>(null);
  const currentAssistantMsgRef = useRef<Message | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef<string>("main");
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const demoHandlerRef = useRef<ReturnType<typeof createDemoHandler> | null>(null);

  // ── Theme ───────────────────────────────────────────────────────────────────
  const { theme, toggleTheme } = useTheme();

  // ── Subagent store ────────────────────────────────────────────────────────
  const subagentStore = useSubagentStore();

  // ── Backend mode ────────────────────────────────────────────────────────────
  const [backendMode, setBackendMode] = useState<BackendMode>("openclaw");
  const lmStudioConfigRef = useRef<LmStudioConfig | null>(null);
  const lmStudioHandlerRef = useRef<ReturnType<typeof createLmStudioHandler> | null>(null);

  // Track active run for streaming
  const activeRunIdRef = useRef<string | null>(null);
  const sendWSMessageRef = useRef<((message: WebSocketMessage) => boolean) | null>(null);
  const markEstablishedRef = useRef<(() => void) | null>(null);
  const gatewayTokenRef = useRef<string | null>(null);
  const connectNonceRef = useRef<string | null>(null);

  // History polling for mid-run reconnect: poll until the run completes
  const historyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Subagent history: track pending requests (reqId → sessionKey) and already-fetched keys
  const pendingSubhistoryRef = useRef<Map<string, string>>(new Map());
  const fetchedSubhistoryRef = useRef<Set<string>>(new Set());

  // Mid-stream silence detection: show "Thinking..." after 3s without events
  const lastEventTsRef = useRef<number>(0);
  const runStartTsRef = useRef<number>(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [midStreamSilent, setMidStreamSilent] = useState(false);

  const SILENCE_THRESHOLD_MS = 3000;

  /** Call on every meaningful agent/chat event to reset the silence timer. */
  const markEventReceived = useCallback(() => {
    lastEventTsRef.current = Date.now();
    setMidStreamSilent(false);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      if (activeRunIdRef.current) setMidStreamSilent(true);
    }, SILENCE_THRESHOLD_MS);
  }, []);

  /** Call when a run starts to begin tracking. */
  const markRunStart = useCallback(() => {
    runStartTsRef.current = Date.now();
    lastEventTsRef.current = Date.now();
    setMidStreamSilent(false);
  }, []);

  /** Call when a run ends. Returns duration in seconds. Clears silence timer. */
  const markRunEnd = useCallback((): number => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    setMidStreamSilent(false);
    const start = runStartTsRef.current;
    runStartTsRef.current = 0;
    return start ? Math.round((Date.now() - start) / 1000) : 0;
  }, []);

  // <think> tag parsing state for OpenClaw content stream
  const thinkTagStateRef = useRef<{
    insideThinkTag: boolean;
    tagBuffer: string;
  }>({ insideThinkTag: false, tagBuffer: "" });

  // Notification: extract message preview and fire notification for a completed run
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const notifyForRun = useCallback((runId: string | null) => {
    const msg = messagesRef.current.find(
      (m) => m.id === runId && m.role === "assistant"
    );
    const preview = msg ? getTextFromContent(msg.content) : "";
    notifyMessageComplete(preview);
  }, []);

  // ── Keyboard layout (iOS Safari) ───────────────────────────────────────────
  useKeyboardLayout(appRef, floatingBarRef, bottomRef);

  // ── Pull-to-refresh ─────────────────────────────────────────────────────────
  /** Send a typed message over the WebSocket (avoids double-cast). */
  const sendWS = useCallback((msg: { type: string;[key: string]: unknown }) => {
    sendWSMessageRef.current?.(msg as WebSocketMessage);
  }, []);

  const {
    pullContentRef, pullSpinnerRef, isPullingRef,
    onHistoryReceived,
  } = usePullToRefresh({ scrollRef, backendMode, sendWS, sessionKeyRef });

  // ── WebSocket sub-handlers ─────────────────────────────────────────────────

  /** Request chat history from the server. */
  const requestHistory = useCallback(() => {
    sendWS({
      type: "req",
      id: `history-${Date.now()}`,
      method: "chat.history",
      params: { sessionKey: sessionKeyRef.current },
    });
  }, [sendWS]);

  /** Fetch configured models from OpenClaw gateway config. */
  const fetchModels = useCallback(() => {
    if (backendMode !== "openclaw") return;
    if (modelsRequestedRef.current) return;
    modelsRequestedRef.current = true;
    setModelsLoading(true);
    sendWS({
      type: "req",
      id: `config-models-${Date.now()}`,
      method: "config.get",
      params: {},
    });
  }, [sendWS, backendMode]);

  /** Ensure a streaming assistant message exists for `runId`, creating one if needed. */
  const ensureStreamingMessage = useCallback((
    prev: Message[],
    runId: string,
    ts: number,
    extra?: Partial<Message>
  ): Message[] => {
    if (prev.some((m) => m.id === runId)) return prev;
    setStreamingId(runId);
    return [...prev, { role: "assistant", content: [], id: runId, timestamp: ts, ...extra } as Message];
  }, []);

  /** Append a reasoning delta to an existing or new assistant message. */
  const appendReasoning = useCallback((runId: string, ts: number, delta: string) => {
    setMessages((prev: Message[]) => {
      const idx = prev.findIndex((m) => m.id === runId);
      if (idx >= 0) {
        return updateAt(prev, idx, (msg) => ({
          ...msg,
          reasoning: (msg.reasoning || "") + delta,
        }));
      }
      setStreamingId(runId);
      return [...prev, { role: "assistant", content: [], id: runId, timestamp: ts, reasoning: delta } as Message];
    });
  }, []);

  /** Handle connect.challenge — respond with auth handshake using device identity. */
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

  /** Handle hello-ok response — extract session info and fetch history. */
  const handleHelloOk = useCallback((resPayload: Record<string, unknown>) => {
    markEstablishedRef.current?.();
    const server = resPayload.server as Record<string, unknown> | undefined;
    if (server) setServerInfo(server);
    sessionIdRef.current = (server as Record<string, string> | undefined)?.connId ?? null;

    const snapshot = resPayload.snapshot as Record<string, unknown> | undefined;
    const sessionDefaults = snapshot?.sessionDefaults as Record<string, string> | undefined;
    const sessionKey = sessionDefaults?.mainSessionKey || sessionDefaults?.mainKey || "main";
    sessionKeyRef.current = sessionKey;
    requestHistory();
  }, [requestHistory]);

  /** Handle chat.history response — parse, merge tool results, update state. */
  const handleHistoryResponse = useCallback((resPayload: Record<string, unknown>) => {
    const rawMsgs = resPayload.messages as Array<Record<string, unknown>>;

    const historyMessages = rawMsgs
      .filter((m) => {
        const content = m.content as ContentPart[] | string | null;
        return content && !(Array.isArray(content) && content.length === 0);
      })
      .map((m, idx) => {
        const content = m.content as ContentPart[] | string;
        let reasoning: string | undefined;
        let filteredContent: ContentPart[] | string;
        if (Array.isArray(content)) {
          const thinkingPart = content.find((p) => p.type === "thinking");
          if (thinkingPart?.thinking) reasoning = thinkingPart.thinking;
          filteredContent = content.filter((p) => p.type !== "thinking");
        } else {
          filteredContent = content;
        }

        let toolName: string | undefined;
        if (m.name) toolName = m.name as string;
        else if (m.toolName) toolName = m.toolName as string;
        if (!toolName && Array.isArray(filteredContent)) {
          const toolPart = filteredContent.find((p) => p.name);
          if (toolPart) toolName = toolPart.name;
        }

        let isContext = false;
        if (m.role === "user" && Array.isArray(filteredContent)) {
          const tp = filteredContent.find((p) => p.type === "text" && p.text);
          if (tp?.text && typeof tp.text === "string" && tp.text.startsWith("System: [")) isContext = true;
        }

        const isGatewayInjected = m.model === "gateway-injected";
        const effectiveStopReason = isGatewayInjected ? "injected" : m.stopReason;

        return {
          role: m.role,
          content: filteredContent,
          timestamp: m.timestamp,
          id: `hist-${idx}`,
          reasoning,
          toolName,
          isError: m.stopReason === "error",
          stopReason: effectiveStopReason,
          isContext,
        } as Message;
      });

    // Merge tool results into the preceding assistant's tool call content parts
    const mergedIds = new Set<string>();
    for (let i = 0; i < historyMessages.length; i++) {
      const hm = historyMessages[i];
      if ((hm.role === "tool" || hm.role === "toolResult" || hm.role === "tool_result") && hm.toolName) {
        const resultText = getTextFromContent(hm.content);
        for (let j = i - 1; j >= 0; j--) {
          const prev = historyMessages[j];
          if (prev.role === "assistant" && Array.isArray(prev.content)) {
            const tc = prev.content.find((p) => p.name === hm.toolName && !p.result);
            if (tc) {
              const args = tc.arguments;
              tc.arguments = typeof args === "string" ? args : args ? JSON.stringify(args) : undefined;
              tc.result = resultText;
              tc.resultError = hm.isError;
              tc.status = hm.isError ? "error" : "success";
              if (hm.id) mergedIds.add(hm.id);
              break;
            }
          }
        }
      }
    }
    const finalMessages = historyMessages.filter((m) => !m.id || !mergedIds.has(m.id));

    // Extract model from history
    const lastAssistantRaw = rawMsgs.filter((m) => m.role === "assistant" && m.model).pop();
    if (lastAssistantRaw?.model) {
      const provider = lastAssistantRaw.provider as string | undefined;
      const model = lastAssistantRaw.model as string;
      setCurrentModel(provider ? `${provider}/${model}` : model);
    }
    const lastInjected = rawMsgs.filter((m) => m.stopReason === "injected").pop();
    if (lastInjected) {
      if (lastInjected.model) {
        const provider = lastInjected.provider as string | undefined;
        const model = lastInjected.model as string;
        setCurrentModel(provider ? `${provider}/${model}` : model);
      } else {
        const injectedContent = lastInjected.content;
        let injectedText = "";
        if (typeof injectedContent === "string") {
          injectedText = injectedContent;
        } else if (Array.isArray(injectedContent)) {
          injectedText = (injectedContent as ContentPart[])
            .filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("");
        }
        const modelMatch = injectedText.match(/model\s+(?:set\s+to|changed\s+to|is|:)\s+[`*]*([a-zA-Z0-9_./-]+)[`*]*/i);
        if (modelMatch) setCurrentModel(modelMatch[1]);
      }
    }

    // Merge: keep optimistic user messages not yet in server history
    setMessages((prev: Message[]) => {
      const historyUserTexts = new Set(
        finalMessages
          .filter((m) => m.role === "user")
          .map((m) => getTextFromContent(m.content))
      );
      const optimistic = prev.filter(
        (m) =>
          m.role === "user" &&
          m.id?.startsWith("u-") &&
          !historyUserTexts.has(getTextFromContent(m.content))
      );
      if (optimistic.length === 0) return finalMessages;
      return [...finalMessages, ...optimistic].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    });

    // Detect in-progress run: last message is an assistant with no stopReason,
    // or last user message has no assistant reply yet. Re-enter streaming state
    // and poll history until the run finishes.
    const lastRaw = rawMsgs[rawMsgs.length - 1];
    const lastIsUser = lastRaw?.role === "user";
    const lastAssistant = [...rawMsgs].reverse().find((m) => m.role === "assistant");
    const runInProgress =
      lastIsUser ||
      (lastAssistant && !lastAssistant.stopReason);

    if (runInProgress) {
      setAwaitingResponse(true);
      setIsStreaming(true);
      markEventReceived();
      // Poll history every 3s to pick up progress (tool results, new text, etc.)
      if (!historyPollRef.current) {
        historyPollRef.current = setInterval(() => {
          requestHistory();
        }, 3000);
      }
    } else {
      // Run is done — stop polling if active
      if (historyPollRef.current) {
        clearInterval(historyPollRef.current);
        historyPollRef.current = null;
      }
      setAwaitingResponse(false);
      setIsStreaming(false);
      setStreamingId(null);
    }

    // Request subagent history for any sessions_spawn tool calls with childSessionKey
    for (const raw of rawMsgs) {
      if (raw.role !== "assistant" || !Array.isArray(raw.content)) continue;
      for (const part of raw.content as Array<Record<string, unknown>>) {
        if ((part.type !== "tool_call" && part.type !== "toolCall") || part.name !== "sessions_spawn") continue;
        const resultStr = part.result as string | undefined;
        if (!resultStr) continue;
        try {
          const r = JSON.parse(resultStr);
          const childKey = r?.childSessionKey as string | undefined;
          if (childKey && !fetchedSubhistoryRef.current.has(childKey)) {
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
        } catch { /* ignore malformed result */ }
      }
    }

    // If pull-to-refresh was active, bounce back
    onHistoryReceived();
    setHistoryLoaded(true);
  }, [onHistoryReceived, requestHistory, markEventReceived, sendWS, subagentStore]);

  /** Handle chat events (delta/final/aborted/error). */
  const handleChatEvent = useCallback((payload: ChatEventPayload) => {
    logChatEvent(payload);
    // Route subagent session events to the subagent store
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
          markEventReceived();
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
                  // Only update/add the trailing text part (after the last tool call).
                  // This preserves earlier text segments interleaved with tool calls:
                  //   [text("pre-tool"), tool_call(...), text("post-tool")]
                  const lastToolIdx = parts.findLastIndex(
                    (p: ContentPart) => p.type === "tool_call" || p.type === "toolCall"
                  );
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
              return prev;
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
        const runDuration = markRunEnd();
        notifyForRun(activeRunIdRef.current);
        if (runDuration > 0 && payload.runId) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === payload.runId);
            if (idx < 0) return prev;
            return updateAt(prev, idx, (m) => ({ ...m, runDuration }));
          });
        }
        if (historyPollRef.current) { clearInterval(historyPollRef.current); historyPollRef.current = null; }
        setAwaitingResponse(false);
        setIsStreaming(false);
        setStreamingId(null);
        activeRunIdRef.current = null;
        thinkTagStateRef.current = { insideThinkTag: false, tagBuffer: "" };
        subagentStore.clearAll();
        fetchedSubhistoryRef.current.clear();
        requestHistory();
        break;
      }

      case "aborted":
        markRunEnd();
        if (historyPollRef.current) { clearInterval(historyPollRef.current); historyPollRef.current = null; }
        setAwaitingResponse(false);
        setIsStreaming(false);
        setStreamingId(null);
        activeRunIdRef.current = null;
        subagentStore.clearAll();
        fetchedSubhistoryRef.current.clear();
        break;

      case "error": {
        markRunEnd();
        if (historyPollRef.current) { clearInterval(historyPollRef.current); historyPollRef.current = null; }
        setAwaitingResponse(false);
        setIsStreaming(false);
        setStreamingId(null);
        const errorText = payload.errorMessage || "Chat error";
        const errorMsg: Message = {
          role: "system",
          content: [{ type: "text", text: errorText }],
          id: `err-${Date.now()}`,
          timestamp: Date.now(),
          isError: true,
        };
        setMessages((prev) => [...prev, errorMsg]);
        activeRunIdRef.current = null;
        subagentStore.clearAll();
        fetchedSubhistoryRef.current.clear();
        break;
      }
    }
  }, [requestHistory, notifyForRun, beginContentArrival, markEventReceived, markRunEnd, setIsStreaming, setAwaitingResponse, subagentStore]);

  /** Handle agent events (lifecycle/content/reasoning/tool streams). */
  const handleAgentEvent = useCallback((payload: AgentEventPayload) => {
    logAgentEvent(payload);
    // Route subagent session events to the subagent store
    if (payload.sessionKey !== sessionKeyRef.current) {
      subagentStore.ingestAgentEvent(payload.sessionKey, payload);
      return;
    }
    markEventReceived();

    if (payload.stream === "lifecycle") {
      const phase = payload.data.phase as string;
      if (phase === "start") {
        markRunStart();
        setIsStreaming(true);
        activeRunIdRef.current = payload.runId;
        thinkTagStateRef.current = { insideThinkTag: false, tagBuffer: "" };
      } else if (phase === "end" || phase === "error") {
        const runDuration = markRunEnd();
        if (runDuration > 0 && payload.runId) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === payload.runId);
            if (idx < 0) return prev;
            return updateAt(prev, idx, (m) => ({ ...m, runDuration }));
          });
        }
      }
      return;
    }

    if (payload.stream === "tool") {
      const phase = payload.data.phase as string;
      const toolName = payload.data.name as string;
      const rawToolCallId = (payload.data.toolCallId || payload.data.tool_call_id) as string | undefined;
      // Always ensure sessions_spawn has a toolCallId so the SpawnPill can render
      const toolCallId = rawToolCallId || (toolName === "sessions_spawn" ? `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` : undefined);

      if (phase === "start" && toolName) {
        if (toolName === "sessions_spawn" && toolCallId) {
          subagentStore.registerSpawn(toolCallId);
        }
        beginContentArrival();
        setMessages((prev: Message[]) => {
          const toolCallPart: ContentPart = {
            type: "tool_call",
            name: toolName,
            toolCallId,
            arguments: payload.data.args ? JSON.stringify(payload.data.args) : undefined,
            status: "running",
          };

          const idx = prev.findIndex((m) => m.id === payload.runId);
          if (idx >= 0) {
            return updateAt(prev, idx, (target) => ({
              ...target,
              content: [...(Array.isArray(target.content) ? target.content : []), toolCallPart],
            }));
          }

          setStreamingId(payload.runId);
          return [...prev, {
            role: "assistant",
            content: [toolCallPart],
            id: payload.runId,
            timestamp: payload.ts,
          } as Message];
        });
      } else if (phase === "result" && toolName) {
        const resultText = typeof payload.data.result === "string"
          ? payload.data.result : JSON.stringify(payload.data.result, null, 2);
        const isErr = !!payload.data.isError;
        setMessages((prev: Message[]) => {
          let idx = prev.findIndex((m) => m.id === payload.runId);
          if (idx < 0) idx = prev.findLastIndex((m) => m.role === "assistant");
          if (idx < 0 || !Array.isArray(prev[idx].content)) return prev;
          return updateAt(prev, idx, (target) => ({
            ...target,
            content: (target.content as ContentPart[]).map((part) => {
              if ((part.type === "tool_call" || part.type === "toolCall")) {
                const isMatch = toolCallId
                  ? part.toolCallId === toolCallId
                  : part.name === toolName && !part.result;
                if (isMatch) {
                  return { ...part, status: isErr ? "error" as const : "success" as const, result: resultText, resultError: isErr };
                }
              }
              return part;
            }),
          }));
        });
      }
    }

    if (payload.stream === "reasoning") {
      const delta = (payload.data.delta || payload.data.text || payload.data.content || "") as string;
      if (!delta) return;
      beginContentArrival();
      setMessages((prev: Message[]) => {
        const updated = ensureStreamingMessage(prev, payload.runId, payload.ts);
        const idx = updated.findIndex((m) => m.id === payload.runId);
        if (idx < 0) return updated;
        return updateAt(updated, idx, (target) => {
          const parts = Array.isArray(target.content) ? [...target.content] : [];
          // Append to the trailing thinking part, or create one after the last tool call
          const lastThinkIdx = parts.findLastIndex((p: ContentPart) => p.type === "thinking");
          const lastToolIdx = parts.findLastIndex(
            (p: ContentPart) => p.type === "tool_call" || p.type === "toolCall"
          );
          if (lastThinkIdx > lastToolIdx) {
            // Append to existing thinking part (after last tool)
            parts[lastThinkIdx] = { ...parts[lastThinkIdx], type: "thinking", text: (parts[lastThinkIdx].text || "") + delta };
          } else {
            // New thinking segment after the last tool call
            parts.push({ type: "thinking" as const, text: delta });
          }
          return { ...target, content: parts };
        });
      });
    }

    if (payload.stream === "content") {
      const delta = (payload.data.delta || payload.data.text || payload.data.content || "") as string;
      if (!delta) return;
      beginContentArrival();
      setMessages((prev: Message[]) => {
        const updated = ensureStreamingMessage(prev, payload.runId, payload.ts);
        const idx = updated.findIndex((m) => m.id === payload.runId);
        if (idx < 0) return updated;
        return updateAt(updated, idx, (target) => {
          const parts = Array.isArray(target.content) ? [...target.content] : [];
          const lastToolIdx = parts.findLastIndex(
            (p: ContentPart) => p.type === "tool_call" || p.type === "toolCall"
          );
          const lastTextIdx = parts.findLastIndex((p: ContentPart) => p.type === "text");
          if (lastTextIdx > lastToolIdx) {
            parts[lastTextIdx] = { ...parts[lastTextIdx], text: (parts[lastTextIdx].text || "") + delta };
          } else {
            parts.push({ type: "text" as const, text: delta });
          }
          return { ...target, content: parts };
        });
      });
    }
  }, [appendReasoning, ensureStreamingMessage, beginContentArrival, markEventReceived, markRunStart, markRunEnd, setIsStreaming, subagentStore]);

  // ── Main WebSocket message dispatcher ─────────────────────────────────────

  const handleWSMessage = useCallback((data: WebSocketMessage) => {
    const msg = data as unknown as WSIncomingMessage;

    if (msg.type === "event" && msg.event === "connect.challenge") {
      const payload = msg.payload as ConnectChallengePayload | undefined;
      return void handleConnectChallenge(payload?.nonce);
    }

    if (msg.type === "hello") {
      sessionIdRef.current = msg.sessionId;
      return;
    }

    if (msg.type === "res") {
      const resPayload = msg.payload as Record<string, unknown> | undefined;
      if (msg.ok && resPayload?.type === "hello-ok") return handleHelloOk(resPayload);
      if (msg.id?.startsWith("run-")) {
        if (!msg.ok && msg.error) {
          const errorText = typeof msg.error === "string" ? msg.error : msg.error?.message || "Request failed";
          setAwaitingResponse(false);
          setIsStreaming(false);
          setStreamingId(null);
          activeRunIdRef.current = null;
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
      if (msg.ok && msg.id?.startsWith("sessions-list-")) return;
      if (msg.ok && msg.id?.startsWith("subhistory-") && resPayload?.messages) {
        const sessionKey = pendingSubhistoryRef.current.get(msg.id);
        pendingSubhistoryRef.current.delete(msg.id);
        if (sessionKey) {
          subagentStore.loadFromHistory(sessionKey, resPayload.messages as Array<Record<string, unknown>>);
        }
        return;
      }
      if (msg.ok && msg.id?.startsWith("history-") && resPayload?.messages) return handleHistoryResponse(resPayload);
      if (msg.id?.startsWith("config-models-")) {
        setModelsLoading(false);
        if (msg.ok && resPayload) {
          const models = parseBackendModels(resPayload);
          setAvailableModels(models);
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
      if (msg.event === "chat") return handleChatEvent(msg.payload as ChatEventPayload);
      if (msg.event === "agent") return handleAgentEvent(msg.payload as AgentEventPayload);
    }
  }, [handleConnectChallenge, handleHelloOk, handleHistoryResponse, handleChatEvent, handleAgentEvent, subagentStore]);

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
      setShowSetup(true);
    },
    onClose: () => {
      if (historyPollRef.current) { clearInterval(historyPollRef.current); historyPollRef.current = null; }
      setIsStreaming(false);
      setStreamingId(null);
      setAwaitingResponse(false);
    },
    onReconnecting: (attempt, delay) => {
      // Clear any hard error — the hook is handling recovery
      setConnectionError(null);
      console.log(`[Page] Reconnecting (attempt ${attempt}, ${delay}ms delay)`);
    },
    onReconnected: () => {
      console.log("[Page] Reconnected — re-handshake will follow via connect.challenge");
    },
  });

  // Store callbacks in refs to avoid circular dependency with handleWSMessage
  useEffect(() => {
    sendWSMessageRef.current = sendWSMessage;
  }, [sendWSMessage]);
  useEffect(() => {
    markEstablishedRef.current = markEstablished;
  }, [markEstablished]);

  // ── Demo mode ─────────────────────────────────────────────────────────────

  // Detect ?demo URL param on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("demo")) {
      setIsDemoMode(true);
      setBackendMode("demo");
      setMessages(DEMO_HISTORY);
      setCurrentModel("demo/openclaw-preview");
      setShowSetup(false);
      setHistoryLoaded(true);
    }
  }, []);

  // Create handler with callbacks
  useEffect(() => {
    if (!isDemoMode) {
      demoHandlerRef.current = null;
      return;
    }
    const callbacks: DemoCallbacks = {
      onStreamStart: (runId) => {
        setIsStreaming(true);
        setStreamingId(runId);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: [], id: runId, timestamp: Date.now() },
        ]);
      },
      onThinking: (runId, text) => {
        setMessages((prev: Message[]) => updateMessageById(prev, runId, (m) => ({ ...m, reasoning: text })));
      },
      onTextDelta: (runId, _delta, fullText) => {
        setMessages((prev: Message[]) => updateMessageById(prev, runId, (target) => {
          const existingParts = Array.isArray(target.content) ? target.content : [];
          const nonTextParts = existingParts.filter((p: ContentPart) => p.type !== "text");
          return { ...target, content: [...nonTextParts, { type: "text" as const, text: fullText }] };
        }));
      },
      onToolStart: (runId, name, args, toolCallId) => {
        setMessages((prev: Message[]) => updateMessageById(prev, runId, (target) => {
          const parts = Array.isArray(target.content) ? target.content : [];
          return { ...target, content: [...parts, { type: "tool_call" as const, name, arguments: args, toolCallId, status: "running" as const }] };
        }));
      },
      onToolEnd: (runId, name, result, isError) => {
        setMessages((prev: Message[]) => updateMessageById(prev, runId, (target) => {
          if (!Array.isArray(target.content)) return target;
          return {
            ...target,
            content: target.content.map((p: ContentPart) =>
              p.type === "tool_call" && p.name === name && p.status === "running"
                ? { ...p, status: (isError ? "error" : "success") as "error" | "success", result, resultError: isError }
                : p
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
          runId: `demo-subagent-run`,
          sessionKey,
          stream: stream as AgentEventPayload["stream"],
          data,
          seq: 0,
          ts,
        });
      },
    };
    demoHandlerRef.current = createDemoHandler(callbacks);
  }, [isDemoMode, setIsStreaming, subagentStore]);

  // ── LM Studio mode ────────────────────────────────────────────────────────

  useEffect(() => {
    if (backendMode !== "lmstudio" || !lmStudioConfigRef.current) {
      lmStudioHandlerRef.current = null;
      return;
    }
    const config = lmStudioConfigRef.current;
    const callbacks: LmStudioCallbacks = {
      onStreamStart: (_runId) => {},
      onThinking: (runId, text, segment) => {
        if (text) beginContentArrival();
        setStreamingId(runId);
        setMessages((prev: Message[]) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) {
            return [...prev, { role: "assistant", content: [{ type: "thinking", text }], id: runId, timestamp: Date.now() } as Message];
          }
          return updateAt(prev, idx, (target) => {
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
          return updateAt(prev, idx, (target) => {
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
          return updateAt(prev, idx, (target) => {
            const parts = Array.isArray(target.content) ? target.content : [];
            return { ...target, content: [...parts, { type: "tool_call" as const, name, arguments: args, status: "running" as const }] };
          });
        });
      },
      onToolEnd: (runId, name, result, isError) => {
        setMessages((prev: Message[]) => updateMessageById(prev, runId, (target) => {
          if (!Array.isArray(target.content)) return target;
          return {
            ...target,
            content: target.content.map((p: ContentPart) =>
              p.type === "tool_call" && p.name === name && p.status === "running"
                ? { ...p, status: (isError ? "error" : "success") as "error" | "success", result: result || undefined, resultError: isError }
                : p
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
          try { window.localStorage.setItem("lmstudio-messages", JSON.stringify(prev)); } catch { }
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
  }, [backendMode, currentModel, beginContentArrival, setIsStreaming, setAwaitingResponse]);

  // ── Backend initialization (localStorage restore) ─────────────────────────

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo")) {
      return;
    }
    if (isDemoMode) return;
    const savedMode = window.localStorage.getItem("mobileclaw-mode") as BackendMode | null;

    if (savedMode === "demo") return;

    if (savedMode === "lmstudio") {
      const savedUrl = window.localStorage.getItem("lmstudio-url");
      const savedApiKey = window.localStorage.getItem("lmstudio-apikey");
      const savedModel = window.localStorage.getItem("lmstudio-model");
      if (savedUrl && savedModel) {
        setBackendMode("lmstudio");
        const config: LmStudioConfig = { baseUrl: savedUrl, apiKey: savedApiKey || undefined, model: savedModel };
        lmStudioConfigRef.current = config;
        setCurrentModel(savedModel);
        setOpenclawUrl(savedUrl);
        try {
          const saved = window.localStorage.getItem("lmstudio-messages");
          if (saved) {
            const parsed = JSON.parse(saved) as Message[];
            if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
          }
        } catch { }
        setHistoryLoaded(true);
      } else {
        setShowSetup(true);
        setHistoryLoaded(true);
      }
    } else {
      const savedUrl = window.localStorage.getItem("openclaw-url");
      const savedToken = window.localStorage.getItem("openclaw-token");
      if (savedUrl) {
        gatewayTokenRef.current = savedToken ?? null;
        setBackendMode("openclaw");
        setOpenclawUrl(savedUrl);
        let wsUrl = savedUrl;
        if (!savedUrl.startsWith("ws://") && !savedUrl.startsWith("wss://")) {
          wsUrl = savedUrl.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
        }
        connect(wsUrl);
      } else {
        setShowSetup(true);
        setHistoryLoaded(true);
      }
    }
  }, [connect, isDemoMode]);

  // ── Connection handler ────────────────────────────────────────────────────

  const handleConnect = useCallback((config: ConnectionConfig) => {
    setConnectionError(null);
    setMessages([]);
    resetThinkingState();
    window.localStorage.removeItem("lmstudio-messages");

    if (config.mode === "demo") {
      window.localStorage.setItem("mobileclaw-mode", "demo");
      setBackendMode("demo");
      setIsDemoMode(true);
      setMessages(DEMO_HISTORY);
      setCurrentModel("demo/openclaw-preview");
      setHistoryLoaded(true);
      return;
    }

    if (config.mode === "lmstudio") {
      window.localStorage.setItem("mobileclaw-mode", "lmstudio");
      window.localStorage.setItem("lmstudio-url", config.url);
      if (config.token) window.localStorage.setItem("lmstudio-apikey", config.token);
      else window.localStorage.removeItem("lmstudio-apikey");
      if (config.model) window.localStorage.setItem("lmstudio-model", config.model);
      setBackendMode("lmstudio");
      setIsDemoMode(false);
      const lmsConfig: LmStudioConfig = { baseUrl: config.url, apiKey: config.token, model: config.model! };
      lmStudioConfigRef.current = lmsConfig;
      setCurrentModel(config.model || null);
      setOpenclawUrl(config.url);
      disconnect();
      return;
    }

    // OpenClaw mode
    window.localStorage.setItem("mobileclaw-mode", "openclaw");
    window.localStorage.setItem("openclaw-url", config.url);
    if (config.token) window.localStorage.setItem("openclaw-token", config.token);
    gatewayTokenRef.current = config.token ?? null;
    setBackendMode("openclaw");
    setIsDemoMode(false);
    lmStudioConfigRef.current = null;
    lmStudioHandlerRef.current = null;
    setOpenclawUrl(config.url);
    let wsUrl = config.url;
    if (!config.url.startsWith("ws://") && !config.url.startsWith("wss://")) {
      wsUrl = config.url.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
    }
    connect(wsUrl);
  }, [connect, disconnect, resetThinkingState]);

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = useCallback((text: string) => {
    requestNotificationPermission();
    pinnedToBottomRef.current = true;

    const userMsg: Message = { role: "user", content: [{ type: "text", text }], id: `u-${Date.now()}`, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    // Demo mode
    if (isDemoMode || backendMode === "demo") {
      demoHandlerRef.current?.sendMessage(text);
      return;
    }

    // LM Studio mode
    if (backendMode === "lmstudio") {
      setAwaitingResponse(true);
      setThinkingStartTime(Date.now());
      setMessages((prev) => {
        try { window.localStorage.setItem("lmstudio-messages", JSON.stringify(prev)); } catch { }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            lmStudioHandlerRef.current?.sendMessage(prev);
          });
        });
        return prev;
      });
      return;
    }

    // OpenClaw mode — WebSocket
    if (!isConnected) return;

    setAwaitingResponse(true);
    setThinkingStartTime(Date.now());

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRunIdRef.current = runId;

    sendWS({
      type: "req",
      id: runId,
      method: "chat.send",
      params: {
        sessionKey: sessionKeyRef.current,
        message: text,
        deliver: true,
        idempotencyKey: runId,
      },
    });

    setIsStreaming(true);
  }, [isConnected, isDemoMode, backendMode, sendWS, pinnedToBottomRef, setIsStreaming, setAwaitingResponse, setThinkingStartTime]);

  const handleCommandSelect = useCallback((command: string) => {
    setPendingCommand(command);
  }, []);

  const clearPendingCommand = useCallback(() => {
    setPendingCommand(null);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={appRef} className="relative flex flex-col overflow-hidden bg-background" style={{ height: "100dvh" }}>
      <SetupDialog
        onConnect={(config) => {
          setShowSetup(false);
          handleConnect(config);
        }}
        onClose={openclawUrl || isDemoMode || backendMode !== "openclaw" ? () => setShowSetup(false) : undefined}
        visible={showSetup}
        connectionError={connectionError}
        isDemoMode={isDemoMode}
      />

      <CommandSheet
        open={commandsOpen}
        onClose={() => setCommandsOpen(false)}
        onSelect={handleCommandSelect}
        onSend={sendMessage}
        availableModels={availableModels}
        modelsLoading={modelsLoading}
        onFetchModels={fetchModels}
        backendMode={backendMode}
      />

      <ChatHeader
        currentModel={currentModel}
        theme={theme}
        toggleTheme={toggleTheme}
        connectionState={connectionState}
        backendMode={backendMode}
        isDemoMode={isDemoMode}
        onOpenSetup={() => setShowSetup(true)}
      />

      <div ref={pullContentRef} className="flex flex-1 flex-col min-h-0">
        <main
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{ overscrollBehavior: "none" }}
        >
          <div className={`mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6 pb-28 md:px-6 md:py-4 md:pb-28 transition-opacity duration-300 ease-out ${historyLoaded ? "opacity-100" : "opacity-0"}`}>
            {messages.map((msg, idx) => {
              const side = getMessageSide(msg.role);
              const prevSide = idx > 0 ? getMessageSide(messages[idx - 1].role) : null;
              const prevTimestamp = idx > 0 ? messages[idx - 1].timestamp : null;
              const isNewTurn = side !== "center" && side !== prevSide;
              const timGap = msg.timestamp && prevTimestamp ? msg.timestamp - prevTimestamp : 0;
              const isTimeGap = timGap > 10 * 60 * 1000;
              const showTimestamp = side !== "center" && (isNewTurn || isTimeGap);
              const isHiddenDuringExit = thinkingExiting && msg.id === streamingId;
              if (isHiddenDuringExit) return null;

              const fadeInClass = msg.id === justRevealedId ? "animate-[fadeIn_200ms_ease-out]" : "";

              return (
                <React.Fragment key={msg.id || idx}>
                  {isTimeGap && !isNewTurn && msg.timestamp && (
                    <div className={`flex justify-center py-1 ${fadeInClass}`}>
                      <span className="text-[10px] text-muted-foreground/60">{formatMessageTime(msg.timestamp)}</span>
                    </div>
                  )}
                  {showTimestamp && isNewTurn && msg.timestamp && (
                    <p className={`text-[10px] text-muted-foreground/60 ${side === "right" ? "text-right" : "text-left"} ${fadeInClass}`}>
                      {formatMessageTime(msg.timestamp)}
                      {msg.role === "assistant" && msg.runDuration && msg.runDuration > 0 && (
                        <span className="ml-1">&middot; Worked for {msg.runDuration}s</span>
                      )}
                      {msg.role === "assistant" && !msg.runDuration && msg.thinkingDuration && msg.thinkingDuration > 0 && (
                        <span className="ml-1">&middot; {msg.thinkingDuration}s</span>
                      )}
                    </p>
                  )}
                  <div className={fadeInClass}>
                    <MessageRow message={msg} isStreaming={isStreaming && msg.id === streamingId} subagentStore={subagentStore} />
                  </div>
                </React.Fragment>
              );
            })}
            <ThinkingIndicator visible={(showThinkingIndicator || midStreamSilent) && !thinkingExiting} onExitComplete={onThinkingExitComplete} startTime={midStreamSilent ? (lastEventTsRef.current || undefined) : (thinkingStartTime ?? undefined)} />
            <div ref={bottomRef} />
          </div>
        </main>
        {/* Pull-to-refresh spinner */}
        <div
          ref={pullSpinnerRef}
          className="flex h-0 items-center justify-center gap-2 overflow-visible"
          style={{ opacity: 0, transform: "translateY(calc(-3dvh - 23px))" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground" style={{ animation: "none" }}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span className="text-sm leading-none">🦞</span>
        </div>
      </div>

      {/* Floating morphing bar */}
      <div
        ref={floatingBarRef}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[3dvh] md:px-6 md:pb-[3dvh] animate-[fadeIn_400ms_ease-out]"
      >
        <div ref={morphRef} className="pointer-events-auto w-full" style={{ maxWidth: "min(calc(200px + (100% - 200px) * (1 - var(--sp, 0))), calc(200px + (42rem - 200px) * (1 - var(--sp, 0))))" } as React.CSSProperties}>
          <ChatInput
            onSend={sendMessage}
            onOpenCommands={() => setCommandsOpen(true)}
            commandValue={pendingCommand}
            onCommandValueUsed={clearPendingCommand}
            scrollPhase={scrollPhase}
            onScrollToBottom={scrollToBottom}
            availableModels={availableModels}
            modelsLoading={modelsLoading}
            onFetchModels={fetchModels}
            backendMode={backendMode}
          />
        </div>
      </div>
    </div>
  );
}
