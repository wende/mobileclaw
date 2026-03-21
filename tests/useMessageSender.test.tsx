import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useMessageSender } from "@mc/hooks/chat/useMessageSender";
import type { Message } from "@mc/types/chat";

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

  it("clears local history before enqueueing /new command placeholders", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    vi.spyOn(Math, "random").mockReturnValue(0.222222222);

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

    const updater = setMessages.mock.calls[0][0] as (prev: Message[]) => Message[];
    const previous: Message[] = [
      { role: "assistant", id: "hist-0", timestamp: 1, content: [{ type: "text", text: "Old history" }] },
    ];
    const next = updater(previous);

    expect(next).toHaveLength(2);
    expect(next.some((m) => m.id === "hist-0")).toBe(false);
    expect(next.find((m) => m.role === "assistant" && m.isCommandResponse)).toBeTruthy();
  });

  it("creates unique optimistic user ids even within the same millisecond", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_200_000);
    const randomSpy = vi.spyOn(Math, "random");
    randomSpy
      .mockReturnValueOnce(0.111111111)
      .mockReturnValueOnce(0.222222222)
      .mockReturnValueOnce(0.333333333)
      .mockReturnValueOnce(0.444444444);

    const sendWS = vi.fn();
    let state: Message[] = [];
    const setMessages = vi.fn((updater: React.SetStateAction<Message[]>) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });

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
      await result.current.sendMessage("first");
      await result.current.sendMessage("second");
    });

    const userIds = state.filter((msg) => msg.role === "user").map((msg) => msg.id);
    expect(userIds).toHaveLength(2);
    expect(new Set(userIds).size).toBe(2);
    expect(userIds.every((id) => id?.startsWith("u-"))).toBe(true);
  });
});
