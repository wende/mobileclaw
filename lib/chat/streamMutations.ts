import { isToolCallPart } from "@/lib/constants";
import { updateAt } from "@/lib/messageUtils";
import type { ContentPart, Message } from "@/types/chat";

interface EnsureResult {
  messages: Message[];
  created: boolean;
}

export function ensureStreamingMessage(
  prev: Message[],
  runId: string,
  ts: number,
  extra?: Partial<Message>,
): EnsureResult {
  if (prev.some((m) => m.id === runId)) return { messages: prev, created: false };
  return {
    created: true,
    messages: [
      ...prev,
      { role: "assistant", content: [], id: runId, timestamp: ts, ...extra } as Message,
    ],
  };
}

export function appendContentDelta(messages: Message[], runId: string, delta: string, ts: number): EnsureResult {
  const ensured = ensureStreamingMessage(messages, runId, ts);
  const updated = ensured.messages;
  const idx = updated.findIndex((m) => m.id === runId);
  if (idx < 0) return ensured;
  return {
    created: ensured.created,
    messages: updateAt(updated, idx, (target) => {
      const parts = Array.isArray(target.content) ? [...target.content] : [];
      const lastToolIdx = parts.findLastIndex((p: ContentPart) => isToolCallPart(p));
      const lastTextIdx = parts.findLastIndex((p: ContentPart) => p.type === "text");
      if (lastTextIdx > lastToolIdx) {
        parts[lastTextIdx] = { ...parts[lastTextIdx], text: (parts[lastTextIdx].text || "") + delta };
      } else {
        parts.push({ type: "text" as const, text: delta });
      }
      return { ...target, content: parts };
    }),
  };
}

export function appendThinkingDelta(messages: Message[], runId: string, delta: string, ts: number): EnsureResult {
  const ensured = ensureStreamingMessage(messages, runId, ts);
  const updated = ensured.messages;
  const idx = updated.findIndex((m) => m.id === runId);
  if (idx < 0) return ensured;
  return {
    created: ensured.created,
    messages: updateAt(updated, idx, (target) => {
      const parts = Array.isArray(target.content) ? [...target.content] : [];
      const lastThinkIdx = parts.findLastIndex((p: ContentPart) => p.type === "thinking");
      const lastToolIdx = parts.findLastIndex((p: ContentPart) => isToolCallPart(p));
      if (lastThinkIdx > lastToolIdx) {
        parts[lastThinkIdx] = {
          ...parts[lastThinkIdx],
          type: "thinking",
          text: (parts[lastThinkIdx].text || "") + delta,
        };
      } else {
        parts.push({ type: "thinking" as const, text: delta });
      }
      return { ...target, content: parts };
    }),
  };
}

export function addToolCall(
  messages: Message[],
  runId: string,
  name: string,
  ts: number,
  toolCallId?: string,
  args?: string,
): EnsureResult {
  const ensured = ensureStreamingMessage(messages, runId, ts);
  const updated = ensured.messages;
  const idx = updated.findIndex((m) => m.id === runId);
  if (idx < 0) return ensured;
  return {
    created: ensured.created,
    messages: updateAt(updated, idx, (target) => ({
      ...target,
      content: [
        ...(Array.isArray(target.content) ? target.content : []),
        {
          type: "tool_call" as const,
          name,
          toolCallId,
          arguments: args,
          status: "running" as const,
        },
      ],
    })),
  };
}

export function resolveToolCall(
  messages: Message[],
  runId: string,
  name: string,
  toolCallId?: string,
  result?: string,
  isError?: boolean,
): Message[] {
  let idx = messages.findIndex((m) => m.id === runId);
  if (idx < 0) idx = messages.findLastIndex((m) => m.role === "assistant");
  if (idx < 0 || !Array.isArray(messages[idx].content)) return messages;
  return updateAt(messages, idx, (target) => ({
    ...target,
    content: (target.content as ContentPart[]).map((part) => {
      if (isToolCallPart(part)) {
        const isMatch = toolCallId ? part.toolCallId === toolCallId : part.name === name && !part.result;
        if (isMatch) {
          return {
            ...part,
            status: isError ? ("error" as const) : ("success" as const),
            result,
            resultError: isError,
          };
        }
      }
      return part;
    }),
  }));
}
