import { useState, useRef, useEffect } from "react";
import type { Message } from "@/types/chat";
import { isUnreadCandidateMessage } from "@/lib/chat/messageTransforms";

interface UseUnreadTabIndicatorOptions {
  messages: Message[];
  historyLoaded: boolean;
  isDetached: boolean;
  isRunActive: boolean;
  lastCommand: string | null;
}

export function useUnreadTabIndicator({
  messages,
  historyLoaded,
  isDetached,
  isRunActive,
  lastCommand,
}: UseUnreadTabIndicatorOptions) {
  const [hasUnreadTabMessage, setHasUnreadTabMessage] = useState(false);

  useEffect(() => {
    if (isDetached) return;
    const baseTitle = !isRunActive
      ? "MobileClaw"
      : (lastCommand === "/compact" ? "Compacting… — MobileClaw" : "Thinking… — MobileClaw");
    document.title = `${hasUnreadTabMessage ? "● " : ""}${baseTitle}`;
  }, [isRunActive, isDetached, hasUnreadTabMessage, lastCommand]);

  const seenIncomingMessageKeysRef = useRef<Set<string>>(new Set());
  const unreadTrackingReadyRef = useRef(false);

  useEffect(() => {
    if (isDetached) return;
    if (!historyLoaded) {
      unreadTrackingReadyRef.current = false;
      seenIncomingMessageKeysRef.current = new Set();
      return;
    }

    const incomingKeys = new Set<string>();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!isUnreadCandidateMessage(msg)) continue;
      const key = msg.id || `${msg.role}:${msg.timestamp ?? 0}:${i}`;
      incomingKeys.add(key);
    }

    if (!unreadTrackingReadyRef.current) {
      seenIncomingMessageKeysRef.current = incomingKeys;
      unreadTrackingReadyRef.current = true;
      return;
    }

    let hasNewIncoming = false;
    for (const key of incomingKeys) {
      if (!seenIncomingMessageKeysRef.current.has(key)) {
        hasNewIncoming = true;
        break;
      }
    }
    seenIncomingMessageKeysRef.current = incomingKeys;
    if (hasNewIncoming && document.visibilityState !== "visible") {
      setHasUnreadTabMessage(true);
    }
  }, [messages, historyLoaded, isDetached]);

  useEffect(() => {
    if (isDetached) return;
    const clearIfVisible = () => {
      if (document.visibilityState === "visible") {
        setHasUnreadTabMessage(false);
      }
    };
    document.addEventListener("visibilitychange", clearIfVisible);
    window.addEventListener("focus", clearIfVisible);
    clearIfVisible();
    return () => {
      document.removeEventListener("visibilitychange", clearIfVisible);
      window.removeEventListener("focus", clearIfVisible);
    };
  }, [isDetached]);

  return {
    hasUnreadTabMessage,
  };
}
