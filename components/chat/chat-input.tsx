"use client";

import React from "react"

import { useState, useRef, useCallback } from "react";
import { ArrowUp, Square } from "lucide-react";

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  disabled,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) return;
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  };

  return (
    <div className="relative flex w-full items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm transition-shadow focus-within:shadow-md focus-within:border-ring/30">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Send a message..."
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
        style={{ maxHeight: "200px" }}
      />
      {isStreaming ? (
        <button
          onClick={onStop}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-all hover:opacity-80 active:scale-95"
          aria-label="Stop generating"
          type="button"
        >
          <Square className="h-3 w-3 fill-current" />
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-all hover:opacity-80 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Send message"
          type="button"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
