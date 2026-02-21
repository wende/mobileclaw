"use client";

import React, { useState, useEffect, useRef } from "react";
import type { ContentPart, Message } from "@/types/chat";
import { getTextFromContent, getImages, thinkingPreview } from "@/lib/messageUtils";
import { HEARTBEAT_MARKER, NO_REPLY_MARKER, SYSTEM_PREFIX, SYSTEM_MESSAGE_PREFIX, STOP_REASON_INJECTED, isToolCallPart, SPAWN_TOOL_NAME } from "@/lib/constants";
import { useExpandablePanel } from "@/hooks/useExpandablePanel";
import { SlideContent } from "@/components/SlideContent";
import { MarkdownContent } from "@/components/markdown/MarkdownContent";
import { StreamingText } from "@/components/StreamingText";
import { ToolCallPill } from "@/components/ToolCallPill";
import { ImageThumbnails } from "@/components/ImageThumbnails";
import { SmoothGrow } from "@/components/SmoothGrow";
import type { SubagentStore } from "@/hooks/useSubagentStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

// Strip <think>...</think> tags from text, returning extracted thinking and cleaned text.
// Handles: full <think>...</think> blocks, orphaned </think> (opening tag stripped elsewhere),
// and unclosed <think> (model still streaming thinking).
function stripThinkTags(raw: string): { thinking: string; text: string } {
  let thinking = "";
  let text = raw;

  // 1. Extract full <think>...</think> blocks
  const re = /<think>([\s\S]*?)<\/think>/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    thinking += (thinking ? "\n" : "") + match[1].trim();
  }
  text = text.replace(re, "");

  // 2. Orphaned </think> without a preceding <think> — everything before it is thinking content
  const closeIdx = text.indexOf("</think>");
  if (closeIdx !== -1) {
    const before = text.slice(0, closeIdx).trim();
    if (before) thinking += (thinking ? "\n" : "") + before;
    text = text.slice(closeIdx + "</think>".length);
    text = text.replace(/<\/think>/g, "");
  }

  // 3. Unclosed <think> at the start (model still thinking, no </think> yet)
  if (text.trimStart().startsWith("<think>")) {
    const after = text.trimStart().slice("<think>".length).trim();
    thinking += (thinking ? "\n" : "") + after;
    text = "";
  }

  return { thinking: thinking.trim(), text: text.trim() };
}

// ── InjectedPill — expandable context pill for injected assistant messages ──

const INJECTED_ICON_CLS = "shrink-0 opacity-50";

function InjectedIcon({ type }: { type: "heartbeat" | "no_reply" | "info" }) {
  if (type === "heartbeat") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={INJECTED_ICON_CLS}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
  if (type === "no_reply") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={INJECTED_ICON_CLS}>
      <path d="M17 11h1a3 3 0 0 1 0 6h-1" /><path d="M9 12v6" /><path d="M13 12v6" />
      <path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 3 11 3s2 .5 3 .5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z" />
    </svg>
  );
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={INJECTED_ICON_CLS}>
      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
    </svg>
  );
}

function getInjectedSummary(text: string): { type: "heartbeat" | "no_reply" | "info"; summary: string } {
  if (text.includes(HEARTBEAT_MARKER)) {
    // Last sentence before HEARTBEAT_OK
    const before = text.slice(0, text.indexOf(HEARTBEAT_MARKER)).trim();
    const sentences = before.match(/[^.!?\n]+[.!?]?/g);
    const last = sentences?.[sentences.length - 1]?.trim();
    return { type: "heartbeat", summary: "Heartbeat" };
  }
  if (text.includes(NO_REPLY_MARKER)) {
    const before = text.slice(0, text.indexOf(NO_REPLY_MARKER)).trim();
    const sentences = before.match(/[^.!?\n]+[.!?]?/g);
    const last = sentences?.[sentences.length - 1]?.trim();
    return { type: "no_reply", summary: last || "No reply" };
  }
  const firstLine = text.split("\n").find((l) => l.trim()) ?? text.slice(0, 80);
  return { type: "info", summary: firstLine };
}

