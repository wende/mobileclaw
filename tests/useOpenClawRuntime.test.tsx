import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { Command } from "@mc/components/CommandSheet";
import { useOpenClawRuntime } from "@mc/hooks/chat/useOpenClawRuntime";
import type { Message } from "@mc/types/chat";

const runtimeMocks = vi.hoisted(() => ({
  syncSessionKey: vi.fn(),
  markSessionsDirty: vi.fn(),
  requestSessionsList: vi.fn(),
  handleSessionsListResponse: vi.fn(),
  openSheet: vi.fn(),
  closeSheet: vi.fn(),
  switchSession: vi.fn(),
  onHistoryLoadedAfterSwitch: vi.fn(),
  onHistoryReceived: vi.fn(),
  sendMessage: vi.fn(() => true),
  connect: vi.fn(),
  reconnectNow: vi.fn(),
  disconnect: vi.fn(),
  markEstablished: vi.fn(),
  signConnectChallenge: vi.fn(async () => ({
    id: "device-1",
    publicKey: "pk",
    signature: "sig",
    signedAt: 123,
    nonce: "nonce-1",
  })),
  getGatewayClientMetadata: vi.fn(() => ({
    platform: "ios",
    deviceFamily: "mobile",
    locale: "en-US",
    userAgent: "MobileClawTest/1.0",
  })),
  getGatewayAuthCacheEntry: vi.fn(),
  persistHelloOkAuth: vi.fn(async () => null),
  deleteGatewayAuthCacheEntry: vi.fn(async () => {}),
  hashAuthToken: vi.fn(async (token: string | null | undefined) => `hash:${token ?? ""}`),
  webSocketOptions: undefined as any,
}));

vi.mock("@mc/hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({
    pullContentRef: { current: null },
    pullSpinnerRef: { current: null },
    isPullingRef: { current: false },
    onHistoryReceived: runtimeMocks.onHistoryReceived,
  }),
}));

vi.mock("@mc/hooks/useSessionSwitcher", () => ({
  useSessionSwitcher: () => ({
    sessions: [],
    sessionsLoading: false,
    currentSessionKey: "main",
    sessionSwitching: false,
    sheetOpen: false,
    requestSessionsList: runtimeMocks.requestSessionsList,
    handleSessionsListResponse: runtimeMocks.handleSessionsListResponse,
    openSheet: runtimeMocks.openSheet,
    closeSheet: runtimeMocks.closeSheet,
    switchSession: runtimeMocks.switchSession,
    onHistoryLoadedAfterSwitch: runtimeMocks.onHistoryLoadedAfterSwitch,
    syncSessionKey: runtimeMocks.syncSessionKey,
    markSessionsDirty: runtimeMocks.markSessionsDirty,
  }),
}));

vi.mock("@mc/lib/useWebSocket", () => ({
  useWebSocket: vi.fn((options) => {
    runtimeMocks.webSocketOptions = options;
    return {
      connectionState: "connected",
      connect: runtimeMocks.connect,
      reconnectNow: runtimeMocks.reconnectNow,
      disconnect: runtimeMocks.disconnect,
      sendMessage: runtimeMocks.sendMessage,
      isConnected: true,
      markEstablished: runtimeMocks.markEstablished,
    };
  }),
}));

vi.mock("@mc/lib/deviceIdentity", () => ({
  signConnectChallenge: runtimeMocks.signConnectChallenge,
}));

vi.mock("@mc/lib/gatewayClientMetadata", () => ({
  DEFAULT_GATEWAY_CLIENT_ID: "openclaw-control-ui",
  DEFAULT_GATEWAY_CLIENT_MODE: "webchat",
  DEFAULT_GATEWAY_SCOPES: [
    "operator.read",
    "operator.write",
    "operator.admin",
    "operator.approvals",
    "operator.pairing",
  ],
  getGatewayClientMetadata: runtimeMocks.getGatewayClientMetadata,
}));

