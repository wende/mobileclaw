import {
  isContextText,
} from "@/lib/constants";
import { appendCanvasPart } from "@/lib/plugins/compat";
import { getTextFromContent, updateAt } from "@/lib/messageUtils";
import type { CanvasPayload, ChatEventPayload, ContentPart, Message, PluginContentPart } from "@/types/chat";

function normalizeChatText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeChatEventContent(content: ContentPart[] | string, canvas?: CanvasPayload): ContentPart[] {
  return appendCanvasPart(content, canvas);
}

export function upsertChatEventMessage(prev: Message[], payload: ChatEventPayload): Message[] {
  if (!payload.message) return prev;

  const msg = payload.message;
  const normalizedContent = normalizeChatEventContent(msg.content, msg.canvas);
  const nextText = typeof msg.content === "string"
    ? msg.content
    : getTextFromContent(msg.content);

  if (msg.role === "assistant") {
    const existingIdx = prev.findIndex((m) => m.id === payload.runId && m.role === "assistant");
    if (existingIdx >= 0) {
      return updateAt(prev, existingIdx, (existing) => {
        const parts = Array.isArray(existing.content) ? [...existing.content] : [];
        if (nextText) {
          const lastToolIdx = parts.findLastIndex((p: ContentPart) => p.type !== "text");
          const lastTextIdx = parts.findLastIndex((p: ContentPart) => p.type === "text");
          if (lastTextIdx > lastToolIdx) {
            parts[lastTextIdx] = { ...parts[lastTextIdx], text: nextText };
          } else {
            parts.push({ type: "text" as const, text: nextText });
          }
        }
        const pluginParts = normalizedContent.filter((part): part is PluginContentPart => part.type === "plugin" && !!part.partId);
        for (const pluginPart of pluginParts) {
          const pluginIdx = parts.findIndex((part) => part.type === "plugin" && part.partId === pluginPart.partId);
          if (pluginIdx >= 0) {
            parts[pluginIdx] = { ...parts[pluginIdx], ...pluginPart };
          } else {
            parts.push(pluginPart);
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
      isContext: msg.role === "user" ? isContextText(nextText) : existing.isContext,
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
        isContext: isContextText(nextText),
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
