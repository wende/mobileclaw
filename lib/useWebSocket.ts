"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  /** Called only when the very first connection attempt fails (server unreachable). */
  onInitialConnectFail?: () => void;
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000]; // escalating backoff

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  const urlRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  // Set to true by the consumer (via markEstablished) after the full protocol
  // handshake succeeds.  Auto-reconnect only fires when this is true, so a
  // connection that opened at the TCP/WS level but was rejected by the server
  // (wrong auth, bad protocol, etc.) will NOT trigger a reconnect loop.
  const everEstablishedRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
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
        console.log("[WS] Connection opened");
        setConnectionState("connected");
        reconnectAttemptRef.current = 0;
        optionsRef.current.onOpen?.();
      };

      ws.onclose = (event) => {
        console.log("[WS] Connection closed:", event.code, event.reason);
        wsRef.current = null;
        optionsRef.current.onClose?.();

        if (intentionalCloseRef.current) {
          setConnectionState("disconnected");
          return;
        }

        // Only auto-reconnect if the connection was fully established
        // (consumer called markEstablished after protocol handshake).
        // Otherwise treat it as an initial connect failure — no retry loop.
        if (!everEstablishedRef.current) {
          console.log("[WS] Connection never established — not reconnecting");
          urlRef.current = null;
          setConnectionState("disconnected");
          optionsRef.current.onInitialConnectFail?.();
          return;
        }

        if (urlRef.current) {
          // Was fully established before — silent background reconnect
          const attempt = reconnectAttemptRef.current;
          const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${attempt + 1})...`);
          setConnectionState("connecting");
          reconnectTimerRef.current = setTimeout(() => {
            reconnectAttemptRef.current = attempt + 1;
            if (urlRef.current) connectInternal(urlRef.current);
          }, delay);
        } else {
          setConnectionState("disconnected");
        }
      };

      ws.onerror = (error) => {
        console.error("[WS] Connection error:", error);
        // onclose will fire after onerror, which handles reconnect
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== "string") {
          console.warn("[WS] Received non-text message:", event.data);
          return;
        }
        try {
          const data = JSON.parse(event.data) as WebSocketMessage;
          optionsRef.current.onMessage?.(data);
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
    urlRef.current = url;
    reconnectAttemptRef.current = 0;
    connectInternal(url);
  }, [connectInternal, clearReconnectTimer]);

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
    disconnect,
    sendMessage,
    isConnected: connectionState === "connected",
    markEstablished,
  };
}