vi.mock("@mc/lib/gatewayAuth", () => ({
  buildGatewayAuthCacheEntry: vi.fn(),
  deleteGatewayAuthCacheEntry: runtimeMocks.deleteGatewayAuthCacheEntry,
  getGatewayAuthCacheEntry: runtimeMocks.getGatewayAuthCacheEntry,
  hashAuthToken: runtimeMocks.hashAuthToken,
  persistHelloOkAuth: runtimeMocks.persistHelloOkAuth,
}));

function createOptions() {
  return {
    backendMode: "openclaw" as const,
    isNative: false,
    useDocumentScroll: false,
    isDetachedRef: { current: false } as React.MutableRefObject<boolean>,
    isNativeRef: { current: false } as React.MutableRefObject<boolean>,
    scrollRef: { current: null } as React.RefObject<HTMLDivElement | null>,
    setConnectionError: vi.fn(),
    setShowSetup: vi.fn(),
    setServerInfo: vi.fn(),
    setCurrentModel: vi.fn(),
    setAvailableModels: vi.fn(),
    setModelsLoading: vi.fn(),
    setServerCommands: vi.fn() as React.Dispatch<React.SetStateAction<Command[]>>,
    setMessages: vi.fn() as React.Dispatch<React.SetStateAction<Message[]>>,
    setAwaitingResponse: vi.fn(),
    setIsStreaming: vi.fn(),
    setStreamingId: vi.fn(),
    setHistoryLoaded: vi.fn(),
    setIsInitialConnecting: vi.fn(),
    onHistoryLoaded: vi.fn(),
    beginContentArrival: vi.fn(),
    setThinkingStartTime: vi.fn(),
    markRunStart: vi.fn(),
    markRunEnd: vi.fn(() => 5),
    notifyForRun: vi.fn(),
    handleUnpinSubagent: vi.fn(),
    queuedMessageRef: { current: null } as React.RefObject<{ text: string; attachments?: unknown[] } | null>,
    subagentStore: {
      ingestChatEvent: vi.fn(),
      ingestAgentEvent: vi.fn(),
      getEntriesForToolCall: vi.fn(() => null),
      getEntriesForSession: vi.fn(() => null),
      loadFromHistory: vi.fn(),
      versionRef: { current: 0 } as React.RefObject<number>,
      clearAll: vi.fn(),
      registerSpawn: vi.fn(),
    },
    appendContentDelta: vi.fn(),
    appendThinkingDelta: vi.fn(),
    startThinkingBlock: vi.fn(),
    addToolCall: vi.fn(),
    resolveToolCall: vi.fn(),
    mountPluginPart: vi.fn(),
    replacePluginPart: vi.fn(),
    removePluginPart: vi.fn(),
    upsertCanvasPluginByMessageId: vi.fn(),
  };
}

async function emitWebSocketMessage(message: unknown) {
  await act(async () => {
    runtimeMocks.webSocketOptions?.onMessage?.(message);
    await Promise.resolve();
  });
}

