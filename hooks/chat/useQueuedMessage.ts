import { useState, useRef, useEffect, useCallback } from "react";
import type { ImageAttachment } from "@/types/chat";

type QueuedMessage = { text: string; attachments?: ImageAttachment[] };

interface UseQueuedMessageOptions {
  isRunActive: boolean;
  sendMessage: (text: string, attachments?: ImageAttachment[]) => Promise<void> | void;
  onRestoreText?: (text: string) => void;
}

export function useQueuedMessage({
  isRunActive,
  sendMessage,
  onRestoreText,
}: UseQueuedMessageOptions) {
  const [queuedMessage, setQueuedMessage] = useState<QueuedMessage | null>(null);
  const queuedMessageRef = useRef<QueuedMessage | null>(null);
  queuedMessageRef.current = queuedMessage;

  const prevIsRunActiveRef = useRef(false);
  const abortedWithQueueRef = useRef(false);

  const handleSendOrQueue = useCallback((text: string, attachments?: ImageAttachment[]) => {
    if (isRunActive) {
      if (!queuedMessageRef.current) {
        setQueuedMessage({ text, attachments });
      }
      return;
    }
    void sendMessage(text, attachments);
  }, [isRunActive, sendMessage]);

  useEffect(() => {
    const wasActive = prevIsRunActiveRef.current;
    prevIsRunActiveRef.current = isRunActive;
    if (wasActive && !isRunActive && queuedMessageRef.current && !abortedWithQueueRef.current) {
      const { text, attachments } = queuedMessageRef.current;
      setQueuedMessage(null);
      setTimeout(() => {
        void sendMessage(text, attachments);
      }, 150);
    }
    abortedWithQueueRef.current = false;
  }, [isRunActive, sendMessage]);

  const clearQueuedToInput = useCallback(() => {
    if (!queuedMessageRef.current) return;
    const { text } = queuedMessageRef.current;
    setQueuedMessage(null);
    onRestoreText?.(text);
  }, [onRestoreText]);

  const markAbortHandled = useCallback(() => {
    if (!queuedMessageRef.current) return;
    const { text } = queuedMessageRef.current;
    setQueuedMessage(null);
    abortedWithQueueRef.current = true;
    onRestoreText?.(text);
  }, [onRestoreText]);

  return {
    queuedMessage,
    queuedMessageRef,
    setQueuedMessage,
    handleSendOrQueue,
    clearQueuedToInput,
    markAbortHandled,
  };
}
