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
      // Detached embeds hide reasoning by default (end-user facing).
      hideThinking: true,
    });
  });

  it("enables noshell only when detached is also present", () => {
    expect(resolveUrlAppMode("?detached&noshell")).toEqual({
      isDetached: true,
      detachedNoBorder: false,
      detachedNoShell: true,
      isNative: false,
      uploadDisabled: false,
      hideThinking: true,
    });

    expect(resolveUrlAppMode("?noshell")).toEqual({
      isDetached: false,
      detachedNoBorder: false,
      detachedNoShell: false,
      isNative: false,
      uploadDisabled: false,
      hideThinking: false,
    });
  });

  it("keeps noborder orthogonal to noshell", () => {
    expect(resolveUrlAppMode("?detached&noborder&noshell")).toEqual({
      isDetached: true,
      detachedNoBorder: true,
      detachedNoShell: true,
      isNative: false,
      uploadDisabled: false,
      hideThinking: true,
    });
  });

  it("hides thinking by default in detached mode", () => {
    expect(resolveUrlAppMode("?detached")).toMatchObject({ hideThinking: true });
  });

  it("re-enables thinking in detached mode with ?think", () => {
    expect(resolveUrlAppMode("?detached&think")).toMatchObject({
      isDetached: true,
      hideThinking: false,
    });
  });

  it("does not hide thinking outside detached mode by default", () => {
    expect(resolveUrlAppMode("")).toMatchObject({
      isDetached: false,
      hideThinking: false,
    });
  });

  it("suppresses thinking outside detached mode when ?nothink is set", () => {
    expect(resolveUrlAppMode("?nothink")).toMatchObject({
      isDetached: false,
      hideThinking: true,
    });
  });
});
