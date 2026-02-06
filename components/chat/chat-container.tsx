"use client";

import { useEffect, useRef } from "react";
import { useChatStream } from "@/hooks/use-chat-stream";
import { MessageBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import { Bot } from "lucide-react";

export function ChatContainer() {
  const {
    messages,
    isStreaming,
    streamingMessageId,
    sendMessage,
    stopStreaming,
  } = useChatStream();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl md:px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card">
          <Bot className="h-4 w-4 text-foreground" />
        </div>
        <div className="flex flex-col">
          <h1 className="text-sm font-semibold text-foreground">OpenClaw</h1>
          <p className="text-[11px] text-muted-foreground">
            {isStreaming ? "Thinking..." : "Online"}
          </p>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 md:px-6">
          {messages.map((message, idx) => (
            <div
              key={message.id ?? idx}
              className="animate-in fade-in slide-in-from-bottom-2 duration-300"
              style={{ animationDelay: `${Math.min(idx * 50, 300)}ms`, animationFillMode: "both" }}
            >
              <MessageBubble
                message={message}
                isStreaming={
                  isStreaming && message.id === streamingMessageId
                }
              />
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="sticky bottom-0 border-t border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-2xl px-4 py-3 md:px-6 md:py-4">
          <ChatInput
            onSend={sendMessage}
            onStop={stopStreaming}
            isStreaming={isStreaming}
          />
          <p className="mt-2 text-center text-[10px] text-muted-foreground/50">
            OpenClaw may produce inaccurate information.
          </p>
        </div>
      </div>
    </div>
  );
}
