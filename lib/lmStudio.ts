// LM Studio API client — OpenAI-compatible HTTP + SSE streaming
// Supports text, reasoning/thinking, and tool call streaming

// ── Types ────────────────────────────────────────────────────────────────────

export interface LmStudioConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface LmStudioModel {
  id: string;
  object: string;
  owned_by: string;
}

interface ContentPart {
  type: string;
  text?: string;
  name?: string;
  arguments?: string;
  status?: "running" | "success" | "error";
  result?: string;
  resultError?: boolean;
}

interface Message {
  role: string;
  content: ContentPart[] | string | null;
  timestamp?: number;
  id?: string;
  reasoning?: string;
  toolName?: string;
  toolArgs?: string;
  isError?: boolean;
  stopReason?: string;
  isContext?: boolean;
}

// OpenAI chat completion message format
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

// ── Model fetching ───────────────────────────────────────────────────────────

export async function fetchLmStudioModels(
  baseUrl: string,
  apiKey?: string
): Promise<LmStudioModel[]> {
  const params = new URLSearchParams({ url: baseUrl.replace(/\/$/, ""), path: "/v1/models" });
  if (apiKey) params.set("apiKey", apiKey);

  const res = await fetch(`/api/lmstudio?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// ── Message conversion ───────────────────────────────────────────────────────

function getTextFromContent(content: ContentPart[] | string | null): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("");
}

function getToolCallsFromContent(content: ContentPart[] | string | null): ContentPart[] {
  if (!content || typeof content === "string") return [];
  return content.filter((p) => p.type === "tool_call" && p.name);
}

export function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system" || msg.stopReason === "injected") {
      const text = getTextFromContent(msg.content);
      if (text) result.push({ role: "system", content: text });
      continue;
    }

    if (msg.role === "user") {
      const text = getTextFromContent(msg.content);
      if (text) result.push({ role: "user", content: text });
      continue;
    }

    if (msg.role === "assistant") {
      const text = getTextFromContent(msg.content);
      const toolCalls = getToolCallsFromContent(msg.content);

      const openaiMsg: OpenAIMessage = {
        role: "assistant",
        content: text || null,
      };

      if (toolCalls.length > 0) {
        openaiMsg.tool_calls = toolCalls.map((tc, i) => ({
          id: `call_${i}`,
          type: "function" as const,
          function: {
            name: tc.name!,
            arguments: tc.arguments || "{}",
          },
        }));
      }

      result.push(openaiMsg);
      continue;
    }

    // Skip tool result messages — LM Studio doesn't execute tools
    if (msg.role === "tool" || msg.role === "toolResult" || msg.role === "tool_result") {
      continue;
    }
  }

  return result;
}

// ── Streaming callbacks ──────────────────────────────────────────────────────

export interface LmStudioCallbacks {
  onStreamStart: (runId: string) => void;
  onThinking: (runId: string, text: string, segment: number) => void;
  onTextDelta: (runId: string, delta: string, fullText: string) => void;
  onToolStart: (runId: string, name: string, args: string) => void;
  onToolEnd: (runId: string, name: string, result: string, isError: boolean) => void;
  onStreamEnd: (runId: string) => void;
  onError: (runId: string, error: string) => void;
}

// Check if the end of `text` is a partial prefix of `tag` (e.g. "<thi" is a prefix of "<think>")
// Returns the length of the partial match, or 0 if none.
function partialTagSuffix(text: string, tag: string): number {
  const maxLen = Math.min(text.length, tag.length - 1);
  for (let len = maxLen; len >= 1; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

// ── SSE streaming handler ────────────────────────────────────────────────────

export function createLmStudioHandler(
  config: LmStudioConfig,
  callbacks: LmStudioCallbacks
) {
  let abortController: AbortController | null = null;

  async function sendMessage(messages: Message[]) {
    abortController?.abort();
    abortController = new AbortController();

    const runId = `lms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    callbacks.onStreamStart(runId);

    const openaiMessages = toOpenAIMessages(messages);
    const url = "/api/lmstudio";

    const body: Record<string, unknown> = {
      _proxyUrl: config.baseUrl.replace(/\/$/, ""),
      _proxyApiKey: config.apiKey || undefined,
      _enableTools: true,
      model: config.model,
      messages: openaiMessages,
      stream: true,
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        callbacks.onError(runId, errText);
        callbacks.onStreamEnd(runId);
        return;
      }

      if (!res.body) {
        callbacks.onError(runId, "No response body");
        callbacks.onStreamEnd(runId);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let fullThinking = "";
      let thinkingSegment = 0;
      // Track <think>...</think> tag parsing state
      let insideThinkTag = false;
      let tagBuffer = ""; // accumulates partial tag matches

      // Accumulate tool calls by index
      const toolCalls = new Map<number, { id: string; name: string; args: string; started: boolean }>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            // Finalize any tool calls that haven't been ended yet
            for (const tc of Array.from(toolCalls.values())) {
              if (tc.started) {
                callbacks.onToolEnd(runId, tc.name, tc.args, false);
              }
            }
            callbacks.onStreamEnd(runId);
            return;
          }

          try {
            const chunk = JSON.parse(data);
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta;
            if (!delta) continue;

            // Text content — parse <think>...</think> tags from stream
            if (delta.content) {
              const raw = delta.content as string;
              // Feed into tag buffer for cross-chunk tag parsing
              let pending = tagBuffer + raw;
              tagBuffer = "";

              while (pending.length > 0) {
                if (insideThinkTag) {
                  const closeIdx = pending.indexOf("</think>");
                  if (closeIdx === -1) {
                    // Check for a partial </think> at the end
                    const partialClose = partialTagSuffix(pending, "</think>");
                    if (partialClose > 0) {
                      const safe = pending.slice(0, pending.length - partialClose);
                      tagBuffer = pending.slice(pending.length - partialClose);
                      if (safe) { fullThinking += safe; callbacks.onThinking(runId, fullThinking, thinkingSegment); }
                    } else {
                      fullThinking += pending;
                      callbacks.onThinking(runId, fullThinking, thinkingSegment);
                    }
                    pending = "";
                  } else {
                    const thinkContent = pending.slice(0, closeIdx);
                    if (thinkContent) { fullThinking += thinkContent; callbacks.onThinking(runId, fullThinking, thinkingSegment); }
                    insideThinkTag = false;
                    pending = pending.slice(closeIdx + "</think>".length);
                  }
                } else {
                  const openIdx = pending.indexOf("<think>");
                  if (openIdx === -1) {
                    // Check for a partial <think> at the end
                    const partialOpen = partialTagSuffix(pending, "<think>");
                    if (partialOpen > 0) {
                      const safe = pending.slice(0, pending.length - partialOpen);
                      tagBuffer = pending.slice(pending.length - partialOpen);
                      if (safe) { fullText += safe; callbacks.onTextDelta(runId, safe, fullText); }
                    } else {
                      fullText += pending;
                      callbacks.onTextDelta(runId, pending, fullText);
                    }
                    pending = "";
                  } else {
                    const before = pending.slice(0, openIdx);
                    if (before) { fullText += before; callbacks.onTextDelta(runId, before, fullText); }
                    insideThinkTag = true;
                    pending = pending.slice(openIdx + "<think>".length);
                  }
                }
              }
            }

            // Reasoning/thinking content (LM Studio reasoning_content field)
            if (delta.reasoning_content) {
              fullThinking += delta.reasoning_content;
              callbacks.onThinking(runId, fullThinking, thinkingSegment);
            }

            // Tool calls — accumulate across multiple chunks (don't fire
            // onToolStart here; server-side tool_execution events handle the UI)
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCalls.has(idx)) {
                  toolCalls.set(idx, { id: "", name: "", args: "", started: false });
                }
                const entry = toolCalls.get(idx)!;
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.name += tc.function.name;
                if (tc.function?.arguments) entry.args += tc.function.arguments;
              }
            }

            // Server-side tool execution events (from agentic proxy)
            if (delta.tool_execution) {
              const te = delta.tool_execution;
              console.log("[lmStudio] tool_execution event:", te.status, te.name, te.call_id);
              if (te.status === "running") {
                // Reset thinking accumulator so post-tool thinking becomes a new segment
                fullThinking = "";
                thinkingSegment++;
                callbacks.onToolStart(runId, te.name, te.args || "");
              } else if (te.status === "done") {
                console.log("[lmStudio] calling onToolEnd for", te.name);
                callbacks.onToolEnd(runId, te.name, te.result || "", false);
              }
            }

            // Finish reason — finalize tool calls (for client-only tool display)
            if (choice.finish_reason === "tool_calls") {
              // Don't finalize here — the server will execute tools and continue.
              // Clear tracked tool calls so they don't get double-finalized.
              toolCalls.clear();
            } else if (choice.finish_reason) {
              for (const tc of Array.from(toolCalls.values())) {
                if (tc.started) {
                  callbacks.onToolEnd(runId, tc.name, tc.args, false);
                }
              }
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }

      // Stream ended without [DONE] — finalize
      for (const tc of Array.from(toolCalls.values())) {
        if (tc.started) {
          callbacks.onToolEnd(runId, tc.name, tc.args, false);
        }
      }
      callbacks.onStreamEnd(runId);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        callbacks.onStreamEnd(runId);
        return;
      }
      callbacks.onError(runId, (err as Error).message || "Unknown error");
      callbacks.onStreamEnd(runId);
    }
  }

  function stop() {
    abortController?.abort();
    abortController = null;
  }

  return { sendMessage, stop };
}
