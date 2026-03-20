import React from "react";
import { describe, it, expect, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";

import { MessageRow } from "@mc/components/MessageRow";
import { useMessageSender } from "@mc/hooks/chat/useMessageSender";
import { upsertChatEventMessage } from "@mc/lib/chat/chatEventUpsert";
import { mergeHistoryWithOptimistic } from "@mc/lib/chat/historyResponse";
import type { ChatEventPayload, Message } from "@mc/types/chat";

describe("/new flow integration", () => {
  it("keeps /new response as command pill after realtime update and history refresh", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_200_000);
    vi.spyOn(Math, "random").mockReturnValue(0.333333333);

    const sendWS = vi.fn();
    const setMessages = vi.fn();

    const { result } = renderHook(() => useMessageSender({
      backendMode: "openclaw",
      isDemoMode: false,
      isConnected: true,
      sendWS,
      sessionKeyRef: { current: "main" } as React.RefObject<string>,
      activeRunIdRef: { current: null },
      isDetachedRef: { current: true },
      pinnedToBottomRef: { current: false },
      pinLockUntilRef: { current: 0 },
      demoHandlerRef: { current: null },
      lmStudioHandlerRef: { current: null },
      setMessages,
      setSentAnimId: vi.fn(),
      setAwaitingResponse: vi.fn(),
      setThinkingStartTime: vi.fn(),
      setIsStreaming: vi.fn(),
      cancelCommandFetch: vi.fn(),
    }));

    await act(async () => {
      await result.current.sendMessage("/new");
    });

    const wsReq = sendWS.mock.calls[0][0] as { id: string };
    const addCommandUpdater = setMessages.mock.calls[0][0] as (prev: Message[]) => Message[];
    const optimisticAfterSend = addCommandUpdater([
      { role: "assistant", id: "hist-old", timestamp: 1, content: [{ type: "text", text: "Old history" }] },
    ]);

    expect(optimisticAfterSend.some((m) => m.id === "hist-old")).toBe(false);

    const realtimeFinal = upsertChatEventMessage(optimisticAfterSend, {
      runId: wsReq.id,
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Started a new conversation." }],
        timestamp: 2000,
      },
    } as ChatEventPayload);

    const historySnapshot: Message[] = [
      { role: "user", id: "hist-u", timestamp: 1999, content: [{ type: "text", text: "/new" }] },
      {
        role: "assistant",
        id: "hist-a",
        timestamp: 2000,
        content: [{ type: "text", text: "Started a new conversation." }],
        stopReason: "injected",
      },
    ];

    const merged = mergeHistoryWithOptimistic(historySnapshot, realtimeFinal);
    const assistant = merged.find((m) => m.role === "assistant" && m.timestamp === 2000);

    expect(assistant?.id).toBe(wsReq.id);
    expect(assistant?.isCommandResponse).toBe(true);

    render(<MessageRow message={assistant as Message} isStreaming={false} />);
    expect(screen.getByRole("button", { name: /started a new conversation\./i })).toHaveClass("text-muted-foreground");
    expect(screen.getByRole("button", { name: "Copy contents" })).toBeInTheDocument();
  });
});
