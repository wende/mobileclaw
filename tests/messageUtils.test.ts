import { describe, it, expect } from "vitest";
import {
  getTextFromContent,
  getToolCalls,
  getImages,
  getMessageSide,
  thinkingPreview,
} from "@/lib/messageUtils";

describe("getTextFromContent", () => {
  it("returns empty string for null", () => {
    expect(getTextFromContent(null)).toBe("");
  });

  it("returns the string directly for string content", () => {
    expect(getTextFromContent("hello world")).toBe("hello world");
  });

  it("joins text parts from ContentPart array", () => {
    const content = [
      { type: "text", text: "Hello " },
      { type: "tool_call", name: "exec" },
      { type: "text", text: "world" },
    ];
    expect(getTextFromContent(content)).toBe("Hello world");
  });

  it("skips parts without text", () => {
    const content = [
      { type: "text" },
      { type: "text", text: "only this" },
    ];
    expect(getTextFromContent(content)).toBe("only this");
  });

  it("returns empty string for empty array", () => {
    expect(getTextFromContent([])).toBe("");
  });
});

describe("getToolCalls", () => {
  it("returns empty array for null", () => {
    expect(getToolCalls(null)).toEqual([]);
  });

  it("returns empty array for string content", () => {
    expect(getToolCalls("hello")).toEqual([]);
  });

  it("filters tool_call parts", () => {
    const content = [
      { type: "text", text: "result" },
      { type: "tool_call", name: "exec", arguments: '{"cmd":"ls"}' },
      { type: "toolCall", name: "read" },
    ];
    const calls = getToolCalls(content);
    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe("exec");
    expect(calls[1].name).toBe("read");
  });
});

describe("getImages", () => {
  it("returns empty array for null", () => {
    expect(getImages(null)).toEqual([]);
  });

  it("returns empty array for string content", () => {
    expect(getImages("hello")).toEqual([]);
  });

  it("filters image and image_url parts", () => {
    const content = [
      { type: "text", text: "look at this" },
      { type: "image", image_url: { url: "data:image/png;base64,..." } },
      { type: "image_url", image_url: { url: "https://example.com/img.png" } },
    ];
    const images = getImages(content);
    expect(images).toHaveLength(2);
  });
});

describe("getMessageSide", () => {
  it("returns 'right' for user messages", () => {
    expect(getMessageSide("user")).toBe("right");
  });

  it("returns 'left' for assistant messages", () => {
    expect(getMessageSide("assistant")).toBe("left");
  });

  it("returns 'left' for toolResult messages", () => {
    expect(getMessageSide("toolResult")).toBe("left");
  });

  it("returns 'left' for tool_result messages", () => {
    expect(getMessageSide("tool_result")).toBe("left");
  });

  it("returns 'center' for system messages", () => {
    expect(getMessageSide("system")).toBe("center");
  });

  it("returns 'center' for unknown roles", () => {
    expect(getMessageSide("unknown")).toBe("center");
  });
});

describe("thinkingPreview", () => {
  it("extracts bold text", () => {
    expect(thinkingPreview("I should use **binary search** here")).toBe("binary search");
  });

  it("returns first 8 words as fallback", () => {
    expect(thinkingPreview("one two three four five six seven eight nine ten")).toBe(
      "one two three four five six seven eight..."
    );
  });

  it("returns short text without ellipsis", () => {
    expect(thinkingPreview("short text")).toBe("short text");
  });

  it("handles empty string", () => {
    expect(thinkingPreview("")).toBe("");
  });
});
