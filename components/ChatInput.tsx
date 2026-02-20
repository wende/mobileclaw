"use client";

import React, { useState, useRef, useEffect } from "react";
import { ALL_COMMANDS, type Command } from "@/components/CommandSheet";
import type { ModelChoice } from "@/types/chat";

export interface ModelSuggestion {
  id: string;
  label: string;
  provider: string;
  description: string;
}

export function ChatInput({
  onSend,
  onOpenCommands,
  commandValue,
  onCommandValueUsed,
  scrollPhase = "input",
  onScrollToBottom,
  availableModels = [],
  modelsLoading = false,
  onFetchModels,
  backendMode = "openclaw",
}: {
  onSend: (text: string) => void;
  onOpenCommands: () => void;
  commandValue: string | null;
  onCommandValueUsed: () => void;
  scrollPhase?: "input" | "pill";
  onScrollToBottom?: () => void;
  availableModels?: ModelChoice[];
  modelsLoading?: boolean;
  onFetchModels?: () => void;
  backendMode?: "openclaw" | "lmstudio" | "demo";
}) {
  const [value, setValue] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("chatInputDraft") ?? "";
    }
    return "";
  });
  const ref = useRef<HTMLTextAreaElement>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Persist draft to localStorage
  useEffect(() => {
    localStorage.setItem("chatInputDraft", value);
  }, [value]);

  // When a command is selected, fill it in
  useEffect(() => {
    if (commandValue) {
      setValue(commandValue);
      onCommandValueUsed();
      setTimeout(() => ref.current?.focus(), 100);
    }
  }, [commandValue, onCommandValueUsed]);

  // Detect if we're in model selection mode (/model or /models followed by space)
  const modelCommandMatch = value.trimStart().match(/^\/models?\s+(.*)$/i);
  const isModelMode = !!modelCommandMatch;
  const modelSearchTerm = modelCommandMatch?.[1]?.toLowerCase() || "";

  // Fetch models when entering model mode (only for OpenClaw)
  useEffect(() => {
    if (isModelMode && backendMode === "openclaw" && availableModels.length === 0 && !modelsLoading) {
      onFetchModels?.();
    }
  }, [isModelMode, backendMode, availableModels.length, modelsLoading, onFetchModels]);

  // Convert models to suggestion format with filtering
  const modelSuggestions: ModelSuggestion[] = isModelMode
    ? availableModels
        .filter((m) => {
          if (!modelSearchTerm) return true;
          return (
            m.id.toLowerCase().includes(modelSearchTerm) ||
            m.name.toLowerCase().includes(modelSearchTerm) ||
            m.provider.toLowerCase().includes(modelSearchTerm)
          );
        })
        .map((m) => ({
          id: m.id,
          label: m.name,
          provider: m.provider,
          description: m.contextWindow
            ? `${m.provider} · ${Math.round(m.contextWindow / 1000)}k context${m.reasoning ? " · reasoning" : ""}`
            : m.provider,
        }))
        .slice(0, 10)
    : [];

  // Compute matching commands when value starts with /
  const commandSuggestions = (() => {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith("/") || trimmed.includes(" ")) return [];
    const prefix = trimmed.toLowerCase();
    return ALL_COMMANDS.filter(
      (cmd) =>
        cmd.name.toLowerCase().startsWith(prefix) ||
        cmd.aliases?.some((a) => a.toLowerCase().startsWith(prefix))
    ).slice(0, 8);
  })();

  const showModelSuggestions = isModelMode && (modelSuggestions.length > 0 || modelsLoading);
  const showCommandSuggestions = !isModelMode && commandSuggestions.length > 0;
  const showSuggestions = showModelSuggestions || showCommandSuggestions;

  // Total items for navigation
  const totalSuggestions = showModelSuggestions ? modelSuggestions.length : commandSuggestions.length;

  // Reset selection when suggestions change
  // Model suggestions start unselected (-1) so Enter submits "/model" as-is
  // Command suggestions start at 0 for quick Tab completion
  useEffect(() => {
    setSelectedIdx(showModelSuggestions ? -1 : 0);
  }, [totalSuggestions, value, showModelSuggestions]);

  // Scroll selected item into view
  useEffect(() => {
    if (showSuggestions && suggestionsRef.current) {
      const item = suggestionsRef.current.children[selectedIdx] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIdx, showSuggestions]);

  const acceptCommandSuggestion = (cmd: Command) => {
    setValue(cmd.name + " ");
    setTimeout(() => ref.current?.focus(), 0);
  };

  const acceptModelSuggestion = (model: ModelSuggestion) => {
    setValue(`/model ${model.id} `);
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
        // Start from first item if nothing selected, otherwise go up (wrap to end)
        setSelectedIdx((prev) => (prev <= 0 ? totalSuggestions - 1 : prev - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        // Start from first item if nothing selected, otherwise go down (wrap to start)
        setSelectedIdx((prev) => (prev < 0 || prev >= totalSuggestions - 1 ? 0 : prev + 1));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (selectedIdx >= 0) {
          if (showModelSuggestions && modelSuggestions[selectedIdx]) {
            acceptModelSuggestion(modelSuggestions[selectedIdx]);
          } else if (showCommandSuggestions && commandSuggestions[selectedIdx]) {
            acceptCommandSuggestion(commandSuggestions[selectedIdx]);
          }
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // For model suggestions: only accept if explicitly selected, otherwise submit as-is
        // For command suggestions: always accept the selected one (starts at 0)
        if (showModelSuggestions) {
          if (selectedIdx >= 0 && modelSuggestions[selectedIdx]) {
            acceptModelSuggestion(modelSuggestions[selectedIdx]);
          } else {
            submit();
          }
        } else if (showCommandSuggestions && commandSuggestions[selectedIdx]) {
          acceptCommandSuggestion(commandSuggestions[selectedIdx]);
        }
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
      {/* Autocomplete suggestions — positioned above the input bar */}
      {showSuggestions && !isPill && (
        <div
          ref={suggestionsRef}
          className="absolute bottom-full left-0 right-0 mb-1.5 max-h-[280px] overflow-y-auto rounded-xl border border-border bg-card shadow-lg z-50"
        >
          {/* Model suggestions */}
          {showModelSuggestions && (
            <>
              {modelsLoading && modelSuggestions.length === 0 && (
                <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Loading models...
                </div>
              )}
              {modelSuggestions.map((model, i) => (
                <button
                  key={model.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    acceptModelSuggestion(model);
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    i === selectedIdx ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {model.label}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {model.description}
                    </span>
                  </div>
                  <span className="shrink-0 rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {model.id}
                  </span>
                </button>
              ))}
              {!modelsLoading && modelSuggestions.length === 0 && availableModels.length > 0 && (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  No models match "{modelSearchTerm}"
                </div>
              )}
              {!modelsLoading && availableModels.length === 0 && backendMode !== "openclaw" && (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  Model selection is only available in OpenClaw mode
                </div>
              )}
            </>
          )}
          {/* Command suggestions */}
          {showCommandSuggestions && commandSuggestions.map((cmd, i) => (
            <button
              key={cmd.name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                acceptCommandSuggestion(cmd);
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
