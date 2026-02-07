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
  const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(url, { headers });
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
  onThinking: (runId: string, text: string) => void;
  onTextDelta: (runId: string, delta: string, fullText: string) => void;
  onToolStart: (runId: string, name: string, args: string) => void;
  onToolEnd: (runId: string, name: string, result: string, isError: boolean) => void;
  onStreamEnd: (runId: string) => void;
  onError: (runId: string, error: string) => void;
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
    const url = `${config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    const body: Record<string, unknown> = {
      model: config.model,
      messages: openaiMessages,
      stream: true,
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
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

            // Text content
            if (delta.content) {
              fullText += delta.content;
              callbacks.onTextDelta(runId, delta.content, fullText);
            }

            // Reasoning/thinking content (LM Studio extended thinking)
            if (delta.reasoning_content) {
              fullThinking += delta.reasoning_content;
              callbacks.onThinking(runId, fullThinking);
            }

            // Tool calls — accumulate across multiple chunks
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCalls.has(idx)) {
                  toolCalls.set(idx, { id: "", name: "", args: "", started: false });
                }
                const entry = toolCalls.get(idx)!;
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) {
                  entry.name += tc.function.name;
                }
                if (tc.function?.arguments) {
                  entry.args += tc.function.arguments;
                }
                // Fire onToolStart once we have a name
                if (entry.name && !entry.started) {
                  entry.started = true;
                  callbacks.onToolStart(runId, entry.name, "");
                }
              }
            }

            // Finish reason — finalize tool calls
            if (choice.finish_reason) {
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
