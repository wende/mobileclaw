import { isToolCallPart } from "@/lib/constants";
import { updateAt } from "@/lib/messageUtils";
import type { ContentPart, Message } from "@/types/chat";

interface EnsureResult {
  messages: Message[];
  created: boolean;
}

function mergeStreamText(existingText: string, incomingText: string): string {
  if (!incomingText) return existingText;
  if (!existingText) return incomingText;

  // Some runtimes send cumulative snapshots instead of true token deltas.
  if (incomingText.length > existingText.length && incomingText.startsWith(existingText)) {
    return incomingText;
  }

  // Drop stale/truncated snapshots that can arrive out of order.
  if (existingText.length > incomingText.length && existingText.startsWith(incomingText)) {
    return existingText;
  }

  return existingText + incomingText;
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
        const existing = parts[lastTextIdx].text || "";
        parts[lastTextIdx] = { ...parts[lastTextIdx], text: mergeStreamText(existing, delta) };
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
        const existing = parts[lastThinkIdx].text || "";
        parts[lastThinkIdx] = {
          ...parts[lastThinkIdx],
          type: "thinking",
          text: mergeStreamText(existing, delta),
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

function normalizeIncomingContent(content: ContentPart[] | string): ContentPart[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content;
}

function hasIncomingContent(content: ContentPart[] | string): boolean {
  if (typeof content === "string") return content.length > 0;
  return content.length > 0;
}

export function upsertFinalRunMessage(
  messages: Message[],
  runId: string,
  incoming?: {
    role: "user" | "assistant" | "system" | "tool";
    content: ContentPart[] | string;
    timestamp?: number;
    reasoning?: string;
  },
): Message[] {
  if (!incoming) return messages;
  if (incoming.role === "user") return messages;

  const nextContent = normalizeIncomingContent(incoming.content);
  const shouldApplyContent = hasIncomingContent(incoming.content);
  const idx = messages.findIndex((m) => m.id === runId);

  if (idx >= 0) {
    return updateAt(messages, idx, (target) => ({
      ...target,
      role: incoming.role,
      content: shouldApplyContent ? nextContent : target.content,
      timestamp: incoming.timestamp ?? target.timestamp,
      reasoning: incoming.reasoning || target.reasoning,
    }));
  }

  if (!shouldApplyContent && !incoming.reasoning) return messages;

  return [
    ...messages,
    {
      role: incoming.role,
      content: shouldApplyContent ? nextContent : [],
      id: runId,
      timestamp: incoming.timestamp ?? Date.now(),
      reasoning: incoming.reasoning,
    } as Message,
  ];
}
