import { describe, it, expect } from "vitest";
import { hasHeartbeatOnOwnLine } from "@/lib/constants";

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
