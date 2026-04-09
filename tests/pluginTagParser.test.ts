import { describe, it, expect } from "vitest";
import { parsePluginTags } from "@mc/lib/chat/pluginTagParser";

describe("parsePluginTags", () => {
  it("returns single text segment when no plugin tags", () => {
    const result = parsePluginTags("Hello world, no tags here.");
    expect(result).toEqual([{ kind: "text", text: "Hello world, no tags here." }]);
  });

  it("extracts a single plugin tag", () => {
    const text = `Here is the flow:\n\n<plugin type="flow_canvas" data='{"flowId":"abc"}'>\nASCII fallback\n</plugin>\n\nDone.`;
    const result = parsePluginTags(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: "text", text: "Here is the flow:\n\n" });
    expect(result[1]).toEqual({
      kind: "plugin",
      pluginType: "flow_canvas",
      data: { flowId: "abc" },
      fallbackText: "\nASCII fallback\n",
    });
    expect(result[2]).toEqual({ kind: "text", text: "\n\nDone." });
  });

  it("extracts multiple plugin tags", () => {
    const text = `List:\n<plugin type="flow_list_card" data='{"flows":[]}'>\nlist\n</plugin>\nCanvas:\n<plugin type="flow_canvas" data='{"steps":[]}'>\ncanvas\n</plugin>`;
    const result = parsePluginTags(text);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ kind: "text", text: "List:\n" });
    expect(result[1].kind).toBe("plugin");
    expect((result[1] as any).pluginType).toBe("flow_list_card");
    expect(result[2]).toEqual({ kind: "text", text: "\nCanvas:\n" });
    expect(result[3].kind).toBe("plugin");
    expect((result[3] as any).pluginType).toBe("flow_canvas");
  });

  it("handles malformed JSON in data attribute gracefully", () => {
    const text = `<plugin type="flow_canvas" data='not valid json'>\nfallback\n</plugin>`;
    const result = parsePluginTags(text);
    // Malformed JSON → entire match treated as plain text
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("text");
  });

  it("passes through incomplete/unclosed tags as text", () => {
    const text = `Here is <plugin type="flow_canvas" data='{"id":"abc"}'>\nsome content but no closing tag`;
    const result = parsePluginTags(text);
    // No closing </plugin>, regex won't match
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "text", text });
  });

  it("handles escaped single quotes via \\u0027", () => {
    const text = `<plugin type="flow_canvas" data='{"name":"John\\u0027s Flow"}'>\nfallback\n</plugin>`;
    const result = parsePluginTags(text);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("plugin");
    expect((result[0] as any).data).toEqual({ name: "John's Flow" });
  });

  it("handles plugin tag at start of text", () => {
    const text = `<plugin type="flow_list_card" data='{"flows":[]}'>\nlist\n</plugin> trailing text`;
    const result = parsePluginTags(text);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("plugin");
    expect(result[1]).toEqual({ kind: "text", text: " trailing text" });
  });

  it("handles plugin tag at end of text", () => {
    const text = `leading text <plugin type="flow_canvas" data='{"id":"x"}'>\ncanvas\n</plugin>`;
    const result = parsePluginTags(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: "text", text: "leading text " });
    expect(result[1].kind).toBe("plugin");
  });

  it("handles multiline ASCII fallback content", () => {
    const ascii = `\n● Email Digest (ENABLED) — 3 steps\n  1. ⚡ Manual Trigger\n   ▼\n  2. 🔧 Search Gmail\n   ▼\n  3. 💻 Extract Email Text\n`;
    const text = `<plugin type="flow_canvas" data='{"flowId":"abc"}'>${ascii}</plugin>`;
    const result = parsePluginTags(text);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("plugin");
    expect((result[0] as any).fallbackText).toBe(ascii);
  });

  it("handles empty data object", () => {
    const text = `<plugin type="flow_canvas" data='{}'>\nfallback\n</plugin>`;
    const result = parsePluginTags(text);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("plugin");
    expect((result[0] as any).data).toEqual({});
  });

  it("returns single text segment for empty string", () => {
    const result = parsePluginTags("");
    expect(result).toEqual([{ kind: "text", text: "" }]);
  });
});
