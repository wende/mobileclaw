import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { ChatViewport } from "@/components/chat/ChatViewport";
import type { Message } from "@/types/chat";
import type { useSubagentStore } from "@/hooks/useSubagentStore";

function findSlideGrid(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.style?.gridTemplateRows) return node;
    node = node.parentElement;
  }
  return null;
}

function renderViewport(
  messages: Message[],
  options?: { zenMode?: boolean; isStreaming?: boolean; streamingId?: string | null },
) {
  const zenMode = options?.zenMode ?? true;
  const isStreaming = options?.isStreaming ?? false;
  const streamingId = options?.streamingId ?? null;
  return render(
    <ChatViewport
      isDetached={false}
      isNative={false}
      historyLoaded
      inputZoneHeight="4rem"
      bottomPad="4rem"
      scrollRef={React.createRef<HTMLDivElement>()}
      bottomRef={React.createRef<HTMLDivElement>()}
      pullContentRef={React.createRef<HTMLDivElement>()}
      pullSpinnerRef={React.createRef<HTMLDivElement>()}
      onScroll={() => {}}
      displayMessages={messages}
      sentAnimId={null}
      onSentAnimationEnd={() => {}}
      fadeInIds={new Set<string>()}
      isStreaming={isStreaming}
      streamingId={streamingId}
      subagentStore={{} as ReturnType<typeof useSubagentStore>}
      pinnedToolCallId={null}
      onPin={() => {}}
      onUnpin={() => {}}
      zenMode={zenMode}
      awaitingResponse={false}
      thinkingStartTime={null}
      quotePopup={null}
      quotePopupRef={React.createRef<HTMLButtonElement>()}
      onAcceptQuote={() => {}}
    />,
  );
}

describe("ChatViewport zen grouping", () => {
  it("treats consecutive assistant rows under one timestamp block as one zen block", async () => {
    const messages: Message[] = [
      { role: "assistant", content: [{ type: "text", text: "assistant first" }], id: "a1", timestamp: 1_000 },
      { role: "assistant", content: [{ type: "text", text: "assistant second" }], id: "a2", timestamp: 1_500 },
    ];

    renderViewport(messages, true);

    const firstCollapsedGrid = findSlideGrid(screen.getByText("assistant first"));
    expect(firstCollapsedGrid).not.toBeNull();
    expect(firstCollapsedGrid).toHaveStyle({ gridTemplateRows: "0fr" });
    expect(screen.getByText("assistant second")).toBeVisible();
    expect(screen.getByTestId("zen-toggle").closest('[data-message-role="assistant"]')).toBeNull();

    fireEvent.click(screen.getByTestId("zen-toggle"));
    await waitFor(() => {
      const firstExpandedGrid = findSlideGrid(screen.getByText("assistant first"));
      expect(firstExpandedGrid).not.toBeNull();
      expect(firstExpandedGrid).toHaveStyle({ gridTemplateRows: "1fr" });
    });

    const firstAssistantRow = screen.getByText("assistant first").closest('[data-message-role="assistant"]');
    const secondAssistantRow = screen.getByText("assistant second").closest('[data-message-role="assistant"]');
    expect(firstAssistantRow).not.toBeNull();
    expect(secondAssistantRow).not.toBeNull();
    expect(screen.getByTestId("zen-toggle").closest('[data-message-role="assistant"]')).toBeNull();
  });

  it("starts a new zen block when a new timestamp heading is shown", () => {
    const messages: Message[] = [
      { role: "assistant", content: [{ type: "text", text: "older block" }], id: "a1", timestamp: 1_000 },
      { role: "assistant", content: [{ type: "text", text: "new block" }], id: "a2", timestamp: 1_000 + 11 * 60 * 1_000 },
    ];

    renderViewport(messages, true);

    expect(screen.getByText("older block")).toBeInTheDocument();
    expect(screen.getByText("new block")).toBeInTheDocument();
    expect(screen.queryByTestId("zen-toggle")).not.toBeInTheDocument();
  });

  it("fades and slides out a prior cycle when it gets collapsed during streaming", async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = renderViewport(
        [{ role: "assistant", content: [{ type: "text", text: "cycle one" }], id: "a1", timestamp: 1_000 }],
        { zenMode: true, isStreaming: true, streamingId: "a1" },
      );

      rerender(
        <ChatViewport
          isDetached={false}
          isNative={false}
          historyLoaded
          inputZoneHeight="4rem"
          bottomPad="4rem"
          scrollRef={React.createRef<HTMLDivElement>()}
          bottomRef={React.createRef<HTMLDivElement>()}
          pullContentRef={React.createRef<HTMLDivElement>()}
          pullSpinnerRef={React.createRef<HTMLDivElement>()}
          onScroll={() => {}}
          displayMessages={[
            { role: "assistant", content: [{ type: "text", text: "cycle one" }], id: "a1", timestamp: 1_000 },
            { role: "assistant", content: [{ type: "text", text: "cycle two" }], id: "a2", timestamp: 1_500 },
          ]}
          sentAnimId={null}
          onSentAnimationEnd={() => {}}
          fadeInIds={new Set<string>()}
          isStreaming
          streamingId="a2"
          subagentStore={{} as ReturnType<typeof useSubagentStore>}
          pinnedToolCallId={null}
          onPin={() => {}}
          onUnpin={() => {}}
          zenMode
          awaitingResponse={false}
          thinkingStartTime={null}
          quotePopup={null}
          quotePopupRef={React.createRef<HTMLButtonElement>()}
          onAcceptQuote={() => {}}
        />,
      );

      // Immediately after demotion, prior row should remain open for fade-out.
      const initiallyOpenGrid = findSlideGrid(screen.getByText("cycle one"));
      expect(initiallyOpenGrid).not.toBeNull();
      expect(initiallyOpenGrid).toHaveStyle({ gridTemplateRows: "1fr" });
      expect(document.querySelectorAll('[data-message-role="assistant"]')).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(700);
      });

      const collapsedGrid = findSlideGrid(screen.getByText("cycle one"));
      expect(collapsedGrid).not.toBeNull();
      expect(collapsedGrid).toHaveStyle({ gridTemplateRows: "0fr" });
      expect(document.querySelectorAll('[data-message-role="assistant"]')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
