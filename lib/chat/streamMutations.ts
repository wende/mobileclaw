import { isToolCallPart } from "@mc/lib/constants";
import {
  appendCanvasPart,
  canvasToPluginPart,
  ensureContentArray,
} from "@mc/lib/plugins/compat";
import { updateAt } from "@mc/lib/messageUtils";
import type {
  CanvasPayload,
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

function summarizeMsg(m: Message): string {
  const parts = Array.isArray(m.content) ? m.content as ContentPart[] : [];
  return `{id=${m.id} role=${m.role} parts=[${summarizeParts(parts)}]}`;
}

interface EnsureResult {
  messages: Message[];
  created: boolean;
}

function mergeStreamText(existingText: string, incomingText: string): string {
  if (!incomingText) return existingText;
  if (!existingText) return incomingText;

  // Some runtimes send cumulative snapshots instead of true token deltas.
  if (
    incomingText.length > existingText.length &&
    incomingText.startsWith(existingText)
  ) {
    return incomingText;
  }

  // Drop stale/truncated snapshots that can arrive out of order.
  if (
    existingText.length > incomingText.length &&
    existingText.startsWith(incomingText)
  ) {
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
  const exists = prev.some((m) => m.id === runId);
  if (exists) {
    const existing = prev.find((m) => m.id === runId)!;
    console.log(`[STREAM-MUT] ensureStreamingMessage: EXISTS runId=${runId} msg=${summarizeMsg(existing)}`);
    return { messages: prev, created: false };
  }
  console.log(`[STREAM-MUT] ensureStreamingMessage: CREATING runId=${runId} prevMsgCount=${prev.length}`);
  return {
    created: true,
    messages: [
      ...prev,
      {
        role: "assistant",
        content: [],
        id: runId,
        timestamp: ts,
        ...extra,
      } as Message,
    ],
  };
}

export function appendContentDelta(
  messages: Message[],
  runId: string,
  delta: string,
  ts: number,
): EnsureResult {
  console.log(`[STREAM-MUT] appendContentDelta runId=${runId} deltaLen=${delta.length}`);
  const ensured = ensureStreamingMessage(messages, runId, ts);
  const updated = ensured.messages;
  const idx = updated.findIndex((m) => m.id === runId);
  if (idx < 0) {
    console.log(`[STREAM-MUT] appendContentDelta: msg NOT FOUND for runId=${runId}`);
    return ensured;
  }
  return {
    created: ensured.created,
    messages: updateAt(updated, idx, (target) => {
      const parts = ensureContentArray(target.content);
      const lastNonTextIdx = parts.findLastIndex(
        (p: ContentPart) => p.type !== "text",
      );
      const lastTextIdx = parts.findLastIndex(
        (p: ContentPart) => p.type === "text",
      );
      if (lastTextIdx > lastNonTextIdx) {
        const existing = parts[lastTextIdx].text || "";
        parts[lastTextIdx] = {
          ...parts[lastTextIdx],
          text: mergeStreamText(existing, delta),
        };
      } else {
        parts.push({ type: "text" as const, text: delta });
      }
      return { ...target, content: parts };
    }),
  };
}

export function appendThinkingDelta(
  messages: Message[],
  runId: string,
  delta: string,
  ts: number,
): EnsureResult {
  console.log(`[STREAM-MUT] appendThinkingDelta runId=${runId} deltaLen=${delta.length}`);
  const ensured = ensureStreamingMessage(messages, runId, ts);
  const updated = ensured.messages;
  const idx = updated.findIndex((m) => m.id === runId);
  if (idx < 0) {
    console.log(`[STREAM-MUT] appendThinkingDelta: msg NOT FOUND for runId=${runId}`);
    return ensured;
  }
  return {
    created: ensured.created,
    messages: updateAt(updated, idx, (target) => {
      const parts = ensureContentArray(target.content);
      const lastThinkIdx = parts.findLastIndex(
        (p: ContentPart) => p.type === "thinking",
      );
      const lastNonThinkingIdx = parts.findLastIndex(
        (p: ContentPart) => p.type !== "thinking",
      );
      if (lastThinkIdx > lastNonThinkingIdx) {
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

export function startThinkingBlock(
  messages: Message[],
  runId: string,
  ts: number,
): EnsureResult {
  const ensured = ensureStreamingMessage(messages, runId, ts);
  const updated = ensured.messages;
  const idx = updated.findIndex((m) => m.id === runId);
  if (idx < 0) return ensured;
  return {
    created: ensured.created,
    messages: updateAt(updated, idx, (target) => {
      const parts = ensureContentArray(target.content);
      const lastPart = parts[parts.length - 1];
      if (lastPart?.type === "thinking" && !(lastPart.text || "").trim()) {
        return target;
      }
      parts.push({ type: "thinking" as const, text: "" });
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
  narration?: string,
): EnsureResult {
  console.log(`[STREAM-MUT] addToolCall runId=${runId} name=${name} tcid=${toolCallId || "none"}`);
  const ensured = ensureStreamingMessage(messages, runId, ts);
  const updated = ensured.messages;
  const idx = updated.findIndex((m) => m.id === runId);
  if (idx < 0) {
    console.log(`[STREAM-MUT] addToolCall: msg NOT FOUND for runId=${runId}`);
    return ensured;
  }
  console.log(`[STREAM-MUT] addToolCall: target msg=${summarizeMsg(updated[idx])}`);

  const parts = ensureContentArray(updated[idx].content);
  // If a tool_call part with this toolCallId already exists, update it
  // (e.g. narration arrived after the initial start event).
  if (toolCallId) {
    const existingIdx = parts.findIndex(
      (p) => isToolCallPart(p) && p.toolCallId === toolCallId,
    );
    if (existingIdx >= 0) {
      console.log(`[STREAM-MUT] addToolCall: UPDATING existing tcid=${toolCallId} at partIdx=${existingIdx}`);
      return {
        created: ensured.created,
        messages: updateAt(updated, idx, (target) => ({
          ...target,
          content: (target.content as ContentPart[]).map((part, i) =>
            i === existingIdx
              ? {
                  ...part,
                  ...(narration ? { narration } : {}),
                  ...(args ? { arguments: args } : {}),
                }
              : part,
          ),
        })),
      };
    }
  }

  const newParts = [
    ...parts,
    {
      type: "tool_call" as const,
      name,
      toolCallId,
      arguments: args,
      status: "running" as const,
      ...(narration ? { narration } : {}),
    },
  ];
  console.log(`[STREAM-MUT] addToolCall: APPENDED resultParts=[${summarizeParts(newParts)}]`);
  return {
    created: ensured.created,
    messages: updateAt(updated, idx, (target) => ({
      ...target,
      content: newParts,
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
  console.log(`[STREAM-MUT] resolveToolCall runId=${runId} name=${name} tcid=${toolCallId || "none"} foundIdx=${idx} isError=${!!isError}`);
  if (idx < 0 || !Array.isArray(messages[idx].content)) {
    console.log(`[STREAM-MUT] resolveToolCall: msg NOT FOUND or no content array`);
    return messages;
  }
  console.log(`[STREAM-MUT] resolveToolCall: target msg=${summarizeMsg(messages[idx])}`);
  return updateAt(messages, idx, (target) => ({
    ...target,
    content: (target.content as ContentPart[]).map((part) => {
      if (isToolCallPart(part)) {
        const isMatch = toolCallId
          ? part.toolCallId === toolCallId
          : part.name === name && !part.result;
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

function shouldApplyRevision(
  current: PluginContentPart,
  nextRevision?: number,
): boolean {
  if (nextRevision == null) return true;
  if (current.revision == null) return true;
  return nextRevision >= current.revision;
}

function upsertPluginIntoParts(
  parts: ContentPart[],
  part: PluginContentPart,
  index?: number,
): ContentPart[] {
  const existingIdx = parts.findIndex(
    (entry) => entry.type === "plugin" && entry.partId === part.partId,
  );
  if (existingIdx >= 0) {
    const current = parts[existingIdx] as PluginContentPart;
    if (!shouldApplyRevision(current, part.revision)) return parts;
    return updateAt(parts, existingIdx, (entry) => ({ ...entry, ...part }));
  }

  const next = [...parts];
  if (typeof index === "number" && index >= 0 && index <= next.length) {
    next.splice(index, 0, part);
    return next;
  }
  next.push(part);
  return next;
}

export function mountPluginPart(
  messages: Message[],
  runId: string,
  part: PluginContentPart,
  ts: number,
  index?: number,
): EnsureResult {
  const ensured = ensureStreamingMessage(messages, runId, ts);
  const updated = ensured.messages;
  const idx = updated.findIndex((m) => m.id === runId);
  if (idx < 0) return ensured;
  return {
    created: ensured.created,
    messages: updateAt(updated, idx, (target) => ({
      ...target,
      content: upsertPluginIntoParts(
        ensureContentArray(target.content),
        part,
        index,
      ),
    })),
  };
}

export function replacePluginPart(
  messages: Message[],
  runId: string,
  partId: string,
  next: Pick<PluginContentPart, "state" | "data" | "revision">,
): Message[] {
  const idx = messages.findIndex((m) => m.id === runId);
  if (idx < 0) return messages;
  return updateAt(messages, idx, (target) => {
    const parts = ensureContentArray(target.content);
    const pluginIdx = parts.findIndex(
      (part) => part.type === "plugin" && part.partId === partId,
    );
    if (pluginIdx < 0) return target;
    const current = parts[pluginIdx] as PluginContentPart;
    if (!shouldApplyRevision(current, next.revision)) return target;
    return {
      ...target,
      content: updateAt(parts, pluginIdx, (part) => ({ ...part, ...next })),
    };
  });
}

export function removePluginPart(
  messages: Message[],
  runId: string,
  partId: string,
  tombstone?: boolean,
): Message[] {
  const idx = messages.findIndex((m) => m.id === runId);
  if (idx < 0) return messages;
  return updateAt(messages, idx, (target) => {
    const parts = ensureContentArray(target.content);
    const pluginIdx = parts.findIndex(
      (part) => part.type === "plugin" && part.partId === partId,
    );
    if (pluginIdx < 0) return target;
    return {
      ...target,
      content: tombstone
        ? updateAt(parts, pluginIdx, (part) => ({
            ...part,
            state: "tombstone" as const,
          }))
        : parts.filter(
            (part) => !(part.type === "plugin" && part.partId === partId),
          ),
    };
  });
}

export function upsertCanvasPluginByMessageId(
  messages: Message[],
  messageId: string,
  canvas: CanvasPayload,
): Message[] {
  const idx = messages.findIndex((message) => message.id === messageId);
  if (idx < 0) return messages;
  const part = canvasToPluginPart(canvas);
  return updateAt(messages, idx, (target) => ({
    ...target,
    content: upsertPluginIntoParts(ensureContentArray(target.content), part),
  }));
}

function normalizeIncomingContent(
  content: ContentPart[] | string,
  canvas?: CanvasPayload,
): ContentPart[] {
  return appendCanvasPart(content, canvas);
}

function hasIncomingContent(
  content: ContentPart[] | string,
  canvas?: CanvasPayload,
): boolean {
  if (canvas) return true;
  if (typeof content === "string") return content.length > 0;
  return content.length > 0;
}

export function upsertFinalRunMessage(
  messages: Message[],
  runId: string,
  incoming?: {
    id?: string;
    role: "user" | "assistant" | "system" | "tool";
    content: ContentPart[] | string;
    timestamp?: number;
    reasoning?: string;
    canvas?: CanvasPayload;
  },
): Message[] {
  if (!incoming) return messages;
  if (incoming.role === "user") return messages;

  const nextContent = normalizeIncomingContent(
    incoming.content,
    incoming.canvas,
  );
  const shouldApplyContent = hasIncomingContent(
    incoming.content,
    incoming.canvas,
  );
  const idx = messages.findIndex((m) => m.id === runId);

  console.log(
    `[STREAM-MUT] upsertFinalRunMessage runId=${runId} role=${incoming.role} ` +
    `shouldApplyContent=${shouldApplyContent} existingIdx=${idx} ` +
    `nextParts=[${summarizeParts(nextContent)}]` +
    (idx >= 0 ? ` existingMsg=${summarizeMsg(messages[idx])}` : "")
  );

  if (idx >= 0) {
    return updateAt(messages, idx, (target) => {
      const result = {
        ...target,
        role: incoming.role,
        content: shouldApplyContent ? nextContent : target.content,
        timestamp: incoming.timestamp ?? target.timestamp,
        reasoning: incoming.reasoning ?? target.reasoning,
      };
      console.log(
        `[STREAM-MUT] upsertFinalRunMessage: UPDATED ` +
        `contentReplaced=${shouldApplyContent} resultParts=[${summarizeParts(Array.isArray(result.content) ? result.content as ContentPart[] : [])}]`
      );
      return result;
    });
  }

  if (!shouldApplyContent && !incoming.reasoning) return messages;

  console.log(`[STREAM-MUT] upsertFinalRunMessage: CREATED NEW`);
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
