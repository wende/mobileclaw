import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEMO_HISTORY, createDemoHandler, type DemoCallbacks } from "@/lib/demoMode";

describe("DEMO_HISTORY", () => {
  it("contains the expected number of messages", () => {
    expect(DEMO_HISTORY.length).toBeGreaterThanOrEqual(5);
  });

  it("starts with a system message", () => {
    expect(DEMO_HISTORY[0].role).toBe("system");
  });

  it("alternates user and assistant messages", () => {
    // Skip system message, check the rest alternate
    const messages = DEMO_HISTORY.slice(1);
    for (let i = 0; i < messages.length; i++) {
      expect(messages[i].role).toBe(i % 2 === 0 ? "user" : "assistant");
    }
  });

  it("all messages have ids and timestamps", () => {
    for (const msg of DEMO_HISTORY) {
      expect(msg.id).toBeDefined();
      expect(msg.timestamp).toBeDefined();
      expect(typeof msg.timestamp).toBe("number");
    }
  });
});

describe("createDemoHandler", () => {
  let callbacks: DemoCallbacks;

  beforeEach(() => {
    vi.useFakeTimers();
    callbacks = {
      onStreamStart: vi.fn(),
      onThinking: vi.fn(),
      onTextDelta: vi.fn(),
      onToolStart: vi.fn(),
      onToolEnd: vi.fn(),
      onStreamEnd: vi.fn(),
    };
  });

  it("returns sendMessage and stop functions", () => {
    const handler = createDemoHandler(callbacks);
    expect(typeof handler.sendMessage).toBe("function");
    expect(typeof handler.stop).toBe("function");
  });

  it("calls onStreamStart when a message is sent", () => {
    const handler = createDemoHandler(callbacks);
    handler.sendMessage("hello");
    vi.advanceTimersByTime(600);
    expect(callbacks.onStreamStart).toHaveBeenCalledTimes(1);
  });

  it("calls onStreamEnd after full processing", () => {
    const handler = createDemoHandler(callbacks);
    handler.sendMessage("hello");
    vi.advanceTimersByTime(60_000); // advance well past all timers
    expect(callbacks.onStreamEnd).toHaveBeenCalledTimes(1);
  });

  it("triggers thinking for weather keyword", () => {
    const handler = createDemoHandler(callbacks);
    handler.sendMessage("what's the weather?");
    vi.advanceTimersByTime(60_000);
    expect(callbacks.onThinking).toHaveBeenCalled();
    expect(callbacks.onToolStart).toHaveBeenCalled();
    expect(callbacks.onToolEnd).toHaveBeenCalled();
  });

  it("triggers tool calls for error keyword", () => {
    const handler = createDemoHandler(callbacks);
    handler.sendMessage("show me an error");
    vi.advanceTimersByTime(60_000);
    // error response has 2 tool calls
    expect(callbacks.onToolStart).toHaveBeenCalledTimes(2);
    expect(callbacks.onToolEnd).toHaveBeenCalledTimes(2);
  });

  it("does not trigger tools for help keyword", () => {
    const handler = createDemoHandler(callbacks);
    handler.sendMessage("help");
    vi.advanceTimersByTime(60_000);
    expect(callbacks.onToolStart).not.toHaveBeenCalled();
  });

  it("streams text deltas", () => {
    const handler = createDemoHandler(callbacks);
    handler.sendMessage("help");
    vi.advanceTimersByTime(60_000);
    expect(callbacks.onTextDelta).toHaveBeenCalled();
    // last call should have the full accumulated text
    const lastCall = callbacks.onTextDelta.mock.calls.at(-1);
    expect(lastCall?.[2]).toContain("Demo Mode");
  });

  it("stop clears pending timers", () => {
    const handler = createDemoHandler(callbacks);
    handler.sendMessage("weather");
    vi.advanceTimersByTime(100); // only partial
    handler.stop();
    vi.advanceTimersByTime(60_000); // advance past everything
    // onStreamEnd should NOT have been called since we stopped early
    expect(callbacks.onStreamEnd).not.toHaveBeenCalled();
  });
});
