"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

import { createLmStudioHandler, type LmStudioConfig } from "@/lib/lmStudio";
import { notifyMessageComplete } from "@/lib/notifications";
import { getTextFromContent, updateAt } from "@/lib/messageUtils";
import {
  NO_REPLY_MARKER,
  STOP_REASON_INJECTED,
  hasHeartbeatOnOwnLine,
  hasUnquotedMarker,
} from "@/lib/constants";
import { postScrollPosition, type BridgeMessage } from "@/lib/nativeBridge";
import {
  appendContentDelta as appendContentDeltaToMessages,
  appendThinkingDelta as appendThinkingDeltaToMessages,
  addToolCall as addToolCallToMessages,
  mountPluginPart as mountPluginPartInMessages,
  removePluginPart as removePluginPartInMessages,
  replacePluginPart as replacePluginPartInMessages,
  resolveToolCall as resolveToolCallInMessages,
  startThinkingBlock as startThinkingBlockInMessages,
  upsertCanvasPluginByMessageId as upsertCanvasPluginByMessageIdInMessages,
} from "@/lib/chat/streamMutations";
import { buildDisplayMessages } from "@/lib/chat/messageTransforms";
import { applyNativeZenMode } from "@/lib/chat/zenBridge";

import type {
  BackendMode,
  CanvasPayload,
  ConnectionConfig,
  Message,
  ModelChoice,
  PluginContentPart,
} from "@/types/chat";

import type { Command } from "@/components/CommandSheet";
import { type ChatInputHandle } from "@/components/ChatInput";
import { TurnstileGate } from "@/components/TurnstileGate";
import { ChatChrome } from "@/components/chat/ChatChrome";
import { ChatViewport } from "@/components/chat/ChatViewport";
import { ChatComposerBar } from "@/components/chat/ChatComposerBar";

import { useThinkingState } from "@/hooks/useThinkingState";
import { PIN_LOCK_MS, useScrollManager } from "@/hooks/useScrollManager";
import { useKeyboardLayout } from "@/hooks/useKeyboardLayout";
import { useTheme } from "@/hooks/useTheme";
import { useZenMode } from "@/hooks/useZenMode";
import { useSubagentStore } from "@/hooks/useSubagentStore";
import { formatSessionName } from "@/hooks/useSessionSwitcher";
import { useAppMode } from "@/hooks/useAppMode";

import { useModeBootstrap } from "@/hooks/chat/useModeBootstrap";
import { useOpenClawRuntime } from "@/hooks/chat/useOpenClawRuntime";
import { useQuoteSelection } from "@/hooks/chat/useQuoteSelection";
import { useQueuedMessage } from "@/hooks/chat/useQueuedMessage";
import { useUnreadTabIndicator } from "@/hooks/chat/useUnreadTabIndicator";
import { useNativeBridgeMessage } from "@/hooks/chat/useNativeBridgeMessage";
import { useDemoRuntime } from "@/hooks/chat/useDemoRuntime";
import { useLmStudioRuntime } from "@/hooks/chat/useLmStudioRuntime";
import { useMessageSender } from "@/hooks/chat/useMessageSender";
import { appendPluginActionPayloadToUrl, mergePluginActionPayload } from "@/lib/plugins/actionPayload";
import type { PluginActionInvocation } from "@/lib/plugins/types";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;
const ZEN_TOGGLE_PIN_MS = 700;
const ZEN_BOTTOM_THRESHOLD_PX = 12;

// Bottom padding for the message list to clear the fixed composer bar.
// Non-detached uses calc(svh + rem) so clearance scales with the composer's
// own dvh-based sizing across device sizes.
const BOTTOM_PAD_SVH = 4.5;
const BOTTOM_PAD_BASE_REM = 7.5;
const BOTTOM_PAD_QUEUED_REM = 10.5;
const BOTTOM_PAD_PINNED_REM = 13.5;
// Detached mode has a separate spacer, so fixed rem is sufficient.
const BOTTOM_PAD_DETACHED_BASE = "4rem";
const BOTTOM_PAD_DETACHED_QUEUED = "7rem";
const BOTTOM_PAD_DETACHED_PINNED = "10rem";
const BOTTOM_PAD_NATIVE = "8rem";

