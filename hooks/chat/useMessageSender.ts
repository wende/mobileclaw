import { useState, useCallback } from "react";

import { requestNotificationPermission } from "@/lib/notifications";
import { PIN_LOCK_MS } from "@/hooks/useScrollManager";
import type { ContentPart, ImageAttachment, Message } from "@/types/chat";

interface UseMessageSenderOptions {
  backendMode: "openclaw" | "lmstudio" | "demo";
  isDemoMode: boolean;
  isConnected: boolean;
  sendWS: (msg: { type: string; [key: string]: unknown }) => void;
  sessionKeyRef: React.RefObject<string>;
  activeRunIdRef: React.MutableRefObject<string | null>;
  isDetachedRef: React.MutableRefObject<boolean>;
  pinnedToBottomRef: React.MutableRefObject<boolean>;
  pinLockUntilRef: React.MutableRefObject<number>;
  demoHandlerRef: React.RefObject<{ sendMessage: (message: string) => void } | null>;
  lmStudioHandlerRef: React.RefObject<{ sendMessage: (messages: Message[]) => Promise<void>; stop: () => void } | null>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setSentAnimId: React.Dispatch<React.SetStateAction<string | null>>;
  setAwaitingResponse: (value: boolean) => void;
  setThinkingStartTime: React.Dispatch<React.SetStateAction<number | null>>;
  setIsStreaming: (value: boolean) => void;
  cancelCommandFetch: () => void;
}

export function useMessageSender({
  backendMode,
  isDemoMode,
  isConnected,
  sendWS,
  sessionKeyRef,
  activeRunIdRef,
  isDetachedRef,
  pinnedToBottomRef,
  pinLockUntilRef,
  demoHandlerRef,
  lmStudioHandlerRef,
  setMessages,
  setSentAnimId,
  setAwaitingResponse,
  setThinkingStartTime,
  setIsStreaming,
  cancelCommandFetch,
}: UseMessageSenderOptions) {
  const [lastCommand, setLastCommand] = useState<string | null>(null);

  const uploadFiles = useCallback(async (attachments: ImageAttachment[]): Promise<string[]> => {
    const results = await Promise.allSettled(
      attachments.map(async (a) => {
        const buf = Uint8Array.from(atob(a.content), (c) => c.charCodeAt(0));
        const ext = a.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "bin";
        const name = a.fileName || `file.${ext}`;
        const form = new FormData();
        form.append("reqtype", "fileupload");
        form.append("time", "72h");
        form.append("fileToUpload", new File([buf], name, { type: a.mimeType }));
        const res = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
          method: "POST",
          body: form,
        });
        if (!res.ok) return null;
        return (await res.text()).trim();
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<string | null> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((url): url is string => !!url);
  }, []);

  const sendMessage = useCallback(async (text: string, attachments?: ImageAttachment[]) => {
    cancelCommandFetch();
    const isSlashCommand = text.trim().startsWith("/");
    setLastCommand(isSlashCommand ? text.trim().split(/\s/)[0].toLowerCase() : null);

    if (!isDetachedRef.current) void requestNotificationPermission();
    pinnedToBottomRef.current = true;
    pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;

    const contentParts: ContentPart[] = [];
    if (text) contentParts.push({ type: "text", text });
    if (attachments?.length) {
      for (const a of attachments) {
        if (a.mimeType.startsWith("image/")) {
          contentParts.push({ type: "image_url", image_url: { url: `data:${a.mimeType};base64,${a.content}` } });
        } else {
          contentParts.push({ type: "file", file_name: a.fileName, file_mime: a.mimeType });
        }
      }
    }

    const userMsgId = `u-${Date.now()}`;
    const userMsg: Message = { role: "user", content: contentParts, id: userMsgId, timestamp: Date.now(), isHidden: isSlashCommand };
    setSentAnimId(userMsg.id!);

    if (isSlashCommand) {
      const placeholderId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const placeholder: Message = { role: "assistant", content: [], id: placeholderId, timestamp: Date.now(), isCommandResponse: true };
      setMessages((prev) => [...prev, userMsg, placeholder]);
    } else {
      setMessages((prev) => [...prev, userMsg]);
    }

    let messageText = text;
    if (attachments?.length) {
      const urls = await uploadFiles(attachments);
      if (urls.length > 0) {
        const urlLines = urls.join("\n");
        messageText = text ? `${text}\n\n${urlLines}` : urlLines;
        setMessages((prev) => prev.map((m) => {
          if (m.id !== userMsgId || !Array.isArray(m.content)) return m;
          let urlIdx = 0;
          const updated = m.content.map((p) => {
            if (p.type === "file" && urlIdx < urls.length) {
              return { ...p, file_url: urls[urlIdx++] };
            }
            return p;
          });
          return { ...m, content: updated };
        }));
      }
    }

    if (!messageText) return;

    if (isDemoMode || backendMode === "demo") {
      demoHandlerRef.current?.sendMessage(messageText);
      return;
    }

    if (backendMode === "lmstudio") {
      setAwaitingResponse(true);
      setThinkingStartTime(Date.now());
      setMessages((prev) => {
        try { window.localStorage.setItem("lmstudio-messages", JSON.stringify(prev)); } catch {}
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            void lmStudioHandlerRef.current?.sendMessage(prev);
          });
        });
        return prev;
      });
      return;
    }

    if (!isConnected) return;

    setAwaitingResponse(true);
    setThinkingStartTime(Date.now());

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRunIdRef.current = runId;

    sendWS({
      type: "req",
      id: runId,
      method: "chat.send",
      params: {
        sessionKey: sessionKeyRef.current,
        message: messageText,
        deliver: true,
        idempotencyKey: runId,
      },
    });

    setIsStreaming(true);
  }, [
    activeRunIdRef,
    backendMode,
    cancelCommandFetch,
    demoHandlerRef,
    isConnected,
    isDemoMode,
    isDetachedRef,
    lmStudioHandlerRef,
    pinLockUntilRef,
    pinnedToBottomRef,
    sendWS,
    sessionKeyRef,
    setAwaitingResponse,
    setIsStreaming,
    setMessages,
    setSentAnimId,
    setThinkingStartTime,
    uploadFiles,
  ]);

  return {
    lastCommand,
    sendMessage,
  };
}
