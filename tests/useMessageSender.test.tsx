import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useMessageSender } from "@/hooks/chat/useMessageSender";
import type { Message } from "@/types/chat";

describe("useMessageSender", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the OpenClaw run id as slash-command placeholder id", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

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
      await result.current.sendMessage("/compact");
    });

    expect(sendWS).toHaveBeenCalledTimes(1);
    const wsReq = sendWS.mock.calls[0][0] as { id: string; params: { idempotencyKey?: string } };
    expect(wsReq.id).toMatch(/^run-/);
    expect(wsReq.params.idempotencyKey).toBe(wsReq.id);

    expect(setMessages).toHaveBeenCalled();
    const updater = setMessages.mock.calls[0][0] as (prev: Message[]) => Message[];
    const next = updater([]);
    const placeholder = next.find((m) => m.role === "assistant" && m.isCommandResponse);

    expect(placeholder?.id).toBe(wsReq.id);
  });
});