export default function Home() {
  const [openclawUrl, setOpenclawUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, _setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [sentAnimId, setSentAnimId] = useState<string | null>(null);
  const { isDetached, detachedNoBorder, isNative, uploadDisabled, hideChrome, isDetachedRef, isNativeRef } = useAppMode();

  const {
    scrollRef,
    bottomRef,
    morphRef,
    scrollPhase,
    pinnedToBottomRef,
    pinLockUntilRef,
    handleScroll,
    scrollToBottom,
    updateGraceForStreamingChange,
  } = useScrollManager(messages, isStreamingRef, isNativeRef);

  const setIsStreaming = useCallback((value: boolean) => {
    const wasStreaming = isStreamingRef.current;
    isStreamingRef.current = value;
    updateGraceForStreamingChange(wasStreaming, value);
    _setIsStreaming(value);
  }, [updateGraceForStreamingChange]);

  const {
    awaitingResponse,
    setAwaitingResponse,
    thinkingStartTime,
    setThinkingStartTime,
    beginContentArrival,
    resetThinkingState,
  } = useThinkingState(streamingId, messages, setMessages);

  const [showSetup, setShowSetup] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [, setServerInfo] = useState<Record<string, unknown> | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelChoice[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [serverCommands, setServerCommands] = useState<Command[]>([]);
  const appRef = useRef<HTMLDivElement>(null);
  const floatingBarRef = useRef<HTMLDivElement>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [, setIsInitialConnecting] = useState(false);

  const { theme, toggleTheme } = useTheme();
  const { zenMode, toggleZenMode } = useZenMode();
  const zenPinRafRef = useRef<number | null>(null);

  const subagentStore = useSubagentStore();
  const [pinnedSubagent, setPinnedSubagent] = useState<{
    toolCallId: string | null;
    childSessionKey: string | null;
    taskName: string;
    model: string | null;
  } | null>(null);

  useEffect(() => {
    if (isNativeRef.current) return;
    try {
      const saved = sessionStorage.getItem("pinned-subagent");
      if (saved) {
        const parsed = JSON.parse(saved) as {
          toolCallId?: string | null;
          childSessionKey?: string | null;
          taskName?: string;
          model?: string | null;
        };
        if (typeof parsed.taskName === "string") {
          setPinnedSubagent({
            toolCallId: parsed.toolCallId ?? null,
            childSessionKey: parsed.childSessionKey ?? null,
            taskName: parsed.taskName,
            model: parsed.model ?? null,
          });
        }
      }
    } catch {}
  }, []);

  const handlePinSubagent = useCallback((info: { toolCallId: string | null; childSessionKey: string | null; taskName: string; model: string | null }) => {
    setPinnedSubagent((prev) => {
      if (prev?.toolCallId && prev.toolCallId === info.toolCallId) {
        try { sessionStorage.removeItem("pinned-subagent"); } catch {}
        return null;
      }
      try { sessionStorage.setItem("pinned-subagent", JSON.stringify(info)); } catch {}
      return info;
    });
  }, []);

  const handleUnpinSubagent = useCallback(() => {
    setPinnedSubagent(null);
    try { sessionStorage.removeItem("pinned-subagent"); } catch {}
  }, []);

  const handleToggleZenMode = useCallback(() => {
    const el = scrollRef.current;
    const distanceFromBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight : Infinity;
    const wasPinnedAtBottom = !!el && distanceFromBottom <= ZEN_BOTTOM_THRESHOLD_PX;

    if (zenPinRafRef.current != null) {
      cancelAnimationFrame(zenPinRafRef.current);
      zenPinRafRef.current = null;
    }

    if (wasPinnedAtBottom && el) {
      pinnedToBottomRef.current = true;
      pinLockUntilRef.current = Date.now() + PIN_LOCK_MS + ZEN_TOGGLE_PIN_MS;
      el.scrollTop = el.scrollHeight;
    }

    toggleZenMode();

    if (!wasPinnedAtBottom) return;
    const endAt = performance.now() + ZEN_TOGGLE_PIN_MS;
    const pinTick = () => {
      const node = scrollRef.current;
      if (!node) return;
      node.scrollTop = node.scrollHeight;
      if (performance.now() < endAt) {
        zenPinRafRef.current = requestAnimationFrame(pinTick);
      } else {
        zenPinRafRef.current = null;
      }
    };
    zenPinRafRef.current = requestAnimationFrame(pinTick);
  }, [pinLockUntilRef, pinnedToBottomRef, scrollRef, toggleZenMode, zenPinRafRef]);

  useEffect(() => {
    return () => {
      if (zenPinRafRef.current != null) {
        cancelAnimationFrame(zenPinRafRef.current);
      }
    };
  }, []);

  const setZenModeEnabled = useCallback((enabled: boolean) => {
    applyNativeZenMode({ enabled, current: zenMode, toggle: handleToggleZenMode });
  }, [handleToggleZenMode, zenMode]);

  const [backendMode, setBackendMode] = useState<BackendMode>("openclaw");
  const lmStudioConfigRef = useRef<LmStudioConfig | null>(null);
  const lmStudioHandlerRef = useRef<ReturnType<typeof createLmStudioHandler> | null>(null);

  const runStartTsRef = useRef<number>(0);
  const lastRunDurationRef = useRef<number>(0);
  const markRunStart = useCallback(() => {
    runStartTsRef.current = Date.now();
    lastRunDurationRef.current = 0;
  }, []);
  const markRunEnd = useCallback((): number => {
    const start = runStartTsRef.current;
    if (!start) {
      const cached = lastRunDurationRef.current;
      lastRunDurationRef.current = 0;
      return cached;
    }
    const duration = Math.round((Date.now() - start) / 1000);
    runStartTsRef.current = 0;
    lastRunDurationRef.current = duration;
    return duration;
  }, []);

  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const notifyForRun = useCallback((runId: string | null) => {
    if (isDetachedRef.current) return;
    const msg = messagesRef.current.find((m) => m.id === runId && m.role === "assistant");
    if (!msg) return;
    if (msg.isCommandResponse || msg.stopReason === STOP_REASON_INJECTED) return;
    const preview = getTextFromContent(msg.content);
    if (hasHeartbeatOnOwnLine(preview) || hasUnquotedMarker(preview, NO_REPLY_MARKER)) return;
    notifyMessageComplete(preview);
  }, []);

  const [turnstileVerified, setTurnstileVerified] = useState(!TURNSTILE_SITE_KEY);
  const [turnstileChecked, setTurnstileChecked] = useState(!TURNSTILE_SITE_KEY);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    try {
      if (sessionStorage.getItem("turnstile-verified") === "1") setTurnstileVerified(true);
    } catch {}
    setTurnstileChecked(true);
  }, []);

  useKeyboardLayout(appRef, floatingBarRef, bottomRef, !isNative);

  const appendContentDelta = useCallback((runId: string, delta: string, ts: number) => {
    beginContentArrival();
    setMessages((prev) => {
      const next = appendContentDeltaToMessages(prev, runId, delta, ts);
      if (next.created) setStreamingId(runId);
      return next.messages;
    });
  }, [beginContentArrival]);

  const appendThinkingDelta = useCallback((runId: string, delta: string, ts: number) => {
    beginContentArrival();
    setMessages((prev) => {
      const next = appendThinkingDeltaToMessages(prev, runId, delta, ts);
      if (next.created) setStreamingId(runId);
      return next.messages;
    });
  }, [beginContentArrival]);

  const startThinkingBlock = useCallback((runId: string, ts: number) => {
    beginContentArrival();
    setMessages((prev) => {
      const next = startThinkingBlockInMessages(prev, runId, ts);
      if (next.created) setStreamingId(runId);
      return next.messages;
    });
  }, [beginContentArrival]);

  const addToolCall = useCallback((runId: string, name: string, ts: number, toolCallId?: string, args?: string) => {
    beginContentArrival();
    setMessages((prev) => {
      const next = addToolCallToMessages(prev, runId, name, ts, toolCallId, args);
      if (next.created) setStreamingId(runId);
      return next.messages;
    });
  }, [beginContentArrival]);

  const resolveToolCall = useCallback((runId: string, name: string, toolCallId?: string, result?: string, isError?: boolean) => {
    setMessages((prev) => resolveToolCallInMessages(prev, runId, name, toolCallId, result, isError));
  }, []);

  const mountPluginPart = useCallback((runId: string, part: PluginContentPart, ts: number, index?: number) => {
    beginContentArrival();
    setMessages((prev) => {
      const next = mountPluginPartInMessages(prev, runId, part, ts, index);
      if (next.created) setStreamingId(runId);
      return next.messages;
    });
  }, [beginContentArrival]);

  const replacePluginPart = useCallback((runId: string, partId: string, next: Pick<PluginContentPart, "state" | "data" | "revision">) => {
    setMessages((prev) => replacePluginPartInMessages(prev, runId, partId, next));
  }, []);

  const removePluginPart = useCallback((runId: string, partId: string, tombstone?: boolean) => {
    setMessages((prev) => removePluginPartInMessages(prev, runId, partId, tombstone));
  }, []);

  const upsertCanvasPluginByMessageId = useCallback((messageId: string, canvas: CanvasPayload) => {
    setMessages((prev) => upsertCanvasPluginByMessageIdInMessages(prev, messageId, canvas));
  }, []);

  const applyRunDuration = useCallback((runId: string, runDuration: number) => {
    if (runDuration <= 0) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === runId);
      const resolvedIdx = idx >= 0 ? idx : prev.findLastIndex((m) => m.role === "assistant" && !m.runDuration);
      if (resolvedIdx < 0) return prev;
      return updateAt(prev, resolvedIdx, (m) => ({ ...m, runDuration }));
    });
  }, []);

  const queuedMessageForRuntimeRef = useRef<{ text: string; attachments?: unknown[] } | null>(null);

  const {
    connectionState,
    connect,
    disconnect,
    isConnected,
    sendWS,
    fetchModels,
    requestHistory,
    requestSessionsList,
    cancelCommandFetch,
    sessionKeyRef,
    activeRunIdRef,
    gatewayTokenRef,
    sessions,
    sessionsLoading,
    currentSessionKey,
    sessionSwitching,
    isSessionSheetOpen,
    openSessionSheet,
    closeSessionSheet,
    handleSessionSelect,
    pullContentRef,
    pullSpinnerRef,
  } = useOpenClawRuntime({
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
    setIsInitialConnecting,
    onHistoryLoaded: scrollToBottom,
    beginContentArrival,
    setThinkingStartTime,
    markRunStart,
    markRunEnd,
    notifyForRun,
    handleUnpinSubagent,
    queuedMessageRef: queuedMessageForRuntimeRef,
    subagentStore,
    appendContentDelta,
    appendThinkingDelta,
    startThinkingBlock,
    addToolCall,
    resolveToolCall,
    mountPluginPart,
    replacePluginPart,
    removePluginPart,
    upsertCanvasPluginByMessageId,
  });

  const { quoteText, setQuoteText, quotePopup, quotePopupRef, handleAcceptQuote } = useQuoteSelection({ scrollRef });

  // Use refs so the bridge handler can call these without circular deps.
  const handleConnectRef = useRef<(config: ConnectionConfig) => void>(() => {});
  const nativeSendRef = useRef<(text: string) => void>(() => {});
  const nativeAbortRef = useRef<() => void>(() => {});
  const nativeSessionSelectRef = useRef<(key: string) => void>(() => {});
  const nativeRequestHistoryRef = useRef<() => void>(() => {});
  const nativeRequestSessionsListRef = useRef<() => void>(() => {});

  const handleNativeBridgeMessage = useNativeBridgeMessage({
    setMessages,
    pinnedToBottomRef,
    pinLockUntilRef,
    setZenModeEnabled,
    scrollToBottom,
    handleConnect: useCallback((config: ConnectionConfig) => handleConnectRef.current(config), []),
    onNativeSend: useCallback((text: string) => nativeSendRef.current(text), []),
    onNativeAbort: useCallback(() => nativeAbortRef.current(), []),
    onNativeSessionSelect: useCallback((key: string) => nativeSessionSelectRef.current(key), []),
    onNativeRequestHistory: useCallback(() => nativeRequestHistoryRef.current(), []),
    onNativeRequestSessionsList: useCallback(() => nativeRequestSessionsListRef.current(), []),
  });

  const { handleConnect } = useModeBootstrap({
    isDemoMode,
    connect,
    disconnect,
    handleNativeBridgeMessage: handleNativeBridgeMessage as (msg: BridgeMessage) => void,
    resetThinkingState,
    gatewayTokenRef,
    lmStudioConfigRef,
    lmStudioHandlerRef,
    setOpenclawUrl,
    setMessages,
    setConnectionError,
    setCurrentModel,
    setBackendMode,
    setIsDemoMode,
    setShowSetup,
    setHistoryLoaded,
    setIsInitialConnecting,
    setServerCommands,
    isDetachedRef,
    isNativeRef,
  });

  // Keep the ref fresh so bridge messages can call handleConnect
  handleConnectRef.current = handleConnect;

  const { demoHandlerRef } = useDemoRuntime({
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
    notifyForRun: (runId) => notifyForRun(runId),
    applyRunDuration,
    subagentStore,
  });

  useLmStudioRuntime({
    backendMode,
    currentModel,
    lmStudioConfigRef,
    lmStudioHandlerRef,
    beginContentArrival,
    notifyForRun: (runId) => notifyForRun(runId),
    setMessages,
    setStreamingId,
    setAwaitingResponse,
    setIsStreaming,
    setConnectionError,
  });

  const { lastCommand, sendMessage } = useMessageSender({
    backendMode,
    isDemoMode,
    isConnected,
    sendWS,
    sessionKeyRef,
    activeRunIdRef,
    isDetachedRef,
    pinnedToBottomRef,
    pinLockUntilRef,
    demoHandlerRef,
    lmStudioHandlerRef,
    setMessages,
    setSentAnimId,
    setAwaitingResponse,
    setThinkingStartTime,
    setIsStreaming,
    cancelCommandFetch,
  });

  const isRunActive = awaitingResponse || isStreaming;
  const chatInputRef = useRef<ChatInputHandle | null>(null);

  const {
    queuedMessage,
    handleSendOrQueue,
    clearQueuedToInput,
    markAbortHandled,
  } = useQueuedMessage({
    isRunActive,
    sendMessage,
    onRestoreText: (text) => chatInputRef.current?.setValue(text),
  });

  queuedMessageForRuntimeRef.current = queuedMessage
    ? { text: queuedMessage.text, attachments: queuedMessage.attachments as unknown[] | undefined }
    : null;

  const thinkingLabel = isRunActive && lastCommand === "/compact" ? "Compacting" : undefined;

  useEffect(() => {
    const save = () => {
      try { sessionStorage.setItem("mc-run-active", isRunActive ? "1" : "0"); } catch {}
    };
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, [isRunActive]);

  // Post run state to native shell
  useEffect(() => {
    if (!isNativeRef.current) return;
    void import("@/lib/nativeBridge").then(({ postRunState }) => {
      postRunState(isRunActive, isStreaming);
    });
  }, [isRunActive, isStreaming, isNativeRef]);

  // Post model state to native shell
  useEffect(() => {
    if (!isNativeRef.current) return;
    void import("@/lib/nativeBridge").then(({ postModelState }) => {
      postModelState(currentModel);
    });
  }, [currentModel, isNativeRef]);

  const { hasUnreadTabMessage } = useUnreadTabIndicator({
    messages,
    historyLoaded,
    isDetached,
    isRunActive,
    lastCommand,
  });
  void hasUnreadTabMessage;

  const handleAbort = useCallback(() => {
    markAbortHandled();

    if (backendMode === "lmstudio") {
      lmStudioHandlerRef.current?.stop();
    } else if (backendMode === "demo") {
      demoHandlerRef.current?.stop();
    } else {
      sendWS({
        type: "req",
        id: `abort-${Date.now()}`,
        method: "chat.abort",
        params: {
          sessionKey: sessionKeyRef.current,
          runId: activeRunIdRef.current || undefined,
        },
      });
    }

    setAwaitingResponse(false);
    setIsStreaming(false);
    setStreamingId(null);
    activeRunIdRef.current = null;
    setMessages((prev) => [...prev, {
      role: "system",
      content: [{ type: "text", text: "Interrupted" }],
      id: `interrupted-${Date.now()}`,
      timestamp: Date.now(),
      isError: true,
    } as Message]);
  }, [
    activeRunIdRef,
    backendMode,
    demoHandlerRef,
    markAbortHandled,
    sendWS,
    sessionKeyRef,
    setAwaitingResponse,
    setIsStreaming,
  ]);

  // Keep native bridge refs fresh
  nativeSendRef.current = handleSendOrQueue;
  nativeAbortRef.current = handleAbort;
  nativeSessionSelectRef.current = handleSessionSelect;
  nativeRequestHistoryRef.current = () => {
    void requestHistory();
  };
  nativeRequestSessionsListRef.current = () => {
    requestSessionsList();
  };

  const displayMessages = useMemo(() => buildDisplayMessages(messages), [messages]);

  const handlePluginAction = useCallback(async (invocation: PluginActionInvocation) => {
    const { action } = invocation;
    const payload = mergePluginActionPayload(
      action.request.kind === "http" ? action.request.body : action.request.params,
      invocation,
    );

    if (backendMode === "demo") {
      if (!demoHandlerRef.current?.invokePluginAction) {
        throw new Error("Demo handler is unavailable.");
      }
      await demoHandlerRef.current.invokePluginAction({ ...invocation, input: payload });
      return;
    }

    if (action.request.kind === "http") {
      const headers: HeadersInit = action.request.method === "GET"
        ? { ...(action.request.headers || {}) }
        : {
            "Content-Type": "application/json",
            ...(action.request.headers || {}),
          };
      const url = action.request.method === "GET"
        ? appendPluginActionPayloadToUrl(action.request.url, payload)
        : action.request.url;
      const request = fetch(url, {
        method: action.request.method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: action.request.method === "GET" ? undefined : JSON.stringify(payload),
      });
      if (action.request.fireAndForget) {
        void request
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Request failed (${response.status})`);
            }
          })
          .catch(() => {});
        return;
      }
      const response = await request;
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      return;
    }

    const ok = sendWS({
      type: "req",
      id: `plugin-action-${Date.now()}`,
      method: action.request.method,
      params: payload,
    });
    if (!ok) {
      throw new Error("Not connected");
    }
  }, [backendMode, demoHandlerRef, sendWS]);

  const currentSessionName = useMemo(() => {
    const current = sessions.find((session) => session.key === currentSessionKey);
    if (current) return formatSessionName(current);
    if (currentSessionKey === "main") return "Main Session";
    return currentSessionKey;
  }, [sessions, currentSessionKey]);

  const prevMsgIdsRef = useRef<Set<string>>(new Set());
  const historyWasLoadedRef = useRef(false);
  const stableFadeInIdsRef = useRef<Set<string>>(new Set());
  // Compute on every render so prevMsgIdsRef stays current (IDs are "new" for
  // exactly one render cycle).  Stabilize the Set identity so ChatViewport
  // only re-renders when the actual contents change.
  const currentMsgIds = new Set(displayMessages.map((m) => m.id).filter(Boolean) as string[]);
  const nextFadeInIds = new Set<string>();
  if (historyLoaded && historyWasLoadedRef.current) {
    for (const id of currentMsgIds) {
      if (!prevMsgIdsRef.current.has(id)) nextFadeInIds.add(id);
    }
  }
  prevMsgIdsRef.current = currentMsgIds;
  historyWasLoadedRef.current = historyLoaded;
  const prevFade = stableFadeInIdsRef.current;
  if (nextFadeInIds.size !== prevFade.size || [...nextFadeInIds].some((id) => !prevFade.has(id))) {
    stableFadeInIdsRef.current = nextFadeInIds;
  }
  const fadeInIds = stableFadeInIdsRef.current;

  const inputZoneHeight = "calc(1.5dvh + 3.5rem)";
  const bottomPad = isNative
    ? BOTTOM_PAD_NATIVE
    : pinnedSubagent
      ? (isDetached ? BOTTOM_PAD_DETACHED_PINNED : `calc(${BOTTOM_PAD_SVH}svh + ${BOTTOM_PAD_PINNED_REM}rem)`)
      : queuedMessage
        ? (isDetached ? BOTTOM_PAD_DETACHED_QUEUED : `calc(${BOTTOM_PAD_SVH}svh + ${BOTTOM_PAD_QUEUED_REM}rem)`)
        : (isDetached ? BOTTOM_PAD_DETACHED_BASE : `calc(${BOTTOM_PAD_SVH}svh + ${BOTTOM_PAD_BASE_REM}rem)`);

  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && !messages[i].isContext) {
        return getTextFromContent(messages[i].content);
      }
    }
    return "";
  }, [messages]);

  if (!turnstileChecked) return null;
  if (!turnstileVerified && TURNSTILE_SITE_KEY) {
    return (
      <TurnstileGate
        siteKey={TURNSTILE_SITE_KEY}
        onVerified={() => {
          try { sessionStorage.setItem("turnstile-verified", "1"); } catch {}
          setTurnstileVerified(true);
        }}
      />
    );
  }

  return (
    <div ref={appRef} className={`relative flex flex-col overflow-hidden ${hideChrome ? "" : "bg-background"}`} style={{ height: "100dvh" }}>
      <ChatChrome
        hideChrome={hideChrome}
        openclawUrl={openclawUrl}
        isDemoMode={isDemoMode}
        backendMode={backendMode}
        showSetup={showSetup}
        connectionError={connectionError}
        onSetupConnect={(config: ConnectionConfig) => {
          setShowSetup(false);
          handleConnect(config);
        }}
        onCloseSetup={() => setShowSetup(false)}
        onOpenSetup={() => {
          if (!historyLoaded && connectionState !== "disconnected") {
            disconnect();
          }
          setShowSetup(true);
        }}
        currentModel={currentModel}
        theme={theme}
        toggleTheme={toggleTheme}
        zenMode={zenMode}
        toggleZenMode={handleToggleZenMode}
        connectionState={connectionState}
        sessionName={currentSessionName}
        onSessionPillClick={openSessionSheet}
        sessionSwitching={sessionSwitching}
        isSessionSheetOpen={isSessionSheetOpen}
        onCloseSessionSheet={closeSessionSheet}
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        currentSessionKey={currentSessionKey}
        onSessionSelect={handleSessionSelect}
      />

      <ChatViewport
        isDetached={isDetached}
        detachedNoBorder={detachedNoBorder}
        isNative={isNative}
        historyLoaded={historyLoaded}
        inputZoneHeight={inputZoneHeight}
        bottomPad={bottomPad}
        scrollRef={scrollRef}
        bottomRef={bottomRef}
        pullContentRef={pullContentRef}
        pullSpinnerRef={pullSpinnerRef}
        onScroll={handleScroll}
        onNativeScrollPosition={isNativeRef.current ? postScrollPosition : undefined}
        displayMessages={displayMessages}
        sentAnimId={sentAnimId}
        onSentAnimationEnd={() => setSentAnimId(null)}
        fadeInIds={fadeInIds}
        isStreaming={isStreaming}
        streamingId={streamingId}
        subagentStore={subagentStore}
        pinnedToolCallId={pinnedSubagent?.toolCallId ?? null}
        onPin={handlePinSubagent}
        onUnpin={handleUnpinSubagent}
        zenMode={zenMode}
        isRunActive={isRunActive}
        thinkingStartTime={thinkingStartTime}
        thinkingLabel={thinkingLabel}
        quotePopup={quotePopup}
        quotePopupRef={quotePopupRef}
        onAcceptQuote={handleAcceptQuote}
        onPluginAction={handlePluginAction}
      />

      {!historyLoaded && (
        <div
          className={`flex flex-col items-center justify-center bg-background ${isDetached ? "absolute inset-0 z-50" : "absolute inset-x-0 bottom-0 z-40"}`}
          style={!isDetached ? { top: "var(--header-h, 3.5rem)" } : undefined}
        >
          <div style={{ animation: "fadeIn 300ms ease-out 400ms both" }} className="flex flex-col items-center">
            <svg className="mb-4 h-8 w-8 text-muted-foreground" style={{ animation: "spin 1s linear infinite" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
            <span className="text-sm text-muted-foreground">Starting up…</span>
          </div>
        </div>
      )}

      <ChatComposerBar
        isNative={isNative}
        isDetached={isDetached}
        floatingBarRef={floatingBarRef}
        morphRef={morphRef}
        pinnedSubagent={pinnedSubagent}
        subagentStore={subagentStore}
        onUnpinSubagent={handleUnpinSubagent}
        queuedMessage={queuedMessage}
        onDismissQueuedMessage={clearQueuedToInput}
        chatInputRef={chatInputRef}
        onSend={handleSendOrQueue}
        scrollPhase={scrollPhase}
        onScrollToBottom={scrollToBottom}
        availableModels={availableModels}
        modelsLoading={modelsLoading}
        onFetchModels={fetchModels}
        backendMode={backendMode}
        serverCommands={serverCommands}
        quoteText={quoteText}
        onClearQuote={() => setQuoteText(null)}
        isRunActive={isRunActive}
        hasQueued={!!queuedMessage}
        onAbort={handleAbort}
        lastUserMessage={lastUserMessage}
        uploadDisabled={uploadDisabled}
      />
    </div>
  );
}
