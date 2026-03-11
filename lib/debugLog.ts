/**
 * Minimal delta logger — appends one-line entries to /api/log → logs.jsonl.
 * Each entry keeps only the fields that vary between deltas.
 *
 * WS frame logging is filtered to suppress high-frequency streaming deltas
 * (agent stream=content/reasoning). All protocol-level frames are logged.
 */

import type { ChatEventPayload, AgentEventPayload, ContentPart } from "@/types/chat";
import { isToolCallPart } from "@/lib/constants";

function contentSummary(content: ContentPart[] | string | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return `t:${content.length}`;
  const parts: string[] = [];
  for (const p of content) {
    if (p.type === "text") parts.push(`t:${(p.text || "").length}`);
    else if (isToolCallPart(p)) parts.push(`tc:${p.name}:${p.status || "?"}`);
    else if (p.type === "thinking") parts.push(`th:${(p.text || p.thinking || "").length}`);
    else parts.push(p.type);
  }
  return parts.join(",");
}

/** Truncate a string for log preview */
function preview(s: unknown, max = 60): string | undefined {
  if (typeof s !== "string" || !s) return undefined;
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function send(entry: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  // Fire-and-forget — never block UI
  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ts: Date.now(), ...entry }),
  }).catch(() => {});
}

/** Log a raw WebSocket frame (send or receive). Drops noisy streaming deltas. */
export function logWsFrame(direction: "send" | "recv", frame: unknown) {
  if (process.env.NODE_ENV !== "development") return;
  // Drop high-frequency content/reasoning deltas
  if (frame && typeof frame === "object") {
    const f = frame as Record<string, unknown>;
    if (f.type === "event" && f.event === "agent") {
      const stream = (f.payload as Record<string, unknown> | undefined)?.stream;
      if (stream === "content" || stream === "reasoning") return;
    }
    // Drop chat.history requests (large, frequent)
    if (f.type === "req" && f.method === "chat.history") return;
  }
  send({ e: "ws", dir: direction, frame });
}

export function logChatEvent(p: ChatEventPayload) {
  const entry: Record<string, unknown> = {
    e: "chat",
    s: p.state,
    rid: p.runId,
  };
  if (p.message) {
    entry.role = p.message.role;
    entry.c = contentSummary(p.message.content);
    if (p.message.reasoning) entry.r = p.message.reasoning.length;
  }
  if (p.errorMessage) entry.err = p.errorMessage;
  send(entry);
}

export function logAgentEvent(p: AgentEventPayload) {
  const entry: Record<string, unknown> = {
    e: "agent",
    s: p.stream,
    rid: p.runId,
    seq: p.seq,
  };
  const d = p.data;
  if (p.stream === "tool") {
    entry.phase = d.phase;
    entry.name = d.name;
    if (d.toolCallId) entry.tcid = d.toolCallId;
    if (d.isError) entry.err = true;
  } else if (p.stream === "lifecycle") {
    entry.phase = d.phase;
  } else if (p.stream === "assistant") {
    // Dump data keys + preview of any string values to discover the format
    entry.keys = Object.keys(d);
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === "string") entry[`d.${k}`] = preview(v);
      else if (typeof v === "number" || typeof v === "boolean") entry[`d.${k}`] = v;
      else if (Array.isArray(v)) entry[`d.${k}`] = `[${v.length}]`;
      else if (v && typeof v === "object") entry[`d.${k}`] = `{${Object.keys(v).join(",")}}`;
    }
  } else if (p.stream === "error") {
    entry.keys = Object.keys(d);
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === "string") entry[`d.${k}`] = preview(v, 120);
      else if (typeof v === "number" || typeof v === "boolean") entry[`d.${k}`] = v;
    }
  } else {
    // Unknown stream type — dump keys + string previews
    const delta = (d.delta || d.text || d.content || "") as string;
    if (delta) entry.len = delta.length;
    entry.keys = Object.keys(d);
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === "string") entry[`d.${k}`] = preview(v);
    }
  }
  send(entry);
}
