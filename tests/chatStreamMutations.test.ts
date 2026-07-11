import { describe, it, expect } from "vitest";

import {
  addToolCall,
  appendContentDelta,
  appendThinkingDelta,
  mountPluginPart,
  removePluginPart,
  replacePluginPart,
  resolveToolCall,
  upsertFinalRunMessage,
  startThinkingBlock,
} from "@mc/lib/chat/streamMutations";
import { upsertChatEventMessage } from "@mc/lib/chat/chatEventUpsert";
import type { Message, PluginContentPart } from "@mc/types/chat";

describe("chat stream mutations", () => {
  it("appends text after tool call boundary without destroying earlier text", () => {
    const initial: Message[] = [{
      role: "assistant",
      id: "run-1",
      content: [
        { type: "text", text: "before" },
        { type: "tool_call", name: "read", status: "running" },
      ],
    }];

    const step1 = appendContentDelta(initial, "run-1", " after", Date.now());
    const parts1 = step1.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts1.map((p) => p.text || "").join(" ")).toContain("before");
    expect(parts1[2]?.text).toBe(" after");

    const step2 = appendContentDelta(step1.messages, "run-1", " more", Date.now());
    const parts2 = step2.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts2[2]?.text).toBe(" after more");
  });

  it("adds and extends thinking deltas by segment", () => {
    const initial: Message[] = [{ role: "assistant", id: "run-2", content: [] }];
    const step1 = appendThinkingDelta(initial, "run-2", "plan", Date.now());
    const step2 = appendThinkingDelta(step1.messages, "run-2", " now", Date.now());

    const parts = step2.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("thinking");
    expect(parts[0].text).toBe("plan now");
  });

  it("starts a new empty thinking block and fills it with follow-up deltas", () => {
    const initial: Message[] = [{ role: "assistant", id: "run-think", content: [{ type: "thinking", text: "first block" }] }];
    const started = startThinkingBlock(initial, "run-think", Date.now());
    const updated = appendThinkingDelta(started.messages, "run-think", " second", Date.now());

    const parts = updated.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts).toHaveLength(2);
    expect(parts[0].text).toBe("first block");
    expect(parts[1].type).toBe("thinking");
    expect(parts[1].text).toBe(" second");
  });

  it("does not duplicate consecutive empty thinking placeholders", () => {
    const initial: Message[] = [{ role: "assistant", id: "run-empty", content: [] }];
    const step1 = startThinkingBlock(initial, "run-empty", Date.now());
    const step2 = startThinkingBlock(step1.messages, "run-empty", Date.now());

    const parts = step2.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("thinking");
    expect(parts[0].text).toBe("");
  });

  it("handles cumulative snapshot deltas without duplicating text", () => {
    const initial: Message[] = [{ role: "assistant", id: "run-dup", content: [] }];
    const step1 = appendContentDelta(initial, "run-dup", "Let", Date.now());
    const step2 = appendContentDelta(step1.messages, "run-dup", "Lets See", Date.now());
    const step3 = appendContentDelta(step2.messages, "run-dup", "Lets See what's in the file", Date.now());

    const parts = step3.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toBe("Lets See what's in the file");
  });

  it("treats plugin parts as text boundaries", () => {
    const initial: Message[] = [{
      role: "assistant",
      id: "run-plugin-boundary",
      content: [
        { type: "text", text: "before" },
        { type: "plugin", partId: "status-1", pluginType: "status_card", state: "active", data: { label: "Deploy", status: "running" } },
      ],
    }];

    const next = appendContentDelta(initial, "run-plugin-boundary", " after", Date.now());
    const parts = next.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts).toHaveLength(3);
    expect(parts[0].text).toBe("before");
    expect(parts[2].text).toBe(" after");
  });

  it("still appends normal repeated incremental chunks", () => {
    const initial: Message[] = [{ role: "assistant", id: "run-repeat", content: [] }];
    const step1 = appendContentDelta(initial, "run-repeat", "ha", Date.now());
    const step2 = appendContentDelta(step1.messages, "run-repeat", "ha", Date.now());

    const parts = step2.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts[0].text).toBe("haha");
  });

  it("resolves tool calls by toolCallId and by name fallback", () => {
    const created = addToolCall([], "run-3", "write", Date.now(), "tc-1", "{}");
    const byId = resolveToolCall(created.messages, "run-3", "write", "tc-1", "ok", false);
    const partById = (byId[0].content as Array<{ status?: string; result?: string }>)[0];
    expect(partById.status).toBe("success");
    expect(partById.result).toBe("ok");

    const noIdInitial = addToolCall([], "run-4", "edit", Date.now());
    const byName = resolveToolCall(noIdInitial.messages, "run-4", "edit", undefined, "done", false);
    const partByName = (byName[0].content as Array<{ status?: string; result?: string }>)[0];
    expect(partByName.status).toBe("success");
    expect(partByName.result).toBe("done");
  });

  it("mounts, replaces, and tombstones plugin parts", () => {
    const pluginPart: PluginContentPart = {
      type: "plugin",
      partId: "status-1",
      pluginType: "status_card",
      state: "pending",
      data: { label: "Build", status: "pending" },
      revision: 1,
    };

    const mounted = mountPluginPart([], "run-plugin", pluginPart, Date.now());
    const replaced = replacePluginPart(mounted.messages, "run-plugin", "status-1", {
      state: "active",
      data: { label: "Build", status: "running" },
      revision: 2,
    });
    const tombstoned = removePluginPart(replaced, "run-plugin", "status-1", true);

    const parts = tombstoned[0].content as PluginContentPart[];
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("plugin");
    expect(parts[0].state).toBe("tombstone");
    expect(parts[0].revision).toBe(2);
  });

  it("ignores plugin replacements with an older revision", () => {
    const pluginPart: PluginContentPart = {
      type: "plugin",
      partId: "status-1",
      pluginType: "status_card",
      state: "active",
      data: { label: "Build", status: "running" },
      revision: 3,
    };

    const mounted = mountPluginPart([], "run-plugin-stale", pluginPart, Date.now());
    const stale = replacePluginPart(mounted.messages, "run-plugin-stale", "status-1", {
      state: "settled",
      data: { label: "Build", status: "succeeded" },
      revision: 2,
    });

    const parts = stale[0].content as PluginContentPart[];
    expect(parts).toHaveLength(1);
    expect(parts[0].state).toBe("active");
    expect(parts[0].data).toEqual({ label: "Build", status: "running" });
    expect(parts[0].revision).toBe(3);
  });

  it("allows plugin replacements without a revision", () => {
    const pluginPart: PluginContentPart = {
      type: "plugin",
      partId: "status-1",
      pluginType: "status_card",
      state: "active",
      data: { label: "Build", status: "running" },
      revision: 3,
    };

    const mounted = mountPluginPart([], "run-plugin-unversioned", pluginPart, Date.now());
    const replaced = replacePluginPart(mounted.messages, "run-plugin-unversioned", "status-1", {
      state: "settled",
      data: { label: "Build", status: "succeeded" },
      revision: undefined,
    });

    const parts = replaced[0].content as PluginContentPart[];
    expect(parts).toHaveLength(1);
    expect(parts[0].state).toBe("settled");
    expect(parts[0].data).toEqual({ label: "Build", status: "succeeded" });
    expect(parts[0].revision).toBeUndefined();
  });

  it("removes plugin parts outright when tombstone is false", () => {
    const pluginPart: PluginContentPart = {
      type: "plugin",
      partId: "status-1",
      pluginType: "status_card",
      state: "active",
      data: { label: "Build", status: "running" },
      revision: 1,
    };

    const mounted = mountPluginPart([], "run-plugin-remove", pluginPart, Date.now());
    const removed = removePluginPart(mounted.messages, "run-plugin-remove", "status-1", false);

    expect(removed).toHaveLength(1);
    expect(removed[0].content).toEqual([]);
  });

  it("fills an existing placeholder from a final-only payload", () => {
    const initial: Message[] = [{
      role: "assistant",
      id: "run-final",
      content: [],
      isCommandResponse: true,
    }];

    const next = upsertFinalRunMessage(initial, "run-final", {
      role: "assistant",
      content: "Conversation compacted.",
      timestamp: 1234,
    });

    expect(next).toHaveLength(1);
    expect(next[0].isCommandResponse).toBe(true);
    expect(next[0].timestamp).toBe(1234);
    expect((next[0].content as Array<{ type: string; text?: string }>)[0].text).toBe("Conversation compacted.");
  });

  it("appends a message when final payload arrives without prior deltas", () => {
    const next = upsertFinalRunMessage([], "run-new", {
      role: "assistant",
      content: "Final-only response",
      timestamp: 555,
      reasoning: "quick thought",
    });

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("run-new");
    expect(next[0].reasoning).toBe("quick thought");
    expect((next[0].content as Array<{ type: string; text?: string }>)[0].text).toBe("Final-only response");
  });

  it("ignores empty final payloads when there is nothing to upsert", () => {
    const initial: Message[] = [{ role: "assistant", id: "a1", content: [{ type: "text", text: "existing" }] }];
    const next = upsertFinalRunMessage(initial, "run-empty", {
      role: "assistant",
      content: [],
    });
    expect(next).toEqual(initial);
  });

  it("passes through pre-normalized ContentPart[] without re-wrapping", () => {
    const parts = [
      { type: "text" as const, text: "hello" },
      { type: "text" as const, text: " world" },
    ];
    const next = upsertFinalRunMessage([], "run-parts", {
      role: "assistant",
      content: parts,
      timestamp: 999,
    });
    expect(next).toHaveLength(1);
    expect(next[0].content).toEqual(parts);
  });

  it("normalizes a string content into a single text ContentPart", () => {
    const next = upsertFinalRunMessage([], "run-str", {
      role: "assistant",
      content: "plain text",
    });
    expect(next[0].content).toEqual([{ type: "text", text: "plain text" }]);
  });

  it("treats empty string content as no-content (no new message created)", () => {
    const next = upsertFinalRunMessage([], "run-empty-str", {
      role: "assistant",
      content: "",
    });
    expect(next).toHaveLength(0);
  });

  it("ignores payloads with role 'user'", () => {
    const initial: Message[] = [{ role: "assistant", id: "run-u", content: [] }];
    const next = upsertFinalRunMessage(initial, "run-u", {
      role: "user",
      content: "should be ignored",
    });
    expect(next).toEqual(initial);
  });

  it("ignores user role even when no prior message exists", () => {
    const next = upsertFinalRunMessage([], "run-user-new", {
      role: "user",
      content: "should not create a message",
    });
    expect(next).toHaveLength(0);
  });

  it("stores narration on tool call content part when provided", () => {
    const result = addToolCall([], "run-narr", "list_flows", Date.now(), "tc-1", "{}", "Checking what flows you already have");
    const parts = result.messages[0].content as Array<{ type: string; name?: string; narration?: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe("list_flows");
    expect(parts[0].narration).toBe("Checking what flows you already have");
  });

  it("omits narration from tool call content part when not provided", () => {
    const result = addToolCall([], "run-no-narr", "read_file", Date.now(), "tc-2", "{}");
    const parts = result.messages[0].content as Array<{ type: string; narration?: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].narration).toBeUndefined();
  });

  it("updates existing tool call with narration instead of duplicating", () => {
    // First call creates the tool_call part without narration (streaming start before args arrive)
    const first = addToolCall([], "run-update", "list_flows", Date.now(), "tc-3");
    const parts1 = first.messages[0].content as Array<{ type: string; name?: string; narration?: string; toolCallId?: string }>;
    expect(parts1).toHaveLength(1);
    expect(parts1[0].narration).toBeUndefined();

    // Second call with same toolCallId should update, not duplicate
    const second = addToolCall(first.messages, "run-update", "list_flows", Date.now(), "tc-3", "{}", "Checking your flows");
    const parts2 = second.messages[0].content as Array<{ type: string; name?: string; narration?: string; toolCallId?: string }>;
    expect(parts2).toHaveLength(1);
    expect(parts2[0].narration).toBe("Checking your flows");
  });
});

