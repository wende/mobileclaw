import { useEffect, useCallback, useRef } from "react";

import { DEMO_HISTORY } from "@/lib/demoMode";
import type { LmStudioConfig } from "@/lib/lmStudio";
import { notifyWebViewReady, registerBridgeHandler, updateBridgeHandler, type BridgeMessage } from "@/lib/nativeBridge";
import type { Command } from "@/components/CommandSheet";
import type { BackendMode, ConnectionConfig, Message } from "@/types/chat";

/** Read a URL search param. Returns null when absent or during SSR. */
function getSearchParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Convert an HTTP(S) URL to its WS(S) equivalent. Already-WS URLs pass through. */
function toWsUrl(url: string): string {
  if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
  return url.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
}

interface UseModeBootstrapOptions {
  isDemoMode: boolean;
  connect: (url: string) => void;
  disconnect: () => void;
  handleNativeBridgeMessage: (msg: BridgeMessage) => void;
  resetThinkingState: () => void;
  gatewayTokenRef: React.MutableRefObject<string | null>;
  lmStudioConfigRef: React.MutableRefObject<LmStudioConfig | null>;
  lmStudioHandlerRef: React.MutableRefObject<{ stop: () => void } | null>;
  setOpenclawUrl: React.Dispatch<React.SetStateAction<string | null>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setConnectionError: React.Dispatch<React.SetStateAction<string | null>>;
  setCurrentModel: React.Dispatch<React.SetStateAction<string | null>>;
  setBackendMode: React.Dispatch<React.SetStateAction<BackendMode>>;
  setIsDemoMode: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSetup: React.Dispatch<React.SetStateAction<boolean>>;
  setHistoryLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  setIsInitialConnecting: React.Dispatch<React.SetStateAction<boolean>>;
  setServerCommands: React.Dispatch<React.SetStateAction<Command[]>>;
  isDetachedRef: React.MutableRefObject<boolean>;
  isNativeRef: React.MutableRefObject<boolean>;
}