function InjectedPill({ text, message, subagentStore }: { text: string; message?: Message; subagentStore?: SubagentStore }) {
  const { open, toggle, mounted, expanded, outerRef, contentRef, handleTransitionEnd } = useExpandablePanel();
  const { type, summary: rawSummary } = getInjectedSummary(text);
  const summary = rawSummary.replace(/[#*_~`>]/g, "").replace(/\s+/g, " ").trim();

  const parts = message && Array.isArray(message.content) ? message.content as ContentPart[] : null;
  const hasThinkingParts = parts?.some((p) => p.type === "thinking");
  const hasRichContent = !!(parts && parts.some((p) => p.type === "thinking" || isToolCallPart(p))) || !!message?.reasoning;

  return (
    <div className="flex justify-center py-2">
      <div ref={outerRef} onTransitionEnd={handleTransitionEnd} className="max-w-[85%] w-fit rounded-lg border border-border bg-secondary overflow-hidden transition-[width] duration-200 ease-out">
        <button
          type="button"
          onClick={toggle}
          className="w-full rounded-[inherit] cursor-pointer text-left px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5"
        >
          <InjectedIcon type={type} />
          <span className="truncate">{summary}</span>
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="ml-auto shrink-0 opacity-40 transition-transform duration-200"
            style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {mounted && (
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-out"
            style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden min-h-0">
              <div ref={contentRef} className="border-t border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {hasRichContent ? (
                  <div className="flex flex-col gap-1.5">
                    {message?.reasoning && !hasThinkingParts && <ThinkingPill text={message.reasoning} />}
                    {parts?.map((part, i) => {
                      if (part.type === "thinking") {
                        return <ThinkingPill key={`thinking-${i}`} text={part.text || ""} />;
                      }
                      if (isToolCallPart(part)) {
                        return <ToolCallPill key={`${part.name}-${i}`} name={part.name || "tool"} args={typeof part.arguments === "string" ? part.arguments : part.arguments ? JSON.stringify(part.arguments) : undefined} status={part.status as "running" | "success" | "error" | undefined} result={part.result} resultError={part.resultError} toolCallId={part.toolCallId} subagentStore={part.name === SPAWN_TOOL_NAME ? subagentStore : undefined} />;
                      }
                      if (part.type === "text" && part.text) {
                        return (
                          <div key={`text-${i}`} className="text-sm leading-relaxed break-words overflow-hidden whitespace-pre-wrap">
                            <MarkdownContent text={part.text} />
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words">
                    <MarkdownContent text={text} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ThinkingPill ─────────────────────────────────────────────────────────────

const BRAIN_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block shrink-0 opacity-50 mr-1.5 align-[-1px]">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
  </svg>
);

function extractLastSentence(text: string): string {
  const matches = text.match(/[^.]*\./g);
  if (!matches) return "";
  return matches[matches.length - 1].trim();
}

function ThinkingPill({ text }: { text: string }) {
  const isEmpty = !text.trim();
  const lineCount = text.split("\n").length;
  const isShort = !isEmpty && lineCount < 10;

  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Initialize from props so history-restored thinking blocks render at full height immediately
  // (avoids a delayed height increase that causes scroll bounce on refresh)
  const [sentence, setSentence] = useState(() => isEmpty ? "" : extractLastSentence(text));
  const [visible, setVisible] = useState(() => !isEmpty && !!extractLastSentence(text));
  const lastSentenceRef = useRef(sentence);

  // Slide in on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (isEmpty) return;
    // Extract the last complete sentence (ends with a period)
    const matches = text.match(/[^.]*\./g);
    if (!matches) return;
    const last = matches[matches.length - 1].trim();
    if (last && last !== lastSentenceRef.current) {
      lastSentenceRef.current = last;
      // Fade out, swap, fade in
      setVisible(false);
      const t = setTimeout(() => {
        setSentence(last);
        setVisible(true);
      }, 180);
      return () => clearTimeout(t);
    }
  }, [text, isEmpty]);

  // Short thinking: render as plain faded text with slide animation
  if (isShort) {
    return (
      <SlideContent open={mounted}>
        <p className="text-xs leading-relaxed text-muted-foreground/50 whitespace-pre-wrap break-words overflow-hidden">
          {text}
        </p>
      </SlideContent>
    );
  }

  return (
    <SlideContent open={mounted}>
      <div className="w-fit max-w-full rounded-lg border border-border bg-secondary">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full rounded-[inherit] cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground"
        >
          <div className="flex items-center whitespace-nowrap">
            {BRAIN_ICON}
            {isEmpty ? (
              <span className="inline-flex items-center gap-0.5">
                <span>Thinking</span>
                <span className="inline-flex w-4">
                  <span className="animate-[dotFade_1.4s_ease-in-out_infinite]">.</span>
                  <span className="animate-[dotFade_1.4s_ease-in-out_0.2s_infinite]">.</span>
                  <span className="animate-[dotFade_1.4s_ease-in-out_0.4s_infinite]">.</span>
                </span>
              </span>
            ) : (
              <span>{thinkingPreview(text)}</span>
            )}
            {!isEmpty && (
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="ml-auto shrink-0 opacity-40 transition-transform duration-200"
                style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            )}
          </div>
          {!isEmpty && sentence && !expanded && (
            <div className="mt-1 max-w-[300px] overflow-hidden text-left">
              <div
                className="text-[11px] leading-tight text-muted-foreground/40 truncate font-normal transition-opacity duration-200"
                style={{ opacity: visible ? 1 : 0 }}
              >
                {sentence}
              </div>
            </div>
          )}
        </button>
        {!isEmpty && (
          <SlideContent open={expanded}>
            <p className="px-3 pb-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words overflow-hidden">
              {text}
            </p>
          </SlideContent>
        )}
      </div>
    </SlideContent>
  );
}

// ── UserTextWithQuotes ────────────────────────────────────────────────────────

/** Parse user message text into quoted (`> ...`) and plain segments. */
function UserTextWithQuotes({ text }: { text: string }) {
  const lines = text.split("\n");
  const segments: { quoted: boolean; lines: string[] }[] = [];

  for (const line of lines) {
    const isQuoted = line.startsWith("> ") || line === ">";
    const content = isQuoted ? line.slice(line.startsWith("> ") ? 2 : 1) : line;
    const last = segments[segments.length - 1];
    if (last && last.quoted === isQuoted) {
      last.lines.push(content);
    } else {
      segments.push({ quoted: isQuoted, lines: [content] });
    }
  }

  // Trim empty lines at segment boundaries (removes the \n\n separator between quote and text)
  for (const seg of segments) {
    while (seg.lines.length && seg.lines[0] === "") seg.lines.shift();
    while (seg.lines.length && seg.lines[seg.lines.length - 1] === "") seg.lines.pop();
  }

  const filtered = segments.filter((s) => s.lines.length > 0);

  // If no quoted segments, render as plain text (avoid extra DOM)
  if (!filtered.some((s) => s.quoted)) {
    return <>{text}</>;
  }

  return (
    <>
      {filtered.map((seg, i) =>
        seg.quoted ? (
          <div key={i} className="border-l-2 border-primary-foreground/30 pl-2.5 my-1 opacity-75">
            {seg.lines.join("\n")}
          </div>
        ) : (
          <React.Fragment key={i}>{seg.lines.join("\n")}</React.Fragment>
        )
      )}
    </>
  );
}

function ContextPill({ summary, iconEl, text }: { summary: string; iconEl: React.ReactNode; text: string }) {
  const { open, toggle, mounted, expanded, outerRef, contentRef, handleTransitionEnd } = useExpandablePanel();

  return (
    <div className="flex flex-row-reverse">
      <div ref={outerRef} onTransitionEnd={handleTransitionEnd} className="max-w-[85%] md:max-w-[75%] w-fit rounded-2xl rounded-br-md bg-primary text-primary-foreground overflow-hidden transition-[width] duration-200 ease-out">
        <button
          onClick={toggle}
          className="cursor-pointer rounded-[inherit] w-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5"
        >
          {iconEl}
          <span className="truncate">{summary}</span>
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 ml-auto opacity-50 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {mounted && (
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-out"
            style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden min-h-0">
              <div ref={contentRef} className="border-t border-primary-foreground/20 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words opacity-80">
                {text}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MessageRow ───────────────────────────────────────────────────────────────

export function MessageRow({ message, isStreaming, subagentStore, pinnedToolCallId, onPin, onUnpin }: { message: Message; isStreaming: boolean; subagentStore?: SubagentStore; pinnedToolCallId?: string | null; onPin?: (info: { toolCallId: string | null; childSessionKey: string | null; taskName: string; model: string | null }) => void; onUnpin?: () => void }) {
  const text = getTextFromContent(message.content);
  const images = getImages(message.content);

  if (message.role === "toolResult" || message.role === "tool_result" || message.role === "tool") {
    return null;
  }

  // Context pill — expandable pill for system-injected user messages
  if (message.isContext && text) {
    const { type: contextType } = getInjectedSummary(text);
    let summary: string;
    if (text.startsWith(SYSTEM_MESSAGE_PREFIX)) {
      // Strip [System Message] and any bracketed tags like [sessionId: ...]
      const bodyMatch = text.match(/^(?:\[System Message\]\s*(?:\[[^\]]*\]\s*)*)(.+)/s);
      const body = bodyMatch?.[1] ?? text;
      const sentenceEnd = body.search(/[.!?\n]/);
      const raw = sentenceEnd > 0 ? body.slice(0, sentenceEnd) : body.slice(0, 80);
      summary = raw.replace(/[#*_~`>]/g, "").replace(/\s+/g, " ").trim();
    } else if (text.startsWith(SYSTEM_PREFIX)) {
      const lines = text.split("\n").filter((l) => l.startsWith(SYSTEM_PREFIX));
      const summaryParts = lines.map((line) => {
        const match = line.match(/^System: \[[^\]]+\]\s*(.+)$/);
        return match?.[1] ?? line;
      });
      summary = summaryParts.length > 0
        ? summaryParts.length === 1 ? summaryParts[0] : `${summaryParts.length} context items`
        : "Context";
    } else if (contextType === "heartbeat") {
      summary = "Heartbeat";
    } else {
      const firstLine = text.split("\n").find((l) => l.trim()) ?? text.slice(0, 80);
      summary = firstLine.replace(/[#*_~`>]/g, "").replace(/\s+/g, " ").trim();
    }
    const useHeartbeatIcon = contextType === "heartbeat" && !text.startsWith(SYSTEM_MESSAGE_PREFIX) && !text.startsWith(SYSTEM_PREFIX);
    const iconEl = useHeartbeatIcon
      ? <InjectedIcon type="heartbeat" />
      : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
          <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" /><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
        </svg>
      );

    return <ContextPill summary={summary} iconEl={iconEl} text={text} />;
  }

  if (message.isError && (message.role === "system" || message.role === "assistant")) {
    const errorText = text || "Unknown error";
    return (
      <div className="flex justify-center py-2">
        <div className="max-w-[85%] rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-xs leading-relaxed text-destructive-foreground whitespace-pre-wrap break-words">
          {errorText}
        </div>
      </div>
    );
  }

  // Injected assistant messages — expandable context pill (tool-call style)
  if (message.stopReason === STOP_REASON_INJECTED && text) {
    return <InjectedPill text={text} message={message} subagentStore={subagentStore} />;
  }

  if (message.role === "system") {
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

  // HEARTBEAT_OK / NO_REPLY assistant messages — render as injected pill
  if (message.role === "assistant" && text && (text.includes(HEARTBEAT_MARKER) || text.includes(NO_REPLY_MARKER))) {
    return <InjectedPill text={text} message={message} subagentStore={subagentStore} />;
  }

  const isUser = message.role === "user";

  // Check if content array has structured thinking parts
  const hasThinkingParts = Array.isArray(message.content)
    && (message.content as ContentPart[]).some((p) => p.type === "thinking");

  // Force assistant container to fill max-width when a spawn tool is present
  const hasSpawnTool = !isUser && Array.isArray(message.content)
    && (message.content as ContentPart[]).some((p) => isToolCallPart(p) && p.name === SPAWN_TOOL_NAME);

  return (
    <div data-message-role={message.role} className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`max-w-[85%] md:max-w-[75%] min-w-0 ${isUser ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground" : ""} ${hasSpawnTool ? "w-[85%] md:w-[75%]" : ""}`}>
        {isUser ? (
          <>
            {text && (
              <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                <UserTextWithQuotes text={text} />
              </div>
            )}
            <ImageThumbnails images={images} />
          </>
        ) : (
          /* Single-pass rendering: all parts in content array order for correct chronology */
          <SmoothGrow active={isStreaming} className="flex flex-col gap-1.5">
            {/* message.reasoning (from OpenClaw stream parser) renders first — it precedes tool calls */}
            {message.reasoning && !hasThinkingParts && <ThinkingPill text={message.reasoning} />}
            {Array.isArray(message.content) ? (message.content as ContentPart[]).map((part, i) => {
              if (part.type === "thinking") {
                return <ThinkingPill key={`thinking-${i}`} text={part.text || ""} />;
              }
              if (isToolCallPart(part)) {
                const isSpawn = part.name === SPAWN_TOOL_NAME;
                return <ToolCallPill key={`${part.name}-${i}`} name={part.name || "tool"} args={typeof part.arguments === "string" ? part.arguments : part.arguments ? JSON.stringify(part.arguments) : undefined} status={part.status as "running" | "success" | "error" | undefined} result={part.result} resultError={part.resultError} toolCallId={part.toolCallId} subagentStore={isSpawn ? subagentStore : undefined} isPinned={isSpawn && !!part.toolCallId && part.toolCallId === pinnedToolCallId} onPin={isSpawn ? onPin : undefined} onUnpin={isSpawn ? onUnpin : undefined} />;
              }
              if (part.type === "text" && part.text) {
                const { thinking: extractedThinking, text: cleanText } = stripThinkTags(part.text);
                const remainingParts = (message.content as ContentPart[]).slice(i + 1);
                const isLastText = !remainingParts.some((p) => p.type === "text" && p.text);
                // Hide cursor if tool call or thinking appears after this text
                const hasLaterNonText = remainingParts.some((p) => isToolCallPart(p) || p.type === "thinking");
                const showCursor = isStreaming && isLastText && !hasLaterNonText;
                return (
                  <React.Fragment key={`text-${i}`}>
                    {extractedThinking && !hasThinkingParts && !message.reasoning && (
                      <ThinkingPill text={extractedThinking} />
                    )}
                    {cleanText && (
                      <div className="text-sm leading-relaxed break-words overflow-hidden text-foreground">
                        {showCursor ? (
                          <StreamingText text={cleanText} isStreaming={isStreaming} />
                        ) : (
                          <MarkdownContent text={cleanText} />
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              }
              if (part.type === "image" || part.type === "image_url") {
                return <ImageThumbnails key={`img-${i}`} images={[part]} />;
              }
              return null;
            }) : text ? (() => {
              const { thinking: extractedThinking, text: cleanText } = stripThinkTags(text);
              return (
                <>
                  {extractedThinking && !hasThinkingParts && !message.reasoning && (
                    <ThinkingPill text={extractedThinking} />
                  )}
                  {cleanText && (
                    <div className="text-sm leading-relaxed break-words overflow-hidden text-foreground">
                      {isStreaming ? (
                        <StreamingText text={cleanText} isStreaming={isStreaming} />
                      ) : (
                        <MarkdownContent text={cleanText} />
                      )}
                    </div>
                  )}
                </>
              );
            })() : null}
          </SmoothGrow>
        )}
      </div>
    </div>
  );
}
