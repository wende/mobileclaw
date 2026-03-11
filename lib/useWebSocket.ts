"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { logWsFrame } from "@/lib/debugLog";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error" | "reconnecting";

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  /** Called only when the very first connection attempt fails (server unreachable or rejected). */
  onInitialConnectFail?: (info?: { code: number; reason: string }) => void;
  /** Called on each initial retry attempt (before handshake succeeds). */
  onInitialRetrying?: (attempt: number) => void;
  /** Called when entering reconnect mode after a drop. */
  onReconnecting?: (attempt: number, delay: number) => void;
  /** Called when a reconnect attempt succeeds (WS re-opens after a drop). */
  onReconnected?: () => void;
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000]; // escalating backoff
const INITIAL_RETRY_INTERVAL = 1500; // fixed interval for pre-handshake retries
const INITIAL_RETRY_MAX = 20; // ~30s total
const WS_PAYLOAD_DEBUG_STORAGE_KEY = "mc-debug-ws-payloads";

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  const urlRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRetryAttemptRef = useRef(0);
  const initialRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const reconnectingRef = useRef(false);
  const seenAgentStreamsRef = useRef<Set<string>>(new Set());
  const seenAssistantShapesRef = useRef<Set<string>>(new Set());
  const payloadDebugEnabledRef = useRef(false);
  // Set to true by the consumer (via markEstablished) after the full protocol
  // handshake succeeds.  Auto-reconnect only fires when this is true, so a
  // connection that opened at the TCP/WS level but was rejected by the server
  // (wrong auth, bad protocol, etc.) will NOT trigger a reconnect loop.
  const everEstablishedRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      payloadDebugEnabledRef.current = false;
      return;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      payloadDebugEnabledRef.current = params.has("debug-ws") || localStorage.getItem(WS_PAYLOAD_DEBUG_STORAGE_KEY) === "1";
    } catch {
      payloadDebugEnabledRef.current = false;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (initialRetryTimerRef.current) {
      clearTimeout(initialRetryTimerRef.current);
      initialRetryTimerRef.current = null;
    }
  }, []);

  const connectInternal = useCallback((url: string) => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
    }

    setConnectionState("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        const wasReconnecting = reconnectingRef.current;
        reconnectingRef.current = false;
        console.log("[WS] Connection opened" + (wasReconnecting ? " (reconnected)" : ""));
        setConnectionState("connected");
        reconnectAttemptRef.current = 0;
        initialRetryAttemptRef.current = 0;
        optionsRef.current.onOpen?.();
        if (wasReconnecting) {
          optionsRef.current.onReconnected?.();
        }
      };

      ws.onclose = (event) => {
        console.log("[WS] Connection closed:", event.code, event.reason);
        wsRef.current = null;
        optionsRef.current.onClose?.();

        if (intentionalCloseRef.current) {
          setConnectionState("disconnected");
          return;
        }

        // Connection closed before protocol handshake completed — retry with
        // fixed interval before giving up and calling onInitialConnectFail.
        if (!everEstablishedRef.current) {
          // Server-rejected closes (policy violation, etc.) — don't retry.
          const nonRetryable = event.code === 1008 || event.code >= 4000;
          if (nonRetryable) {
            console.log(`[WS] Server rejected connection (${event.code}) — not retrying`);
            initialRetryAttemptRef.current = 0;
            urlRef.current = null;
            setConnectionState("disconnected");
            optionsRef.current.onInitialConnectFail?.({ code: event.code, reason: event.reason });
            return;
          }

          const attempt = initialRetryAttemptRef.current;
          if (attempt < INITIAL_RETRY_MAX && urlRef.current) {
            initialRetryAttemptRef.current = attempt + 1;
            console.log(`[WS] Initial retry ${attempt + 1}/${INITIAL_RETRY_MAX} in ${INITIAL_RETRY_INTERVAL}ms`);
            optionsRef.current.onInitialRetrying?.(attempt + 1);
            initialRetryTimerRef.current = setTimeout(() => {
              if (urlRef.current) connectInternal(urlRef.current);
            }, INITIAL_RETRY_INTERVAL);
          } else {
            console.log("[WS] Initial retries exhausted — not reconnecting");
            initialRetryAttemptRef.current = 0;
            urlRef.current = null;
            setConnectionState("disconnected");
            optionsRef.current.onInitialConnectFail?.();
          }
          return;
        }

        if (urlRef.current) {
          // Was fully established before — reconnect with backoff
          const attempt = reconnectAttemptRef.current;
          const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${attempt + 1})...`);
          reconnectingRef.current = true;
          setConnectionState("reconnecting");
          optionsRef.current.onReconnecting?.(attempt + 1, delay);
          reconnectTimerRef.current = setTimeout(() => {
            reconnectAttemptRef.current = attempt + 1;
            if (urlRef.current) connectInternal(urlRef.current);
          }, delay);
        } else {
          setConnectionState("disconnected");
        }
      };

      ws.onerror = (error) => {
        // If we'll reconnect (established connection that dropped), just log —
        // don't fire the error callback since onclose will handle reconnection.
        if (everEstablishedRef.current && urlRef.current && !intentionalCloseRef.current) {
          console.log("[WS] Connection error (will reconnect):", error);
        } else {
          console.error("[WS] Connection error:", error);
          optionsRef.current.onError?.(error);
        }
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== "string") {
          console.warn("[WS] Received non-text message:", event.data);
          return;
        }
        try {
          const frame = JSON.parse(event.data) as WebSocketMessage;
          try {
            logWsFrame("recv", frame);
          } catch (logError) {
            console.error("[WS] Failed to log received frame:", logError);
          }

          if (frame.type === "event" && frame.event === "agent") {
            const p = frame.payload as { stream?: unknown; data?: Record<string, unknown> } | undefined;
            const streamName = typeof p?.stream === "string" ? p.stream : String(p?.stream);
            const shouldLogPayloads = payloadDebugEnabledRef.current;

            if (shouldLogPayloads && !seenAgentStreamsRef.current.has(streamName)) {
              seenAgentStreamsRef.current.add(streamName);
              console.log("[WS] Agent stream detected:", streamName);
            }

            if (shouldLogPayloads && (p?.stream === "thinking" || p?.stream === "reasoning")) {
              const fullThoughtText = p.data?.text;
              console.log("[WS] Agent thinking:", fullThoughtText);
            } else if (shouldLogPayloads && p?.stream === "assistant" && p.data && typeof p.data === "object") {
              const shape = Object.keys(p.data).sort().join(",");
              if (!seenAssistantShapesRef.current.has(shape)) {
                seenAssistantShapesRef.current.add(shape);
                console.log("[WS] Assistant payload keys:", shape || "(none)");
              }

              const explicitThought = p.data.thinking ?? p.data.reasoning ?? p.data.thought ?? p.data.analysis;
              if (typeof explicitThought === "string" && explicitThought.trim().length > 0) {
                console.log("[WS] Agent thinking:", explicitThought);
              } else if (typeof p.data.text === "string") {
                const match = p.data.text.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
                const fullThoughtText = match?.[1]?.trim();
                if (fullThoughtText) {
                  console.log("[WS] Agent thinking:", fullThoughtText);
                }
              }
            }
          }

          optionsRef.current.onMessage?.(frame);
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err, "Raw data:", event.data);
        }
      };
    } catch (err) {
      setConnectionState("error");
      console.error("Failed to create WebSocket connection:", err);
      optionsRef.current.onInitialConnectFail?.();
    }
  }, []);

  const connect = useCallback((url: string) => {
    clearReconnectTimer();
    intentionalCloseRef.current = false;
    everEstablishedRef.current = false;
    reconnectingRef.current = false;
    urlRef.current = url;
    reconnectAttemptRef.current = 0;
    initialRetryAttemptRef.current = 0;
    connectInternal(url);
  }, [connectInternal, clearReconnectTimer]);

  /**
   * Forces an immediate reconnect using the last known URL.
   * Useful for resume-from-sleep/background recovery where the socket can look
   * "open" locally but be stale server-side.
   */
  const reconnectNow = useCallback(() => {
    clearReconnectTimer();
    if (!urlRef.current || intentionalCloseRef.current) return false;
    reconnectingRef.current = true;
    reconnectAttemptRef.current = 0;
    connectInternal(urlRef.current);
    return true;
  }, [clearReconnectTimer, connectInternal]);

  /** Call after a successful protocol handshake to enable auto-reconnect. */
  const markEstablished = useCallback(() => {
    everEstablishedRef.current = true;
  }, []);

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    intentionalCloseRef.current = true;
    urlRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("disconnected");
  }, [clearReconnectTimer]);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        logWsFrame("send", message);
      } catch (logError) {
        console.error("[WS] Failed to log sent frame:", logError);
      }
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    console.warn("[WS] Cannot send - not connected");
    return false;
  }, []);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [clearReconnectTimer]);

  return {
    connectionState,
    connect,
    reconnectNow,
    disconnect,
    sendMessage,
    isConnected: connectionState === "connected",
    markEstablished,
  };
}
