// Proxy for LM Studio API — avoids CORS issues by routing through Next.js server
// Includes agentic tool loop: streams LM Studio responses, executes tool calls
// server-side, feeds results back, and continues until the model is done.
import { NextRequest } from "next/server";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

const MAX_TOOL_ROUNDS = 5;

// GET /api/lmstudio?url=<baseUrl>&path=<apiPath>&apiKey=<optional>
// Proxies GET requests (e.g. /v1/models)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const baseUrl = searchParams.get("url");
  const path = searchParams.get("path") || "/v1/models";
  const apiKey = searchParams.get("apiKey");

  if (!baseUrl) {
    return Response.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const target = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(target, { headers });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message || "Failed to reach LM Studio" },
      { status: 502 }
    );
  }
}

// ── SSE stream helpers ───────────────────────────────────────────────────────

interface ToolCallAccum {
  id: string;
  name: string;
  args: string;
}

interface StreamResult {
  finishReason: string | null;
  toolCalls: ToolCallAccum[];
}

// Consume an SSE stream from LM Studio, forwarding chunks to the client writer
// and collecting any tool calls.
async function consumeStream(
  upstream: Response,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder
): Promise<StreamResult> {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Map<number, ToolCallAccum>();
  let finishReason: string | null = null;

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
      if (data === "[DONE]") continue;

      try {
        const chunk = JSON.parse(data);
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;

        // Collect tool calls
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls.has(idx)) {
              toolCalls.set(idx, { id: "", name: "", args: "" });
            }
            const entry = toolCalls.get(idx)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      } catch {
        // skip malformed
      }

      // Forward all SSE lines to the client as-is
      await writer.write(encoder.encode(trimmed + "\n\n"));
    }
  }

  return { finishReason, toolCalls: Array.from(toolCalls.values()) };
}

// POST /api/lmstudio — proxies chat completions with SSE streaming + tool loop
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { _proxyUrl, _proxyApiKey, _enableTools, ...rest } = body;

  if (!_proxyUrl) {
    return Response.json({ error: "Missing _proxyUrl in body" }, { status: 400 });
  }

  const target = `${(_proxyUrl as string).replace(/\/$/, "")}/v1/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_proxyApiKey) headers["Authorization"] = `Bearer ${_proxyApiKey}`;

  // Inject tool definitions if enabled
  if (_enableTools && !rest.tools) {
    rest.tools = TOOL_DEFINITIONS;
    rest.tool_choice = "auto";
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const writer = {
        write: async (chunk: Uint8Array) => controller.enqueue(chunk),
      } as WritableStreamDefaultWriter<Uint8Array>;

      let messages = [...(rest.messages || [])];
      let round = 0;

      try {
        while (round < MAX_TOOL_ROUNDS) {
          round++;
          const upstream = await fetch(target, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...rest, messages }),
          });

          if (!upstream.ok) {
            const errText = await upstream.text().catch(() => `HTTP ${upstream.status}`);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: errText })}\n\n`)
            );
            break;
          }

          if (!upstream.body) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: "No response body" })}\n\n`)
            );
            break;
          }

          const { finishReason, toolCalls } = await consumeStream(
            upstream,
            writer,
            encoder
          );

          // If the model didn't request tool calls, we're done
          if (finishReason !== "tool_calls" || toolCalls.length === 0) {
            break;
          }

          // Build the assistant message with tool_calls for the conversation
          const assistantMsg: Record<string, unknown> = {
            role: "assistant",
            content: null,
            tool_calls: toolCalls.map((tc, i) => ({
              id: tc.id || `call_${i}`,
              type: "function",
              function: { name: tc.name, arguments: tc.args },
            })),
          };
          messages.push(assistantMsg);

          // Execute each tool call and add results
          for (const tc of toolCalls) {
            // Notify client that we're executing a tool
            const toolStatusEvent = {
              choices: [
                {
                  delta: {
                    tool_execution: {
                      name: tc.name,
                      args: tc.args,
                      status: "running",
                      call_id: tc.id,
                    },
                  },
                },
              ],
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(toolStatusEvent)}\n\n`)
            );

            const result = await executeTool(tc.name, tc.args);

            // Notify client of tool result
            const toolResultEvent = {
              choices: [
                {
                  delta: {
                    tool_execution: {
                      name: tc.name,
                      status: "done",
                      call_id: tc.id,
                      result,
                    },
                  },
                },
              ],
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(toolResultEvent)}\n\n`)
            );

            messages.push({
              role: "tool",
              tool_call_id: tc.id || `call_${toolCalls.indexOf(tc)}`,
              content: result,
            });
          }

          // Continue the loop — next iteration sends updated messages back to LM Studio
        }
      } catch (err) {
        const errMsg = (err as Error).message || "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`)
        );
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
