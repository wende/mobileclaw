import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useUnreadTabIndicator } from "@/hooks/chat/useUnreadTabIndicator";
import type { Message } from "@/types/chat";

function assistantMessage(id: string, text: string): Message {
  return {
    role: "assistant",
    id,
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

describe("useUnreadTabIndicator", () => {
  it("marks unread when a new assistant message appears while tab is hidden", () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });

    const first = assistantMessage("m1", "hello");
    const second = assistantMessage("m2", "new");

    const { result, rerender } = renderHook(
      ({ messages, historyLoaded }) => useUnreadTabIndicator({
        messages,
        historyLoaded,
        isDetached: false,
        isRunActive: false,
        lastCommand: null,
      }),
      { initialProps: { messages: [] as Message[], historyLoaded: false } },
    );

    rerender({ messages: [first], historyLoaded: true });
    expect(result.current.hasUnreadTabMessage).toBe(false);

    rerender({ messages: [first, second], historyLoaded: true });
    expect(result.current.hasUnreadTabMessage).toBe(true);
  });

  it("clears unread indicator when tab becomes visible", () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });

    const first = assistantMessage("m1", "hello");
    const second = assistantMessage("m2", "new");

    const { result, rerender } = renderHook(
      ({ messages }) => useUnreadTabIndicator({
        messages,
        historyLoaded: true,
        isDetached: false,
        isRunActive: true,
        lastCommand: "/compact",
      }),
      { initialProps: { messages: [first] as Message[] } },
    );

    rerender({ messages: [first, second] });
    expect(result.current.hasUnreadTabMessage).toBe(true);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(result.current.hasUnreadTabMessage).toBe(false);
    expect(document.title.includes("MobileClaw")).toBe(true);
  });
});
