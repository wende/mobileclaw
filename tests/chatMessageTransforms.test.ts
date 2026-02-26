import { describe, it, expect } from "vitest";

import {
  buildDisplayMessages,
  isUnreadCandidateMessage,
  mergeAndNormalizeToolResults,
} from "@/lib/chat/messageTransforms";
import type { ContentPart, Message } from "@/types/chat";

function assistant(content: Message["content"], extra: Partial<Message> = {}): Message {
  return { role: "assistant", content, id: `a-${Math.random()}`, ...extra };
}

describe("chat message transforms", () => {
  it("merges tool result messages into prior assistant tool call", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        id: "run-1",
        content: [{ type: "tool_call", name: "read", arguments: { path: "README.md" } as unknown as string }],
      },
      {
        role: "tool_result",
        id: "tool-msg-1",
        toolName: "read",
        content: JSON.stringify({ status: "ok", value: "contents" }),
      },
    ];

    const merged = mergeAndNormalizeToolResults(messages);
    expect(merged).toHaveLength(1);
    expect(Array.isArray(merged[0].content)).toBe(true);
    const tool = (merged[0].content as ContentPart[])[0];
    expect(tool.status).toBe("success");
    expect(tool.result).toContain("contents");
    expect(typeof tool.arguments).toBe("string");
  });

  it("flags unread candidates only for meaningful assistant/system content", () => {
    expect(isUnreadCandidateMessage(assistant([{ type: "text", text: "hi" }]))).toBe(true);
    expect(isUnreadCandidateMessage(assistant([], { isHidden: true }))).toBe(false);
    expect(isUnreadCandidateMessage(assistant([{ type: "text", text: "silent" }], { stopReason: "injected" }))).toBe(false);
    expect(isUnreadCandidateMessage({ role: "user", content: "yo" })).toBe(false);
  });

  it("merges heartbeat marker message with prior assistant message in display output", () => {
    const input: Message[] = [
      {
        role: "assistant",
        id: "a1",
        content: [{ type: "text", text: "before heartbeat" }],
      },
      {
        role: "assistant",
        id: "a2",
        content: [{ type: "text", text: "HEARTBEAT_OK" }],
      },
    ];

    const display = buildDisplayMessages(input);
    expect(display).toHaveLength(1);
    expect((display[0].content as Array<{ type: string; text?: string }>).map((p) => p.text).join(" ")).toContain("before heartbeat");
    expect((display[0].content as Array<{ type: string; text?: string }>).map((p) => p.text).join(" ")).toContain("HEARTBEAT_OK");
  });
});
