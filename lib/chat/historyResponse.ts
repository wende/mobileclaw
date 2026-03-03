import {
  GATEWAY_INJECTED_MODEL,
  isInternalCommandFetchRunId,
  SPAWN_TOOL_NAME,
  STOP_REASON_INJECTED,
  isContextText,
  isToolCallPart,
} from "@/lib/constants";
import { getTextFromContent } from "@/lib/messageUtils";
import type { ContentPart, Message } from "@/types/chat";

type RawHistoryMessage = Record<string, unknown>;

function readPrimaryText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const textPart = (content as ContentPart[]).find((p) => p.type === "text" && p.text);
  return textPart?.text ?? "";
}

function readAllText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as ContentPart[])
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("");
}

function readHistoryRunId(raw: RawHistoryMessage): string | undefined {
  const candidates = [
    raw.runId,
    raw.run_id,
    raw.idempotencyKey,
    raw.idempotency_key,
    raw.id,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

interface PrepareHistoryResult<TCommand extends { name: string }> {
  rawMessages: RawHistoryMessage[];
  inferredServerCommands?: TCommand[];
}

interface PrepareHistoryOptions<TCommand extends { name: string }> {
  allRawMessages: RawHistoryMessage[];
  parseServerCommands: (text: string) => TCommand[];
  coreCommandNames: Set<string>;
}

export function prepareHistoryMessages<TCommand extends { name: string }>({
  allRawMessages,
  parseServerCommands,
  coreCommandNames,
}: PrepareHistoryOptions<TCommand>): PrepareHistoryResult<TCommand> {
  const skipIndices = new Set<number>();
  let inferredServerCommands: TCommand[] | undefined;
  const internalCommandRuns = new Set<string>();

  for (let i = 0; i < allRawMessages.length; i++) {
    const raw = allRawMessages[i];
    const runId = readHistoryRunId(raw);
    if (isInternalCommandFetchRunId(runId)) {
      internalCommandRuns.add(runId);
      skipIndices.add(i);
      continue;
    }

    if (runId && internalCommandRuns.has(runId)) {
      skipIndices.add(i);
      continue;
    }

    if (raw.role === "user") {
      const text = readPrimaryText(raw.content);
      if (text.trim() === "/commands") {
        skipIndices.add(i);
        if (i + 1 < allRawMessages.length && allRawMessages[i + 1].role === "assistant") {
          skipIndices.add(i + 1);
        }
      }
    }

    if (raw.role === "assistant" && raw.model === GATEWAY_INJECTED_MODEL && !skipIndices.has(i)) {
      const text = readAllText(raw.content);
      if (!text) continue;

      const parsed = parseServerCommands(text);
      if (parsed.length < 8) continue;

      skipIndices.add(i);
      const extra = parsed.filter((cmd) => !coreCommandNames.has(cmd.name));
      if (extra.length > 0) inferredServerCommands = extra;
    }
  }

  return {
    rawMessages: allRawMessages.filter((_, i) => !skipIndices.has(i)),
    inferredServerCommands,
  };
}

export function buildHistoryMessages(rawMessages: RawHistoryMessage[]): Message[] {
  return rawMessages
    .filter((raw) => {
      const content = raw.content as ContentPart[] | string | null;
      return content && !(Array.isArray(content) && content.length === 0);
    })
    .map((raw, idx) => {
      const content = raw.content as ContentPart[] | string;
      let reasoning: string | undefined;
      let filteredContent: ContentPart[] | string;

      if (Array.isArray(content)) {
        const thinkingPart = content.find((p) => p.type === "thinking");
        if (thinkingPart?.thinking) reasoning = thinkingPart.thinking;
        filteredContent = content.filter((p) => p.type !== "thinking");
      } else {
        filteredContent = content;
      }

      let toolName: string | undefined;
      if (raw.name) toolName = raw.name as string;
      else if (raw.toolName) toolName = raw.toolName as string;
      if (!toolName && Array.isArray(filteredContent)) {
        const toolPart = filteredContent.find((p) => p.name);
        if (toolPart) toolName = toolPart.name;
      }

      let isContext = false;
      if (raw.role === "user" && Array.isArray(filteredContent)) {
        const textPart = filteredContent.find((p) => p.type === "text" && p.text);
        if (textPart?.text && typeof textPart.text === "string" && isContextText(textPart.text)) {
          isContext = true;
        }
      }

      const isGatewayInjected = raw.model === GATEWAY_INJECTED_MODEL;
      const effectiveStopReason = isGatewayInjected ? STOP_REASON_INJECTED : raw.stopReason;

      return {
        role: raw.role,
        content: filteredContent,
        timestamp: raw.timestamp,
        id: `hist-${idx}`,
        reasoning,
        toolName,
        isError: raw.stopReason === "error" || !!raw.isError,
        stopReason: effectiveStopReason,
        isContext,
      } as Message;
    });
}

function resolveModelValue(raw: RawHistoryMessage | undefined): string | undefined {
  if (!raw?.model) return undefined;
  const provider = raw.provider as string | undefined;
  const model = raw.model as string;
  return provider ? `${provider}/${model}` : model;
}

export function inferCurrentModel(rawMessages: RawHistoryMessage[]): string | undefined {
  const lastAssistantRaw = rawMessages.filter((m) => m.role === "assistant" && m.model).pop();
  let inferredModel = resolveModelValue(lastAssistantRaw);

  const lastInjected = rawMessages.filter((m) => m.stopReason === STOP_REASON_INJECTED).pop();
  if (!lastInjected) return inferredModel;

  const injectedModel = resolveModelValue(lastInjected);
  if (injectedModel) return injectedModel;

  const injectedText = readAllText(lastInjected.content);
  const modelMatch = injectedText.match(/model\s+(?:set\s+to|changed\s+to|is|:)\s+[`*]*([a-zA-Z0-9_./-]+)[`*]*/i);
  if (modelMatch) inferredModel = modelMatch[1];
  return inferredModel;
}

function normalizeTextForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function mergeHistoryWithOptimistic(finalMessages: Message[], previousMessages: Message[]): Message[] {
  const optimisticByNorm = new Map<string, Message>();
  for (const message of previousMessages) {
    if (message.role === "user" && message.id?.startsWith("u-")) {
      optimisticByNorm.set(normalizeTextForMatch(getTextFromContent(message.content)), message);
    }
  }

  const historyUserNorms = new Set(
    finalMessages
      .filter((message) => message.role === "user")
      .map((message) => normalizeTextForMatch(getTextFromContent(message.content))),
  );

  const prevAssistantLocals: { id?: string; ts?: number; text: string; runDuration?: number; thinkingDuration?: number }[] = [];
  for (const message of previousMessages) {
    if (message.role === "assistant") {
      prevAssistantLocals.push({
        id: message.id,
        ts: message.timestamp,
        text: normalizeTextForMatch(getTextFromContent(message.content)),
        runDuration: message.runDuration,
        thinkingDuration: message.thinkingDuration,
      });
    }
  }

  const enriched = finalMessages.map((message) => {
    if (message.role === "assistant" && prevAssistantLocals.length > 0) {
      const msgText = normalizeTextForMatch(getTextFromContent(message.content));
      const prev = prevAssistantLocals.find((p) =>
        (p.ts && message.timestamp && p.ts === message.timestamp) || (msgText && p.text === msgText),
      );
      if (prev) {
        const carry: Partial<Message> = {};
        if (prev.id && prev.id !== message.id) carry.id = prev.id;
        if (prev.runDuration && !message.runDuration) carry.runDuration = prev.runDuration;
        if (prev.thinkingDuration && !message.thinkingDuration) carry.thinkingDuration = prev.thinkingDuration;
        if (Object.keys(carry).length > 0) return { ...message, ...carry };
      }
      return message;
    }
    if (message.role !== "user") return message;
    const optimistic = optimisticByNorm.get(normalizeTextForMatch(getTextFromContent(message.content)));
    if (!optimistic || !Array.isArray(optimistic.content)) return message;

    const optimisticText = optimistic.content.filter((part) => part.type === "text");
    const optimisticImages = optimistic.content.filter((part) => part.type === "image_url" || part.type === "image");
    const serverImages = Array.isArray(message.content)
      ? message.content.filter((part) => part.type === "image_url" || part.type === "image")
      : [];
    const images = serverImages.length > 0 ? serverImages : optimisticImages;
    const nonTextNonImage = Array.isArray(message.content)
      ? message.content.filter((part) => part.type !== "text" && part.type !== "image_url" && part.type !== "image")
      : [];

    if (optimisticText.length === 0 && images.length === 0) {
      return { ...message, id: optimistic.id };
    }
    return { ...message, id: optimistic.id, content: [...optimisticText, ...nonTextNonImage, ...images] };
  });

  const previousServerCount = previousMessages.filter((message) => !(message.role === "user" && message.id?.startsWith("u-"))).length;
  // If history briefly lags behind already-rendered realtime events, do not roll UI back.
  if (finalMessages.length < previousServerCount) return previousMessages;

  const optimisticPending = previousMessages.filter(
    (message) =>
      message.role === "user" &&
      message.id?.startsWith("u-") &&
      !historyUserNorms.has(normalizeTextForMatch(getTextFromContent(message.content))),
  );
  if (optimisticPending.length === 0) return enriched;

  return [...enriched, ...optimisticPending].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

export function isRunInProgressFromHistory(rawMessages: RawHistoryMessage[]): boolean {
  const lastRaw = rawMessages[rawMessages.length - 1];
  const lastIsUser = lastRaw?.role === "user";
  const lastAssistant = [...rawMessages].reverse().find((m) => m.role === "assistant");
  return !!(lastIsUser || (lastAssistant && !lastAssistant.stopReason));
}

export function extractSpawnChildSessionKeys(rawMessages: RawHistoryMessage[]): string[] {
  const keys: string[] = [];

  for (const raw of rawMessages) {
    if (raw.role !== "assistant" || !Array.isArray(raw.content)) continue;
    for (const part of raw.content as ContentPart[]) {
      if (!isToolCallPart(part) || part.name !== SPAWN_TOOL_NAME) continue;
      if (!part.result) continue;
      try {
        const parsed = JSON.parse(part.result) as { childSessionKey?: string };
        if (parsed?.childSessionKey) keys.push(parsed.childSessionKey);
      } catch {}
    }
  }

  return keys;
}
