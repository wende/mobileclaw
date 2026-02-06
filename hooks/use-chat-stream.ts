"use client";

import { useState, useCallback, useRef } from "react";
import type { ChatMessage, MessageContent } from "@/lib/chat-types";

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    role: "system",
    content: [{ type: "text", text: "Showing last 200 messages (50 hidden)." }],
    timestamp: 1707234000000,
    id: "msg-system-001",
  },
  {
    role: "user",
    content: [{ type: "text", text: "Hi! Can you help me understand this codebase?" }],
    timestamp: 1707234001000,
    id: "msg-001",
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "Hello! I'd be happy to help you understand the codebase. Let me explore the structure for you." }],
    timestamp: 1707234005000,
    id: "msg-002",
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Let me check the project structure first." },
      { type: "tool_call", name: "list_directory", arguments: '{"path": "."}' },
    ],
    timestamp: 1707234010000,
    id: "msg-003",
  },
  {
    role: "toolResult",
    content: [{ type: "tool_result", name: "list_directory", text: "src/\npackage.json\nREADME.md\ntsconfig.json" }],
    timestamp: 1707234011000,
    id: "msg-004",
    toolCallId: "call-001",
    toolName: "list_directory",
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Now let me check the package.json to understand the project better." },
      { type: "tool_call", name: "read_file", arguments: '{"path": "package.json"}' },
    ],
    timestamp: 1707234015000,
    id: "msg-005",
  },
  {
    role: "toolResult",
    content: [{ type: "tool_result", name: "read_file", text: '{"name": "my-project", "version": "1.0.0", "dependencies": {}}' }],
    timestamp: 1707234016000,
    id: "msg-006",
    toolCallId: "call-002",
    toolName: "read_file",
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "Based on my analysis, this is a TypeScript project with:\n\n- **Source code** in `src/`\n- Standard Node.js project structure\n- TypeScript configuration\n\nWould you like me to explore any specific part?" }],
    timestamp: 1707234020000,
    id: "msg-007",
    stopReason: "end_turn",
    usage: { input: 150, output: 85, totalTokens: 235 },
  },
];

const RESPONSES: Record<string, { text: string; reasoning?: string; toolCall?: { name: string; args: string }; toolResult?: { name: string; text: string } }> = {
  refactor: {
    text: "Here's the refactored version:\n\n```typescript\nfunction calculateTotal(items: Item[]): number {\n  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n}\n```\n\nThe key changes are:\n- **Simplified logic** with `reduce`\n- **Type safety** with proper TypeScript annotations\n- **Immutability** by avoiding mutations",
    reasoning: "Let me work through this step by step. First, I need to understand what the question is asking...",
  },
  weather: {
    text: "I'll check the current weather for you.",
    toolCall: { name: "get_weather", args: '{"location": "San Francisco, CA", "units": "celsius"}' },
    toolResult: { name: "get_weather", text: "Current weather in San Francisco, CA:\nTemperature: 18C\nConditions: Partly cloudy\nHumidity: 65%" },
  },
  file: {
    text: "I'll help you find TypeScript files and count lines of code.",
    toolCall: { name: "execute_command", args: '{"command": "find src -name \'*.ts\' -type f", "timeout": 30000}' },
    toolResult: { name: "execute_command", text: "src/index.ts\nsrc/utils/helpers.ts\nsrc/components/Button.ts\nsrc/components/Modal.ts\nsrc/services/api.ts" },
  },
  error: {
    text: "Let me try running that command for you.",
    toolCall: { name: "execute_command", args: '{"command": "cat /path/to/file.txt"}' },
    toolResult: { name: "execute_command", text: "Error: Command failed with exit code 1\nstderr: File not found: /path/to/file.txt" },
  },
  default: {
    text: "# Heading 1\n\n## Heading 2\n\n**Bold text** and *italic text*\n\n```typescript\nconst x: number = 42;\nconsole.log(x);\n```\n\n- List item 1\n- List item 2\n\n> Blockquote\n\n[Link](https://example.com)\n\n| Table | Header |\n|-------|--------|\n| Cell1 | Cell2  |",
  },
};

