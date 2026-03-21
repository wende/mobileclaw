import { describe, it, expect, vi } from "vitest";

import { applyNativeZenMode } from "@mc/lib/chat/zenBridge";

describe("applyNativeZenMode", () => {
  it("toggles zen mode when requested state differs from current state", () => {
    const toggle = vi.fn();
    const changed = applyNativeZenMode({ enabled: true, current: false, toggle });

    expect(changed).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("does not toggle when requested state already matches current state", () => {
    const toggle = vi.fn();
    const changed = applyNativeZenMode({ enabled: false, current: false, toggle });

    expect(changed).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
  });
});