export function useModeBootstrap({
  isDemoMode,
  connect,
  disconnect,
  handleNativeBridgeMessage,
  resetThinkingState,
  gatewayTokenRef,
  lmStudioConfigRef,
  lmStudioHandlerRef,
  setOpenclawUrl,
  setMessages,
  setConnectionError,
  setCurrentModel,
  setBackendMode,
  setIsDemoMode,
  setShowSetup,
  setHistoryLoaded,
  setIsInitialConnecting,
  setServerCommands,
  isDetachedRef,
  isNativeRef,
}: UseModeBootstrapOptions) {
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    if (isNativeRef.current) {
      registerBridgeHandler((msg: BridgeMessage) => {
        handleNativeBridgeMessage(msg);
      });
      notifyWebViewReady();
    }

    if (getSearchParam("demo") !== null) {
      resetThinkingState();
      setIsDemoMode(true);
      setBackendMode("demo");
      setMessages(DEMO_HISTORY);
      setCurrentModel("demo/openclaw-preview");
      setShowSetup(false);
      setHistoryLoaded(true);
    }
  }, [
    handleNativeBridgeMessage,
    isNativeRef,
    resetThinkingState,
    setBackendMode,
    setCurrentModel,
    setHistoryLoaded,
    setIsDemoMode,
    setMessages,
    setShowSetup,
  ]);

  // Keep the bridge handler fresh — the bootstrap effect only registers once,
  // but handleNativeBridgeMessage may be recreated when its deps change.
  useEffect(() => {
    if (isNativeRef.current) {
      updateBridgeHandler((msg: BridgeMessage) => {
        handleNativeBridgeMessage(msg);
      });
    }
  }, [handleNativeBridgeMessage, isNativeRef]);

  useEffect(() => {
    if (getSearchParam("demo") !== null) return;
    if (isDemoMode) return;

    // In native mode, web waits for config:connection from Swift — no auto-connect.
    if (isNativeRef.current) return;

    const detached = isDetachedRef.current;
    const embedUrl = getSearchParam("url");
    if (detached && embedUrl) {
      gatewayTokenRef.current = getSearchParam("token");
      setBackendMode("openclaw");
      setOpenclawUrl(embedUrl);
      setIsInitialConnecting(true);
      connect(toWsUrl(embedUrl));
      return;
    }

    const savedMode = window.localStorage.getItem("mobileclaw-mode") as BackendMode | null;
    if (savedMode === "demo") return;

    if (savedMode === "lmstudio") {
      const savedUrl = window.localStorage.getItem("lmstudio-url");
      const savedApiKey = window.localStorage.getItem("lmstudio-apikey");
      const savedModel = window.localStorage.getItem("lmstudio-model");
      if (savedUrl && savedModel) {
        setBackendMode("lmstudio");
        const config: LmStudioConfig = {
          baseUrl: savedUrl,
          apiKey: savedApiKey || undefined,
          model: savedModel,
        };
        lmStudioConfigRef.current = config;
        setCurrentModel(savedModel);
        setOpenclawUrl(savedUrl);
        try {
          const saved = window.localStorage.getItem("lmstudio-messages");
          if (saved) {
            const parsed = JSON.parse(saved) as Message[];
            if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
          }
        } catch {}
        setHistoryLoaded(true);
      } else {
        if (!detached) setShowSetup(true);
        setHistoryLoaded(true);
      }
    } else {
      const savedUrl = window.localStorage.getItem("openclaw-url");
      const savedToken = window.localStorage.getItem("openclaw-token");
      if (savedUrl) {
        gatewayTokenRef.current = savedToken ?? null;
        setBackendMode("openclaw");
        setOpenclawUrl(savedUrl);
        try {
          const cached = localStorage.getItem("mc-server-commands");
          if (cached) {
            setServerCommands(JSON.parse(cached) as Command[]);
          }
        } catch {}
        setIsInitialConnecting(true);
        connect(toWsUrl(savedUrl));
      } else {
        if (!detached) setShowSetup(true);
        setHistoryLoaded(true);
      }
    }
  }, [
    connect,
    isDemoMode,
    isDetachedRef,
    isNativeRef,
    gatewayTokenRef,
    lmStudioConfigRef,
    setBackendMode,
    setCurrentModel,
    setHistoryLoaded,
    setIsInitialConnecting,
    setMessages,
    setOpenclawUrl,
    setServerCommands,
    setShowSetup,
  ]);

  const handleConnect = useCallback((config: ConnectionConfig) => {
    setConnectionError(null);
    setMessages([]);
    resetThinkingState();
    window.localStorage.removeItem("lmstudio-messages");

    if (config.mode === "demo") {
      window.localStorage.setItem("mobileclaw-mode", "demo");
      setBackendMode("demo");
      setIsDemoMode(true);
      setMessages(DEMO_HISTORY);
      setCurrentModel("demo/openclaw-preview");
      setHistoryLoaded(true);
      return;
    }

    if (config.mode === "lmstudio") {
      window.localStorage.setItem("mobileclaw-mode", "lmstudio");
      window.localStorage.setItem("lmstudio-url", config.url);
      if (config.token) window.localStorage.setItem("lmstudio-apikey", config.token);
      else window.localStorage.removeItem("lmstudio-apikey");
      if (config.model) window.localStorage.setItem("lmstudio-model", config.model);
      setBackendMode("lmstudio");
      setIsDemoMode(false);
      const lmsConfig: LmStudioConfig = { baseUrl: config.url, apiKey: config.token, model: config.model! };
      lmStudioConfigRef.current = lmsConfig;
      setCurrentModel(config.model || null);
      setOpenclawUrl(config.url);
      disconnect();
      return;
    }

    window.localStorage.setItem("mobileclaw-mode", "openclaw");
    if (config.remember) {
      window.localStorage.setItem("openclaw-url", config.url);
      if (config.token) window.localStorage.setItem("openclaw-token", config.token);
      else window.localStorage.removeItem("openclaw-token");
    } else {
      window.localStorage.removeItem("openclaw-url");
      window.localStorage.removeItem("openclaw-token");
    }
    gatewayTokenRef.current = config.token ?? null;
    setBackendMode("openclaw");
    setIsDemoMode(false);
    lmStudioConfigRef.current = null;
    lmStudioHandlerRef.current = null;
    setOpenclawUrl(config.url);
    setIsInitialConnecting(true);
    connect(toWsUrl(config.url));
  }, [
    connect,
    disconnect,
    gatewayTokenRef,
    lmStudioConfigRef,
    lmStudioHandlerRef,
    resetThinkingState,
    setBackendMode,
    setConnectionError,
    setCurrentModel,
    setHistoryLoaded,
    setIsInitialConnecting,
    setIsDemoMode,
    setMessages,
    setOpenclawUrl,
  ]);

  return {
    handleConnect,
    initCompleteFlags: {
      hasMounted: true,
    },
  };
}
