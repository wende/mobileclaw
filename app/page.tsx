"use client";

import React from "react";

import { useState, useRef, useEffect, useCallback } from "react";
import { useWebSocket, type WebSocketMessage } from "@/lib/useWebSocket";
import { getToolDisplay } from "@/lib/toolDisplay";
import { DEMO_HISTORY, createDemoHandler, type DemoCallbacks } from "@/lib/demoMode";
import { fetchLmStudioModels, createLmStudioHandler, type LmStudioConfig, type LmStudioCallbacks, type LmStudioModel } from "@/lib/lmStudio";

// ── Types ────────────────────────────────────────────────────────────────────

interface ContentPart {
  type: string;
  text?: string;
  name?: string;
  arguments?: string;
  status?: "running" | "success" | "error";
  result?: string;
  resultError?: boolean;
  source?: Record<string, unknown>;
  image_url?: { url?: string };
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

// OpenClaw WebSocket protocol types
// Based on GatewayBrowserClient protocol

// Request (client → server)
interface WSRequest {
  type: "req";
  id: string;
  method: "connect" | "chat.send" | "chat.history" | "chat.subscribe" | "hello";
  params?: Record<string, unknown>;
}

// Response (server → client)
interface WSResponse {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string | { code: string; message: string };
}

// Event (server → client)
interface WSEvent {
  type: "event";
  event: "connect.challenge" | "chat" | "agent" | "presence" | "health";
  payload: ConnectChallengePayload | ChatEventPayload | AgentEventPayload;
  seq: number;
  stateVersion?: {
    presence: number;
    health: number;
  };
}

// Connect challenge payload
interface ConnectChallengePayload {
  nonce: string;
  ts: number;
}

// Chat event payload
interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: {
    role: "user" | "assistant" | "system" | "tool";
    content: ContentPart[] | string;
    timestamp: number;
    reasoning?: string;
  };
  errorMessage?: string;
}

// Agent event payload — actual format uses stream + data
interface AgentEventPayload {
  runId: string;
  sessionKey: string;
  stream: string; // "lifecycle", "content", "tool", "reasoning", etc.
  data: Record<string, unknown>;
  seq: number;
  ts: number;
}

// Hello message (server → client on connect)
interface WSHello {
  type: "hello";
  sessionId: string;
  mode: "webchat";
  clientName: string;
}

type WSIncomingMessage = WSResponse | WSEvent | WSHello;

type BackendMode = "openclaw" | "lmstudio" | "demo";

interface ConnectionConfig {
  mode: BackendMode;
  url: string;
  token?: string;
  model?: string;
}

function getTextFromContent(content: ContentPart[] | string | null): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("");
}

function getToolCalls(content: ContentPart[] | string | null): ContentPart[] {
  if (!content || typeof content === "string") return [];
  return content.filter((p) => p.type === "tool_call" || p.type === "toolCall");
}

function getImages(content: ContentPart[] | string | null): ContentPart[] {
  if (!content || typeof content === "string") return [];
  return content.filter((p) => p.type === "image" || p.type === "image_url");
}

function getMessageSide(role: string): "left" | "right" | "center" {
  if (role === "user") return "right";
  if (role === "assistant" || role === "toolResult" || role === "tool_result") return "left";
  return "center";
}

function formatMessageTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  if (isYesterday) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function thinkingPreview(text: string): string {
  // Try to extract **bold** text
  const boldMatch = text.match(/\*\*(.+?)\*\*/);
  if (boldMatch) return boldMatch[1];
  // Fallback: first 8 words
  const words = text.trim().split(/\s+/).slice(0, 8).join(" ");
  return words + (text.trim().split(/\s+/).length > 8 ? "..." : "");
}

// ── Streaming cursor ─────────────────────────────────────────────────────────

function StreamingCursor() {
  return <span className="ml-0.5 inline-block h-4 w-[2px] bg-foreground animate-pulse" />;
}

