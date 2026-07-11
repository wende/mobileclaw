import { describe, expect, it } from "vitest";

import { resolveUrlAppMode } from "@mc/hooks/useAppMode";

describe("url app mode parsing", () => {
  it("keeps noshell disabled for plain detached urls", () => {
    expect(resolveUrlAppMode("?detached")).toEqual({
      isDetached: true,
      detachedNoBorder: false,
      detachedNoShell: false,
      isNative: false,
      uploadDisabled: false,
    });
  });

  it("enables noshell only when detached is also present", () => {
    expect(resolveUrlAppMode("?detached&noshell")).toEqual({
      isDetached: true,
      detachedNoBorder: false,
      detachedNoShell: true,
      isNative: false,
      uploadDisabled: false,
    });

    expect(resolveUrlAppMode("?noshell")).toEqual({
      isDetached: false,
      detachedNoBorder: false,
      detachedNoShell: false,
      isNative: false,
      uploadDisabled: false,
    });
  });

  it("keeps noborder orthogonal to noshell", () => {
    expect(resolveUrlAppMode("?detached&noborder&noshell")).toEqual({
      isDetached: true,
      detachedNoBorder: true,
      detachedNoShell: true,
      isNative: false,
      uploadDisabled: false,
    });
  });
});