function pickResponse(input: string) {
  const lower = input.toLowerCase();
  if (lower.includes("refactor")) return RESPONSES.refactor;
  if (lower.includes("weather")) return RESPONSES.weather;
  if (lower.includes("file") || lower.includes("typescript")) return RESPONSES.file;
  if (lower.includes("error") || lower.includes("fail")) return RESPONSES.error;
  return RESPONSES.default;
}

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const abortRef = useRef(false);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimeouts = useCallback(() => {
    for (const t of timeoutRefs.current) clearTimeout(t);
    timeoutRefs.current = [];
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      if (isStreaming) return;
      abortRef.current = false;

      const userMsg: ChatMessage = {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: Date.now(),
        id: `msg-user-${Date.now()}`,
      };

      const response = pickResponse(text);
      const assistantId = `msg-assistant-${Date.now()}`;
      const hasToolCall = !!response.toolCall;
      const isErrorResult = text.toLowerCase().includes("error") || text.toLowerCase().includes("fail");

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingMessageId(assistantId);

      let totalDelay = 500;

      // Step 1: If there's a reasoning block, show it first
      if (response.reasoning) {
        const t = setTimeout(() => {
          if (abortRef.current) return;
          const msg: ChatMessage = {
            role: "assistant",
            content: [{ type: "text", text: "" }],
            timestamp: Date.now(),
            id: assistantId,
            reasoning: response.reasoning,
          };
          setMessages((prev) => [...prev, msg]);
        }, totalDelay);
        timeoutRefs.current.push(t);
        totalDelay += 800;
      }

      // Step 2: Create assistant message and stream text (or tool_call if applicable)
      if (hasToolCall) {
        // Show tool call message
        const t = setTimeout(() => {
          if (abortRef.current) return;
          const msg: ChatMessage = {
            role: "assistant",
            content: [
              { type: "text", text: response.text },
              { type: "tool_call", name: response.toolCall!.name, arguments: response.toolCall!.args },
            ],
            timestamp: Date.now(),
            id: response.reasoning ? assistantId : assistantId,
          };
          if (response.reasoning) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? msg : m))
            );
          } else {
            setMessages((prev) => [...prev, msg]);
          }
        }, totalDelay);
        timeoutRefs.current.push(t);
        totalDelay += 1000;

        // Show tool result
        const toolResultId = `msg-tool-${Date.now()}`;
        const tResult = setTimeout(() => {
          if (abortRef.current) return;
          const toolMsg: ChatMessage = {
            role: "toolResult",
            content: [{ type: "tool_result", name: response.toolResult!.name, text: response.toolResult!.text }],
            timestamp: Date.now(),
            id: toolResultId,
            toolCallId: `call-${Date.now()}`,
            toolName: response.toolResult!.name,
            isError: isErrorResult,
          };
          setMessages((prev) => [...prev, toolMsg]);
        }, totalDelay);
        timeoutRefs.current.push(tResult);
        totalDelay += 800;

        // Finalize
        const tFinal = setTimeout(() => {
          if (abortRef.current) return;
          setIsStreaming(false);
          setStreamingMessageId(null);
        }, totalDelay);
        timeoutRefs.current.push(tFinal);
      } else {
        // Stream text word by word
        const responseText = response.text;
        const words = responseText.split(/(?<=\s)/);

        const tCreate = setTimeout(() => {
          if (abortRef.current) return;
          if (!response.reasoning) {
            const msg: ChatMessage = {
              role: "assistant",
              content: [{ type: "text", text: "" }],
              timestamp: Date.now(),
              id: assistantId,
            };
            setMessages((prev) => [...prev, msg]);
          }
        }, totalDelay);
        timeoutRefs.current.push(tCreate);
        totalDelay += 100;

        let accumulated = "";
        for (const word of words) {
          const capturedText = accumulated + word;
          accumulated = capturedText;
          const t = setTimeout(() => {
            if (abortRef.current) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: [{ type: "text", text: capturedText } as MessageContent] }
                  : m
              )
            );
          }, totalDelay);
          timeoutRefs.current.push(t);
          totalDelay += 20 + Math.random() * 40;
        }

        // Finalize with usage
        const tFinal = setTimeout(() => {
          if (abortRef.current) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: [{ type: "text", text: responseText } as MessageContent],
                    stopReason: "end_turn",
                    usage: { input: 150, output: responseText.length, totalTokens: 150 + responseText.length },
                  }
                : m
            )
          );
          setIsStreaming(false);
          setStreamingMessageId(null);
        }, totalDelay + 100);
        timeoutRefs.current.push(tFinal);
      }
    },
    [isStreaming]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current = true;
    clearTimeouts();
    setIsStreaming(false);
    setStreamingMessageId(null);
  }, [clearTimeouts]);

  return { messages, isStreaming, streamingMessageId, sendMessage, stopStreaming };
}