describe("useOpenClawRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runtimeMocks.webSocketOptions = undefined;
    runtimeMocks.sendMessage.mockClear();
    runtimeMocks.connect.mockClear();
    runtimeMocks.reconnectNow.mockClear();
    runtimeMocks.disconnect.mockClear();
    runtimeMocks.markEstablished.mockClear();
    runtimeMocks.syncSessionKey.mockClear();
    runtimeMocks.markSessionsDirty.mockClear();
    runtimeMocks.requestSessionsList.mockClear();
    runtimeMocks.handleSessionsListResponse.mockClear();
    runtimeMocks.openSheet.mockClear();
    runtimeMocks.closeSheet.mockClear();
    runtimeMocks.switchSession.mockClear();
    runtimeMocks.onHistoryLoadedAfterSwitch.mockClear();
    runtimeMocks.onHistoryReceived.mockClear();
    runtimeMocks.signConnectChallenge.mockClear();
    runtimeMocks.getGatewayClientMetadata.mockClear();
    runtimeMocks.getGatewayAuthCacheEntry.mockReset();
    runtimeMocks.getGatewayAuthCacheEntry.mockResolvedValue(null);
    runtimeMocks.persistHelloOkAuth.mockClear();
    runtimeMocks.deleteGatewayAuthCacheEntry.mockClear();
    runtimeMocks.hashAuthToken.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists hello-ok auth and subscribes only when the gateway advertises session capabilities", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useOpenClawRuntime(options));

    act(() => {
      result.current.connect("ws://localhost:18789");
    });

    await emitWebSocketMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1", ts: 1 },
    });

    await emitWebSocketMessage({
      type: "res",
      id: "conn-1",
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        server: { version: "2026.4", connId: "conn-123" },
        features: {
          methods: ["sessions.subscribe", "sessions.messages.subscribe"],
          events: ["sessions.changed", "session.message"],
        },
        snapshot: { sessionDefaults: { mainSessionKey: "main" } },
        auth: {
          deviceToken: "device-token-1",
          role: "operator",
          scopes: ["operator.read", "operator.write"],
          issuedAtMs: 123,
        },
        policy: { maxPayload: 1024, maxBufferedBytes: 2048, tickIntervalMs: 15000 },
      },
    });

    expect(runtimeMocks.markEstablished).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.syncSessionKey).toHaveBeenCalledWith("main");
    expect(runtimeMocks.persistHelloOkAuth).toHaveBeenCalledWith(
      "ws://localhost:18789",
      expect.objectContaining({ deviceToken: "device-token-1" }),
      "hash:",
    );
    expect(runtimeMocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ method: "sessions.subscribe" }));
    expect(runtimeMocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      method: "sessions.messages.subscribe",
      params: { key: "main" },
    }));
    expect(runtimeMocks.requestSessionsList).toHaveBeenCalledTimes(1);
  });

  it("reuses a cached device token when the auth token hash still matches", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useOpenClawRuntime(options));

    runtimeMocks.getGatewayAuthCacheEntry.mockResolvedValue({
      deviceToken: "cached-device-token",
      role: "operator",
      scopes: ["operator.read"],
      authTokenSha256: "hash:secret",
      updatedAtMs: 1,
    });

    act(() => {
      result.current.connect("ws://localhost:18789");
      result.current.gatewayTokenRef.current = "secret";
    });

    await emitWebSocketMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1", ts: 1 },
    });

    expect(runtimeMocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      method: "connect",
      params: expect.objectContaining({
        auth: { deviceToken: "cached-device-token" },
      }),
    }));
    expect(runtimeMocks.signConnectChallenge).toHaveBeenCalledWith(expect.objectContaining({
      nonce: "nonce-1",
      token: "cached-device-token",
      platform: "ios",
      deviceFamily: "mobile",
    }));
  });

  it("does not send session subscribe requests when the gateway omits those methods", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useOpenClawRuntime(options));

    act(() => {
      result.current.connect("ws://localhost:18789");
    });

    await emitWebSocketMessage({
      type: "res",
      id: "conn-1",
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        server: { version: "2026.4", connId: "conn-123" },
        features: {
          methods: [],
          events: [],
        },
        snapshot: { sessionDefaults: { mainSessionKey: "main" } },
        policy: { maxPayload: 1024, maxBufferedBytes: 2048, tickIntervalMs: 15000 },
      },
    });

    expect(runtimeMocks.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ method: "sessions.subscribe" }));
    expect(runtimeMocks.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ method: "sessions.messages.subscribe" }));
  });

  it("retries exactly once with the cached device token on AUTH_TOKEN_MISMATCH", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useOpenClawRuntime(options));

    runtimeMocks.getGatewayAuthCacheEntry.mockResolvedValue({
      deviceToken: "cached-device-token",
      role: "operator",
      scopes: ["operator.read"],
      authTokenSha256: "hash:secret",
      updatedAtMs: 1,
    });

    act(() => {
      result.current.connect("ws://localhost:18789");
      result.current.gatewayTokenRef.current = "secret";
    });

    await emitWebSocketMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1", ts: 1 },
    });

    act(() => {
      runtimeMocks.webSocketOptions?.onMessage?.({
        type: "res",
        id: "conn-1",
        ok: false,
        error: {
          code: "AUTH_TOKEN_MISMATCH",
          message: "Shared secret changed",
          details: {
            code: "AUTH_TOKEN_MISMATCH",
            canRetryWithDeviceToken: true,
          },
        },
      });
    });

    expect(runtimeMocks.reconnectNow).toHaveBeenCalledTimes(1);
    expect(options.setConnectionError).toHaveBeenCalledWith(
      "Gateway auth changed. Retrying with cached device approval.",
    );
  });

  it("clears stale cached device approval when the retry also mismatches", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useOpenClawRuntime(options));

    runtimeMocks.getGatewayAuthCacheEntry.mockResolvedValue({
      deviceToken: "cached-device-token",
      role: "operator",
      scopes: ["operator.read"],
      authTokenSha256: "hash:secret",
      updatedAtMs: 1,
    });

    act(() => {
      result.current.connect("ws://localhost:18789");
      result.current.gatewayTokenRef.current = "secret";
    });

    await emitWebSocketMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1", ts: 1 },
    });

    act(() => {
      runtimeMocks.webSocketOptions?.onMessage?.({
        type: "res",
        id: "conn-1",
        ok: false,
        error: {
          code: "AUTH_TOKEN_MISMATCH",
          message: "Shared secret changed",
          details: {
            code: "AUTH_TOKEN_MISMATCH",
            canRetryWithDeviceToken: true,
          },
        },
      });
      runtimeMocks.webSocketOptions?.onMessage?.({
        type: "res",
        id: "conn-2",
        ok: false,
        error: {
          code: "AUTH_TOKEN_MISMATCH",
          message: "Shared secret changed",
          details: {
            code: "AUTH_TOKEN_MISMATCH",
            canRetryWithDeviceToken: true,
          },
        },
      });
    });

    expect(runtimeMocks.deleteGatewayAuthCacheEntry).toHaveBeenCalledWith("ws://localhost:18789");
  });

  it("surfaces device auth errors without retrying", () => {
    const options = createOptions();
    renderHook(() => useOpenClawRuntime(options));

    act(() => {
      runtimeMocks.webSocketOptions?.onMessage?.({
        type: "res",
        id: "conn-1",
        ok: false,
        error: {
          code: "DEVICE_AUTH_SIGNATURE_INVALID",
          message: "device signature invalid",
          details: { code: "DEVICE_AUTH_SIGNATURE_INVALID" },
        },
      });
    });

    expect(runtimeMocks.reconnectNow).not.toHaveBeenCalled();
    expect(options.setConnectionError).toHaveBeenCalledWith(
      "Device authentication failed: device signature invalid",
    );
  });

  it("debounces session invalidation events into history and session refresh requests", () => {
    const options = createOptions();
    renderHook(() => useOpenClawRuntime(options));

    act(() => {
      runtimeMocks.webSocketOptions?.onMessage?.({
        type: "event",
        event: "sessions.changed",
        payload: { reason: "updated" },
      });
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(runtimeMocks.requestSessionsList).toHaveBeenCalledTimes(1);

    act(() => {
      runtimeMocks.webSocketOptions?.onMessage?.({
        type: "event",
        event: "session.message",
        payload: { sessionKey: "main", messageId: "msg-1" },
      });
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(runtimeMocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      method: "chat.history",
      params: { sessionKey: "main" },
    }));
  });
});
