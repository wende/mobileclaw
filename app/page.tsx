"use client";

import React from "react";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
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
import { MessageRow } from "@/components/MessageRow";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { CommandSheet } from "@/components/CommandSheet";
import { ChatInput } from "@/components/ChatInput";
import { SetupDialog } from "@/components/SetupDialog";

// ── Page ─────────────────────────────────────────────────────────────────────

// ── Helper: Parse Backend Models ─────────────────────────────────────────────

function parseBackendModels(resPayload: Record<string, unknown>): ModelChoice[] {
  const raw = (resPayload as { raw?: string })?.raw;
  if (!raw) return [];

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    console.error("[config.get] Failed to parse raw config:", e);
    return [];
  }

  const providers = (config.models as any)?.providers;
  if (!providers) return [];

  // Flatten provider models into a single list
  const models = Object.entries(providers).flatMap(([providerKey, providerConfig]: [string, any]) => {
    const providerModels = providerConfig.models;
    if (!Array.isArray(providerModels)) return [];

    return providerModels
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: `${providerKey}/${m.id}`,
        name: m.name || m.id,
        provider: providerKey,
        contextWindow: m.contextWindow,
        reasoning: m.reasoning,
      }));
  });

  console.log("[config.get] Parsed models:", models);
  return models;
}

