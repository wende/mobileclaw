"use client";

import { useState, useCallback, useRef } from "react";
import type { ChatMessage, MessageContent } from "@/lib/chat-types";

const DUMMY_SESSION: ChatMessage[] = [
  {
    role: "user",
    content: [
      {
        type: "text",
        text: "Hi! Can you help me understand this codebase?",
      },
    ],
    timestamp: 1707234000000,
    id: "msg-001",
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Hello! I'd be happy to help you understand the codebase. Let me explore the structure for you.",
      },
    ],
    timestamp: 1707234005000,
    id: "msg-002",
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Let me check the project structure first.",
      },
      {
        type: "tool_call",
        name: "list_directory",
        arguments: '{"path": "."}',
      },
    ],
    timestamp: 1707234010000,
    id: "msg-003",
  },
  {
    role: "toolResult",
    content: [
      {
        type: "tool_result",
        name: "list_directory",
        text: "src/\npackage.json\nREADME.md\ntsconfig.json",
      },
    ],
    timestamp: 1707234011000,
    id: "msg-004",
    toolCallId: "call-001",
    toolName: "list_directory",
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Now let me check the package.json to understand the project better.",
      },
      {
        type: "tool_call",
        name: "read_file",
        arguments: '{"path": "package.json"}',
      },
    ],
    timestamp: 1707234015000,
    id: "msg-005",
  },
  {
    role: "toolResult",
    content: [
      {
        type: "tool_result",
        name: "read_file",
        text: '{"name": "my-project", "version": "1.0.0", "dependencies": {}}',
      },
    ],
    timestamp: 1707234016000,
    id: "msg-006",
    toolCallId: "call-002",
    toolName: "read_file",
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Based on my analysis, this is a TypeScript project with:\n\n- **Source code** in `src/`\n- Standard Node.js project structure\n- TypeScript configuration\n\nWould you like me to explore any specific part?",
      },
    ],
    timestamp: 1707234020000,
    id: "msg-007",
    stopReason: "end_turn",
  },
];

const FOLLOW_UP_RESPONSES: Record<string, string> = {
  default:
    "Here's my analysis of the codebase:\n\n1. **Architecture**: The project uses a modular design\n2. **Key Components**: Gateway, UI, and Agent subsystems\n3. **Recommendations**: Consider adding more unit tests\n\n```typescript\nfunction calculateTotal(items: Item[]): number {\n  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n}\n```\n\nThis pattern is used consistently throughout the project for data transformations.",
  refactor:
    "Here's the refactored version:\n\n```typescript\nfunction calculateTotal(items: Item[]): number {\n  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n}\n```\n\nThe key changes are:\n- **Simplified logic** with `reduce`\n- **Type safety** with proper TypeScript annotations\n- **Immutability** by avoiding mutations",
  weather:
    "I'll check the current weather for you.\n\nCurrent weather in San Francisco, CA:\n- **Temperature**: 18C\n- **Conditions**: Partly cloudy\n- **Humidity**: 65%",
  files:
    "**Results:**\n\nFound **5 TypeScript files** in the `src` directory with a total of **1,250 lines of code**.\n\n| File | Lines |\n|------|-------|\n| src/index.ts | ~50 |\n| src/utils/helpers.ts | ~200 |\n| src/components/Button.ts | ~300 |\n| src/components/Modal.ts | ~400 |\n| src/services/api.ts | ~300 |",
};

function getResponse(input: string): string {
  const lower = input.toLowerCase();
  if (lower.includes("refactor")) return FOLLOW_UP_RESPONSES.refactor;
  if (lower.includes("weather")) return FOLLOW_UP_RESPONSES.weather;
  if (lower.includes("file") || lower.includes("typescript"))
    return FOLLOW_UP_RESPONSES.files;
  return FOLLOW_UP_RESPONSES.default;
}

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>(DUMMY_SESSION);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null
  );
  const abortRef = useRef(false);
  const timeoutRefs = useRef<NodeJS.Timeout[]>([]);

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

      const assistantId = `msg-assistant-${Date.now()}`;
      const responseText = getResponse(text);

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingMessageId(assistantId);

      // Create the initial empty assistant message
      const t1 = setTimeout(() => {
        if (abortRef.current) return;
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: [{ type: "text", text: "" }],
          timestamp: Date.now(),
          id: assistantId,
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // Stream character by character
        const words = responseText.split(/(?<=\s)/);
        let currentText = "";
        let delay = 300;

        for (const word of words) {
          const t = setTimeout(() => {
            if (abortRef.current) return;
            currentText += word;
            const streamText = currentText;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: [
                        { type: "text", text: streamText } as MessageContent,
                      ],
                    }
                  : m
              )
            );
          }, delay);
          timeoutRefs.current.push(t);
          delay += 15 + Math.random() * 35;
        }

        // Finalize
        const tFinal = setTimeout(
          () => {
            if (abortRef.current) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: [
                        { type: "text", text: responseText } as MessageContent,
                      ],
                      stopReason: "end_turn",
                      usage: {
                        input: 150,
                        output: responseText.length,
                        totalTokens: 150 + responseText.length,
                      },
                    }
                  : m
              )
            );
            setIsStreaming(false);
            setStreamingMessageId(null);
          },
          delay + 100
        );
        timeoutRefs.current.push(tFinal);
      }, 600);
      timeoutRefs.current.push(t1);
    },
    [isStreaming]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current = true;
    clearTimeouts();
    setIsStreaming(false);
    setStreamingMessageId(null);
  }, [clearTimeouts]);

  return {
    messages,
    isStreaming,
    streamingMessageId,
    sendMessage,
    stopStreaming,
  };
}
