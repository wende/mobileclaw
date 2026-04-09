import { isContextText } from "@mc/lib/constants";
import { appendCanvasPart } from "@mc/lib/plugins/compat";
import { getTextFromContent, updateAt } from "@mc/lib/messageUtils";
import type {
  CanvasPayload,
  ChatEventPayload,
  ContentPart,
  Message,
  PluginContentPart,
} from "@mc/types/chat";

function summarizeParts(parts: ContentPart[]): string {
  return parts.map((p) => {
    if (p.type === "text") return `text(${(p.text || "").length}ch)`;
    if (p.type === "thinking") return `thinking(${(p.text || "").length}ch)`;
    if (p.type === "tool_call") return `tool_call(${p.name}/${p.status || "?"})`;
    if (p.type === "plugin") return `plugin(${(p as PluginContentPart).pluginType || "?"})`;
    return p.type;
  }).join(", ");
}

function normalizeChatText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeChatEventContent(
  content: ContentPart[] | string,
  canvas?: CanvasPayload,
): ContentPart[] {
  return appendCanvasPart(content, canvas);
}

export function upsertChatEventMessage(
  prev: Message[],
  payload: ChatEventPayload,
): Message[] {
  if (!payload.message) {
    console.log(`[CHAT-UPSERT] No message in payload, state=${payload.state} runId=${payload.runId}`);
    return prev;
  }

  const msg = payload.message;
  const normalizedContent = normalizeChatEventContent(msg.content, msg.canvas);
  const nextText =
    typeof msg.content === "string"
      ? msg.content
      : getTextFromContent(msg.content);

  console.log(
    `[CHAT-UPSERT] state=${payload.state} runId=${payload.runId} role=${msg.role} ` +
    `nextTextLen=${nextText.length} normalizedParts=[${summarizeParts(normalizedContent)}] prevMsgCount=${prev.length}`
  );

  if (msg.role === "assistant") {
    const existingIdx = prev.findIndex(
      (m) => m.id === payload.runId && m.role === "assistant",
    );
    console.log(
      `[CHAT-UPSERT] assistant existingIdx=${existingIdx}` +
      (existingIdx >= 0
        ? ` existingParts=[${summarizeParts(Array.isArray(prev[existingIdx].content) ? prev[existingIdx].content : [])}]`
        : " (will create new)")
    );
    if (existingIdx >= 0) {
      return updateAt(prev, existingIdx, (existing) => {
        const parts = Array.isArray(existing.content)
          ? [...existing.content]
          : [];
        console.log(`[CHAT-UPSERT] MERGE-START existingParts=[${summarizeParts(parts)}] nextTextLen=${nextText.length}`);
        if (nextText) {
          const lastNonTextPartIdx = parts.findLastIndex(
            (p: ContentPart) => p.type !== "text",
          );
          const lastTextIdx = parts.findLastIndex(
            (p: ContentPart) => p.type === "text",
          );
          if (lastTextIdx > lastNonTextPartIdx) {
            // Chat-event deltas carry accumulated (snapshot) text.  When tool_call
            // or plugin parts split the content into multiple text segments, earlier
            // text parts already display a prefix of the snapshot.  Subtract that
            // prefix so only the new portion appears in the trailing text part,
            // avoiding visual duplication.
            let precedingText = "";
            for (let i = 0; i < lastTextIdx; i++) {
              if (parts[i].type === "text") {
                precedingText += parts[i].text || "";
              }
            }
            const deduplicated =
              precedingText && nextText.startsWith(precedingText)
                ? nextText.slice(precedingText.length)
                : nextText;
            parts[lastTextIdx] = { ...parts[lastTextIdx], text: deduplicated };
          } else {
            parts.push({ type: "text" as const, text: nextText });
          }
        }
        const pluginParts = normalizedContent.filter(
          (part): part is PluginContentPart =>
            part.type === "plugin" && !!part.partId,
        );
        for (const pluginPart of pluginParts) {
          const pluginIdx = parts.findIndex(
            (part) =>
              part.type === "plugin" && part.partId === pluginPart.partId,
          );
          if (pluginIdx >= 0) {
            parts[pluginIdx] = { ...parts[pluginIdx], ...pluginPart };
          } else {
            parts.push(pluginPart);
          }
        }
        console.log(`[CHAT-UPSERT] MERGE-END resultParts=[${summarizeParts(parts)}]`);
        return {
          ...existing,
          content: parts,
          reasoning: msg.reasoning || existing.reasoning,
        };
      });
    }

    console.log(`[CHAT-UPSERT] CREATE-NEW assistant id=${payload.runId} parts=[${summarizeParts(normalizedContent)}]`);
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
      isContext:
        msg.role === "user" ? isContextText(nextText) : existing.isContext,
    }));
  }

  if (msg.role === "user") {
    const normNew = normalizeChatText(nextText);
    const isDuplicate = prev.some(
      (m) =>
        m.role === "user" &&
        normalizeChatText(getTextFromContent(m.content)) === normNew,
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
