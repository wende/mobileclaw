import { describe, expect, it } from "vitest";

import { buildHistoryMessages, mergeHistoryWithOptimistic, prepareHistoryMessages } from "@mc/lib/chat/historyResponse";
import type { Message } from "@mc/types/chat";

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

  it("preserves command-response rendering flag across history reconciliation", () => {
    const previous: Message[] = [
      {
        role: "assistant",
        id: "run-cmd",
        timestamp: 2000,
        content: [{ type: "text", text: "Started a new conversation." }],
        isCommandResponse: true,
      },
    ];

    const history: Message[] = [
      {
        role: "assistant",
        id: "hist-1",
        timestamp: 2000,
        content: [{ type: "text", text: "Started a new conversation." }],
        stopReason: "injected",
      },
    ];

    const merged = mergeHistoryWithOptimistic(history, previous);
    expect(merged).toHaveLength(1);
    expect(merged[0].isCommandResponse).toBe(true);
    expect(merged[0].id).toBe("run-cmd");
  });

  it("does not carry hist-* IDs across index shifts (prevents duplicate keys)", () => {
    // Previous render had hist-40 = "Hello" and hist-41 = "World"
    const previous: Message[] = [
      { role: "assistant", id: "hist-40", timestamp: 1000, content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", id: "hist-41", timestamp: 2000, content: [{ type: "text", text: "World" }] },
    ];

    // Re-fetch shifted indices: hist-41 = "Hello", hist-42 = "World"
    const history: Message[] = [
      { role: "user", id: "hist-40", timestamp: 500, content: [{ type: "text", text: "New msg" }] },
      { role: "assistant", id: "hist-41", timestamp: 1000, content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", id: "hist-42", timestamp: 2000, content: [{ type: "text", text: "World" }] },
    ];

    const merged = mergeHistoryWithOptimistic(history, previous);
    const ids = merged.map((m) => m.id);
    // All IDs must be unique — no duplicates
    expect(new Set(ids).size).toBe(ids.length);
    // hist-* IDs should NOT be overwritten by old hist-* IDs
    expect(ids).toContain("hist-41");
    expect(ids).toContain("hist-42");
  });

  it("preserves streaming assistant message when history does not include it yet", () => {
    const previous: Message[] = [
      { role: "assistant", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Ready" }] },
      { role: "user", id: "u-1", timestamp: 2000, content: [{ type: "text", text: "Create a flow" }] },
      {
        role: "assistant",
        id: "run-abc",
        timestamp: 2001,
        content: [
          { type: "text", text: "Sure, here's the flow." },
          { type: "plugin", partId: "pause-1", pluginType: "pause_card", state: "active", data: { prompt: "Pick one" } },
        ],
      },
    ];

    // History has the user message but the assistant run hasn't completed yet
    const history: Message[] = [
      { role: "assistant", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Ready" }] },
      { role: "user", id: "hist-1", timestamp: 2000, content: [{ type: "text", text: "Create a flow" }] },
    ];

    const merged = mergeHistoryWithOptimistic(history, previous);
    expect(merged).toHaveLength(3);
    const streaming = merged.find((m) => m.id === "run-abc");
    expect(streaming).toBeDefined();
    expect(streaming!.role).toBe("assistant");
    const plugin = (streaming!.content as Array<{ type: string }>).find((p) => p.type === "plugin");
    expect(plugin).toBeDefined();
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

describe("buildHistoryMessages", () => {
  it("prefers stable server ids and normalizes legacy canvas payloads into plugin parts", () => {
    const history = buildHistoryMessages([
      {
        role: "assistant",
        messageId: "msg-1",
        content: [{ type: "text", text: "Deployment started." }],
        canvas: {
          type: "status_card",
          state: "active",
          data: { label: "Deploy", status: "running" },
        },
        timestamp: 1000,
      },
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("msg-1");
    expect(Array.isArray(history[0].content)).toBe(true);
    const parts = history[0].content as Array<{ type: string; pluginType?: string; partId?: string }>;
    expect(parts.some((part) => part.type === "plugin" && part.pluginType === "status_card" && part.partId === "legacy-canvas:status_card")).toBe(true);
  });

  it("falls back to run ids when stable message ids are missing", () => {
    const history = buildHistoryMessages([
      {
        role: "assistant",
        runId: "run-123",
        content: [{ type: "text", text: "Fallback id" }],
        timestamp: 1000,
      },
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("run-123");
  });

  it("uses role-qualified run ids for non-assistant history entries without message ids", () => {
    const history = buildHistoryMessages([
      {
        role: "user",
        runId: "run-123",
        content: [{ type: "text", text: "Fallback id" }],
        timestamp: 1000,
      },
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("run-123:user");
  });

  it("keeps canvas-only messages even when there is no text content", () => {
    const history = buildHistoryMessages([
      {
        role: "assistant",
        runId: "run-canvas-only",
        content: [],
        canvas: {
          type: "status_card",
          state: "active",
          data: { label: "Deploy", status: "running" },
        },
        timestamp: 1000,
      },
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("run-canvas-only");
    expect(history[0].content).toEqual([
      expect.objectContaining({
        type: "plugin",
        partId: "legacy-canvas:status_card",
        pluginType: "status_card",
        state: "active",
        data: { label: "Deploy", status: "running" },
      }),
    ]);
  });

  it("namespaces legacy canvas part ids so they do not collide with existing plugin parts", () => {
    const history = buildHistoryMessages([
      {
        role: "assistant",
        messageId: "msg-canvas-collision",
        content: [
          {
            type: "plugin",
            partId: "canvas",
            pluginType: "pause_card",
            state: "active",
            data: { prompt: "Resume?" },
          },
        ],
        canvas: {
          type: "status_card",
          state: "active",
          data: { label: "Deploy", status: "running" },
        },
        timestamp: 1000,
      },
    ]);

    const parts = history[0].content as Array<{ type: string; pluginType?: string; partId?: string }>;
    expect(parts.filter((part) => part.type === "plugin")).toHaveLength(2);
    expect(parts.some((part) => part.pluginType === "pause_card" && part.partId === "canvas")).toBe(true);
    expect(parts.some((part) => part.pluginType === "status_card" && part.partId === "legacy-canvas:status_card")).toBe(true);
  });
});
