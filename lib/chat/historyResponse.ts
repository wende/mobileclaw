import {
  GATEWAY_INJECTED_MODEL,
  isInternalCommandFetchRunId,
  SPAWN_TOOL_NAME,
  STOP_REASON_INJECTED,
  isContextText,
  isToolCallPart,
} from "@mc/lib/constants";
import { appendCanvasPart } from "@mc/lib/plugins/compat";
import { getTextFromContent } from "@mc/lib/messageUtils";
import type { CanvasPayload, ContentPart, Message } from "@mc/types/chat";

const OPTIMISTIC_DEDUP_WINDOW_MS = 10_000;

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

function readHistoryMessageId(raw: RawHistoryMessage): string | undefined {
  const candidates = [
    raw.messageId,
    raw.message_id,
    raw.messageKey,
    raw.message_key,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function readOpenClawId(raw: RawHistoryMessage): string | undefined {
  const oc = raw.__openclaw as Record<string, unknown> | undefined;
  if (oc && typeof oc.id === "string" && oc.id) return oc.id;
  return undefined;
}

function buildStableHistoryId(raw: RawHistoryMessage, idx: number): string {
  const messageId = readHistoryMessageId(raw);
  if (messageId) return messageId;

  const runId = readHistoryRunId(raw);
  if (runId) {
    if (raw.role === "assistant") return runId;
    return `${runId}:${raw.role}`;
  }

  // OpenClaw gateway history messages carry a stable server-assigned ID in
  // __openclaw.id (8-char hex). Use it so that IDs survive across history
  // re-fetches instead of shifting with index-based hist-N.
  const openclawId = readOpenClawId(raw);
  if (openclawId) return `oc-${openclawId}`;

  if (typeof raw.id === "string" && raw.id.length > 0) return `${raw.id}:${raw.role}`;
  return `hist-${idx}`;
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
      const canvas = raw.canvas as CanvasPayload | undefined;
      return !!canvas || (content && !(Array.isArray(content) && content.length === 0));
    })
    .map((raw, idx) => {
      const content = raw.content as ContentPart[] | string;
      const canvas = raw.canvas as CanvasPayload | undefined;
      let reasoning: string | undefined;
      let filteredContent: ContentPart[] | string;

      if (Array.isArray(content)) {
        const thinkingParts = content.filter((p) => p.type === "thinking");
        if (thinkingParts.length > 0) {
          reasoning = thinkingParts.map((p) => p.thinking || p.text || "").filter(Boolean).join("\n\n");
        }
        // Fall back to raw.reasoning if content has no thinking parts
        // (e.g. when bridge stored reasoning at top level only)
        if (!reasoning && typeof raw.reasoning === "string" && raw.reasoning) {
          reasoning = raw.reasoning;
        }
        // Keep thinking parts in content so they render interleaved with
        // tool calls. Canvas payloads are appended as plugin parts.
        filteredContent = appendCanvasPart(content, canvas);
      } else {
        if (typeof raw.reasoning === "string" && raw.reasoning) {
          reasoning = raw.reasoning;
        }
        filteredContent = appendCanvasPart(content, canvas);
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
        id: buildStableHistoryId(raw, idx),
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

/**
 * Merge thinking blocks from history into the streaming message's content.
 * Returns a merged content array, or null if no merge was needed/possible.
 *
 * History content typically has: [thinking, tool_call, thinking, text]
 * Streaming content typically has: [tool_call, text]
 *
 * The result inserts thinking blocks from history at the correct positions
 * while keeping the streaming version's tool_call/text parts (which may
 * have richer runtime data like tool results).
 */
function mergeHistoryIntoStreaming(
  streamingParts: ContentPart[],
  historyParts: ContentPart[],
): ContentPart[] | null {
  const historyHasThinking = historyParts.some((p) => p.type === "thinking");
  const streamingHasThinking = streamingParts.some((p) => p.type === "thinking");
  // Only merge if history adds thinking blocks the streaming version lacks.
  if (!historyHasThinking || streamingHasThinking) return null;

  // Build a merged array using history's structure as the template.
  // For each part in history:
  //   - thinking → take from history (streaming doesn't have it)
  //   - tool_call → take from streaming (has result/status data)
  //   - text → take from streaming (may be more up-to-date)
  //   - other → take from history
  const result: ContentPart[] = [];
  // Track which streaming parts have been consumed to append any leftovers.
  const consumedStreamIdx = new Set<number>();

  // Index streaming tool_calls by toolCallId for fast lookup.
  const streamToolCalls = new Map<string, { part: ContentPart; idx: number }>();
  // Also index by name for fallback matching.
  const streamToolCallsByName = new Map<string, { part: ContentPart; idx: number }[]>();
  for (let i = 0; i < streamingParts.length; i++) {
    const p = streamingParts[i];
    if (isToolCallPart(p)) {
      if (p.toolCallId) streamToolCalls.set(p.toolCallId, { part: p, idx: i });
      const list = streamToolCallsByName.get(p.name ?? "") ?? [];
      list.push({ part: p, idx: i });
      streamToolCallsByName.set(p.name ?? "", list);
    }
  }

  for (const hp of historyParts) {
    if (hp.type === "thinking") {
      result.push(hp);
      continue;
    }

    if (isToolCallPart(hp)) {
      // Prefer the streaming version of this tool_call (has result data).
      let match: { part: ContentPart; idx: number } | undefined;
      if (hp.toolCallId) match = streamToolCalls.get(hp.toolCallId);
      if (!match) {
        const byName = streamToolCallsByName.get(hp.name ?? "");
        match = byName?.find((e) => !consumedStreamIdx.has(e.idx));
      }
      if (match) {
        result.push(match.part);
        consumedStreamIdx.add(match.idx);
      } else {
        result.push(hp);
      }
      continue;
    }

    if (hp.type === "text") {
      // Find the corresponding text in streaming (last unconsumed text).
      const streamTextIdx = streamingParts.findIndex(
        (p, i) => p.type === "text" && !consumedStreamIdx.has(i),
      );
      if (streamTextIdx >= 0) {
        result.push(streamingParts[streamTextIdx]);
        consumedStreamIdx.add(streamTextIdx);
      } else {
        result.push(hp);
      }
      continue;
    }

    // Plugin or other part types — take from history.
    result.push(hp);
  }

  // Append any unconsumed streaming parts (e.g. extra tool_calls or text
  // that arrived after the history snapshot was taken).
  for (let i = 0; i < streamingParts.length; i++) {
    if (!consumedStreamIdx.has(i)) result.push(streamingParts[i]);
  }

  return result;
}

export function mergeHistoryWithOptimistic(finalMessages: Message[], previousMessages: Message[]): Message[] {
  const optimisticByNorm = new Map<string, Message>();
  for (const message of previousMessages) {
    if (message.role === "user" && message.id?.startsWith("u-")) {
      optimisticByNorm.set(normalizeTextForMatch(getTextFromContent(message.content)), message);
    }
  }

  const prevAssistantLocals: {
    id?: string;
    ts?: number;
    text: string;
    runDuration?: number;
    thinkingDuration?: number;
    isCommandResponse?: boolean;
  }[] = [];
  for (const message of previousMessages) {
    if (message.role === "assistant") {
      prevAssistantLocals.push({
        id: message.id,
        ts: message.timestamp,
        text: normalizeTextForMatch(getTextFromContent(message.content)),
        runDuration: message.runDuration,
        thinkingDuration: message.thinkingDuration,
        isCommandResponse: message.isCommandResponse,
      });
    }
  }

  // Track consumed prevAssistantLocals indices so the same entry can't
  // be matched by multiple server messages (which would create duplicate IDs).
  const consumedPrevIndices = new Set<number>();

  function findPrevAssistant(
    predicate: (p: typeof prevAssistantLocals[number]) => boolean,
  ): typeof prevAssistantLocals[number] | undefined {
    const idx = prevAssistantLocals.findIndex(
      (p, i) => !consumedPrevIndices.has(i) && predicate(p),
    );
    if (idx < 0) return undefined;
    consumedPrevIndices.add(idx);
    return prevAssistantLocals[idx];
  }

  const enriched = finalMessages.map((message) => {
    if (message.role === "assistant" && prevAssistantLocals.length > 0) {
      const msgText = normalizeTextForMatch(getTextFromContent(message.content));
      // Server-assigned IDs (hist-*, oc-*) don't match streaming IDs (runId),
      // so fall back to text/timestamp matching. Only true streaming IDs that
      // were already matched by a previous history fetch should use strict ID
      // matching — those won't start with hist- or oc-.
      const isServerAssignedId = !message.id
        || message.id.startsWith("hist-")
        || message.id.startsWith("oc-");
      const textOrTsMatch = (p: typeof prevAssistantLocals[number]) =>
        !!(p.ts && message.timestamp && p.ts === message.timestamp) || !!(msgText && p.text === msgText);
      const prev = isServerAssignedId
        ? findPrevAssistant(textOrTsMatch)
        : findPrevAssistant((p) => p.id === message.id)
          // If strict ID match fails, try text/timestamp as fallback
          ?? findPrevAssistant(textOrTsMatch);
      if (prev) {
        const carry: Partial<Message> = {};
        // Only carry over streaming/run IDs (e.g. "run-abc"), never
        // server-assigned IDs (hist-*, oc-*) which would create duplicate keys.
        if (prev.id && prev.id !== message.id && !prev.id.startsWith("hist-") && !prev.id.startsWith("oc-")) carry.id = prev.id;
        if (prev.runDuration && !message.runDuration) carry.runDuration = prev.runDuration;
        if (prev.thinkingDuration && !message.thinkingDuration) carry.thinkingDuration = prev.thinkingDuration;
        if (prev.isCommandResponse && !message.isCommandResponse) carry.isCommandResponse = true;
        if (Object.keys(carry).length > 0) return { ...message, ...carry };
      }
      return message;
    }
    if (message.role !== "user") return message;
    const normKey = normalizeTextForMatch(getTextFromContent(message.content));
    const optimistic = optimisticByNorm.get(normKey);
    if (!optimistic || !Array.isArray(optimistic.content)) return message;
    // Only match if timestamps are close — prevents an old message with
    // identical text from stealing the optimistic ID when the server
    // hasn't yet processed the current message.
    const optTs = optimistic.timestamp ?? 0;
    const msgTs = message.timestamp ?? 0;
    if (optTs && msgTs && Math.abs(optTs - msgTs) > OPTIMISTIC_DEDUP_WINDOW_MS) return message;
    // Consume so a second server message with identical text keeps its oc-* ID.
    optimisticByNorm.delete(normKey);

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
  if (finalMessages.length < previousServerCount) {
    console.log(
      `[STREAM] mergeHistoryWithOptimistic: SKIPPING history (${finalMessages.length} < ${previousServerCount} prev server msgs)`
    );
    return previousMessages;
  }

  // After enrichment, remaining entries in optimisticByNorm are optimistic
  // messages that were NOT matched to any server message (server hasn't
  // processed them yet). These must be carried over.
  // Using consumption tracking instead of historyUserNorms avoids the bug
  // where an old server message with identical text tricks us into thinking
  // the current optimistic is already covered.
  const optimisticPending = [...optimisticByNorm.values()];

  // Preserve streaming assistant messages that aren't in history yet
  // (e.g. mid-run messages with plugin cards like pause_card).
  // Also detect when the streaming version has richer content (thinking/tool
  // parts from agent events) than the history version — the server doesn't
  // include thinking blocks during streaming, so the streaming version must
  // win until the run completes and history catches up.
  const enrichedIds = new Set(enriched.map((m) => m.id).filter(Boolean));
  const enrichedById = new Map(enriched.filter((m) => m.id).map((m) => [m.id, m]));
  const streamingAssistant: Message[] = [];
  const enrichedIdsToReplace = new Set<string>();

  for (const message of previousMessages) {
    if (message.role !== "assistant" || !message.id || message.id.startsWith("hist-") || message.id.startsWith("oc-")) continue;

    if (!enrichedIds.has(message.id)) {
      streamingAssistant.push(message);
      continue;
    }

    // ID is in enriched — check if streaming version has richer content.
    const prevParts = Array.isArray(message.content) ? message.content : [];
    const enrichedMsg = enrichedById.get(message.id);
    const enrichedParts = enrichedMsg && Array.isArray(enrichedMsg.content) ? enrichedMsg.content : [];

    const prevHasStreamParts = prevParts.some((p) => p.type === "thinking" || isToolCallPart(p));
    const enrichedHasStreamParts = enrichedParts.some((p) => p.type === "thinking" || isToolCallPart(p));

    if (prevHasStreamParts && !enrichedHasStreamParts) {
      console.log(`[STREAM] mergeHistoryWithOptimistic: PREFER streaming over history for id=${message.id} (has thinking/tool parts)`);
      streamingAssistant.push(message);
      enrichedIdsToReplace.add(message.id);
    } else if (enrichedMsg) {
      // History has richer content (e.g. thinking blocks the streaming version
      // lacks). Instead of a wholesale replacement that causes a layout jump,
      // merge thinking blocks from history into the streaming content so that
      // tool_call and text parts stay in place for smooth React reconciliation.
      const merged = mergeHistoryIntoStreaming(prevParts, enrichedParts);
      if (merged) {
        streamingAssistant.push({
          ...message,
          content: merged,
          reasoning: enrichedMsg.reasoning ?? message.reasoning,
        });
        enrichedIdsToReplace.add(message.id);
      }
    }
  }

  const filteredEnriched = enrichedIdsToReplace.size > 0
    ? enriched.filter((m) => !m.id || !enrichedIdsToReplace.has(m.id))
    : enriched;

  console.log(
    `[STREAM] mergeHistoryWithOptimistic: enriched=${enriched.length} filtered=${filteredEnriched.length} optimisticPending=${optimisticPending.length} ` +
    `streamingAssistant=${streamingAssistant.length} streamingAssistantIds=[${streamingAssistant.map(m => m.id).join(",")}] ` +
    `replaced=[${[...enrichedIdsToReplace].join(",")}]`
  );

  const carry = [...optimisticPending, ...streamingAssistant];
  const merged = carry.length === 0 ? filteredEnriched : [...filteredEnriched, ...carry].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  // Deduplicate by ID — if a previous merge cycle already created a dup
  // (e.g. enrichment + streaming carry-over both had the same run ID),
  // keep the first occurrence to prevent perpetuating duplicate React keys.
  const seenIds = new Set<string>();
  const deduped = merged.filter((m) => {
    if (!m.id) return true;
    if (seenIds.has(m.id)) {
      console.log(`[STREAM] mergeHistoryWithOptimistic: DEDUP removing duplicate id=${m.id}`);
      return false;
    }
    seenIds.add(m.id);
    return true;
  });

  return deduped;
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
