import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { useNativeBridgeMessage } from "@/hooks/chat/useNativeBridgeMessage";
import type { Message } from "@/types/chat";

function createOptions(setZenModeEnabled: (enabled: boolean) => void) {
  return {
    setMessages: vi.fn() as Dispatch<SetStateAction<Message[]>>,
    setHistoryLoaded: vi.fn() as Dispatch<SetStateAction<boolean>>,
    pinnedToBottomRef: { current: false } as MutableRefObject<boolean>,
    pinLockUntilRef: { current: 0 } as MutableRefObject<number>,
    setIsStreaming: vi.fn(),
    setStreamingId: vi.fn() as Dispatch<SetStateAction<string | null>>,
    setAwaitingResponse: vi.fn(),
    setThinkingStartTime: vi.fn() as Dispatch<SetStateAction<number | null>>,
    appendContentDelta: vi.fn(),
    appendThinkingDelta: vi.fn(),
    startThinkingBlock: vi.fn(),
    addToolCall: vi.fn(),
    resolveToolCall: vi.fn(),
    setZenModeEnabled,
    scrollToBottom: vi.fn(),
    subagentStore: { clearAll: vi.fn() } as any,
  };
}

describe("useNativeBridgeMessage", () => {
  it("applies zen mode when the native bridge sends zen:set", () => {
    const setZenModeEnabled = vi.fn();
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions(setZenModeEnabled)));

    act(() => {
      result.current({ type: "zen:set", payload: { enabled: true } });
    });

    expect(setZenModeEnabled).toHaveBeenCalledTimes(1);
    expect(setZenModeEnabled).toHaveBeenCalledWith(true);
  });

  it("ignores zen:set payloads without a boolean enabled field", () => {
    const setZenModeEnabled = vi.fn();
    const { result } = renderHook(() => useNativeBridgeMessage(createOptions(setZenModeEnabled)));

    act(() => {
      result.current({ type: "zen:set", payload: { enabled: "yes" } });
      result.current({ type: "zen:set", payload: {} });
      result.current({ type: "zen:set" });
    });

    expect(setZenModeEnabled).not.toHaveBeenCalled();
  });
});
