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

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);

  // Keep options ref up to date without triggering reconnects
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const connect = useCallback((url: string) => {
    // Close existing connection if any
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
        optionsRef.current.onOpen?.();
      };

      ws.onclose = (event) => {
        console.log("[WS] Connection closed:", event.code, event.reason);
        setConnectionState("disconnected");
        wsRef.current = null;
        optionsRef.current.onClose?.();
      };

      ws.onerror = (error) => {
        console.error("[WS] Connection error:", error);
        setConnectionState("error");
        wsRef.current = null;
        optionsRef.current.onError?.(error);
      };

      ws.onmessage = (event) => {
        console.log("[WS Raw] Received:", event.data);
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

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("disconnected");
  }, []);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    console.log("[WS] Sending:", message);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    console.warn("[WS] Cannot send - not connected");
    return false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    connectionState,
    connect,
    disconnect,
    sendMessage,
    isConnected: connectionState === "connected",
  };
}
