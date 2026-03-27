import { describe, expect, it } from "vitest";

import { getChatLayoutConfig } from "@mc/lib/chat/layoutMode";

describe("chat layout mode selection", () => {
  it("keeps detached mobile url mode on the viewport shell by default", () => {
    expect(getChatLayoutConfig({
      isDetached: true,
      detachedNoShell: false,
      isNative: false,
      isMobileViewport: true,
      detachedSurface: "url",
    })).toEqual({
      mode: "viewport-shell",
      useDocumentScroll: false,
      shellHeight: "100dvh",
      useKeyboardLayout: true,
    });
  });

  it("uses document scroll for detached mobile url mode when noshell is set", () => {
    expect(getChatLayoutConfig({
      isDetached: true,
      detachedNoShell: true,
      isNative: false,
      isMobileViewport: true,
      detachedSurface: "url",
    })).toEqual({
      mode: "document-scroll",
      useDocumentScroll: true,
      shellHeight: null,
      useKeyboardLayout: false,
    });
  });

  it("uses a viewport shell for detached desktop url mode", () => {
    expect(getChatLayoutConfig({
      isDetached: true,
      detachedNoShell: false,
      isNative: false,
      isMobileViewport: false,
      detachedSurface: "url",
    })).toEqual({
      mode: "viewport-shell",
      useDocumentScroll: false,
      shellHeight: "100dvh",
      useKeyboardLayout: false,
    });

    expect(getChatLayoutConfig({
      isDetached: true,
      detachedNoShell: true,
      isNative: false,
      isMobileViewport: false,
      detachedSurface: "url",
    })).toEqual({
      mode: "viewport-shell",
      useDocumentScroll: false,
      shellHeight: "100dvh",
      useKeyboardLayout: false,
    });
  });

  it("keeps embedded detached mobile on the existing document-scroll mode", () => {
    expect(getChatLayoutConfig({
      isDetached: true,
      detachedNoShell: false,
      isNative: false,
      isMobileViewport: true,
      detachedSurface: "widget",
    })).toEqual({
      mode: "document-scroll",
      useDocumentScroll: true,
      shellHeight: null,
      useKeyboardLayout: false,
    });
  });

  it("keeps embedded detached desktop on parent-fill shell mode", () => {
    expect(getChatLayoutConfig({
      isDetached: true,
      detachedNoShell: false,
      isNative: false,
      isMobileViewport: false,
      detachedSurface: "widget",
    })).toEqual({
      mode: "parent-shell",
      useDocumentScroll: false,
      shellHeight: "100%",
      useKeyboardLayout: false,
    });
  });

  it("keeps existing non-detached and native behavior on the shell path", () => {
    expect(getChatLayoutConfig({
      isDetached: false,
      detachedNoShell: false,
      isNative: false,
      isMobileViewport: true,
      detachedSurface: "url",
    })).toEqual({
      mode: "viewport-shell",
      useDocumentScroll: false,
      shellHeight: "100dvh",
      useKeyboardLayout: true,
    });

    expect(getChatLayoutConfig({
      isDetached: true,
      detachedNoShell: true,
      isNative: true,
      isMobileViewport: true,
      detachedSurface: "url",
    })).toEqual({
      mode: "viewport-shell",
      useDocumentScroll: false,
      shellHeight: "100dvh",
      useKeyboardLayout: false,
    });
  });
});
