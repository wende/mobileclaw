import { describe, expect, it } from "vitest";

import { mergeHistoryWithOptimistic, prepareHistoryMessages } from "@/lib/chat/historyResponse";
import type { Message } from "@/types/chat";

describe("mergeHistoryWithOptimistic", () => {
  it("keeps already-rendered realtime messages when history snapshot lags", () => {
    const previous: Message[] = [
      { role: "user", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", id: "hist-1", timestamp: 1001, content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", id: "run-2", timestamp: 1002, content: [{ type: "text", text: "Fresh realtime reply" }] },
    ];

    const staleHistory: Message[] = [
      { role: "user", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", id: "hist-1", timestamp: 1001, content: [{ type: "text", text: "Hello" }] },
    ];

    expect(mergeHistoryWithOptimistic(staleHistory, previous)).toEqual(previous);
  });

  it("preserves optimistic u-* ID when history includes the same user message", () => {
    const previous: Message[] = [
      { role: "assistant", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Ready" }] },
      { role: "user", id: "u-2000", timestamp: 2000, content: [{ type: "text", text: "Hello world" }] },
    ];

    const history: Message[] = [
      { role: "assistant", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Ready" }] },
      { role: "user", id: "hist-1", timestamp: 2000, content: [{ type: "text", text: "Hello world" }] },
      { role: "assistant", id: "hist-2", timestamp: 2001, content: [{ type: "text", text: "Hi!" }] },
    ];

    const merged = mergeHistoryWithOptimistic(history, previous);
    expect(merged).toHaveLength(3);
    // The user message should keep its optimistic ID, not the hist-1 from server
    expect(merged[1].id).toBe("u-2000");
  });

  it("preserves streaming assistant ID when history assigns a new hist-* ID", () => {
    const previous: Message[] = [
      { role: "user", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", id: "run-abc", timestamp: 1001, content: [{ type: "text", text: "Hello!" }] },
    ];

    const history: Message[] = [
      { role: "user", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", id: "hist-1", timestamp: 1001, content: [{ type: "text", text: "Hello!" }] },
    ];

    const merged = mergeHistoryWithOptimistic(history, previous);
    expect(merged).toHaveLength(2);
    // The assistant message should keep its streaming ID, not hist-1 from server
    expect(merged[1].id).toBe("run-abc");
  });

  it("still appends optimistic user messages that are missing from history", () => {
    const previous: Message[] = [
      { role: "assistant", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Ready" }] },
      { role: "user", id: "u-1", timestamp: 1001, content: [{ type: "text", text: "Pending send" }] },
    ];

    const history: Message[] = [
      { role: "assistant", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Ready" }] },
    ];

    const merged = mergeHistoryWithOptimistic(history, previous);
    expect(merged).toHaveLength(2);
    expect(merged[1].id).toBe("u-1");
  });
});

describe("prepareHistoryMessages", () => {
  it("filters internal cmdfetch runs without relying on assistant text prefixes", () => {
    const allRawMessages = [
      { role: "user", content: [{ type: "text", text: "hello" }], runId: "run-1" },
      { role: "assistant", content: [{ type: "text", text: "world" }], runId: "run-1" },
      { role: "user", content: [{ type: "text", text: "/commands" }], runId: "cmdfetch-100" },
      { role: "assistant", content: [{ type: "text", text: "not prefixed output /status /model /foo /bar /baz /qux /quux /corge" }], runId: "cmdfetch-100" },
    ] as Array<Record<string, unknown>>;

    const result = prepareHistoryMessages({
      allRawMessages,
      parseServerCommands: () => [],
      coreCommandNames: new Set<string>(),
    });

    expect(result.rawMessages).toHaveLength(2);
    expect(result.rawMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it.each(["run_id", "idempotencyKey", "idempotency_key", "id"] as const)(
    "filters internal cmdfetch runs when id is stored in %s",
    (fieldName) => {
      const allRawMessages = [
        { role: "user", content: [{ type: "text", text: "hello" }], runId: "run-1" },
        { role: "assistant", content: [{ type: "text", text: "world" }], runId: "run-1" },
        { role: "user", content: [{ type: "text", text: "/commands" }], [fieldName]: "cmdfetch-200" },
        { role: "assistant", content: [{ type: "text", text: "server commands..." }], [fieldName]: "cmdfetch-200" },
      ] as Array<Record<string, unknown>>;

      const result = prepareHistoryMessages({
        allRawMessages,
        parseServerCommands: () => [],
        coreCommandNames: new Set<string>(),
      });

      expect(result.rawMessages).toHaveLength(2);
      expect(result.rawMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    },
  );
});
