"use client";

import React, { useState, useEffect, useRef } from "react";
import type { ContentPart, Message } from "@/types/chat";
import { getTextFromContent, getImages, thinkingPreview } from "@/lib/messageUtils";
import { MarkdownContent } from "@/components/markdown/MarkdownContent";
import { StreamingText } from "@/components/StreamingText";
import { ToolCallPill } from "@/components/ToolCallPill";
import { ImageThumbnails } from "@/components/ImageThumbnails";

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

// ── ThinkingPill ─────────────────────────────────────────────────────────────

const BRAIN_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block shrink-0 opacity-50 mr-1.5 align-[-1px]">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
  </svg>
);

function ThinkingPill({ text }: { text: string }) {
  const [sentence, setSentence] = useState("");
  const [visible, setVisible] = useState(false);
  const lastSentenceRef = useRef("");
  const isEmpty = !text.trim();

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

  return (
    <details className="w-fit max-w-full rounded-lg border border-border bg-secondary group">
      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground list-none [&::-webkit-details-marker]:hidden">
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
        </div>
        {!isEmpty && sentence && (
          <div className="mt-1 max-w-[300px] overflow-hidden group-open:hidden">
            <div
              className="text-[11px] leading-tight text-muted-foreground/40 truncate font-normal transition-opacity duration-200"
              style={{ opacity: visible ? 1 : 0 }}
            >
              {sentence}
            </div>
          </div>
        )}
      </summary>
      {!isEmpty && (
        <p className="px-3 pb-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words overflow-hidden">
          {text}
        </p>
      )}
    </details>
  );
}

// ── MessageRow ───────────────────────────────────────────────────────────────

export function MessageRow({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  const text = getTextFromContent(message.content);
  const images = getImages(message.content);

  if (message.role === "toolResult" || message.role === "tool_result" || message.role === "tool") {
    return null;
  }

  // Context-enriched user messages — render as expandable pill in user bubble style
  if (message.isContext && text) {
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

  // Check if content array has structured thinking parts
  const hasThinkingParts = Array.isArray(message.content)
    && (message.content as ContentPart[]).some((p) => p.type === "thinking");

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`max-w-[85%] md:max-w-[75%] min-w-0 ${isUser ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground" : "flex flex-col gap-1.5"}`}>
        {isUser ? (
          <>
            {text && (
              <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                {text}
              </div>
            )}
            <ImageThumbnails images={images} />
          </>
        ) : (
          /* Single-pass rendering: all parts in content array order for correct chronology */
          <>
            {/* message.reasoning (from OpenClaw stream parser) renders first — it precedes tool calls */}
            {message.reasoning && !hasThinkingParts && <ThinkingPill text={message.reasoning} />}
            {Array.isArray(message.content) ? (message.content as ContentPart[]).map((part, i) => {
              if (part.type === "thinking") {
                return <ThinkingPill key={`thinking-${i}`} text={part.text || ""} />;
              }
              if (part.type === "tool_call" || part.type === "toolCall") {
                return <ToolCallPill key={`${part.name}-${i}`} name={part.name || "tool"} args={typeof part.arguments === "string" ? part.arguments : part.arguments ? JSON.stringify(part.arguments) : undefined} status={part.status as "running" | "success" | "error" | undefined} result={part.result} resultError={part.resultError} />;
              }
              if (part.type === "text" && part.text) {
                const { thinking: extractedThinking, text: cleanText } = stripThinkTags(part.text);
                const remainingParts = (message.content as ContentPart[]).slice(i + 1);
                const isLastText = !remainingParts.some((p) => p.type === "text" && p.text);
                // Hide cursor if tool call or thinking appears after this text
                const hasLaterNonText = remainingParts.some((p) => p.type === "tool_call" || p.type === "toolCall" || p.type === "thinking");
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
          </>
        )}
      </div>
    </div>
  );
}
