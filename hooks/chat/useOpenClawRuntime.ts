import { useRef, useEffect, useCallback } from "react";

import { parseServerCommands, ALL_COMMANDS, type Command } from "@mc/components/CommandSheet";
import { usePullToRefresh } from "@mc/hooks/usePullToRefresh";
import { useSessionSwitcher } from "@mc/hooks/useSessionSwitcher";
import {
  isInternalCommandFetchRunId,
  SPAWN_TOOL_NAME,
  WS_HELLO_OK,
} from "@mc/lib/constants";
import { signConnectChallenge } from "@mc/lib/deviceIdentity";
import {
  buildGatewayAuthCacheEntry,
  deleteGatewayAuthCacheEntry,
  getGatewayAuthCacheEntry,
  hashAuthToken,
  persistHelloOkAuth,
} from "@mc/lib/gatewayAuth";
import {
  DEFAULT_GATEWAY_CLIENT_ID,
  DEFAULT_GATEWAY_CLIENT_MODE,
  DEFAULT_GATEWAY_SCOPES,
  getGatewayClientMetadata,
} from "@mc/lib/gatewayClientMetadata";
import { getTextFromContent, updateAt } from "@mc/lib/messageUtils";
import { upsertChatEventMessage } from "@mc/lib/chat/chatEventUpsert";
import { mergeModels, parseConfigProviders, type ConfigParseResult } from "@mc/lib/parseBackendModels";
import { useWebSocket, type WebSocketMessage } from "@mc/lib/useWebSocket";
import { postConnectionState, postRunState, postSessionsState } from "@mc/lib/nativeBridge";
import { mergeAndNormalizeToolResults } from "@mc/lib/chat/messageTransforms";
import { pluginFromToolResult, injectPluginsFromHistory } from "@mc/lib/chat/toolResultPlugins";
import { extractToolNarration, serializeToolArgs } from "@mc/lib/chat/toolEventUtils";
import {
  buildHistoryMessages,
  extractSpawnChildSessionKeys,
  inferCurrentModel,
  isRunInProgressFromHistory,
  mergeHistoryWithOptimistic,
  prepareHistoryMessages,
} from "@mc/lib/chat/historyResponse";
import type {
  AgentEventPayload,
  BackendMode,
  CanvasPayload,
  CanvasUpdateEventPayload,
  ChatEventPayload,
  ConnectChallengePayload,
  GatewayError,
  GatewayFeatures,
  GatewayPolicy,
  HelloOkPayload,
  SessionMessageEventPayload,
  SessionToolEventPayload,
  ShutdownEventPayload,
  Message,
  ModelChoice,
  PluginContentPart,
  WSIncomingMessage,
} from "@mc/types/chat";
import type { useSubagentStore } from "@mc/hooks/useSubagentStore";

interface StreamActions {
  appendContentDelta: (runId: string, delta: string, ts: number) => void;
  appendThinkingDelta: (runId: string, delta: string, ts: number) => void;
  startThinkingBlock: (runId: string, ts: number) => void;
  addToolCall: (runId: string, name: string, ts: number, toolCallId?: string, args?: string, narration?: string) => void;
  resolveToolCall: (runId: string, name: string, toolCallId?: string, result?: string, isError?: boolean) => void;
  mountPluginPart: (runId: string, part: PluginContentPart, ts: number, index?: number) => void;
  replacePluginPart: (runId: string, partId: string, next: Pick<PluginContentPart, "state" | "data" | "revision">) => void;
  removePluginPart: (runId: string, partId: string, tombstone?: boolean) => void;
  upsertCanvasPluginByMessageId: (messageId: string, canvas: CanvasPayload) => void;
}

interface UseOpenClawRuntimeOptions extends StreamActions {
  backendMode: BackendMode;
  isNative: boolean;
  useDocumentScroll?: boolean;
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
  setIsInitialConnecting: React.Dispatch<React.SetStateAction<boolean>>;
  onHistoryLoaded: () => void;
  beginContentArrival: () => void;
  setThinkingStartTime: React.Dispatch<React.SetStateAction<number | null>>;
  markRunStart: () => void;
  markRunEnd: () => number;
  notifyForRun: (runId: string | null) => void;
  handleUnpinSubagent: () => void;
  queuedMessageRef: React.RefObject<{ text: string; attachments?: unknown[] } | null>;
  subagentStore: ReturnType<typeof useSubagentStore>;
  /** Called when the gateway rejects with DEVICE_AUTH_SIGNATURE_INVALID.
   *  Return a fresh auth token (or null) to retry connection. */
  onTokenRefresh?: () => Promise<string | null>;
}

// Cross-platform contract: this logic is mirrored in OpenClawProtocol.swift.
// Both must check the same flags/markers to stay in sync.
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

const RESUME_FORCE_RECONNECT_MS = 60_000;
const RESUME_SYNC_COOLDOWN_MS = 5_000;
const SLEEP_GAP_CHECK_MS = 15_000;
const HISTORY_INVALIDATION_DEBOUNCE_MS = 150;
const SESSIONS_INVALIDATION_DEBOUNCE_MS = 250;

function extractSessionKeyFromPayload(payload: Record<string, unknown> | undefined): string | null {
  if (!payload) return null;
  const direct = payload.sessionKey ?? payload.key ?? payload.sessionId;
  if (typeof direct === "string" && direct) return direct;
  const session = payload.session;
  if (session && typeof session === "object") {
    const key = (session as Record<string, unknown>).key ?? (session as Record<string, unknown>).sessionKey;
    if (typeof key === "string" && key) return key;
  }
  const message = payload.message;
  if (message && typeof message === "object") {
    const key = (message as Record<string, unknown>).sessionKey ?? (message as Record<string, unknown>).key;
    if (typeof key === "string" && key) return key;
  }
  return null;
}

function getGatewayErrorCode(error: GatewayError): string | null {
  if (typeof error.code === "string" && error.code) return error.code;
  const nested = error.details?.code;
  return typeof nested === "string" && nested ? nested : null;
}