// Typewriter effect: gradually reveals text character-by-character
function StreamingText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [displayLen, setDisplayLen] = useState(text.length);
  const targetLenRef = useRef(text.length);
  const rafRef = useRef<number | null>(null);
  const prevTextRef = useRef(text);

  // When text grows, keep displayLen where it was and let the animation catch up
  useEffect(() => {
    targetLenRef.current = text.length;
    // If text changed by replacement (e.g. history reload), snap immediately
    if (!text.startsWith(prevTextRef.current.slice(0, displayLen))) {
      setDisplayLen(text.length);
    }
    prevTextRef.current = text;
  }, [text]);

  // When not streaming, snap to full length
  useEffect(() => {
    if (!isStreaming) {
      setDisplayLen(text.length);
      targetLenRef.current = text.length;
    }
  }, [isStreaming, text.length]);

  // rAF loop to animate displayLen towards target
  useEffect(() => {
    if (!isStreaming) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const tick = () => {
      setDisplayLen((prev) => {
        const target = targetLenRef.current;
        if (prev >= target) return prev;
        // Reveal ~3 chars per frame (~180 chars/sec at 60fps) + close 30% of remaining gap
        const gap = target - prev;
        const step = Math.max(3, Math.ceil(gap * 0.3));
        return Math.min(prev + step, target);
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isStreaming]);

  const visibleText = text.slice(0, displayLen);
  return (
    <>
      <MarkdownContent text={visibleText} />
      {isStreaming && <StreamingCursor />}
    </>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="text-sm text-muted-foreground flex items-center gap-1">
        <span>Thinking</span>
        <span className="inline-flex w-5">
          <span className="animate-[dotFade_1.4s_ease-in-out_infinite]">.</span>
          <span className="animate-[dotFade_1.4s_ease-in-out_0.2s_infinite]">.</span>
          <span className="animate-[dotFade_1.4s_ease-in-out_0.4s_infinite]">.</span>
        </span>
      </div>
    </div>
  );
}

// ── Markdown Renderer ────────────────────────────────────────────────────────

function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border bg-secondary">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{lang || "text"}</span>
        <button type="button" onClick={copy} className="text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-hidden whitespace-pre-wrap break-all p-3 text-xs leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  // Split text by code blocks first
  const segments = text.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {segments.map((segment, i) => {
        // Fenced code block
        if (segment.startsWith("```") && segment.endsWith("```")) {
          const inner = segment.slice(3, -3);
          const newlineIdx = inner.indexOf("\n");
          const lang = newlineIdx > -1 ? inner.slice(0, newlineIdx).trim() : "";
          const code = newlineIdx > -1 ? inner.slice(newlineIdx + 1) : inner;
          return <CodeBlock key={i} lang={lang} code={code} />;
        }

        // Inline markdown
        return <InlineMarkdown key={i} text={segment} />;
      })}
    </>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={`br-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      elements.push(<h1 key={`h1-${i}`} className="text-lg font-bold text-foreground mt-4 mb-1">{renderInline(line.slice(2))}</h1>);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<h2 key={`h2-${i}`} className="text-base font-semibold text-foreground mt-3 mb-1">{renderInline(line.slice(3))}</h2>);
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(<h3 key={`h3-${i}`} className="text-sm font-semibold text-foreground mt-2 mb-1">{renderInline(line.slice(4))}</h3>);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={`bq-${i}`} className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic">
          {renderInline(quoteLines.join("\n"))}
        </blockquote>
      );
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s-:|]+\|/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<MarkdownTable key={`tbl-${i}`} lines={tableLines} />);
      continue;
    }

    // Unordered list
    if (line.match(/^(\s*)[-*]\s/)) {
      const listItems: { depth: number; text: string }[] = [];
      while (i < lines.length && lines[i].match(/^(\s*)[-*]\s/)) {
        const match = lines[i].match(/^(\s*)[-*]\s(.*)/);
        if (match) listItems.push({ depth: match[1].length, text: match[2] });
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-1.5 flex flex-col gap-0.5">
          {listItems.map((item, j) => (
            <li key={j} className="flex gap-1.5 text-foreground" style={{ paddingLeft: `${item.depth * 8 + 4}px` }}>
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
              <span>{renderInline(item.text)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        const match = lines[i].match(/^\d+\.\s(.*)/);
        if (match) listItems.push(match[1]);
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-1.5 flex flex-col gap-0.5">
          {listItems.map((item, j) => (
            <li key={j} className="flex gap-1.5 pl-1 text-foreground">
              <span className="shrink-0 text-muted-foreground">{j + 1}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph
    elements.push(<p key={`p-${i}`} className="text-foreground">{renderInline(line)}</p>);
    i++;
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode[] {
  // Process: **bold**, *italic*, `inline code`, [link](url)
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) parts.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    else if (match[3]) parts.push(<em key={match.index}>{match[4]}</em>);
    else if (match[5]) parts.push(<code key={match.index} className="rounded bg-secondary px-1 py-0.5 font-mono text-[13px] break-all">{match[6]}</code>);
    else if (match[7]) parts.push(<a key={match.index} href={match[9]} className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noopener noreferrer">{match[8]}</a>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const parseRow = (line: string) => line.split("|").map((c) => c.trim()).filter(Boolean);
  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-secondary">
            {headers.map((h, i) => <th key={i} className="px-3 py-1.5 text-left font-semibold text-foreground">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {row.map((cell, j) => <td key={j} className="px-3 py-1.5 text-muted-foreground">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tool Call Pill with lifecycle ────────────────────────────────────────────

function ToolCallPill({ name, args, status, result, resultError }: { name: string; args?: string; status?: "running" | "success" | "error"; result?: string; resultError?: boolean }) {
  const formatJson = (s: string) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
  const display = getToolDisplay(name, args);

  const iconCls = "inline-block mr-1.5 align-[-1px] shrink-0";
  const statusIcon = status === "running" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${iconCls} animate-spin opacity-50`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  ) : resultError ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${iconCls} text-destructive`}>
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ) : null;

  const toolIcon = display.icon === "terminal" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${iconCls} opacity-50`}>
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ) : display.icon === "file" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${iconCls} opacity-50`}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  ) : display.icon === "robot" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`${iconCls} opacity-50`}>
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${iconCls} opacity-50`}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );

  return (
    <details className={`w-fit max-w-full rounded-lg border ${resultError ? "border-destructive/30 bg-destructive/5" : "border-border bg-secondary"}`}>
      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap max-w-full">
        {statusIcon || toolIcon}
        <span className="truncate">{display.label}</span>
        {status === "running" && <span className="ml-1.5 text-muted-foreground/60">running...</span>}
      </summary>
      {(args || result) && (
        <div className="overflow-hidden text-xs text-muted-foreground">
          {args && (
            <div className="border-t border-border px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Arguments</span>
              <div className="mt-1 flex flex-col gap-0.5">
                {(() => {
                  try {
                    const parsed = typeof args === "string" ? JSON.parse(args) : args;
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                      return Object.entries(parsed).map(([k, v]) => (
                        <div key={k} className="break-words">
                          <span className="font-semibold text-foreground/70">{k}</span>
                          <span className="text-muted-foreground/40"> — </span>
                          <span className="whitespace-pre-wrap break-words">{typeof v === "string" ? v : JSON.stringify(v)}</span>
                        </div>
                      ));
                    }
                  } catch {}
                  return <pre className="whitespace-pre-wrap break-words overflow-hidden">{formatJson(args)}</pre>;
                })()}
              </div>
            </div>
          )}
          {result && (
            <div className="border-t border-border px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Result</span>
              <pre className="mt-1 whitespace-pre-wrap break-words overflow-hidden">{result}</pre>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

// ── Image Thumbnails ─────────────────────────────────────────────────────────

function ImageThumbnails({ images }: { images: ContentPart[] }) {
  if (images.length === 0) return null;
  return (
    <div className="mt-1.5 flex gap-1.5 flex-wrap">
      {images.map((img, i) => {
        const src = img.type === "image_url" ? img.image_url?.url : undefined;
        return (
          <div key={i} className="h-16 w-16 overflow-hidden rounded-lg border border-border bg-secondary">
            {src ? (
              <img src={src || "/placeholder.svg"} alt="Attached" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
                  <rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Single Message Row ───────────────────────────────────────────────────────

function MessageRow({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  const text = getTextFromContent(message.content);
  const toolCalls = getToolCalls(message.content);
  const images = getImages(message.content);

  if (message.role === "toolResult" || message.role === "tool_result" || message.role === "tool") {
    return null; // Tool results are merged into tool call pills
  }

  // Context-enriched user messages — render as expandable pill in user bubble style
  if (message.isContext && text) {
    // Build a short summary from System lines
    const lines = text.split("\n").filter((l) => l.startsWith("System: ["));
    const summaryParts = lines.map((line) => {
      const match = line.match(/^System: \[[^\]]+\]\s*(.+)$/);
      return match?.[1] ?? line;
    });
    const summary = summaryParts.length > 0
      ? summaryParts.length === 1 ? summaryParts[0] : `${summaryParts.length} context items`
      : "Context";

    return (
      <div className="flex flex-row-reverse">
        <details className="max-w-[85%] md:max-w-[75%] rounded-2xl rounded-br-md bg-primary text-primary-foreground">
          <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />
            </svg>
            <span className="truncate">{summary}</span>
          </summary>
          <div className="border-t border-primary-foreground/20 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words opacity-80">
            {text}
          </div>
        </details>
      </div>
    );
  }

  if (message.role === "system" || message.stopReason === "injected") {
    return text ? (
      <div className="flex justify-center py-2">
        <div className="max-w-[85%] rounded-lg bg-secondary px-4 py-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
          <MarkdownContent text={text} />
        </div>
      </div>
    ) : null;
  }

  // Unknown roles -- render as muted system-like
  if (message.role !== "user" && message.role !== "assistant") {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-secondary px-4 py-1 text-xs text-muted-foreground">{text || `[${message.role}]`}</span>
      </div>
    );
  }

  const isUser = message.role === "user";

  // Build interleaved thinking + tool_call parts from content array (preserves chronological order)
  // Filter out thinking parts that are empty/whitespace-only (can happen from <think> tag residue)
  const interleavedParts = Array.isArray(message.content)
    ? (message.content as ContentPart[]).filter((p) =>
        (p.type === "thinking" && p.text?.trim()) || p.type === "tool_call" || p.type === "toolCall"
      )
    : [];
  const hasThinkingParts = interleavedParts.some((p) => p.type === "thinking");

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`max-w-[85%] md:max-w-[75%] min-w-0 ${isUser ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground" : "flex flex-col gap-1.5"}`}>
        {hasThinkingParts ? (
          // Render interleaved thinking pills and tool call pills in content order
          interleavedParts.map((part, i) =>
            part.type === "thinking" && part.text ? (
              <details key={`thinking-${i}`} className="w-fit max-w-full rounded-lg border border-border bg-secondary">
                <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block opacity-50 mr-1.5 align-[-1px]"><path d="M12 2a5 5 0 0 1 4.7 3.2A4 4 0 0 1 20 9c0 1.5-.8 2.8-2 3.5v0A4 4 0 0 1 16 20H8a4 4 0 0 1-2-7.5A4 4 0 0 1 4 9a4 4 0 0 1 3.3-3.9A5 5 0 0 1 12 2z" /><path d="M12 2v20" /></svg>
                  {thinkingPreview(part.text)}
                </summary>
                <p className="px-3 pb-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words overflow-hidden">{part.text}</p>
              </details>
            ) : (part.type === "tool_call" || part.type === "toolCall") ? (
              <ToolCallPill key={`${part.name}-${i}`} name={part.name || "tool"} args={typeof part.arguments === "string" ? part.arguments : part.arguments ? JSON.stringify(part.arguments) : undefined} status={part.status as "running" | "success" | "error" | undefined} result={part.result} resultError={part.resultError} />
            ) : null
          )
        ) : (
          // Fallback: legacy rendering for OpenClaw/demo messages using message.reasoning
          <>
            {message.reasoning && (
              <details className="w-fit max-w-full rounded-lg border border-border bg-secondary">
                <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block opacity-50 mr-1.5 align-[-1px]"><path d="M12 2a5 5 0 0 1 4.7 3.2A4 4 0 0 1 20 9c0 1.5-.8 2.8-2 3.5v0A4 4 0 0 1 16 20H8a4 4 0 0 1-2-7.5A4 4 0 0 1 4 9a4 4 0 0 1 3.3-3.9A5 5 0 0 1 12 2z" /><path d="M12 2v20" /></svg>
                  {thinkingPreview(message.reasoning)}
                </summary>
                <p className="px-3 pb-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words overflow-hidden">{message.reasoning}</p>
              </details>
            )}
            {toolCalls.map((tc, i) => (
              <ToolCallPill key={`${tc.name}-${i}`} name={tc.name || "tool"} args={typeof tc.arguments === "string" ? tc.arguments : tc.arguments ? JSON.stringify(tc.arguments) : undefined} status={tc.status as "running" | "success" | "error" | undefined} result={tc.result} resultError={tc.resultError} />
            ))}
          </>
        )}
        {isUser ? (
          <>
            {text && (
              <div className="text-sm leading-relaxed break-words">
                {text}
              </div>
            )}
            <ImageThumbnails images={images} />
          </>
        ) : (
          <>
            {text && (
              <div className="text-sm leading-relaxed break-words overflow-hidden text-foreground">
                {isStreaming ? (
                  <StreamingText text={text} isStreaming={isStreaming} />
                ) : (
                  <MarkdownContent text={text} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Commands ─────────────────────────────────────────────────────────────────

interface Command {
  name: string;
  description: string;
  aliases?: string[];
}

interface CommandGroup {
  label: string;
  commands: Command[];
}

const COMMAND_GROUPS: CommandGroup[] = [
  {
    label: "Status",
    commands: [
      { name: "/help", description: "Show available commands." },
      { name: "/commands", description: "List all slash commands." },
      { name: "/status", description: "Show current status." },
      { name: "/model", description: "Show or change the current AI model." },
      { name: "/context", description: "Explain how context is built and used." },
      { name: "/whoami", description: "Show your sender id.", aliases: ["/id"] },
    ],
  },
  {
    label: "Management",
    commands: [
      { name: "/queue", description: "Adjust queue settings." },
      { name: "/allowlist", description: "List/add/remove allowlist entries." },
      { name: "/approve", description: "Approve or deny exec requests." },
      { name: "/subagents", description: "List/stop/log/info subagent runs for this session." },
      { name: "/config", description: "Show or set config values." },
      { name: "/activation", description: "Set group activation mode." },
      { name: "/send", description: "Set send policy." },
    ],
  },
  {
    label: "Media",
    commands: [
      { name: "/tts", description: "Control text-to-speech (TTS)." },
    ],
  },
  {
    label: "Tools",
    commands: [
      { name: "/skill", description: "Run a skill by name." },
      { name: "/restart", description: "Restart OpenClaw." },
      { name: "/apple_notes", description: "Manage Apple Notes via the memo CLI on macOS." },
      { name: "/apple_reminders", description: "Manage Apple Reminders via the remindctl CLI on macOS." },
      { name: "/bluebubbles", description: "Build or update the BlueBubbles external channel plugin." },
      { name: "/clawhub", description: "Search, install, update, and publish agent skills." },
      { name: "/coding_agent", description: "Run Codex CLI, Claude Code, or Pi Coding Agent." },
      { name: "/gemini", description: "Gemini CLI for one-shot Q&A, summaries, and generation." },
      { name: "/github", description: "Interact with GitHub using the gh CLI." },
      { name: "/healthcheck", description: "Host security hardening and risk-tolerance config." },
      { name: "/nano_banana_pro", description: "Generate or edit images via Gemini 3 Pro Image." },
      { name: "/openai_image_gen", description: "Batch-generate images via OpenAI Images API." },
      { name: "/openai_whisper_api", description: "Transcribe audio via OpenAI Whisper." },
      { name: "/peekaboo", description: "Capture and automate macOS UI with Peekaboo CLI." },
      { name: "/session_logs", description: "Search and analyze your own session logs." },
      { name: "/skill_creator", description: "Create or update AgentSkills." },
      { name: "/tmux", description: "Remote-control tmux sessions." },
      { name: "/video_frames", description: "Extract frames or clips from videos using ffmpeg." },
      { name: "/weather", description: "Get current weather and forecasts." },
      { name: "/apple_calendar", description: "Apple Calendar.app integration for macOS." },
      { name: "/claude_image_analyzer", description: "Describe images in detail using Claude Code CLI." },
      { name: "/google_workspace", description: "Interact with Google Workspace services." },
      { name: "/research", description: "Deep research methodology for sub-agents." },
      { name: "/youtube", description: "Summarize YouTube videos, extract transcripts." },
    ],
  },
  {
    label: "Docks",
    commands: [
      { name: "/dock_telegram", description: "Switch to Telegram for replies.", aliases: ["/dock-telegram"] },
      { name: "/dock_discord", description: "Switch to Discord for replies.", aliases: ["/dock-discord"] },
      { name: "/dock_slack", description: "Switch to Slack for replies.", aliases: ["/dock-slack"] },
    ],
  },
];

// ── Command Sheet ────────────────────────────────────────────────────────────

function CommandSheet({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (command: string) => void;
}) {
  const [search, setSearch] = useState("");
  const sheetRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const filteredGroups = COMMAND_GROUPS.map((group) => ({
    ...group,
    commands: group.commands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(search.toLowerCase()) ||
        cmd.description.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((g) => g.commands.length > 0);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-foreground/10 backdrop-blur-sm transition-[opacity,visibility] duration-200 ${open ? "visible opacity-100" : "invisible opacity-0 pointer-events-none"}`}
        onClick={onClose}
        onMouseDown={onClose}
        role="button"
        tabIndex={-1}
        aria-label="Close commands"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Commands"
        className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[70dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-lg transition-[transform,visibility] duration-300 ease-out ${open ? "visible translate-y-0" : "invisible translate-y-full pointer-events-none"}`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        {/* Search */}
        <div className="px-4 pb-3 pt-1">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search commands..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus={open}
            />
          </div>
        </div>

        {/* Command list */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
          {filteredGroups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No commands found.</p>
          )}
          {filteredGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.commands.map((cmd) => (
                  <button
                    key={cmd.name}
                    type="button"
                    onClick={() => {
                      onSelect(cmd.name + " ");
                      onClose();
                    }}
                    className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent active:bg-accent"
                  >
                    <span className="mt-px shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
                      {cmd.name}
                    </span>
                    <span className="text-sm leading-snug text-muted-foreground">
                      {cmd.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Flat command list for autocomplete ────────────────────────────────────────

const ALL_COMMANDS: Command[] = COMMAND_GROUPS.flatMap((g) => g.commands);

// ── Chat Input ───────────────────────────────────────────────────────────────

function ChatInput({
  onSend,
  onOpenCommands,
  commandValue,
  onCommandValueUsed,
  scrollPhase = "input",
  onScrollToBottom,
}: {
  onSend: (text: string) => void;
  onOpenCommands: () => void;
  commandValue: string | null;
  onCommandValueUsed: () => void;
  scrollPhase?: "input" | "pill";
  onScrollToBottom?: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // When a command is selected, fill it in
  useEffect(() => {
    if (commandValue) {
      setValue(commandValue);
      onCommandValueUsed();
      setTimeout(() => ref.current?.focus(), 100);
    }
  }, [commandValue, onCommandValueUsed]);

  // Compute matching commands when value starts with /
  const suggestions = (() => {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith("/") || trimmed.includes(" ")) return [];
    const prefix = trimmed.toLowerCase();
    return ALL_COMMANDS.filter(
      (cmd) =>
        cmd.name.toLowerCase().startsWith(prefix) ||
        cmd.aliases?.some((a) => a.toLowerCase().startsWith(prefix))
    ).slice(0, 8);
  })();

  const showSuggestions = suggestions.length > 0;

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedIdx(0);
  }, [suggestions.length, value]);

  // Scroll selected item into view
  useEffect(() => {
    if (showSuggestions && suggestionsRef.current) {
      const item = suggestionsRef.current.children[selectedIdx] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIdx, showSuggestions]);

  const acceptSuggestion = (cmd: Command) => {
    setValue(cmd.name + " ");
    setTimeout(() => ref.current?.focus(), 0);
  };

  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onSend(t);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  };

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + "px";
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        acceptSuggestion(suggestions[selectedIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setValue("");
        return;
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    }
  };

  const isPill = scrollPhase === "pill";

  return (
    <div className="relative">
      {/* Command autocomplete suggestions — positioned above the input bar */}
      {showSuggestions && !isPill && (
        <div
          ref={suggestionsRef}
          className="absolute bottom-full left-0 right-0 mb-1.5 max-h-[240px] overflow-y-auto rounded-xl border border-border bg-card shadow-lg z-50"
        >
          {suggestions.map((cmd, i) => (
            <button
              key={cmd.name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // keep textarea focused
                acceptSuggestion(cmd);
              }}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                i === selectedIdx ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
                {cmd.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {cmd.description}
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        className="flex items-end justify-center"
        style={{ gap: "calc(8px * (1 - var(--sp, 0)))" }}
      >
      {/* Commands button — fades & collapses */}
      <button
        type="button"
        onClick={onOpenCommands}
        className="flex shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground overflow-hidden"
        style={{
          opacity: "max(0, 1 - var(--sp, 0) * 2.5)",
          width: "calc(40px * (1 - var(--sp, 0)))",
          height: "calc(40px * (1 - var(--sp, 0)))",
          minWidth: 0,
          pointerEvents: isPill ? "none" : "auto",
        } as React.CSSProperties}
        aria-label="Open commands"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 17 6-6-6-6" /><path d="M12 19h8" />
        </svg>
      </button>

      {/* Morphing center: textarea ↔ scroll-to-bottom pill */}
      <div
        className="relative flex-1 overflow-hidden rounded-2xl border border-border bg-card/90 shadow-lg backdrop-blur-xl transition-colors focus-within:border-ring"
        onClick={isPill ? onScrollToBottom : undefined}
        role={isPill ? "button" : undefined}
        tabIndex={isPill ? 0 : undefined}
        onKeyDown={isPill ? (e: React.KeyboardEvent) => { if (e.key === "Enter") onScrollToBottom?.(); } : undefined}
        style={{
          maxWidth: "calc(600px - 400px * var(--sp, 0))",
          height: "calc(46px - 6px * var(--sp, 0))",
          cursor: isPill ? "pointer" : "text",
        } as React.CSSProperties}
      >
        {/* Pill overlay */}
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 whitespace-nowrap text-xs font-medium text-muted-foreground"
          style={{ opacity: "var(--sp, 0)", pointerEvents: isPill ? "auto" : "none" } as React.CSSProperties}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="m7 13 5 5 5-5" /><path d="M12 18V6" />
          </svg>
          <span>Scroll to bottom</span>
        </div>

        {/* Textarea */}
        <div
          className="h-full px-4 py-2.5 flex items-center"
          style={{
            opacity: "calc(1 - var(--sp, 0))",
            pointerEvents: isPill ? "none" : "auto",
          } as React.CSSProperties}
        >
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            className="block w-full resize-none bg-transparent text-base md:text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      {/* Send button — fades & collapses */}
      <button
        type="button"
        onClick={submit}
        disabled={!value.trim()}
        className="flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:opacity-80 overflow-hidden"
        style={{
          opacity: value.trim() ? "max(0, 1 - var(--sp, 0) * 2.5)" : "max(0, (1 - var(--sp, 0) * 2.5) * 0.3)",
          width: "calc(40px * (1 - var(--sp, 0)))",
          height: "calc(40px * (1 - var(--sp, 0)))",
          minWidth: 0,
          pointerEvents: isPill ? "none" : "auto",
        } as React.CSSProperties}
        aria-label="Send"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>
      </button>
      </div>
    </div>
  );
}

// ── Setup Dialog ─────────────────────────────────────────────────────────────

function SetupDialog({
  onConnect,
  visible,
  connectionState,
  connectionError
}: {
  onConnect: (config: ConnectionConfig) => void;
  visible: boolean;
  connectionState?: "connecting" | "connected" | "disconnected" | "error";
  connectionError?: string | null;
}) {
  const [mode, setMode] = useState<"openclaw" | "lmstudio">("openclaw");
  const [url, setUrl] = useState("ws://127.0.0.1:18789");
  const [token, setToken] = useState("");
  const [lmsUrl, setLmsUrl] = useState("http://127.0.0.1:1234");
  const [lmsApiKey, setLmsApiKey] = useState("");
  const [lmsModel, setLmsModel] = useState("");
  const [lmsModels, setLmsModels] = useState<LmStudioModel[]>([]);
  const [lmsModelLoading, setLmsModelLoading] = useState(false);
  const [lmsModelError, setLmsModelError] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "entering" | "open" | "closing" | "closed">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset phase when dialog becomes visible again
  useEffect(() => {
    if (visible && (phase === "closed" || phase === "idle")) {
      // Pre-fill from localStorage if available
      const savedMode = window.localStorage.getItem("mobileclaw-mode") as "openclaw" | "lmstudio" | null;
      if (savedMode === "openclaw" || savedMode === "lmstudio") setMode(savedMode);
      const savedUrl = window.localStorage.getItem("openclaw-url");
      const savedToken = window.localStorage.getItem("openclaw-token");
      if (savedUrl) setUrl(savedUrl);
      if (savedToken) setToken(savedToken);
      const savedLmsUrl = window.localStorage.getItem("lmstudio-url");
      const savedLmsApiKey = window.localStorage.getItem("lmstudio-apikey");
      const savedLmsModel = window.localStorage.getItem("lmstudio-model");
      if (savedLmsUrl) setLmsUrl(savedLmsUrl);
      if (savedLmsApiKey) setLmsApiKey(savedLmsApiKey);
      if (savedLmsModel) setLmsModel(savedLmsModel);
      setError("");
      setLmsModelError("");
      requestAnimationFrame(() => {
        setPhase("entering");
        requestAnimationFrame(() => setPhase("open"));
      });
    }
    if (!visible && phase === "open") {
      setPhase("closing");
      setTimeout(() => setPhase("closed"), 500);
    }
  }, [visible]);

  // Focus input once open
  useEffect(() => {
    if (phase === "open") {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [phase]);

  // Fetch LM Studio models when URL changes and mode is lmstudio
  const fetchModels = useCallback(async (baseUrl: string, apiKey?: string) => {
    const trimmed = baseUrl.trim();
    if (!trimmed) return;
    setLmsModelLoading(true);
    setLmsModelError("");
    try {
      const models = await fetchLmStudioModels(trimmed, apiKey || undefined);
      setLmsModels(models);
      // Auto-select first model if none selected
      if (models.length > 0 && !lmsModel) {
        setLmsModel(models[0].id);
      }
    } catch (err) {
      setLmsModelError((err as Error).message || "Cannot reach server");
      setLmsModels([]);
    } finally {
      setLmsModelLoading(false);
    }
  }, [lmsModel]);

  const handleSubmit = () => {
    if (mode === "openclaw") {
      const trimmed = url.trim();
      // Allow empty URL for mock mode
      if (trimmed) {
        try {
          new URL(trimmed);
        } catch {
          setError("Please enter a valid URL or leave empty for demo mode");
          return;
        }
      }
      setError("");
      setPhase("closing");
      setTimeout(() => {
        setPhase("closed");
        if (!trimmed) {
          onConnect({ mode: "demo", url: "" });
        } else {
          onConnect({ mode: "openclaw", url: trimmed, token: token.trim() || undefined });
        }
      }, 500);
    } else {
      const trimmed = lmsUrl.trim();
      if (!trimmed) {
        setError("Please enter the LM Studio server URL");
        return;
      }
      try {
        new URL(trimmed);
      } catch {
        setError("Please enter a valid URL");
        return;
      }
      if (!lmsModel) {
        setError("Please select a model");
        return;
      }
      setError("");
      setPhase("closing");
      setTimeout(() => {
        setPhase("closed");
        onConnect({ mode: "lmstudio", url: trimmed, token: lmsApiKey.trim() || undefined, model: lmsModel });
      }, 500);
    }
  };

  if (phase === "closed" || (!visible && phase === "idle")) return null;

  const isOpen = phase === "open";
  const isClosing = phase === "closing";
  const isConnecting = connectionState === "connecting";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center transition-all duration-500 ease-out"
      style={{
        backgroundColor: isClosing ? "transparent" : undefined,
        backdropFilter: isOpen ? "blur(8px)" : isClosing ? "blur(0px)" : "blur(0px)",
        opacity: isClosing ? 0 : isOpen ? 1 : 0,
        pointerEvents: isClosing ? "none" : "auto",
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 transition-opacity duration-500"
        style={{ opacity: isOpen ? 1 : 0 }}
      />

      {/* Card */}
      <div
        className="relative mx-4 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg transition-all duration-500 ease-out"
        style={{
          transform: isOpen
            ? "scale(1) translateY(0)"
            : isClosing
              ? "scale(0.8) translateY(-40px)"
              : "scale(0.9) translateY(20px)",
          opacity: isOpen ? 1 : isClosing ? 0 : 0,
        }}
      >
        {/* Icon -- pulses briefly on close */}
        <div className="mb-4 flex justify-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary transition-all duration-300"
            style={{
              transform: isClosing ? "scale(1.2)" : "scale(1)",
              boxShadow: isClosing ? "0 0 20px oklch(0.55 0 0 / 0.15)" : "none",
            }}
          >
            {mode === "lmstudio" ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground">
                <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 8h10" /><path d="M7 12h10" /><path d="M7 16h6" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground">
                <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
              </svg>
            )}
          </div>
        </div>

        <h2 className="mb-1 text-center text-lg font-semibold text-foreground">Connect to MobileClaw</h2>
        <p className="mb-4 text-center text-sm text-muted-foreground">
          Choose a backend and configure your connection.
        </p>

        {/* Mode selector — segmented control */}
        <div className="mb-4 flex rounded-xl border border-border bg-secondary p-0.5">
          <button
            type="button"
            onClick={() => { setMode("openclaw"); setError(""); }}
            className={`flex-1 rounded-[10px] py-1.5 text-xs font-medium transition-all duration-200 ${mode === "openclaw" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            OpenClaw
          </button>
          <button
            type="button"
            onClick={() => { setMode("lmstudio"); setError(""); }}
            className={`flex-1 rounded-[10px] py-1.5 text-xs font-medium transition-all duration-200 ${mode === "lmstudio" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            LM Studio
          </button>
        </div>

        {mode === "openclaw" ? (
          <>
            {/* URL input */}
            <div className="mb-4">
              <label htmlFor="openclaw-url" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Server URL
              </label>
              <input
                ref={inputRef}
                id="openclaw-url"
                type="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                placeholder="ws://127.0.0.1:18789"
                disabled={isConnecting}
                className={`w-full rounded-xl border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${error || connectionError ? "border-destructive" : "border-border"}`}
              />
            </div>

            {/* Token input — hidden when URL is empty (demo mode) */}
            {url.trim() && (
              <div className="mb-4">
                <label htmlFor="openclaw-token" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Gateway Token <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <input
                  id="openclaw-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  placeholder="Enter gateway auth token"
                  disabled={isConnecting}
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
            )}
          </>
        ) : (
          <>
            {/* LM Studio URL */}
            <div className="mb-4">
              <label htmlFor="lmstudio-url" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                LM Studio URL
              </label>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  id="lmstudio-url"
                  type="url"
                  value={lmsUrl}
                  onChange={(e) => { setLmsUrl(e.target.value); setError(""); setLmsModelError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  placeholder="http://127.0.0.1:1234"
                  disabled={isConnecting}
                  className={`flex-1 rounded-xl border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${error || connectionError || lmsModelError ? "border-destructive" : "border-border"}`}
                />
                <button
                  type="button"
                  onClick={() => fetchModels(lmsUrl, lmsApiKey)}
                  disabled={lmsModelLoading || !lmsUrl.trim()}
                  className="shrink-0 rounded-xl border border-border bg-secondary px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50 flex items-center gap-1.5"
                >
                  {lmsModelLoading ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
                    </svg>
                  )}
                  Fetch
                </button>
              </div>
              {lmsModelError && <p className="mt-1.5 text-xs text-destructive">{lmsModelError}</p>}
            </div>

            {/* API Key (optional) */}
            <div className="mb-4">
              <label htmlFor="lmstudio-apikey" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                API Key <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <input
                id="lmstudio-apikey"
                type="password"
                value={lmsApiKey}
                onChange={(e) => setLmsApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                placeholder="lm-studio or leave empty"
                disabled={isConnecting}
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>

            {/* Model selector */}
            <div className="mb-4">
              <label htmlFor="lmstudio-model" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Model
              </label>
              {lmsModels.length > 0 ? (
                <select
                  id="lmstudio-model"
                  value={lmsModel}
                  onChange={(e) => setLmsModel(e.target.value)}
                  disabled={isConnecting}
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 appearance-none"
                >
                  {lmsModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="lmstudio-model"
                  type="text"
                  value={lmsModel}
                  onChange={(e) => { setLmsModel(e.target.value); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  placeholder="Click Fetch or type model name"
                  disabled={isConnecting}
                  className={`w-full rounded-xl border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${error ? "border-destructive" : "border-border"}`}
                />
              )}
            </div>
          </>
        )}

        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
        {connectionError && <p className="mb-3 text-xs text-destructive">{connectionError}</p>}

        {/* Connect button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isConnecting}
          className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isConnecting ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Connecting...
            </>
          ) : mode === "openclaw" && !url.trim() ? (
            "Start Demo"
          ) : (
            "Connect"
          )}
        </button>

        {mode === "openclaw" && (
          <p className="mt-3 text-center text-[11px] text-muted-foreground/60">
            Leave empty to use demo mode without a server
          </p>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [openclawUrl, setOpenclawUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<Record<string, unknown> | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [scrollPhase, setScrollPhase] = useState<"input" | "pill">("input");
  const appRef = useRef<HTMLDivElement>(null);
  const morphRef = useRef<HTMLDivElement>(null);
  const scrollRafId = useRef<number | null>(null);
  const scrollPhaseRef = useRef<"input" | "pill">("input");
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const autoScrollRafRef = useRef<number | null>(null);
  // Pull-to-refresh (ref-driven to avoid re-renders during gesture)
  const [refreshing, setRefreshing] = useState(false);
  const pullStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const pullContentRef = useRef<HTMLDivElement>(null);
  const setPullTransformRef = useRef<(dist: number, animate: boolean) => void>(() => {});
  const refreshStartRef = useRef(0);
  const pullSpinnerRef = useRef<HTMLDivElement>(null);
  const currentAssistantMsgRef = useRef<Message | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef<string>("main");
  const [isDemoMode, setIsDemoMode] = useState(false);
  const demoHandlerRef = useRef<ReturnType<typeof createDemoHandler> | null>(null);

  // Backend mode: openclaw (WebSocket), lmstudio (HTTP+SSE), or demo
  const [backendMode, setBackendMode] = useState<BackendMode>("openclaw");
  const lmStudioConfigRef = useRef<LmStudioConfig | null>(null);
  const lmStudioHandlerRef = useRef<ReturnType<typeof createLmStudioHandler> | null>(null);

  // Track active run for streaming
  const activeRunIdRef = useRef<string | null>(null);
  const sendWSMessageRef = useRef<((message: WebSocketMessage) => boolean) | null>(null);
  const gatewayTokenRef = useRef<string | null>(null);

  // WebSocket message handler - OpenClaw protocol
  const handleWSMessage = useCallback((data: WebSocketMessage) => {
    const msg = data as WSIncomingMessage;
    
    // Handle Connect Challenge (first message from server)
    if (msg.type === "event" && msg.event === "connect.challenge") {
      const payload = msg.payload as ConnectChallengePayload;
      // Respond with connect request with token auth
      const connectMsg = {
        type: "req",
        id: `conn-${Date.now()}`,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "webchat",
            version: "1.0.0",
            platform: "web",
            mode: "webchat",
          },
          role: "operator",
          scopes: ["operator.admin"],
          caps: ["chat", "agent", "health", "presence"],
          auth: {
            token: gatewayTokenRef.current ?? undefined,
          },
        },
      };
      sendWSMessageRef.current?.(connectMsg as unknown as WebSocketMessage);
      return;
    }
    
    // Legacy: Handle Hello message (kept for protocol compat)
    if (msg.type === "hello") {
      sessionIdRef.current = msg.sessionId;
      return;
    }
    
    // Handle Response
    if (msg.type === "res") {
      // Handle hello-ok (successful connect)
      const resPayload = msg.payload as Record<string, unknown> | undefined;
      if (msg.ok && resPayload?.type === "hello-ok") {
        const server = resPayload.server as Record<string, unknown> | undefined;
        if (server) setServerInfo(server);
        sessionIdRef.current = (server as Record<string, string>)?.connId ?? null;

        // Extract session key from snapshot
        const snapshot = resPayload.snapshot as Record<string, unknown> | undefined;
        const sessionDefaults = snapshot?.sessionDefaults as Record<string, string> | undefined;
        const sessionKey = sessionDefaults?.mainSessionKey || sessionDefaults?.mainKey || "main";
        sessionKeyRef.current = sessionKey;
        // Fetch chat history using the correct session key
        sendWSMessageRef.current?.({
          type: "req",
          id: `history-${Date.now()}`,
          method: "chat.history",
          params: { sessionKey },
        } as unknown as WebSocketMessage);
        return;
      }

      // Handle chat.send response
      if (msg.id?.startsWith("run-")) {
        return;
      }

      // Handle sessions.list response
      if (msg.ok && msg.id?.startsWith("sessions-list-")) {
        return;
      }

      // Handle chat.history response
      if (msg.ok && msg.id?.startsWith("history-")) {
      }
      if (msg.ok && msg.id?.startsWith("history-") && resPayload?.messages) {
        const rawMsgs = resPayload.messages as Array<Record<string, unknown>>;
        const historyMessages = rawMsgs
          .filter((m) => {
            const content = m.content as ContentPart[] | string | null;
            if (!content || (Array.isArray(content) && content.length === 0)) return false;
            return true;
          })
          .map((m, idx) => {
            const content = m.content as ContentPart[] | string;
            // Extract thinking content as reasoning
            let reasoning: string | undefined;
            let filteredContent: ContentPart[] | string;
            if (Array.isArray(content)) {
              const thinkingPart = content.find((p) => p.type === "thinking");
              if (thinkingPart?.thinking) reasoning = thinkingPart.thinking as string;
              filteredContent = content.filter((p) => p.type !== "thinking");
            } else {
              filteredContent = content;
            }

            // Extract tool name for tool result messages
            let toolName: string | undefined;
            // Check message-level fields first
            if (m.name) toolName = m.name as string;
            else if (m.toolName) toolName = m.toolName as string;
            // Then check content parts
            if (!toolName && Array.isArray(filteredContent)) {
              const toolPart = filteredContent.find((p) => p.name);
              if (toolPart) toolName = toolPart.name;
            }

            // Detect context-enriched user messages (server-assembled for the AI)
            let isContext = false;
            if (m.role === "user" && Array.isArray(filteredContent)) {
              const tp = filteredContent.find((p) => p.type === "text" && p.text);
              if (tp?.text && typeof tp.text === "string" && tp.text.startsWith("System: [")) isContext = true;
            }

            return {
              role: m.role as string,
              content: filteredContent,
              timestamp: m.timestamp as number,
              id: `hist-${idx}`,
              reasoning,
              toolName,
              isError: m.stopReason === "error",
              stopReason: m.stopReason as string | undefined,
              isContext,
            } as Message;
          });

        // Merge tool results into the preceding assistant's tool call content parts
        const mergedIds = new Set<string>();
        for (let i = 0; i < historyMessages.length; i++) {
          const hm = historyMessages[i];
          if ((hm.role === "tool" || hm.role === "toolResult" || hm.role === "tool_result") && hm.toolName) {
            const resultText = getTextFromContent(hm.content);
            for (let j = i - 1; j >= 0; j--) {
              const prev = historyMessages[j];
              if (prev.role === "assistant" && Array.isArray(prev.content)) {
                const tc = prev.content.find((p) => p.name === hm.toolName && !p.result);
                if (tc) {
                  const args = tc.arguments;
                  tc.arguments = typeof args === "string" ? args : args ? JSON.stringify(args) : undefined;
                  tc.result = resultText;
                  tc.resultError = hm.isError;
                  tc.status = hm.isError ? "error" : "success";
                  mergedIds.add(hm.id!);
                  break;
                }
              }
            }
          }
        }
        const finalMessages = historyMessages.filter((m) => !mergedIds.has(m.id!));

        // Extract model: prefer last assistant message with model field,
        // then fall back to parsing injected /model response text
        const lastAssistantRaw = rawMsgs.filter((m) => m.role === "assistant" && m.model).pop();
        if (lastAssistantRaw?.model) {
          const provider = lastAssistantRaw.provider as string | undefined;
          const model = lastAssistantRaw.model as string;
          setCurrentModel(provider ? `${provider}/${model}` : model);
        }
        // Check injected messages for model changes (e.g. /model command responses)
        const lastInjected = rawMsgs.filter((m) => m.stopReason === "injected").pop();
        if (lastInjected) {
          // If the injected message itself has a model field, use it
          if (lastInjected.model) {
            const provider = lastInjected.provider as string | undefined;
            const model = lastInjected.model as string;
            setCurrentModel(provider ? `${provider}/${model}` : model);
          } else {
            // Parse model from text content (e.g. "**Primary model set to `openai/gpt-5`**")
            const injectedContent = lastInjected.content;
            let injectedText = "";
            if (typeof injectedContent === "string") {
              injectedText = injectedContent;
            } else if (Array.isArray(injectedContent)) {
              injectedText = (injectedContent as ContentPart[])
                .filter((p) => p.type === "text" && p.text)
                .map((p) => p.text)
                .join("");
            }
            const modelMatch = injectedText.match(/model\s+(?:set\s+to|changed\s+to|is|:)\s+[`*]*([a-zA-Z0-9_./-]+)[`*]*/i);
            if (modelMatch) {
              setCurrentModel(modelMatch[1]);
            }
          }
        }

        // Merge: keep optimistic user messages that aren't yet in server history, sorted by timestamp
        setMessages((prev) => {
          const historyTimestamps = new Set(finalMessages.map((m) => m.timestamp));
          const optimistic = prev.filter(
            (m) => m.role === "user" && m.id?.startsWith("u-") && !historyTimestamps.has(m.timestamp)
          );
          if (optimistic.length === 0) return finalMessages;
          return [...finalMessages, ...optimistic].sort(
            (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
          );
        });

        // If pull-to-refresh was active, bounce back after minimum duration
        if (refreshingRef.current) {
          const elapsed = Date.now() - refreshStartRef.current;
          const minDelay = 150;
          const remaining = Math.max(0, minDelay - elapsed);
          setTimeout(() => {
            requestAnimationFrame(() => {
              setPullTransformRef.current(0, true);
              setRefreshing(false);
            });
          }, remaining);
        }
        return;
      }

      if (!msg.ok && msg.error) {
        const errorMsg = typeof msg.error === "string" ? msg.error : msg.error?.message || "Unknown error";
        setConnectionError(errorMsg);
      }
      return;
    }
    
    // Handle Events
    if (msg.type === "event") {
      if (msg.event === "chat") {
        const payload = msg.payload as ChatEventPayload;
        switch (payload.state) {
          case "delta":
            if (payload.message) {
              setIsStreaming(true);
              activeRunIdRef.current = payload.runId;
              
              setMessages((prev) => {
                // Find if we already have a message for this run
                const existingIdx = prev.findIndex((m) => m.id === payload.runId);
                
                if (existingIdx >= 0) {
                  // Update existing message
                  const existing = prev[existingIdx];
                  const newContent = typeof payload.message!.content === "string"
                    ? [{ type: "text", text: payload.message!.content }]
                    : payload.message!.content;
                  
                  const updated = {
                    ...existing,
                    content: newContent,
                    reasoning: payload.message!.reasoning || existing.reasoning,
                  };
                  return [...prev.slice(0, existingIdx), updated, ...prev.slice(existingIdx + 1)];
                } else {
                  // Create new message
                  const newMsg: Message = {
                    role: payload.message!.role,
                    content: typeof payload.message!.content === "string"
                      ? [{ type: "text", text: payload.message!.content }]
                      : payload.message!.content,
                    id: payload.runId,
                    timestamp: payload.message!.timestamp,
                    reasoning: payload.message!.reasoning,
                  };
                  setStreamingId(payload.runId);
                  return [...prev, newMsg];
                }
              });
            }
            break;
            
          case "final":
            setIsStreaming(false);
            setStreamingId(null);
            activeRunIdRef.current = null;
            // Server final events don't include message content — re-fetch history
            sendWSMessageRef.current?.({
              type: "req",
              id: `history-${Date.now()}`,
              method: "chat.history",
              params: { sessionKey: sessionKeyRef.current },
            } as unknown as WebSocketMessage);
            break;
            
          case "aborted":
            setIsStreaming(false);
            setStreamingId(null);
            activeRunIdRef.current = null;
            break;
            
          case "error":
            setConnectionError(payload.errorMessage || "Chat error");
            setIsStreaming(false);
            setStreamingId(null);
            activeRunIdRef.current = null;
            break;
        }
      } else if (msg.event === "agent") {
        const payload = msg.payload as AgentEventPayload;
        if (payload.stream === "lifecycle") {
          const phase = payload.data.phase as string;
          if (phase === "start") {
            setIsStreaming(true);
            activeRunIdRef.current = payload.runId;
          }
        } else if (payload.stream === "content") {
          // Live text streaming
          const delta = (payload.data.delta ?? payload.data.text ?? "") as string;
          if (delta) {
            setIsStreaming(true);
            setMessages((prev) => {
              let idx = prev.findIndex((m) => m.id === payload.runId);
              if (idx >= 0) {
                const existing = prev[idx];
                const prevText = getTextFromContent(existing.content);
                return [...prev.slice(0, idx), {
                  ...existing,
                  content: [{ type: "text", text: prevText + delta }] as ContentPart[],
                }, ...prev.slice(idx + 1)];
              }
              setStreamingId(payload.runId);
              return [...prev, {
                role: "assistant",
                content: [{ type: "text", text: delta }],
                id: payload.runId,
                timestamp: payload.ts,
              } as Message];
            });
          }
        } else if (payload.stream === "reasoning") {
          // Live thinking/reasoning streaming
          const delta = (payload.data.delta ?? payload.data.text ?? "") as string;
          if (delta) {
            setMessages((prev) => {
              let idx = prev.findIndex((m) => m.id === payload.runId);
              if (idx >= 0) {
                const existing = prev[idx];
                return [...prev.slice(0, idx), {
                  ...existing,
                  reasoning: (existing.reasoning || "") + delta,
                }, ...prev.slice(idx + 1)];
              }
              return [...prev, {
                role: "assistant",
                content: [],
                id: payload.runId,
                timestamp: payload.ts,
                reasoning: delta,
              } as Message];
            });
          }
        } else if (payload.stream === "tool") {
          // Tool call events
          const phase = payload.data.phase as string;
          const toolName = payload.data.name as string;
          if (phase === "start" && toolName) {
            setMessages((prev) => {
              let idx = prev.findIndex((m) => m.id === payload.runId);
              if (idx < 0) idx = prev.findLastIndex((m) => m.role === "assistant");
              if (idx >= 0) {
                const target = prev[idx];
                const toolCallPart: ContentPart = {
                  type: "tool_call",
                  name: toolName,
                  arguments: payload.data.args ? JSON.stringify(payload.data.args) : undefined,
                  status: "running",
                };
                return [...prev.slice(0, idx), {
                  ...target,
                  content: [...(Array.isArray(target.content) ? target.content : []), toolCallPart],
                }, ...prev.slice(idx + 1)];
              }
              return prev;
            });
          } else if ((phase === "end" || phase === "complete") && toolName) {
            const resultText = typeof payload.data.result === "string"
              ? payload.data.result : JSON.stringify(payload.data.result, null, 2);
            const isErr = !!payload.data.error;
            setMessages((prev) => {
              let idx = prev.findIndex((m) => m.id === payload.runId);
              if (idx < 0) idx = prev.findLastIndex((m) => m.role === "assistant");
              if (idx >= 0 && Array.isArray(prev[idx].content)) {
                const target = prev[idx];
                const updatedContent = (target.content as ContentPart[]).map((part) => {
                  if ((part.type === "tool_call" || part.type === "toolCall") && part.name === toolName && !part.result) {
                    return { ...part, status: isErr ? "error" as const : "success" as const, result: resultText, resultError: isErr };
                  }
                  return part;
                });
                return [...prev.slice(0, idx), { ...target, content: updatedContent }, ...prev.slice(idx + 1)];
              }
              return prev;
            });
          }
        }
      }
    }
  }, []);

  const { connectionState, connect, disconnect, sendMessage: sendWSMessage, isConnected } = useWebSocket({
    onMessage: handleWSMessage,
    onOpen: () => {
      setConnectionError(null);
    },
    onError: () => {
      setConnectionError("Failed to connect to server");
    },
    onClose: () => {
      setIsStreaming(false);
      setStreamingId(null);
    },
  });

  // Store sendWSMessage in ref to avoid circular dependency
  useEffect(() => {
    sendWSMessageRef.current = sendWSMessage;
  }, [sendWSMessage]);

  // Demo mode: detect ?demo URL param on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("demo")) {
      setIsDemoMode(true);
      setBackendMode("demo");
      setMessages(DEMO_HISTORY);
      setCurrentModel("demo/openclaw-preview");
      setShowSetup(false);
    }
  }, []);

  // Demo mode: create handler with callbacks
  useEffect(() => {
    if (!isDemoMode) {
      demoHandlerRef.current = null;
      return;
    }
    const callbacks: DemoCallbacks = {
      onStreamStart: (runId) => {
        setIsStreaming(true);
        setStreamingId(runId);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: [], id: runId, timestamp: Date.now() },
        ]);
      },
      onThinking: (runId, text) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          return [...prev.slice(0, idx), { ...prev[idx], reasoning: text }, ...prev.slice(idx + 1)];
        });
      },
      onTextDelta: (runId, _delta, fullText) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          return [
            ...prev.slice(0, idx),
            { ...prev[idx], content: [{ type: "text", text: fullText }] },
            ...prev.slice(idx + 1),
          ];
        });
      },
      onToolStart: (runId, name, args) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          const parts = Array.isArray(target.content) ? target.content : [];
          return [
            ...prev.slice(0, idx),
            { ...target, content: [...parts, { type: "tool_call", name, arguments: args, status: "running" as const }] },
            ...prev.slice(idx + 1),
          ];
        });
      },
      onToolEnd: (runId, name, result, isError) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          if (!Array.isArray(target.content)) return prev;
          const updated = target.content.map((p: ContentPart) =>
            p.type === "tool_call" && p.name === name && p.status === "running"
              ? { ...p, status: (isError ? "error" : "success") as "error" | "success", result, resultError: isError }
              : p
          );
          return [...prev.slice(0, idx), { ...target, content: updated }, ...prev.slice(idx + 1)];
        });
      },
      onStreamEnd: (runId) => {
        setIsStreaming(false);
        setStreamingId(null);
      },
    };
    demoHandlerRef.current = createDemoHandler(callbacks);
  }, [isDemoMode]);

  // LM Studio mode: create handler with callbacks
  useEffect(() => {
    if (backendMode !== "lmstudio" || !lmStudioConfigRef.current) {
      lmStudioHandlerRef.current = null;
      return;
    }
    const config = lmStudioConfigRef.current;
    const callbacks: LmStudioCallbacks = {
      onStreamStart: (runId) => {
        setIsStreaming(true);
        setStreamingId(runId);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: [], id: runId, timestamp: Date.now() },
        ]);
      },
      onThinking: (runId, text, segment) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          const parts = Array.isArray(target.content) ? [...target.content] : [];
          // Find the thinking part for this segment
          let segIdx = 0;
          const thinkPartIdx = parts.findIndex((p) => {
            if (p.type === "thinking") {
              if (segIdx === segment) return true;
              segIdx++;
            }
            return false;
          });
          if (thinkPartIdx >= 0) {
            parts[thinkPartIdx] = { ...parts[thinkPartIdx], text };
          } else {
            // Always push at end — onTextDelta will move text part to end on next update
            parts.push({ type: "thinking", text });
          }
          return [...prev.slice(0, idx), { ...target, content: parts }, ...prev.slice(idx + 1)];
        });
      },
      onTextDelta: (runId, _delta, fullText) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          // Preserve existing non-text parts (tool_call, thinking), update only the text part
          const existingParts = Array.isArray(target.content) ? target.content.filter((p: ContentPart) => p.type !== "text") : [];
          return [
            ...prev.slice(0, idx),
            { ...target, content: [...existingParts, { type: "text", text: fullText }] },
            ...prev.slice(idx + 1),
          ];
        });
      },
      onToolStart: (runId, name, args) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          const parts = Array.isArray(target.content) ? target.content : [];
          return [
            ...prev.slice(0, idx),
            { ...target, content: [...parts, { type: "tool_call", name, arguments: args, status: "running" as const }] },
            ...prev.slice(idx + 1),
          ];
        });
      },
      onToolEnd: (runId, name, result, isError) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          if (!Array.isArray(target.content)) return prev;
          const updated = target.content.map((p: ContentPart) =>
            p.type === "tool_call" && p.name === name && p.status === "running"
              ? { ...p, status: (isError ? "error" : "success") as "error" | "success", result: result || undefined, resultError: isError }
              : p
          );
          return [...prev.slice(0, idx), { ...target, content: updated }, ...prev.slice(idx + 1)];
        });
      },
      onStreamEnd: (runId) => {
        setIsStreaming(false);
        setStreamingId(null);
      },
      onError: (runId, error) => {
        setConnectionError(error);
      },
    };
    // Use currentModel so the handler is recreated when the model changes
    const activeConfig = { ...config, model: currentModel || config.model };
    lmStudioConfigRef.current = activeConfig;
    lmStudioHandlerRef.current = createLmStudioHandler(activeConfig, callbacks);
  }, [backendMode, currentModel]);

  // Track scroll position — continuous CSS var for animations, React state only for pointer-events phase
  const handleScroll = useCallback(() => {
    if (scrollRafId.current != null) return;
    scrollRafId.current = requestAnimationFrame(() => {
      scrollRafId.current = null;
      const el = scrollRef.current;
      const morph = morphRef.current;
      if (!el || !morph) return;
      // Suppress morph updates while pulling to refresh
      if (isPullingRef.current) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      // Update pinned state: consider pinned if within ~80px of bottom
      pinnedToBottomRef.current = distanceFromBottom < 80;
      const range = 60;
      const progress = Math.min(Math.max(distanceFromBottom / range, 0), 1);
      morph.style.setProperty("--sp", progress.toFixed(3));
      const newPhase: "input" | "pill" = progress > 0.4 ? "pill" : "input";
      if (newPhase !== scrollPhaseRef.current) {
        scrollPhaseRef.current = newPhase;
        setScrollPhase(newPhase);
      }
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Pull-to-refresh
  const PULL_THRESHOLD = 120;
  const refreshingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  refreshingRef.current = refreshing;

  const setPullTransform = useCallback((dist: number, animate: boolean) => {
    const wrapper = pullContentRef.current;
    const spinner = pullSpinnerRef.current;
    if (!wrapper) return;
    const transition = animate ? "transform 0.45s cubic-bezier(0.22, 0.68, 0.35, 1)" : "none";
    wrapper.style.transition = transition;
    wrapper.style.transform = dist > 0 ? `translateY(${-dist}px)` : "";
    // Spinner fades in as user pulls; animation only runs when visible
    if (spinner) {
      spinner.style.transition = animate ? "opacity 0.3s ease" : "none";
      spinner.style.opacity = dist > 0 ? String(Math.min(dist / (PULL_THRESHOLD * 0.5), 1)) : "0";
      const svg = spinner.querySelector("svg");
      if (svg) svg.style.animation = dist > 0 ? "spin 1s linear infinite" : "none";
    }
  }, []);
  setPullTransformRef.current = setPullTransform;

  const doRefresh = useCallback(() => {
    setRefreshing(true);
    refreshStartRef.current = Date.now();
    // Hold at a small offset to show spinner — bounce back happens when history arrives
    setPullTransform(40, true);
    // LM Studio and demo modes have no server-side history — just bounce back
    if (backendMode === "lmstudio" || backendMode === "demo") {
      setTimeout(() => {
        requestAnimationFrame(() => {
          setPullTransform(0, true);
          setRefreshing(false);
        });
      }, 300);
      return;
    }
    // Re-fetch history (OpenClaw)
    sendWSMessageRef.current?.({
      type: "req",
      id: `history-${Date.now()}`,
      method: "chat.history",
      params: { sessionKey: sessionKeyRef.current },
    } as unknown as WebSocketMessage);
  }, [setPullTransform, backendMode]);

  // Pull-up-to-refresh touch handlers — direct DOM transforms, no React re-renders

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const isAtBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 5;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (isAtBottom()) {
        pullStartYRef.current = e.touches[0].clientY;
        isPullingRef.current = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (pullStartYRef.current === null || refreshingRef.current) return;
      if (!isAtBottom() && !isPullingRef.current) {
        pullStartYRef.current = null;
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
        return;
      }
      const deltaY = pullStartYRef.current - e.touches[0].clientY;
      if (deltaY > 0) {
        isPullingRef.current = true;
        // Heavy rubber band — 40% of raw movement, extra resistance past threshold
        const raw = deltaY * 0.4;
        const dist = raw < PULL_THRESHOLD
          ? raw
          : PULL_THRESHOLD + (raw - PULL_THRESHOLD) * 0.15;
        pullDistanceRef.current = dist;
        setPullTransform(dist, false);
        e.preventDefault();
      } else {
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
      }
    };

    const onTouchEnd = () => {
      if (pullStartYRef.current === null) return;
      pullStartYRef.current = null;
      const wasPulling = isPullingRef.current;
      const dist = pullDistanceRef.current;
      isPullingRef.current = false;
      pullDistanceRef.current = 0;

      if (wasPulling && dist >= PULL_THRESHOLD) {
        // Hold and refresh — bounce back happens when history response arrives
        doRefresh();
      } else {
        // Bounce back smoothly
        setPullTransform(0, true);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [doRefresh, setPullTransform]);

  // iOS Safari height fix — window.innerHeight is the only reliable value
  useEffect(() => {
    const setHeight = () => {
      if (appRef.current) {
        appRef.current.style.height = `${window.innerHeight}px`;
      }
    };
    setHeight();
    window.addEventListener("resize", setHeight);
    // visualViewport fires on iOS when address bar shows/hides
    window.visualViewport?.addEventListener("resize", setHeight);
    return () => {
      window.removeEventListener("resize", setHeight);
      window.visualViewport?.removeEventListener("resize", setHeight);
    };
  }, []);

  // Check localStorage on mount for previously saved URL and token
  useEffect(() => {
    // Skip auto-connect in demo mode
    if (isDemoMode) return;
    const savedMode = window.localStorage.getItem("mobileclaw-mode") as BackendMode | null;

    if (savedMode === "lmstudio") {
      const savedUrl = window.localStorage.getItem("lmstudio-url");
      const savedApiKey = window.localStorage.getItem("lmstudio-apikey");
      const savedModel = window.localStorage.getItem("lmstudio-model");
      if (savedUrl && savedModel) {
        setBackendMode("lmstudio");
        const config: LmStudioConfig = { baseUrl: savedUrl, apiKey: savedApiKey || undefined, model: savedModel };
        lmStudioConfigRef.current = config;
        setCurrentModel(savedModel);
        setOpenclawUrl(savedUrl);
      } else {
        setShowSetup(true);
      }
    } else {
      const saved = window.localStorage.getItem("openclaw-url");
      const savedToken = window.localStorage.getItem("openclaw-token");
      if (savedToken) gatewayTokenRef.current = savedToken;
      if (saved) {
        setBackendMode("openclaw");
        setOpenclawUrl(saved);
        let wsUrl = saved;
        if (!saved.startsWith("ws://") && !saved.startsWith("wss://")) {
          wsUrl = saved.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
        }
        connect(wsUrl);
      } else {
        setShowSetup(true);
      }
    }
  }, [connect, isDemoMode]);

  const handleConnect = useCallback((config: ConnectionConfig) => {
    setConnectionError(null);
    setMessages([]);

    if (config.mode === "demo") {
      window.localStorage.setItem("mobileclaw-mode", "demo");
      window.localStorage.removeItem("openclaw-url");
      setBackendMode("demo");
      setIsDemoMode(true);
      setMessages(DEMO_HISTORY);
      setCurrentModel("demo/openclaw-preview");
      return;
    }

    if (config.mode === "lmstudio") {
      window.localStorage.setItem("mobileclaw-mode", "lmstudio");
      window.localStorage.setItem("lmstudio-url", config.url);
      if (config.token) window.localStorage.setItem("lmstudio-apikey", config.token);
      else window.localStorage.removeItem("lmstudio-apikey");
      if (config.model) window.localStorage.setItem("lmstudio-model", config.model);
      setBackendMode("lmstudio");
      setIsDemoMode(false);
      const lmsConfig: LmStudioConfig = { baseUrl: config.url, apiKey: config.token, model: config.model! };
      lmStudioConfigRef.current = lmsConfig;
      setCurrentModel(config.model || null);
      setOpenclawUrl(config.url);
      // Disconnect any existing WebSocket
      disconnect();
      return;
    }

    // OpenClaw mode
    window.localStorage.setItem("mobileclaw-mode", "openclaw");
    window.localStorage.setItem("openclaw-url", config.url);
    if (config.token) window.localStorage.setItem("openclaw-token", config.token);
    gatewayTokenRef.current = config.token ?? null;
    setBackendMode("openclaw");
    setIsDemoMode(false);
    lmStudioConfigRef.current = null;
    lmStudioHandlerRef.current = null;
    setOpenclawUrl(config.url);
    let wsUrl = config.url;
    if (!config.url.startsWith("ws://") && !config.url.startsWith("wss://")) {
      wsUrl = config.url.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
    }
    connect(wsUrl);
  }, [connect, disconnect]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    lmStudioHandlerRef.current?.stop();
    lmStudioHandlerRef.current = null;
    lmStudioConfigRef.current = null;
    window.localStorage.removeItem("openclaw-url");
    window.localStorage.removeItem("mobileclaw-mode");
    setOpenclawUrl(null);
    setMessages([]);
    setIsStreaming(false);
    setStreamingId(null);
    setConnectionError(null);
    setBackendMode("openclaw");
  }, [disconnect]);

  // Auto-scroll: on non-streaming message changes (history load, new user message), scroll to bottom
  const hasScrolledInitialRef = useRef(false);
  useEffect(() => {
    if (isStreaming) return; // rAF loop handles streaming scroll
    if (!pinnedToBottomRef.current || messages.length === 0) return;
    if (!hasScrolledInitialRef.current) {
      // First load — instant scroll after layout settles
      hasScrolledInitialRef.current = true;
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Continuous rAF loop during streaming (+ tail-off after) to keep pinned as content grows
  const streamingEndTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (isStreaming) {
      streamingEndTimeRef.current = null;
    } else if (!streamingEndTimeRef.current) {
      // Record when streaming stopped so we can ease out
      streamingEndTimeRef.current = Date.now();
    }
  }, [isStreaming]);

  useEffect(() => {
    // Start the loop when streaming begins
    if (!isStreaming && !streamingEndTimeRef.current) return;

    const tick = () => {
      const el = scrollRef.current;
      if (el && pinnedToBottomRef.current) {
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distFromBottom > 2) {
          // Close 40% of the gap per frame — stops when close enough to avoid oscillation
          el.scrollTop += Math.ceil(distFromBottom * 0.4);
        }
      }
      // Keep running during streaming, or for 500ms after to ease out the typewriter tail
      const endTime = streamingEndTimeRef.current;
      if (isStreaming || (endTime && Date.now() - endTime < 500)) {
        autoScrollRafRef.current = requestAnimationFrame(tick);
      } else {
        autoScrollRafRef.current = null;
      }
    };
    autoScrollRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (autoScrollRafRef.current) cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    };
  }, [isStreaming]);


  const sendMessage = useCallback((text: string) => {
    const userMsg: Message = { role: "user", content: [{ type: "text", text }], id: `u-${Date.now()}`, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    // Demo mode — route through local handler
    if (isDemoMode || backendMode === "demo") {
      demoHandlerRef.current?.sendMessage(text);
      return;
    }

    // LM Studio mode — route through HTTP+SSE handler
    if (backendMode === "lmstudio") {
      // Send the full conversation history (including the new user message) to LM Studio
      setMessages((prev) => {
        // Use a microtask to send after state is updated
        Promise.resolve().then(() => {
          lmStudioHandlerRef.current?.sendMessage(prev);
        });
        return prev;
      });
      return;
    }

    // OpenClaw mode — WebSocket
    if (!isConnected) return;

    // Generate idempotency key for this run
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRunIdRef.current = runId;

    const requestMsg = {
      type: "req",
      id: runId,
      method: "chat.send",
      params: {
        sessionKey: sessionKeyRef.current,
        message: text,
        deliver: true,
        idempotencyKey: runId,
      },
    };
    sendWSMessageRef.current?.(requestMsg as unknown as WebSocketMessage);

    setIsStreaming(true);
  }, [isConnected, isDemoMode, backendMode]);

  const handleCommandSelect = useCallback((command: string) => {
    setPendingCommand(command);
  }, []);

  const clearPendingCommand = useCallback(() => {
    setPendingCommand(null);
  }, []);


  return (
    <div ref={appRef} className="flex flex-col overflow-hidden bg-background" style={{ height: "100dvh" }}>
      {/* Setup dialog */}
      <SetupDialog
        onConnect={(config) => {
          setShowSetup(false);
          handleConnect(config);
        }}
        visible={showSetup}
        connectionState={connectionState}
        connectionError={connectionError}
      />

      {/* Command sheet rendered at root level so backdrop covers entire screen */}
      <CommandSheet
        open={commandsOpen}
        onClose={() => setCommandsOpen(false)}
        onSelect={handleCommandSelect}
      />

      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl md:px-6">
        <button
          type="button"
          onClick={() => setShowSetup(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-accent active:bg-accent"
          aria-label="Open settings"
        >

          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 8c-1.5-1-2.5-3-2-5 1 .5 2.5 1 3.5 2.5M19 8c1.5-1 2.5-3 2-5-1 .5-2.5 1-3.5 2.5" />
            <path d="M4.5 14.5C3 13 2 11 2 9c0-1 .5-2 1.5-2.5C5 6 6.5 7 7 8.5M19.5 14.5C21 13 22 11 22 9c0-1-.5-2-1.5-2.5C19 6 17.5 7 17 8.5" />
            <path d="M7 8.5C8 7 10 6 12 6s4 1 5 2.5" />
            <path d="M7 8.5c-.5 2 0 4 1 5.5l1.5 2c1 1 2.5 1.5 2.5 1.5s1.5-.5 2.5-1.5l1.5-2c1-1.5 1.5-3.5 1-5.5" />
            <circle cx="10" cy="11" r="0.75" fill="currentColor" />
            <circle cx="14" cy="11" r="0.75" fill="currentColor" />
            <path d="M9 20l-1 2M15 20l1 2M12 20v2" />
          </svg>
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-sm font-semibold text-foreground">MobileClaw</h1>
          {currentModel && (
            <p className="truncate text-[11px] text-muted-foreground">{currentModel}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isDemoMode || backendMode === "demo" ? (
            <>
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="text-[11px] text-muted-foreground">Demo</span>
            </>
          ) : backendMode === "lmstudio" ? (
            <>
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-[11px] text-muted-foreground">LM Studio</span>
            </>
          ) : (
            <>
              <span className={`h-2 w-2 rounded-full ${
                connectionState === "connected"
                  ? "bg-green-500"
                  : connectionState === "connecting"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-red-500"
              }`} />
              <span className="text-[11px] text-muted-foreground">
                {connectionState === "connected"
                  ? "Connected"
                  : connectionState === "connecting"
                    ? "Connecting..."
                    : "Disconnected"}
              </span>
            </>
          )}
        </div>
      </header>

      <div ref={pullContentRef} className="flex flex-1 flex-col overflow-hidden">
      <main
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ overscrollBehavior: "none" }}
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6 pb-28 md:px-6 md:py-4 md:pb-28">
          {messages.map((msg, idx) => {
            const side = getMessageSide(msg.role);
            const prevSide = idx > 0 ? getMessageSide(messages[idx - 1].role) : null;
            const prevTimestamp = idx > 0 ? messages[idx - 1].timestamp : null;
            const isNewTurn = side !== "center" && side !== prevSide;
            const timGap = msg.timestamp && prevTimestamp ? msg.timestamp - prevTimestamp : 0;
            const isTimeGap = timGap > 10 * 60 * 1000;
            const showTimestamp = side !== "center" && (isNewTurn || isTimeGap);
            return (
              <React.Fragment key={msg.id || idx}>
                {isTimeGap && !isNewTurn && msg.timestamp && (
                  <div className="flex justify-center py-1">
                    <span className="text-[10px] text-muted-foreground/60">{formatMessageTime(msg.timestamp)}</span>
                  </div>
                )}
                {showTimestamp && isNewTurn && msg.timestamp && (
                  <p className={`text-[10px] text-muted-foreground/60 ${side === "right" ? "text-right" : "text-left"}`}>
                    {formatMessageTime(msg.timestamp)}
                  </p>
                )}
                <MessageRow message={msg} isStreaming={isStreaming && msg.id === streamingId} />
              </React.Fragment>
            );
          })}
          {isStreaming && !streamingId && <ThinkingIndicator />}
          <div ref={bottomRef} />
        </div>
      </main>
      {/* Pull-to-refresh spinner — outside scroll container to avoid affecting scrollHeight.
          h-0 so no layout space; overflow-visible so SVG still renders when revealed. */}
      <div
        ref={pullSpinnerRef}
        className="flex h-0 items-center justify-center overflow-visible"
        style={{ opacity: 0 }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground" style={{ animation: "none" }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
      </div>

      {/* Floating morphing bar -- driven by continuous scrollProgress (0=bottom, 1=scrolled) */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[3dvh] md:px-6 md:pb-[3dvh]">
        <div ref={morphRef} className="pointer-events-auto w-full max-w-2xl" style={{ "--sp": "0" } as React.CSSProperties}>
          <ChatInput
            onSend={sendMessage}
            onOpenCommands={() => setCommandsOpen(true)}
            commandValue={pendingCommand}
            onCommandValueUsed={clearPendingCommand}
            scrollPhase={scrollPhase}
            onScrollToBottom={scrollToBottom}
          />
        </div>
      </div>
    </div>
  );
}
