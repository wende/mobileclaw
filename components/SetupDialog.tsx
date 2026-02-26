"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ConnectionConfig } from "@/types/chat";
import { fetchLmStudioModels, type LmStudioModel } from "@/lib/lmStudio";

const OPENCLAW_SAVED_CONFIGS_KEY = "openclaw-saved-configs";
const OPENCLAW_SAVED_CONFIGS_LIMIT = 10;
const OPENCLAW_NEW_SERVER_VALUE = "__new_server__";

type SavedOpenclawConfig = {
  url: string;
  token?: string;
  savedAt: number;
};

function readSavedOpenclawConfigs(): SavedOpenclawConfig[] {
  try {
    const raw = window.localStorage.getItem(OPENCLAW_SAVED_CONFIGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const valid = parsed
      .map((item): SavedOpenclawConfig | null => {
        if (!item || typeof item !== "object") return null;
        const candidate = item as { url?: unknown; token?: unknown; savedAt?: unknown };
        const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
        if (!url) return null;
        const token = typeof candidate.token === "string" && candidate.token.trim() ? candidate.token : undefined;
        const savedAt = typeof candidate.savedAt === "number" && Number.isFinite(candidate.savedAt) ? candidate.savedAt : 0;
        return { url, token, savedAt };
      })
      .filter((item): item is SavedOpenclawConfig => !!item)
      .sort((a, b) => b.savedAt - a.savedAt);

    const deduped = new Map<string, SavedOpenclawConfig>();
    for (const config of valid) {
      if (!deduped.has(config.url)) deduped.set(config.url, config);
    }
    return Array.from(deduped.values()).slice(0, OPENCLAW_SAVED_CONFIGS_LIMIT);
  } catch {
    return [];
  }
}

function upsertSavedOpenclawConfig(
  configs: SavedOpenclawConfig[],
  url: string,
  token?: string
): SavedOpenclawConfig[] {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return configs;
  const trimmedToken = token?.trim() || undefined;
  const next = [
    { url: trimmedUrl, token: trimmedToken, savedAt: Date.now() },
    ...configs.filter((config) => config.url !== trimmedUrl),
  ];
  return next.slice(0, OPENCLAW_SAVED_CONFIGS_LIMIT);
}

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
  const [saveOpenclawUrl, setSaveOpenclawUrl] = useState(false);
  const [savedOpenclawConfigs, setSavedOpenclawConfigs] = useState<SavedOpenclawConfig[]>([]);
  const [selectedSavedOpenclawUrl, setSelectedSavedOpenclawUrl] = useState(OPENCLAW_NEW_SERVER_VALUE);
  // Local submit state — only true after user clicks Connect, never affected
  // by background reconnection.  Resets when the dialog opens or on error.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phase, setPhase] = useState<"idle" | "entering" | "open" | "closing" | "closed">("idle");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset phase when dialog becomes visible again.
  // Uses phaseRef to read the latest phase without adding it as a dependency
  // (adding phase to deps would re-fire on every animation step).
  useEffect(() => {
    const currentPhase = phaseRef.current;
    if (visible && (currentPhase === "closed" || currentPhase === "idle")) {
      setIsSubmitting(false);
      // Pre-fill from localStorage if available
      const savedMode = window.localStorage.getItem("mobileclaw-mode") as "openclaw" | "lmstudio" | null;
      if (savedMode === "openclaw" || savedMode === "lmstudio") setMode(savedMode);
      const savedUrl = window.localStorage.getItem("openclaw-url");
      const savedToken = window.localStorage.getItem("openclaw-token");
      const savedConfigs = readSavedOpenclawConfigs();
      setSavedOpenclawConfigs(savedConfigs);
      const currentUrlWasSaved = Boolean(savedUrl && savedConfigs.some((config) => config.url === savedUrl));

      if (currentUrlWasSaved) {
        // Keep URL empty so the saved-server picker remains visible.
        setUrl("");
        setToken("");
        setSaveOpenclawUrl(false);
        setSelectedSavedOpenclawUrl(savedUrl || "");
      } else {
        if (savedUrl) setUrl(savedUrl);
        setToken(savedToken || "");
        setSaveOpenclawUrl(Boolean(savedUrl));
        setSelectedSavedOpenclawUrl(OPENCLAW_NEW_SERVER_VALUE);
      }
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
    if (!visible && currentPhase === "open") {
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
      const selectedSavedConfig = !trimmed && selectedSavedOpenclawUrl !== OPENCLAW_NEW_SERVER_VALUE
        ? savedOpenclawConfigs.find((config) => config.url === selectedSavedOpenclawUrl)
        : undefined;
      const targetUrl = trimmed || selectedSavedConfig?.url || "";
      const targetToken = token.trim() || undefined;
      const shouldRemember = trimmed ? saveOpenclawUrl : Boolean(selectedSavedConfig);
      // Allow empty URL for mock mode
      if (targetUrl) {
        try {
          new URL(targetUrl);
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
        if (!targetUrl) {
          onConnect({ mode: "demo", url: "" });
        } else {
          if (shouldRemember) {
            const nextSavedConfigs = upsertSavedOpenclawConfig(savedOpenclawConfigs, targetUrl, targetToken);
            setSavedOpenclawConfigs(nextSavedConfigs);
            try {
              window.localStorage.setItem(OPENCLAW_SAVED_CONFIGS_KEY, JSON.stringify(nextSavedConfigs));
            } catch { }
          }
          onConnect({ mode: "openclaw", url: targetUrl, token: targetToken, remember: shouldRemember });
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
  const selectedSavedConfig = savedOpenclawConfigs.find((config) => config.url === selectedSavedOpenclawUrl);
  const isExistingSavedConfigSelected = Boolean(selectedSavedConfig);
  const showOpenclawManualFields = !isExistingSavedConfigSelected;
  const hasOpenclawTarget = Boolean(url.trim() || selectedSavedConfig);

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
        {/* Icon -- pulses briefly on close, secret tap to enter demo */}
        <div className="mb-4 flex justify-center">
          <button
            type="button"
            onClick={() => {
              setPhase("closing");
              setTimeout(() => {
                setPhase("closed");
                onConnect({ mode: "demo", url: "" });
              }, 500);
            }}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary transition-all duration-300 hover:bg-accent active:scale-95"
            style={{
              transform: isClosing ? "scale(1.2)" : "scale(1)",
              boxShadow: isClosing ? "0 0 20px oklch(0.55 0 0 / 0.15)" : "none",
            }}
          >
            <img src="/logo.png" alt="" className="h-9 mix-blend-multiply dark:mix-blend-screen dark:invert" />
          </button>
        </div>

        <h2 className="mb-1 text-center text-lg font-semibold text-foreground">Connect to {mode === "lmstudio" ? "LM Studio" : "OpenClaw"}</h2>
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
            {savedOpenclawConfigs.length > 0 && (
              <div className="mb-4">
                <label htmlFor="openclaw-saved-config" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Saved configurations
                </label>
                <div className="relative">
                  <select
                    id="openclaw-saved-config"
                    value={selectedSavedOpenclawUrl}
                    onChange={(e) => {
                      const selectedUrl = e.target.value;
                      setSelectedSavedOpenclawUrl(selectedUrl);
                      if (selectedUrl === OPENCLAW_NEW_SERVER_VALUE) {
                        setUrl("");
                        setToken("");
                        setSaveOpenclawUrl(false);
                        setError("");
                        return;
                      }

                      const selected = savedOpenclawConfigs.find((config) => config.url === selectedUrl);
                      setUrl("");
                      setToken(selected?.token || "");
                      setSaveOpenclawUrl(Boolean(selected));
                      setError("");
                    }}
                    disabled={isSubmitting}
                    className="w-full appearance-none rounded-xl border border-border bg-background px-4 py-2.5 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  >
                    <option value={OPENCLAW_NEW_SERVER_VALUE}>New server</option>
                    {savedOpenclawConfigs.map((config) => (
                      <option key={config.url} value={config.url}>
                        {config.url}{config.token ? " (token saved)" : ""}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-muted-foreground/70">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                </div>
              </div>
            )}

            {showOpenclawManualFields && (
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
                    onChange={(e) => {
                      const nextUrl = e.target.value;
                      setUrl(nextUrl);
                      setSelectedSavedOpenclawUrl(OPENCLAW_NEW_SERVER_VALUE);
                      setError("");
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                    placeholder="ws://127.0.0.1:18789"
                    disabled={isSubmitting}
                    className={`w-full rounded-xl border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${error || connectionError ? "border-destructive" : "border-border"}`}
                  />
                </div>

                {/* Token input */}
                {hasOpenclawTarget && (
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
            )}

            {showOpenclawManualFields && url.trim() && (
              <label
                htmlFor="openclaw-save-url"
                className="mb-4 flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-xs text-muted-foreground"
              >
                <input
                  id="openclaw-save-url"
                  type="checkbox"
                  checked={saveOpenclawUrl}
                  onChange={(e) => setSaveOpenclawUrl(e.target.checked)}
                  disabled={isSubmitting}
                  className="h-3.5 w-3.5 rounded border-border text-foreground accent-foreground"
                />
                Save this URL
              </label>
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
          ) : mode === "openclaw" && !hasOpenclawTarget ? (
            "Start Demo"
          ) : (
            "Connect"
          )}
        </button>

        {mode === "openclaw" && (
          <p className="mt-3 text-center text-xs text-muted-foreground/60">
            Leave empty to use demo mode without a server
          </p>
        )}
      </div>
    </div>
  );
}
