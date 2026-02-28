import {
  HEARTBEAT_MARKER,
  SYSTEM_MESSAGE_PREFIX,
  SYSTEM_PREFIX,
  isToolCallPart,
} from "@/lib/constants";
import { getTextFromContent, updateAt } from "@/lib/messageUtils";
import type { ChatEventPayload, ContentPart, Message } from "@/types/chat";

function normalizeChatText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isContextUserText(text: string): boolean {
  return !!(
    text &&
    (text.startsWith(SYSTEM_PREFIX) || text.startsWith(SYSTEM_MESSAGE_PREFIX) || text.includes(HEARTBEAT_MARKER))
  );
}

function normalizeChatEventContent(content: ContentPart[] | string): ContentPart[] {
  return typeof content === "string"
    ? [{ type: "text" as const, text: content }]
    : content;
}

export function upsertChatEventMessage(prev: Message[], payload: ChatEventPayload): Message[] {
  if (!payload.message) return prev;

  const msg = payload.message;
  const normalizedContent = normalizeChatEventContent(msg.content);
  const nextText = typeof msg.content === "string"
    ? msg.content
    : getTextFromContent(msg.content);

  if (msg.role === "assistant") {
    const existingIdx = prev.findIndex((m) => m.id === payload.runId && m.role === "assistant");
    if (existingIdx >= 0) {
      return updateAt(prev, existingIdx, (existing) => {
        const parts = Array.isArray(existing.content) ? [...existing.content] : [];
        if (nextText) {
          const lastToolIdx = parts.findLastIndex((p: ContentPart) => isToolCallPart(p));
          const lastTextIdx = parts.findLastIndex((p: ContentPart) => p.type === "text");
          if (lastTextIdx > lastToolIdx) {
            parts[lastTextIdx] = { ...parts[lastTextIdx], text: nextText };
          } else {
            parts.push({ type: "text" as const, text: nextText });
          }
        }
        return {
          ...existing,
          content: parts,
          reasoning: msg.reasoning || existing.reasoning,
        };
      });
    }

    return [
      ...prev,
      {
        role: "assistant",
        content: normalizedContent,
        id: payload.runId,
        timestamp: msg.timestamp,
        reasoning: msg.reasoning,
      } as Message,
    ];
  }

  const sideChannelId = `${payload.runId}:${msg.role}`;
  const existingSideIdx = prev.findIndex(
    (m) =>
      (m.id === sideChannelId && m.role === msg.role) ||
      (m.id === payload.runId && m.role === msg.role),
  );

  if (existingSideIdx >= 0) {
    return updateAt(prev, existingSideIdx, (existing) => ({
      ...existing,
      content: normalizedContent,
      timestamp: msg.timestamp ?? existing.timestamp,
      reasoning: msg.reasoning || existing.reasoning,
      isContext: msg.role === "user" ? isContextUserText(nextText) : existing.isContext,
    }));
  }

  if (msg.role === "user") {
    const normNew = normalizeChatText(nextText);
    const isDuplicate = prev.some(
      (m) => m.role === "user" && normalizeChatText(getTextFromContent(m.content)) === normNew,
    );
    if (isDuplicate) return prev;

    return [
      ...prev,
      {
        role: "user",
        content: normalizedContent,
        id: sideChannelId,
        timestamp: msg.timestamp,
        isContext: isContextUserText(nextText),
      } as Message,
    ];
  }

  return [
    ...prev,
    {
      role: msg.role,
      content: normalizedContent,
      id: sideChannelId,
      timestamp: msg.timestamp,
      reasoning: msg.reasoning,
    } as Message,
  ];
}
