import { describe, it, expect } from "vitest";
import { inputAttachmentRegistry } from "@/lib/plugins/inputAttachmentRegistry";

describe("inputAttachmentRegistry", () => {
  it("registers built-in image attachment plugin", () => {
    expect(inputAttachmentRegistry.get("image")).toBeDefined();
    expect(inputAttachmentRegistry.get("image")!.kind).toBe("image");
  });

  it("registers built-in file attachment plugin", () => {
    expect(inputAttachmentRegistry.get("file")).toBeDefined();
    expect(inputAttachmentRegistry.get("file")!.kind).toBe("file");
  });

  it("registers built-in quote attachment plugin", () => {
    expect(inputAttachmentRegistry.get("quote")).toBeDefined();
    expect(inputAttachmentRegistry.get("quote")!.kind).toBe("quote");
  });

  it("registers app-level prompt_context attachment plugin", () => {
    expect(inputAttachmentRegistry.get("prompt_context")).toBeDefined();
    expect(inputAttachmentRegistry.get("prompt_context")!.kind).toBe("prompt_context");
  });

  it("returns undefined for unknown kinds", () => {
    expect(inputAttachmentRegistry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered plugins", () => {
    const all = inputAttachmentRegistry.list();
    const kinds = all.map((p) => p.kind);
    expect(kinds).toContain("image");
    expect(kinds).toContain("file");
    expect(kinds).toContain("quote");
    expect(kinds).toContain("prompt_context");
  });
});
