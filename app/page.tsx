"use client";

import React from "react";

import { useState, useRef, useEffect, useCallback } from "react";
import { useWebSocket, type WebSocketMessage } from "@/lib/useWebSocket";
import { DEMO_HISTORY, createDemoHandler, type DemoCallbacks } from "@/lib/demoMode";
import { createLmStudioHandler, type LmStudioConfig, type LmStudioCallbacks } from "@/lib/lmStudio";
import type {
  ContentPart,
  Message,
  WSIncomingMessage,
  ConnectChallengePayload,
  ChatEventPayload,
  AgentEventPayload,
  BackendMode,
  ConnectionConfig,
} from "@/types/chat";
import { getTextFromContent, getMessageSide, formatMessageTime } from "@/lib/messageUtils";
import { MessageRow } from "@/components/MessageRow";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { CommandSheet } from "@/components/CommandSheet";
import { ChatInput } from "@/components/ChatInput";
import { SetupDialog } from "@/components/SetupDialog";

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [openclawUrl, setOpenclawUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  isStreamingRef.current = isStreaming;
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<Record<string, unknown> | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [scrollPhase, setScrollPhase] = useState<"input" | "pill">("input");
  const appRef = useRef<HTMLDivElement>(null);
  const morphRef = useRef<HTMLDivElement>(null);
  const floatingBarRef = useRef<HTMLDivElement>(null);
  const scrollRafId = useRef<number | null>(null);
  const scrollPhaseRef = useRef<"input" | "pill">("input");
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const autoScrollRafRef = useRef<number | null>(null);
  // Pull-to-refresh (ref-driven to avoid re-renders during gesture)
  const [refreshing, setRefreshing] = useState(false);
  const pullStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const didVibrateRef = useRef(false);
  const pullContentRef = useRef<HTMLDivElement>(null);
  const setPullTransformRef = useRef<(dist: number, animate: boolean) => void>(() => {});
  const refreshStartRef = useRef(0);
  const pullSpinnerRef = useRef<HTMLDivElement>(null);
  const currentAssistantMsgRef = useRef<Message | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef<string>("main");
  const [isDemoMode, setIsDemoMode] = useState(false);
  const demoHandlerRef = useRef<ReturnType<typeof createDemoHandler> | null>(null);

  // Backend mode: openclaw (WebSocket), lmstudio (HTTP+SSE), or demo
  const [backendMode, setBackendMode] = useState<BackendMode>("openclaw");
  const lmStudioConfigRef = useRef<LmStudioConfig | null>(null);
  const lmStudioHandlerRef = useRef<ReturnType<typeof createLmStudioHandler> | null>(null);

  // Track active run for streaming
  const activeRunIdRef = useRef<string | null>(null);
  const sendWSMessageRef = useRef<((message: WebSocketMessage) => boolean) | null>(null);
  const gatewayTokenRef = useRef<string | null>(null);

  // WebSocket message handler - OpenClaw protocol
  const handleWSMessage = useCallback((data: WebSocketMessage) => {
    const msg = data as WSIncomingMessage;

    // Handle Connect Challenge (first message from server)
    if (msg.type === "event" && msg.event === "connect.challenge") {
      const payload = msg.payload as ConnectChallengePayload;
      // Respond with connect request with token auth
      const connectMsg = {
        type: "req",
        id: `conn-${Date.now()}`,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "webchat",
            version: "1.0.0",
            platform: "web",
            mode: "webchat",
          },
          role: "operator",
          scopes: ["operator.admin"],
          caps: ["chat", "agent", "health", "presence"],
          auth: {
            token: gatewayTokenRef.current ?? undefined,
          },
        },
      };
      sendWSMessageRef.current?.(connectMsg as unknown as WebSocketMessage);
      return;
    }

    // Legacy: Handle Hello message (kept for protocol compat)
    if (msg.type === "hello") {
      sessionIdRef.current = msg.sessionId;
      return;
    }

    // Handle Response
    if (msg.type === "res") {
      // Handle hello-ok (successful connect)
      const resPayload = msg.payload as Record<string, unknown> | undefined;
      if (msg.ok && resPayload?.type === "hello-ok") {
        const server = resPayload.server as Record<string, unknown> | undefined;
        if (server) setServerInfo(server);
        sessionIdRef.current = (server as Record<string, string>)?.connId ?? null;

        // Extract session key from snapshot
        const snapshot = resPayload.snapshot as Record<string, unknown> | undefined;
        const sessionDefaults = snapshot?.sessionDefaults as Record<string, string> | undefined;
        const sessionKey = sessionDefaults?.mainSessionKey || sessionDefaults?.mainKey || "main";
        sessionKeyRef.current = sessionKey;
        // Fetch chat history using the correct session key
        sendWSMessageRef.current?.({
          type: "req",
          id: `history-${Date.now()}`,
          method: "chat.history",
          params: { sessionKey },
        } as unknown as WebSocketMessage);
        return;
      }

      // Handle chat.send response
      if (msg.id?.startsWith("run-")) {
        return;
      }

      // Handle sessions.list response
      if (msg.ok && msg.id?.startsWith("sessions-list-")) {
        return;
      }

      // Handle chat.history response
      if (msg.ok && msg.id?.startsWith("history-")) {
      }
      if (msg.ok && msg.id?.startsWith("history-") && resPayload?.messages) {
        const rawMsgs = resPayload.messages as Array<Record<string, unknown>>;
        const historyMessages = rawMsgs
          .filter((m) => {
            const content = m.content as ContentPart[] | string | null;
            if (!content || (Array.isArray(content) && content.length === 0)) return false;
            return true;
          })
          .map((m, idx) => {
            const content = m.content as ContentPart[] | string;
            // Extract thinking content as reasoning
            let reasoning: string | undefined;
            let filteredContent: ContentPart[] | string;
            if (Array.isArray(content)) {
              const thinkingPart = content.find((p) => p.type === "thinking");
              if (thinkingPart?.thinking) reasoning = thinkingPart.thinking as string;
              filteredContent = content.filter((p) => p.type !== "thinking");
            } else {
              filteredContent = content;
            }

            // Extract tool name for tool result messages
            let toolName: string | undefined;
            // Check message-level fields first
            if (m.name) toolName = m.name as string;
            else if (m.toolName) toolName = m.toolName as string;
            // Then check content parts
            if (!toolName && Array.isArray(filteredContent)) {
              const toolPart = filteredContent.find((p) => p.name);
              if (toolPart) toolName = toolPart.name;
            }

            // Detect context-enriched user messages (server-assembled for the AI)
            let isContext = false;
            if (m.role === "user" && Array.isArray(filteredContent)) {
              const tp = filteredContent.find((p) => p.type === "text" && p.text);
              if (tp?.text && typeof tp.text === "string" && tp.text.startsWith("System: [")) isContext = true;
            }

            return {
              role: m.role as string,
              content: filteredContent,
              timestamp: m.timestamp as number,
              id: `hist-${idx}`,
              reasoning,
              toolName,
              isError: m.stopReason === "error",
              stopReason: m.stopReason as string | undefined,
              isContext,
            } as Message;
          });

        // Merge tool results into the preceding assistant's tool call content parts
        const mergedIds = new Set<string>();
        for (let i = 0; i < historyMessages.length; i++) {
          const hm = historyMessages[i];
          if ((hm.role === "tool" || hm.role === "toolResult" || hm.role === "tool_result") && hm.toolName) {
            const resultText = getTextFromContent(hm.content);
            for (let j = i - 1; j >= 0; j--) {
              const prev = historyMessages[j];
              if (prev.role === "assistant" && Array.isArray(prev.content)) {
                const tc = prev.content.find((p) => p.name === hm.toolName && !p.result);
                if (tc) {
                  const args = tc.arguments;
                  tc.arguments = typeof args === "string" ? args : args ? JSON.stringify(args) : undefined;
                  tc.result = resultText;
                  tc.resultError = hm.isError;
                  tc.status = hm.isError ? "error" : "success";
                  mergedIds.add(hm.id!);
                  break;
                }
              }
            }
          }
        }
        const finalMessages = historyMessages.filter((m) => !mergedIds.has(m.id!));

        // Extract model: prefer last assistant message with model field,
        // then fall back to parsing injected /model response text
        const lastAssistantRaw = rawMsgs.filter((m) => m.role === "assistant" && m.model).pop();
        if (lastAssistantRaw?.model) {
          const provider = lastAssistantRaw.provider as string | undefined;
          const model = lastAssistantRaw.model as string;
          setCurrentModel(provider ? `${provider}/${model}` : model);
        }
        // Check injected messages for model changes (e.g. /model command responses)
        const lastInjected = rawMsgs.filter((m) => m.stopReason === "injected").pop();
        if (lastInjected) {
          // If the injected message itself has a model field, use it
          if (lastInjected.model) {
            const provider = lastInjected.provider as string | undefined;
            const model = lastInjected.model as string;
            setCurrentModel(provider ? `${provider}/${model}` : model);
          } else {
            // Parse model from text content (e.g. "**Primary model set to `openai/gpt-5`**")
            const injectedContent = lastInjected.content;
            let injectedText = "";
            if (typeof injectedContent === "string") {
              injectedText = injectedContent;
            } else if (Array.isArray(injectedContent)) {
              injectedText = (injectedContent as ContentPart[])
                .filter((p) => p.type === "text" && p.text)
                .map((p) => p.text)
                .join("");
            }
            const modelMatch = injectedText.match(/model\s+(?:set\s+to|changed\s+to|is|:)\s+[`*]*([a-zA-Z0-9_./-]+)[`*]*/i);
            if (modelMatch) {
              setCurrentModel(modelMatch[1]);
            }
          }
        }

        // Merge: keep optimistic user messages that aren't yet in server history, sorted by timestamp
        setMessages((prev) => {
          const historyTimestamps = new Set(finalMessages.map((m) => m.timestamp));
          const optimistic = prev.filter(
            (m) => m.role === "user" && m.id?.startsWith("u-") && !historyTimestamps.has(m.timestamp)
          );
          if (optimistic.length === 0) return finalMessages;
          return [...finalMessages, ...optimistic].sort(
            (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
          );
        });

        // If pull-to-refresh was active, bounce back after minimum duration
        if (refreshingRef.current) {
          const elapsed = Date.now() - refreshStartRef.current;
          const minDelay = 150;
          const remaining = Math.max(0, minDelay - elapsed);
          setTimeout(() => {
            requestAnimationFrame(() => {
              setPullTransformRef.current(0, true);
              setRefreshing(false);
            });
          }, remaining);
        }
        return;
      }

      if (!msg.ok && msg.error) {
        const errorMsg = typeof msg.error === "string" ? msg.error : msg.error?.message || "Unknown error";
        setConnectionError(errorMsg);
      }
      return;
    }

    // Handle Events
    if (msg.type === "event") {
      if (msg.event === "chat") {
        const payload = msg.payload as ChatEventPayload;
        switch (payload.state) {
          case "delta":
            if (payload.message) {
              setIsStreaming(true);
              activeRunIdRef.current = payload.runId;

              setMessages((prev) => {
                // Find if we already have a message for this run
                const existingIdx = prev.findIndex((m) => m.id === payload.runId);

                if (existingIdx >= 0) {
                  // Update existing message
                  const existing = prev[existingIdx];
                  const newContent = typeof payload.message!.content === "string"
                    ? [{ type: "text", text: payload.message!.content }]
                    : payload.message!.content;

                  const updated = {
                    ...existing,
                    content: newContent,
                    reasoning: payload.message!.reasoning || existing.reasoning,
                  };
                  return [...prev.slice(0, existingIdx), updated, ...prev.slice(existingIdx + 1)];
                } else {
                  // Create new message
                  const newMsg: Message = {
                    role: payload.message!.role,
                    content: typeof payload.message!.content === "string"
                      ? [{ type: "text", text: payload.message!.content }]
                      : payload.message!.content,
                    id: payload.runId,
                    timestamp: payload.message!.timestamp,
                    reasoning: payload.message!.reasoning,
                  };
                  setStreamingId(payload.runId);
                  return [...prev, newMsg];
                }
              });
            }
            break;

          case "final":
            setIsStreaming(false);
            setStreamingId(null);
            activeRunIdRef.current = null;
            // Server final events don't include message content — re-fetch history
            sendWSMessageRef.current?.({
              type: "req",
              id: `history-${Date.now()}`,
              method: "chat.history",
              params: { sessionKey: sessionKeyRef.current },
            } as unknown as WebSocketMessage);
            break;

          case "aborted":
            setIsStreaming(false);
            setStreamingId(null);
            activeRunIdRef.current = null;
            break;

          case "error":
            setConnectionError(payload.errorMessage || "Chat error");
            setIsStreaming(false);
            setStreamingId(null);
            activeRunIdRef.current = null;
            break;
        }
      } else if (msg.event === "agent") {
        const payload = msg.payload as AgentEventPayload;
        if (payload.stream === "lifecycle") {
          const phase = payload.data.phase as string;
          if (phase === "start") {
            setIsStreaming(true);
            activeRunIdRef.current = payload.runId;
          }
        } else if (payload.stream === "content") {
          // Live text streaming
          const delta = (payload.data.delta ?? payload.data.text ?? "") as string;
          if (delta) {
            setIsStreaming(true);
            setMessages((prev) => {
              let idx = prev.findIndex((m) => m.id === payload.runId);
              if (idx >= 0) {
                const existing = prev[idx];
                const prevText = getTextFromContent(existing.content);
                return [...prev.slice(0, idx), {
                  ...existing,
                  content: [{ type: "text", text: prevText + delta }] as ContentPart[],
                }, ...prev.slice(idx + 1)];
              }
              setStreamingId(payload.runId);
              return [...prev, {
                role: "assistant",
                content: [{ type: "text", text: delta }],
                id: payload.runId,
                timestamp: payload.ts,
              } as Message];
            });
          }
        } else if (payload.stream === "reasoning") {
          // Live thinking/reasoning streaming
          const delta = (payload.data.delta ?? payload.data.text ?? "") as string;
          if (delta) {
            setMessages((prev) => {
              let idx = prev.findIndex((m) => m.id === payload.runId);
              if (idx >= 0) {
                const existing = prev[idx];
                return [...prev.slice(0, idx), {
                  ...existing,
                  reasoning: (existing.reasoning || "") + delta,
                }, ...prev.slice(idx + 1)];
              }
              return [...prev, {
                role: "assistant",
                content: [],
                id: payload.runId,
                timestamp: payload.ts,
                reasoning: delta,
              } as Message];
            });
          }
        } else if (payload.stream === "tool") {
          // Tool call events
          const phase = payload.data.phase as string;
          const toolName = payload.data.name as string;
          if (phase === "start" && toolName) {
            setMessages((prev) => {
              let idx = prev.findIndex((m) => m.id === payload.runId);
              if (idx < 0) idx = prev.findLastIndex((m) => m.role === "assistant");
              if (idx >= 0) {
                const target = prev[idx];
                const toolCallPart: ContentPart = {
                  type: "tool_call",
                  name: toolName,
                  arguments: payload.data.args ? JSON.stringify(payload.data.args) : undefined,
                  status: "running",
                };
                return [...prev.slice(0, idx), {
                  ...target,
                  content: [...(Array.isArray(target.content) ? target.content : []), toolCallPart],
                }, ...prev.slice(idx + 1)];
              }
              return prev;
            });
          } else if ((phase === "end" || phase === "complete") && toolName) {
            const resultText = typeof payload.data.result === "string"
              ? payload.data.result : JSON.stringify(payload.data.result, null, 2);
            const isErr = !!payload.data.error;
            setMessages((prev) => {
              let idx = prev.findIndex((m) => m.id === payload.runId);
              if (idx < 0) idx = prev.findLastIndex((m) => m.role === "assistant");
              if (idx >= 0 && Array.isArray(prev[idx].content)) {
                const target = prev[idx];
                const updatedContent = (target.content as ContentPart[]).map((part) => {
                  if ((part.type === "tool_call" || part.type === "toolCall") && part.name === toolName && !part.result) {
                    return { ...part, status: isErr ? "error" as const : "success" as const, result: resultText, resultError: isErr };
                  }
                  return part;
                });
                return [...prev.slice(0, idx), { ...target, content: updatedContent }, ...prev.slice(idx + 1)];
              }
              return prev;
            });
          }
        }
      }
    }
  }, []);

  const { connectionState, connect, disconnect, sendMessage: sendWSMessage, isConnected } = useWebSocket({
    onMessage: handleWSMessage,
    onOpen: () => {
      setConnectionError(null);
    },
    onError: () => {
      setConnectionError("Connection error");
    },
    onInitialConnectFail: () => {
      setConnectionError("Could not reach server");
      setShowSetup(true);
    },
    onClose: () => {
      setIsStreaming(false);
      setStreamingId(null);
    },
  });

  // Store sendWSMessage in ref to avoid circular dependency
  useEffect(() => {
    sendWSMessageRef.current = sendWSMessage;
  }, [sendWSMessage]);

  // Demo mode: detect ?demo URL param on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("demo")) {
      setIsDemoMode(true);
      setBackendMode("demo");
      setMessages(DEMO_HISTORY);
      setCurrentModel("demo/openclaw-preview");
      setShowSetup(false);
    }
  }, []);

  // Demo mode: create handler with callbacks
  useEffect(() => {
    if (!isDemoMode) {
      demoHandlerRef.current = null;
      return;
    }
    const callbacks: DemoCallbacks = {
      onStreamStart: (runId) => {
        setIsStreaming(true);
        setStreamingId(runId);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: [], id: runId, timestamp: Date.now() },
        ]);
      },
      onThinking: (runId, text) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          return [...prev.slice(0, idx), { ...prev[idx], reasoning: text }, ...prev.slice(idx + 1)];
        });
      },
      onTextDelta: (runId, _delta, fullText) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          // Preserve existing tool_call parts, only update/add the text part
          const existingParts = Array.isArray(target.content) ? target.content : [];
          const nonTextParts = existingParts.filter((p: ContentPart) => p.type !== "text");
          return [
            ...prev.slice(0, idx),
            { ...target, content: [...nonTextParts, { type: "text", text: fullText }] },
            ...prev.slice(idx + 1),
          ];
        });
      },
      onToolStart: (runId, name, args) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          const parts = Array.isArray(target.content) ? target.content : [];
          return [
            ...prev.slice(0, idx),
            { ...target, content: [...parts, { type: "tool_call", name, arguments: args, status: "running" as const }] },
            ...prev.slice(idx + 1),
          ];
        });
      },
      onToolEnd: (runId, name, result, isError) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          if (!Array.isArray(target.content)) return prev;
          const updated = target.content.map((p: ContentPart) =>
            p.type === "tool_call" && p.name === name && p.status === "running"
              ? { ...p, status: (isError ? "error" : "success") as "error" | "success", result, resultError: isError }
              : p
          );
          return [...prev.slice(0, idx), { ...target, content: updated }, ...prev.slice(idx + 1)];
        });
      },
      onStreamEnd: (runId) => {
        setIsStreaming(false);
        setStreamingId(null);
      },
    };
    demoHandlerRef.current = createDemoHandler(callbacks);
  }, [isDemoMode]);

  // LM Studio mode: create handler with callbacks
  useEffect(() => {
    if (backendMode !== "lmstudio" || !lmStudioConfigRef.current) {
      lmStudioHandlerRef.current = null;
      return;
    }
    const config = lmStudioConfigRef.current;
    const callbacks: LmStudioCallbacks = {
      onStreamStart: (runId) => {
        setIsStreaming(true);
        setStreamingId(runId);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: [], id: runId, timestamp: Date.now() },
        ]);
      },
      onThinking: (runId, text, segment) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          const parts = Array.isArray(target.content) ? [...target.content] : [];
          // Find the thinking part for this segment
          let segIdx = 0;
          const thinkPartIdx = parts.findIndex((p) => {
            if (p.type === "thinking") {
              if (segIdx === segment) return true;
              segIdx++;
            }
            return false;
          });
          if (thinkPartIdx >= 0) {
            parts[thinkPartIdx] = { ...parts[thinkPartIdx], text };
          } else {
            // Always push at end — onTextDelta will move text part to end on next update
            parts.push({ type: "thinking", text });
          }
          return [...prev.slice(0, idx), { ...target, content: parts }, ...prev.slice(idx + 1)];
        });
      },
      onTextDelta: (runId, _delta, fullText) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          // Preserve existing non-text parts (tool_call, thinking), update only the text part
          const existingParts = Array.isArray(target.content) ? target.content.filter((p: ContentPart) => p.type !== "text") : [];
          return [
            ...prev.slice(0, idx),
            { ...target, content: [...existingParts, { type: "text", text: fullText }] },
            ...prev.slice(idx + 1),
          ];
        });
      },
      onToolStart: (runId, name, args) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          const parts = Array.isArray(target.content) ? target.content : [];
          return [
            ...prev.slice(0, idx),
            { ...target, content: [...parts, { type: "tool_call", name, arguments: args, status: "running" as const }] },
            ...prev.slice(idx + 1),
          ];
        });
      },
      onToolEnd: (runId, name, result, isError) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === runId);
          if (idx < 0) return prev;
          const target = prev[idx];
          if (!Array.isArray(target.content)) return prev;
          const updated = target.content.map((p: ContentPart) =>
            p.type === "tool_call" && p.name === name && p.status === "running"
              ? { ...p, status: (isError ? "error" : "success") as "error" | "success", result: result || undefined, resultError: isError }
              : p
          );
          return [...prev.slice(0, idx), { ...target, content: updated }, ...prev.slice(idx + 1)];
        });
      },
      onStreamEnd: (runId) => {
        setIsStreaming(false);
        setStreamingId(null);
      },
      onError: (runId, error) => {
        setConnectionError(error);
      },
    };
    // Use currentModel so the handler is recreated when the model changes
    const activeConfig = { ...config, model: currentModel || config.model };
    lmStudioConfigRef.current = activeConfig;
    lmStudioHandlerRef.current = createLmStudioHandler(activeConfig, callbacks);
  }, [backendMode, currentModel]);

  // Track scroll position — continuous CSS var for animations, React state only for pointer-events phase
  const handleScroll = useCallback(() => {
    if (scrollRafId.current != null) return;
    scrollRafId.current = requestAnimationFrame(() => {
      scrollRafId.current = null;
      const el = scrollRef.current;
      const morph = morphRef.current;
      if (!el || !morph) return;
      // Suppress morph updates while pulling to refresh
      if (isPullingRef.current) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      // Update pinned state: consider pinned if within ~80px of bottom
      pinnedToBottomRef.current = distanceFromBottom < 80;
      // While streaming and pinned, lock to input mode — auto-scroll causes
      // distanceFromBottom to fluctuate which would flicker the morph animation
      if (isStreamingRef.current && pinnedToBottomRef.current) {
        morph.style.setProperty("--sp", "0");
        if (scrollPhaseRef.current !== "input") {
          scrollPhaseRef.current = "input";
          setScrollPhase("input");
        }
        return;
      }
      const range = 60;
      const progress = Math.min(Math.max(distanceFromBottom / range, 0), 1);
      morph.style.setProperty("--sp", progress.toFixed(3));
      const newPhase: "input" | "pill" = progress > 0.4 ? "pill" : "input";
      if (newPhase !== scrollPhaseRef.current) {
        scrollPhaseRef.current = newPhase;
        setScrollPhase(newPhase);
      }
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Pull-to-refresh
  const PULL_THRESHOLD = 60;
  const refreshingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  refreshingRef.current = refreshing;

  const setPullTransform = useCallback((dist: number, animate: boolean) => {
    const wrapper = pullContentRef.current;
    const spinner = pullSpinnerRef.current;
    if (!wrapper) return;
    const transition = animate ? "transform 0.45s cubic-bezier(0.22, 0.68, 0.35, 1)" : "none";
    wrapper.style.transition = transition;
    wrapper.style.transform = dist > 0 ? `translateY(${-dist}px)` : "";
    // Spinner fades in as user pulls; animation only runs when visible
    if (spinner) {
      spinner.style.transition = animate ? "opacity 0.3s ease" : "none";
      spinner.style.opacity = dist > 0 ? String(Math.min(dist / (PULL_THRESHOLD * 0.5), 1)) : "0";
      const svg = spinner.querySelector("svg");
      if (svg) svg.style.animation = dist > 0 ? "spin 1s linear infinite" : "none";
    }
  }, []);
  setPullTransformRef.current = setPullTransform;

  const doRefresh = useCallback(() => {
    setRefreshing(true);
    refreshStartRef.current = Date.now();
    // Hold at a small offset to show spinner — bounce back happens when history arrives
    setPullTransform(40, true);
    // LM Studio and demo modes have no server-side history — just bounce back
    if (backendMode === "lmstudio" || backendMode === "demo") {
      setTimeout(() => {
        requestAnimationFrame(() => {
          setPullTransform(0, true);
          setRefreshing(false);
        });
      }, 300);
      return;
    }
    // Re-fetch history (OpenClaw)
    sendWSMessageRef.current?.({
      type: "req",
      id: `history-${Date.now()}`,
      method: "chat.history",
      params: { sessionKey: sessionKeyRef.current },
    } as unknown as WebSocketMessage);
  }, [setPullTransform, backendMode]);

  // Pull-up-to-refresh touch handlers — direct DOM transforms, no React re-renders

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const isAtBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 5;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (isAtBottom()) {
        pullStartYRef.current = e.touches[0].clientY;
        isPullingRef.current = false;
        didVibrateRef.current = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (pullStartYRef.current === null || refreshingRef.current) return;
      if (!isAtBottom() && !isPullingRef.current) {
        pullStartYRef.current = null;
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
        return;
      }
      const deltaY = pullStartYRef.current - e.touches[0].clientY;
      if (deltaY > 0) {
        isPullingRef.current = true;
        // Heavy rubber band — 40% of raw movement, extra resistance past threshold
        const raw = deltaY * 0.4;
        const dist = raw < PULL_THRESHOLD
          ? raw
          : PULL_THRESHOLD + (raw - PULL_THRESHOLD) * 0.15;
        pullDistanceRef.current = dist;
        if (dist >= PULL_THRESHOLD && !didVibrateRef.current) {
          didVibrateRef.current = true;
          navigator.vibrate?.(10);
        }
        setPullTransform(dist, false);
        e.preventDefault();
      } else {
        pullDistanceRef.current = 0;
        setPullTransform(0, false);
      }
    };

    const onTouchEnd = () => {
      if (pullStartYRef.current === null) return;
      pullStartYRef.current = null;
      const wasPulling = isPullingRef.current;
      const dist = pullDistanceRef.current;
      isPullingRef.current = false;
      pullDistanceRef.current = 0;

      if (wasPulling && dist >= PULL_THRESHOLD) {
        // Hold and refresh — bounce back happens when history response arrives
        doRefresh();
      } else {
        // Bounce back smoothly
        setPullTransform(0, true);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [doRefresh, setPullTransform]);

  // iOS Safari height fix — visualViewport.height is the only value that
  // correctly shrinks when the virtual keyboard is open.  We also track the
  // keyboard offset so the fixed-position input bar stays above the keyboard.
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;

    // Lock the container to the initial full-screen height — never change it.
    // iOS reports smaller values when the keyboard opens, but resizing the
    // container is what causes the layout to break.
    if (appRef.current) {
      appRef.current.style.height = `${window.innerHeight}px`;
    }

    const onViewportResize = () => {
      if (!vv) return;
      const offset = Math.round(window.innerHeight - vv.height);
      // Move floating bar immediately via DOM — no React render delay
      if (floatingBarRef.current) {
        floatingBarRef.current.style.bottom = offset > 0 ? `${offset}px` : "0";
      }
      setKeyboardOffset((prev) => prev === offset ? prev : offset);
    };

    vv?.addEventListener("resize", onViewportResize);
    return () => {
      vv?.removeEventListener("resize", onViewportResize);
    };
  }, []);

  // When the keyboard opens, scroll messages to bottom (once)
  const prevKeyboardOffsetRef = useRef(0);
  useEffect(() => {
    const wasOpen = prevKeyboardOffsetRef.current > 0;
    const isOpen = keyboardOffset > 0;
    prevKeyboardOffsetRef.current = keyboardOffset;
    if (isOpen && !wasOpen) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [keyboardOffset]);

  // Check localStorage on mount for previously saved URL and token
  useEffect(() => {
    // Skip auto-connect in demo mode (check URL params directly to avoid race with state)
    if (isDemoMode) return;
    const savedMode = window.localStorage.getItem("mobileclaw-mode") as BackendMode | null;

    if (savedMode === "demo") {
      // Will be handled by the demo mode effect
      return;
    }

    if (savedMode === "lmstudio") {
      const savedUrl = window.localStorage.getItem("lmstudio-url");
      const savedApiKey = window.localStorage.getItem("lmstudio-apikey");
      const savedModel = window.localStorage.getItem("lmstudio-model");
      if (savedUrl && savedModel) {
        setBackendMode("lmstudio");
        const config: LmStudioConfig = { baseUrl: savedUrl, apiKey: savedApiKey || undefined, model: savedModel };
        lmStudioConfigRef.current = config;
        setCurrentModel(savedModel);
        setOpenclawUrl(savedUrl);
      } else {
        setShowSetup(true);
      }
    } else {
      // OpenClaw mode — always show setup dialog (pre-filled from localStorage).
      // Don't auto-connect; let the user explicitly tap Connect.
      setShowSetup(true);
    }
  }, [connect, isDemoMode]);

  const handleConnect = useCallback((config: ConnectionConfig) => {
    setConnectionError(null);
    setMessages([]);

    if (config.mode === "demo") {
      window.localStorage.setItem("mobileclaw-mode", "demo");
      window.localStorage.removeItem("openclaw-url");
      setBackendMode("demo");
      setIsDemoMode(true);
      setMessages(DEMO_HISTORY);
      setCurrentModel("demo/openclaw-preview");
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
      // Disconnect any existing WebSocket
      disconnect();
      return;
    }

    // OpenClaw mode
    window.localStorage.setItem("mobileclaw-mode", "openclaw");
    window.localStorage.setItem("openclaw-url", config.url);
    if (config.token) window.localStorage.setItem("openclaw-token", config.token);
    gatewayTokenRef.current = config.token ?? null;
    setBackendMode("openclaw");
    setIsDemoMode(false);
    lmStudioConfigRef.current = null;
    lmStudioHandlerRef.current = null;
    setOpenclawUrl(config.url);
    let wsUrl = config.url;
    if (!config.url.startsWith("ws://") && !config.url.startsWith("wss://")) {
      wsUrl = config.url.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
    }
    connect(wsUrl);
  }, [connect, disconnect]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    lmStudioHandlerRef.current?.stop();
    lmStudioHandlerRef.current = null;
    lmStudioConfigRef.current = null;
    window.localStorage.removeItem("openclaw-url");
    window.localStorage.removeItem("mobileclaw-mode");
    setOpenclawUrl(null);
    setMessages([]);
    setIsStreaming(false);
    setStreamingId(null);
    setConnectionError(null);
    setBackendMode("openclaw");
  }, [disconnect]);

  // Auto-scroll: on non-streaming message changes (history load, new user message), scroll to bottom
  const hasScrolledInitialRef = useRef(false);
  useEffect(() => {
    if (isStreaming) return; // rAF loop handles streaming scroll
    if (!pinnedToBottomRef.current || messages.length === 0) return;
    if (!hasScrolledInitialRef.current) {
      // First load — instant scroll after layout settles
      hasScrolledInitialRef.current = true;
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Continuous rAF loop during streaming (+ tail-off after) to keep pinned as content grows
  const streamingEndTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (isStreaming) {
      streamingEndTimeRef.current = null;
    } else if (!streamingEndTimeRef.current) {
      // Record when streaming stopped so we can ease out
      streamingEndTimeRef.current = Date.now();
    }
  }, [isStreaming]);

  useEffect(() => {
    // Start the loop when streaming begins
    if (!isStreaming && !streamingEndTimeRef.current) return;

    const tick = () => {
      const el = scrollRef.current;
      if (el && pinnedToBottomRef.current) {
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distFromBottom > 2) {
          // Close 40% of the gap per frame — stops when close enough to avoid oscillation
          el.scrollTop += Math.ceil(distFromBottom * 0.4);
        }
      }
      // Keep running during streaming, or for 500ms after to ease out the typewriter tail
      const endTime = streamingEndTimeRef.current;
      if (isStreaming || (endTime && Date.now() - endTime < 500)) {
        autoScrollRafRef.current = requestAnimationFrame(tick);
      } else {
        autoScrollRafRef.current = null;
      }
    };
    autoScrollRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (autoScrollRafRef.current) cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    };
  }, [isStreaming]);


  const sendMessage = useCallback((text: string) => {
    const userMsg: Message = { role: "user", content: [{ type: "text", text }], id: `u-${Date.now()}`, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    // Demo mode — route through local handler
    if (isDemoMode || backendMode === "demo") {
      demoHandlerRef.current?.sendMessage(text);
      return;
    }

    // LM Studio mode — route through HTTP+SSE handler
    if (backendMode === "lmstudio") {
      // Send the full conversation history (including the new user message) to LM Studio
      setMessages((prev) => {
        // Use a microtask to send after state is updated
        Promise.resolve().then(() => {
          lmStudioHandlerRef.current?.sendMessage(prev);
        });
        return prev;
      });
      return;
    }

    // OpenClaw mode — WebSocket
    if (!isConnected) return;

    // Generate idempotency key for this run
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRunIdRef.current = runId;

    const requestMsg = {
      type: "req",
      id: runId,
      method: "chat.send",
      params: {
        sessionKey: sessionKeyRef.current,
        message: text,
        deliver: true,
        idempotencyKey: runId,
      },
    };
    sendWSMessageRef.current?.(requestMsg as unknown as WebSocketMessage);

    setIsStreaming(true);
  }, [isConnected, isDemoMode, backendMode]);

  const handleCommandSelect = useCallback((command: string) => {
    setPendingCommand(command);
  }, []);

  const clearPendingCommand = useCallback(() => {
    setPendingCommand(null);
  }, []);


  return (
    <div ref={appRef} className="relative flex flex-col overflow-hidden bg-background" style={{ height: "100dvh" }}>
      {/* Setup dialog */}
      <SetupDialog
        onConnect={(config) => {
          setShowSetup(false);
          handleConnect(config);
        }}
        visible={showSetup}
        connectionState={connectionState}
        connectionError={connectionError}
        isDemoMode={isDemoMode}
      />

      {/* Command sheet rendered at root level so backdrop covers entire screen */}
      <CommandSheet
        open={commandsOpen}
        onClose={() => setCommandsOpen(false)}
        onSelect={handleCommandSelect}
      />

      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl md:px-6">
        <button
          type="button"
          onClick={() => setShowSetup(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-accent active:bg-accent"
          aria-label="Open settings"
        >

          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 8c-1.5-1-2.5-3-2-5 1 .5 2.5 1 3.5 2.5M19 8c1.5-1 2.5-3 2-5-1 .5-2.5 1-3.5 2.5" />
            <path d="M4.5 14.5C3 13 2 11 2 9c0-1 .5-2 1.5-2.5C5 6 6.5 7 7 8.5M19.5 14.5C21 13 22 11 22 9c0-1-.5-2-1.5-2.5C19 6 17.5 7 17 8.5" />
            <path d="M7 8.5C8 7 10 6 12 6s4 1 5 2.5" />
            <path d="M7 8.5c-.5 2 0 4 1 5.5l1.5 2c1 1 2.5 1.5 2.5 1.5s1.5-.5 2.5-1.5l1.5-2c1-1.5 1.5-3.5 1-5.5" />
            <circle cx="10" cy="11" r="0.75" fill="currentColor" />
            <circle cx="14" cy="11" r="0.75" fill="currentColor" />
            <path d="M9 20l-1 2M15 20l1 2M12 20v2" />
          </svg>
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-sm font-semibold text-foreground">MobileClaw</h1>
          {currentModel && (
            <p className="truncate text-[11px] text-muted-foreground">{currentModel}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isDemoMode || backendMode === "demo" ? (
            <>
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="text-[11px] text-muted-foreground">Demo</span>
            </>
          ) : backendMode === "lmstudio" ? (
            <>
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-[11px] text-muted-foreground">LM Studio</span>
            </>
          ) : (
            <>
              <span className={`h-2 w-2 rounded-full ${
                connectionState === "connected"
                  ? "bg-green-500"
                  : connectionState === "connecting"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-red-500"
              }`} />
              <span className="text-[11px] text-muted-foreground">
                {connectionState === "connected"
                  ? "Connected"
                  : connectionState === "connecting"
                    ? "Connecting..."
                    : "Disconnected"}
              </span>
            </>
          )}
        </div>
      </header>

      <div ref={pullContentRef} className="flex flex-1 flex-col min-h-0">
      <main
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ overscrollBehavior: "none" }}
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6 pb-28 md:px-6 md:py-4 md:pb-28">
          {messages.map((msg, idx) => {
            const side = getMessageSide(msg.role);
            const prevSide = idx > 0 ? getMessageSide(messages[idx - 1].role) : null;
            const prevTimestamp = idx > 0 ? messages[idx - 1].timestamp : null;
            const isNewTurn = side !== "center" && side !== prevSide;
            const timGap = msg.timestamp && prevTimestamp ? msg.timestamp - prevTimestamp : 0;
            const isTimeGap = timGap > 10 * 60 * 1000;
            const showTimestamp = side !== "center" && (isNewTurn || isTimeGap);
            return (
              <React.Fragment key={msg.id || idx}>
                {isTimeGap && !isNewTurn && msg.timestamp && (
                  <div className="flex justify-center py-1">
                    <span className="text-[10px] text-muted-foreground/60">{formatMessageTime(msg.timestamp)}</span>
                  </div>
                )}
                {showTimestamp && isNewTurn && msg.timestamp && (
                  <p className={`text-[10px] text-muted-foreground/60 ${side === "right" ? "text-right" : "text-left"}`}>
                    {formatMessageTime(msg.timestamp)}
                  </p>
                )}
                <MessageRow message={msg} isStreaming={isStreaming && msg.id === streamingId} />
              </React.Fragment>
            );
          })}
          {isStreaming && !streamingId && <ThinkingIndicator />}
          <div ref={bottomRef} />
        </div>
      </main>
      {/* Pull-to-refresh spinner — inside pullContentRef so it translates up with the content.
          h-0 + overflow-visible: no layout space, renders upward into the revealed gap. */}
      <div
        ref={pullSpinnerRef}
        className="flex h-0 items-center justify-center gap-2 overflow-visible"
        style={{ opacity: 0, transform: "translateY(calc(-3dvh - 23px))" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground" style={{ animation: "none" }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span className="text-sm leading-none">🦞</span>
      </div>
      </div>

      {/* Floating morphing bar -- driven by continuous scrollProgress (0=bottom, 1=scrolled) */}
      <div
        ref={floatingBarRef}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[3dvh] md:px-6 md:pb-[3dvh]"
      >
        <div ref={morphRef} className="pointer-events-auto w-full" style={{ "--sp": "0", maxWidth: "min(calc(200px + (100% - 200px) * (1 - var(--sp, 0))), 42rem)" } as React.CSSProperties}>
          <ChatInput
            onSend={sendMessage}
            onOpenCommands={() => setCommandsOpen(true)}
            commandValue={pendingCommand}
            onCommandValueUsed={clearPendingCommand}
            scrollPhase={scrollPhase}
            onScrollToBottom={scrollToBottom}
          />
        </div>
      </div>
    </div>
  );
}