function formatGatewayError(error: GatewayError | string): string {
  if (typeof error === "string") return error;
  const detailCode = getGatewayErrorCode(error);
  const recommended = error.details?.recommendedNextStep;
  if (detailCode?.startsWith("DEVICE_AUTH_")) {
    return `Device authentication failed: ${error.message}`;
  }
  if (typeof recommended === "string" && recommended) {
    return `${error.message} (${recommended.replaceAll("_", " ")})`;
  }
  return error.message;
}

function formatShutdownMessage(payload: ShutdownEventPayload): string {
  const reason = typeof payload.reason === "string" && payload.reason ? payload.reason : "Gateway restarting";
  if (typeof payload.restartExpectedMs === "number" && payload.restartExpectedMs > 0) {
    return `${reason}. Reconnect expected in ${Math.ceil(payload.restartExpectedMs / 1000)}s.`;
  }
  return reason;
}

function isDeviceTokenMismatchReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return normalized.includes("device token mismatch")
    || normalized.includes("device_token_mismatch")
    || normalized.includes("rotate/reissue device token");
}

export function useOpenClawRuntime({
  backendMode,
  isNative,
  useDocumentScroll = false,
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
  onHistoryLoaded,
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
  mountPluginPart,
  replacePluginPart,
  removePluginPart,
  upsertCanvasPluginByMessageId,
  onTokenRefresh,
}: UseOpenClawRuntimeOptions) {
  const sessionIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef<string>("main");
  const activeRunIdRef = useRef<string | null>(null);
  // Set to true after processing a final/aborted/error event to prevent a stale
  // history response from re-enabling isRunActive before the server catches up.
  const justFinalizedRef = useRef(false);
  // Tracks agent lifecycle phase to prevent premature finalization on intermediate
  // chat:final events (OpenClaw sends one per response segment, not just at the end).
  const agentLifecycleActiveRef = useRef(false);

  const sendWSMessageRef = useRef<((message: WebSocketMessage) => boolean) | null>(null);
  const markEstablishedRef = useRef<(() => void) | null>(null);
  const reconnectNowRef = useRef<(() => void) | null>(null);
  const connectFnRef = useRef<((url: string) => void) | null>(null);
  const gatewayTokenRef = useRef<string | null>(null);
  const gatewayUrlRef = useRef<string | null>(null);
  const connectNonceRef = useRef<string | null>(null);
  const gatewayFeaturesRef = useRef<GatewayFeatures | null>(null);
  const gatewayPolicyRef = useRef<GatewayPolicy | null>(null);
  const activeAuthCacheEntryRef = useRef<ReturnType<typeof buildGatewayAuthCacheEntry> | null>(null);
  const activeAuthTokenSha256Ref = useRef("");
  const forcedDeviceTokenRef = useRef<string | null>(null);
  const didRetryWithDeviceTokenRef = useRef(false);
  const didRetryAfterDeviceTokenMismatchRef = useRef(false);
  const didRetryWithFreshTokenRef = useRef(false);
  const pendingTokenRefreshRef = useRef(false);
  const transientRetryCountRef = useRef(0);
  const onTokenRefreshRef = useRef(onTokenRefresh);
  onTokenRefreshRef.current = onTokenRefresh;
  const reconnectMessageRef = useRef<string | null>(null);
  const sessionsSubscribedRef = useRef(false);
  const sessionMessagesSubscriptionKeyRef = useRef<string | null>(null);
  const pendingHistorySyncAfterRunRef = useRef(false);
  const historyRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const historyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const lastResumeSyncAtRef = useRef(0);
  const lastSocketActivityAtRef = useRef(Date.now());
  const lastClockTickAtRef = useRef(Date.now());

  const pendingSubhistoryRef = useRef<Map<string, string>>(new Map());
  const fetchedSubhistoryRef = useRef<Set<string>>(new Set());
  const hasAutoScrolledInitialHistoryRef = useRef(false);

  const modelsRequestedRef = useRef(false);
  const commandsFetchActiveRef = useRef(false);
  const commandsFetchBufferRef = useRef("");

  const thinkTagStateRef = useRef<{
    insideThinkTag: boolean;
    tagBuffer: string;
  }>({ insideThinkTag: false, tagBuffer: "" });
  // Some backends can emit both reasoning + thinking streams for the same run.
  // Lock each run to the first stream seen to avoid duplicate thinking updates.
  const thinkingSourceByRunRef = useRef<Map<string, "reasoning" | "thinking">>(new Map());
  const clearThinkingSource = useCallback((runId?: string | null) => {
    if (runId) thinkingSourceByRunRef.current.delete(runId);
    if (activeRunIdRef.current) thinkingSourceByRunRef.current.delete(activeRunIdRef.current);
  }, []);

  const sendWS = useCallback((msg: { type: string; [key: string]: unknown }) => {
    return sendWSMessageRef.current?.(msg as WebSocketMessage) ?? false;
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
    markSessionsDirty,
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
    enabled: !isNative && !useDocumentScroll,
  });

  const supportsMethod = useCallback((method: string) => {
    return gatewayFeaturesRef.current?.methods.includes(method) ?? false;
  }, []);

  const clearHistoryRefreshTimer = useCallback(() => {
    if (!historyRefreshTimerRef.current) return;
    clearTimeout(historyRefreshTimerRef.current);
    historyRefreshTimerRef.current = null;
  }, []);

  const clearSessionsRefreshTimer = useCallback(() => {
    if (!sessionsRefreshTimerRef.current) return;
    clearTimeout(sessionsRefreshTimerRef.current);
    sessionsRefreshTimerRef.current = null;
  }, []);

  const requestHistory = useCallback(() => {
    return sendWS({
      type: "req",
      id: `history-${Date.now()}`,
      method: "chat.history",
      params: { sessionKey: sessionKeyRef.current },
    });
  }, [sendWS]);

  const scheduleHistoryRefresh = useCallback(() => {
    clearHistoryRefreshTimer();
    historyRefreshTimerRef.current = setTimeout(() => {
      historyRefreshTimerRef.current = null;
      if (activeRunIdRef.current) {
        pendingHistorySyncAfterRunRef.current = true;
        return;
      }
      requestHistory();
    }, HISTORY_INVALIDATION_DEBOUNCE_MS);
  }, [clearHistoryRefreshTimer, requestHistory]);

  const flushPendingHistoryRefresh = useCallback(() => {
    if (!pendingHistorySyncAfterRunRef.current) return;
    pendingHistorySyncAfterRunRef.current = false;
    if (!activeRunIdRef.current) requestHistory();
  }, [requestHistory]);

  const scheduleSessionsRefresh = useCallback(() => {
    markSessionsDirty();
    clearSessionsRefreshTimer();
    sessionsRefreshTimerRef.current = setTimeout(() => {
      sessionsRefreshTimerRef.current = null;
      requestSessionsList();
    }, SESSIONS_INVALIDATION_DEBOUNCE_MS);
  }, [clearSessionsRefreshTimer, markSessionsDirty, requestSessionsList]);

  const subscribeToSessionChanges = useCallback(() => {
    if (!supportsMethod("sessions.subscribe") || sessionsSubscribedRef.current) return;
    sessionsSubscribedRef.current = true;
    sendWS({
      type: "req",
      id: `sessions-subscribe-${Date.now()}`,
      method: "sessions.subscribe",
      params: {},
    });
  }, [sendWS, supportsMethod]);

  const unsubscribeSessionChanges = useCallback(() => {
    if (!supportsMethod("sessions.unsubscribe") || !sessionsSubscribedRef.current) return;
    sessionsSubscribedRef.current = false;
    sendWS({
      type: "req",
      id: `sessions-unsubscribe-${Date.now()}`,
      method: "sessions.unsubscribe",
      params: {},
    });
  }, [sendWS, supportsMethod]);

  const updateSessionMessagesSubscription = useCallback((nextKey: string | null) => {
    if (supportsMethod("sessions.messages.unsubscribe") && sessionMessagesSubscriptionKeyRef.current && sessionMessagesSubscriptionKeyRef.current !== nextKey) {
      sendWS({
        type: "req",
        id: `session-messages-unsubscribe-${Date.now()}`,
        method: "sessions.messages.unsubscribe",
        params: { key: sessionMessagesSubscriptionKeyRef.current },
      });
      sessionMessagesSubscriptionKeyRef.current = null;
    }

    if (!nextKey || !supportsMethod("sessions.messages.subscribe")) return;
    if (sessionMessagesSubscriptionKeyRef.current === nextKey) return;

    sessionMessagesSubscriptionKeyRef.current = nextKey;
    sendWS({
      type: "req",
      id: `session-messages-subscribe-${Date.now()}`,
      method: "sessions.messages.subscribe",
      params: { key: nextKey },
    });
  }, [sendWS, supportsMethod]);

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
      clearThinkingSource();
      activeRunIdRef.current = null;
      agentLifecycleActiveRef.current = false;
    }
  }, [clearThinkingSource, setAwaitingResponse, setIsStreaming, setStreamingId]);

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
    return; // disabled: /commands fetch causes unwanted side-effects
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
    if (!nonce) {
      setConnectionError("Gateway protocol error: missing connect challenge nonce");
      return;
    }

    connectNonceRef.current = nonce;
    const gatewayUrl = gatewayUrlRef.current;
    if (!gatewayUrl) {
      setConnectionError("Gateway URL is missing");
      return;
    }

    const clientMetadata = getGatewayClientMetadata({ isNative: isNativeRef.current });
    const role = "operator";
    const authToken = gatewayTokenRef.current ?? null;
    const authTokenSha256 = await hashAuthToken(authToken);
    activeAuthTokenSha256Ref.current = authTokenSha256;
    const cachedAuthEntry = forcedDeviceTokenRef.current
      ? activeAuthCacheEntryRef.current
      : await getGatewayAuthCacheEntry(gatewayUrl);
    activeAuthCacheEntryRef.current = cachedAuthEntry;

    const explicitDeviceToken = forcedDeviceTokenRef.current
      ?? (
        cachedAuthEntry?.deviceToken && cachedAuthEntry.authTokenSha256 === authTokenSha256
          ? cachedAuthEntry.deviceToken
          : null
      );
    const scopes = [...DEFAULT_GATEWAY_SCOPES];
    const auth = explicitDeviceToken
      ? { deviceToken: explicitDeviceToken }
      : (authToken ? { token: authToken } : undefined);

    const signatureToken = explicitDeviceToken ?? authToken ?? null;
    let device: { id: string; publicKey: string; signature: string; signedAt: number; nonce?: string };
    try {
      device = await signConnectChallenge({
        nonce,
        token: signatureToken,
        isNative: isNativeRef.current,
        platform: clientMetadata.platform,
        deviceFamily: clientMetadata.deviceFamily,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to sign connect challenge";
      setConnectionError(`Device authentication failed: ${message}`);
      return;
    }

    sendWS({
      type: "req",
      id: `conn-${Date.now()}`,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: DEFAULT_GATEWAY_CLIENT_ID,
          version: "1.0.0",
          platform: clientMetadata.platform,
          deviceFamily: clientMetadata.deviceFamily,
          mode: DEFAULT_GATEWAY_CLIENT_MODE,
        },
        role,
        scopes,
        device,
        caps: ["tool-events"],
        auth,
        locale: clientMetadata.locale,
        userAgent: clientMetadata.userAgent,
      },
    });
  }, [isNativeRef, sendWS, setConnectionError, supportsMethod]);

  const handleHelloOk = useCallback((resPayload: HelloOkPayload) => {
    markEstablishedRef.current?.();
    reconnectMessageRef.current = null;
    forcedDeviceTokenRef.current = null;
    didRetryWithDeviceTokenRef.current = false;
    didRetryAfterDeviceTokenMismatchRef.current = false;
    transientRetryCountRef.current = 0;
    modelsRequestedRef.current = false;
    configResultRef.current = null;
    modelsCatalogRef.current = null;
    gatewayFeaturesRef.current = resPayload.features ?? null;
    gatewayPolicyRef.current = resPayload.policy ?? null;
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
    subscribeToSessionChanges();
    updateSessionMessagesSubscription(sessionKey);
    hasAutoScrolledInitialHistoryRef.current = false;

    if (gatewayUrlRef.current) {
      void persistHelloOkAuth(
        gatewayUrlRef.current,
        resPayload.auth,
        activeAuthTokenSha256Ref.current,
      ).then((entry) => {
        if (entry) activeAuthCacheEntryRef.current = entry;
      });
    }

    requestHistory();
    requestServerCommands();
    requestSessionsList();
  }, [
    requestSessionsList,
    requestHistory,
    requestServerCommands,
    setAvailableModels,
    setModelsLoading,
    setServerCommands,
    setServerInfo,
    subscribeToSessionChanges,
    syncSessionKey,
    updateSessionMessagesSubscription,
  ]);

  const handleHistoryResponse = useCallback((resPayload: Record<string, unknown>) => {
    console.log(`[STREAM] handleHistoryResponse activeRunId=${activeRunIdRef.current} justFinalized=${justFinalizedRef.current}`);
    const allRawMsgs = Array.isArray(resPayload.messages) ? resPayload.messages as Array<Record<string, unknown>> : [];
    console.log(`[STREAM] handleHistoryResponse rawMsgCount=${allRawMsgs.length}`);
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
    const merged = mergeAndNormalizeToolResults(historyMessages);
    const finalMessages = injectPluginsFromHistory(merged);

    const inferredModel = inferCurrentModel(rawMessages);
    if (inferredModel) setCurrentModel(inferredModel);

    setMessages((prev: Message[]) => {
      const result = mergeHistoryWithOptimistic(finalMessages, prev);
      console.log(
        `[STREAM] handleHistoryResponse mergeHistoryWithOptimistic: prev=${prev.length}msgs → result=${result.length}msgs ` +
        `prevIds=[${prev.map(m => `${m.id}(${m.role})`).join(",")}] ` +
        `resultIds=[${result.map(m => `${m.id}(${m.role})`).join(",")}]`
      );
      return result;
    });

    const runInProgress = isRunInProgressFromHistory(rawMessages);
    const lifecycleActive = agentLifecycleActiveRef.current;
    console.log(`[STREAM] handleHistoryResponse runInProgress=${runInProgress} justFinalized=${justFinalizedRef.current} lifecycleActive=${lifecycleActive}`);
    if ((runInProgress || lifecycleActive) && !justFinalizedRef.current) {
      setAwaitingResponse(true);
      setIsStreaming(true);
      startHistoryPolling();
    } else {
      // Clear the finalized flag once the server confirms no run in progress,
      // or if we just finalized and the server hasn't caught up yet.
      if (!runInProgress) justFinalizedRef.current = false;
      stopHistoryPolling();
      console.log(`[STREAM] handleHistoryResponse: clearing streaming state (runInProgress=${runInProgress})`);
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
    setIsInitialConnecting(false);
    const shouldAutoScroll = !hasAutoScrolledInitialHistoryRef.current || sessionSwitching;
    if (shouldAutoScroll) onHistoryLoaded();
    hasAutoScrolledInitialHistoryRef.current = true;
  }, [
    clearStreamingRuntimeState,
    onHistoryLoaded,
    onHistoryLoadedAfterSwitch,
    onHistoryReceived,
    sessionSwitching,
    sendWS,
    setAwaitingResponse,
    setCurrentModel,
    setHistoryLoaded,
    setIsInitialConnecting,
    setIsStreaming,
    setMessages,
    setServerCommands,
    startHistoryPolling,
    stopHistoryPolling,
  ]);

  const applyRunDuration = useCallback((runId: string, runDuration: number) => {
    if (runDuration <= 0 || !runId) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === runId);
      const resolvedIdx = idx >= 0 ? idx : prev.findLastIndex((m) => m.role === "assistant" && !m.runDuration);
      if (resolvedIdx < 0) return prev;
      return updateAt(prev, resolvedIdx, (m) => ({ ...m, runDuration }));
    });
  }, [setMessages]);

  const handleChatEvent = useCallback((payload: ChatEventPayload) => {
    const msgRole = payload.message?.role || "none";
    const msgContentLen = payload.message ? (typeof payload.message.content === "string" ? payload.message.content.length : JSON.stringify(payload.message.content || []).length) : 0;
    console.log(
      `[STREAM] handleChatEvent state=${payload.state} runId=${payload.runId} ` +
      `session=${payload.sessionKey} msgRole=${msgRole} contentLen=${msgContentLen} ` +
      `activeRunId=${activeRunIdRef.current}`
    );

    if (payload.sessionKey !== sessionKeyRef.current) {
      console.log(`[STREAM] handleChatEvent: IGNORED (wrong session ${payload.sessionKey} != ${sessionKeyRef.current})`);
      if (payload.state === "final" || payload.state === "aborted" || payload.state === "error") {
        subagentStore.ingestChatEvent(payload.sessionKey, payload.state);
      }
      return;
    }

    // Internal "/commands" fetch uses cmdfetch-* idempotency keys as run IDs.
    // Suppress those events in all tabs to avoid polluting chat history/cross-tab UI.
    if (isInternalCommandFetchRunId(payload.runId)) {
      if (commandsFetchActiveRef.current) {
        if ((payload.state === "delta" || payload.state === "final") && payload.message?.role === "assistant") {
          const text = typeof payload.message.content === "string"
            ? payload.message.content
            : getTextFromContent(payload.message.content);
          commandsFetchBufferRef.current += text;
        }
        if (payload.state === "final") {
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
      }
      return;
    }

    switch (payload.state) {
      case "delta":
        console.log(`[STREAM] chat:delta runId=${payload.runId} role=${payload.message?.role || "?"}`);
        if (payload.message) {
          if (payload.message.role === "assistant") {
            beginContentArrival();
            justFinalizedRef.current = false;
            setIsStreaming(true);
            if (!activeRunIdRef.current) {
              console.log(`[STREAM] chat:delta: first delta, marking run start`);
              markRunStart();
            }
            activeRunIdRef.current = payload.runId;
            setStreamingId(payload.runId);
          }

          setMessages((prev: Message[]) => {
            console.log(`[STREAM] chat:delta setMessages prevCount=${prev.length} ids=[${prev.map(m => m.id).join(",")}]`);
            return upsertChatEventMessage(prev, payload);
          });
        }
        break;

      case "final": {
        console.log(`[STREAM] chat:final runId=${payload.runId} hasMessage=${!!payload.message}`);
        if (payload.message) {
          setMessages((prev) => {
            console.log(`[STREAM] chat:final setMessages prevCount=${prev.length} ids=[${prev.map(m => m.id).join(",")}]`);
            return upsertChatEventMessage(prev, payload);
          });
        }

        const hasActiveRun = !!activeRunIdRef.current;
        const isActiveRunFinal = !!payload.runId && payload.runId === activeRunIdRef.current;
        // Don't finalize while the agent lifecycle is still active — OpenClaw
        // sends intermediate chat:final events per response segment (e.g. before
        // and after tool calls). Only the final chat:final after lifecycle:end
        // should trigger cleanup.
        const shouldFinalizeRuntime = (!hasActiveRun || isActiveRunFinal) && !agentLifecycleActiveRef.current;
        console.log(`[STREAM] chat:final hasActiveRun=${hasActiveRun} isActiveRunFinal=${isActiveRunFinal} lifecycleActive=${agentLifecycleActiveRef.current} shouldFinalize=${shouldFinalizeRuntime}`);

        if (shouldFinalizeRuntime) {
          clearThinkingSource(payload.runId);
          const runDuration = markRunEnd();
          notifyForRun(payload.runId || activeRunIdRef.current);
          applyRunDuration(payload.runId, runDuration);

          stopHistoryPolling();
          clearStreamingRuntimeState({ clearRunId: true });
          justFinalizedRef.current = true;
          thinkTagStateRef.current = { insideThinkTag: false, tagBuffer: "" };
          subagentStore.clearAll();
          handleUnpinSubagent();
          fetchedSubhistoryRef.current.clear();
        }

        if (!queuedMessageRef.current && shouldFinalizeRuntime) {
          requestHistory();
          flushPendingHistoryRefresh();
        }
        break;
      }

      case "aborted": {
        if (activeRunIdRef.current && payload.runId && payload.runId !== activeRunIdRef.current) {
          if (!queuedMessageRef.current) requestHistory();
          break;
        }
        clearThinkingSource(payload.runId);
        markRunEnd();
        stopHistoryPolling();
        clearStreamingRuntimeState({ clearRunId: true });
        justFinalizedRef.current = true;
        subagentStore.clearAll();
        handleUnpinSubagent();
        fetchedSubhistoryRef.current.clear();
        if (!queuedMessageRef.current) {
          requestHistory();
          flushPendingHistoryRefresh();
        }
        break;
      }

      case "retrying":
        // Server is retrying after a rate-limit error — drop the partial
        // assistant message so the fresh stream creates a clean one.
        console.log(`[STREAM] chat:retrying runId=${payload.runId} — DROPPING partial message`);
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== payload.runId);
          console.log(`[STREAM] chat:retrying filtered ${prev.length} → ${filtered.length}`);
          return filtered;
        });
        clearThinkingSource(payload.runId);
        break;

      case "error": {
        if (activeRunIdRef.current && payload.runId && payload.runId !== activeRunIdRef.current) {
          if (!queuedMessageRef.current) requestHistory();
          break;
        }
        clearThinkingSource(payload.runId);
        markRunEnd();
        stopHistoryPolling();
        clearStreamingRuntimeState({ clearRunId: true });
        justFinalizedRef.current = true;
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
        if (!queuedMessageRef.current) {
          requestHistory();
          flushPendingHistoryRefresh();
        }
        break;
      }
    }
  }, [
    applyRunDuration,
    beginContentArrival,
    clearStreamingRuntimeState,
    clearThinkingSource,
    handleUnpinSubagent,
    markRunEnd,
    notifyForRun,
    queuedMessageRef,
    requestHistory,
    flushPendingHistoryRefresh,
    setIsStreaming,
    setMessages,
    setServerCommands,
    setStreamingId,
    stopHistoryPolling,
    subagentStore,
  ]);

  const handleAgentEvent = useCallback((payload: AgentEventPayload) => {
    const dataPreview = JSON.stringify(payload.data || {}).slice(0, 120);
    console.log(
      `[STREAM] handleAgentEvent stream=${payload.stream} runId=${payload.runId} ` +
      `session=${payload.sessionKey} activeRunId=${activeRunIdRef.current} data=${dataPreview}`
    );

    if (payload.sessionKey !== sessionKeyRef.current) {
      console.log(`[STREAM] handleAgentEvent: IGNORED (wrong session)`);
      subagentStore.ingestAgentEvent(payload.sessionKey, payload);
      return;
    }

    if (payload.stream === "lifecycle") {
      const phase = payload.data.phase as string;
      console.log(`[STREAM] agent:lifecycle phase=${phase} runId=${payload.runId} activeRunId=${activeRunIdRef.current}`);
      if (phase === "start") {
        agentLifecycleActiveRef.current = true;
        clearThinkingSource(payload.runId);
        const isExternalRun = !activeRunIdRef.current;
        markRunStart();
        setIsStreaming(true);
        activeRunIdRef.current = payload.runId;
        thinkTagStateRef.current = { insideThinkTag: false, tagBuffer: "" };
        if (isExternalRun) {
          console.log(`[STREAM] agent:lifecycle:start external run — starting history polling`);
          setAwaitingResponse(true);
          setThinkingStartTime(Date.now());
          startHistoryPolling();
        }
      } else if (phase === "end" || phase === "error") {
        agentLifecycleActiveRef.current = false;
        const runDuration = markRunEnd();
        applyRunDuration(payload.runId, runDuration);
        // Do NOT fetch history here — chat:final is the authoritative end-of-run
        // signal and arrives shortly after lifecycle:end. Fetching history now
        // races with chat:final: the history response replaces messages with
        // index-based IDs (hist-N) before chat:final can find the streaming
        // message by runId, causing duplicates or flicker.
        stopHistoryPolling();
      }
      return;
    }

    if (payload.stream === "tool") {
      const phase = payload.data.phase as string;
      const toolName = payload.data.name as string;
      const rawToolCallId = (payload.data.toolCallId || payload.data.tool_call_id) as string | undefined;
      const toolCallId = rawToolCallId || (toolName === SPAWN_TOOL_NAME ? `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` : undefined);
      console.log(`[STREAM] agent:tool phase=${phase} name=${toolName} tcid=${toolCallId || "none"} runId=${payload.runId}`);

      if (phase === "start" && toolName) {
        if (toolName === SPAWN_TOOL_NAME && toolCallId) {
          subagentStore.registerSpawn(toolCallId);
        }
        const narration = extractToolNarration(payload.data);
        addToolCall(
          payload.runId,
          toolName,
          payload.ts,
          toolCallId,
          serializeToolArgs(payload.data.args),
          narration,
        );
      } else if (phase === "result" && toolName) {
        const resultText = typeof payload.data.result === "string"
          ? payload.data.result
          : JSON.stringify(payload.data.result, null, 2);
        resolveToolCall(payload.runId, toolName, toolCallId, resultText, !!payload.data.isError);

        // Auto-mount plugin from known tool results (8claw MCP tools via OpenClaw)
        const pluginPart = pluginFromToolResult(toolName, resultText, !!payload.data.isError);
        if (pluginPart) {
          mountPluginPart(payload.runId, pluginPart, payload.ts);
        }
      }
    }

    if (payload.stream === "reasoning" || payload.stream === "thinking") {
      const streamSource = payload.stream as "reasoning" | "thinking";
      const deltaRaw = payload.data.delta ?? payload.data.text ?? payload.data.content;
      const delta = typeof deltaRaw === "string" ? deltaRaw : "";
      const hasDelta = delta.length > 0;
      const selected = thinkingSourceByRunRef.current.get(payload.runId);
      if (selected && selected !== streamSource) {
        return;
      }
      if (!selected && hasDelta) thinkingSourceByRunRef.current.set(payload.runId, streamSource);

      // Only honor block boundaries for the selected stream; avoid metadata-only
      // frames from locking or shaping thinking output.
      if (isReasoningBlockStart(payload.data) && (selected === streamSource || (!selected && hasDelta))) {
        startThinkingBlock(payload.runId, payload.ts);
      }
      if (delta.length > 0) {
        appendThinkingDelta(payload.runId, delta, payload.ts);
      }
    }

    // NOTE: The OpenClaw gateway sends text content as stream="assistant" (not
    // "content"). We intentionally do NOT handle "assistant" here because
    // event:chat deltas already carry the same text as batched snapshots.
    // Handling both would cause the two sources to fight over the same message
    // text part, producing visual jitter. Text rendering is driven solely by
    // chat events via upsertChatEventMessage; agent events drive tool calls,
    // thinking, plugins, and lifecycle only.
    if (payload.stream === "content") {
      const delta = (payload.data.delta || payload.data.text || payload.data.content || "") as string;
      if (!delta) return;
      appendContentDelta(payload.runId, delta, payload.ts);
      return;
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
  }, [
    addToolCall,
    appendContentDelta,
    appendThinkingDelta,
    applyRunDuration,
    clearThinkingSource,
    flushPendingHistoryRefresh,
    startThinkingBlock,
    markRunEnd,
    markRunStart,
    mountPluginPart,
    removePluginPart,
    replacePluginPart,
    requestHistory,
    resolveToolCall,
    setAwaitingResponse,
    setIsStreaming,
    setMessages,
    setThinkingStartTime,
    startHistoryPolling,
    subagentStore,
  ]);

  const handleConnectError = useCallback((error: GatewayError | string) => {
    const normalized = typeof error === "string" ? { code: "", message: error } : error;
    const errorCode = getGatewayErrorCode(normalized);
    const canRetryWithDeviceToken = normalized.details?.canRetryWithDeviceToken === true;
    const gatewayUrl = gatewayUrlRef.current;

    if (
      errorCode === "AUTH_TOKEN_MISMATCH"
      && canRetryWithDeviceToken
      && activeAuthCacheEntryRef.current?.deviceToken
      && !didRetryWithDeviceTokenRef.current
    ) {
      didRetryWithDeviceTokenRef.current = true;
      forcedDeviceTokenRef.current = activeAuthCacheEntryRef.current.deviceToken;
      reconnectMessageRef.current = "Gateway auth changed. Retrying with cached device approval.";
      setConnectionError(reconnectMessageRef.current);
      reconnectNowRef.current?.();
      return true;
    }

    if (
      errorCode === "AUTH_TOKEN_MISMATCH"
      && didRetryWithDeviceTokenRef.current
      && gatewayUrl
    ) {
      forcedDeviceTokenRef.current = null;
      void deleteGatewayAuthCacheEntry(gatewayUrl);
    }

    // Stale token: the signed payload included the wrong token. Re-fetch and retry once.
    if (
      errorCode === "DEVICE_AUTH_SIGNATURE_INVALID"
      && !didRetryWithFreshTokenRef.current
      && onTokenRefreshRef.current
    ) {
      didRetryWithFreshTokenRef.current = true;
      pendingTokenRefreshRef.current = true;
      const savedUrl = gatewayUrlRef.current;
      reconnectMessageRef.current = "Token may be stale. Refreshing\u2026";
      setConnectionError(reconnectMessageRef.current);
      if (gatewayUrl) void deleteGatewayAuthCacheEntry(gatewayUrl);
      void onTokenRefreshRef.current().then((newToken) => {
        pendingTokenRefreshRef.current = false;
        if (newToken != null && savedUrl) {
          gatewayTokenRef.current = newToken;
          connectFnRef.current?.(savedUrl);
        } else {
          setConnectionError(formatGatewayError(normalized));
        }
      }).catch(() => {
        pendingTokenRefreshRef.current = false;
        setConnectionError(formatGatewayError(normalized));
      });
      return true;
    }

    setConnectionError(formatGatewayError(normalized));
    return false;
  }, [setConnectionError]);

  const handleWSMessage = useCallback((data: WebSocketMessage) => {
    lastSocketActivityAtRef.current = Date.now();
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
      if (msg.id?.startsWith("conn-") && !msg.ok && msg.error) {
        handleConnectError(msg.error);
        return;
      }
      if (msg.ok && resPayload?.type === WS_HELLO_OK) {
        handleHelloOk(resPayload as unknown as HelloOkPayload);
        return;
      }
      if (msg.id?.startsWith("run-")) {
        if (!msg.ok && msg.error) {
          clearThinkingSource();
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
        } else if (msg.ok) {
          // Non-streaming commands (e.g. /new) only send a res with ok:true
          // and no subsequent streaming events, so clear streaming state here.
          clearStreamingRuntimeState({ clearRunId: true });
        }
        return;
      }
      if (msg.id?.startsWith("sessions-list-")) {
        handleSessionsListResponse(msg.ok && resPayload ? resPayload : {});
        return;
      }
      if (
        msg.id?.startsWith("sessions-subscribe-")
        || msg.id?.startsWith("sessions-unsubscribe-")
        || msg.id?.startsWith("session-messages-subscribe-")
        || msg.id?.startsWith("session-messages-unsubscribe-")
      ) {
        if (!msg.ok && msg.error) {
          setConnectionError(formatGatewayError(msg.error));
        }
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
        const errorMsg = formatGatewayError(msg.error);
        setConnectionError(errorMsg);
      }
      return;
    }

    if (msg.type === "event") {
      if (msg.event === "chat") {
        handleChatEvent(msg.payload as ChatEventPayload);
        return;
      }
      if (msg.event === "session.message" || msg.event === "session.tool") {
        const payload = msg.payload as SessionMessageEventPayload | SessionToolEventPayload | undefined;
        const eventSessionKey = extractSessionKeyFromPayload(payload as Record<string, unknown> | undefined);
        markSessionsDirty();
        if (!eventSessionKey || eventSessionKey !== sessionKeyRef.current) {
          scheduleSessionsRefresh();
          return;
        }
        if (activeRunIdRef.current) {
          pendingHistorySyncAfterRunRef.current = true;
          return;
        }
        scheduleHistoryRefresh();
        return;
      }
      if (msg.event === "sessions.changed") {
        scheduleSessionsRefresh();
        return;
      }
      if (msg.event === "tick" || msg.event === "heartbeat") {
        lastSocketActivityAtRef.current = Date.now();
        return;
      }
      if (msg.event === "shutdown") {
        const payload = msg.payload as ShutdownEventPayload | undefined;
        reconnectMessageRef.current = formatShutdownMessage(payload ?? {});
        setConnectionError(reconnectMessageRef.current);
        return;
      }
      if (msg.event === "canvas_update") {
        const payload = msg.payload as CanvasUpdateEventPayload;
        upsertCanvasPluginByMessageId(payload.messageId, payload.canvas);
        return;
      }
      if (msg.event === "agent") {
        handleAgentEvent(msg.payload as AgentEventPayload);
      }
    }
  }, [
    clearStreamingRuntimeState,
    clearThinkingSource,
    handleConnectError,
    handleAgentEvent,
    handleChatEvent,
    handleConnectChallenge,
    handleHelloOk,
    handleHistoryResponse,
    handleSessionsListResponse,
    markSessionsDirty,
    scheduleHistoryRefresh,
    scheduleSessionsRefresh,
    upsertCanvasPluginByMessageId,
    setAvailableModels,
    setConnectionError,
    setMessages,
    setModelsLoading,
    subagentStore,
  ]);

  const { connectionState, connect, reconnectNow, disconnect, sendMessage: sendWSMessage, isConnected, markEstablished } = useWebSocket({
    onMessage: handleWSMessage,
    onOpen: () => {
      lastSocketActivityAtRef.current = Date.now();
      reconnectMessageRef.current = null;
      setConnectionError(null);
    },
    onError: () => {
      setConnectionError("Connection error");
    },
    onInitialConnectFail: (info) => {
      if (pendingTokenRefreshRef.current) return; // token refresh will reconnect

      const reason = info?.reason ?? "";
      if (
        info?.code === 1008
        && isDeviceTokenMismatchReason(reason)
        && !didRetryAfterDeviceTokenMismatchRef.current
      ) {
        const url = gatewayUrlRef.current;
        if (url) {
          didRetryAfterDeviceTokenMismatchRef.current = true;
          pendingTokenRefreshRef.current = true;
          forcedDeviceTokenRef.current = null;
          activeAuthCacheEntryRef.current = null;
          reconnectMessageRef.current = "Device approval changed. Re-syncing authentication…";
          setConnectionError(reconnectMessageRef.current);

          void deleteGatewayAuthCacheEntry(url)
            .catch(() => {})
            .then(async () => {
              let refreshedToken: string | null | undefined = undefined;
              if (onTokenRefreshRef.current) {
                try {
                  refreshedToken = await onTokenRefreshRef.current();
                } catch {
                  refreshedToken = undefined;
                }
              }

              if (typeof refreshedToken === "string") {
                gatewayTokenRef.current = refreshedToken;
              }

              pendingTokenRefreshRef.current = false;
              connectFnRef.current?.(url);
            });
          return;
        }
      }

      // Transient gateway rejections (e.g., React double-mount race sending a
      // non-connect frame before the handshake) — retry up to 3 times.
      const MAX_TRANSIENT_RETRIES = 3;
      const isDeviceAuthError = reason.includes("signature") || reason.includes("device") || reason.includes("mismatch");
      if (
        info?.code === 1008
        && !isDeviceAuthError
        && transientRetryCountRef.current < MAX_TRANSIENT_RETRIES
      ) {
        const url = gatewayUrlRef.current;
        if (url) {
          transientRetryCountRef.current += 1;
          console.log(`[WS] Transient 1008 ("${reason}") — retry ${transientRetryCountRef.current}/${MAX_TRANSIENT_RETRIES}`);
          connectFnRef.current?.(url);
          return;
        }
      }

      setIsInitialConnecting(false);
      setConnectionError(info?.reason || "Could not reach server");
      if (!isDetachedRef.current && !isNativeRef.current) setShowSetup(true);
    },
    onInitialRetrying: () => {
      setIsInitialConnecting(true);
    },
    onClose: () => {
      stopHistoryPolling();
      clearHistoryRefreshTimer();
      clearSessionsRefreshTimer();
      clearStreamingRuntimeState();
      thinkingSourceByRunRef.current.clear();
      hasAutoScrolledInitialHistoryRef.current = false;
      pendingHistorySyncAfterRunRef.current = false;
      sessionsSubscribedRef.current = false;
      sessionMessagesSubscriptionKeyRef.current = null;
      gatewayFeaturesRef.current = null;
      gatewayPolicyRef.current = null;
    },
    onReconnecting: (attempt, delay) => {
      setConnectionError(reconnectMessageRef.current);
      console.log(`[Page] Reconnecting (attempt ${attempt}, ${delay}ms delay)`);
    },
    onReconnected: () => {
      lastSocketActivityAtRef.current = Date.now();
      reconnectMessageRef.current = null;
      console.log("[Page] Reconnected — re-handshake will follow via connect.challenge");
    },
  });

  const syncHistoryAfterResume = useCallback((reason: string, forceReconnect = false) => {
    if (backendMode !== "openclaw") return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (connectionState === "connecting" || connectionState === "reconnecting") return;

    const now = Date.now();
    if (now - lastResumeSyncAtRef.current < RESUME_SYNC_COOLDOWN_MS) return;
    lastResumeSyncAtRef.current = now;

    const inactiveFor = now - lastSocketActivityAtRef.current;
    const shouldForceReconnect = forceReconnect || inactiveFor >= RESUME_FORCE_RECONNECT_MS;
    if (shouldForceReconnect || connectionState !== "connected") {
      console.log(`[WS] Resume sync (${reason}) -> reconnect (inactive ${inactiveFor}ms)`);
      reconnectNow();
      return;
    }

    // Skip history refetch during an active run — the WS is already
    // delivering realtime events, and refetching would clobber streaming
    // state (e.g. plugin cards mounted during the run).
    if (activeRunIdRef.current) {
      console.log(`[WS] Resume sync (${reason}) skipped — run in progress`);
      return;
    }

    const sent = requestHistory();
    if (!sent) {
      console.log(`[WS] Resume sync (${reason}) history request failed -> reconnect`);
      reconnectNow();
    } else {
      console.log(`[WS] Resume sync (${reason}) requested chat.history`);
    }
  }, [backendMode, connectionState, reconnectNow, requestHistory]);

  useEffect(() => {
    if (backendMode !== "openclaw") return;

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;
      syncHistoryAfterResume("visibility", hiddenFor >= RESUME_FORCE_RECONNECT_MS);
    };

    const onFocus = () => syncHistoryAfterResume("focus");
    const onOnline = () => syncHistoryAfterResume("online", true);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [backendMode, syncHistoryAfterResume]);

  useEffect(() => {
    if (backendMode !== "openclaw") return;
    lastClockTickAtRef.current = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const gap = now - lastClockTickAtRef.current;
      lastClockTickAtRef.current = now;
      if (gap >= RESUME_FORCE_RECONNECT_MS) {
        syncHistoryAfterResume("clock-gap", true);
      }
    }, SLEEP_GAP_CHECK_MS);

    return () => clearInterval(timer);
  }, [backendMode, syncHistoryAfterResume]);

  useEffect(() => {
    sendWSMessageRef.current = sendWSMessage;
  }, [sendWSMessage]);

  useEffect(() => {
    markEstablishedRef.current = markEstablished;
  }, [markEstablished]);

  useEffect(() => {
    reconnectNowRef.current = reconnectNow;
  }, [reconnectNow]);

  const connectTracked = useCallback((url: string) => {
    const previousGatewayUrl = gatewayUrlRef.current;
    gatewayUrlRef.current = url;
    if (previousGatewayUrl !== url) {
      didRetryAfterDeviceTokenMismatchRef.current = false;
    }
    activeAuthCacheEntryRef.current = null;
    activeAuthTokenSha256Ref.current = "";
    forcedDeviceTokenRef.current = null;
    didRetryWithDeviceTokenRef.current = false;
    didRetryWithFreshTokenRef.current = false;
    pendingTokenRefreshRef.current = false;
    transientRetryCountRef.current = 0;
    reconnectMessageRef.current = null;
    pendingHistorySyncAfterRunRef.current = false;
    sessionsSubscribedRef.current = false;
    sessionMessagesSubscriptionKeyRef.current = null;
    gatewayFeaturesRef.current = null;
    gatewayPolicyRef.current = null;
    connect(url);
  }, [connect]);

  useEffect(() => {
    connectFnRef.current = connectTracked;
  }, [connectTracked]);

  const disconnectTracked = useCallback(() => {
    updateSessionMessagesSubscription(null);
    unsubscribeSessionChanges();
    clearHistoryRefreshTimer();
    clearSessionsRefreshTimer();
    pendingHistorySyncAfterRunRef.current = false;
    reconnectMessageRef.current = null;
    disconnect();
  }, [
    clearHistoryRefreshTimer,
    clearSessionsRefreshTimer,
    disconnect,
    unsubscribeSessionChanges,
    updateSessionMessagesSubscription,
  ]);

  const clearForSessionSwitch = useCallback(() => {
    clearHistoryRefreshTimer();
    stopHistoryPolling();
    clearStreamingRuntimeState({ clearRunId: true });
    thinkingSourceByRunRef.current.clear();
    setMessages([]);
    setHistoryLoaded(false);
    setCurrentModel(null);
    subagentStore.clearAll();
    handleUnpinSubagent();
    fetchedSubhistoryRef.current.clear();
    hasAutoScrolledInitialHistoryRef.current = false;
    pendingHistorySyncAfterRunRef.current = false;
  }, [
    clearHistoryRefreshTimer,
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
    updateSessionMessagesSubscription(key);
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
    updateSessionMessagesSubscription,
  ]);

  // ── Phase 2: Post state changes to native shell ──────────────────────────
  useEffect(() => {
    if (!isNativeRef.current) return;
    postConnectionState(connectionState);
  }, [connectionState, isNativeRef]);

  useEffect(() => {
    if (!isNativeRef.current) return;
    const isActive = !!activeRunIdRef.current;
    postRunState(isActive, false);
    // We can't directly depend on activeRunIdRef.current, but connectionState
    // changes indirectly trigger this. The streaming hooks below cover run state.
  }, [connectionState, isNativeRef]);

  useEffect(() => {
    if (!isNativeRef.current) return;
    postSessionsState(sessions, currentSessionKey);
  }, [sessions, currentSessionKey, isNativeRef]);

  return {
    connectionState,
    connect: connectTracked,
    disconnect: disconnectTracked,
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