export default function Home() {
  console.log('[HMR-CHECK] Home component rendering with GRACE code v2');
  const [openclawUrl, setOpenclawUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, _setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  // Grace period: when streaming ends while pinned, keep force-scrolling for
  // a short window so the final content snap (StreamingText revealing remaining
  // text) doesn't get stranded above the fold.
  const scrollGraceRef = useRef(false);
  const scrollGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sync ref immediately so scroll/wheel handlers see the correct value
  // without waiting for React's async render cycle.
  const setIsStreaming = useCallback((value: boolean) => {
    const wasStreaming = isStreamingRef.current;
    isStreamingRef.current = value;
    // Activate grace period synchronously on the streaming→idle transition
    // while pinned, so handleScroll (which runs synchronously on scrollTop
    // changes) won't unpin before the ResizeObserver can catch up.
    if (wasStreaming && !value && pinnedToBottomRef.current) {
      scrollGraceRef.current = true;
      if (scrollGraceTimerRef.current) clearTimeout(scrollGraceTimerRef.current);
      scrollGraceTimerRef.current = setTimeout(() => {
        scrollGraceRef.current = false;
        scrollGraceTimerRef.current = null;
      }, 500);
    } else if (value) {
      // Streaming started — clear any stale grace
      scrollGraceRef.current = false;
      if (scrollGraceTimerRef.current) {
        clearTimeout(scrollGraceTimerRef.current);
        scrollGraceTimerRef.current = null;
      }
    }
    _setIsStreaming(value);
  }, []);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  // LM Studio "Thinking..." state: set true when message sent, false when first content arrives.
  // Uses double-RAF in sendMessage to ensure browser paints before fetch starts.
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  // Track when ThinkingIndicator is exiting (dissolving animation)
  const [thinkingExiting, setThinkingExiting] = useState(false);
  // Show indicator while awaiting OR while exit animation is in progress
  const showThinkingIndicator = awaitingResponse || thinkingExiting;
  // Track when thinking started for duration display
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);

  // Transition from awaiting to streaming: start exit animation instead of abrupt hide
  const awaitingResponseRef = useRef(false);
  awaitingResponseRef.current = awaitingResponse;
  // Track when we just finished the exit animation (for fade-in effect)
  const [justRevealedId, setJustRevealedId] = useState<string | null>(null);

  // Reset all thinking indicator state (used when conversation is cleared)
  const resetThinkingState = useCallback(() => {
    setAwaitingResponse(false);
    setThinkingExiting(false);
    setJustRevealedId(null);
    setThinkingStartTime(null);
  }, []);

  // Ref to access thinkingStartTime in callbacks without dependency
  const thinkingStartTimeRef = useRef<number | null>(null);
  thinkingStartTimeRef.current = thinkingStartTime;
  // Pending duration to apply when assistant message is created
  const pendingThinkingDurationRef = useRef<number | null>(null);

  const beginContentArrival = useCallback(() => {
    if (awaitingResponseRef.current) {
      // Calculate thinking duration and store in ref for message creation
      const startTime = thinkingStartTimeRef.current;
      const duration = startTime ? Math.round((Date.now() - startTime) / 1000) : null;
      if (duration !== null && duration > 0) {
        pendingThinkingDurationRef.current = duration;
      }

      setAwaitingResponse(false);
      setThinkingExiting(true);
      setThinkingStartTime(null);
    }
  }, []);
  const onThinkingExitComplete = useCallback(() => {
    setThinkingExiting(false);
    // Mark the streaming message as "just revealed" for fade-in animation
    setJustRevealedId(streamingId);
    // Clear the flag after animation completes
    setTimeout(() => setJustRevealedId(null), 250);
  }, [streamingId]);

  // Reset thinking state when messages are cleared (e.g., /new command)
  useEffect(() => {
    if (messages.length === 0) {
      resetThinkingState();
      pendingThinkingDurationRef.current = null;
    }
  }, [messages.length, resetThinkingState]);

  // Apply pending thinking duration to newly created assistant messages
  useLayoutEffect(() => {
    const duration = pendingThinkingDurationRef.current;
    if (!duration) return;

    // Find the last assistant message without a duration (the one being streamed)
    const targetIdx = messages.findLastIndex((m) => m.role === "assistant" && !m.thinkingDuration);
    if (targetIdx >= 0) {
      pendingThinkingDurationRef.current = null;
      setMessages((prev) => updateAt(prev, targetIdx, (msg) => ({ ...msg, thinkingDuration: duration })));
    }
  }, [messages]);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<Record<string, unknown> | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelChoice[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const modelsRequestedRef = useRef(false);
  const [scrollPhase, setScrollPhase] = useState<"input" | "pill">("input");
  const appRef = useRef<HTMLDivElement>(null);
  const morphRef = useRef<HTMLDivElement>(null);
  const floatingBarRef = useRef<HTMLDivElement>(null);
  const scrollRafId = useRef<number | null>(null);
  const scrollPhaseRef = useRef<"input" | "pill">("input");
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  // Pull-to-refresh (ref-driven to avoid re-renders during gesture)
  const [refreshing, setRefreshing] = useState(false);
  const pullStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const didVibrateRef = useRef(false);
  const pullContentRef = useRef<HTMLDivElement>(null);
  const setPullTransformRef = useRef<(dist: number, animate: boolean) => void>(() => { });
  const refreshStartRef = useRef(0);
  const pullSpinnerRef = useRef<HTMLDivElement>(null);
  const currentAssistantMsgRef = useRef<Message | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef<string>("main");
  const [isDemoMode, setIsDemoMode] = useState(false);
  const demoHandlerRef = useRef<ReturnType<typeof createDemoHandler> | null>(null);

  // Theme state (light/dark mode)
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    // Read initial theme from document (set by layout script before hydration)
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      document.documentElement.classList.toggle("dark", next === "dark");
      try { localStorage.setItem("theme", next); } catch { }
      return next;
    });
  }, []);

  // Backend mode: openclaw (WebSocket), lmstudio (HTTP+SSE), or demo
  const [backendMode, setBackendMode] = useState<BackendMode>("openclaw");
  const lmStudioConfigRef = useRef<LmStudioConfig | null>(null);
  const lmStudioHandlerRef = useRef<ReturnType<typeof createLmStudioHandler> | null>(null);

  // Track active run for streaming
  const activeRunIdRef = useRef<string | null>(null);
  const sendWSMessageRef = useRef<((message: WebSocketMessage) => boolean) | null>(null);
  const markEstablishedRef = useRef<(() => void) | null>(null);
  const gatewayTokenRef = useRef<string | null>(null);
  const connectNonceRef = useRef<string | null>(null);

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

  // ── WebSocket sub-handlers ─────────────────────────────────────────────────

  /** Send a typed message over the WebSocket (avoids double-cast). */
  const sendWS = useCallback((msg: { type: string;[key: string]: unknown }) => {
    sendWSMessageRef.current?.(msg as WebSocketMessage);
  }, []);

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
    if (modelsRequestedRef.current) return; // Avoid duplicate requests
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

    // Build device identity and signature
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

        // Detect gateway-injected messages (model="gateway-injected" or provider="openclaw" with that model)
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
    // Match by content text, not timestamp (server may use different timestamp)
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

    // If pull-to-refresh was active, bounce back after minimum duration
    if (refreshingRef.current) {
      const elapsed = Date.now() - refreshStartRef.current;
      const remaining = Math.max(0, 150 - elapsed);
      setTimeout(() => {
        requestAnimationFrame(() => {
          setPullTransformRef.current(0, true);
          setRefreshing(false);
        });
      }, remaining);
    }
  }, []);

  /** Handle chat events (delta/final/aborted/error). */
  const handleChatEvent = useCallback((payload: ChatEventPayload) => {
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
                // Chat delta contains CUMULATIVE text, not incremental delta.
                // Replace (don't append) since each chat delta has full text so far.
                const newText = typeof msg.content === "string"
                  ? msg.content
                  : getTextFromContent(msg.content);
                const nonTextParts = Array.isArray(existing.content)
                  ? existing.content.filter((p: ContentPart) => p.type !== "text")
                  : [];
                return {
                  ...existing,
                  content: [...nonTextParts, { type: "text" as const, text: newText }],
                  reasoning: msg.reasoning || existing.reasoning,
                };
              });
            }
            // Don't create new user messages from server events — they're added optimistically
            // on the client side with a different ID (u-${timestamp})
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

      case "final":
        notifyForRun(activeRunIdRef.current);
        setAwaitingResponse(false);
        setIsStreaming(false);
        setStreamingId(null);
        activeRunIdRef.current = null;
        thinkTagStateRef.current = { insideThinkTag: false, tagBuffer: "" };
        requestHistory();
        break;

      case "aborted":
        setAwaitingResponse(false);
        setIsStreaming(false);
        setStreamingId(null);
        activeRunIdRef.current = null;
        break;

      case "error":
        setAwaitingResponse(false);
        setConnectionError(payload.errorMessage || "Chat error");
        setIsStreaming(false);
        setStreamingId(null);
        activeRunIdRef.current = null;
        break;
    }
  }, [requestHistory, notifyForRun, beginContentArrival]);

  /** Handle agent events (lifecycle/content/reasoning/tool streams). */
  const handleAgentEvent = useCallback((payload: AgentEventPayload) => {
    if (payload.stream === "lifecycle") {
      const phase = payload.data.phase as string;
      if (phase === "start") {
        setIsStreaming(true);
        activeRunIdRef.current = payload.runId;
        thinkTagStateRef.current = { insideThinkTag: false, tagBuffer: "" };
      }
      return;
    }

    // NOTE: content and reasoning streams are NOT handled here.
    // Chat events provide cumulative text and reasoning - agent events would duplicate.

    if (payload.stream === "tool") {
      const phase = payload.data.phase as string;
      const toolName = payload.data.name as string;
      const toolCallId = payload.data.toolCallId as string | undefined;

      if (phase === "start" && toolName) {
        beginContentArrival();
        setMessages((prev: Message[]) => {
          const toolCallPart: ContentPart = {
            type: "tool_call",
            name: toolName,
            toolCallId,
            arguments: payload.data.args ? JSON.stringify(payload.data.args) : undefined,
            status: "running",
          };

          // Find existing message for this run
          const idx = prev.findIndex((m) => m.id === payload.runId);
          if (idx >= 0) {
            return updateAt(prev, idx, (target) => ({
              ...target,
              content: [...(Array.isArray(target.content) ? target.content : []), toolCallPart],
            }));
          }

          // Create new message if tool event arrives before content
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
                // Match by toolCallId if available, otherwise fall back to name + no result
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
  }, [appendReasoning, ensureStreamingMessage, beginContentArrival]);

  // ── Main WebSocket message dispatcher ─────────────────────────────────────

  const handleWSMessage = useCallback((data: WebSocketMessage) => {
    // WebSocketMessage is {type: string, [key: string]: unknown} — narrow to protocol types
    const msg = data as unknown as WSIncomingMessage;

    // Log ALL incoming WebSocket messages

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
      if (msg.id?.startsWith("run-")) return;
      if (msg.ok && msg.id?.startsWith("sessions-list-")) return;
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
  }, [handleConnectChallenge, handleHelloOk, handleHistoryResponse, handleChatEvent, handleAgentEvent]);

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
      setIsStreaming(false);
      setStreamingId(null);
    },
  });

  // Store callbacks in refs to avoid circular dependency with handleWSMessage
  useEffect(() => {
    sendWSMessageRef.current = sendWSMessage;
  }, [sendWSMessage]);
  useEffect(() => {
    markEstablishedRef.current = markEstablished;
  }, [markEstablished]);

  // Demo mode: detect ?demo URL param on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("demo")) {
      setIsDemoMode(true);
      setBackendMode("demo");
      setMessages(DEMO_HISTORY);
      setCurrentModel("demo/openclaw-preview");
      setShowSetup(false);
    }
  }, []);

  // Demo mode: create handler with callbacks
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
      onToolStart: (runId, name, args) => {
        setMessages((prev: Message[]) => updateMessageById(prev, runId, (target) => {
          const parts = Array.isArray(target.content) ? target.content : [];
          return { ...target, content: [...parts, { type: "tool_call" as const, name, arguments: args, status: "running" as const }] };
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
    };
    demoHandlerRef.current = createDemoHandler(callbacks);
  }, [isDemoMode]);

  // LM Studio mode: create handler with callbacks
  useEffect(() => {
    if (backendMode !== "lmstudio" || !lmStudioConfigRef.current) {
      lmStudioHandlerRef.current = null;
      return;
    }
    const config = lmStudioConfigRef.current;
    const callbacks: LmStudioCallbacks = {
      onStreamStart: (_runId) => {
        // isStreaming is already true (set in sendMessage)
        // Don't set streamingId yet — ThinkingIndicator shows while waiting for first content
      },
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
        // Persist LM Studio conversation to localStorage
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
    // Use currentModel so the handler is recreated when the model changes
    const activeConfig = { ...config, model: currentModel || config.model };
    lmStudioConfigRef.current = activeConfig;
    const handler = createLmStudioHandler(activeConfig, callbacks);
    lmStudioHandlerRef.current = handler;

    // Cleanup: stop any in-progress streams when handler is recreated
    return () => {
      handler.stop();
    };
  }, [backendMode, currentModel, beginContentArrival]);

  // Track scroll position — continuous CSS var for morph animation, React state for pointer-events phase.
  const handleScroll = useCallback(() => {
    if (scrollRafId.current != null) return;
    scrollRafId.current = requestAnimationFrame(() => {
      scrollRafId.current = null;
      const el = scrollRef.current;
      const morph = morphRef.current;
      if (!el || !morph) return;
      if (isPullingRef.current) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

      // During streaming, don't update pinning from scroll position —
      // only the wheel/touch handlers can unpin, and scrollToBottom re-pins.
      if (!isStreamingRef.current && !scrollGraceRef.current) {
        const wasPinned = pinnedToBottomRef.current;
        pinnedToBottomRef.current = distanceFromBottom < 80;
        if (wasPinned && !pinnedToBottomRef.current) {
          console.log(`[UNPIN] distanceFromBottom=${distanceFromBottom}, scrollHeight=${el.scrollHeight}, scrollTop=${Math.round(el.scrollTop)}`);
        }
      }

      // When streaming and pinned, lock morph to input mode (--sp = 0)
      // so programmatic scrollTop changes don't cause morph flicker.
      if (isStreamingRef.current && pinnedToBottomRef.current) {
        morph.style.setProperty("--sp", "0");
        if (scrollPhaseRef.current !== "input") {
          scrollPhaseRef.current = "input";
          setScrollPhase("input");
        }
        return;
      }

      const range = 60;
      const progress = Math.min(Math.max(distanceFromBottom / range, 0), 1);
      morph.style.setProperty("--sp", progress.toFixed(3));
      const newPhase: "input" | "pill" = progress > 0.4 ? "pill" : "input";
      if (newPhase !== scrollPhaseRef.current) {
        scrollPhaseRef.current = newPhase;
        setScrollPhase(newPhase);
      }
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    pinnedToBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Pull-to-refresh
  const PULL_THRESHOLD = 60;
  const refreshingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  refreshingRef.current = refreshing;

  const setPullTransform = useCallback((dist: number, animate: boolean) => {
    const wrapper = pullContentRef.current;
    const spinner = pullSpinnerRef.current;
    if (!wrapper) return;
    const transition = animate ? "transform 0.45s cubic-bezier(0.22, 0.68, 0.35, 1)" : "none";
    wrapper.style.transition = transition;
    wrapper.style.transform = dist > 0 ? `translateY(${-dist}px)` : "";
    // Spinner fades in as user pulls; animation only runs when visible
    if (spinner) {
      spinner.style.transition = animate ? "opacity 0.3s ease" : "none";
      spinner.style.opacity = dist > 0 ? String(Math.min(dist / (PULL_THRESHOLD * 0.5), 1)) : "0";
      const svg = spinner.querySelector("svg");
      if (svg) svg.style.animation = dist > 0 ? "spin 1s linear infinite" : "none";
    }
  }, []);
  setPullTransformRef.current = setPullTransform;

  const doRefresh = useCallback(() => {
    setRefreshing(true);
    refreshStartRef.current = Date.now();
    // Hold at a small offset to show spinner — bounce back happens when history arrives
    setPullTransform(40, true);
    // LM Studio and demo modes have no server-side history — just bounce back
    if (backendMode === "lmstudio" || backendMode === "demo") {
      setTimeout(() => {
        requestAnimationFrame(() => {
          setPullTransform(0, true);
          setRefreshing(false);
        });
      }, 300);
      return;
    }
    // Re-fetch history (OpenClaw)
    sendWS({
      type: "req",
      id: `history-${Date.now()}`,
      method: "chat.history",
      params: { sessionKey: sessionKeyRef.current },
    });
  }, [setPullTransform, backendMode]);

  // Pull-up-to-refresh touch handlers — direct DOM transforms, no React re-renders

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const isAtBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 5;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (isAtBottom()) {
        pullStartYRef.current = e.touches[0].clientY;
        isPullingRef.current = false;
        didVibrateRef.current = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (pullStartYRef.current === null || refreshingRef.current) return;
      if (!isAtBottom() && !isPullingRef.current) {
        pullStartYRef.current = null;
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
        return;
      }
      const deltaY = pullStartYRef.current - e.touches[0].clientY;
      if (deltaY > 0) {
        isPullingRef.current = true;
        // Heavy rubber band — 40% of raw movement, extra resistance past threshold
        const raw = deltaY * 0.4;
        const dist = raw < PULL_THRESHOLD
          ? raw
          : PULL_THRESHOLD + (raw - PULL_THRESHOLD) * 0.15;
        pullDistanceRef.current = dist;
        if (dist >= PULL_THRESHOLD && !didVibrateRef.current) {
          didVibrateRef.current = true;
          navigator.vibrate?.(10);
        }
        setPullTransform(dist, false);
        e.preventDefault();
      } else {
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
      }
    };

    const onTouchEnd = () => {
      if (pullStartYRef.current === null) return;
      pullStartYRef.current = null;
      const wasPulling = isPullingRef.current;
      const dist = pullDistanceRef.current;
      isPullingRef.current = false;
      pullDistanceRef.current = 0;

      if (wasPulling && dist >= PULL_THRESHOLD) {
        // Hold and refresh — bounce back happens when history response arrives
        doRefresh();
      } else {
        // Bounce back smoothly
        setPullTransform(0, true);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [doRefresh, setPullTransform]);

  // Unpin auto-scroll when user actively scrolls up (wheel or touch)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onTouchEnd = () => {
      // After touch ends, re-pin only if user ended up near the bottom
      if (isStreamingRef.current) {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (dist < 80) pinnedToBottomRef.current = true;
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && isStreamingRef.current) {
        pinnedToBottomRef.current = false;
      }
    };
    // On mobile, detect scroll-up by watching scroll direction during streaming.
    // We also check distanceFromBottom because layout shifts (e.g. markdown
    // table rendering) can transiently decrease scrollTop without any user
    // interaction — those shouldn't unpin.
    let lastScrollTop = el.scrollTop;
    const onScroll = () => {
      if (isStreamingRef.current && el.scrollTop < lastScrollTop - 3) {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (dist > 150) {
          pinnedToBottomRef.current = false;
        }
      }
      lastScrollTop = el.scrollTop;
    };
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  // iOS Safari height fix — visualViewport.height is the only value that
  // correctly shrinks when the virtual keyboard is open.  We also track the
  // keyboard offset so the fixed-position input bar stays above the keyboard.
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;

    // Lock the container to the initial full-screen height — never change it.
    // iOS reports smaller values when the keyboard opens, but resizing the
    // container is what causes the layout to break.
    if (appRef.current) {
      appRef.current.style.height = `${window.innerHeight}px`;
    }

    const onViewportResize = () => {
      if (!vv) return;
      const offset = Math.round(window.innerHeight - vv.height);
      // Move floating bar immediately via DOM — no React render delay
      if (floatingBarRef.current) {
        floatingBarRef.current.style.bottom = offset > 0 ? `${offset}px` : "0";
      }
      setKeyboardOffset((prev) => prev === offset ? prev : offset);
    };

    vv?.addEventListener("resize", onViewportResize);
    return () => {
      vv?.removeEventListener("resize", onViewportResize);
    };
  }, []);

  // When the keyboard opens, scroll messages to bottom (once)
  const prevKeyboardOffsetRef = useRef(0);
  useEffect(() => {
    const wasOpen = prevKeyboardOffsetRef.current > 0;
    const isOpen = keyboardOffset > 0;
    prevKeyboardOffsetRef.current = keyboardOffset;
    if (isOpen && !wasOpen) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [keyboardOffset]);

  // Check localStorage on mount for previously saved URL and token
  useEffect(() => {
    // Skip auto-connect in demo mode - check URL params directly to avoid race with state
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo")) {
      return;
    }
    if (isDemoMode) return;
    const savedMode = window.localStorage.getItem("mobileclaw-mode") as BackendMode | null;

    if (savedMode === "demo") {
      // Will be handled by the demo mode effect
      return;
    }

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
        // Restore previous LM Studio conversation from localStorage
        try {
          const saved = window.localStorage.getItem("lmstudio-messages");
          if (saved) {
            const parsed = JSON.parse(saved) as Message[];
            if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
          }
        } catch { }
      } else {
        setShowSetup(true);
      }
    } else {
      // OpenClaw mode — auto-connect if we have saved URL, otherwise show setup
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
      }
    }
  }, [connect, isDemoMode]);

  const handleConnect = useCallback((config: ConnectionConfig) => {
    setConnectionError(null);
    setMessages([]);
    resetThinkingState();
    window.localStorage.removeItem("lmstudio-messages");

    if (config.mode === "demo") {
      window.localStorage.setItem("mobileclaw-mode", "demo");
      window.localStorage.removeItem("openclaw-url");
      setBackendMode("demo");
      setIsDemoMode(true);
      setMessages(DEMO_HISTORY);
      setCurrentModel("demo/openclaw-preview");
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
      // Disconnect any existing WebSocket
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

  // const handleDisconnect = useCallback(() => {
  //   disconnect();
  //   lmStudioHandlerRef.current?.stop();
  //   lmStudioHandlerRef.current = null;
  //   lmStudioConfigRef.current = null;
  //   window.localStorage.removeItem("openclaw-url");
  //   window.localStorage.removeItem("openclaw-token");
  //   window.localStorage.removeItem("mobileclaw-mode");
  //   window.localStorage.removeItem("lmstudio-url");
  //   window.localStorage.removeItem("lmstudio-apikey");
  //   window.localStorage.removeItem("lmstudio-model");
  //   window.localStorage.removeItem("lmstudio-messages");
  //   setOpenclawUrl(null);
  //   setMessages([]);
  //   setIsStreaming(false);
  //   setStreamingId(null);
  //   setConnectionError(null);
  //   setBackendMode("openclaw");
  //   resetThinkingState();
  //   setAvailableModels([]);
  //   modelsRequestedRef.current = false;
  // }, [disconnect, resetThinkingState]);

  // Auto-scroll: whenever messages change (streaming delta, history load, user send),
  // snap to bottom if pinned. useLayoutEffect runs synchronously before paint, so
  // the scroll adjustment is invisible — no flicker, no fighting with user scroll.
  // Most streaming deltas don't change scrollHeight (only line-wraps do), so this
  // is usually a no-op: scrollTop already equals the max.
  const hasScrolledInitialRef = useRef(false);
  useLayoutEffect(() => {
    if (!pinnedToBottomRef.current || messages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    if (!hasScrolledInitialRef.current) {
      // First load — instant snap
      hasScrolledInitialRef.current = true;
      el.scrollTop = el.scrollHeight;
    } else {
      // Subsequent changes — snap instantly (no smooth scroll during streaming,
      // and for non-streaming changes the snap is imperceptible since it
      // runs before paint).
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // ResizeObserver: catch content-height changes that don't come from a `messages`
  // state update — e.g. when StreamingText's typewriter reveals enough text for
  // MarkdownContent to switch from raw text to a rendered table/code-block, the
  // content height jumps but `messages` hasn't changed so the useLayoutEffect above
  // doesn't fire. This observer fills that gap.
  //
  // The grace period (scrollGraceRef, set synchronously in setIsStreaming) covers
  // the streaming→idle transition: StreamingText snaps remaining text, which can
  // cause a large height jump. Without it, handleScroll would unpin immediately.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Observe the inner content wrapper (first child of the scroll container)
    const content = el.firstElementChild;
    if (!content) return;

    const ro = new ResizeObserver(() => {
      if ((pinnedToBottomRef.current || scrollGraceRef.current) && el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
        // Re-pin so handleScroll doesn't undo us
        pinnedToBottomRef.current = true;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const sendMessage = useCallback((text: string) => {
    // Request notification permission on first user interaction (no-op if already granted/denied)
    requestNotificationPermission();

    // Re-pin to bottom so auto-scroll kicks in for the new user message
    pinnedToBottomRef.current = true;

    const userMsg: Message = { role: "user", content: [{ type: "text", text }], id: `u-${Date.now()}`, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    // Demo mode — route through local handler
    if (isDemoMode || backendMode === "demo") {
      demoHandlerRef.current?.sendMessage(text);
      return;
    }

    // LM Studio mode — route through HTTP+SSE handler
    if (backendMode === "lmstudio") {
      // Show "Thinking..." immediately while waiting for server response
      setAwaitingResponse(true);
      setThinkingStartTime(Date.now());
      // Send the full conversation history (including the new user message) to LM Studio
      setMessages((prev) => {
        // Persist conversation (including new user message) before sending
        try { window.localStorage.setItem("lmstudio-messages", JSON.stringify(prev)); } catch { }
        // Use double-RAF to ensure browser paints "Thinking..." before fetch starts
        // First RAF schedules for next frame, second RAF runs after that frame paints
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

    // Show "Thinking..." immediately
    setAwaitingResponse(true);
    setThinkingStartTime(Date.now());

    // Generate idempotency key for this run
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRunIdRef.current = runId;

    const requestMsg = {
      type: "req",
      id: runId,
      method: "chat.send",
      params: {
        sessionKey: sessionKeyRef.current,
        message: text,
        deliver: true,
        idempotencyKey: runId,
      },
    };
    sendWS(requestMsg);

    setIsStreaming(true);
  }, [isConnected, isDemoMode, backendMode, sendWS]);

  const handleCommandSelect = useCallback((command: string) => {
    setPendingCommand(command);
  }, []);

  const clearPendingCommand = useCallback(() => {
    setPendingCommand(null);
  }, []);


  return (
    <div ref={appRef} className="relative flex flex-col overflow-hidden bg-background" style={{ height: "100dvh" }}>
      {/* Setup dialog */}
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

      {/* Command sheet rendered at root level so backdrop covers entire screen */}
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

      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl md:px-6">
        <button
          type="button"
          onClick={() => setShowSetup(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-accent active:bg-accent"
          aria-label="Open settings"
        >
          <img src="/logo.png" alt="MobileClaw" className="h-7 mix-blend-multiply dark:mix-blend-screen dark:invert" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-sm font-semibold text-foreground">MobileClaw</h1>
          {currentModel && (
            <p className="truncate text-[11px] text-muted-foreground">{currentModel}</p>
          )}
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-accent active:bg-accent"
          aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        >
          {theme === "light" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          )}
        </button>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <div className="flex items-center gap-1.5">
            {isDemoMode || backendMode === "demo" ? (
              <>
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-[11px] text-muted-foreground">Demo</span>
              </>
            ) : backendMode === "lmstudio" ? (
              <>
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-[11px] text-muted-foreground">LM Studio</span>
              </>
            ) : (
              <>
                <span className={`h-2 w-2 rounded-full ${connectionState === "connected"
                  ? "bg-green-500"
                  : connectionState === "connecting"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-red-500"
                  }`} />
                <span className="text-[11px] text-muted-foreground">
                  {connectionState === "connected"
                    ? "Connected"
                    : connectionState === "connecting"
                      ? "Connecting..."
                      : "Disconnected"}
                </span>
              </>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground/60 font-mono">{process.env.NEXT_PUBLIC_GIT_SHA}</span>
        </div>
      </header>

      <div ref={pullContentRef} className="flex flex-1 flex-col min-h-0">
        <main
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{ overscrollBehavior: "none" }}
        >
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6 pb-28 md:px-6 md:py-4 md:pb-28">
            {messages.map((msg, idx) => {
              const side = getMessageSide(msg.role);
              const prevSide = idx > 0 ? getMessageSide(messages[idx - 1].role) : null;
              const prevTimestamp = idx > 0 ? messages[idx - 1].timestamp : null;
              const isNewTurn = side !== "center" && side !== prevSide;
              const timGap = msg.timestamp && prevTimestamp ? msg.timestamp - prevTimestamp : 0;
              const isTimeGap = timGap > 10 * 60 * 1000;
              const showTimestamp = side !== "center" && (isNewTurn || isTimeGap);
              // Don't render the streaming message at all while ThinkingIndicator is dissolving
              const isHiddenDuringExit = thinkingExiting && msg.id === streamingId;
              if (isHiddenDuringExit) {
                return null;
              }

              // Apply fade-in animation when message is first revealed after exit
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
                      {msg.role === "assistant" && msg.thinkingDuration && msg.thinkingDuration > 0 && (
                        <span className="ml-1">· {msg.thinkingDuration}s</span>
                      )}
                    </p>
                  )}
                  <div className={fadeInClass}>
                    <MessageRow message={msg} isStreaming={isStreaming && msg.id === streamingId} />
                  </div>
                </React.Fragment>
              );
            })}
            {showThinkingIndicator && <ThinkingIndicator isExiting={thinkingExiting} onExitComplete={onThinkingExitComplete} startTime={thinkingStartTime ?? undefined} />}
            <div ref={bottomRef} />
          </div>
        </main>
        {/* Pull-to-refresh spinner — inside pullContentRef so it translates up with the content.
          h-0 + overflow-visible: no layout space, renders upward into the revealed gap. */}
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

      {/* Floating morphing bar -- driven by continuous scrollProgress (0=bottom, 1=scrolled) */}
      <div
        ref={floatingBarRef}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[3dvh] md:px-6 md:pb-[3dvh]"
      >
        <div ref={morphRef} className="pointer-events-auto w-full" style={{ maxWidth: "min(calc(200px + (100% - 200px) * (1 - var(--sp, 0))), 42rem)" } as React.CSSProperties}>
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
