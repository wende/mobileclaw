import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { updateAt } from "@/lib/messageUtils";
import type { Message } from "@/types/chat";

/**
 * Manages the "thinking" indicator state: awaiting response, exit animation,
 * thinking duration tracking, and pending duration application.
 */
export function useThinkingState(
  streamingId: string | null,
  messages: Message[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
) {
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const [thinkingExiting, setThinkingExiting] = useState(false);
  const [justRevealedId, setJustRevealedId] = useState<string | null>(null);
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);

  const showThinkingIndicator = awaitingResponse || thinkingExiting;

  // Refs for accessing current values in callbacks without dependency
  const awaitingResponseRef = useRef(false);
  awaitingResponseRef.current = awaitingResponse;
  const thinkingStartTimeRef = useRef<number | null>(null);
  thinkingStartTimeRef.current = thinkingStartTime;
  const pendingThinkingDurationRef = useRef<number | null>(null);

  const resetThinkingState = useCallback(() => {
    setAwaitingResponse(false);
    setThinkingExiting(false);
    setJustRevealedId(null);
    setThinkingStartTime(null);
  }, []);

  /** Transition from awaiting to streaming: start exit animation instead of abrupt hide. */
  const beginContentArrival = useCallback(() => {
    if (awaitingResponseRef.current) {
      const startTime = thinkingStartTimeRef.current;
      const duration = startTime ? Math.round((Date.now() - startTime) / 1000) : null;
      if (duration !== null && duration > 0) {
        pendingThinkingDurationRef.current = duration;
      }
      setAwaitingResponse(false);
      setThinkingExiting(true);
      setThinkingStartTime(null);
    }
  }, []);

  const onThinkingExitComplete = useCallback(() => {
    setThinkingExiting(false);
    setJustRevealedId(streamingId);
    setTimeout(() => setJustRevealedId(null), 250);
  }, [streamingId]);

  // Reset thinking state when messages are cleared (e.g., /new command)
  useEffect(() => {
    if (messages.length === 0) {
      resetThinkingState();
      pendingThinkingDurationRef.current = null;
    }
  }, [messages.length, resetThinkingState]);

  // Apply pending thinking duration to newly created assistant messages
  useLayoutEffect(() => {
    const duration = pendingThinkingDurationRef.current;
    if (!duration) return;

    const targetIdx = messages.findLastIndex((m) => m.role === "assistant" && !m.thinkingDuration);
    if (targetIdx >= 0) {
      pendingThinkingDurationRef.current = null;
      setMessages((prev) => updateAt(prev, targetIdx, (msg) => ({ ...msg, thinkingDuration: duration })));
    }
  }, [messages, setMessages]);

  return {
    awaitingResponse,
    setAwaitingResponse,
    thinkingExiting,
    showThinkingIndicator,
    justRevealedId,
    thinkingStartTime,
    setThinkingStartTime,
    beginContentArrival,
    onThinkingExitComplete,
    resetThinkingState,
    pendingThinkingDurationRef,
  };
}
