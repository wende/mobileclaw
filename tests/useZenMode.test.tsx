import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useZenMode, ZEN_STORAGE_KEY } from "@/hooks/useZenMode";

function mockStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
    clear: vi.fn(() => { store.clear(); }),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    get length() { return store.size; },
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });

  return storage;
}

describe("useZenMode", () => {
  beforeEach(() => {
    mockStorage();
    window.history.pushState({}, "", "/");
  });

  it("loads zen mode from localStorage when query param is absent", async () => {
    const storage = mockStorage({ [ZEN_STORAGE_KEY]: "1" });
    const { result } = renderHook(() => useZenMode());

    await waitFor(() => expect(result.current.zenMode).toBe(true));
    expect(storage.getItem).toHaveBeenCalledWith(ZEN_STORAGE_KEY);
  });

  it("keeps zen mode off when localStorage is off and no query param is present", async () => {
    const storage = mockStorage({ [ZEN_STORAGE_KEY]: "0" });
    const { result } = renderHook(() => useZenMode());

    await waitFor(() => expect(result.current.zenMode).toBe(false));
    expect(storage.getItem).toHaveBeenCalledWith(ZEN_STORAGE_KEY);
  });

  it("forces zen mode on when ?zen is present even if localStorage is off", async () => {
    mockStorage({ [ZEN_STORAGE_KEY]: "0" });
    window.history.pushState({}, "", "/?zen");
    const { result } = renderHook(() => useZenMode());

    await waitFor(() => expect(result.current.zenMode).toBe(true));
  });

  it("persists toggles to localStorage", async () => {
    const storage = mockStorage({ [ZEN_STORAGE_KEY]: "0" });
    const { result } = renderHook(() => useZenMode());

    await waitFor(() => expect(result.current.zenMode).toBe(false));

    act(() => {
      result.current.toggleZenMode();
    });
    expect(result.current.zenMode).toBe(true);
    expect(storage.setItem).toHaveBeenLastCalledWith(ZEN_STORAGE_KEY, "1");

    act(() => {
      result.current.toggleZenMode();
    });
    expect(result.current.zenMode).toBe(false);
    expect(storage.setItem).toHaveBeenLastCalledWith(ZEN_STORAGE_KEY, "0");
  });
});
