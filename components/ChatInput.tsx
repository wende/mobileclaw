"use client";

import React, { useState, useRef, useEffect } from "react";
import { ALL_COMMANDS, type Command } from "@/components/CommandSheet";

export function ChatInput({
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
        className="mb-1 flex shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground overflow-hidden"
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
        className="relative flex-1 overflow-hidden rounded-2xl border border-border/50 shadow-lg backdrop-blur-sm transition-colors outline-none"
        onClick={isPill ? onScrollToBottom : undefined}
        role={isPill ? "button" : undefined}
        tabIndex={isPill ? 0 : undefined}
        onKeyDown={isPill ? (e: React.KeyboardEvent) => { if (e.key === "Enter") onScrollToBottom?.(); } : undefined}
        style={{
          minHeight: "calc(46px - 6px * var(--sp, 0))",
          maxHeight: "calc(200px - 160px * var(--sp, 0))",
          cursor: isPill ? "pointer" : "text",
          background: "oklch(from var(--card) l c h / calc(0.9 - 0.5 * var(--sp, 0)))",
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
          className="px-4 py-2.5 flex items-center"
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
        className="mb-1 flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:opacity-80 overflow-hidden"
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
