"use client";

import React, { useState, useEffect, useRef } from "react";
import type { ContentPart, Message } from "@/types/chat";
import { getTextFromContent, getImages, getFiles } from "@/lib/messageUtils";
import { HEARTBEAT_MARKER, NO_REPLY_MARKER, SYSTEM_PREFIX, SYSTEM_MESSAGE_PREFIX, STOP_REASON_INJECTED, isToolCallPart, SPAWN_TOOL_NAME, hasUnquotedMarker, hasHeartbeatOnOwnLine, SQUIRCLE_RADIUS, PILL_BASE_HEIGHT, MESSAGE_SEND_ANIMATION } from "@/lib/constants";
import { useExpandablePanel } from "@/hooks/useExpandablePanel";
import { SlideContent } from "@/components/SlideContent";
import { MarkdownContent } from "@/components/markdown/MarkdownContent";
import { StreamingText } from "@/components/StreamingText";
import { ToolCallPill } from "@/components/ToolCallPill";
import { ImageThumbnails } from "@/components/ImageThumbnails";
import { SmoothGrow } from "@/components/SmoothGrow";
import { ZenToggle } from "@/components/ZenToggle";
import type { SubagentStore } from "@/hooks/useSubagentStore";
import { isNativeMode, postLinkTap, postImageTap } from "@/lib/nativeBridge";
import { ZEN_SLIDE_MS, ZEN_FADE_MS } from "@/lib/chat/zenUi";

// ── File Thumbnails ──────────────────────────────────────────────────────────

function fileExt(name?: string): string {
  if (!name) return "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : "";
}

function FileThumbnails({ files }: { files: ContentPart[] }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-1.5 flex gap-1.5 flex-wrap">
      {files.map((f, i) => {
        const ext = fileExt(f.file_name);
        const uploading = !f.file_url;
        const el = (
          <div
            key={i}
            className={`flex items-center gap-2 rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 px-2.5 py-1.5 ${uploading ? "opacity-60" : ""}`}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-foreground/15">
              {ext ? (
                <span className="text-2xs font-bold leading-none text-primary-foreground/80">{ext.slice(0, 4)}</span>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground/70">
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
                </svg>
              )}
            </div>
            <span className="max-w-[140px] truncate text-xs font-medium text-primary-foreground/90">{f.file_name || "file"}</span>
            {uploading && (
              <svg width="12" height="12" viewBox="0 0 24 24" className="animate-spin text-primary-foreground/50 shrink-0">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
            )}
          </div>
        );
        if (f.file_url) {
          return <a key={i} href={f.file_url} target="_blank" rel="noopener noreferrer" className="no-underline">{el}</a>;
        }
        return el;
      })}
    </div>
  );
}

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

