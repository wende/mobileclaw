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

        if (!intentionalCloseRef.current && urlRef.current) {
          // Auto-reconnect with backoff
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
        try {
          const data = JSON.parse(event.data) as WebSocketMessage;
          optionsRef.current.onMessage?.(data);
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
        }
      };
    } catch (err) {
      setConnectionState("error");
      console.error("Failed to create WebSocket connection:", err);
    }
  }, []);

  const connect = useCallback((url: string) => {
    clearReconnectTimer();
    intentionalCloseRef.current = false;
    urlRef.current = url;
    reconnectAttemptRef.current = 0;
    connectInternal(url);
  }, [connectInternal, clearReconnectTimer]);

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
  };
}
