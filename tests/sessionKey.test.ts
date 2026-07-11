import { describe, expect, test } from "vitest";
import {
  appendSessionKeyToWsUrl,
  isValidSessionKey,
  normalizeSessionKey,
} from "@mc/lib/sessionKey";

describe("sessionKey", () => {
  test("isValidSessionKey accepts hex and uuid", () => {
    expect(isValidSessionKey("a1b2c3d4e5f67890")).toBe(true);
    expect(isValidSessionKey("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidSessionKey("short")).toBe(false);
  });

  test("normalizeSessionKey strips uuid dashes", () => {
    expect(normalizeSessionKey("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400e29b41d4a716446655440000"
    );
  });

  test("appendSessionKeyToWsUrl adds query param", () => {
    expect(appendSessionKeyToWsUrl("wss://wendebot.fly.dev", "abc123def4567890")).toBe(
      "wss://wendebot.fly.dev/?sessionKey=abc123def4567890"
    );
  });
});
