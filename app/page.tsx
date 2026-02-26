"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

import { createLmStudioHandler, type LmStudioConfig } from "@/lib/lmStudio";
import { notifyMessageComplete } from "@/lib/notifications";
import { getTextFromContent } from "@/lib/messageUtils";
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
  resolveToolCall as resolveToolCallInMessages,
} from "@/lib/chat/streamMutations";
import { buildDisplayMessages } from "@/lib/chat/messageTransforms";

import type {
  BackendMode,
  ConnectionConfig,
  Message,
  ModelChoice,
} from "@/types/chat";

import type { Command } from "@/components/CommandSheet";
import { type ChatInputHandle } from "@/components/ChatInput";
import { TurnstileGate } from "@/components/TurnstileGate";
import { ChatChrome } from "@/components/chat/ChatChrome";
import { ChatViewport } from "@/components/chat/ChatViewport";
import { ChatComposerBar } from "@/components/chat/ChatComposerBar";

import { useThinkingState } from "@/hooks/useThinkingState";
import { useScrollManager } from "@/hooks/useScrollManager";
import { useKeyboardLayout } from "@/hooks/useKeyboardLayout";
import { useTheme } from "@/hooks/useTheme";
import { useSubagentStore } from "@/hooks/useSubagentStore";
import { formatSessionName } from "@/hooks/useSessionSwitcher";

import { useModeBootstrap } from "@/hooks/chat/useModeBootstrap";
import { useOpenClawRuntime } from "@/hooks/chat/useOpenClawRuntime";
import { useQuoteSelection } from "@/hooks/chat/useQuoteSelection";
import { useQueuedMessage } from "@/hooks/chat/useQueuedMessage";
import { useUnreadTabIndicator } from "@/hooks/chat/useUnreadTabIndicator";
import { useNativeBridgeMessage } from "@/hooks/chat/useNativeBridgeMessage";
import { useDemoRuntime } from "@/hooks/chat/useDemoRuntime";
import { useLmStudioRuntime } from "@/hooks/chat/useLmStudioRuntime";
import { useMessageSender } from "@/hooks/chat/useMessageSender";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;

export default function Home() {
  const [openclawUrl, setOpenclawUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, _setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [sentAnimId, setSentAnimId] = useState<string | null>(null);
  const isNativeRef = useRef(false);

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
  const [isDetached, setIsDetached] = useState(false);
  const isDetachedRef = useRef(false);
  const [isNative, setIsNative] = useState(false);
  const [uploadDisabled, setUploadDisabled] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const { theme, toggleTheme } = useTheme();

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

  const [backendMode, setBackendMode] = useState<BackendMode>("openclaw");
  const lmStudioConfigRef = useRef<LmStudioConfig | null>(null);
  const lmStudioHandlerRef = useRef<ReturnType<typeof createLmStudioHandler> | null>(null);

  const runStartTsRef = useRef<number>(0);
  const markRunStart = useCallback(() => {
    runStartTsRef.current = Date.now();
  }, []);
  const markRunEnd = useCallback((): number => {
    const start = runStartTsRef.current;
    runStartTsRef.current = 0;
    return start ? Math.round((Date.now() - start) / 1000) : 0;
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

  const queuedMessageForRuntimeRef = useRef<{ text: string; attachments?: unknown[] } | null>(null);

  const {
    connectionState,
    connect,
    disconnect,
    isConnected,
    sendWS,
    fetchModels,
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
    addToolCall,
    resolveToolCall,
  });

  const { quoteText, setQuoteText, quotePopup, quotePopupRef, handleAcceptQuote } = useQuoteSelection({ scrollRef });

  const handleNativeBridgeMessage = useNativeBridgeMessage({
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
    addToolCall,
    resolveToolCall,
    scrollToBottom,
    subagentStore,
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
    setIsDetached,
    setIsNative,
    setUploadDisabled,
    setServerCommands,
    isDetachedRef,
    isNativeRef,
  });

  const { demoHandlerRef } = useDemoRuntime({
    isDemoMode,
    notifyForRun: (runId) => notifyForRun(runId),
    setMessages,
    setIsStreaming,
    setStreamingId,
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

  const displayMessages = useMemo(() => buildDisplayMessages(messages), [messages]);

  const currentSessionName = useMemo(() => {
    const current = sessions.find((session) => session.key === currentSessionKey);
    if (current) return formatSessionName(current);
    if (currentSessionKey === "main") return "Main Session";
    return currentSessionKey;
  }, [sessions, currentSessionKey]);

  const prevMsgIdsRef = useRef<Set<string>>(new Set());
  const historyWasLoadedRef = useRef(false);
  const fadeInIds = new Set<string>();
  const currentMsgIds = new Set(displayMessages.map((m) => m.id).filter(Boolean) as string[]);
  if (historyLoaded && historyWasLoadedRef.current) {
    for (const id of currentMsgIds) {
      if (!prevMsgIdsRef.current.has(id)) fadeInIds.add(id);
    }
  }
  prevMsgIdsRef.current = currentMsgIds;
  historyWasLoadedRef.current = historyLoaded;

  const inputZoneHeight = "calc(1.5dvh + 3.5rem)";
  const bottomPad = isNative
    ? "8rem"
    : pinnedSubagent
      ? (isDetached ? "10rem" : "16rem")
      : queuedMessage
        ? (isDetached ? "7rem" : "13rem")
        : (isDetached ? "4rem" : "10rem");

  const hideChrome = isDetached || isNative;

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
        onOpenSetup={() => setShowSetup(true)}
        currentModel={currentModel}
        theme={theme}
        toggleTheme={toggleTheme}
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
        awaitingResponse={awaitingResponse}
        thinkingStartTime={thinkingStartTime}
        thinkingLabel={thinkingLabel}
        quotePopup={quotePopup}
        quotePopupRef={quotePopupRef}
        onAcceptQuote={handleAcceptQuote}
      />

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
