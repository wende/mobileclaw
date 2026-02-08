"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ConnectionConfig } from "@/types/chat";
import { fetchLmStudioModels, type LmStudioModel } from "@/lib/lmStudio";

export function SetupDialog({
  onConnect,
  onClose,
  visible,
  connectionError,
  isDemoMode,
}: {
  onConnect: (config: ConnectionConfig) => void;
  onClose?: () => void;
  visible: boolean;
  connectionError?: string | null;
  isDemoMode?: boolean;
}) {
  const [mode, setMode] = useState<"openclaw" | "lmstudio">("openclaw");
  const [url, setUrl] = useState("ws://127.0.0.1:18789");
  const [token, setToken] = useState("");
  const [lmsUrl, setLmsUrl] = useState("http://127.0.0.1:1234");
  const [lmsApiKey, setLmsApiKey] = useState("");
  const [lmsModel, setLmsModel] = useState("");
  const [lmsModels, setLmsModels] = useState<LmStudioModel[]>([]);
  const [lmsModelLoading, setLmsModelLoading] = useState(false);
  const [lmsModelError, setLmsModelError] = useState("");
  const [error, setError] = useState("");
  // Local submit state — only true after user clicks Connect, never affected
  // by background reconnection.  Resets when the dialog opens or on error.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phase, setPhase] = useState<"idle" | "entering" | "open" | "closing" | "closed">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset phase when dialog becomes visible again
  useEffect(() => {
    if (visible && (phase === "closed" || phase === "idle")) {
      setIsSubmitting(false);
      // Pre-fill from localStorage if available
      const savedMode = window.localStorage.getItem("mobileclaw-mode") as "openclaw" | "lmstudio" | null;
      if (savedMode === "openclaw" || savedMode === "lmstudio") setMode(savedMode);
      const savedUrl = window.localStorage.getItem("openclaw-url");
      const savedToken = window.localStorage.getItem("openclaw-token");
      if (savedUrl) setUrl(savedUrl);
      if (savedToken) setToken(savedToken);
      const savedLmsUrl = window.localStorage.getItem("lmstudio-url");
      const savedLmsApiKey = window.localStorage.getItem("lmstudio-apikey");
      const savedLmsModel = window.localStorage.getItem("lmstudio-model");
      if (savedLmsUrl) setLmsUrl(savedLmsUrl);
      if (savedLmsApiKey) setLmsApiKey(savedLmsApiKey);
      if (savedLmsModel) setLmsModel(savedLmsModel);
      setError("");
      setLmsModelError("");
      requestAnimationFrame(() => {
        setPhase("entering");
        requestAnimationFrame(() => setPhase("open"));
      });
    }
    if (!visible && phase === "open") {
      setPhase("closing");
      setTimeout(() => setPhase("closed"), 500);
    }
  }, [visible]);

  // Reset submitting state on connection error
  useEffect(() => {
    if (connectionError) setIsSubmitting(false);
  }, [connectionError]);

  // Focus input once open
  useEffect(() => {
    if (phase === "open") {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [phase]);

  // Fetch LM Studio models when URL changes and mode is lmstudio
  const fetchModels = useCallback(async (baseUrl: string, apiKey?: string) => {
    const trimmed = baseUrl.trim();
    if (!trimmed) return;
    setLmsModelLoading(true);
    setLmsModelError("");
    try {
      const models = await fetchLmStudioModels(trimmed, apiKey || undefined);
      setLmsModels(models);
      // Auto-select first model if none selected
      if (models.length > 0 && !lmsModel) {
        setLmsModel(models[0].id);
      }
    } catch (err) {
      setLmsModelError((err as Error).message || "Cannot reach server");
      setLmsModels([]);
    } finally {
      setLmsModelLoading(false);
    }
  }, [lmsModel]);

  const handleSubmit = () => {
    if (mode === "openclaw") {
      const trimmed = url.trim();
      // Allow empty URL for mock mode
      if (trimmed) {
        try {
          new URL(trimmed);
        } catch {
          setError("Please enter a valid URL or leave empty for demo mode");
          return;
        }
      }
      setError("");
      setIsSubmitting(true);
      setPhase("closing");
      setTimeout(() => {
        setPhase("closed");
        if (!trimmed) {
          onConnect({ mode: "demo", url: "" });
        } else {
          onConnect({ mode: "openclaw", url: trimmed, token: token.trim() || undefined });
        }
      }, 500);
    } else {
      const trimmed = lmsUrl.trim();
      if (!trimmed) {
        setError("Please enter the LM Studio server URL");
        return;
      }
      try {
        new URL(trimmed);
      } catch {
        setError("Please enter a valid URL");
        return;
      }
      if (!lmsModel) {
        setError("Please select a model");
        return;
      }
      setError("");
      setIsSubmitting(true);
      setPhase("closing");
      setTimeout(() => {
        setPhase("closed");
        onConnect({ mode: "lmstudio", url: trimmed, token: lmsApiKey.trim() || undefined, model: lmsModel });
      }, 500);
    }
  };

  if (phase === "closed" || (!visible && phase === "idle")) return null;

  const isOpen = phase === "open";
  const isClosing = phase === "closing";

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center transition-all duration-500 ease-out"
      style={{
        backdropFilter: isOpen ? "blur(8px)" : "blur(0px)",
        opacity: isClosing ? 0 : isOpen ? 1 : 0,
        pointerEvents: isClosing ? "none" : "auto",
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 transition-opacity duration-500"
        style={{ opacity: isOpen ? 1 : 0 }}
        onClick={onClose ? () => { setPhase("closing"); setTimeout(() => { setPhase("closed"); onClose(); }, 500); } : undefined}
      />

      {/* Card */}
      <div
        className="relative mx-4 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg transition-all duration-500 ease-out"
        style={{
          transform: isOpen
            ? "scale(1) translateY(0)"
            : isClosing
              ? "scale(0.8) translateY(-40px)"
              : "scale(0.9) translateY(20px)",
          opacity: isOpen ? 1 : isClosing ? 0 : 0,
        }}
      >
        {/* Icon -- pulses briefly on close */}
        <div className="mb-4 flex justify-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary transition-all duration-300"
            style={{
              transform: isClosing ? "scale(1.2)" : "scale(1)",
              boxShadow: isClosing ? "0 0 20px oklch(0.55 0 0 / 0.15)" : "none",
            }}
          >
            {mode === "lmstudio" ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground">
                <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 8h10" /><path d="M7 12h10" /><path d="M7 16h6" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground">
                <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
              </svg>
            )}
          </div>
        </div>

        <h2 className="mb-1 text-center text-lg font-semibold text-foreground">Connect to MobileClaw</h2>
        <p className="mb-4 text-center text-sm text-muted-foreground">
          Choose a backend and configure your connection.
        </p>

        {/* Mode selector — segmented control */}
        <div className="mb-4 flex rounded-xl border border-border bg-secondary p-0.5">
          <button
            type="button"
            onClick={() => { setMode("openclaw"); setError(""); }}
            className={`flex-1 rounded-[10px] py-1.5 text-xs font-medium transition-all duration-200 ${mode === "openclaw" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            OpenClaw
          </button>
          <button
            type="button"
            onClick={() => { setMode("lmstudio"); setError(""); }}
            className={`flex-1 rounded-[10px] py-1.5 text-xs font-medium transition-all duration-200 ${mode === "lmstudio" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            LM Studio
          </button>
        </div>

        {mode === "openclaw" ? (
          <>
            {/* URL input */}
            <div className="mb-4">
              <label htmlFor="openclaw-url" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Server URL
              </label>
              <input
                ref={inputRef}
                id="openclaw-url"
                type="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                placeholder="ws://127.0.0.1:18789"
                disabled={isSubmitting}
                className={`w-full rounded-xl border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${error || connectionError ? "border-destructive" : "border-border"}`}
              />
            </div>

            {/* Token input — hidden when URL is empty (demo mode) */}
            {url.trim() && (
              <div className="mb-4">
                <label htmlFor="openclaw-token" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Gateway Token <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <input
                  id="openclaw-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  placeholder="Enter gateway auth token"
                  disabled={isSubmitting}
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
            )}
          </>
        ) : (
          <>
            {/* LM Studio URL */}
            <div className="mb-4">
              <label htmlFor="lmstudio-url" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                LM Studio URL
              </label>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  id="lmstudio-url"
                  type="url"
                  value={lmsUrl}
                  onChange={(e) => { setLmsUrl(e.target.value); setError(""); setLmsModelError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  placeholder="http://127.0.0.1:1234"
                  disabled={isSubmitting}
                  className={`flex-1 rounded-xl border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${error || connectionError || lmsModelError ? "border-destructive" : "border-border"}`}
                />
                <button
                  type="button"
                  onClick={() => fetchModels(lmsUrl, lmsApiKey)}
                  disabled={lmsModelLoading || !lmsUrl.trim()}
                  className="shrink-0 rounded-xl border border-border bg-secondary px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50 flex items-center gap-1.5"
                >
                  {lmsModelLoading ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
                    </svg>
                  )}
                  Fetch
                </button>
              </div>
              {lmsModelError && <p className="mt-1.5 text-xs text-destructive">{lmsModelError}</p>}
            </div>

            {/* API Key (optional) */}
            <div className="mb-4">
              <label htmlFor="lmstudio-apikey" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                API Key <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <input
                id="lmstudio-apikey"
                type="password"
                value={lmsApiKey}
                onChange={(e) => setLmsApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                placeholder="lm-studio or leave empty"
                disabled={isSubmitting}
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>

            {/* Model selector */}
            <div className="mb-4">
              <label htmlFor="lmstudio-model" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Model
              </label>
              {lmsModels.length > 0 ? (
                <select
                  id="lmstudio-model"
                  value={lmsModel}
                  onChange={(e) => setLmsModel(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 appearance-none"
                >
                  {lmsModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="lmstudio-model"
                  type="text"
                  value={lmsModel}
                  onChange={(e) => { setLmsModel(e.target.value); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  placeholder="Click Fetch or type model name"
                  disabled={isSubmitting}
                  className={`w-full rounded-xl border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${error ? "border-destructive" : "border-border"}`}
                />
              )}
            </div>
          </>
        )}

        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
        {connectionError && <p className="mb-3 text-xs text-destructive">{connectionError}</p>}

        {/* Connect button */}
        <button
          type="button"
          onClick={isDemoMode ? () => { setPhase("closing"); setTimeout(() => setPhase("closed"), 500); } : handleSubmit}
          disabled={isSubmitting}
          className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Connecting...
            </>
          ) : mode === "openclaw" && !url.trim() ? (
            "Start Demo"
          ) : (
            "Connect"
          )}
        </button>

        {mode === "openclaw" && (
          <p className="mt-3 text-center text-[11px] text-muted-foreground/60">
            Leave empty to use demo mode without a server
          </p>
        )}
      </div>
    </div>
  );
}
