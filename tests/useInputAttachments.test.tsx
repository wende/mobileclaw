import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInputAttachments } from "@mc/hooks/chat/useInputAttachments";

describe("useInputAttachments", () => {
  const revokeObjectURL = vi.fn();
  const createObjectURL = vi.fn(() => "blob:preview");
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    revokeObjectURL.mockClear();
    createObjectURL.mockClear();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("starts with an empty attachment list", () => {
    const { result } = renderHook(() => useInputAttachments());
    expect(result.current.attachments).toEqual([]);
  });

  it("adds a generic attachment via add()", () => {
    const { result } = renderHook(() => useInputAttachments());
    act(() => result.current.add("custom", { foo: "bar" }));
    expect(result.current.attachments).toEqual([{ kind: "custom", data: { foo: "bar" } }]);
  });

  it("adds a quote attachment via addQuote()", () => {
    const { result } = renderHook(() => useInputAttachments());
    act(() => result.current.addQuote("some quoted text"));
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0]).toEqual({ kind: "quote", data: { text: "some quoted text" } });
  });

  it("replaces existing quote when addQuote is called again", () => {
    const { result } = renderHook(() => useInputAttachments());
    act(() => result.current.addQuote("first"));
    act(() => result.current.addQuote("second"));
    const quotes = result.current.attachments.filter((a) => a.kind === "quote");
    expect(quotes).toHaveLength(1);
    expect((quotes[0].data as { text: string }).text).toBe("second");
  });

  it("removes an attachment by index", () => {
    const { result } = renderHook(() => useInputAttachments());
    act(() => {
      result.current.add("a", { x: 1 });
      result.current.add("b", { x: 2 });
      result.current.add("c", { x: 3 });
    });
    act(() => result.current.removeAttachment(1));
    expect(result.current.attachments).toHaveLength(2);
    expect(result.current.attachments[0].kind).toBe("a");
    expect(result.current.attachments[1].kind).toBe("c");
  });

  it("clearAll removes all attachments", () => {
    const { result } = renderHook(() => useInputAttachments());
    act(() => {
      result.current.add("a", {});
      result.current.addQuote("text");
    });
    expect(result.current.attachments).toHaveLength(2);
    act(() => result.current.clearAll());
    expect(result.current.attachments).toEqual([]);
  });

  it("calls cleanup on image attachments when removing", () => {
    const { result } = renderHook(() => useInputAttachments());
    act(() => result.current.add("image", { mimeType: "image/png", fileName: "a.png", content: "abc", previewUrl: "blob:1" }));
    act(() => result.current.removeAttachment(0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");
  });

  it("calls cleanup on file attachments when clearing all", () => {
    const { result } = renderHook(() => useInputAttachments());
    act(() => result.current.add("file", { mimeType: "text/plain", fileName: "a.txt", content: "abc", previewUrl: "blob:2" }));
    act(() => result.current.clearAll());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:2");
  });
});
