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

// Convert tool-related messages to plain text for backends that reject role:"tool".
// Used ONLY as a fallback when a follow-up round fails with proper tool format.
function collapseToolMessages(
  msgs: Record<string, unknown>[]
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  const appendToLastAssistant = (text: string) => {
    const last = out[out.length - 1];
    if (last && last.role === "assistant") {
      last.content = ((last.content as string) || "") + "\n" + text;
    } else {
      out.push({ role: "assistant", content: text });
    }
  };

  for (const m of msgs) {
    if (m.role === "tool") {
      const result = m.content as string;
      const name = (m.name as string) || "tool";
      appendToLastAssistant(`[Tool "${name}" returned: ${result}]`);
      continue;
    }

    if (
      m.role === "assistant" &&
      m.tool_calls &&
      Array.isArray(m.tool_calls)
    ) {
      const calls = (m.tool_calls as { function: { name: string; arguments: string } }[])
        .map((tc) => `I called ${tc.function.name} with ${tc.function.arguments}`)
        .join(". ");
      const text = (m.content as string) || "";
      appendToLastAssistant(text ? `${text}\n${calls}` : calls);
      continue;
    }

    out.push(m);
  }

  return out;
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
          console.log(`[lmstudio-proxy] ── round ${round} ──`);
          console.log(`[lmstudio-proxy] messages: ${messages.length} (roles: ${messages.map((m: Record<string,unknown>) => m.role).join(", ")})`);

          let requestBody = { ...rest, messages };
          let upstream = await fetch(target, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
          });

          console.log(`[lmstudio-proxy] upstream status: ${upstream.status}`);

          // If follow-up round fails, retry with collapsed messages (no tools)
          if (!upstream.ok && round > 1) {
            const errText = await upstream.text().catch(() => "");
            console.warn(`[lmstudio-proxy] round ${round} rejected (${upstream.status}): ${errText.slice(0, 200)}`);
            console.log(`[lmstudio-proxy] retrying with collapsed messages (no tools)`);

            const collapsed = collapseToolMessages(messages);
            const { tools: _t, tool_choice: _tc, ...restNoTools } = rest;
            upstream = await fetch(target, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...restNoTools, messages: collapsed }),
            });
            console.log(`[lmstudio-proxy] collapsed retry status: ${upstream.status}`);
          }

          if (!upstream.ok) {
            const errText = await upstream.text().catch(() => `HTTP ${upstream.status}`);
            console.error(`[lmstudio-proxy] upstream error: ${errText.slice(0, 500)}`);
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

          console.log(`[lmstudio-proxy] consumeStream done: finishReason=${finishReason}, toolCalls=${toolCalls.map(tc => tc.name).join(", ") || "none"}`);

          // If the model didn't request tool calls, we're done
          if (finishReason !== "tool_calls" || toolCalls.length === 0) {
            console.log(`[lmstudio-proxy] no more tool calls, ending loop`);
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

            let result: string;
            try {
              result = await executeTool(tc.name, tc.args);
            } catch (err) {
              result = `Error: Tool execution failed: ${(err as Error).message || "Unknown error"}`;
            }

            console.log(`[lmstudio-proxy] tool ${tc.name}: ${result.slice(0, 100)}${result.length > 100 ? "..." : ""}`);

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
              name: tc.name,
              tool_call_id: tc.id || `call_${toolCalls.indexOf(tc)}`,
              content: result,
            });
          }

          // Continue the loop — next iteration sends updated messages back to LM Studio
        }
      } catch (err) {
        const errMsg = (err as Error).message || "Unknown error";
        console.error(`[lmstudio-proxy] fatal error:`, errMsg);
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
