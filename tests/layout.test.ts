import { describe, expect, it } from "vitest";

import { getChatBottomPad, getDocumentScrollFooterReserve, getThinkingIndicatorBottom } from "@mc/lib/chat/layout";

describe("chat layout spacing", () => {
  it("adds composer clearance to detached bottom padding", () => {
    expect(getChatBottomPad({
      isNative: false,
      isDetached: true,
      inputZoneHeight: "4rem",
      hasQueued: false,
      hasPinnedSubagent: false,
    })).toBe("calc(4rem + 4rem)");
  });

  it("keeps fullscreen bottom padding on the existing svh/rem scale", () => {
    expect(getChatBottomPad({
      isNative: false,
      isDetached: false,
      inputZoneHeight: "4rem",
      hasQueued: false,
      hasPinnedSubagent: false,
    })).toBe("calc(4.5svh + 7.5rem)");
  });

  it("lifts the detached thinking indicator above both spacer and composer", () => {
    expect(getThinkingIndicatorBottom({
      isDetached: true,
      inputZoneHeight: "4rem",
    })).toBe("calc(4rem + 4rem + 1.5rem)");
  });

  it("uses a small bottom inset when document scroll owns the page", () => {
    expect(getChatBottomPad({
      isNative: false,
      isDetached: true,
      useDocumentScroll: true,
      inputZoneHeight: "4rem",
      hasQueued: true,
      hasPinnedSubagent: true,
    })).toBe("calc(env(safe-area-inset-bottom, 0px) + 1.5rem)");
  });

  it("keeps the fullscreen thinking indicator one composer-height above the bottom", () => {
    expect(getThinkingIndicatorBottom({
      isDetached: false,
      inputZoneHeight: "4rem",
    })).toBe("calc(4rem + 1.5rem)");
  });

  it("anchors the thinking indicator above the sticky composer in document scroll mode", () => {
    expect(getThinkingIndicatorBottom({
      isDetached: true,
      useDocumentScroll: true,
      inputZoneHeight: "4rem",
    })).toBe("calc(calc(env(safe-area-inset-bottom, 0px) + 1.5rem) + 1.5rem)");
  });

  it("reserves real document space for the fixed mobile composer stack", () => {
    expect(getDocumentScrollFooterReserve({
      hasQueued: false,
      hasPinnedSubagent: false,
    })).toBe("calc(env(safe-area-inset-bottom, 0px) + 4rem)");

    expect(getDocumentScrollFooterReserve({
      hasQueued: true,
      hasPinnedSubagent: false,
    })).toBe("calc(env(safe-area-inset-bottom, 0px) + 7rem)");

    expect(getDocumentScrollFooterReserve({
      hasQueued: false,
      hasPinnedSubagent: true,
    })).toBe("calc(env(safe-area-inset-bottom, 0px) + 10rem)");
  });
});
