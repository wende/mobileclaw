"use client";

import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { ALL_COMMANDS, type Command } from "@/components/CommandSheet";
import { ImageLightbox } from "@/components/ImageLightbox";
import type { ModelChoice, ImageAttachment } from "@/types/chat";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export interface ModelSuggestion {
  id: string;
  label: string;
  provider: string;
  description: string;
}

export interface ChatInputHandle {
  setValue: (v: string) => void;
}

export const ChatInput = forwardRef<ChatInputHandle, {
  onSend: (text: string, attachments?: ImageAttachment[]) => void;
  scrollPhase?: "input" | "pill";
  onScrollToBottom?: () => void;
  availableModels?: ModelChoice[];
  modelsLoading?: boolean;
  onFetchModels?: () => void;
  backendMode?: "openclaw" | "lmstudio" | "demo";
  quoteText?: string | null;
  onClearQuote?: () => void;
  isRunActive?: boolean;
  hasQueued?: boolean;
  onAbort?: () => void;
  lastUserMessage?: string;
}>(function ChatInput({
  onSend,
  scrollPhase = "input",
  onScrollToBottom,
  availableModels = [],
  modelsLoading = false,
  onFetchModels,
  backendMode = "openclaw",
  quoteText = null,
  onClearQuote,
  isRunActive = false,
  hasQueued = false,
  onAbort,
  lastUserMessage = "",
}, forwardedRef) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(forwardedRef, () => ({
    setValue: (v: string) => {
      setValue(v);
      setTimeout(() => ref.current?.focus(), 0);
    },
  }), []);

  // Restore draft from localStorage after hydration to avoid mismatch
  useEffect(() => {
    const draft = localStorage.getItem("chatInputDraft");
    if (draft) setValue(draft);
  }, []);

  // ── Image attachments ──────────────────────────────────────────────────────
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      if (file.size > MAX_FILE_SIZE) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        const previewUrl = URL.createObjectURL(file);
        setAttachments((prev) => [
          ...prev,
          { mimeType: file.type, fileName: file.name, content: base64, previewUrl },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist draft to localStorage
  useEffect(() => {
    localStorage.setItem("chatInputDraft", value);
  }, [value]);

  // Global keydown: focus textarea and type when pressing a printable key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement === ref.current) return;
      // Skip if focus is on another input/textarea/contenteditable
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement)?.isContentEditable) return;
      // Skip modifier combos (except Shift which produces characters)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Only single printable characters
      if (e.key.length !== 1) return;
      e.preventDefault();
      setValue((v) => v + e.key);
      ref.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
    if (!t && !quoteText && attachments.length === 0) return;
    const quoted = quoteText
      ? quoteText.split("\n").map((l) => `> ${l}`).join("\n")
      : "";
    const full = quoted ? (t ? `${quoted}\n\n\n${t}` : quoted) : t;
    onSend(full, attachments.length > 0 ? attachments : undefined);
    setValue("");
    setAttachments([]);
    onClearQuote?.();
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
      // ArrowUp with empty input recalls the last sent message
      if (e.key === "ArrowUp" && !value && lastUserMessage) {
        e.preventDefault();
        setValue(lastUserMessage);
        return;
      }
      // On mobile/touch devices, Enter inserts a newline — only the send button submits.
      // On desktop, Enter submits (Shift+Enter for newline).
      const isMobile = navigator.maxTouchPoints > 0 && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      if (e.key === "Enter" && !e.shiftKey && !isMobile) {
        e.preventDefault();
        submit();
      }
    }
  };

  const isPill = scrollPhase === "pill";
  const hasContent = !!value.trim() || attachments.length > 0;

  return (
    <div className="relative">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />

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
                  No models match &quot;{modelSearchTerm}&quot;
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
      {/* Image picker button — fades & collapses */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="mb-1 flex shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-[opacity] duration-200 hover:bg-accent hover:text-foreground overflow-hidden"
        style={{
          opacity: "max(0, 1 - var(--sp, 0) * 2.5)",
          width: "calc(40px * (1 - var(--sp, 0)))",
          height: "calc(40px * (1 - var(--sp, 0)))",
          minWidth: 0,
          pointerEvents: isPill ? "none" : "auto",
        } as React.CSSProperties}
        aria-label="Attach image"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
      </button>

      {/* Morphing center: textarea ↔ scroll-to-bottom pill */}
      <div
        className="relative flex-1 overflow-hidden rounded-2xl border border-border/50 shadow-sm backdrop-blur-sm transition-colors outline-none"
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
        {/* Attachment preview strip */}
        {attachments.length > 0 && !isPill && (
          <div
            className="flex gap-1.5 overflow-x-auto px-3 pt-2.5 pb-1 scrollbar-hide"
            style={{
              opacity: "calc(1 - var(--sp, 0))",
              pointerEvents: isPill ? "none" : "auto",
            } as React.CSSProperties}
          >
            {attachments.map((att, i) => (
              <div key={att.previewUrl} className="relative shrink-0 h-10 w-10 rounded-lg overflow-hidden border border-border bg-secondary">
                <img
                  src={att.previewUrl}
                  alt={att.fileName}
                  className="h-full w-full object-cover cursor-pointer"
                  onClick={() => setLightboxSrc(att.previewUrl)}
                />
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Quote preview */}
        {quoteText && !isPill && (
          <div
            className="flex items-center gap-2 border-b border-border/30 px-4 py-1.5"
            style={{
              opacity: "calc(1 - var(--sp, 0))",
              pointerEvents: isPill ? "none" : "auto",
            } as React.CSSProperties}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/60">
              <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
              <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
            </svg>
            <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">
              {quoteText}
            </span>
            <button
              type="button"
              onClick={onClearQuote}
              className="shrink-0 rounded-full p-0.5 text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        )}

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
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.items)
                .filter((item) => item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((f): f is File => f !== null);
              if (files.length > 0) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            placeholder={isRunActive ? (hasQueued ? "Replace queued message..." : "Queue a message...") : "Send a message..."}
            rows={1}
            className="block w-full resize-none bg-transparent text-base md:text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      {/* Send / Stop / Queue button — crossfade between three states */}
      {(() => {
        const showStop = isRunActive && !hasContent;
        const showQueue = isRunActive && hasContent && !hasQueued;
        const queueFull = isRunActive && hasContent && hasQueued;
        const showSend = !isRunActive && hasContent;
        const isActive = showStop || showQueue || showSend;
        return (
          <button
            type="button"
            onClick={isPill ? onScrollToBottom : showStop ? onAbort : submit}
            disabled={(!isActive || queueFull) && !isPill}
            className="mb-1 relative shrink-0 rounded-full overflow-hidden transition-[opacity] duration-200"
            style={{
              opacity: (isActive && !queueFull)
                ? "max(0, 1 - var(--sp, 0) * 2.5)"
                : "max(0, (1 - var(--sp, 0) * 2.5) * 0.3)",
              width: "calc(40px * (1 - var(--sp, 0)))",
              height: "calc(40px * (1 - var(--sp, 0)))",
              minWidth: 0,
              pointerEvents: isPill ? "none" : "auto",
            } as React.CSSProperties}
            aria-label={showStop ? "Stop" : showQueue ? "Queue" : "Send"}
          >
            {/* Stop face */}
            <span
              className="absolute inset-0 flex items-center justify-center border border-destructive/30 bg-destructive/5 text-destructive/60 rounded-full transition-opacity duration-200"
              style={{ opacity: showStop ? 1 : 0, pointerEvents: showStop ? "auto" : "none" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
            </span>
            {/* Queue face — append icon */}
            <span
              className="absolute inset-0 flex items-center justify-center border border-border bg-secondary text-muted-foreground rounded-full transition-opacity duration-200"
              style={{ opacity: showQueue ? 1 : 0, pointerEvents: showQueue ? "auto" : "none" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4v12a2 2 0 0 0 2 2h8" /><path d="m16 14 4 4-4 4" /></svg>
            </span>
            {/* Send face — also serves as default/disabled state */}
            <span
              className="absolute inset-0 flex items-center justify-center bg-primary text-primary-foreground rounded-full transition-opacity duration-200"
              style={{ opacity: (!showStop && !showQueue) ? 1 : 0 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>
            </span>
          </button>
        );
      })()}
      </div>
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
});
