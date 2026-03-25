"use client";

import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from "react";
import { ALL_COMMANDS, type Command } from "@mc/components/CommandSheet";
import maps from "@mc/maps.json";
import { ImageLightbox } from "@mc/components/ImageLightbox";
import type { ModelChoice, ImageAttachment, InputAttachment } from "@mc/types/chat";
import { inputAttachmentRegistry } from "@mc/lib/plugins/inputAttachmentRegistry";
import { SQUIRCLE_RADIUS, PILL_BASE_HEIGHT, RADIUS_TRANSITION } from "@mc/lib/constants";

export interface ModelSuggestion {
  id: string;
  label: string;
  provider: string;
  description: string;
}

export interface ChatInputHandle {
  setValue: (v: string) => void;
  addInputAttachment: (kind: string, data: unknown) => void;
}

export const ChatInput = forwardRef<ChatInputHandle, {
  onSend: (text: string, attachments?: ImageAttachment[]) => void;
  scrollPhase?: "input" | "pill";
  onScrollToBottom?: () => void;
  disableScrollMorph?: boolean;
  availableModels?: ModelChoice[];
  modelsLoading?: boolean;
  onFetchModels?: () => void;
  backendMode?: "openclaw" | "lmstudio" | "demo";
  serverCommands?: Command[];
  attachments?: InputAttachment[];
  onAddFiles?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (index: number) => void;
  onClearAll?: () => void;
  isRunActive?: boolean;
  hasQueued?: boolean;
  onAbort?: () => void;
  lastUserMessage?: string;
  uploadDisabled?: boolean;
}>(function ChatInput({
  onSend,
  scrollPhase = "input",
  onScrollToBottom,
  disableScrollMorph = true,
  availableModels = [],
  modelsLoading = false,
  onFetchModels,
  backendMode = "openclaw",
  serverCommands = [],
  attachments = [],
  onAddFiles,
  onRemoveAttachment,
  onClearAll,
  isRunActive = false,
  hasQueued = false,
  onAbort,
  lastUserMessage = "",
  uploadDisabled = false,
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
    addInputAttachment: () => {},
  }), []);

  // Restore draft from localStorage after hydration to avoid mismatch
  useEffect(() => {
    const draft = localStorage.getItem("chatInputDraft");
    if (draft) setValue(draft);
  }, []);

  // ── Attachments ─────────────────────────────────────────────────────────────
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detect mobile: SVG feImage data URIs + feDisplacementMap don't work
  // on mobile browsers (WebKit/Blink), so we fall back to CSS-only glass.
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  useEffect(() => {
    setIsMobileDevice(
      navigator.maxTouchPoints > 0 && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    );
  }, []);

  // Measure pill element so feImage covers its full width
  const glassPillRef = useRef<HTMLDivElement>(null);
  const [filterDims, setFilterDims] = useState({ w: 200, h: 46 });
  useEffect(() => {
    const el = glassPillRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setFilterDims({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Generate displacement + specular maps at exact element dimensions.
  // Static maps.json maps are 200×46 — stretching them to actual width distorts the corner radius.
  // Corner radius: full pill when at base height, squircle when expanded
  const cornerRadius = filterDims.h > PILL_BASE_HEIGHT ? SQUIRCLE_RADIUS : Math.floor(filterDims.h / 2);

  const [displacementSrc, setDisplacementSrc] = useState<string>(maps.displacement);
  const [specularSrc, setSpecularSrc] = useState<string>(maps.specular);
  useEffect(() => {
    const w = filterDims.w, h = filterDims.h, r = cornerRadius;
    if (!w || !h) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    const px = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Cylindrical lens: X displacement in caps, no Y displacement anywhere.
        // dy=0 everywhere prevents the top-leans-back / bottom-leans-forward slant.
        let dx = 0;
        if (x < r) {
          dx = x - r;        // -r..−1: left cap curves inward
        } else if (x >= w - r) {
          dx = x - (w - r);  // 0..r−1: right cap curves outward
        }
        const rv = Math.round(((dx / r) * 0.5 + 0.5) * 255);
        const i = (y * w + x) * 4;
        px[i] = rv; px[i + 1] = 128; px[i + 2] = 128; px[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    setDisplacementSrc(canvas.toDataURL("image/png"));

    // Specular SVG: rx must match the CSS border-radius (r = h/2), not the static 200×46 value.
    const rx = r - 0.5;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.45"/><stop offset="20%" stop-color="#ffffff" stop-opacity="0"/><stop offset="80%" stop-color="#ffffff" stop-opacity="0"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0.12"/></linearGradient></defs><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="none" stroke="url(#s)" stroke-width="1.5" opacity="0.8"/></svg>`;
    setSpecularSrc("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
  }, [filterDims.w, filterDims.h, cornerRadius]);

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

  // Merge core + server commands for autocomplete
  const allCommands = useMemo(
    () => [...ALL_COMMANDS, ...serverCommands],
    [serverCommands]
  );

  // Compute matching commands when value starts with /
  const commandSuggestions = (() => {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith("/") || trimmed.includes(" ")) return [];
    const prefix = trimmed.toLowerCase();
    return allCommands.filter(
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
    if (!t && attachments.length === 0) return;

    // Collect send contributions from all attachment plugins
    const allImages: ImageAttachment[] = [];
    const textPrefixes: string[] = [];
    for (const att of attachments) {
      const plugin = inputAttachmentRegistry.get(att.kind);
      if (!plugin) continue;
      const contribution = plugin.toSendContribution(att.data);
      if (contribution.textPrefix) textPrefixes.push(contribution.textPrefix);
      if (contribution.images) allImages.push(...contribution.images);
    }

    const prefix = textPrefixes.join("\n\n");
    const full = prefix ? (t ? `${prefix}\n\n\n${t}` : prefix) : t;
    onSend(full, allImages.length > 0 ? allImages : undefined);
    setValue("");
    onClearAll?.();
    if (ref.current) ref.current.style.height = "auto";
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || el.offsetWidth === 0) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value, filterDims.w]);

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

  const isPill = !disableScrollMorph && scrollPhase === "pill";
  const hasContent = !!value.trim() || attachments.length > 0;
  const staticComposer = disableScrollMorph;
  const composerBackground = isPill
    ? "oklch(from var(--background) l c h / 0.30)"
    : "oklch(from var(--background) l c h / 0.30)";
  const composerBackdrop = isPill
    ? (isMobileDevice ? "blur(12px) saturate(1.8)" : 'url("#filter_liquidGlassPill")')
    : "none";

  // maps.json is generated by gen_maps.py:
  //   displacement — PNG normal map (R=X, G=Y surface normals for a pill-shaped lens)
  //   specular     — SVG rim highlight (stroke-only gradient along pill edge)
  const { w: fw, h: fh } = filterDims;

  return (
    <div
      className="relative"
      style={disableScrollMorph ? ({ ["--sp"]: 0, ["--lp"]: 0 } as React.CSSProperties) : undefined}
    >
      {/* SVG Filters for Liquid Glass */}
      <svg width="0" height="0" className="absolute pointer-events-none">
        <defs>
          <filter id="filter_liquidGlassPill" x="-10%" y="-20%" width="120%" height="140%" colorInterpolationFilters="sRGB">
            {/* Slight blur of the backdrop — frosted quality */}
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            {/* Physics-based lens normal map (separate R=X, G=Y channels), scaled to element size */}
            <feImage href={displacementSrc} result="displacementMap" x="0" y="0" width={fw} height={fh} preserveAspectRatio="none" />
            {/* Warp the blurred backdrop using the normal map */}
            <feDisplacementMap in="blur" in2="displacementMap" xChannelSelector="R" yChannelSelector="G" scale="20" result="displaced" />
            {/* Boost color saturation — glass concentrates and enriches refracted colors */}
            <feColorMatrix type="saturate" values="6" in="displaced" result="saturated" />
            {/* Rim highlight: stroke-only gradient along pill edge, scaled to element size */}
            <feImage href={specularSrc} result="specularMap" x="0" y="0" width={fw} height={fh} preserveAspectRatio="none" />
            {/* Clip the saturated colors to the specular rim (glass is thickest at edges) */}
            <feComposite in="saturated" in2="specularMap" operator="in" result="clippedSaturation" />
            {/* Fade the specular highlight layer to 40% so it doesn't overpower */}
            <feComponentTransfer in="specularMap" result="fadedSpecular">
              <feFuncA type="linear" slope="0.4" />
            </feComponentTransfer>
            {/* Layer 1: vivid rim refraction over warped backdrop */}
            <feBlend mode="normal" in="clippedSaturation" in2="displaced" result="blend1" />
            {/* Layer 2: soft white specular glint on top */}
            <feBlend mode="normal" in="fadedSpecular" in2="blend1" result="blend2" />
          </filter>
        </defs>
      </svg>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onAddFiles?.(e.target.files);
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
                    <span className="truncate text-xs text-muted-foreground">
                      {model.description}
                    </span>
                  </div>
                  <span className="shrink-0 rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
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
        style={{ gap: staticComposer ? 8 : "calc(8px * (1 - var(--lp, 0)))" } as React.CSSProperties}
      >
      {/* Image picker button — fades & collapses */}
      <button
        type="button"
        onClick={uploadDisabled ? undefined : () => fileInputRef.current?.click()}
        className={`mb-1 flex shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-[opacity] duration-200 overflow-hidden${uploadDisabled ? " opacity-30 cursor-not-allowed" : " hover:bg-accent hover:text-foreground"}`}
        style={{
          opacity: uploadDisabled ? 0.3 : (staticComposer ? 1 : "max(0, 1 - var(--sp, 0) * 2.5)"),
          width: staticComposer ? 40 : "calc(40px * (1 - var(--lp, 0)))",
          height: staticComposer ? 40 : "calc(40px * (1 - var(--lp, 0)))",
          minWidth: 0,
          pointerEvents: isPill ? "none" : "auto",
        } as React.CSSProperties}
        aria-label="Attach file"
        disabled={uploadDisabled}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>

      {/* Morphing center: textarea ↔ scroll-to-bottom pill */}
      <div
        ref={glassPillRef}
        className={`relative flex-1 overflow-hidden outline-none`}
        onClick={isPill ? onScrollToBottom : undefined}
        role={isPill ? "button" : undefined}
        tabIndex={isPill ? 0 : undefined}
        onKeyDown={isPill ? (e: React.KeyboardEvent) => { if (e.key === "Enter") onScrollToBottom?.(); } : undefined}
        style={{
          minHeight: staticComposer ? PILL_BASE_HEIGHT + 2 : `calc(${PILL_BASE_HEIGHT}px + 2px * var(--lp, 0))`,
          maxHeight: staticComposer ? 200 : `calc(200px - ${200 - (PILL_BASE_HEIGHT + 2)}px * var(--lp, 0))`,
          borderRadius: `${cornerRadius}px`,
          transition: staticComposer ? "none" : RADIUS_TRANSITION,
          cursor: isPill ? "pointer" : "text",
          background: composerBackground,
          backdropFilter: composerBackdrop,
          WebkitBackdropFilter: composerBackdrop,
          border: "1px solid oklch(from var(--foreground) l c h / 0.15)",
          boxShadow: "0 2px 4px rgba(49, 49, 49,0.08)",
        } as React.CSSProperties}
      >
        {/* Unified attachment preview strip — delegates to registry */}
        {attachments.length > 0 && !isPill && (
          <div
            className="flex gap-1.5 overflow-x-auto px-3 pt-2.5 pb-1 scrollbar-hide"
            style={{
              opacity: staticComposer ? 1 : "calc(1 - var(--sp, 0))",
              pointerEvents: isPill ? "none" : "auto",
            } as React.CSSProperties}
          >
            {attachments.map((att, i) => {
              const plugin = inputAttachmentRegistry.get(att.kind);
              if (!plugin) return null;
              return (
                <React.Fragment key={`${att.kind}-${i}`}>
                  {plugin.renderPreview({
                    data: att.data,
                    onRemove: () => onRemoveAttachment?.(i),
                    onLightbox: setLightboxSrc,
                  })}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Pill overlay */}
        {!staticComposer && (
          <div
            className="absolute inset-0 box-border flex items-center justify-center gap-2 px-4 py-2.5 whitespace-nowrap text-xs leading-[1.75rem] font-normal"
            style={{
              opacity: "var(--sp, 0)",
              pointerEvents: isPill ? "auto" : "none",
              color: "var(--foreground)",
              willChange: "opacity",
            } as React.CSSProperties}
          >
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center leading-none"
              aria-hidden="true"
              style={{ textShadow: "0 0 8px var(--background)", fontSize: "14px", fontWeight: 600 } as React.CSSProperties}
            >
              ↓
            </span>
            <span style={{ textShadow: "0 0 8px var(--background)" } as React.CSSProperties}>Scroll to bottom</span>
          </div>
        )}

        {/* Textarea */}
        <div
          className="px-4 py-2.5 flex items-center"
          style={{
            opacity: staticComposer ? 1 : "calc(1 - var(--sp, 0))",
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
                .filter((item) => item.kind === "file")
                .map((item) => item.getAsFile())
                .filter((f): f is File => f !== null);
              if (files.length > 0) {
                e.preventDefault();
                onAddFiles?.(files);
              }
            }}
            placeholder={isRunActive ? (hasQueued ? "Replace queued message..." : "Queue a message...") : "Send a message..."}
            rows={1}
            className="block w-full resize-none overflow-hidden bg-transparent text-sm leading-[1.75rem] text-foreground placeholder:text-muted-foreground focus:outline-none"
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
            className="mb-1 relative shrink-0 rounded-full overflow-hidden active:scale-85"
            style={{
              opacity: staticComposer
                ? ((isActive && !queueFull) ? 1 : 0.3)
                : ((isActive && !queueFull)
                  ? "max(0, 1 - var(--sp, 0) * 2.5)"
                  : "max(0, (1 - var(--sp, 0) * 2.5) * 0.3)"),
              width: staticComposer ? 40 : "calc(40px * (1 - var(--sp, 0)))",
              height: staticComposer ? 40 : "calc(40px * (1 - var(--sp, 0)))",
              minWidth: 0,
              pointerEvents: isPill ? "none" : "auto",
              transition: staticComposer ? "transform 200ms" : ((isActive && !queueFull) ? "opacity 200ms, transform 200ms" : "transform 200ms"),
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
            {/* Send face — catch-all default; transition suppressed when disabled so it doesn't flash */}
            <span
              className="absolute inset-0 flex items-center justify-center bg-primary text-primary-foreground rounded-full"
              style={{ opacity: (!showStop && !showQueue) ? 1 : 0, transition: isActive ? "opacity 200ms" : "none" }}
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
