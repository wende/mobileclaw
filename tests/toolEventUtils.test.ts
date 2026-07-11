import { describe, expect, it } from "vitest";

import { extractToolNarration, serializeToolArgs } from "@mc/lib/chat/toolEventUtils";

describe("toolEventUtils", () => {
  describe("extractToolNarration", () => {
    it("prefers top-level narration", () => {
      expect(extractToolNarration({
        narration: "Top level narration",
        args: { narration: "Args narration" },
      })).toBe("Top level narration");
    });

    it("falls back to narration inside args object", () => {
      expect(extractToolNarration({
        args: { narration: "Args narration" },
      })).toBe("Args narration");
    });

    it("falls back to narration inside args JSON string", () => {
      expect(extractToolNarration({
        args: "{\"narration\":\"Args string narration\"}",
      })).toBe("Args string narration");
    });

    it("falls back to narration inside meta object", () => {
      expect(extractToolNarration({
        meta: { narration: "Meta narration" },
      })).toBe("Meta narration");
    });

    it("returns undefined when no narration is present", () => {
      expect(extractToolNarration({
        args: { tool: "run_piece" },
      })).toBeUndefined();
    });
  });

  describe("serializeToolArgs", () => {
    it("passes through string args unchanged", () => {
      expect(serializeToolArgs("{\"a\":1}")).toBe("{\"a\":1}");
    });

    it("serializes object args to JSON", () => {
      expect(serializeToolArgs({ a: 1 })).toBe("{\"a\":1}");
    });

    it("returns undefined for missing args", () => {
      expect(serializeToolArgs(undefined)).toBeUndefined();
    });
  });
});
