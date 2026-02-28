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

  it("starts a thinking block but does not append when blockStart is true and delta is empty", () => {
    const options = createOptions(vi.fn());
    const { result } = renderHook(() => useNativeBridgeMessage(options));

    act(() => {
      result.current({
        type: "stream:reasoningDelta",
        payload: { runId: "r1", delta: "", ts: 1000, blockStart: true },
      });
    });

    expect(options.startThinkingBlock).toHaveBeenCalledTimes(1);
    expect(options.startThinkingBlock).toHaveBeenCalledWith("r1", 1000);
    expect(options.appendThinkingDelta).not.toHaveBeenCalled();
  });

  it("starts a thinking block and appends when blockStart is true and delta is non-empty", () => {
    const options = createOptions(vi.fn());
    const { result } = renderHook(() => useNativeBridgeMessage(options));

    act(() => {
      result.current({
        type: "stream:reasoningDelta",
        payload: { runId: "r2", delta: "Thinking...", ts: 2000, blockStart: true },
      });
    });

    expect(options.startThinkingBlock).toHaveBeenCalledTimes(1);
    expect(options.startThinkingBlock).toHaveBeenCalledWith("r2", 2000);
    expect(options.appendThinkingDelta).toHaveBeenCalledTimes(1);
    expect(options.appendThinkingDelta).toHaveBeenCalledWith("r2", "Thinking...", 2000);
  });

  it("only appends when blockStart is false and delta is non-empty", () => {
    const options = createOptions(vi.fn());
    const { result } = renderHook(() => useNativeBridgeMessage(options));

    act(() => {
      result.current({
        type: "stream:reasoningDelta",
        payload: { runId: "r3", delta: "More thinking...", ts: 3000, blockStart: false },
      });
    });

    expect(options.startThinkingBlock).not.toHaveBeenCalled();
    expect(options.appendThinkingDelta).toHaveBeenCalledTimes(1);
    expect(options.appendThinkingDelta).toHaveBeenCalledWith("r3", "More thinking...", 3000);
  });

  it("only appends when blockStart is unset and delta is non-empty", () => {
    const options = createOptions(vi.fn());
    const { result } = renderHook(() => useNativeBridgeMessage(options));

    act(() => {
      result.current({
        type: "stream:reasoningDelta",
        payload: { runId: "r4", delta: "Streaming reasoning...", ts: 4000 },
      });
    });

    expect(options.startThinkingBlock).not.toHaveBeenCalled();
    expect(options.appendThinkingDelta).toHaveBeenCalledTimes(1);
    expect(options.appendThinkingDelta).toHaveBeenCalledWith("r4", "Streaming reasoning...", 4000);
  });

  it("does nothing when blockStart is unset and delta is empty", () => {
    const options = createOptions(vi.fn());
    const { result } = renderHook(() => useNativeBridgeMessage(options));

    act(() => {
      result.current({
        type: "stream:reasoningDelta",
        payload: { runId: "r5", delta: "", ts: 5000 },
      });
    });

    expect(options.startThinkingBlock).not.toHaveBeenCalled();
    expect(options.appendThinkingDelta).not.toHaveBeenCalled();
  });
});
