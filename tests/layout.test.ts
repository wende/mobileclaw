import { describe, expect, it } from "vitest";

import { getChatBottomPad, getThinkingIndicatorBottom } from "@mc/lib/chat/layout";

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

  it("keeps the fullscreen thinking indicator one composer-height above the bottom", () => {
    expect(getThinkingIndicatorBottom({
      isDetached: false,
      inputZoneHeight: "4rem",
    })).toBe("calc(4rem + 1.5rem)");
  });
});
