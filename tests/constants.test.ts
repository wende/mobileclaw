import { describe, it, expect } from "vitest";
import {
  hasHeartbeatOnOwnLine,
  isInternalCommandFetchRunId,
  TOOL_CALL_BUBBLE_BG,
  TOOL_CALL_BUBBLE_TEXT,
  TOOL_CALL_BUBBLE_MUTED,
  TOOL_CALL_BUBBLE_BORDER,
  TOOL_CALL_BUBBLE_BORDER_ERROR,
} from "@mc/lib/constants";

describe("hasHeartbeatOnOwnLine", () => {
  it("matches HEARTBEAT_OK as the entire text", () => {
    expect(hasHeartbeatOnOwnLine("HEARTBEAT_OK")).toBe(true);
  });

  it("matches HEARTBEAT_OK on its own line in multiline text", () => {
    expect(hasHeartbeatOnOwnLine("some text\nHEARTBEAT_OK")).toBe(true);
    expect(hasHeartbeatOnOwnLine("HEARTBEAT_OK\nsome text")).toBe(true);
    expect(hasHeartbeatOnOwnLine("line one\nHEARTBEAT_OK\nline three")).toBe(true);
  });

  it("does not match HEARTBEAT_OK embedded in a sentence", () => {
    expect(hasHeartbeatOnOwnLine("I should reply HEARTBEAT_OK")).toBe(false);
    expect(hasHeartbeatOnOwnLine("HEARTBEAT_OK is a marker")).toBe(false);
    expect(hasHeartbeatOnOwnLine("send HEARTBEAT_OK now")).toBe(false);
  });

  it("matches HEARTBEAT_OK with surrounding whitespace (stripped)", () => {
    expect(hasHeartbeatOnOwnLine("  HEARTBEAT_OK")).toBe(true);
    expect(hasHeartbeatOnOwnLine("HEARTBEAT_OK  ")).toBe(true);
  });

  it("matches HEARTBEAT_OK wrapped in markdown formatting", () => {
    expect(hasHeartbeatOnOwnLine("**HEARTBEAT_OK**")).toBe(true);
    expect(hasHeartbeatOnOwnLine("*HEARTBEAT_OK*")).toBe(true);
    expect(hasHeartbeatOnOwnLine("some text\n**HEARTBEAT_OK**\nmore text")).toBe(true);
  });

  it("does not match partial occurrences", () => {
    expect(hasHeartbeatOnOwnLine("HEARTBEAT_OK_EXTRA")).toBe(false);
    expect(hasHeartbeatOnOwnLine("MY_HEARTBEAT_OK")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasHeartbeatOnOwnLine("")).toBe(false);
  });

  it("returns false when marker is absent", () => {
    expect(hasHeartbeatOnOwnLine("just some normal text")).toBe(false);
  });
});

describe("isInternalCommandFetchRunId", () => {
  it("returns true for cmdfetch run ids", () => {
    expect(isInternalCommandFetchRunId("cmdfetch-123")).toBe(true);
  });

  it("returns false for user run ids", () => {
    expect(isInternalCommandFetchRunId("run-123")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isInternalCommandFetchRunId(undefined)).toBe(false);
    expect(isInternalCommandFetchRunId(null)).toBe(false);
    expect(isInternalCommandFetchRunId(42)).toBe(false);
  });
});

describe("tool call bubble tokens", () => {
  it("use theme-linked CSS variables so dark mode is respected", () => {
    expect(TOOL_CALL_BUBBLE_BG).toBe("var(--tool-call-bubble-bg)");
    expect(TOOL_CALL_BUBBLE_TEXT).toBe("var(--tool-call-bubble-text)");
    expect(TOOL_CALL_BUBBLE_MUTED).toBe("var(--tool-call-bubble-muted)");
    expect(TOOL_CALL_BUBBLE_BORDER).toBe("var(--tool-call-bubble-border)");
    expect(TOOL_CALL_BUBBLE_BORDER_ERROR).toBe("var(--tool-call-bubble-border-error)");
  });
});
