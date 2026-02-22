"use client";

import React from "react";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
  ImageAttachment,
} from "@/types/chat";
import { getTextFromContent, getMessageSide, formatMessageTime, updateAt, updateMessageById } from "@/lib/messageUtils";
import { HEARTBEAT_MARKER, NO_REPLY_MARKER, SYSTEM_PREFIX, SYSTEM_MESSAGE_PREFIX, GATEWAY_INJECTED_MODEL, WS_HELLO_OK, STOP_REASON_INJECTED, isToolCallPart, SPAWN_TOOL_NAME, hasUnquotedMarker } from "@/lib/constants";
import { requestNotificationPermission, notifyMessageComplete } from "@/lib/notifications";
import { loadOrCreateDeviceIdentity, signDevicePayload, buildDeviceAuthPayload } from "@/lib/deviceIdentity";
import { parseConfigProviders, mergeModels } from "@/lib/parseBackendModels";
import type { ConfigParseResult } from "@/lib/parseBackendModels";
import { logChatEvent, logAgentEvent } from "@/lib/debugLog";
import { MessageRow } from "@/components/MessageRow";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";

import { ChatInput, type ChatInputHandle } from "@/components/ChatInput";
import { SetupDialog } from "@/components/SetupDialog";
import { ChatHeader } from "@/components/ChatHeader";
import { useThinkingState } from "@/hooks/useThinkingState";
import { useScrollManager } from "@/hooks/useScrollManager";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useKeyboardLayout } from "@/hooks/useKeyboardLayout";
import { useTheme } from "@/hooks/useTheme";
import { useSubagentStore } from "@/hooks/useSubagentStore";
import { FloatingSubagentPanel } from "@/components/FloatingSubagentPanel";

// ── QueuePill ────────────────────────────────────────────────────────────────