/** Strip outermost <final>...</final> wrapper if the entire text is wrapped in it. */
function stripFinalTags(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("<final>") && trimmed.endsWith("</final>")) {
    return trimmed.slice("<final>".length, -"</final>".length).trim();
  }
  return text;
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
    return { type: "heartbeat", summary: "Heartbeat" };
  }
  if (hasUnquotedMarker(text, NO_REPLY_MARKER)) {
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

  const parts = message && Array.isArray(message.content) ? message.content : null;
  const hasThinkingParts = parts?.some((p) => p.type === "thinking");
  const hasRichContent = !!(parts && parts.some((p) => p.type === "thinking" || isToolCallPart(p))) || !!message?.reasoning;

  return (
    <div className="flex -mt-1.5">
      <div ref={outerRef} onTransitionEnd={handleTransitionEnd} className="max-w-[85%] w-fit rounded border border-border bg-card overflow-hidden transition-[width] duration-200 ease-out">
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
              <div ref={contentRef} className="border-t border-border px-3 py-2 text-xs leading-[1.75rem] text-muted-foreground">
                {hasRichContent ? (
                  <div className="flex flex-col gap-1.5">
                    {message?.reasoning && !hasThinkingParts && <ThinkingPill text={message.reasoning} />}
                    {parts?.map((part, i) => {
                      if (part.type === "thinking") {
                        return <ThinkingPill key={`thinking-${i}`} text={part.thinking || part.text || ""} />;
                      }
                      if (isToolCallPart(part)) {
                        return <ToolCallPill key={`${part.name}-${i}`} name={part.name || "tool"} args={typeof part.arguments === "string" ? part.arguments : part.arguments ? JSON.stringify(part.arguments) : undefined} status={part.status} result={part.result} resultError={part.resultError} toolCallId={part.toolCallId} subagentStore={part.name === SPAWN_TOOL_NAME ? subagentStore : undefined} />;
                      }
                      if (part.type === "text" && part.text) {
                        return (
                          <div key={`text-${i}`} className="text-sm leading-[1.75rem] break-words overflow-hidden whitespace-pre-wrap">
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

const THINKING_COLLAPSE_THRESHOLD = 5;

function ThinkingPill({ text }: { text: string }) {
  const isEmpty = !text.trim();
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lineCount = text.split("\n").length;
  const needsClamp = !isEmpty && lineCount >= THINKING_COLLAPSE_THRESHOLD;

  useEffect(() => {
    if (mounted) return;
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  if (isEmpty) {
    return (
      <SlideContent open={mounted}>
        <p className="text-xs leading-[1.5] text-muted-foreground/50">
          <span className="inline-flex items-center gap-0.5">
            <span>Thinking</span>
            <span className="inline-flex w-4">
              <span className="animate-[dotFade_1.4s_ease-in-out_infinite]">.</span>
              <span className="animate-[dotFade_1.4s_ease-in-out_0.2s_infinite]">.</span>
              <span className="animate-[dotFade_1.4s_ease-in-out_0.4s_infinite]">.</span>
            </span>
          </span>
        </p>
      </SlideContent>
    );
  }

  if (!needsClamp) {
    return (
      <SlideContent open={mounted}>
        <p className="text-xs leading-[1.5] text-muted-foreground/50 whitespace-pre-wrap break-words overflow-hidden">
          {text}
        </p>
      </SlideContent>
    );
  }

  const firstLine = text.split("\n")[0];

  return (
    <SlideContent open={mounted}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); } }}
        className="text-xs leading-[1.5] text-muted-foreground/50 cursor-pointer"
      >
        <div className="flex items-center gap-1">
          <span className="truncate break-words overflow-hidden">{firstLine}</span>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0 opacity-60 transition-transform duration-200"
            style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
        <SlideContent open={expanded}>
          <p className="whitespace-pre-wrap break-words overflow-hidden">{text}</p>
        </SlideContent>
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

// ── CommandResponsePill — expandable pill for slash command responses ────────

function CommandResponsePill({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  
  // Robust summary extraction
  const summary = (text.split("\n").filter(l => l.trim())[0] ?? text.slice(0, 80))
    .replace(/[#*_~`>]/g, "").replace(/\s+/g, " ").trim();

  const isHistory = !isStreaming;

  return (
    <div className="flex -mt-1.5">
      <div className="max-w-[85%] w-fit rounded-lg bg-card border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setUserToggled((v) => v === null ? false : !v)}
          className="w-full px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5 cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span className="truncate">{summary}</span>
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="ml-auto shrink-0 opacity-40 transition-transform duration-200"
            style={{ transform: (userToggled ?? !isStreaming) ? "rotate(0deg)" : "rotate(-90deg)" }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <div
          className="grid overflow-hidden"
          style={userToggled !== null
            ? { gridTemplateRows: userToggled ? "1fr" : "0fr", transition: "grid-template-rows 200ms ease-out" }
            : isHistory
              ? { gridTemplateRows: "1fr" }
              : { animation: "gridSlideOpen 250ms ease-out forwards" }
          }
        >
          <div className="min-h-0">
            <div className="border-t border-border px-3 py-2 text-xs leading-[1.75rem] whitespace-pre-wrap break-words text-foreground/80">
              {text}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextPill({ summary, iconEl, text }: { summary: string; iconEl: React.ReactNode; text: string }) {
  const { toggle, mounted, expanded, outerRef, contentRef, handleTransitionEnd } = useExpandablePanel();

  return (
    <div className="flex flex-row-reverse">
      <div ref={outerRef} onTransitionEnd={handleTransitionEnd} className="max-w-[85%] md:max-w-[75%] w-fit rounded border border-border bg-primary overflow-hidden transition-[width] duration-200 ease-out">
        <button
          onClick={toggle}
          className="cursor-pointer rounded-[inherit] w-full px-3 py-1.5 text-xs font-medium text-primary-foreground/70 flex items-center gap-1.5"
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
              <div ref={contentRef} className="border-t border-primary-foreground/15 px-3 py-2 text-xs leading-[1.75rem] whitespace-pre-wrap break-words text-primary-foreground/70">
                {text}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Native mode click interceptor ──────────────────────────────────────────

/** In native mode, intercept link clicks and image taps to route to Swift. */
function useNativeClickInterceptor(containerRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!isNativeMode()) return;
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: MouseEvent) => {
      let target = e.target as HTMLElement | null;
      while (target && target !== el) {
        if (target.tagName === "A") {
          const href = (target as HTMLAnchorElement).href;
          if (href && !href.startsWith("javascript:")) {
            e.preventDefault();
            e.stopPropagation();
            postLinkTap(href);
            return;
          }
        }
        if (target.tagName === "IMG") {
          const src = (target as HTMLImageElement).src;
          if (src) {
            e.preventDefault();
            e.stopPropagation();
            postImageTap(src);
            return;
          }
        }
        target = target.parentElement;
      }
    };

    el.addEventListener("click", handler, true);
    return () => el.removeEventListener("click", handler, true);
  }, [containerRef]);
}

// ── MessageRow ───────────────────────────────────────────────────────────────

export function MessageRow({
  message,
  isStreaming,
  freezeStreamingLayout = false,
  subagentStore,
  pinnedToolCallId,
  onPin,
  onUnpin,
  zenMode = false,
  zenGroupCollapsible = false,
  zenGroupExpanded = false,
  zenCollapsedByGroup = false,
  zenGroupSlideOpen = false,
  zenGroupFadeVisible = false,
  onZenGroupToggle,
  isSentAnim = false,
  onSentAnimationEnd,
}: {
  message: Message;
  isStreaming: boolean;
  freezeStreamingLayout?: boolean;
  subagentStore?: SubagentStore;
  pinnedToolCallId?: string | null;
  onPin?: (info: { toolCallId: string | null; childSessionKey: string | null; taskName: string; model: string | null }) => void;
  onUnpin?: () => void;
  zenMode?: boolean;
  zenGroupCollapsible?: boolean;
  zenGroupExpanded?: boolean;
  zenCollapsedByGroup?: boolean;
  zenGroupSlideOpen?: boolean;
  zenGroupFadeVisible?: boolean;
  onZenGroupToggle?: () => void;
  isSentAnim?: boolean;
  onSentAnimationEnd?: () => void;
}) {
  const messageRef = useRef<HTMLDivElement>(null);
  useNativeClickInterceptor(messageRef);

  // Pill → squircle transition for user bubbles
  const userBubbleRef = useRef<HTMLDivElement>(null);
  const [userBubbleH, setUserBubbleH] = useState(0);
  const isUser = message.role === "user";
  useEffect(() => {
    if (!isUser || typeof ResizeObserver === "undefined") return;
    const el = userBubbleRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
      setUserBubbleH(Math.round(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isUser]);
  const userRadius = isUser && userBubbleH > 0
    ? (userBubbleH <= PILL_BASE_HEIGHT ? Math.round(userBubbleH / 2) : SQUIRCLE_RADIUS)
    : 9999;

  const text = getTextFromContent(message.content);
  const images = getImages(message.content);
  const files = getFiles(message.content);

  if (message.role === "toolResult" || message.role === "tool_result" || message.role === "tool") {
    return null;
  }

  // Command response pill — expandable pill for slash command responses
  if (message.isCommandResponse) {
    if (!text) {
      return (
        <div key="loading" className="flex -mt-1.5">
          <div className="w-fit rounded-lg bg-card border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 opacity-50 animate-spin">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span>Running...</span>
          </div>
        </div>
      );
    }
    return <CommandResponsePill key={message.id} text={text} isStreaming={isStreaming} />;
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
        <div className="max-w-[85%] rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-xs leading-[1.75rem] text-destructive-foreground whitespace-pre-wrap break-words">
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
        <div className="max-w-[85%] rounded-lg bg-secondary px-4 py-2 text-xs leading-[1.75rem] text-muted-foreground whitespace-pre-wrap break-words">
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
  if (message.role === "assistant" && text && (hasHeartbeatOnOwnLine(text) || hasUnquotedMarker(text, NO_REPLY_MARKER))) {
    return <InjectedPill text={text} message={message} subagentStore={subagentStore} />;
  }

  type AssistantBlock = {
    key: string;
    node: React.ReactNode;
  };

  // Check if content array has structured thinking parts
  const hasThinkingParts = Array.isArray(message.content)
    && (message.content).some((p) => p.type === "thinking");

  // Force assistant container to fill max-width when a spawn tool is present
  const hasSpawnTool = !isUser && Array.isArray(message.content)
    && (message.content).some((p) => isToolCallPart(p) && p.name === SPAWN_TOOL_NAME);

  const assistantBlocks: AssistantBlock[] = [];
  const pushAssistantBlock = (key: string, node: React.ReactNode) => {
    assistantBlocks.push({ key, node });
  };

  if (!isUser) {
    if (message.reasoning && !hasThinkingParts) {
      pushAssistantBlock("reasoning", <ThinkingPill text={message.reasoning} />);
    }

    if (Array.isArray(message.content)) {
      const contentParts = message.content;
      contentParts.forEach((part, i) => {
        if (part.type === "thinking") {
          pushAssistantBlock(`thinking-${i}`, <ThinkingPill text={part.thinking || part.text || ""} />);
          return;
        }
        if (isToolCallPart(part)) {
          const isSpawn = part.name === SPAWN_TOOL_NAME;
          pushAssistantBlock(
            `tool-${i}`,
            (
              <ToolCallPill
                name={part.name || "tool"}
                args={typeof part.arguments === "string" ? part.arguments : part.arguments ? JSON.stringify(part.arguments) : undefined}
                status={part.status}
                result={part.result}
                resultError={part.resultError}
                toolCallId={part.toolCallId}
                subagentStore={isSpawn ? subagentStore : undefined}
                isPinned={isSpawn && !!part.toolCallId && part.toolCallId === pinnedToolCallId}
                onPin={isSpawn ? onPin : undefined}
                onUnpin={isSpawn ? onUnpin : undefined}
              />
            ),
          );
          return;
        }
        if (part.type === "text" && part.text) {
          const { thinking: extractedThinking, text: rawCleanText } = stripThinkTags(part.text);
          const cleanText = stripFinalTags(rawCleanText);
          const remainingParts = contentParts.slice(i + 1);
          const isLastText = !remainingParts.some((p) => p.type === "text" && p.text);
          // Hide cursor if tool call or thinking appears after this text
          const hasLaterNonText = remainingParts.some((p) => isToolCallPart(p) || p.type === "thinking");
          const showCursor = isStreaming && isLastText && !hasLaterNonText;

          if (extractedThinking && !hasThinkingParts && !message.reasoning) {
            pushAssistantBlock(`text-thinking-${i}`, <ThinkingPill text={extractedThinking} />);
          }
          if (cleanText) {
            pushAssistantBlock(
              `text-${i}`,
              <div className="text-sm leading-[1.75rem] break-words overflow-hidden text-foreground ml-[2px]">
                {showCursor ? (
                  <StreamingText text={cleanText} isStreaming={isStreaming} />
                ) : (
                  <MarkdownContent text={cleanText} />
                )}
              </div>,
            );
          }
          return;
        }
        if (part.type === "image" || part.type === "image_url") {
          pushAssistantBlock(`img-${i}`, <ImageThumbnails images={[part]} />);
        }
      });
    } else if (text) {
      const { thinking: extractedThinking, text: rawCleanText } = stripThinkTags(text);
      const cleanText = stripFinalTags(rawCleanText);
      if (extractedThinking && !hasThinkingParts && !message.reasoning) {
        pushAssistantBlock("fallback-thinking", <ThinkingPill text={extractedThinking} />);
      }
      if (cleanText) {
        pushAssistantBlock(
          "fallback-text",
          <div className="text-sm leading-[1.75rem] break-words overflow-hidden text-foreground ml-[2px]">
            {isStreaming ? (
              <StreamingText text={cleanText} isStreaming={isStreaming} />
            ) : (
              <MarkdownContent text={cleanText} />
            )}
          </div>,
        );
      }
    }
  }

  const zenCollapsible = !isUser && zenMode && zenGroupCollapsible;
  const streamingLayoutActive = isStreaming || freezeStreamingLayout;
  const renderAssistantBlock = (block: AssistantBlock) => (
    <React.Fragment key={block.key}>{block.node}</React.Fragment>
  );

  const effectiveZenSlideOpen = zenCollapsedByGroup ? zenGroupSlideOpen : zenGroupExpanded;
  const effectiveZenFadeVisible = zenCollapsedByGroup ? zenGroupFadeVisible : zenGroupExpanded;
  const collapsedZenSibling = !isUser && zenMode && zenCollapsedByGroup && !effectiveZenSlideOpen;

  return (
    <div
      ref={messageRef}
      data-message-role={message.role}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
      style={collapsedZenSibling ? { marginBottom: "-0.75rem", transition: `margin-bottom ${ZEN_SLIDE_MS}ms ease-out` } : { transition: `margin-bottom ${ZEN_SLIDE_MS}ms ease-out` }}
    >
      <div
        ref={isUser ? userBubbleRef : undefined}
        className={`max-w-[85%] md:max-w-[75%] min-w-0 ${isUser ? "px-4 py-2.5 text-primary-foreground" : ""} ${hasSpawnTool ? "w-[85%] md:w-[75%]" : ""}`}
        style={isUser ? {
          borderRadius: `${userRadius}px`,
          transition: isSentAnim ? undefined : "border-radius 300ms ease",
          background: "oklch(from var(--primary) l c h / 0.85)",
          border: "1px solid oklch(from var(--foreground) l c h / 0.12)",
          boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
          ...(isSentAnim ? {
            animation: MESSAGE_SEND_ANIMATION,
            transformOrigin: "bottom right",
          } : {}),
        } : undefined}
        onAnimationEnd={isSentAnim ? onSentAnimationEnd : undefined}
      >
        {isUser ? (
          <>
            {text && (
              <div className="text-sm leading-[1.75rem] break-words whitespace-pre-wrap">
                <UserTextWithQuotes text={text} />
              </div>
            )}
            <ImageThumbnails images={images} />
            <FileThumbnails files={files} />
          </>
        ) : (
          /* Single-pass rendering: all parts in content array order for correct chronology */
          <SmoothGrow active={streamingLayoutActive} className="flex flex-col gap-1.5">
            {zenCollapsible && (
              <div className="flex">
                <ZenToggle expanded={zenGroupExpanded} onClick={onZenGroupToggle} />
              </div>
            )}
            <SlideContent open={zenCollapsedByGroup ? effectiveZenSlideOpen : true}>
              <div
                className={`flex flex-col gap-1.5 ${zenCollapsedByGroup ? "transition-opacity ease-out" : ""}`}
                style={zenCollapsedByGroup
                  ? { opacity: effectiveZenFadeVisible ? 1 : 0, transitionDuration: `${ZEN_FADE_MS}ms` }
                  : undefined}
              >
                {assistantBlocks.map(renderAssistantBlock)}
              </div>
            </SlideContent>
          </SmoothGrow>
        )}
      </div>
    </div>
  );
}
