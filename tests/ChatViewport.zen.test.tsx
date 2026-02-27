import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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

function renderViewport(messages: Message[], zenMode = true) {
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
      isStreaming={false}
      streamingId={null}
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

    if (firstAssistantRow && secondAssistantRow) {
      expect(within(firstAssistantRow).getByTestId("zen-toggle")).toBeInTheDocument();
      expect(within(secondAssistantRow).queryByTestId("zen-toggle")).not.toBeInTheDocument();
    }
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
});
