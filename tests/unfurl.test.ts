import { describe, it, expect, beforeEach } from "vitest";
import { extractUrls, shouldUnfurl, _resetForTests, _getCache, BARE_URL_REGEX } from "@mc/lib/unfurl";

beforeEach(() => {
  _resetForTests();
});

describe("BARE_URL_REGEX", () => {
  it("matches http and https URLs", () => {
    const text = "Check http://example.com and https://example.org for info";
    const matches = text.match(BARE_URL_REGEX);
    expect(matches).toEqual(["http://example.com", "https://example.org"]);
  });

  it("does not match trailing punctuation", () => {
    const text = "Visit https://example.com.";
    const matches = text.match(BARE_URL_REGEX);
    expect(matches).toEqual(["https://example.com"]);
  });
});

describe("extractUrls", () => {
  it("extracts bare URLs from text", () => {
    const text = "Check out https://example.com and https://github.com/repo";
    expect(extractUrls(text)).toEqual([
      "https://example.com",
      "https://github.com/repo",
    ]);
  });

  it("deduplicates URLs", () => {
    const text = "https://example.com is great, see https://example.com again";
    expect(extractUrls(text)).toEqual(["https://example.com"]);
  });

  it("returns empty array for text without URLs", () => {
    expect(extractUrls("no links here")).toEqual([]);
  });

  it("extracts URLs with paths and query params", () => {
    const text = "See https://example.com/path?q=hello&lang=en#section";
    const urls = extractUrls(text);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("example.com/path");
  });

  it("handles markdown-style link text containing URLs", () => {
    const text = "Check https://example.com for details";
    expect(extractUrls(text)).toEqual(["https://example.com"]);
  });
});

describe("shouldUnfurl", () => {
  it("accepts normal https URLs", () => {
    expect(shouldUnfurl("https://example.com")).toBe(true);
    expect(shouldUnfurl("https://github.com/user/repo")).toBe(true);
  });

  it("accepts normal http URLs", () => {
    expect(shouldUnfurl("http://example.com")).toBe(true);
  });

  it("rejects code file URLs", () => {
    expect(shouldUnfurl("https://example.com/file.ts")).toBe(false);
    expect(shouldUnfurl("https://example.com/file.py")).toBe(false);
    expect(shouldUnfurl("https://example.com/file.json")).toBe(false);
    expect(shouldUnfurl("https://example.com/file.md")).toBe(false);
  });

  it("rejects image URLs", () => {
    expect(shouldUnfurl("https://example.com/photo.png")).toBe(false);
    expect(shouldUnfurl("https://example.com/photo.jpg")).toBe(false);
    expect(shouldUnfurl("https://example.com/image.webp")).toBe(false);
  });

  it("rejects localhost", () => {
    expect(shouldUnfurl("http://localhost:3000")).toBe(false);
    expect(shouldUnfurl("http://127.0.0.1:8080")).toBe(false);
    expect(shouldUnfurl("http://0.0.0.0:5000")).toBe(false);
  });

  it("rejects API paths", () => {
    expect(shouldUnfurl("https://example.com/api/users")).toBe(false);
  });

  it("rejects URLs over 500 chars", () => {
    const longUrl = "https://example.com/" + "a".repeat(500);
    expect(shouldUnfurl(longUrl)).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(shouldUnfurl("ftp://example.com")).toBe(false);
    expect(shouldUnfurl("file:///etc/passwd")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(shouldUnfurl("not a url")).toBe(false);
  });
});

describe("unfurl cache", () => {
  it("starts empty", () => {
    expect(_getCache().size).toBe(0);
  });
});
