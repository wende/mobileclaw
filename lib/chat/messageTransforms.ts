import { getTextFromContent } from "@/lib/messageUtils";
import {
  NO_REPLY_MARKER,
  STOP_REASON_INJECTED,
  hasHeartbeatOnOwnLine,
  hasUnquotedMarker,
  isToolCallPart,
} from "@/lib/constants";
import type { ContentPart, Message } from "@/types/chat";

export function hasVisibleMessageContent(msg: Message): boolean {
  if (typeof msg.content === "string") return msg.content.trim().length > 0;
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((part) => {
    if (part.type === "text" || part.type === "thinking") return !!part.text?.trim();
    if (isToolCallPart(part)) return !!(part.name || part.result || part.status);
    if (part.type === "image" || part.type === "image_url") return !!part.image_url?.url;
    if (part.type === "file") return !!(part.file_name || part.file_url);
    if (part.type === "plugin") return !!part.pluginType;
    return false;
  });
}

export function isUnreadCandidateMessage(msg: Message): boolean {
  if (msg.role !== "assistant" && msg.role !== "system") return false;
  if (msg.isHidden || msg.isCommandResponse) return false;
  if (msg.stopReason === STOP_REASON_INJECTED) return false;
  if (msg.isError) return true;
  if (typeof msg.reasoning === "string" && msg.reasoning.trim()) return true;
  return hasVisibleMessageContent(msg);
}

/**
 * Merge tool/tool_result messages into the preceding assistant's tool_call content parts,
 * normalize tool_call types/fields, and filter out the merged messages.
 */
export function mergeAndNormalizeToolResults(msgs: Message[]): Message[] {
  const mergedIds = new Set<string>();
  for (let i = 0; i < msgs.length; i++) {
    const hm = msgs[i];
    const toolName = hm.toolName || ((hm as unknown as Record<string, unknown>).name as string | undefined);
    if ((hm.role === "tool" || hm.role === "toolResult" || hm.role === "tool_result") && toolName) {
      const resultText = getTextFromContent(hm.content);
      let isErr = !!hm.isError;
      if (!isErr && resultText) {
        try {
          const parsed = JSON.parse(resultText) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            isErr =
              parsed.status === "error" ||
              (typeof parsed.error === "string" && !!parsed.error) ||
              parsed.isError === true;
          }
        } catch {}
      }
      for (let j = i - 1; j >= 0; j--) {
        const prev = msgs[j];
        if (prev.role === "assistant" && Array.isArray(prev.content)) {
          const tc = prev.content.find((p) => p.name === toolName && !p.result);
          if (tc) {
            const args = tc.arguments;
            tc.arguments = typeof args === "string" ? args : args ? JSON.stringify(args) : undefined;
            tc.result = resultText;
            tc.resultError = isErr;
            tc.status = isErr ? "error" : "success";
            if (hm.id) mergedIds.add(hm.id);
            break;
          }
        }
      }
    }
  }
  for (const hm of msgs) {
    if (hm.role !== "assistant" || !Array.isArray(hm.content)) continue;
    for (const part of hm.content) {
      if (!isToolCallPart(part) && part.name) {
        part.type = "tool_call";
      }
      if (isToolCallPart(part)) {
        if (!part.result && !part.status) part.status = "running";
        if (!part.toolCallId) {
          const p = part as unknown as Record<string, unknown>;
          const id = (p.tool_call_id || p.id) as string | undefined;
          if (id) part.toolCallId = id;
        }
        if (!part.arguments) {
          const p = part as unknown as Record<string, unknown>;
          if (p.input) part.arguments = typeof p.input === "string" ? p.input : JSON.stringify(p.input);
        } else if (typeof part.arguments !== "string") {
          part.arguments = JSON.stringify(part.arguments);
        }
      }
    }
  }
  return msgs.filter((m) => !m.id || !mergedIds.has(m.id));
}

export function buildDisplayMessages(messages: Message[]): Message[] {
  const result: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgText = getTextFromContent(msg.content);
    if (
      msg.role === "assistant" &&
      msgText &&
      (hasHeartbeatOnOwnLine(msgText) || hasUnquotedMarker(msgText, NO_REPLY_MARKER)) &&
      result.length > 0
    ) {
      const absorbed: ContentPart[] = [];
      let absorbedReasoning = msg.reasoning;
      while (result.length > 0) {
        const prev = result[result.length - 1];
        if (prev.role !== "assistant" || !Array.isArray(prev.content)) break;
        const prevParts = prev.content;
        absorbed.unshift(...prevParts);
        if (!absorbedReasoning && prev.reasoning) absorbedReasoning = prev.reasoning;
        result.pop();
      }
      if (absorbed.length > 0) {
        const thisParts = Array.isArray(msg.content)
          ? msg.content
          : [{ type: "text" as const, text: msgText }];
        result.push({
          ...msg,
          content: [...absorbed, ...thisParts],
          reasoning: absorbedReasoning,
        });
        continue;
      }
    }
    result.push(msg);
  }
  return result.filter((m) => !m.isHidden);
}
