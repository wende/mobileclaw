"use client";

import { Bot, User } from "lucide-react";
import type { ChatMessage, MessageContent } from "@/lib/chat-types";
import { MarkdownRenderer } from "./markdown-renderer";
import { ToolCallBlock, ToolResultBlock } from "./tool-call-block";
import { ThinkingBlock } from "./thinking-block";

function getTextContent(content: MessageContent[] | string | null): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("");
}

function MessageAvatar({ role }: { role: string }) {
  if (role === "assistant") {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background">
        <Bot className="h-3.5 w-3.5 text-foreground" />
      </div>
    );
  }
  if (role === "user") {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground">
        <User className="h-3.5 w-3.5 text-background" />
      </div>
    );
  }
  return null;
}

function UserMessage({ message }: { message: ChatMessage }) {
  const text = getTextContent(message.content);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="max-w-[85%] md:max-w-[70%]">
        <div className="rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-background">
          <p className="text-[15px] leading-relaxed">{text}</p>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  isStreaming,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
}) {
  const contentBlocks = Array.isArray(message.content)
    ? message.content
    : [];
  const textContent = getTextContent(message.content);
  const hasToolCalls = contentBlocks.some((c) => c.type === "tool_call");

  return (
    <div className="flex gap-3">
      <div className="mt-0.5">
        <MessageAvatar role="assistant" />
      </div>
      <div className="min-w-0 flex-1 max-w-[85%] md:max-w-[75%]">
        {message.reasoning && (
          <ThinkingBlock reasoning={message.reasoning} />
        )}

        {contentBlocks.map((block, idx) => {
          if (block.type === "tool_call") {
            return (
              <ToolCallBlock
                key={`tool-${idx}`}
                name={block.name}
                args={block.arguments}
                status="success"
              />
            );
          }
          return null;
        })}

        {textContent && (
          <div className="relative">
            <MarkdownRenderer content={textContent} />
            {isStreaming && (
              <span className="inline-block ml-0.5 h-4 w-[2px] animate-pulse bg-foreground align-middle" />
            )}
          </div>
        )}

        {!textContent && !hasToolCalls && isStreaming && (
          <div className="flex items-center gap-1.5 py-2">
            <span
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </div>
        )}

        {message.usage && !isStreaming && (
          <div className="mt-2 flex items-center gap-3">
            <span className="font-mono text-[10px] text-muted-foreground/50">
              {message.usage.totalTokens} tokens
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolResultMessage({ message }: { message: ChatMessage }) {
  const content = Array.isArray(message.content) ? message.content : [];
  const toolResult = content.find((c) => c.type === "tool_result");
  if (!toolResult || toolResult.type !== "tool_result") return null;

  return (
    <div className="flex gap-3">
      <div className="w-7" />
      <div className="min-w-0 flex-1 max-w-[85%] md:max-w-[75%]">
        <ToolResultBlock
          name={toolResult.name}
          text={toolResult.text}
          isError={message.isError}
        />
      </div>
    </div>
  );
}

function SystemMessage({ message }: { message: ChatMessage }) {
  const text = getTextContent(message.content);
  return (
    <div className="flex justify-center">
      <span className="rounded-full bg-secondary px-3.5 py-1.5 text-xs text-muted-foreground">
        {text}
      </span>
    </div>
  );
}

export function MessageBubble({
  message,
  isStreaming,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
}) {
  switch (message.role) {
    case "user":
      return <UserMessage message={message} />;
    case "assistant":
      return (
        <AssistantMessage message={message} isStreaming={isStreaming} />
      );
    case "toolResult":
    case "tool_result":
      return <ToolResultMessage message={message} />;
    case "system":
      return <SystemMessage message={message} />;
    default:
      return null;
  }
}
