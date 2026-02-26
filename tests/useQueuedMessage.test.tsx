import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useQueuedMessage } from "@/hooks/chat/useQueuedMessage";

describe("useQueuedMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues while active and auto-sends when run ends", () => {
    const sendMessage = vi.fn();

    const { result, rerender } = renderHook(
      ({ isRunActive }) => useQueuedMessage({ isRunActive, sendMessage }),
      { initialProps: { isRunActive: true } },
    );

    act(() => {
      result.current.handleSendOrQueue("queued text");
    });

    expect(result.current.queuedMessage?.text).toBe("queued text");

    rerender({ isRunActive: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(sendMessage).toHaveBeenCalledWith("queued text", undefined);
    expect(result.current.queuedMessage).toBeNull();
  });

  it("markAbortHandled restores input and prevents auto-send", () => {
    const sendMessage = vi.fn();
    const onRestoreText = vi.fn();

    const { result, rerender } = renderHook(
      ({ isRunActive }) => useQueuedMessage({ isRunActive, sendMessage, onRestoreText }),
      { initialProps: { isRunActive: true } },
    );

    act(() => {
      result.current.handleSendOrQueue("restore me");
    });
    act(() => {
      result.current.markAbortHandled();
    });

    expect(onRestoreText).toHaveBeenCalledWith("restore me");
    expect(result.current.queuedMessage).toBeNull();

    rerender({ isRunActive: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
