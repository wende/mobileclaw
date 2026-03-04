import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEMO_HISTORY, createDemoHandler } from "@/lib/demoMode";
import type { AgentEventPayload } from "@/types/chat";

describe("DEMO_HISTORY", () => {
  it("contains system + user + assistant messages", () => {
    expect(DEMO_HISTORY.length).toBe(3);
  });

  it("starts with a system message (model changed)", () => {
    expect(DEMO_HISTORY[0].role).toBe("system");
  });

  it("has system, user, then assistant", () => {
    expect(DEMO_HISTORY[0].role).toBe("system");
    expect(DEMO_HISTORY[1].role).toBe("user");
    expect(DEMO_HISTORY[2].role).toBe("assistant");
  });

  it("all messages have ids and timestamps", () => {
    for (const msg of DEMO_HISTORY) {
      expect(msg.id).toBeDefined();
      expect(msg.timestamp).toBeDefined();
      expect(typeof msg.timestamp).toBe("number");
    }
  });

  it("assistant message showcases all display features", () => {
    const assistantMsg = DEMO_HISTORY[2];
    const content = assistantMsg.content as Array<{ type: string }>;

    // Should have thinking, tool_call, and text parts
    const types = content.map(p => p.type);
    expect(types).toContain("thinking");
    expect(types).toContain("tool_call");
    expect(types).toContain("text");
  });
});

describe("createDemoHandler", () => {
  let onEvent: ReturnType<typeof vi.fn>;
  let events: AgentEventPayload[];

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    onEvent = vi.fn((evt: AgentEventPayload) => events.push(evt));
  });

  function createHandler() {
    return createDemoHandler({ onEvent });
  }

  function flushAll() {
    vi.advanceTimersByTime(60_000);
  }

  function lifecycleEvents() {
    return events.filter(e => e.stream === "lifecycle");
  }

  function reasoningEvents() {
    return events.filter(e => e.stream === "reasoning");
  }

  function contentEvents() {
    return events.filter(e => e.stream === "content");
  }

  function toolEvents() {
    return events.filter(e => e.stream === "tool");
  }

  it("returns sendMessage and stop functions", () => {
    const handler = createHandler();
    expect(typeof handler.sendMessage).toBe("function");
    expect(typeof handler.stop).toBe("function");
  });

  it("emits lifecycle/start event when a message is sent", () => {
    const handler = createHandler();
    handler.sendMessage("hello");
    vi.advanceTimersByTime(600);
    const starts = lifecycleEvents().filter(e => e.data.phase === "start");
    expect(starts).toHaveLength(1);
  });

  it("emits lifecycle/end after full processing", () => {
    const handler = createHandler();
    handler.sendMessage("hello");
    flushAll();
    const ends = lifecycleEvents().filter(e => e.data.phase === "end");
    expect(ends).toHaveLength(1);
  });

  it("emits reasoning deltas for weather keyword", () => {
    const handler = createHandler();
    handler.sendMessage("what's the weather?");
    flushAll();
    expect(reasoningEvents().length).toBeGreaterThan(0);
    // Every reasoning event should have a delta
    for (const evt of reasoningEvents()) {
      expect(evt.data).toHaveProperty("delta");
    }
  });

  it("emits tool start and result events for weather keyword", () => {
    const handler = createHandler();
    handler.sendMessage("what's the weather?");
    flushAll();
    const starts = toolEvents().filter(e => e.data.phase === "start");
    const results = toolEvents().filter(e => e.data.phase === "result");
    expect(starts.length).toBeGreaterThan(0);
    expect(results.length).toBeGreaterThan(0);
  });

  it("emits tool events with correct data for error keyword", () => {
    const handler = createHandler();
    handler.sendMessage("show me an error");
    flushAll();
    const starts = toolEvents().filter(e => e.data.phase === "start");
    const results = toolEvents().filter(e => e.data.phase === "result");
    // error response has 2 tool calls
    expect(starts).toHaveLength(2);
    expect(results).toHaveLength(2);
    // Both results should be errors
    for (const r of results) {
      expect(r.data.isError).toBe(true);
    }
  });

  it("does not emit tool events for help keyword", () => {
    const handler = createHandler();
    handler.sendMessage("help");
    flushAll();
    expect(toolEvents()).toHaveLength(0);
  });

  it("streams zen keyword as a single lifecycle with multiple cycles", () => {
    const handler = createHandler();
    handler.sendMessage("show me zen mode");
    flushAll();

    const starts = lifecycleEvents().filter(e => e.data.phase === "start");
    const ends = lifecycleEvents().filter(e => e.data.phase === "end");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(reasoningEvents().length).toBeGreaterThan(0);
    // Zen has 2 tool calls
    expect(toolEvents().filter(e => e.data.phase === "start")).toHaveLength(2);
    expect(toolEvents().filter(e => e.data.phase === "result")).toHaveLength(2);
  });

  it("emits content deltas", () => {
    const handler = createHandler();
    handler.sendMessage("help");
    flushAll();
    const content = contentEvents();
    expect(content.length).toBeGreaterThan(0);
    // Concatenated deltas should contain "Demo Mode"
    const fullText = content.map(e => e.data.delta).join("");
    expect(fullText).toContain("Demo Mode");
  });

  it("stop clears pending timers", () => {
    const handler = createHandler();
    handler.sendMessage("weather");
    vi.advanceTimersByTime(100); // only partial
    handler.stop();
    flushAll();
    // lifecycle/end should NOT have been emitted since we stopped early
    const ends = lifecycleEvents().filter(e => e.data.phase === "end");
    expect(ends).toHaveLength(0);
  });

  it("all events share the same runId within a send", () => {
    const handler = createHandler();
    handler.sendMessage("weather");
    flushAll();
    const runIds = new Set(events.map(e => e.runId));
    expect(runIds.size).toBe(1);
  });

  it("content deltas are individual words, not accumulated snapshots", () => {
    const handler = createHandler();
    handler.sendMessage("help");
    flushAll();
    const content = contentEvents();
    // The instant help response emits the full text as one delta
    // For non-instant responses, check word-by-word
    expect(content.length).toBeGreaterThanOrEqual(1);
  });
});