describe("upsertChatEventMessage deduplication", () => {
  it("deduplicates accumulated text when tool calls split text into segments", () => {
    // Simulates the dual-pathway bug:
    // 1. appendContentDelta created text₁ "Hello " before tool calls
    // 2. addToolCall inserted tool parts
    // 3. appendContentDelta created text₂ after tools
    // 4. Chat event delta arrives with accumulated "Hello Good overview"
    //    → should NOT duplicate "Hello " in the trailing text part
    const initial: Message[] = [{
      role: "assistant",
      id: "run-1",
      content: [
        { type: "text", text: "Hello " },
        { type: "tool_call", name: "list_flows", status: "success", result: "ok" },
        { type: "text", text: "partial" },
      ],
    }];

    const result = upsertChatEventMessage(initial, {
      sessionKey: "main",
      runId: "run-1",
      state: "delta",
      message: {
        role: "assistant",
        content: "Hello Good overview of your flows.",
        timestamp: 1000,
      },
    });

    const parts = result[0].content as Array<{ type: string; text?: string }>;
    // text₁ should remain "Hello ", text₂ should be the remainder
    expect(parts[0].text).toBe("Hello ");
    expect(parts[2].text).toBe("Good overview of your flows.");
  });

  it("handles multiple tool call groups without text snowballing", () => {
    // Simulates: text₁ → tools₁ → text₂ → tools₂ → text₃
    // Chat event sends full accumulated text for all three segments
    const initial: Message[] = [{
      role: "assistant",
      id: "run-1",
      content: [
        { type: "text", text: "First. " },
        { type: "tool_call", name: "tool_a", status: "success" },
        { type: "text", text: "Second. " },
        { type: "tool_call", name: "tool_b", status: "success" },
        { type: "text", text: "" },
      ],
    }];

    const result = upsertChatEventMessage(initial, {
      sessionKey: "main",
      runId: "run-1",
      state: "delta",
      message: {
        role: "assistant",
        content: "First. Second. Third.",
        timestamp: 1000,
      },
    });

    const parts = result[0].content as Array<{ type: string; text?: string }>;
    expect(parts[0].text).toBe("First. ");
    expect(parts[2].text).toBe("Second. ");
    // Trailing text should only contain the new portion
    expect(parts[4].text).toBe("Third.");
  });

  it("falls through without deduplication when text doesn't match prefix", () => {
    // If the accumulated text doesn't start with the preceding text, no dedup
    const initial: Message[] = [{
      role: "assistant",
      id: "run-1",
      content: [
        { type: "text", text: "Old text " },
        { type: "tool_call", name: "tool_a", status: "success" },
        { type: "text", text: "" },
      ],
    }];

    const result = upsertChatEventMessage(initial, {
      sessionKey: "main",
      runId: "run-1",
      state: "delta",
      message: {
        role: "assistant",
        content: "Completely different text",
        timestamp: 1000,
      },
    });

    const parts = result[0].content as Array<{ type: string; text?: string }>;
    // Falls through to raw replacement since prefix doesn't match
    expect(parts[2].text).toBe("Completely different text");
  });

  it("works correctly when there are no preceding text parts", () => {
    // Only one text part after tools — no dedup needed, just replacement
    const initial: Message[] = [{
      role: "assistant",
      id: "run-1",
      content: [
        { type: "tool_call", name: "tool_a", status: "success" },
        { type: "text", text: "partial" },
      ],
    }];

    const result = upsertChatEventMessage(initial, {
      sessionKey: "main",
      runId: "run-1",
      state: "delta",
      message: {
        role: "assistant",
        content: "full response text",
        timestamp: 1000,
      },
    });

    const parts = result[0].content as Array<{ type: string; text?: string }>;
    expect(parts[1].text).toBe("full response text");
  });
});
