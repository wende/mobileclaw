import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

vi.mock("@mc/lib/nativeBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mc/lib/nativeBridge")>();
  return {
    ...actual,
    resolveIdentitySign: vi.fn(),
    resolveNativeGatewayAuthGet: vi.fn(),
  };
});

import { PIN_LOCK_MS } from "@mc/hooks/useScrollManager";
import { useNativeBridgeMessage } from "@mc/hooks/chat/useNativeBridgeMessage";
import { resolveIdentitySign, resolveNativeGatewayAuthGet } from "@mc/lib/nativeBridge";
import type { ConnectionConfig, Message } from "@mc/types/chat";

function createOptions(overrides: Partial<Parameters<typeof useNativeBridgeMessage>[0]> = {}) {
  return {
    setMessages: vi.fn() as Dispatch<SetStateAction<Message[]>>,
    pinnedToBottomRef: { current: false } as MutableRefObject<boolean>,
    pinLockUntilRef: { current: 0 } as MutableRefObject<number>,
    setZenModeEnabled: vi.fn(),
    scrollToBottom: vi.fn(),
    handleConnect: vi.fn() as (config: ConnectionConfig) => void,
    onNativeSend: vi.fn(),
    onNativeAbort: vi.fn(),
    onNativeSessionSelect: vi.fn(),
    onNativeRequestHistory: vi.fn(),
    onNativeRequestSessionsList: vi.fn(),
    ...overrides,
  };
}

describe("useNativeBridgeMessage", () => {
  it("applies zen mode when the native bridge sends zen:set", () => {
    const setZenModeEnabled = vi.fn();
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions({ setZenModeEnabled })));

    act(() => {
      result.current({ type: "zen:set", payload: { enabled: true } });
    });

    expect(setZenModeEnabled).toHaveBeenCalledTimes(1);
    expect(setZenModeEnabled).toHaveBeenCalledWith(true);
  });

  it("ignores zen:set payloads without a boolean enabled field", () => {
    const setZenModeEnabled = vi.fn();
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions({ setZenModeEnabled })));

    act(() => {
      result.current({ type: "zen:set", payload: { enabled: "yes" } });
      result.current({ type: "zen:set", payload: {} });
      result.current({ type: "zen:set" });
    });

    expect(setZenModeEnabled).not.toHaveBeenCalled();
  });

  it("handles config:connection by calling handleConnect", () => {
    const handleConnect = vi.fn();
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions({ handleConnect })));

    act(() => {
      result.current({
        type: "config:connection",
        payload: { mode: "openclaw", url: "ws://localhost:8080", token: "abc" },
      });
    });

    expect(handleConnect).toHaveBeenCalledTimes(1);
    expect(handleConnect).toHaveBeenCalledWith({
      mode: "openclaw",
      url: "ws://localhost:8080",
      token: "abc",
      model: undefined,
      remember: false,
    });
  });

  it("handles identity:signResponse by calling resolveIdentitySign", () => {
    const payload = {
      callbackId: "idcb-1",
      deviceId: "dev-1",
      publicKey: "pk",
      signature: "sig",
      signedAt: 123,
      nonce: "nonce-1",
    };
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions()));

    act(() => {
      result.current({ type: "identity:signResponse", payload });
    });

    expect(resolveIdentitySign).toHaveBeenCalledTimes(1);
    expect(resolveIdentitySign).toHaveBeenCalledWith(payload);
  });

  it("handles gatewayAuth:getResponse by calling resolveNativeGatewayAuthGet", () => {
    const payload = {
      callbackId: "gacb-1",
      raw: "{\"ws://localhost:18789\":{\"deviceToken\":\"devtok\"}}",
    };
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions()));

    act(() => {
      result.current({ type: "gatewayAuth:getResponse", payload });
    });

    expect(resolveNativeGatewayAuthGet).toHaveBeenCalledTimes(1);
    expect(resolveNativeGatewayAuthGet).toHaveBeenCalledWith(payload);
  });

  it("handles action:send by calling onNativeSend", () => {
    const onNativeSend = vi.fn();
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions({ onNativeSend })));

    act(() => {
      result.current({ type: "action:send", payload: { text: "hello" } });
    });

    expect(onNativeSend).toHaveBeenCalledWith("hello");
  });

  it("handles action:abort by calling onNativeAbort", () => {
    const onNativeAbort = vi.fn();
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions({ onNativeAbort })));

    act(() => {
      result.current({ type: "action:abort" });
    });

    expect(onNativeAbort).toHaveBeenCalledTimes(1);
  });

  it("handles action:switchSession by calling onNativeSessionSelect", () => {
    const onNativeSessionSelect = vi.fn();
    const { result } = renderHook(() =>
      useNativeBridgeMessage(createOptions({ onNativeSessionSelect })),
    );

    act(() => {
      result.current({ type: "action:switchSession", payload: { key: "session-2" } });
    });

    expect(onNativeSessionSelect).toHaveBeenCalledTimes(1);
    expect(onNativeSessionSelect).toHaveBeenCalledWith("session-2");
  });

  it("handles action:requestHistory by calling onNativeRequestHistory", () => {
    const onNativeRequestHistory = vi.fn();
    const { result } = renderHook(() =>
      useNativeBridgeMessage(createOptions({ onNativeRequestHistory })),
    );

    act(() => {
      result.current({ type: "action:requestHistory" });
    });

    expect(onNativeRequestHistory).toHaveBeenCalledTimes(1);
  });

  it("handles action:requestSessionsList by calling onNativeRequestSessionsList", () => {
    const onNativeRequestSessionsList = vi.fn();
    const { result } = renderHook(() =>
      useNativeBridgeMessage(createOptions({ onNativeRequestSessionsList })),
    );

    act(() => {
      result.current({ type: "action:requestSessionsList" });
    });

    expect(onNativeRequestSessionsList).toHaveBeenCalledTimes(1);
  });

  it("handles messages:append by adding to messages and updating scroll lock", () => {
    const setMessages = vi.fn();
    const options = createOptions({ setMessages });
    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const { result } = renderHook(() => useNativeBridgeMessage(options));

    act(() => {
      result.current({
        type: "messages:append",
        payload: { role: "user", content: [{ type: "text", text: "hi" }], id: "u-1" },
      });
    });

    expect(setMessages).toHaveBeenCalledTimes(1);
    expect(options.pinnedToBottomRef.current).toBe(true);
    expect(options.pinLockUntilRef.current).toBe(now + PIN_LOCK_MS);
    nowSpy.mockRestore();
  });

  it("handles theme:set by toggling the dark class", () => {
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions()));
    const html = document.documentElement;
    html.classList.remove("dark");

    act(() => {
      result.current({ type: "theme:set", payload: { theme: "dark" } });
    });
    expect(html.classList.contains("dark")).toBe(true);

    act(() => {
      result.current({ type: "theme:set", payload: { theme: "light" } });
    });
    expect(html.classList.contains("dark")).toBe(false);
  });

  it("handles scroll:toBottom by calling scrollToBottom", () => {
    const scrollToBottom = vi.fn();
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions({ scrollToBottom })));

    act(() => {
      result.current({ type: "scroll:toBottom" });
    });

    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });
});