function QueuePill({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out mb-2"
      style={{ gridTemplateRows: mounted ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden min-h-0">
        <div className="rounded-xl border border-border bg-secondary overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
              <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
            </svg>
            <span className="font-medium shrink-0">Queued</span>
            <span className="truncate text-muted-foreground/50">{text}</span>
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 ml-auto rounded-full p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
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
    thinkingStartTime, setThinkingStartTime,
    beginContentArrival,
    resetThinkingState,
  } = useThinkingState(streamingId, messages, setMessages);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showSetup, setShowSetup] = useState(false);
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
  const [pinnedSubagent, setPinnedSubagent] = useState<{
    toolCallId: string | null;
    childSessionKey: string | null;
    taskName: string;
    model: string | null;
  } | null>(null);

  // Restore pinned subagent from sessionStorage after hydration
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("pinned-subagent");
      if (saved) setPinnedSubagent(JSON.parse(saved));
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

  // Run duration tracking
  const runStartTsRef = useRef<number>(0);

  // ── Message queue (send while agent is running) ─────────────────────────
  const [queuedMessage, setQueuedMessage] = useState<{ text: string; attachments?: ImageAttachment[] } | null>(null);
  const queuedMessageRef = useRef<{ text: string; attachments?: ImageAttachment[] } | null>(null);
  queuedMessageRef.current = queuedMessage;

  // ── Quote selection ──────────────────────────────────────────────────────
  const [quoteText, setQuoteText] = useState<string | null>(null);
  const [quotePopup, setQuotePopup] = useState<{ x: number; y: number; text: string } | null>(null);
  const quotePopupRef = useRef<HTMLButtonElement>(null);

  /** Call when a run starts to begin tracking. */
  const markRunStart = useCallback(() => {
    runStartTsRef.current = Date.now();
  }, []);

  /** Call when a run ends. Returns duration in seconds. */
  const markRunEnd = useCallback((): number => {
    const start = runStartTsRef.current;
    runStartTsRef.current = 0;
    return start ? Math.round((Date.now() - start) / 1000) : 0;
  }, []);

  // ── Quote selection detection ───────────────────────────────────────────
  const checkSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setQuotePopup(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const container = scrollRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) {
      setQuotePopup(null);
      return;
    }
    // Walk up to find if selection is within an assistant message
    let node: Node | null = range.commonAncestorContainer;
    while (node && node !== container) {
      if (node instanceof HTMLElement && node.dataset.messageRole === "assistant") {
        const rect = range.getBoundingClientRect();
        setQuotePopup({
          x: Math.max(40, Math.min(rect.left + rect.width / 2, window.innerWidth - 40)),
          y: rect.top,
          text: sel.toString().trim(),
        });
        return;
      }
      node = node.parentNode;
    }
    setQuotePopup(null);
  }, []);

  // Desktop: check on pointer up within the scroll area
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => setTimeout(checkSelection, 10);
    el.addEventListener("pointerup", handler);
    return () => el.removeEventListener("pointerup", handler);
  }, [checkSelection]);

  // Mobile: check on selectionchange (long-press)
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handler = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) setQuotePopup(null);
        else checkSelection();
      }, 200);
    };
    document.addEventListener("selectionchange", handler);
    return () => { document.removeEventListener("selectionchange", handler); clearTimeout(timeout); };
  }, [checkSelection]);

  // Dismiss popup on pointer down outside
  useEffect(() => {
    if (!quotePopup) return;
    const handler = (e: PointerEvent) => {
      if (quotePopupRef.current?.contains(e.target as Node)) return;
      setQuotePopup(null);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [quotePopup]);

  const handleAcceptQuote = useCallback((text: string) => {
    setQuoteText(text);
    setQuotePopup(null);
    window.getSelection()?.removeAllRanges();
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
    // Skip notification for silent injected messages
    if (preview.includes(HEARTBEAT_MARKER) || hasUnquotedMarker(preview, NO_REPLY_MARKER)) return;
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

  /** Fetch configured models from OpenClaw gateway.
   *  Sends both config.get (for configured provider keys) and models.list (for full catalog),
   *  then intersects them so only configured providers appear. */
  const configResultRef = useRef<ConfigParseResult | null>(null);
  const modelsCatalogRef = useRef<any[] | null>(null);
  const fetchModels = useCallback(() => {
    if (backendMode !== "openclaw") return;
    if (modelsRequestedRef.current) return;
    modelsRequestedRef.current = true;
    setModelsLoading(true);
    const ts = Date.now();
    sendWS({ type: "req", id: `config-providers-${ts}`, method: "config.get", params: {} });
    sendWS({ type: "req", id: `models-catalog-${ts}`, method: "models.list", params: {} });
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
    modelsRequestedRef.current = false;
    configResultRef.current = null;
    modelsCatalogRef.current = null;
    setModelsLoading(false);
    setAvailableModels([]);
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
          if (tp?.text && typeof tp.text === "string" && (tp.text.startsWith(SYSTEM_PREFIX) || tp.text.startsWith(SYSTEM_MESSAGE_PREFIX) || tp.text.includes(HEARTBEAT_MARKER))) isContext = true;
        }

        const isGatewayInjected = m.model === GATEWAY_INJECTED_MODEL;
        const effectiveStopReason = isGatewayInjected ? STOP_REASON_INJECTED : m.stopReason;

        return {
          role: m.role,
          content: filteredContent,
          timestamp: m.timestamp,
          id: `hist-${idx}`,
          reasoning,
          toolName,
          isError: m.stopReason === "error" || !!m.isError,
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
        // Detect error from message flag OR from result content
        let isErr = !!hm.isError;
        if (!isErr && resultText) {
          try {
            const parsed = JSON.parse(resultText);
            if (parsed && typeof parsed === "object") {
              isErr = parsed.status === "error" || (typeof parsed.error === "string" && !!parsed.error) || parsed.isError === true;
            }
          } catch {}
        }
        for (let j = i - 1; j >= 0; j--) {
          const prev = historyMessages[j];
          if (prev.role === "assistant" && Array.isArray(prev.content)) {
            const tc = prev.content.find((p) => p.name === hm.toolName && !p.result);
            if (tc) {
              const args = tc.arguments;
              tc.arguments = typeof args === "string" ? args : args ? JSON.stringify(args) : undefined;
              tc.result = resultText;
              tc.resultError = isErr;
              tc.status = isErr ? "error" : "success";
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
    const lastInjected = rawMsgs.filter((m) => m.stopReason === STOP_REASON_INJECTED).pop();
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

    // Merge: keep optimistic user messages not yet in server history,
    // and carry over image parts from optimistic messages to server counterparts.
    setMessages((prev: Message[]) => {
      // Normalize whitespace for comparison — server may collapse newlines differently
      const norm = (t: string) => t.replace(/\s+/g, " ").trim();

      // Build a lookup of optimistic user messages by normalized text content
      const optimisticByNorm = new Map<string, Message>();
      for (const m of prev) {
        if (m.role === "user" && m.id?.startsWith("u-")) {
          optimisticByNorm.set(norm(getTextFromContent(m.content)), m);
        }
      }

      const historyUserNorms = new Set(
        finalMessages
          .filter((m) => m.role === "user")
          .map((m) => norm(getTextFromContent(m.content)))
      );

      // Carry over text + image parts from optimistic messages to server history.
      // The server may collapse newlines (breaking quote-reply formatting),
      // so we always prefer the client's original text content.
      const enriched = finalMessages.map((m) => {
        if (m.role !== "user") return m;
        const text = getTextFromContent(m.content);
        const opt = optimisticByNorm.get(norm(text));
        if (!opt || !Array.isArray(opt.content)) return m;

        // Prefer the client's content (preserves original newlines for quote-reply)
        const optText = (opt.content as ContentPart[]).filter((p) => p.type === "text");
        const optImages = (opt.content as ContentPart[]).filter((p) => p.type === "image_url" || p.type === "image");
        const serverImages = Array.isArray(m.content) ? (m.content as ContentPart[]).filter((p) => p.type === "image_url" || p.type === "image") : [];
        const images = serverImages.length > 0 ? serverImages : optImages;
        const nonTextNonImage = Array.isArray(m.content) ? (m.content as ContentPart[]).filter((p) => p.type !== "text" && p.type !== "image_url" && p.type !== "image") : [];

        if (optText.length === 0 && images.length === 0) return m;
        return { ...m, content: [...optText, ...nonTextNonImage, ...images] };
      });

      // If server history shrank (e.g. /new cleared the session), treat it as
      // a full reset — don't preserve stale optimistic messages.
      // Compare against non-optimistic messages only, so a freshly-queued
      // user message doesn't trick this into treating a stale history
      // response as a session reset.
      const prevServerCount = prev.filter(m => !(m.role === "user" && m.id?.startsWith("u-"))).length;
      if (finalMessages.length < prevServerCount) return enriched;

      const optimistic = prev.filter(
        (m) =>
          m.role === "user" &&
          m.id?.startsWith("u-") &&
          !historyUserNorms.has(norm(getTextFromContent(m.content)))
      );
      if (optimistic.length === 0) return enriched;
      return [...enriched, ...optimistic].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
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
        if (!isToolCallPart(part) || part.name !== SPAWN_TOOL_NAME) continue;
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
  }, [onHistoryReceived, requestHistory, sendWS, subagentStore]);

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
                    (p: ContentPart) => isToolCallPart(p)
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
        handleUnpinSubagent();
        fetchedSubhistoryRef.current.clear();
        // Skip history refresh when a queued message is about to be sent —
        // the stale response could race with the optimistic user message.
        // The queued message's own run will requestHistory() when it finishes.
        if (!queuedMessageRef.current) {
          requestHistory();
        }
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
        handleUnpinSubagent();
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
        handleUnpinSubagent();
        fetchedSubhistoryRef.current.clear();
        break;
      }
    }
  }, [requestHistory, notifyForRun, beginContentArrival, markRunEnd, setIsStreaming, setAwaitingResponse, subagentStore, handleUnpinSubagent]);

  /** Handle agent events (lifecycle/content/reasoning/tool streams). */
  const handleAgentEvent = useCallback((payload: AgentEventPayload) => {
    logAgentEvent(payload);
    // Route subagent session events to the subagent store
    if (payload.sessionKey !== sessionKeyRef.current) {
      subagentStore.ingestAgentEvent(payload.sessionKey, payload);
      return;
    }
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
      console.log("[TOOL]", JSON.stringify(payload.data, null, 2));
      const phase = payload.data.phase as string;
      const toolName = payload.data.name as string;
      const rawToolCallId = (payload.data.toolCallId || payload.data.tool_call_id) as string | undefined;
      // Always ensure sessions_spawn has a toolCallId so the SpawnPill can render
      const toolCallId = rawToolCallId || (toolName === SPAWN_TOOL_NAME ? `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` : undefined);

      if (phase === "start" && toolName) {
        if (toolName === SPAWN_TOOL_NAME && toolCallId) {
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
              if (isToolCallPart(part)) {
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
            (p: ContentPart) => isToolCallPart(p)
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
            (p: ContentPart) => isToolCallPart(p)
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
  }, [appendReasoning, ensureStreamingMessage, beginContentArrival, markRunStart, markRunEnd, setIsStreaming, subagentStore]);

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
      if (msg.ok && resPayload?.type === WS_HELLO_OK) return handleHelloOk(resPayload);
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
      if (msg.id?.startsWith("config-providers-")) {
        if (msg.ok && resPayload) {
          const result = parseConfigProviders(resPayload);
          configResultRef.current = result;
          if (result.authOnlyProviders.size === 0) {
            // No auth-only providers — explicit models are sufficient, no need to wait for catalog
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

  /** Upload images to 0x0.st via our proxy, returns public URLs. */
  const uploadImages = useCallback(async (attachments: ImageAttachment[]): Promise<string[]> => {
    const results = await Promise.allSettled(
      attachments.map(async (a) => {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: a.content, mimeType: a.mimeType, fileName: a.fileName }),
        });
        if (!res.ok) return null;
        const { url } = await res.json();
        return url as string;
      })
    );
    return results
      .filter((r): r is PromiseFulfilledResult<string | null> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((url): url is string => !!url);
  }, []);

  const sendMessage = useCallback(async (text: string, attachments?: ImageAttachment[]) => {
    console.log("[sendMessage]", { text: text.slice(0, 50), attachments: attachments?.length ?? 0 });
    requestNotificationPermission();
    pinnedToBottomRef.current = true;

    // Show user message immediately with local image previews
    const contentParts: ContentPart[] = [{ type: "text", text }];
    if (attachments?.length) {
      for (const a of attachments) {
        contentParts.push({ type: "image_url", image_url: { url: `data:${a.mimeType};base64,${a.content}` } });
      }
    }

    const userMsg: Message = { role: "user", content: contentParts, id: `u-${Date.now()}`, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    // Upload images in parallel, build message text with public URLs
    let messageText = text;
    if (attachments?.length) {
      const urls = await uploadImages(attachments);
      console.log("[Image upload]", urls.length ? urls : "no URLs returned (upload may have failed)");
      if (urls.length > 0) {
        const urlLines = urls.map((url) => url).join("\n");
        messageText = text ? `${text}\n\n${urlLines}` : urlLines;
      }
    }
    if (messageText !== text) {
      console.log("[Send] message text with images:", messageText);
    }

    // Demo mode
    if (isDemoMode || backendMode === "demo") {
      demoHandlerRef.current?.sendMessage(messageText);
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
        message: messageText,
        deliver: true,
        idempotencyKey: runId,
      },
    });

    setIsStreaming(true);
  }, [isConnected, isDemoMode, backendMode, sendWS, pinnedToBottomRef, setIsStreaming, setAwaitingResponse, setThinkingStartTime, uploadImages]);

  // ── Send-or-queue wrapper ────────────────────────────────────────────────
  const isRunActive = awaitingResponse || isStreaming;

  const handleSendOrQueue = useCallback((text: string, attachments?: ImageAttachment[]) => {
    if (isRunActive) {
      if (!queuedMessageRef.current) {
        setQueuedMessage({ text, attachments });
      }
      return;
    }
    sendMessage(text, attachments);
  }, [isRunActive, sendMessage]);

  // Dynamic tab title — show "Thinking…" while run is active
  useEffect(() => {
    document.title = isRunActive ? "Thinking… — MobileClaw" : "MobileClaw";
  }, [isRunActive]);

  // Auto-send queued message when run ends naturally (not via abort)
  const prevIsRunActiveRef = useRef(false);
  const abortedWithQueueRef = useRef(false);
  useEffect(() => {
    const wasActive = prevIsRunActiveRef.current;
    prevIsRunActiveRef.current = isRunActive;
    if (wasActive && !isRunActive && queuedMessageRef.current && !abortedWithQueueRef.current) {
      const { text, attachments } = queuedMessageRef.current;
      setQueuedMessage(null);
      setTimeout(() => sendMessage(text, attachments), 150);
    }
    abortedWithQueueRef.current = false;
  }, [isRunActive, sendMessage]);

  // ── Abort handler ─────────────────────────────────────────────────────────

  const chatInputRef = useRef<ChatInputHandle | null>(null);

  const handleAbort = useCallback(() => {
    // If there's a queued message, restore it to the input instead of auto-sending
    if (queuedMessageRef.current) {
      const { text } = queuedMessageRef.current;
      setQueuedMessage(null);
      abortedWithQueueRef.current = true;
      chatInputRef.current?.setValue(text);
    }

    if (backendMode === "lmstudio") {
      lmStudioHandlerRef.current?.stop();
    } else if (backendMode === "demo") {
      demoHandlerRef.current?.stop();
    } else {
      // OpenClaw — send chat.abort
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
  }, [backendMode, sendWS, setIsStreaming, setAwaitingResponse]);

  // ── Merge HEARTBEAT_OK / NO_REPLY messages with preceding assistant ──────
  const displayMessages = useMemo(() => {
    const result: Message[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const msgText = getTextFromContent(msg.content);
      if (
        msg.role === "assistant" &&
        msgText &&
        (msgText.includes(HEARTBEAT_MARKER) || hasUnquotedMarker(msgText, NO_REPLY_MARKER)) &&
        result.length > 0
      ) {
        // Absorb ALL consecutive preceding assistant messages into this one
        const absorbed: ContentPart[] = [];
        let absorbedReasoning = msg.reasoning;
        while (result.length > 0) {
          const prev = result[result.length - 1];
          if (prev.role !== "assistant" || !Array.isArray(prev.content)) break;
          const prevParts = prev.content as ContentPart[];
          absorbed.unshift(...prevParts);
          if (!absorbedReasoning && prev.reasoning) absorbedReasoning = prev.reasoning;
          result.pop();
        }
        if (absorbed.length > 0) {
          const thisParts = Array.isArray(msg.content) ? (msg.content as ContentPart[]) : [{ type: "text" as const, text: msgText }];
          result.push({
            ...msg,
            content: [...absorbed, ...thisParts],
            reasoning: absorbedReasoning,
          });
          continue;
        }
      }
      result.push(msg);
    }
    return result;
  }, [messages]);

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
          className="flex-1 overflow-y-auto overflow-x-hidden pt-14"
          style={{ overscrollBehavior: "none" }}
        >
          <div className={`mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6 md:px-6 md:py-4 transition-opacity duration-300 ease-out ${historyLoaded ? "opacity-100" : "opacity-0"}`} style={{ paddingBottom: pinnedSubagent ? "13rem" : queuedMessage ? "10rem" : "7rem" }}>
            {displayMessages.map((msg, idx) => {
              const side = getMessageSide(msg.role);
              const prevSide = idx > 0 ? getMessageSide(displayMessages[idx - 1].role) : null;
              const prevTimestamp = idx > 0 ? displayMessages[idx - 1].timestamp : null;
              const isNewTurn = side !== "center" && side !== prevSide;
              const timGap = msg.timestamp && prevTimestamp ? msg.timestamp - prevTimestamp : 0;
              const isTimeGap = timGap > 10 * 60 * 1000;
              const showTimestamp = side !== "center" && (isNewTurn || isTimeGap);
              return (
                <React.Fragment key={msg.id || idx}>
                  {isTimeGap && !isNewTurn && msg.timestamp && (
                    <div className="flex justify-center py-1">
                      <span className="text-[10px] text-muted-foreground/60">{formatMessageTime(msg.timestamp)}</span>
                    </div>
                  )}
                  {showTimestamp && isNewTurn && msg.timestamp && (
                    <p className={`text-[10px] text-muted-foreground/60 ${side === "right" ? "text-right" : "text-left"}`}>
                      {formatMessageTime(msg.timestamp)}
                      {msg.role === "assistant" && msg.runDuration && msg.runDuration > 0 && (
                        <span className="ml-1">&middot; Worked for {msg.runDuration}s</span>
                      )}
                      {msg.role === "assistant" && !msg.runDuration && msg.thinkingDuration && msg.thinkingDuration > 0 && (
                        <span className="ml-1">&middot; {msg.thinkingDuration}s</span>
                      )}
                    </p>
                  )}
                  <div>
                    <MessageRow message={msg} isStreaming={isStreaming && msg.id === streamingId} subagentStore={subagentStore} pinnedToolCallId={pinnedSubagent?.toolCallId} onPin={handlePinSubagent} onUnpin={handleUnpinSubagent} />
                  </div>
                </React.Fragment>
              );
            })}
            <ThinkingIndicator visible={isRunActive} startTime={thinkingStartTime ?? undefined} />
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

      {/* Floating quote button */}
      {quotePopup && (
        <button
          ref={quotePopupRef}
          type="button"
          className="fixed z-50 -translate-x-1/2 -translate-y-full flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg active:scale-95 transition-transform animate-[fadeIn_100ms_ease-out]"
          style={{ left: quotePopup.x, top: quotePopup.y - 8 }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleAcceptQuote(quotePopup.text);
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
          </svg>
          Quote
        </button>
      )}

      {/* Floating morphing bar */}
      <div
        ref={floatingBarRef}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[3dvh] md:px-6 md:pb-[3dvh] animate-[fadeIn_400ms_ease-out]"
      >
        <div ref={morphRef} className="pointer-events-auto w-full" style={{ maxWidth: "min(calc(200px + (100% - 200px) * (1 - var(--sp, 0))), calc(200px + (42rem - 200px) * (1 - var(--sp, 0))))" } as React.CSSProperties}>
          {pinnedSubagent && (
            <div style={{ paddingLeft: "calc(48px * (1 - var(--sp, 0)))", paddingRight: "calc(48px * (1 - var(--sp, 0)))" } as React.CSSProperties}>
              <FloatingSubagentPanel
                toolCallId={pinnedSubagent.toolCallId}
                childSessionKey={pinnedSubagent.childSessionKey}
                taskName={pinnedSubagent.taskName}
                model={pinnedSubagent.model}
                subagentStore={subagentStore}
                onUnpin={handleUnpinSubagent}
              />
            </div>
          )}
          {queuedMessage && (
            <div style={{ paddingLeft: "calc(48px * (1 - var(--sp, 0)))", paddingRight: "calc(48px * (1 - var(--sp, 0)))" } as React.CSSProperties}>
              <QueuePill text={queuedMessage.text} onDismiss={() => {
                chatInputRef.current?.setValue(queuedMessage.text);
                setQueuedMessage(null);
              }} />
            </div>
          )}
          <ChatInput
            ref={chatInputRef}
            onSend={handleSendOrQueue}
            scrollPhase={scrollPhase}
            onScrollToBottom={scrollToBottom}
            availableModels={availableModels}
            modelsLoading={modelsLoading}
            onFetchModels={fetchModels}
            backendMode={backendMode}
            quoteText={quoteText}
            onClearQuote={() => setQuoteText(null)}
            isRunActive={isRunActive}
            hasQueued={!!queuedMessage}
            onAbort={handleAbort}
            lastUserMessage={(() => {
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === "user" && !messages[i].isContext) {
                  return getTextFromContent(messages[i].content);
                }
              }
              return "";
            })()}
          />
        </div>
      </div>
    </div>
  );
}
