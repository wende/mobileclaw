"use client";

import React from "react";
import type { ContentPart, Message } from "@/types/chat";
import { getTextFromContent, getToolCalls, getImages, thinkingPreview } from "@/lib/messageUtils";
import { MarkdownContent } from "@/components/markdown/MarkdownContent";
import { StreamingText } from "@/components/StreamingText";
import { ToolCallPill } from "@/components/ToolCallPill";
import { ImageThumbnails } from "@/components/ImageThumbnails";

export function MessageRow({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
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
          /* Render content parts in array order so tool calls appear inline where they occurred */
          Array.isArray(message.content) ? message.content.map((part, i) => {
            if (part.type === "text" && part.text) {
              const isLastText = !(message.content as ContentPart[]).slice(i + 1).some((p) => p.type === "text" && p.text);
              return (
                <div key={`text-${i}`} className="text-sm leading-relaxed break-words overflow-hidden text-foreground">
                  {isStreaming && isLastText ? (
                    <StreamingText text={part.text} isStreaming={isStreaming} />
                  ) : (
                    <MarkdownContent text={part.text} />
                  )}
                </div>
              );
            }
            if (part.type === "tool_call" || part.type === "toolCall") {
              return (
                <ToolCallPill key={`tc-${part.name}-${i}`} name={part.name || "tool"} args={typeof part.arguments === "string" ? part.arguments : part.arguments ? JSON.stringify(part.arguments) : undefined} status={part.status as "running" | "success" | "error" | undefined} result={part.result} resultError={part.resultError} />
              );
            }
            if (part.type === "image" || part.type === "image_url") {
              return <ImageThumbnails key={`img-${i}`} images={[part]} />;
            }
            return null;
          }) : text ? (
            <div className="text-sm leading-relaxed break-words overflow-hidden text-foreground">
              {isStreaming ? (
                <StreamingText text={text} isStreaming={isStreaming} />
              ) : (
                <MarkdownContent text={text} />
              )}
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
