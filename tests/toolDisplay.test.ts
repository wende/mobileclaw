import { describe, it, expect } from "vitest";
import { getToolDisplay } from "@/lib/toolDisplay";

describe("getToolDisplay", () => {
  describe("exec tool", () => {
    it("extracts command from args", () => {
      const result = getToolDisplay("exec", JSON.stringify({ command: "ls -la" }));
      expect(result).toEqual({ label: "ls -la", icon: "terminal" });
    });

    it("falls back to tool name when args missing", () => {
      const result = getToolDisplay("exec");
      expect(result).toEqual({ label: "exec", icon: "terminal" });
    });

    it("falls back to tool name when args are invalid JSON", () => {
      const result = getToolDisplay("exec", "not-json");
      expect(result).toEqual({ label: "exec", icon: "terminal" });
    });
  });

  describe("read/readFile/read_file tools", () => {
    it("truncates long file paths", () => {
      const result = getToolDisplay(
        "read",
        JSON.stringify({ file_path: "/home/user/projects/app/src/lib/utils.ts" })
      );
      expect(result.label).toBe(".../src/lib/utils.ts");
      expect(result.icon).toBe("file");
    });

    it("shows full short paths", () => {
      const result = getToolDisplay("read", JSON.stringify({ file_path: "/src/index.ts" }));
      expect(result.label).toBe("/src/index.ts");
      expect(result.icon).toBe("file");
    });

    it("handles readFile alias", () => {
      const result = getToolDisplay("readFile", JSON.stringify({ filePath: "README.md" }));
      expect(result.label).toBe("README.md");
      expect(result.icon).toBe("file");
    });

    it("handles read_file alias", () => {
      const result = getToolDisplay("read_file", JSON.stringify({ path: "config.json" }));
      expect(result.label).toBe("config.json");
      expect(result.icon).toBe("file");
    });

    it("falls back when no file path in args", () => {
      const result = getToolDisplay("read", JSON.stringify({ other: "value" }));
      expect(result).toEqual({ label: "read", icon: "file" });
    });
  });

  describe("sessions_spawn tool", () => {
    it("extracts model name", () => {
      const result = getToolDisplay(
        "sessions_spawn",
        JSON.stringify({ model: "claude-opus" })
      );
      expect(result).toEqual({ label: "claude-opus", icon: "robot" });
    });

    it("falls back to 'spawn agent' without model", () => {
      const result = getToolDisplay("sessions_spawn");
      expect(result).toEqual({ label: "spawn agent", icon: "robot" });
    });
  });

  describe("unknown tools", () => {
    it("returns tool name and generic icon", () => {
      const result = getToolDisplay("unknown_tool", JSON.stringify({ query: "test" }));
      expect(result).toEqual({ label: "unknown_tool", icon: "tool" });
    });

    it("handles empty name", () => {
      const result = getToolDisplay("");
      expect(result).toEqual({ label: "", icon: "tool" });
    });
  });

  describe("web_search and web_fetch tools", () => {
    it("web_search extracts query", () => {
      const result = getToolDisplay("web_search", JSON.stringify({ query: "test" }));
      expect(result).toEqual({ label: "test", icon: "globe" });
    });

    it("web_search falls back to tool name", () => {
      const result = getToolDisplay("web_search");
      expect(result).toEqual({ label: "web_search", icon: "globe" });
    });

    it("web_fetch extracts url", () => {
      const result = getToolDisplay(
        "web_fetch",
        JSON.stringify({ url: "https://example.com" })
      );
      expect(result).toEqual({ label: "https://example.com", icon: "globe" });
    });

    it("web_fetch falls back to tool name", () => {
      const result = getToolDisplay("web_fetch");
      expect(result).toEqual({ label: "web_fetch", icon: "globe" });
    });
  });
});
