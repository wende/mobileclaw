import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useWebSocket } from "@mc/lib/useWebSocket";

// ── Mock WebSocket ──────────────────────────────────────────────────────────

type WSListener = (ev: Record<string, unknown>) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0; // CONNECTING
  onopen: WSListener | null = null;
  onclose: WSListener | null = null;
  onerror: WSListener | null = null;
  onmessage: WSListener | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3; // CLOSED
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  /** Simulate the server accepting the TCP/WS connection. */
  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }

  /** Simulate the connection closing (server or network). */
  simulateClose(code = 1006, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  /** Simulate receiving a message. */
  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Simulate an error event. */
  simulateError() {
    this.onerror?.({});
  }
}

// Replace global WebSocket
const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  vi.useFakeTimers();
});

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket;
  vi.useRealTimers();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Get the most recently created MockWebSocket instance. */
function lastWS(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useWebSocket — initial retry logic", () => {
  it("retries when connection closes before markEstablished", () => {
    const onInitialRetrying = vi.fn();
    const onInitialConnectFail = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({ onInitialRetrying, onInitialConnectFail }),
    );

    act(() => { result.current.connect("ws://test"); });
    const ws1 = lastWS();

    act(() => { ws1.simulateOpen(); });
    act(() => { ws1.simulateClose(); });

    expect(onInitialRetrying).toHaveBeenCalledWith(1);
    expect(onInitialConnectFail).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1500); });

    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("retries when connection fails to open (immediate close)", () => {
    const onInitialRetrying = vi.fn();
    const onInitialConnectFail = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({ onInitialRetrying, onInitialConnectFail }),
    );

    act(() => { result.current.connect("ws://test"); });
    const ws1 = lastWS();

    act(() => { ws1.simulateClose(); });

    expect(onInitialRetrying).toHaveBeenCalledWith(1);
    expect(onInitialConnectFail).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1500); });
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("calls onInitialConnectFail after exhausting all retries", () => {
    const onInitialRetrying = vi.fn();
    const onInitialConnectFail = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({ onInitialRetrying, onInitialConnectFail }),
    );

    act(() => { result.current.connect("ws://test"); });

    for (let i = 0; i < 20; i++) {
      act(() => { lastWS().simulateClose(); });
      act(() => { vi.advanceTimersByTime(1500); });
    }

    expect(MockWebSocket.instances.length).toBe(21);
    expect(onInitialRetrying).toHaveBeenCalledTimes(20);

    act(() => { lastWS().simulateClose(); });
    expect(onInitialConnectFail).toHaveBeenCalledTimes(1);
  });

  it("resets retry counter on successful open", () => {
    const onInitialRetrying = vi.fn();
    const onInitialConnectFail = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({ onInitialRetrying, onInitialConnectFail }),
    );

    act(() => { result.current.connect("ws://test"); });

    for (let i = 0; i < 5; i++) {
      act(() => { lastWS().simulateClose(); });
      act(() => { vi.advanceTimersByTime(1500); });
    }

    expect(onInitialRetrying).toHaveBeenCalledTimes(5);

    act(() => { lastWS().simulateOpen(); });

    expect(result.current.connectionState).toBe("connected");
    expect(onInitialConnectFail).not.toHaveBeenCalled();
  });

  it("resets retry counter on fresh connect() call", () => {
    const onInitialRetrying = vi.fn();
    const onInitialConnectFail = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({ onInitialRetrying, onInitialConnectFail }),
    );

    act(() => { result.current.connect("ws://test"); });

    for (let i = 0; i < 5; i++) {
      act(() => { lastWS().simulateClose(); });
      act(() => { vi.advanceTimersByTime(1500); });
    }
    expect(onInitialRetrying).toHaveBeenCalledTimes(5);

    act(() => { result.current.connect("ws://other-url"); });
    onInitialRetrying.mockClear();

    act(() => { lastWS().simulateClose(); });
    expect(onInitialRetrying).toHaveBeenCalledWith(1);
  });

  it("stops retrying if disconnect() is called during retry window", () => {
    const onInitialRetrying = vi.fn();
    const onInitialConnectFail = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({ onInitialRetrying, onInitialConnectFail }),
    );

    act(() => { result.current.connect("ws://test"); });
    act(() => { lastWS().simulateClose(); });

    expect(onInitialRetrying).toHaveBeenCalledTimes(1);
    const instancesBefore = MockWebSocket.instances.length;

    act(() => { result.current.disconnect(); });

    act(() => { vi.advanceTimersByTime(1500); });
    expect(MockWebSocket.instances.length).toBe(instancesBefore);
    expect(onInitialConnectFail).not.toHaveBeenCalled();
    expect(result.current.connectionState).toBe("disconnected");
  });

  it("does not retry after markEstablished (uses reconnect backoff instead)", () => {
    const onInitialRetrying = vi.fn();
    const onInitialConnectFail = vi.fn();
    const onReconnecting = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({ onInitialRetrying, onInitialConnectFail, onReconnecting }),
    );

    act(() => { result.current.connect("ws://test"); });
    act(() => { lastWS().simulateOpen(); });

    act(() => { result.current.markEstablished(); });

    act(() => { lastWS().simulateClose(); });

    expect(onInitialRetrying).not.toHaveBeenCalled();
    expect(onInitialConnectFail).not.toHaveBeenCalled();
    expect(onReconnecting).toHaveBeenCalledTimes(1);
  });

  it("fires onInitialRetrying with incrementing attempt numbers", () => {
    const onInitialRetrying = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({ onInitialRetrying }),
    );

    act(() => { result.current.connect("ws://test"); });

    for (let i = 0; i < 3; i++) {
      act(() => { lastWS().simulateClose(); });
      act(() => { vi.advanceTimersByTime(1500); });
    }

    expect(onInitialRetrying).toHaveBeenNthCalledWith(1, 1);
    expect(onInitialRetrying).toHaveBeenNthCalledWith(2, 2);
    expect(onInitialRetrying).toHaveBeenNthCalledWith(3, 3);
  });

  it("succeeds mid-retry when server becomes available", () => {
    const onInitialRetrying = vi.fn();
    const onInitialConnectFail = vi.fn();
    const onOpen = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({ onInitialRetrying, onInitialConnectFail, onOpen }),
    );

    act(() => { result.current.connect("ws://test"); });

    for (let i = 0; i < 3; i++) {
      act(() => { lastWS().simulateClose(); });
      act(() => { vi.advanceTimersByTime(1500); });
    }

    act(() => { lastWS().simulateOpen(); });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(result.current.connectionState).toBe("connected");
    expect(onInitialConnectFail).not.toHaveBeenCalled();
    expect(onInitialRetrying).toHaveBeenCalledTimes(3);
  });
});
