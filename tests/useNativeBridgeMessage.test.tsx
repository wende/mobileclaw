import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { useNativeBridgeMessage } from "@/hooks/chat/useNativeBridgeMessage";
import type { ConnectionConfig, Message } from "@/types/chat";

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

  it("handles messages:append by adding to messages", () => {
    const setMessages = vi.fn();
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions({ setMessages })));

    act(() => {
      result.current({
        type: "messages:append",
        payload: { role: "user", content: [{ type: "text", text: "hi" }], id: "u-1" },
      });
    });

    expect(setMessages).toHaveBeenCalledTimes(1);
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
